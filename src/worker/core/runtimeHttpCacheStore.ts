import {
  ensureRuntimeSchemaReady,
  runRuntimeCleanupThrottled,
} from "./runtimeSchemaCoordinator";

type RuntimeHttpCacheRecord = {
  cache_key: string;
  session_id: string;
  path: string;
  status: number;
  headers_json: string;
  body_text: string;
  expires_at: number;
  stale_until: number;
};

export type RuntimeHttpCacheSnapshot = {
  status: number;
  headers: Array<[string, string]>;
  body: string;
};

export type RuntimeHttpCacheLookupResult = {
  snapshot: RuntimeHttpCacheSnapshot;
  expiresAt: number;
  staleUntil: number;
};

type RuntimeHttpCacheUpsertInput = {
  cacheKey: string;
  sessionId: string;
  path: string;
  expiresAt: number;
  staleUntil: number;
  snapshot: RuntimeHttpCacheSnapshot;
};

const RUNTIME_HTTP_CACHE_CLEANUP_INTERVAL_MS = 60_000;
const RUNTIME_HTTP_CACHE_SCHEMA_KEY = "runtime_http_cache";
const RUNTIME_HTTP_CACHE_CLEANUP_KEY = "runtime_http_cache:cleanup";

async function maybeCleanupRuntimeHttpCache(db: D1Database, now: number): Promise<void> {
  await runRuntimeCleanupThrottled(
    db,
    RUNTIME_HTTP_CACHE_CLEANUP_KEY,
    RUNTIME_HTTP_CACHE_CLEANUP_INTERVAL_MS,
    async () => {
      await db
        .prepare("DELETE FROM runtime_http_cache WHERE stale_until <= ?")
        .bind(now)
        .run();
    },
    now,
  );
}

async function ensureRuntimeHttpCacheSchema(db: D1Database): Promise<void> {
  await ensureRuntimeSchemaReady(db, RUNTIME_HTTP_CACHE_SCHEMA_KEY, async () => {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS runtime_http_cache (
          cache_key TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          path TEXT NOT NULL,
          status INTEGER NOT NULL,
          headers_json TEXT NOT NULL,
          body_text TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          stale_until INTEGER NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
      )
      .run();

    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_runtime_http_cache_session ON runtime_http_cache(session_id)",
      )
      .run();

    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_runtime_http_cache_expiry ON runtime_http_cache(expires_at)",
      )
      .run();
  });
}

function safeParseHeaders(rawValue: string): Array<[string, string]> | null {
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return null;
    const normalized: Array<[string, string]> = [];
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const key = typeof entry[0] === "string" ? entry[0] : "";
      const value = typeof entry[1] === "string" ? entry[1] : "";
      if (!key) return null;
      normalized.push([key, value]);
    }
    return normalized;
  } catch {
    return null;
  }
}

export async function readRuntimeHttpCache(
  db: D1Database,
  cacheKey: string,
): Promise<RuntimeHttpCacheLookupResult | null> {
  await ensureRuntimeHttpCacheSchema(db);

  const row = await db
    .prepare(
      `SELECT
        cache_key,
        session_id,
        path,
        status,
        headers_json,
        body_text,
        expires_at,
        stale_until
      FROM runtime_http_cache
      WHERE cache_key = ?`,
    )
    .bind(cacheKey)
    .first<RuntimeHttpCacheRecord>();

  if (!row) return null;

  const headers = safeParseHeaders(row.headers_json);
  if (!headers) {
    await db
      .prepare("DELETE FROM runtime_http_cache WHERE cache_key = ?")
      .bind(cacheKey)
      .run()
      .catch(() => undefined);
    return null;
  }

  return {
    snapshot: {
      status: Number(row.status) || 200,
      headers,
      body: typeof row.body_text === "string" ? row.body_text : "",
    },
    expiresAt: Number(row.expires_at) || 0,
    staleUntil: Number(row.stale_until) || 0,
  };
}

export async function upsertRuntimeHttpCache(
  db: D1Database,
  input: RuntimeHttpCacheUpsertInput,
): Promise<void> {
  await ensureRuntimeHttpCacheSchema(db);
  await db
    .prepare(
      `INSERT INTO runtime_http_cache (
        cache_key,
        session_id,
        path,
        status,
        headers_json,
        body_text,
        expires_at,
        stale_until,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(cache_key) DO UPDATE SET
        session_id = excluded.session_id,
        path = excluded.path,
        status = excluded.status,
        headers_json = excluded.headers_json,
        body_text = excluded.body_text,
        expires_at = excluded.expires_at,
        stale_until = excluded.stale_until,
        updated_at = datetime('now')`,
    )
    .bind(
      input.cacheKey,
      input.sessionId,
      input.path,
      input.snapshot.status,
      JSON.stringify(input.snapshot.headers),
      input.snapshot.body,
      Math.max(0, Math.floor(input.expiresAt)),
      Math.max(0, Math.floor(input.staleUntil)),
    )
    .run();
  await maybeCleanupRuntimeHttpCache(db, Date.now());
}

export async function deleteRuntimeHttpCacheBySession(
  db: D1Database,
  sessionId: string,
): Promise<void> {
  await ensureRuntimeHttpCacheSchema(db);
  await db
    .prepare("DELETE FROM runtime_http_cache WHERE session_id = ?")
    .bind(sessionId)
    .run();
  await maybeCleanupRuntimeHttpCache(db, Date.now());
}

export async function deleteRuntimeHttpCacheBySessionPaths(
  db: D1Database,
  sessionId: string,
  paths: readonly string[],
): Promise<void> {
  const normalizedPaths = [...new Set(paths.filter((path) => path.trim().length > 0))];
  if (normalizedPaths.length === 0) {
    return;
  }

  await ensureRuntimeHttpCacheSchema(db);
  const placeholders = normalizedPaths.map(() => "?").join(", ");
  await db
    .prepare(
      `DELETE FROM runtime_http_cache
        WHERE session_id = ?
          AND path IN (${placeholders})`,
    )
    .bind(sessionId, ...normalizedPaths)
    .run();
  await maybeCleanupRuntimeHttpCache(db, Date.now());
}
