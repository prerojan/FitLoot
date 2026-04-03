import type { Context } from "hono";

import {
  INCOMPLETE_ONBOARDING_PURGE_TARGETS,
  USER_PURGE_TARGETS,
} from "./constants";
import type { AppContext } from "./types";

let cachedSchemaState: { ready: boolean; checkedAt: number } | null = null;
const SCHEMA_CACHE_TTL_MS = 60_000;
const TABLE_COLUMN_CACHE_TTL_MS = 60_000;
const tableColumnCache = new Map<string, { checkedAt: number; columns: Set<string> }>();

function isConnectionTimeoutLike(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .trim();
  return (
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("query read timeout") ||
    message.includes("connection terminated") ||
    message.includes("connect etimedout") ||
    message.includes("connection timeout")
  );
}

function isSupabaseRuntimeDb(db: D1Database): boolean {
  return (db as D1Database & { __backend?: string }).__backend === "supabase";
}

export async function hasCoreSchema(db: D1Database) {
  const runtimeDb = db as D1Database & { __backend?: string };
  if (runtimeDb.__backend === "supabase") {
    return true;
  }

  const now = Date.now();
  if (cachedSchemaState && now - cachedSchemaState.checkedAt < SCHEMA_CACHE_TTL_MS) {
    return cachedSchemaState.ready;
  }

  try {
    // Prefer direct schema-qualified probes to avoid compat-view indirection on Supabase.
    await db.prepare("SELECT 1 FROM core.users LIMIT 1").first();
    await db.prepare("SELECT 1 FROM core.sessions LIMIT 1").first();
    cachedSchemaState = { ready: true, checkedAt: now };
    return true;
  } catch (error) {
    if (isConnectionTimeoutLike(error)) {
      cachedSchemaState = { ready: false, checkedAt: now };
      return false;
    }
    // Fall back to unqualified tables for D1/local sqlite environments.
  }

  try {
    await db.prepare("SELECT 1 FROM users LIMIT 1").first();
    await db.prepare("SELECT 1 FROM sessions LIMIT 1").first();
    cachedSchemaState = { ready: true, checkedAt: now };
    return true;
  } catch (error) {
    if (isConnectionTimeoutLike(error)) {
      cachedSchemaState = { ready: false, checkedAt: now };
      return false;
    }
    // Fall back to metadata checks for partially bootstrapped environments.
  }

  try {
    let result: { count: number } | null = null;

    try {
      result = await db.prepare(
        `SELECT COUNT(DISTINCT table_name) as count
           FROM information_schema.tables
          WHERE table_name IN ('users', 'sessions')
            AND (
              table_schema = 'core'
              OR table_schema = ANY(current_schemas(true))
            )`,
      ).first<{ count: number }>();
    } catch {
      // D1/local mocks do not expose information_schema; fallback to sqlite metadata.
    }

    if (!result) {
      result = await db.prepare(
        `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name IN ('users', 'sessions')`,
      ).first<{ count: number }>();
    }

    const ready = Number(result?.count ?? 0) >= 2;
    cachedSchemaState = { ready, checkedAt: now };
    return ready;
  } catch (error) {
    console.error("[schema-check]", error);
    cachedSchemaState = { ready: false, checkedAt: now };
    return false;
  }
}

export function databaseNotInitializedResponse(c: Context<AppContext>) {
  return c.json(
    {
      error: "Banco local não inicializado. Execute as migrations D1 antes de usar a API.",
      code: "DB_NOT_INITIALIZED",
    },
    503,
  );
}

async function getTableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  const cacheKey = tableName.trim().toLowerCase();
  const now = Date.now();
  const cached = tableColumnCache.get(cacheKey);
  if (cached && now - cached.checkedAt < TABLE_COLUMN_CACHE_TTL_MS) {
    return cached.columns;
  }
  const staleColumns = cached?.columns ?? null;

  let rows: Array<{ name: string | null }> = [];
  try {
    const info = await db.prepare(
      `SELECT column_name as name
         FROM information_schema.columns
        WHERE table_name = ?
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY
          CASE
            WHEN table_schema = ANY(current_schemas(true)) THEN 0
            WHEN table_schema = 'core' THEN 1
            ELSE 2
          END,
          ordinal_position`,
    ).bind(cacheKey).all<{ name: string | null }>();
    rows = Array.isArray(info.results) ? info.results : [];
  } catch (error) {
    if (staleColumns && isConnectionTimeoutLike(error)) {
      return staleColumns;
    }
    if (isSupabaseRuntimeDb(db)) {
      throw error;
    }
    const info = await db.prepare(`PRAGMA table_info('${cacheKey}')`).all<{ name: string | null }>();
    rows = Array.isArray(info.results) ? info.results : [];
  }

  const columns = new Set(
    rows
      .map((row) => (typeof row.name === "string" ? row.name.toLowerCase() : ""))
      .filter((value) => value.length > 0),
  );

  tableColumnCache.set(cacheKey, { checkedAt: now, columns });
  return columns;
}

export async function hasTableColumn(db: D1Database, tableName: string, columnName: string): Promise<boolean> {
  const columns = await getTableColumns(db, tableName);
  return columns.has(columnName.trim().toLowerCase());
}

async function deleteUserDataByColumns(
  db: D1Database,
  table: string,
  columns: ReadonlyArray<string>,
  userId: string,
): Promise<void> {
  const availableColumns: string[] = [];

  for (const column of columns) {
    if (await hasTableColumn(db, table, column)) {
      availableColumns.push(column);
    }
  }

  if (availableColumns.length === 0) {
    return;
  }

  const clause = availableColumns.map((column) => `${column} = ?`).join(" OR ");
  const params = availableColumns.map(() => userId);
  await db.prepare(`DELETE FROM ${table} WHERE ${clause}`).bind(...params).run();
}

export async function purgeUserAccountData(db: D1Database, userId: string): Promise<void> {
  for (const target of USER_PURGE_TARGETS) {
    await deleteUserDataByColumns(db, target.table, target.columns, userId);
  }
}

export async function purgeIncompleteOnboardingData(
  db: D1Database,
  userId: string,
): Promise<void> {
  for (const target of INCOMPLETE_ONBOARDING_PURGE_TARGETS) {
    await deleteUserDataByColumns(db, target.table, target.columns, userId);
  }
}
