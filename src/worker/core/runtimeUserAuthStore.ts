import type {
  PlanId,
  PlanStatus,
  UserAuthRecord,
  UserPaymentMethod,
} from "./types";

const RUNTIME_USER_AUTH_SCHEMA_TTL_MS = 60_000;
const runtimeUserAuthSchemaState = new WeakMap<
  D1Database,
  { checkedAt: number; ready: boolean }
>();

type RuntimeUserAuthRow = {
  user_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  onboarding_completed: number | null;
  plan_id: string | null;
  plan_status: string | null;
  payment_method: string | null;
  updated_at: string | null;
};

function normalizePlanId(value: string | null): PlanId {
  if (value === "vip") return "vip";
  if (value === "pro" || value === "annual" || value === "basic") return value;
  return "basic";
}

function normalizePlanStatus(value: string | null): PlanStatus {
  if (
    value === "pending" ||
    value === "active" ||
    value === "cancelled" ||
    value === "failed" ||
    value === "expired"
  ) {
    return value;
  }
  return "failed";
}

function normalizePaymentMethod(value: string | null): UserPaymentMethod {
  if (value === "card" || value === "pix" || value === "none") {
    return value;
  }
  return "none";
}

async function ensureRuntimeUserAuthSchema(db: D1Database): Promise<void> {
  const now = Date.now();
  const cached = runtimeUserAuthSchemaState.get(db);
  if (cached?.ready && now - cached.checkedAt < RUNTIME_USER_AUTH_SCHEMA_TTL_MS) {
    return;
  }

  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS runtime_user_auth_cache (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, avatar_url TEXT, onboarding_completed INTEGER NOT NULL DEFAULT 0, plan_id TEXT NOT NULL DEFAULT 'basic', plan_status TEXT NOT NULL DEFAULT 'failed', payment_method TEXT NOT NULL DEFAULT 'none', updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    )
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_updated_at ON runtime_user_auth_cache(updated_at)",
    )
    .run();

  runtimeUserAuthSchemaState.set(db, { checkedAt: now, ready: true });
}

export async function readRuntimeUserAuth(
  db: D1Database,
  userId: string,
  options: {
    maxAgeMs?: number;
  } = {},
): Promise<UserAuthRecord | null> {
  await ensureRuntimeUserAuthSchema(db);
  const row = await db
    .prepare(
      `SELECT
        user_id,
        email,
        name,
        avatar_url,
        onboarding_completed,
        plan_id,
        plan_status,
        payment_method,
        updated_at
      FROM runtime_user_auth_cache
      WHERE user_id = ?`,
    )
    .bind(userId)
    .first<RuntimeUserAuthRow>();

  if (!row) return null;
  if (typeof options.maxAgeMs === "number" && Number.isFinite(options.maxAgeMs)) {
    const ageMs = Date.now() - Date.parse(row.updated_at ?? "");
    if (Number.isFinite(ageMs) && ageMs > options.maxAgeMs) {
      return null;
    }
  }

  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    avatar_url: row.avatar_url ?? null,
    onboarding_completed: Number(row.onboarding_completed) === 1 ? 1 : 0,
    plan_id: normalizePlanId(row.plan_id),
    plan_status: normalizePlanStatus(row.plan_status),
    payment_method: normalizePaymentMethod(row.payment_method),
  };
}

export async function upsertRuntimeUserAuth(
  db: D1Database,
  user: UserAuthRecord,
): Promise<void> {
  await ensureRuntimeUserAuthSchema(db);
  await db
    .prepare(
      `INSERT INTO runtime_user_auth_cache (
        user_id,
        email,
        name,
        avatar_url,
        onboarding_completed,
        plan_id,
        plan_status,
        payment_method,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        name = excluded.name,
        avatar_url = excluded.avatar_url,
        onboarding_completed = excluded.onboarding_completed,
        plan_id = excluded.plan_id,
        plan_status = excluded.plan_status,
        payment_method = excluded.payment_method,
        updated_at = datetime('now')`,
    )
    .bind(
      user.id,
      user.email,
      user.name,
      user.avatar_url ?? null,
      Number(user.onboarding_completed) === 1 ? 1 : 0,
      user.plan_id,
      user.plan_status,
      user.payment_method,
    )
    .run();
}

export async function deleteRuntimeUserAuth(
  db: D1Database,
  userId: string,
): Promise<void> {
  await ensureRuntimeUserAuthSchema(db);
  await db
    .prepare("DELETE FROM runtime_user_auth_cache WHERE user_id = ?")
    .bind(userId)
    .run();
}
