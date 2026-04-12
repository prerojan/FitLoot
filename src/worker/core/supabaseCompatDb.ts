import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { getErrorMessage } from "./errors";
import type { Env } from "./types";

type RuntimeBackend = "d1" | "supabase";

type CompiledSql = {
  sql: string;
  params: readonly unknown[];
};

// Cloudflare Workers isolates scale horizontally, so large per-isolate pools
// can exhaust upstream connection limits. Keep this moderate and configurable.
const DEFAULT_POOL_MAX = 8;
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_POOL_CONNECT_TIMEOUT_MS = 4_000;
const DEFAULT_POOL_QUERY_TIMEOUT_MS = 8_000;
const DEFAULT_POOL_STATEMENT_TIMEOUT_MS = 15_000;
const DEFAULT_READ_MAX_ATTEMPTS = 2;
const DEFAULT_READ_RETRY_BASE_DELAY_MS = 120;
const DEFAULT_READ_RETRY_MAX_DELAY_MS = 750;
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
  user_blocks: "social",
  social_user_preferences: "social",
  user_presence: "social",
  friend_activity_events: "social",
  friend_online_presence: "social",
  conversations: "social",
  conversation_members: "social",
  conversation_messages: "social",
  conversation_message_media: "social",
  daily_metrics: "telemetry",
  food_diary: "telemetry",
  offline_sync_operations: "telemetry",
  progress_snapshots: "telemetry",
  physical_benchmarks: "telemetry",
  app_state: "telemetry",
};

type SupabasePoolHandle = {
  readonly cacheKey: string;
  current: () => Pool;
  recycle: (reason?: string) => Promise<void>;
};

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

function isIdentifierBoundaryCharacter(value: string | undefined): boolean {
  if (!value) return true;
  return !/[A-Za-z0-9_$]/u.test(value);
}

function findClosingParenthesis(sql: string, openIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openIndex; index < sql.length; index += 1) {
    const current = sql[index]!;
    const next = sql[index + 1] ?? "";

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (current === "-" && next === "-") {
        inLineComment = true;
        index += 1;
        continue;
      }
      if (current === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }
    }

    if (current === "'" && !inDoubleQuote) {
      if (inSingleQuote && next === "'") {
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (current === '"' && !inSingleQuote) {
      if (inDoubleQuote && next === '"') {
        index += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (current === "(") {
      depth += 1;
      continue;
    }

    if (current === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevelSqlArgs(expression: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < expression.length; index += 1) {
    const current = expression[index]!;
    const next = expression[index + 1] ?? "";

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (current === "-" && next === "-") {
        inLineComment = true;
        index += 1;
        continue;
      }
      if (current === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }
    }

    if (current === "'" && !inDoubleQuote) {
      if (inSingleQuote && next === "'") {
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (current === '"' && !inSingleQuote) {
      if (inDoubleQuote && next === '"') {
        index += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (current === "(") {
      depth += 1;
      continue;
    }

    if (current === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (current === "," && depth === 0) {
      args.push(expression.slice(start, index).trim());
      start = index + 1;
    }
  }

  args.push(expression.slice(start).trim());
  return args.filter((value) => value.length > 0);
}

function rewriteScalarMax(sql: string): string {
  let output = "";
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (index < sql.length) {
    const current = sql[index]!;
    const next = sql[index + 1] ?? "";

    if (inLineComment) {
      output += current;
      if (current === "\n") {
        inLineComment = false;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      output += current;
      if (current === "*" && next === "/") {
        output += "/";
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (current === "-" && next === "-") {
        output += "--";
        inLineComment = true;
        index += 2;
        continue;
      }
      if (current === "/" && next === "*") {
        output += "/*";
        inBlockComment = true;
        index += 2;
        continue;
      }
    }

    if (current === "'" && !inDoubleQuote) {
      output += current;
      if (inSingleQuote && next === "'") {
        output += "'";
        index += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      index += 1;
      continue;
    }

    if (current === '"' && !inSingleQuote) {
      output += current;
      if (inDoubleQuote && next === '"') {
        output += '"';
        index += 2;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      index += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      const token = sql.slice(index, index + 3);
      const previous = index > 0 ? sql[index - 1] : undefined;
      const following = sql[index + 3];
      const isMaxToken =
        token.length === 3 &&
        token.toLowerCase() === "max" &&
        isIdentifierBoundaryCharacter(previous) &&
        isIdentifierBoundaryCharacter(following);

      if (isMaxToken) {
        let cursor = index + 3;
        while (cursor < sql.length && /\s/u.test(sql[cursor]!)) {
          cursor += 1;
        }

        if (sql[cursor] === "(") {
          const closeIndex = findClosingParenthesis(sql, cursor);
          if (closeIndex > cursor) {
            const innerExpression = sql.slice(cursor + 1, closeIndex);
            const args = splitTopLevelSqlArgs(innerExpression);
            if (args.length === 2) {
              output += `GREATEST(${args[0]}, ${args[1]})`;
              index = closeIndex + 1;
              continue;
            }
          }
        }
      }
    }

    output += current;
    index += 1;
  }

  return output;
}

export function rewriteScalarMaxForTests(sql: string): string {
  return rewriteScalarMax(sql);
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

export function qualifyUnqualifiedTablesForTests(sql: string): string {
  return qualifyUnqualifiedTables(sql);
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

export function isRetryableReadError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  // Statement timeouts usually indicate an actually slow query. Retrying the
  // same statement immediately is unlikely to help and can worsen pressure.
  if (
    message.includes("canceling statement due to statement timeout") ||
    message.includes("statement timeout")
  ) {
    return false;
  }

  return (
    message.includes("query read timeout") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("connection terminated") ||
    message.includes("connection terminated unexpectedly") ||
    message.includes("read etimedout") ||
    message.includes("socket hang up") ||
    message.includes("connect etimedout") ||
    message.includes("connect econnrefused") ||
    message.includes("getaddrinfo enotfound") ||
    message.includes("enotfound")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendOnConflictDoNothing(sql: string): string {
  if (/\bon\s+conflict\b/iu.test(sql)) return sql;
  return `${stripTrailingSemicolon(sql)} ON CONFLICT DO NOTHING`;
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

type SupabaseConnectionMode = "default" | "write" | "read";

type SupabasePoolTuning = {
  max: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  queryTimeoutMs: number;
  statementTimeoutMs: number;
};

type SupabaseRetryTuning = {
  maxReadAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type SupabaseCompatDatabaseOptions = {
  mode?: SupabaseConnectionMode;
  fallbackToWriteConnection?: boolean;
};

type SupabaseCompatFactoryEnv = Pick<
  Env,
  | "SUPABASE_DB_URL"
  | "SUPABASE_HYPERDRIVE"
  | "SUPABASE_WRITE_DB_URL"
  | "SUPABASE_WRITE_HYPERDRIVE"
  | "SUPABASE_READ_DB_URL"
  | "SUPABASE_READ_HYPERDRIVE"
  | "SUPABASE_POOL_MAX"
  | "SUPABASE_CONNECT_TIMEOUT_MS"
  | "SUPABASE_QUERY_TIMEOUT_MS"
  | "SUPABASE_STATEMENT_TIMEOUT_MS"
  | "SUPABASE_IDLE_TIMEOUT_MS"
  | "SUPABASE_READ_MAX_ATTEMPTS"
  | "SUPABASE_READ_RETRY_BASE_DELAY_MS"
  | "SUPABASE_READ_RETRY_MAX_DELAY_MS"
>;

function readEnvNumber(
  value: string | undefined,
  fallback: number,
  {
    min,
    max,
  }: {
    min: number;
    max: number;
  },
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function resolvePoolTuning(env: SupabaseCompatFactoryEnv): SupabasePoolTuning {
  return {
    max: readEnvNumber(env.SUPABASE_POOL_MAX, DEFAULT_POOL_MAX, { min: 1, max: 32 }),
    connectionTimeoutMs: readEnvNumber(
      env.SUPABASE_CONNECT_TIMEOUT_MS,
      DEFAULT_POOL_CONNECT_TIMEOUT_MS,
      { min: 1_000, max: 60_000 },
    ),
    idleTimeoutMs: readEnvNumber(
      env.SUPABASE_IDLE_TIMEOUT_MS,
      DEFAULT_POOL_IDLE_TIMEOUT_MS,
      { min: 1_000, max: 300_000 },
    ),
    queryTimeoutMs: readEnvNumber(
      env.SUPABASE_QUERY_TIMEOUT_MS,
      DEFAULT_POOL_QUERY_TIMEOUT_MS,
      { min: 1_000, max: 120_000 },
    ),
    statementTimeoutMs: readEnvNumber(
      env.SUPABASE_STATEMENT_TIMEOUT_MS,
      DEFAULT_POOL_STATEMENT_TIMEOUT_MS,
      { min: 1_000, max: 300_000 },
    ),
  };
}

function resolveRetryTuning(env: SupabaseCompatFactoryEnv): SupabaseRetryTuning {
  return {
    maxReadAttempts: readEnvNumber(
      env.SUPABASE_READ_MAX_ATTEMPTS,
      DEFAULT_READ_MAX_ATTEMPTS,
      { min: 1, max: 5 },
    ),
    baseDelayMs: readEnvNumber(
      env.SUPABASE_READ_RETRY_BASE_DELAY_MS,
      DEFAULT_READ_RETRY_BASE_DELAY_MS,
      { min: 0, max: 5_000 },
    ),
    maxDelayMs: readEnvNumber(
      env.SUPABASE_READ_RETRY_MAX_DELAY_MS,
      DEFAULT_READ_RETRY_MAX_DELAY_MS,
      { min: 50, max: 10_000 },
    ),
  };
}

function resolveDefaultSupabaseConnection(
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

  throw new Error(
    "DB_BACKEND=supabase requires SUPABASE_HYPERDRIVE binding or SUPABASE_DB_URL in Worker secrets.",
  );
}

function resolveSupabaseConnection(
  env: SupabaseCompatFactoryEnv,
  mode: SupabaseConnectionMode,
  fallbackToWriteConnection: boolean,
): { connectionUrl: string; useSsl: boolean } {
  const readOrWriteHyperdrive =
    mode === "read" ? env.SUPABASE_READ_HYPERDRIVE : env.SUPABASE_WRITE_HYPERDRIVE;
  const readOrWriteDbUrl =
    mode === "read" ? env.SUPABASE_READ_DB_URL : env.SUPABASE_WRITE_DB_URL;

  const explicitHyperdrive = readHyperdriveConnectionString(readOrWriteHyperdrive);
  if (explicitHyperdrive) {
    return { connectionUrl: explicitHyperdrive, useSsl: false };
  }

  const explicitDbUrl = readOrWriteDbUrl?.trim();
  if (explicitDbUrl) {
    return { connectionUrl: explicitDbUrl, useSsl: true };
  }

  if (mode === "read" && fallbackToWriteConnection) {
    return resolveSupabaseConnection(env, "write", true);
  }

  return resolveDefaultSupabaseConnection(env);
}

function createPgPool(
  normalizedConnectionUrl: string,
  useSsl: boolean,
  poolTuning: SupabasePoolTuning,
): Pool {
  const poolConfig: PoolConfig = {
    connectionString: normalizedConnectionUrl,
    max: poolTuning.max,
    connectionTimeoutMillis: poolTuning.connectionTimeoutMs,
    idleTimeoutMillis: poolTuning.idleTimeoutMs,
    query_timeout: poolTuning.queryTimeoutMs,
    statement_timeout: poolTuning.statementTimeoutMs,
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

  return pool;
}

async function closePoolSilently(cacheKey: string, pool: Pool, reason?: string): Promise<void> {
  const maybePoolWithEnd = pool as Pool & { end?: (() => Promise<unknown>) | undefined };
  if (typeof maybePoolWithEnd.end !== "function") {
    return;
  }

  try {
    await maybePoolWithEnd.end.call(pool);
  } catch (error) {
    console.warn("[supabase-compat-db][pool-close-failed]", {
      cacheKey,
      reason: reason ?? "unspecified",
      message: getErrorMessage(error),
    });
  }
}

function getPgPoolHandle(
  dbUrlRaw: string,
  useSsl: boolean,
  poolTuning: SupabasePoolTuning,
): SupabasePoolHandle {
  const normalized = normalizeConnectionUrl(dbUrlRaw);
  const cacheKey = [
    normalized,
    `ssl=${useSsl ? "1" : "0"}`,
    `max=${poolTuning.max}`,
    `connect=${poolTuning.connectionTimeoutMs}`,
    `idle=${poolTuning.idleTimeoutMs}`,
    `query=${poolTuning.queryTimeoutMs}`,
    `stmt=${poolTuning.statementTimeoutMs}`,
  ].join("::");
  let activePool: Pool | null = null;

  const getOrCreatePool = (): Pool => {
    if (activePool) {
      return activePool;
    }

    const pool = createPgPool(normalized, useSsl, poolTuning);
    activePool = pool;
    return pool;
  };

  return {
    cacheKey,
    current: getOrCreatePool,
    recycle: async (reason) => {
      if (!activePool) {
        return;
      }

      const pool = activePool;
      activePool = null;
      console.warn("[supabase-compat-db][pool-recycle]", {
        cacheKey,
        reason: reason ?? "retryable-read-error",
      });
      await closePoolSilently(cacheKey, pool, reason);
    },
  };
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

  constructor(
    private readonly poolHandle: SupabasePoolHandle,
    private readonly retryTuning: SupabaseRetryTuning,
  ) {}

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

    const client = await this.poolHandle.current().connect();
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

  private async compileSql(
    originalSql: string,
    params: readonly unknown[],
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
    const compiled = await this.compileSql(sql, params);
    const maxAttempts =
      !this.transactionClient && mode !== "run"
        ? this.retryTuning.maxReadAttempts
        : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        let result: QueryResult<T>;
        if (this.transactionClient) {
          result = await this.transactionClient.query<T>(compiled.sql, [...compiled.params]);
        } else {
          // Acquire a pooled client explicitly so we can evict broken sockets on
          // query failure while still reusing healthy ones. Healthy sockets must
          // go back to the pool; destroying them on every success creates
          // connection churn and turns simple reads into repeated reconnects.
          const client = await this.poolHandle.current().connect();
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
        const retryableReadError = isRetryableReadError(error);
        if (retryableReadError && !this.transactionClient) {
          await this.poolHandle.recycle("retryable-read-error");
        }

        const shouldRetry =
          attempt < maxAttempts &&
          retryableReadError;
        if (shouldRetry) {
          console.warn("[supabase-compat-db][query-retry]", {
            attempt,
            message: getErrorMessage(error),
            sql: stripTrailingSemicolon(sql).slice(0, 120),
          });
          const jitterMs = Math.floor(Math.random() * 100);
          const backoffMs = Math.min(
            this.retryTuning.maxDelayMs,
            this.retryTuning.baseDelayMs * attempt + jitterMs,
          );
          await sleep(backoffMs);
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

export function createSupabaseCompatDatabase(
  env: SupabaseCompatFactoryEnv,
  options: SupabaseCompatDatabaseOptions = {},
): RuntimeDatabase {
  const mode = options.mode ?? "default";
  const fallbackToWriteConnection =
    mode === "read" ? options.fallbackToWriteConnection !== false : false;
  const { connectionUrl, useSsl } = resolveSupabaseConnection(
    env,
    mode,
    fallbackToWriteConnection,
  );
  const poolTuning = resolvePoolTuning(env);
  const retryTuning = resolveRetryTuning(env);
  const poolHandle = getPgPoolHandle(connectionUrl, useSsl, poolTuning);
  const compatDb = new SupabaseCompatDatabase(poolHandle, retryTuning);
  const db = compatDb as unknown as RuntimeDatabase;
  db.__backend = "supabase";
  db.__transaction = <T>(run: () => Promise<T>) => compatDb.runInTransaction(run);
  return db;
}
