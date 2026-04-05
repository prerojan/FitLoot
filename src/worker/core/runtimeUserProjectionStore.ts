import {
  ensureRuntimeSchemaReady,
  runRuntimeCleanupThrottled,
} from "./runtimeSchemaCoordinator";

type RuntimeProjectionRecord = {
  payload_json: string;
  updated_at: number;
};

export type RuntimeProjectionScope =
  | "bootstrap"
  | "profile"
  | `dashboard:${string}`;

const RUNTIME_PROJECTION_CLEANUP_INTERVAL_MS = 60_000;
const RUNTIME_PROJECTION_RETENTION_MS = 24 * 60 * 60 * 1000;
const RUNTIME_PROJECTION_SCHEMA_KEY = "runtime_user_projection";
const RUNTIME_PROJECTION_CLEANUP_KEY = "runtime_user_projection:cleanup";

async function maybeCleanupRuntimeProjections(db: D1Database, now: number): Promise<void> {
  await runRuntimeCleanupThrottled(
    db,
    RUNTIME_PROJECTION_CLEANUP_KEY,
    RUNTIME_PROJECTION_CLEANUP_INTERVAL_MS,
    async () => {
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
    },
    now,
  );
}

async function ensureRuntimeProjectionSchema(db: D1Database): Promise<void> {
  await ensureRuntimeSchemaReady(db, RUNTIME_PROJECTION_SCHEMA_KEY, async () => {
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
  });
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
  await maybeCleanupRuntimeProjections(db, Date.now());
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
  await maybeCleanupRuntimeProjections(db, Date.now());
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
  await maybeCleanupRuntimeProjections(db, Date.now());
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
  await maybeCleanupRuntimeProjections(db, Date.now());
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
  await maybeCleanupRuntimeProjections(db, Date.now());
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
  await maybeCleanupRuntimeProjections(db, Date.now());
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
  await maybeCleanupRuntimeProjections(db, Date.now());
}

export async function deleteRuntimeUserProjectionScopes(
  db: D1Database,
  userId: string,
  scopes: readonly RuntimeProjectionScope[],
): Promise<void> {
  const normalizedScopes = [...new Set(scopes)];
  if (normalizedScopes.length === 0) {
    return;
  }

  await ensureRuntimeProjectionSchema(db);

  if (normalizedScopes.includes("profile")) {
    await db
      .prepare("DELETE FROM runtime_profile_projection WHERE user_id = ?")
      .bind(userId)
      .run();
  }

  if (normalizedScopes.includes("bootstrap")) {
    await db
      .prepare("DELETE FROM runtime_bootstrap_projection WHERE user_id = ?")
      .bind(userId)
      .run();
  }

  const dashboardKeys = normalizedScopes
    .filter((scope): scope is `dashboard:${string}` => scope.startsWith("dashboard:"))
    .map((scope) => scope.slice("dashboard:".length))
    .filter((key) => key.length > 0);

  if (dashboardKeys.length > 0) {
    const placeholders = dashboardKeys.map(() => "?").join(", ");
    await db
      .prepare(
        `DELETE FROM runtime_dashboard_projection
          WHERE user_id = ?
            AND projection_key IN (${placeholders})`,
      )
      .bind(userId, ...dashboardKeys)
      .run();
  }

  await maybeCleanupRuntimeProjections(db, Date.now());
}
