import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { getErrorMessage } from "./errors";
import type { Env } from "./types";

type QueryTarget = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type RuntimeBackend = "d1" | "supabase";

type TableRef = {
  schema: string | null;
  table: string;
  cacheKey: string;
};

type CompiledSql = {
  sql: string;
  params: readonly unknown[];
};

// Cloudflare Workers isolates scale horizontally, so large per-isolate pools
// can exhaust upstream connection limits. Keep this very small.
const DEFAULT_POOL_MAX = 2;
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_POOL_CONNECT_TIMEOUT_MS = 4_000;
const DEFAULT_POOL_QUERY_TIMEOUT_MS = 8_000;
const DEFAULT_POOL_STATEMENT_TIMEOUT_MS = 15_000;
const SEARCH_PATH = "compat,core,missions,gameplay,catalog,billing,social,telemetry,public";
const TABLE_SCHEMA_MAP: Readonly<Record<string, string>> = {
  users: "core",
  sessions: "core",
  user_sessions: "core",
  magic_link_tokens: "core",
  user_profiles: "core",
  user_attributes: "core",
  user_progression: "core",
  user_training_plans: "core",
  missions: "missions",
  mission_subtasks: "missions",
  mission_generation_jobs: "missions",
  skills: "catalog",
  skill_stages: "catalog",
  titles: "catalog",
  achievements: "catalog",
  promo_codes: "catalog",
  shop_partners: "catalog",
  shop_products: "catalog",
  user_skills: "gameplay",
  user_achievements: "gameplay",
  user_titles: "gameplay",
  user_event_counters: "gameplay",
  user_event_log: "gameplay",
  user_goal_stats: "gameplay",
  user_monthly_counters: "gameplay",
  user_reward_notifications: "gameplay",
  mini_games: "gameplay",
  coupon_orders: "gameplay",
  subscriptions: "billing",
  promo_code_usages: "billing",
  cakto_webhook_events: "billing",
  friendships: "social",
  friend_requests: "social",
  user_presence: "social",
  friend_activity_events: "social",
  daily_metrics: "telemetry",
  food_diary: "telemetry",
  progress_snapshots: "telemetry",
  physical_benchmarks: "telemetry",
  app_state: "telemetry",
};

const poolCache = new Map<string, Pool>();

let savepointCounter = 0;

function nextSavepointName() {
  savepointCounter += 1;
  return `codex_tx_${Date.now()}_${savepointCounter}`;
}

function normalizeConnectionUrl(connectionUrl: string): string {
  try {
    const parsed = new URL(connectionUrl);

    const isSupabasePooler = parsed.hostname.includes("pooler.supabase.com");
    if (isSupabasePooler) {
      // Supabase pooler (PgBouncer) can terminate connections when startup
      // `options` are present. Keep startup params minimal in that mode.
      parsed.searchParams.delete("options");
    } else {
      const currentOptions = parsed.searchParams.get("options");
      const searchPathOption = `-c search_path=${SEARCH_PATH}`;
      if (!currentOptions) {
        parsed.searchParams.set("options", searchPathOption);
      } else if (!currentOptions.includes("search_path")) {
        parsed.searchParams.set("options", `${currentOptions} ${searchPathOption}`.trim());
      }
    }

    // Enforce TLS behavior through the explicit `ssl` config below instead of `sslmode`.
    // This avoids parser-specific `sslmode` semantics drift across pg versions.
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("sslrootcert");
    parsed.searchParams.delete("sslcert");
    parsed.searchParams.delete("sslkey");
    parsed.searchParams.delete("uselibpqcompat");

    return parsed.toString();
  } catch {
    // Keep the original URL when WHATWG parsing fails (for provider-specific DSNs).
    return connectionUrl.trim();
  }
}

function toNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  }
  return null;
}

function buildD1Result<T>(
  rows: T[],
  rowCount: number,
  lastRowId: number | null,
): D1Result<T> {
  return {
    success: true,
    results: rows,
    meta: {
      changed_db: false,
      changes: rowCount,
      duration: 0,
      last_row_id: lastRowId,
      rows_read: Array.isArray(rows) ? rows.length : 0,
      rows_written: rowCount,
      size_after: 0,
      served_by_primary: true,
      timings: { sql_duration_ms: 0 },
      total_attempts: 1,
    },
  } as D1Result<T>;
}

function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/u, "");
}

function rewriteScalarMax(sql: string): string {
  return sql.replace(
    /\bMAX\s*\(\s*([^(),]+?)\s*,\s*([^)]+?)\s*\)/giu,
    "GREATEST($1, $2)",
  );
}

function rewriteInsertOrIgnore(sql: string): { sql: string; wasInsertIgnore: boolean } {
  if (!/^\s*insert\s+or\s+ignore\s+into\b/iu.test(sql)) {
    return { sql, wasInsertIgnore: false };
  }
  return {
    sql: sql.replace(/^\s*insert\s+or\s+ignore\s+into\b/iu, "INSERT INTO"),
    wasInsertIgnore: true,
  };
}

function rewriteSqliteDatetimeFunction(sql: string): string {
  return sql.replace(
    /(^|[^.\w])datetime\s*\(/giu,
    (_match: string, prefix: string) => `${prefix}compat.datetime(`,
  );
}

function qualifyUnqualifiedTables(sql: string): string {
  return sql.replace(
    /\b(from|join|update|into|delete\s+from)\s+([A-Za-z_"][\w"]*(?:\.[A-Za-z_"][\w"]*)?)/giu,
    (fullMatch: string, keyword: string, rawIdentifier: string) => {
      const cleanedIdentifier = rawIdentifier.replace(/"/g, "");
      if (cleanedIdentifier.includes(".")) {
        return fullMatch;
      }

      const tableName = cleanedIdentifier.trim().toLowerCase();
      if (!tableName) {
        return fullMatch;
      }

      const schemaName = TABLE_SCHEMA_MAP[tableName];
      if (!schemaName) {
        return fullMatch;
      }

      return `${keyword} ${schemaName}.${tableName}`;
    },
  );
}

function replaceQuestionMarkParams(sql: string): string {
  let paramIndex = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let output = "";

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index]!;
    const next = sql[index + 1] ?? "";

    if (current === "'" && !inDoubleQuote) {
      if (inSingleQuote && next === "'") {
        output += "''";
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      output += current;
      continue;
    }

    if (current === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      output += current;
      continue;
    }

    if (current === "?" && !inSingleQuote && !inDoubleQuote) {
      paramIndex += 1;
      output += `$${paramIndex}`;
      continue;
    }

    output += current;
  }

  return output;
}

function isRetryableReadError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("query read timeout") ||
    message.includes("connection terminated") ||
    message.includes("connection terminated unexpectedly") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("read etimedout") ||
    message.includes("socket hang up")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractInsertTarget(sql: string): TableRef | null {
  const match = /^\s*insert\s+into\s+([^\s(]+)/iu.exec(sql);
  if (!match?.[1]) return null;

  const cleaned = match[1].replace(/"/g, "");
  const [schemaOrTable, maybeTable] = cleaned.split(".");
  if (!schemaOrTable) return null;

  if (maybeTable) {
    const schema = schemaOrTable.trim().toLowerCase();
    const table = maybeTable.trim().toLowerCase();
    if (!schema || !table) return null;
    return {
      schema,
      table,
      cacheKey: `${schema}.${table}`,
    };
  }

  const table = schemaOrTable.trim().toLowerCase();
  if (!table) return null;
  return {
    schema: null,
    table,
    cacheKey: table,
  };
}

function hasReturningClause(sql: string): boolean {
  return /\breturning\b/iu.test(sql);
}

function isInsertStatement(sql: string): boolean {
  return /^\s*insert\s+into\b/iu.test(sql);
}

function appendOnConflictDoNothing(sql: string): string {
  if (/\bon\s+conflict\b/iu.test(sql)) return sql;
  return `${stripTrailingSemicolon(sql)} ON CONFLICT DO NOTHING`;
}

function appendReturningId(sql: string): string {
  if (hasReturningClause(sql)) return sql;
  return `${stripTrailingSemicolon(sql)} RETURNING id`;
}

function resolveLastRowId<T extends QueryResultRow>(result: QueryResult<T>): number | null {
  if (!Array.isArray(result.rows) || result.rows.length === 0) return null;
  const first = result.rows[0] as Record<string, unknown>;
  if ("id" in first) {
    return toNumeric(first.id);
  }
  const firstValue = Object.values(first)[0];
  return toNumeric(firstValue);
}

function readHyperdriveConnectionString(binding: unknown): string | null {
  if (!binding || typeof binding !== "object") return null;
  const candidate = binding as {
    connectionString?: string | (() => string);
  };
  const rawValue =
    typeof candidate.connectionString === "function"
      ? candidate.connectionString()
      : candidate.connectionString;
  if (typeof rawValue !== "string") return null;
  const value = rawValue.trim();
  return value.length > 0 ? value : null;
}

function getPgPool(dbUrlRaw: string, useSsl: boolean): Pool {
  const normalized = normalizeConnectionUrl(dbUrlRaw);
  const cacheKey = `${normalized}::ssl=${useSsl ? "1" : "0"}`;
  const cached = poolCache.get(cacheKey);
  if (cached) return cached;

  const poolConfig: PoolConfig = {
    connectionString: normalized,
    max: DEFAULT_POOL_MAX,
    connectionTimeoutMillis: DEFAULT_POOL_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: DEFAULT_POOL_IDLE_TIMEOUT_MS,
    query_timeout: DEFAULT_POOL_QUERY_TIMEOUT_MS,
    statement_timeout: DEFAULT_POOL_STATEMENT_TIMEOUT_MS,
    ssl: useSsl
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  };

  const pool = new Pool(poolConfig);

  pool.on("error", (error) => {
    console.error("[supabase-compat-db][pool-error]", {
      message: getErrorMessage(error),
    });
  });

  poolCache.set(cacheKey, pool);
  return pool;
}

class SupabasePreparedStatement {
  private boundValues: unknown[] = [];

  constructor(
    private readonly db: SupabaseCompatDatabase,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundValues = [...values];
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const result = await this.db.executeSql<Record<string, unknown>>(
      this.query,
      this.boundValues,
      "first",
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0] as Record<string, unknown>;
    if (typeof colName === "string" && colName.length > 0) {
      return (row[colName] ?? null) as T | null;
    }
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.db.executeSql<Record<string, unknown>>(
      this.query,
      this.boundValues,
      "all",
    );
    return buildD1Result<T>(result.rows as unknown as T[], result.rowCount, result.lastRowId);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.db.executeSql<Record<string, unknown>>(
      this.query,
      this.boundValues,
      "run",
    );
    return buildD1Result<T>(result.rows as unknown as T[], result.rowCount, result.lastRowId);
  }

  async raw<T = unknown[]>(
    options: { columnNames: true } | { columnNames?: false } = {},
  ): Promise<T[] | [string[], ...T[]]> {
    const result = await this.db.executeSql<Record<string, unknown>>(
      this.query,
      this.boundValues,
      "all",
    );
    const rows = result.rows;

    if (options.columnNames) {
      if (rows.length === 0) return [[]] as [string[], ...T[]];
      const columnNames = Object.keys(rows[0] as Record<string, unknown>);
      const data = rows.map((row) => Object.values(row as Record<string, unknown>) as T);
      return [columnNames, ...data];
    }

    return rows.map((row) => Object.values(row as Record<string, unknown>) as T);
  }
}

class SupabaseCompatDatabase {
  readonly __backend: RuntimeBackend = "supabase";

  private transactionClient: PoolClient | null = null;
  private transactionDepth = 0;
  private readonly tableIdColumnCache = new Map<string, boolean>();

  constructor(private readonly pool: Pool) {}

  prepare(query: string): D1PreparedStatement {
    return new SupabasePreparedStatement(this, query) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const output: D1Result<T>[] = [];
    for (const statement of statements) {
      output.push(await statement.run<T>());
    }
    return output;
  }

  async exec(query: string): Promise<D1ExecResult> {
    const result = await this.executeSql<Record<string, unknown>>(query, [], "run");
    return {
      count: result.rowCount,
      duration: 0,
    };
  }

  withSession(): D1DatabaseSession {
    throw new Error("withSession is not implemented for Supabase compatibility backend.");
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("dump is not available for Supabase compatibility backend.");
  }

  async runInTransaction<T>(run: () => Promise<T>): Promise<T> {
    if (this.transactionClient) {
      const savepoint = nextSavepointName();
      await this.transactionClient.query(`SAVEPOINT ${savepoint}`);
      this.transactionDepth += 1;
      try {
        const result = await run();
        await this.transactionClient.query(`RELEASE SAVEPOINT ${savepoint}`);
        this.transactionDepth = Math.max(0, this.transactionDepth - 1);
        return result;
      } catch (error) {
        try {
          await this.transactionClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await this.transactionClient.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch {
          // preserve original error
        }
        this.transactionDepth = Math.max(0, this.transactionDepth - 1);
        throw error;
      }
    }

    const client = await this.pool.connect();
    this.transactionClient = client;
    this.transactionDepth = 0;

    let shouldDestroyClient = false;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL search_path TO ${SEARCH_PATH}`);
      const result = await run();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      shouldDestroyClient = true;
      try {
        await client.query("ROLLBACK");
      } catch {
        // preserve original error
      }
      throw error;
    } finally {
      this.transactionClient = null;
      this.transactionDepth = 0;
      client.release(shouldDestroyClient);
    }
  }

  private async hasIdColumn(target: TableRef): Promise<boolean> {
    const cached = this.tableIdColumnCache.get(target.cacheKey);
    if (typeof cached === "boolean") return cached;

    const queryTarget: QueryTarget = this.currentQueryTarget();
    let result: QueryResult<Record<string, unknown>>;

    if (target.schema) {
      result = await queryTarget.query(
        `SELECT 1
           FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = $2
            AND column_name = 'id'
          LIMIT 1`,
        [target.schema, target.table],
      );
    } else {
      result = await queryTarget.query(
        `SELECT 1
           FROM information_schema.columns
          WHERE table_name = $1
            AND column_name = 'id'
            AND table_schema NOT IN ('pg_catalog', 'information_schema')
          LIMIT 1`,
        [target.table],
      );
    }

    const hasColumn = (result.rowCount ?? 0) > 0;
    this.tableIdColumnCache.set(target.cacheKey, hasColumn);
    return hasColumn;
  }

  private currentQueryTarget(): QueryTarget {
    return this.transactionClient ?? this.pool;
  }

  private async compileSql(
    originalSql: string,
    params: readonly unknown[],
    mode: "first" | "all" | "run",
  ): Promise<CompiledSql> {
    let workingSql = originalSql;

    workingSql = qualifyUnqualifiedTables(workingSql);
    workingSql = rewriteSqliteDatetimeFunction(workingSql);
    workingSql = rewriteScalarMax(workingSql);

    const insertOrIgnore = rewriteInsertOrIgnore(workingSql);
    workingSql = insertOrIgnore.sql;

    if (insertOrIgnore.wasInsertIgnore) {
      workingSql = appendOnConflictDoNothing(workingSql);
    }

    if (mode === "run" && isInsertStatement(workingSql) && !hasReturningClause(workingSql)) {
      const target = extractInsertTarget(workingSql);
      if (target && (await this.hasIdColumn(target))) {
        workingSql = appendReturningId(workingSql);
      }
    }

    return {
      sql: replaceQuestionMarkParams(workingSql),
      params,
    };
  }

  async executeSql<T extends QueryResultRow>(
    sql: string,
    params: readonly unknown[],
    mode: "first" | "all" | "run",
  ): Promise<{ rows: T[]; rowCount: number; lastRowId: number | null }> {
    const compiled = await this.compileSql(sql, params, mode);
    const maxAttempts =
      !this.transactionClient && mode !== "run" ? 5 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        let result: QueryResult<T>;
        if (this.transactionClient) {
          result = await this.transactionClient.query<T>(compiled.sql, [...compiled.params]);
        } else {
          // Acquire a pooled client explicitly so we can evict broken sockets on
          // query failure while still reusing healthy ones.
          const client = await this.pool.connect();
          try {
            result = await client.query<T>(compiled.sql, [...compiled.params]);
            client.release();
          } catch (queryError) {
            client.release(true);
            throw queryError;
          }
        }
        const rows = Array.isArray(result.rows) ? result.rows : [];
        const rowCount = Number(result.rowCount ?? rows.length ?? 0);
        const normalizedRows = mode === "first" ? (rows.slice(0, 1) as T[]) : rows;
        const lastRowId = resolveLastRowId(result);
        return {
          rows: normalizedRows,
          rowCount,
          lastRowId,
        };
      } catch (error) {
        const shouldRetry =
          attempt < maxAttempts && isRetryableReadError(error);
        if (shouldRetry) {
          console.warn("[supabase-compat-db][query-retry]", {
            attempt,
            message: getErrorMessage(error),
            sql: stripTrailingSemicolon(sql).slice(0, 120),
          });
          const jitterMs = Math.floor(Math.random() * 120);
          await sleep(150 * attempt + jitterMs);
          continue;
        }

        console.error("[supabase-compat-db][query]", {
          message: getErrorMessage(error),
          sql: stripTrailingSemicolon(sql).slice(0, 200),
        });
        throw error;
      }
    }

    throw new Error("Unreachable query execution state.");
  }
}

export type RuntimeDatabase = D1Database & {
  __backend?: RuntimeBackend;
  __transaction?: <T>(run: () => Promise<T>) => Promise<T>;
};

function resolveSupabaseConnection(
  env: Pick<Env, "SUPABASE_DB_URL" | "SUPABASE_HYPERDRIVE">,
): { connectionUrl: string; useSsl: boolean } {
  const hyperdriveValue = readHyperdriveConnectionString(env.SUPABASE_HYPERDRIVE);
  if (hyperdriveValue) {
    // Hyperdrive exposes a local proxy endpoint; SSL should not be forced here.
    return { connectionUrl: hyperdriveValue, useSsl: false };
  }

  const directUrl = env.SUPABASE_DB_URL?.trim();
  if (directUrl) {
    return { connectionUrl: directUrl, useSsl: true };
  }

  if (!directUrl) {
    throw new Error(
      "DB_BACKEND=supabase requires SUPABASE_HYPERDRIVE binding or SUPABASE_DB_URL in Worker secrets.",
    );
  }
  return { connectionUrl: directUrl, useSsl: true };
}

export function createSupabaseCompatDatabase(
  env: Pick<Env, "SUPABASE_DB_URL" | "SUPABASE_HYPERDRIVE">,
): RuntimeDatabase {
  const { connectionUrl, useSsl } = resolveSupabaseConnection(env);
  const pool = getPgPool(connectionUrl, useSsl);
  const compatDb = new SupabaseCompatDatabase(pool);
  const db = compatDb as unknown as RuntimeDatabase;
  db.__backend = "supabase";
  db.__transaction = <T>(run: () => Promise<T>) => compatDb.runInTransaction(run);
  return db;
}
