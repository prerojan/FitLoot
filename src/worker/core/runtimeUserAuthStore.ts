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
  username: string | null;
  name: string;
  avatar_url: string | null;
  onboarding_completed: number | null;
  plan_id: string | null;
  plan_status: string | null;
  payment_method: string | null;
  updated_at: string | null;
};

export type RuntimeUserAvailabilityMatch = UserAuthRecord & {
  username: string | null;
};

export type RuntimeUserAvailabilityLookup = {
  email: RuntimeUserAvailabilityMatch | null;
  username: RuntimeUserAvailabilityMatch | null;
};

type RuntimeUserAuthUpsertOptions = {
  username?: string | null | undefined;
};

type AvailabilityLookupInput = {
  emailLower?: string | null | undefined;
  usernameLower?: string | null | undefined;
};

type AvailabilityLookupQuery = {
  emailLower: string;
  usernameLower: string;
  clauses: string[];
  params: string[];
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

function normalizeUsername(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildAvailabilityLookupQuery(
  lookup: AvailabilityLookupInput,
  clausesByField: {
    email: string;
    username: string;
  },
): AvailabilityLookupQuery {
  const emailLower = String(lookup.emailLower ?? "").trim().toLowerCase();
  const usernameLower = String(lookup.usernameLower ?? "").trim().toLowerCase();
  const clauses: string[] = [];
  const params: string[] = [];

  if (emailLower) {
    clauses.push(clausesByField.email);
    params.push(emailLower);
  }
  if (usernameLower) {
    clauses.push(clausesByField.username);
    params.push(usernameLower);
  }

  return {
    emailLower,
    usernameLower,
    clauses,
    params,
  };
}

function toUserAuthRecord(row: RuntimeUserAuthRow): UserAuthRecord {
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

function toAvailabilityMatch(row: RuntimeUserAuthRow): RuntimeUserAvailabilityMatch {
  return {
    ...toUserAuthRecord(row),
    username: normalizeUsername(row.username),
  };
}

async function ensureRuntimeUserAuthSchema(db: D1Database): Promise<void> {
  const now = Date.now();
  const cached = runtimeUserAuthSchemaState.get(db);
  if (cached?.ready && now - cached.checkedAt < RUNTIME_USER_AUTH_SCHEMA_TTL_MS) {
    return;
  }

  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS runtime_user_auth_cache (user_id TEXT PRIMARY KEY, email TEXT NOT NULL, username TEXT, name TEXT NOT NULL, avatar_url TEXT, onboarding_completed INTEGER NOT NULL DEFAULT 0, plan_id TEXT NOT NULL DEFAULT 'basic', plan_status TEXT NOT NULL DEFAULT 'failed', payment_method TEXT NOT NULL DEFAULT 'none', updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    )
    .run();

  const columns = await db
    .prepare("PRAGMA table_info('runtime_user_auth_cache')")
    .all<{ name: string | null }>();
  const hasUsernameColumn = (columns.results ?? []).some(
    (column) => String(column.name ?? "").toLowerCase() === "username",
  );
  if (!hasUsernameColumn) {
    await db
      .prepare("ALTER TABLE runtime_user_auth_cache ADD COLUMN username TEXT")
      .run()
      .catch(() => undefined);
  }

  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_updated_at ON runtime_user_auth_cache(updated_at)",
    )
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_email_lower ON runtime_user_auth_cache(lower(email))",
    )
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_username_lower ON runtime_user_auth_cache(lower(username))",
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
        username,
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

  return toUserAuthRecord(row);
}

export async function readRuntimeUserAuthAvailability(
  db: D1Database,
  lookup: AvailabilityLookupInput,
): Promise<RuntimeUserAvailabilityLookup> {
  await ensureRuntimeUserAuthSchema(db);
  const { emailLower, usernameLower, clauses, params } =
    buildAvailabilityLookupQuery(lookup, {
      email: "lower(email) = ?",
      username: "lower(username) = ?",
    });

  if (clauses.length === 0) {
    return {
      email: null,
      username: null,
    };
  }

  const rows = await db
    .prepare(
      `SELECT
        user_id,
        email,
        username,
        name,
        avatar_url,
        onboarding_completed,
        plan_id,
        plan_status,
        payment_method,
        updated_at
      FROM runtime_user_auth_cache
      WHERE ${clauses.join(" OR ")}`,
    )
    .bind(...params)
    .all<RuntimeUserAuthRow>();

  let emailMatch: RuntimeUserAvailabilityMatch | null = null;
  let usernameMatch: RuntimeUserAvailabilityMatch | null = null;

  for (const row of rows.results ?? []) {
    if (!emailMatch && emailLower && row.email.trim().toLowerCase() === emailLower) {
      emailMatch = toAvailabilityMatch(row);
    }
    if (
      !usernameMatch &&
      usernameLower &&
      String(row.username ?? "").trim().toLowerCase() === usernameLower
    ) {
      usernameMatch = toAvailabilityMatch(row);
    }
  }

  return {
    email: emailMatch,
    username: usernameMatch,
  };
}

export async function upsertRuntimeUserAuth(
  db: D1Database,
  user: UserAuthRecord,
  options: RuntimeUserAuthUpsertOptions = {},
): Promise<void> {
  await ensureRuntimeUserAuthSchema(db);
  await db
    .prepare(
      `INSERT INTO runtime_user_auth_cache (
        user_id,
        email,
        username,
        name,
        avatar_url,
        onboarding_completed,
        plan_id,
        plan_status,
        payment_method,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        username = COALESCE(excluded.username, runtime_user_auth_cache.username),
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
      normalizeUsername(options.username),
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
