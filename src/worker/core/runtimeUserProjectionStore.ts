type RuntimeProjectionRecord = {
  payload_json: string;
  updated_at: number;
};

const RUNTIME_PROJECTION_SCHEMA_TTL_MS = 60_000;
const RUNTIME_PROJECTION_CLEANUP_INTERVAL_MS = 60_000;
const RUNTIME_PROJECTION_RETENTION_MS = 24 * 60 * 60 * 1000;

const runtimeProjectionSchemaState = new WeakMap<
  D1Database,
  { checkedAt: number; ready: boolean }
>();
const runtimeProjectionCleanupState = new WeakMap<D1Database, { cleanedAt: number }>();

async function maybeCleanupRuntimeProjections(db: D1Database, now: number): Promise<void> {
  const cached = runtimeProjectionCleanupState.get(db);
  if (cached && now - cached.cleanedAt < RUNTIME_PROJECTION_CLEANUP_INTERVAL_MS) {
    return;
  }

  const minUpdatedAt = now - RUNTIME_PROJECTION_RETENTION_MS;
  await db
    .prepare("DELETE FROM runtime_profile_projection WHERE updated_at < ?")
    .bind(minUpdatedAt)
    .run();
  await db
    .prepare("DELETE FROM runtime_bootstrap_projection WHERE updated_at < ?")
    .bind(minUpdatedAt)
    .run();
  await db
    .prepare("DELETE FROM runtime_dashboard_projection WHERE updated_at < ?")
    .bind(minUpdatedAt)
    .run();

  runtimeProjectionCleanupState.set(db, { cleanedAt: now });
}

async function ensureRuntimeProjectionSchema(db: D1Database): Promise<void> {
  const now = Date.now();
  const cached = runtimeProjectionSchemaState.get(db);
  if (cached?.ready && now - cached.checkedAt < RUNTIME_PROJECTION_SCHEMA_TTL_MS) {
    await maybeCleanupRuntimeProjections(db, now);
    return;
  }

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS runtime_profile_projection (
        user_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS runtime_bootstrap_projection (
        user_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS runtime_dashboard_projection (
        user_id TEXT NOT NULL,
        projection_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, projection_key)
      )`,
    )
    .run();

  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_runtime_dashboard_projection_user_updated ON runtime_dashboard_projection(user_id, updated_at DESC)",
    )
    .run();

  runtimeProjectionSchemaState.set(db, { checkedAt: now, ready: true });
  await maybeCleanupRuntimeProjections(db, now);
}

function parseProjectionPayload<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readRuntimeProfileProjection<T>(
  db: D1Database,
  userId: string,
  maxAgeMs: number,
): Promise<T | null> {
  await ensureRuntimeProjectionSchema(db);
  const row = await db
    .prepare(
      `SELECT payload_json, updated_at
         FROM runtime_profile_projection
        WHERE user_id = ?`,
    )
    .bind(userId)
    .first<RuntimeProjectionRecord>();

  if (!row) return null;
  if (Date.now() - Number(row.updated_at ?? 0) > maxAgeMs) return null;

  const parsed = parseProjectionPayload<T>(row.payload_json);
  if (parsed !== null) return parsed;

  await db
    .prepare("DELETE FROM runtime_profile_projection WHERE user_id = ?")
    .bind(userId)
    .run()
    .catch(() => undefined);
  return null;
}

export async function upsertRuntimeProfileProjection<T>(
  db: D1Database,
  userId: string,
  payload: T,
): Promise<void> {
  await ensureRuntimeProjectionSchema(db);
  await db
    .prepare(
      `INSERT INTO runtime_profile_projection (user_id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, JSON.stringify(payload), Date.now())
    .run();
}

export async function deleteRuntimeProfileProjection(
  db: D1Database,
  userId: string,
): Promise<void> {
  await ensureRuntimeProjectionSchema(db);
  await db
    .prepare("DELETE FROM runtime_profile_projection WHERE user_id = ?")
    .bind(userId)
    .run();
}

export async function readRuntimeBootstrapProjection<T>(
  db: D1Database,
  userId: string,
  maxAgeMs: number,
): Promise<T | null> {
  await ensureRuntimeProjectionSchema(db);
  const row = await db
    .prepare(
      `SELECT payload_json, updated_at
         FROM runtime_bootstrap_projection
        WHERE user_id = ?`,
    )
    .bind(userId)
    .first<RuntimeProjectionRecord>();

  if (!row) return null;
  if (Date.now() - Number(row.updated_at ?? 0) > maxAgeMs) return null;

  const parsed = parseProjectionPayload<T>(row.payload_json);
  if (parsed !== null) return parsed;

  await db
    .prepare("DELETE FROM runtime_bootstrap_projection WHERE user_id = ?")
    .bind(userId)
    .run()
    .catch(() => undefined);
  return null;
}

export async function upsertRuntimeBootstrapProjection<T>(
  db: D1Database,
  userId: string,
  payload: T,
): Promise<void> {
  await ensureRuntimeProjectionSchema(db);
  await db
    .prepare(
      `INSERT INTO runtime_bootstrap_projection (user_id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, JSON.stringify(payload), Date.now())
    .run();
}

export async function deleteRuntimeBootstrapProjection(
  db: D1Database,
  userId: string,
): Promise<void> {
  await ensureRuntimeProjectionSchema(db);
  await db
    .prepare("DELETE FROM runtime_bootstrap_projection WHERE user_id = ?")
    .bind(userId)
    .run();
}

export async function readRuntimeDashboardProjection<T>(
  db: D1Database,
  userId: string,
  projectionKey: string,
  maxAgeMs: number,
): Promise<T | null> {
  await ensureRuntimeProjectionSchema(db);
  const row = await db
    .prepare(
      `SELECT payload_json, updated_at
         FROM runtime_dashboard_projection
        WHERE user_id = ?
          AND projection_key = ?`,
    )
    .bind(userId, projectionKey)
    .first<RuntimeProjectionRecord>();

  if (!row) return null;
  if (Date.now() - Number(row.updated_at ?? 0) > maxAgeMs) return null;

  const parsed = parseProjectionPayload<T>(row.payload_json);
  if (parsed !== null) return parsed;

  await db
    .prepare(
      `DELETE FROM runtime_dashboard_projection
        WHERE user_id = ?
          AND projection_key = ?`,
    )
    .bind(userId, projectionKey)
    .run()
    .catch(() => undefined);
  return null;
}

export async function upsertRuntimeDashboardProjection<T>(
  db: D1Database,
  userId: string,
  projectionKey: string,
  payload: T,
): Promise<void> {
  await ensureRuntimeProjectionSchema(db);
  await db
    .prepare(
      `INSERT INTO runtime_dashboard_projection (
        user_id,
        projection_key,
        payload_json,
        updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, projection_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at`,
    )
    .bind(userId, projectionKey, JSON.stringify(payload), Date.now())
    .run();
}

export async function deleteRuntimeDashboardProjection(
  db: D1Database,
  userId: string,
  projectionKey: string,
): Promise<void> {
  await ensureRuntimeProjectionSchema(db);
  await db
    .prepare(
      `DELETE FROM runtime_dashboard_projection
        WHERE user_id = ?
          AND projection_key = ?`,
    )
    .bind(userId, projectionKey)
    .run();
}

export async function deleteRuntimeUserProjections(
  db: D1Database,
  userId: string,
): Promise<void> {
  await ensureRuntimeProjectionSchema(db);
  await db
    .prepare("DELETE FROM runtime_profile_projection WHERE user_id = ?")
    .bind(userId)
    .run();
  await db
    .prepare("DELETE FROM runtime_bootstrap_projection WHERE user_id = ?")
    .bind(userId)
    .run();
  await db
    .prepare("DELETE FROM runtime_dashboard_projection WHERE user_id = ?")
    .bind(userId)
    .run();
}
