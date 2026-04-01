import type { Env } from "./types";
import type { RuntimeDatabase } from "./supabaseCompatDb";

export type DatabaseBackend = "d1" | "supabase";

export type ExecuteResult = {
  rowCount: number;
  lastRowId: number | null;
};

export interface DatabaseAdapter {
  readonly backend: DatabaseBackend;
  queryOne<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  queryMany<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<ExecuteResult>;
  transaction<T>(run: () => Promise<T>): Promise<T>;
}

let d1SavepointCapability: boolean | null = null;
let savepointCounter = 0;

function isRuntimeDatabase(value: unknown): value is RuntimeDatabase {
  return typeof value === "object" && value !== null;
}

async function supportsD1Savepoint(db: D1Database): Promise<boolean> {
  if (d1SavepointCapability !== null) return d1SavepointCapability;

  try {
    await db.prepare("SAVEPOINT codex_tx_probe").run();
    await db.prepare("RELEASE SAVEPOINT codex_tx_probe").run();
    d1SavepointCapability = true;
  } catch {
    d1SavepointCapability = false;
  }

  return d1SavepointCapability;
}

function createSavepointName() {
  savepointCounter += 1;
  return `codex_tx_${Date.now()}_${savepointCounter}`;
}

export function createD1Adapter(db: D1Database): DatabaseAdapter {
  return {
    backend: "d1",
    async queryOne<T>(sql: string, params: unknown[] = []) {
      return db
        .prepare(sql)
        .bind(...params)
        .first<T>();
    },
    async queryMany<T>(sql: string, params: unknown[] = []) {
      const result = await db
        .prepare(sql)
        .bind(...params)
        .all<T>();
      return Array.isArray(result.results) ? result.results : [];
    },
    async execute(sql: string, params: unknown[] = []) {
      const result = await db
        .prepare(sql)
        .bind(...params)
        .run();
      return {
        rowCount: Number(result.meta.changes ?? 0),
        lastRowId: Number(result.meta.last_row_id ?? 0) || null,
      };
    },
    async transaction<TResult>(run: () => Promise<TResult>): Promise<TResult> {
      if (!(await supportsD1Savepoint(db))) {
        return run();
      }

      const savepoint = createSavepointName();
      await db.prepare(`SAVEPOINT ${savepoint}`).run();
      try {
        const result = await run();
        await db.prepare(`RELEASE SAVEPOINT ${savepoint}`).run();
        return result;
      } catch (error) {
        try {
          await db.prepare(`ROLLBACK TO SAVEPOINT ${savepoint}`).run();
          await db.prepare(`RELEASE SAVEPOINT ${savepoint}`).run();
        } catch {
          // no-op: preserve the original failure.
        }
        throw error;
      }
    },
  };
}

function createSupabaseAdapter(db: RuntimeDatabase): DatabaseAdapter {
  return {
    backend: "supabase",
    async queryOne<T>(sql: string, params: unknown[] = []) {
      return db
        .prepare(sql)
        .bind(...params)
        .first<T>();
    },
    async queryMany<T>(sql: string, params: unknown[] = []) {
      const result = await db
        .prepare(sql)
        .bind(...params)
        .all<T>();
      return Array.isArray(result.results) ? result.results : [];
    },
    async execute(sql: string, params: unknown[] = []) {
      const result = await db
        .prepare(sql)
        .bind(...params)
        .run();
      return {
        rowCount: Number(result.meta.changes ?? 0),
        lastRowId: Number(result.meta.last_row_id ?? 0) || null,
      };
    },
    async transaction<TResult>(run: () => Promise<TResult>): Promise<TResult> {
      if (typeof db.__transaction === "function") {
        return db.__transaction(run);
      }
      return run();
    },
  };
}

function normalizeBackendValue(value: string | null | undefined): DatabaseBackend {
  const normalized = String(value ?? "d1").trim().toLowerCase();
  if (normalized === "supabase") return "supabase";
  return "d1";
}

export function resolveDatabaseBackend(env: Pick<Env, "DB_BACKEND">): DatabaseBackend {
  return normalizeBackendValue(env.DB_BACKEND);
}

export function createDatabaseAdapter(
  env: Pick<Env, "DB_BACKEND">,
  db: RuntimeDatabase,
): DatabaseAdapter {
  const backend =
    env.DB_BACKEND
      ? resolveDatabaseBackend(env)
      : isRuntimeDatabase(db) && db.__backend === "supabase"
        ? "supabase"
        : "d1";

  if (backend === "supabase") {
    return createSupabaseAdapter(db);
  }
  return createD1Adapter(db);
}
