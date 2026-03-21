import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  OnboardingRequestSchema,
  CheckoutStartRequestSchema,
  CompleteMissionRequestSchema,
  FoodScanRequestSchema,
  UpdateDailyMetricsRequestSchema,
  MiniGameChallengeRequestSchema,
  MiniGameCompleteRequestSchema,
  AiChatRequestSchema,
  AiAnalyzeFoodRequestSchema,
  AuthRegisterRequestSchema,
  LoginRequestSchema,
  PromoCodeRequestSchema,
  UserPlanRequestSchema,
  UpdateMeRequestSchema,
  ConditioningLevel,
  MissionMetricType,
  CircuitTask,
  type PromoCodeEffect,
  type UserProgression,
} from "../shared/types";
import {
  repairKnownMojibake,
  repairKnownMojibakeString,
} from "../shared/textEncoding";
import {
  buildMissionDisplayGoalFromTasks,
  inferMissionVisualTarget,
  localizeMissionText,
  localizeMissionTextArray,
  normalizeMissionMediaUrl,
} from "../shared/missionLocalization";
import {
  MISSION_LIMITS,
  classifyMission,
  formatMissionGoal,
  getMissionMetricType,
  metricUnitByType,
  shouldShowMissionDuration,
} from "../constants/missionMetrics";
import { assertString, safeGet } from "../utils/typeHelpers";
import { toStatusCode } from "./httpHelpers";
import { processDailyResetForAllUsers } from "./services/dailyReset";
import {
  buildTrackedCheckoutUrl,
  fetchCaktoOrderById,
  fetchLatestCaktoOrderByCustomer,
  parseCaktoWebhookPayload,
  resolveWebhookSecret,
  type CaktoOrderSnapshot,
  type CaktoPlanCatalog,
} from "./services/cakto";
import { enrichExercise, searchExerciseDB, type EnrichedExercise } from "./services/exerciseEnrichment";

// Tipo do usuÃƒÂ¡rio autenticado
interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | undefined;
  onboarding_completed: number;
  plan_id: PlanId;
  plan_status: PlanStatus;
  payment_method: UserPaymentMethod;
}

// Context type para Hono
type AppContext = {
  Bindings: Env;
  Variables: {
    user: AuthUser;
  };
};

type PublicPlanId = "basic" | "pro" | "annual";
type PlanId = PublicPlanId | "vip";
type PlanStatus = "pending" | "active" | "cancelled" | "failed" | "expired";
type CheckoutPaymentMethod = "card" | "pix";
type UserPaymentMethod = CheckoutPaymentMethod | "none";

const CHECKOUT_PLAN_CATALOG: Record<
  PublicPlanId,
  {
    name: "basic" | "premium" | "elite";
    amount: number;
    checkout_url: string;
    product_id: string;
  }
> = {
  basic: {
    name: "basic",
    amount: 4900,
    checkout_url: "https://pay.cakto.com.br/gwr6dcu",
    product_id: "800215",
  },
  pro: {
    name: "premium",
    amount: 9900,
    checkout_url: "https://pay.cakto.com.br/m955o3f",
    product_id: "800252",
  },
  annual: {
    name: "elite",
    amount: 14900,
    checkout_url: "https://pay.cakto.com.br/k9c5935",
    product_id: "800255",
  },
};

const CAKTO_PLAN_CATALOG: CaktoPlanCatalog = {
  basic: {
    productId: CHECKOUT_PLAN_CATALOG.basic.product_id,
    checkoutUrl: CHECKOUT_PLAN_CATALOG.basic.checkout_url,
  },
  pro: {
    productId: CHECKOUT_PLAN_CATALOG.pro.product_id,
    checkoutUrl: CHECKOUT_PLAN_CATALOG.pro.checkout_url,
  },
  annual: {
    productId: CHECKOUT_PLAN_CATALOG.annual.product_id,
    checkoutUrl: CHECKOUT_PLAN_CATALOG.annual.checkout_url,
  },
};

const USER_PURGE_TARGETS: ReadonlyArray<{ table: string; columns: ReadonlyArray<string> }> = [
  { table: "sessions", columns: ["user_id"] },
  { table: "subscriptions", columns: ["user_id"] },
  { table: "cakto_webhook_events", columns: ["identified_user_id"] },
  { table: "user_profiles", columns: ["user_id"] },
  { table: "user_attributes", columns: ["user_id"] },
  { table: "user_progression", columns: ["user_id"] },
  { table: "user_skills", columns: ["user_id"] },
  { table: "missions", columns: ["user_id"] },
  { table: "user_achievements", columns: ["user_id"] },
  { table: "user_titles", columns: ["user_id"] },
  { table: "friendships", columns: ["user_id", "friend_user_id", "friend_id"] },
  { table: "friend_requests", columns: ["from_user_id", "to_user_id"] },
  { table: "coupon_orders", columns: ["user_id"] },
  { table: "food_diary", columns: ["user_id"] },
  { table: "daily_metrics", columns: ["user_id"] },
  { table: "mini_games", columns: ["challenger_user_id", "challenged_user_id", "winner_user_id"] },
  { table: "user_training_plans", columns: ["user_id"] },
  { table: "user_event_counters", columns: ["user_id"] },
  { table: "user_event_log", columns: ["user_id"] },
  { table: "user_goal_stats", columns: ["user_id"] },
  { table: "user_monthly_counters", columns: ["user_id"] },
  { table: "users", columns: ["id"] },
];

const PLAN_GUARD_EXEMPT_PATHS = new Set<string>([
  "/api/users/me",
  "/api/app/open",
  "/api/events/route-not-found",
  "/api/onboarding",
  "/api/checkout/start",
  "/api/promo/apply",
  "/api/subscription/status",
]);

const WEBHOOK_SUPPORTED_EVENTS = new Set<string>([
  "purchase_approved",
  "purchase_refused",
  "subscription_created",
  "subscription_renewed",
  "subscription_canceled",
  "checkout_abandonment",
]);


let cachedSchemaState: { ready: boolean; checkedAt: number } | null = null;
let catalogInitCheckedAt = 0;
let catalogInitPromise: Promise<void> | null = null;
const STREAK_REFRESH_DEBOUNCE_MS = 60_000;
const STREAK_REFRESH_MAX_KEYS = 4_000;
/** SQLite datetime() modifier: missões settled saem da DB pouco após ficarem finalizadas (UX após abrir o site). */
const SETTLED_MISSION_MAX_AGE_SQL_MODIFIER = "-2 minutes";
const streakRefreshLocks = new Map<string, Promise<void>>();
const streakRefreshLastRun = new Map<string, number>();
const SCHEMA_CACHE_TTL_MS = 10_000;
const CATALOG_CACHE_TTL_MS = 60_000;
const TABLE_COLUMN_CACHE_TTL_MS = 60_000;
const tableColumnCache = new Map<string, { checkedAt: number; columns: Set<string> }>();

async function hasCoreSchema(db: D1Database) {
  const now = Date.now();
  if (cachedSchemaState && now - cachedSchemaState.checkedAt < SCHEMA_CACHE_TTL_MS) {
    return cachedSchemaState.ready;
  }

  try {
    const result = await db.prepare(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name IN ('users', 'sessions')`
    ).first<{ count: number }>();

    const ready = Number(result?.count ?? 0) >= 2;
    cachedSchemaState = { ready, checkedAt: now };
    return ready;
  } catch (error) {
    console.error('[schema-check]', error);
    cachedSchemaState = { ready: false, checkedAt: now };
    return false;
  }
}

function databaseNotInitializedResponse(c: import("hono").Context<AppContext>) {
  return c.json(
    {
      error: 'Banco local nÃƒÂ£o inicializado. Execute as migrations D1 antes de usar a API.',
      code: 'DB_NOT_INITIALIZED',
    },
    503
  );
}

async function ensureCatalogReady(db: D1Database) {
  const now = Date.now();
  if (now - catalogInitCheckedAt < CATALOG_CACHE_TTL_MS) return;

  if (catalogInitPromise) {
    await catalogInitPromise;
    return;
  }

  const initPromise = (async () => {
    await ensureGamificationCatalog(db);
    catalogInitCheckedAt = Date.now();
  })();

  catalogInitPromise = initPromise;
  try {
    await initPromise;
  } finally {
    catalogInitPromise = null;
  }
}

function cleanupStreakRefreshTracking(): void {
  if (streakRefreshLastRun.size <= STREAK_REFRESH_MAX_KEYS) return;
  const overflow = streakRefreshLastRun.size - STREAK_REFRESH_MAX_KEYS;
  const iterator = streakRefreshLastRun.keys();
  for (let index = 0; index < overflow; index += 1) {
    const keyToDelete = iterator.next().value;
    if (typeof keyToDelete === "string") {
      streakRefreshLastRun.delete(keyToDelete);
    }
  }
}

async function refreshMissionExpiryWithGuard(db: D1Database, userId: string): Promise<void> {
  const now = Date.now();
  cleanupStreakRefreshTracking();
  const lastRun = streakRefreshLastRun.get(userId) ?? 0;
  if (now - lastRun < STREAK_REFRESH_DEBOUNCE_MS) return;

  const inflight = streakRefreshLocks.get(userId);
  if (inflight) {
    await inflight;
    return;
  }

  const refreshPromise = (async () => {
    try {
      await expirePendingMissionsAndUpdateStreak(db, userId);
      streakRefreshLastRun.set(userId, Date.now());
    } finally {
      streakRefreshLocks.delete(userId);
    }
  })();

  streakRefreshLocks.set(userId, refreshPromise);
  await refreshPromise;
}

// Middleware de autenticaÃƒÂ§ÃƒÂ£o prÃƒÂ³prio
function parseCookieHeader(cookieHeader: string | undefined) {
  if (!cookieHeader) return new Map<string, string>();

  const pairs = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) return null;
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!key) return null;
      return [key, value] as const;
    })
    .filter((pair): pair is readonly [string, string] => pair !== null);

  return new Map<string, string>(pairs);
}

function getSessionIdFromCookieHeader(cookieHeader: string | undefined) {
  const sessionCookie = parseCookieHeader(cookieHeader).get("session_id");
  if (!sessionCookie) return null;

  try {
    return decodeURIComponent(sessionCookie);
  } catch {
    return sessionCookie;
  }
}

type UserAuthRecord = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  onboarding_completed: number;
  plan_id: PlanId;
  plan_status: PlanStatus;
  payment_method: UserPaymentMethod;
};

type SubscriptionRecord = {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  payment_method: string;
  amount: number;
  external_order_id: string | null;
  external_subscription_id: string | null;
  customer_email: string | null;
  checkout_url: string | null;
  product_id: string | null;
  started_at: string | null;
  expires_at: string | null;
  metadata_json: string | null;
  webhook_event_log: string | null;
  created_at: string;
  updated_at: string;
};

type SubscriptionEventLogEntry = {
  type: string;
  received_at: string;
  source: "checkout" | "webhook";
  status: PlanStatus;
};

type SubscriptionMetadata = {
  customer_name?: string | undefined;
  external_status?: string | undefined;
  failure_reason?: string | undefined;
  last_event_id?: string | undefined;
  last_event_type?: string | undefined;
  checkout_tracking_id?: string | undefined;
  checkout_tracking_user_id?: string | undefined;
  checkout_tracking_plan_id?: PublicPlanId | undefined;
  promo_code?: string | undefined;
  promo_description?: string | undefined;
  promo_effect?: PromoCodeEffect | undefined;
  promo_effect_value?: string | undefined;
};

type PromoCodeRecord = {
  id: number;
  code: string;
  description: string;
  effect: string;
  effect_value: string | null;
  max_uses: number | null;
  uses_count: number;
  active: number;
  expires_at: string | null;
  created_at: string;
};

type PromoCodeUsageRecord = {
  id: number;
  promo_code_id: number;
  user_id: string;
  subscription_id: string | null;
  applied_effect: string;
  applied_value: string | null;
  created_at: string;
  updated_at: string;
};

type PromoValidationSuccess = {
  promoCodeId: number;
  code: string;
  description: string;
  effect: PromoCodeEffect;
  effectValue: string | null;
};

type PromoApplyResult = {
  applied: boolean;
  already_used: boolean;
  promo_code_id: number;
  code: string;
  description: string;
  effect: PromoCodeEffect;
  effect_value: string | null;
  vip_activated: boolean;
  message: string;
  subscription_id?: string | undefined;
  plan_id?: PlanId | undefined;
  plan_status?: PlanStatus | undefined;
  payment_method?: UserPaymentMethod | undefined;
};

type CaktoWebhookEventStatus = "received" | "processing" | "processed" | "ignored" | "failed";

type CheckoutStartResult = {
  checkout_status: "pending" | "vip_active";
  plan_id: PlanId;
  plan_status: PlanStatus;
  payment_method: UserPaymentMethod;
  amount: number;
  checkout_url: string | null;
  product_id: string | null;
  subscription_id: string;
  message: string;
};

function isPublicPlanId(value: string): value is PublicPlanId {
  return value === "basic" || value === "pro" || value === "annual";
}

function isPlanStatus(value: string): value is PlanStatus {
  return value === "pending" || value === "active" || value === "cancelled" || value === "failed" || value === "expired";
}

function isCheckoutPaymentMethod(value: string): value is CheckoutPaymentMethod {
  return value === "card" || value === "pix";
}

function isUserPaymentMethod(value: string): value is UserPaymentMethod {
  return value === "none" || isCheckoutPaymentMethod(value);
}

function isPromoCodeEffect(value: string): value is PromoCodeEffect {
  return value === "activate_vip"
    || value === "discount_percent"
    || value === "discount_fixed"
    || value === "free_months"
    || value === "unlock_feature";
}

function normalizePlanId(value: string | null | undefined): PlanId {
  if (value === "vip") return "vip";
  if (typeof value === "string" && isPublicPlanId(value)) return value;
  if (typeof value === "string" && value.trim().toLowerCase() === "free") return "basic";
  return "basic";
}

function normalizePlanStatus(value: string | null | undefined): PlanStatus {
  if (typeof value === "string" && isPlanStatus(value)) return value;
  return "failed";
}

function normalizeUserPaymentMethod(value: string | null | undefined): UserPaymentMethod {
  if (typeof value === "string" && isUserPaymentMethod(value)) return value;
  return "none";
}

function hasPlanAccess(planId: PlanId, planStatus: PlanStatus): boolean {
  return planId === "vip" || planStatus === "active";
}

function shouldBypassPlanGuard(path: string): boolean {
  return PLAN_GUARD_EXEMPT_PATHS.has(path);
}

function resolvePlanRedirectPath(onboardingCompleted: number, planStatus: PlanStatus): "/checkout" | "/payment/pending" {
  if (Number(onboardingCompleted) !== 1) return "/checkout";
  return planStatus === "pending" ? "/payment/pending" : "/checkout";
}

function shouldPurgeUserOnLogout(user: UserAuthRecord): boolean {
  return Number(user.onboarding_completed) !== 1 || !hasPlanAccess(user.plan_id, user.plan_status);
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  return null;
}

function normalizePromoCodeValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePromoCodeExpiryTimestamp(value: string | null): number | null {
  if (!value) return null;
  const normalizedValue = /[zZ]|[+-]\d{2}:\d{2}$/.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalizedValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPromoCodeCurrentlyAvailable(record: PromoCodeRecord): boolean {
  if (Number(record.active) !== 1) {
    return false;
  }

  const expiresAt = parsePromoCodeExpiryTimestamp(record.expires_at);
  if (record.expires_at && expiresAt !== null && expiresAt <= Date.now()) {
    return false;
  }

  if (record.expires_at && expiresAt === null) {
    return false;
  }

  return record.max_uses === null || Number(record.uses_count) < Number(record.max_uses);
}

function toPromoValidationSuccess(record: PromoCodeRecord): PromoValidationSuccess | null {
  if (!isPromoCodeEffect(record.effect)) {
    return null;
  }

  return {
    promoCodeId: Number(record.id),
    code: record.code,
    description: record.description,
    effect: record.effect,
    effectValue: record.effect_value,
  };
}

function matchesVipActivationCode(env: Env, code: string): boolean {
  const configuredCode = normalizePromoCodeValue(env.VIP_ACTIVATION_CODE);
  if (!configuredCode) return true;
  return configuredCode.toUpperCase() === code.toUpperCase();
}

async function getPromoCodeByCode(db: D1Database, code: string): Promise<PromoCodeRecord | null> {
  return db
    .prepare(
      `SELECT
        id,
        code,
        description,
        effect,
        effect_value,
        max_uses,
        uses_count,
        active,
        expires_at,
        created_at
      FROM promo_codes
      WHERE UPPER(code) = UPPER(?)
      LIMIT 1`
    )
    .bind(code)
    .first<PromoCodeRecord>();
}

async function validatePromoCodeRecord(db: D1Database, code: string): Promise<PromoValidationSuccess | null> {
  const normalizedCode = normalizePromoCodeValue(code);
  if (!normalizedCode) return null;

  const promoCodeRecord = await getPromoCodeByCode(db, normalizedCode);
  if (!promoCodeRecord || !isPromoCodeCurrentlyAvailable(promoCodeRecord)) {
    return null;
  }

  return toPromoValidationSuccess(promoCodeRecord);
}

async function getPromoCodeUsageByUser(
  db: D1Database,
  promoCodeId: number,
  userId: string,
): Promise<PromoCodeUsageRecord | null> {
  return db
    .prepare(
      `SELECT
        id,
        promo_code_id,
        user_id,
        subscription_id,
        applied_effect,
        applied_value,
        created_at,
        updated_at
      FROM promo_code_usages
      WHERE promo_code_id = ? AND user_id = ?
      LIMIT 1`
    )
    .bind(promoCodeId, userId)
    .first<PromoCodeUsageRecord>();
}

async function incrementPromoCodeUsesCount(db: D1Database, promoCodeId: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE promo_codes
      SET uses_count = uses_count + 1
      WHERE id = ?
        AND active = 1
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
        AND (max_uses IS NULL OR uses_count < max_uses)`
  ).bind(promoCodeId).run();

  return Number(result.meta.changes ?? 0) > 0;
}

async function createPromoCodeUsage(
  db: D1Database,
  params: {
    promoCodeId: number;
    userId: string;
    effect: PromoCodeEffect;
    effectValue: string | null;
    subscriptionId?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO promo_code_usages (
      promo_code_id,
      user_id,
      subscription_id,
      applied_effect,
      applied_value,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(
    params.promoCodeId,
    params.userId,
    params.subscriptionId ?? null,
    params.effect,
    params.effectValue,
  ).run();
}

async function attachPromoCodeUsageToSubscription(
  db: D1Database,
  promoCodeId: number,
  userId: string,
  subscriptionId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE promo_code_usages
      SET subscription_id = COALESCE(subscription_id, ?),
          updated_at = datetime('now')
      WHERE promo_code_id = ? AND user_id = ?`
  ).bind(subscriptionId, promoCodeId, userId).run();
}

async function applyPromoCodeForUser(
  db: D1Database,
  env: Env,
  params: {
    userId: string;
    code: string;
    markOnboardingCompleted?: boolean;
  },
): Promise<PromoApplyResult | null> {
  const normalizedCode = normalizePromoCodeValue(params.code);
  if (!normalizedCode) {
    return null;
  }

  const promoValidation = await validatePromoCodeRecord(db, normalizedCode);
  if (!promoValidation) {
    return null;
  }

  if (promoValidation.effect === "activate_vip" && !matchesVipActivationCode(env, normalizedCode)) {
    return null;
  }

  const existingUsage = await getPromoCodeUsageByUser(db, promoValidation.promoCodeId, params.userId);
  const alreadyUsed = Boolean(existingUsage);

  if (!alreadyUsed) {
    const incremented = await incrementPromoCodeUsesCount(db, promoValidation.promoCodeId);
    if (!incremented) {
      return null;
    }

    await createPromoCodeUsage(db, {
      promoCodeId: promoValidation.promoCodeId,
      userId: params.userId,
      effect: promoValidation.effect,
      effectValue: promoValidation.effectValue,
    });
  }

  if (promoValidation.effect === "activate_vip") {
    const existingVipSubscription =
      alreadyUsed && existingUsage?.subscription_id
        ? await getSubscriptionById(db, existingUsage.subscription_id)
        : null;
    const vipSubscription = existingVipSubscription ?? await ensureSubscriptionRecord(db, {
      id: crypto.randomUUID(),
      userId: params.userId,
      planId: "vip",
      status: "active",
      paymentMethod: "card",
      amount: 0,
      eventType: alreadyUsed ? "vip.activated.reused" : "vip.activated",
      source: "checkout",
      metadata: {
        promo_code: promoValidation.code,
        promo_description: promoValidation.description,
        promo_effect: promoValidation.effect,
        promo_effect_value: promoValidation.effectValue ?? undefined,
      },
    });

    if (!vipSubscription) {
      throw new Error("Failed to activate VIP promo code.");
    }

    if (!existingVipSubscription || !existingUsage?.subscription_id) {
      await attachPromoCodeUsageToSubscription(db, promoValidation.promoCodeId, params.userId, vipSubscription.id);
    }
    await updateUserPlanState(db, params.userId, {
      planId: "vip",
      status: "active",
      paymentMethod: "card",
      markOnboardingCompleted: true,
    });

    return {
      applied: true,
      already_used: alreadyUsed,
      promo_code_id: promoValidation.promoCodeId,
      code: promoValidation.code,
      description: promoValidation.description,
      effect: promoValidation.effect,
      effect_value: promoValidation.effectValue,
      vip_activated: true,
      message: "Plano VIP ativado com sucesso.",
      subscription_id: vipSubscription.id,
      plan_id: "vip",
      plan_status: "active",
      payment_method: "card",
    };
  }

  return {
    applied: true,
    already_used: alreadyUsed,
    promo_code_id: promoValidation.promoCodeId,
    code: promoValidation.code,
    description: promoValidation.description,
    effect: promoValidation.effect,
    effect_value: promoValidation.effectValue,
    vip_activated: false,
    message: "Código promocional aplicado ao checkout.",
  };
}

/**
 * D1 (Cloudflare) does not support interactive `BEGIN TRANSACTION` / `COMMIT` via `db.exec()`.
 * That call fails at runtime on Workers and breaks handlers such as `POST /api/missions/complete`.
 * D1 auto-commits each statement; for atomic multi-writes use {@link D1Database.batch}.
 * This helper only sequences the callback (same as most call sites previously intended).
 *
 * @see https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
 */
async function withTransaction<T>(_db: D1Database, run: () => Promise<T>): Promise<T> {
  return run();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePublicPlanIdFromValue(value: string | null | undefined): PublicPlanId | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "free" || normalized === "basic") return "basic";
  if (normalized === "pro" || normalized === "premium") return "pro";
  if (normalized === "annual" || normalized === "elite") return "annual";
  return null;
}

async function getTableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  const cacheKey = tableName.trim().toLowerCase();
  const now = Date.now();
  const cached = tableColumnCache.get(cacheKey);
  if (cached && now - cached.checkedAt < TABLE_COLUMN_CACHE_TTL_MS) {
    return cached.columns;
  }

  const info = await db.prepare(`PRAGMA table_info('${cacheKey}')`).all<{
    name: string | null;
  }>();
  const columns = new Set(
    (Array.isArray(info.results) ? info.results : [])
      .map((row) => (typeof row.name === "string" ? row.name.toLowerCase() : ""))
      .filter((value) => value.length > 0),
  );

  tableColumnCache.set(cacheKey, { checkedAt: now, columns });
  return columns;
}

async function hasTableColumn(db: D1Database, tableName: string, columnName: string): Promise<boolean> {
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

async function purgeUserAccountData(db: D1Database, userId: string): Promise<void> {
  for (const target of USER_PURGE_TARGETS) {
    await deleteUserDataByColumns(db, target.table, target.columns, userId);
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const INVALID_PROMO_CODE_ERROR = "PROMO_CODE_INVALID";

function createInvalidPromoCodeError(): Error {
  return new Error(INVALID_PROMO_CODE_ERROR);
}

function isInvalidPromoCodeError(error: unknown): boolean {
  return getErrorMessage(error) === INVALID_PROMO_CODE_ERROR;
}

function isMissingSchemaError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

function schemaMismatchResponse(c: import("hono").Context<AppContext>) {
  return c.json(
    {
      error: "Banco local desatualizado para esta funcionalidade.",
      code: "DB_SCHEMA_MISMATCH",
    },
    503
  );
}

function internalErrorResponse(c: import("hono").Context<AppContext>) {
  return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
}

async function getUserAuthRecordById(db: D1Database, userId: string): Promise<UserAuthRecord | null> {
  const [onboardingColumnExists, planIdColumnExists, planStatusColumnExists, paymentMethodColumnExists] = await Promise.all([
    hasTableColumn(db, "users", "onboarding_completed"),
    hasTableColumn(db, "users", "plan_id"),
    hasTableColumn(db, "users", "plan_status"),
    hasTableColumn(db, "users", "payment_method"),
  ]);

  const userRecord = await db
    .prepare(
      `SELECT
        id,
        email,
        name,
        avatar_url,
        ${onboardingColumnExists ? "COALESCE(onboarding_completed, 0)" : "0"} as onboarding_completed,
        ${planIdColumnExists ? "COALESCE(plan_id, 'basic')" : "'basic'"} as plan_id,
        ${planStatusColumnExists ? "COALESCE(plan_status, 'failed')" : "'failed'"} as plan_status,
        ${paymentMethodColumnExists ? "COALESCE(payment_method, 'none')" : "'none'"} as payment_method
      FROM users
      WHERE id = ?`
    )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      name: string;
      avatar_url: string | null;
      onboarding_completed: number;
      plan_id: string;
      plan_status: string;
      payment_method: string;
    }>();

  if (!userRecord) return null;

  return {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    avatar_url: userRecord.avatar_url,
    onboarding_completed: Number(userRecord.onboarding_completed) === 1 ? 1 : 0,
    plan_id: normalizePlanId(userRecord.plan_id),
    plan_status: normalizePlanStatus(userRecord.plan_status),
    payment_method: normalizeUserPaymentMethod(userRecord.payment_method),
  };
}

async function updateUserPlanState(
  db: D1Database,
  userId: string,
  params: {
    planId: PlanId;
    status: PlanStatus;
    paymentMethod: UserPaymentMethod;
    markOnboardingCompleted: boolean;
  },
): Promise<void> {
  const [planIdColumnExists, planStatusColumnExists, paymentMethodColumnExists, onboardingColumnExists] = await Promise.all([
    hasTableColumn(db, "users", "plan_id"),
    hasTableColumn(db, "users", "plan_status"),
    hasTableColumn(db, "users", "payment_method"),
    params.markOnboardingCompleted ? hasTableColumn(db, "users", "onboarding_completed") : Promise.resolve(false),
  ]);

  if (!planIdColumnExists || !planStatusColumnExists) {
    throw new Error("Users table is missing plan columns.");
  }

  const assignments = ["plan_id = ?", "plan_status = ?"];
  const values: Array<string> = [params.planId, params.status];

  if (paymentMethodColumnExists) {
    assignments.push("payment_method = ?");
    values.push(params.paymentMethod);
  }
  if (params.markOnboardingCompleted && onboardingColumnExists) {
    assignments.push("onboarding_completed = 1");
  }

  await db
    .prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values, userId)
    .run();
}

function scheduleCatalogInitialization(db: D1Database, executionCtx: ExecutionContext): void {
  const now = Date.now();
  if (now - catalogInitCheckedAt < CATALOG_CACHE_TTL_MS) return;
  if (catalogInitPromise) return;

  executionCtx.waitUntil(
    ensureCatalogReady(db).catch((error) => {
      console.error("[catalog][background-init]", {
        message: error instanceof Error ? error.message : String(error),
      });
    })
  );
}

async function authMiddleware(
  c: import("hono").Context<{ Bindings: Env; Variables: { user: AuthUser } }>,
  next: () => Promise<void>
) {
  const schemaReady = await hasCoreSchema(c.env.fitloot_db);
  if (!schemaReady) {
    return databaseNotInitializedResponse(c);
  }

  scheduleCatalogInitialization(c.env.fitloot_db, c.executionCtx);

  try {
    const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));

    if (!sessionId) {
      return c.json({ error: "Unauthorized", code: "SESSION_COOKIE_MISSING" }, 401);
    }

    const session = await c.env.fitloot_db
      .prepare('SELECT id, user_id FROM sessions WHERE id = ? AND expires_at > datetime("now")')
      .bind(sessionId)
      .first<{ id: string; user_id: string }>();

    if (!session) {
      return c.json({ error: "Unauthorized", code: "SESSION_INVALID" }, 401);
    }

    const userRecord = await getUserAuthRecordById(c.env.fitloot_db, session.user_id);

    if (!userRecord) {
      return c.json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado", code: "USER_NOT_FOUND" }, 404);
    }

    const hasUnlockedAccess =
      Number(userRecord.onboarding_completed) === 1 &&
      hasPlanAccess(userRecord.plan_id, userRecord.plan_status);

    if (!shouldBypassPlanGuard(c.req.path) && !hasUnlockedAccess) {
      const isPending = userRecord.plan_status === "pending";
      return c.json(
        {
          error: isPending
            ? "Pagamento em processamento. Aguarde a confirmação para liberar o acesso."
            : "Pagamento não aprovado. Atualize seu plano para liberar o acesso.",
          code: "PLAN_ACCESS_REQUIRED",
          plan_id: userRecord.plan_id,
          plan_status: userRecord.plan_status,
          payment_method: userRecord.payment_method,
          redirect_to: resolvePlanRedirectPath(userRecord.onboarding_completed, userRecord.plan_status),
        },
        402
      );
    }

    (c as import("hono").Context<AppContext>).set("user", {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      avatar_url: userRecord.avatar_url ?? undefined,
      onboarding_completed: userRecord.onboarding_completed,
      plan_id: userRecord.plan_id,
      plan_status: userRecord.plan_status,
      payment_method: userRecord.payment_method,
    });

    try {
      await cleanupSettledMissionsWithGuard(c.env.fitloot_db, userRecord.id);
    } catch (cleanupError) {
      console.error("[authMiddleware][cleanupSettledMissions]", {
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        userId: userRecord.id,
      });
    }

    try {
      await refreshMissionExpiryWithGuard(c.env.fitloot_db, userRecord.id);
    } catch (streakError) {
      console.error("[authMiddleware][refreshMissionExpiryWithGuard]", {
        message: streakError instanceof Error ? streakError.message : String(streakError),
        userId: userRecord.id,
      });
    }

    await next();
  } catch (error) {
    console.error("[authMiddleware]", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
  }
}

// ---------- ENV TYPES ----------
export interface Env {
  fitloot_db: D1Database;
  ASSETS: Fetcher;
  HF_TOKEN?: string | undefined;
  HUGGING_FACE_API_KEY?: string | undefined;
  USDA_API_KEY: string;
  RAPID_API_KEY?: string | undefined;
  RAPID_API_HOST?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  API_NINJAS_KEY?: string | undefined;
  GYMFIT_API_KEY?: string | undefined;
  FRONTEND_ORIGIN?: string | undefined;
  FRONTEND_ORIGINS?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  FEEDBACK_FROM_EMAIL?: string | undefined;
  VIP_ACTIVATION_CODE?: string | undefined;
  WEBHOOK_SECRET?: string | undefined;
  CAKTO_CLIENT_ID?: string | undefined;
  CAKTO_CLIENT_SECRET?: string | undefined;
  CAKTO_WEBHOOK_SECRET?: string | undefined;
}
// --------------------------------

function getHuggingFaceApiKey(env: Pick<Env, "HF_TOKEN" | "HUGGING_FACE_API_KEY">): string | null {
  const direct = typeof env.HUGGING_FACE_API_KEY === "string" ? env.HUGGING_FACE_API_KEY.trim() : "";
  if (direct.length > 0) return direct;

  const legacy = typeof env.HF_TOKEN === "string" ? env.HF_TOKEN.trim() : "";
  return legacy.length > 0 ? legacy : null;
}


const app = new Hono<AppContext>();

app.onError((error, c) => {
  console.error("[worker][unhandled]", {
    path: c.req.path,
    method: c.req.method,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
});
type SkillSeed = {
  name: string;
  category: string;
  difficulty: string;
  tier: "iniciante" | "intermediario" | "avancado" | "calistenico";
  requiredLevel: number;
  description: string;
  unlockMessage: string;
  prerequisites?: string[] | undefined;
  attributeRequirements?: Record<string, number>;
};

type SkillStageSeed = {
  skillName: string;
  stageNumber: number;
  name: string;
  description: string;
  levelRequired: number;
  exerciseReference: string;
};

const localExercisePool: ExerciseRef[] = [
  { name: "Push-up", muscle: "chest", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Air Squat", muscle: "legs", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Plank", muscle: "core", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Glute Bridge", muscle: "glutes", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Burpee", muscle: "full body", equipment: "bodyweight", difficulty: "intermediate" },
  { name: "Pike Push-up", muscle: "shoulders", equipment: "bodyweight", difficulty: "intermediate" },
  { name: "Lunge", muscle: "legs", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Superman Hold", muscle: "back", equipment: "bodyweight", difficulty: "beginner" },
];

const coreSkillSeeds: SkillSeed[] = [
  { name: "FlexÃƒÂ£o", category: "peito", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Empurrar horizontal com peso corporal", unlockMessage: "FlexÃƒÂ£o desbloqueada." },
  { name: "Agachamento", category: "pernas", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Base para forÃƒÂ§a de membros inferiores", unlockMessage: "Agachamento desbloqueado." },
  { name: "Abdominal", category: "core", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Fortalecimento de core", unlockMessage: "Abdominal desbloqueado." },
  { name: "Prancha", category: "core", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Isometria de core", unlockMessage: "Prancha desbloqueada." },
  { name: "Barra Fixa", category: "costas", difficulty: "intermediario", tier: "intermediario", requiredLevel: 5, description: "Puxada vertical", unlockMessage: "Barra fixa disponÃƒÂ­vel." },
  { name: "Dips", category: "triceps", difficulty: "intermediario", tier: "intermediario", requiredLevel: 7, description: "Empurrar em barras paralelas", unlockMessage: "Dips desbloqueado." },
  { name: "Handstand", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 6, description: "ProgressÃƒÂ£o de equilÃƒÂ­brio invertido", unlockMessage: "Inicie sua jornada no handstand.", prerequisites: ["Prancha"], attributeRequirements: { strength: 20, dexterity: 20 } },
  { name: "Front Lever", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 10, description: "Alavanca frontal", unlockMessage: "Front Lever desbloqueado.", prerequisites: ["Barra Fixa"], attributeRequirements: { strength: 30 } },
  { name: "Back Lever", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 10, description: "Alavanca posterior", unlockMessage: "Back Lever desbloqueado.", prerequisites: ["Barra Fixa"], attributeRequirements: { strength: 30 } },
  { name: "Planche", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 12, description: "SustentaÃƒÂ§ÃƒÂ£o horizontal", unlockMessage: "Planche desbloqueada.", prerequisites: ["Dips"], attributeRequirements: { strength: 38 } },
  { name: "Human Flag", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 14, description: "Bandeira humana", unlockMessage: "Human Flag desbloqueada.", attributeRequirements: { strength: 42, dexterity: 30 } },
  { name: "Muscle Up", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 11, description: "TransiÃƒÂ§ÃƒÂ£o de barra", unlockMessage: "Muscle Up desbloqueado.", prerequisites: ["Barra Fixa", "Dips"], attributeRequirements: { strength: 36 } },
  { name: "Pistol Squat", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 9, description: "Agachamento unilateral", unlockMessage: "Pistol Squat desbloqueado.", prerequisites: ["Agachamento"], attributeRequirements: { vitality: 28 } },
  { name: "Dragon Flag", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 13, description: "Core avanÃƒÂ§ado", unlockMessage: "Dragon Flag desbloqueada.", prerequisites: ["Abdominal"], attributeRequirements: { strength: 34, focus: 24 } },
  { name: "L-Sit", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 8, description: "SustentaÃƒÂ§ÃƒÂ£o em L", unlockMessage: "L-Sit desbloqueado.", prerequisites: ["Prancha"], attributeRequirements: { strength: 24, focus: 18 } },
  { name: "Crow Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 6, description: "EquilÃƒÂ­brio em braÃƒÂ§os", unlockMessage: "Crow Pose desbloqueada.", attributeRequirements: { focus: 18, dexterity: 18 } },
  { name: "Headstand", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 8, description: "Invertida na cabeÃƒÂ§a", unlockMessage: "Headstand desbloqueada.", attributeRequirements: { strength: 22, focus: 22 } },
  { name: "Wheel Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 9, description: "Ponte avanÃƒÂ§ada", unlockMessage: "Wheel Pose desbloqueada.", attributeRequirements: { vitality: 20 } },
  { name: "Firefly Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 11, description: "EquilÃƒÂ­brio avanÃƒÂ§ado", unlockMessage: "Firefly Pose desbloqueada.", attributeRequirements: { strength: 28, focus: 22 } },
  { name: "Eight Angle Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 12, description: "TorÃƒÂ§ÃƒÂ£o com braÃƒÂ§os", unlockMessage: "Eight Angle Pose desbloqueada.", attributeRequirements: { dexterity: 30, focus: 24 } },
  { name: "Scorpion Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 15, description: "Invertida avanÃƒÂ§ada", unlockMessage: "Scorpion Pose desbloqueada.", attributeRequirements: { strength: 35, dexterity: 32 } },
];

const stageProgressionSeed: SkillStageSeed[] = [
  ["Handstand", ["Quadruped Rocking", "Hollow Body", "Crow Pose", "Wall Walk", "How to Bail out of a Handstand", "Handstand completo"]],
  ["Front Lever", ["Scapula Pull", "Tuck Front Lever", "Advanced Tuck Lever", "One Leg Front Lever", "Straddle Front Lever", "Front Lever completo"]],
  ["Back Lever", ["Skin the Cat", "German Hang", "Tuck Back Lever", "Advanced Tuck Back Lever", "Straddle Back Lever", "Back Lever completo"]],
  ["Planche", ["Planche Lean", "Frog Stand", "Tuck Planche", "Advanced Tuck Planche", "Straddle Planche", "Planche completa"]],
  ["Human Flag", ["Side Plank", "Vertical Flag Hold", "Tuck Human Flag", "One Leg Flag", "Straddle Flag", "Human Flag completa"]],
  ["Muscle Up", ["Explosive Pull-up", "Chest to Bar", "Transition Drill", "Band Assisted Muscle Up", "Negative Muscle Up", "Muscle Up completo"]],
  ["Pistol Squat", ["Box Pistol", "Assisted Pistol", "Counterbalance Pistol", "Slow Eccentric Pistol", "Partial ROM Pistol", "Pistol Squat completo"]],
  ["Dragon Flag", ["Hollow Hold", "Reverse Crunch", "Dragon Flag Negativa", "Half Dragon Flag", "Strict Dragon Flag", "Dragon Flag completa"]],
  ["L-Sit", ["Seated Compression", "Tuck Sit", "One Leg L-Sit", "Alternating L-Sit", "V-Sit Prep", "L-Sit completo"]],
  ["Crow Pose", ["Core Engagement Basics", "Wrist Strengthening", "Squat Hold Balance", "Tripod Head Balance", "Crow Pose completo"]],
  ["Headstand", ["Neck and Shoulder Strengthening", "Dolphin Pose", "Supported Headstand (wall)", "Headstand Balance", "Freestanding Headstand"]],
  ["Wheel Pose", ["Bridge Prep", "Thoracic Mobility", "Wheel Assist", "Wheel Hold", "Wheel Pose completa"]],
  ["Firefly Pose", ["Hamstring Prep", "Arm Balance Prep", "Tuck Firefly", "Firefly Hold", "Firefly Pose completa"]],
  ["Eight Angle Pose", ["Twist Prep", "Leg Lock Drill", "Eight Angle Assisted", "Eight Angle Hold", "Eight Angle Pose completa"]],
  ["Scorpion Pose", ["Forearm Stand Prep", "Backbend Mobility", "Wall Scorpion", "Scorpion Balance", "Scorpion Pose completa"]],
]
  .flatMap(([skillName, stages], idxSkill) => (stages as string[]).map((name, idx) => ({
    skillName: String(skillName),
    stageNumber: idx + 1,
    name,
    description: `ProgressÃƒÂ£o ${idx + 1} de ${skillName}`,
    levelRequired: 4 + idx * 2 + idxSkill % 2,
    exerciseReference: name,
  })));

const titleSeeds = [
  { name: "Recruta", description: "Primeiros passos", reference: "RPG", unlock_condition: "level:1", rarity: "Comum" },
  { name: "Guerreiro do Core", description: "NÃƒÂ­vel 5", reference: "Calistenia", unlock_condition: "level:5", rarity: "Comum" },
  { name: "Veterano de Ferro", description: "NÃƒÂ­vel 10", reference: "MusculaÃƒÂ§ÃƒÂ£o", unlock_condition: "level:10", rarity: "Incomum" },
  { name: "LÃƒÂ¢mina Afiada", description: "NÃƒÂ­vel 15", reference: "AÃƒÂ§ÃƒÂ£o", unlock_condition: "level:15", rarity: "Raro" },
  { name: "Mestre do Peso Corporal", description: "NÃƒÂ­vel 20", reference: "Calistenia", unlock_condition: "level:20", rarity: "Raro" },
  { name: "O ÃƒÅ¡ltimo de NÃƒÂ³s", description: "NÃƒÂ­vel 30", reference: "TLOU", unlock_condition: "level:30", rarity: "MÃƒÂ­tico" },
  { name: "LendÃƒÂ¡rio", description: "NÃƒÂ­vel 50", reference: "RPG", unlock_condition: "level:50", rarity: "MÃƒÂ­tico" },
  { name: "O Equilibrista", description: "Handstand completo", reference: "Calistenia", unlock_condition: "skill:Handstand:6", rarity: "Raro" },
  { name: "Acima de Todos", description: "Muscle Up completo", reference: "Calistenia", unlock_condition: "skill:Muscle Up:6", rarity: "Raro" },
  { name: "ForÃƒÂ§a Gravitacional", description: "Planche completa", reference: "Calistenia", unlock_condition: "skill:Planche:6", rarity: "MÃƒÂ­tico" },
  { name: "Bandeira Humana", description: "Human Flag completa", reference: "Calistenia", unlock_condition: "skill:Human Flag:6", rarity: "MÃƒÂ­tico" },
  { name: "Suspenso no Tempo", description: "Front Lever completo", reference: "Calistenia", unlock_condition: "skill:Front Lever:6", rarity: "Raro" },
  { name: "Shoto Style", description: "ReferÃƒÂªncia Street Fighter", reference: "Street Fighter", unlock_condition: "missions:120", rarity: "Incomum" },
  { name: "Iron Fist", description: "ReferÃƒÂªncia Tekken", reference: "Tekken", unlock_condition: "strength:80", rarity: "Raro" },
  { name: "King of Iron Body", description: "ReferÃƒÂªncia jogos de luta", reference: "Fighting Games", unlock_condition: "level:35", rarity: "MÃƒÂ­tico" },
  { name: "300", description: "300 treinos completados", reference: "Filme 300", unlock_condition: "missions:300", rarity: "MÃƒÂ­tico" },
  { name: "Rocky", description: "30 dias de streak", reference: "Rocky", unlock_condition: "streak:30", rarity: "Raro" },
  { name: "Predador", description: "CaÃƒÂ§a semanal concluÃƒÂ­da", reference: "Predador", unlock_condition: "weekly:1", rarity: "Incomum" },
  { name: "Chosen Undead", description: "Falhou e insistiu", reference: "Dark Souls", unlock_condition: "failures:10", rarity: "Secreto" },
  { name: "The Witcher", description: "Contrato semanal", reference: "The Witcher", unlock_condition: "weekly:5", rarity: "Raro" },
  { name: "Demon Slayer", description: "5 habilidades desbloqueadas", reference: "Anime", unlock_condition: "skills:5", rarity: "Raro" },
  { name: "Hollow", description: "Perdeu sequÃƒÂªncia 3x", reference: "Hollow Knight", unlock_condition: "streak_loss:3", rarity: "Secreto" },
];

const achievementSeeds = [
  { name: "Primeiro Passo", description: "Completar a primeira missÃƒÂ£o", category: "missoes", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "missions_completed>=1", icon: "Ã°Å¸â€˜Â£", reference: "" },
  { name: "Aquecendo", description: "Completar 7 missÃƒÂµes", category: "missoes", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "missions_completed>=7", icon: "Ã°Å¸â€Â¥", reference: "" },
  { name: "Rotina Formada", description: "Completar 30 missÃƒÂµes", category: "missoes", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "missions_completed>=30", icon: "Ã°Å¸â€œâ€¦", reference: "" },
  { name: "Sem Desculpas", description: "5 dias seguidos", category: "missoes", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=5", icon: "Ã¢Å“â€¦", reference: "" },
  { name: "MÃƒÂ¡quina", description: "Completar 100 missÃƒÂµes", category: "missoes", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "missions_completed>=100", icon: "Ã¢Å¡â„¢Ã¯Â¸Â", reference: "" },
  { name: "ImparÃƒÂ¡vel", description: "30 dias consecutivos", category: "missoes", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=30", icon: "Ã°Å¸ÂÆ’", reference: "" },
  { name: "Lenda Viva", description: "365 missÃƒÂµes", category: "missoes", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "missions_completed>=365", icon: "Ã°Å¸â€˜â€˜", reference: "" },
  { name: "Primeira Conversa", description: "Primeira mensagem no FitBot", category: "chat", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "chat_messages>=1", icon: "Ã°Å¸â€™Â¬", reference: "" },
  { name: "Curioso", description: "50 perguntas ao FitBot", category: "chat", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "chat_messages>=50", icon: "Ã°Å¸Â¤â€", reference: "" },
  { name: "Aprendiz Dedicado", description: "200 interaÃƒÂ§ÃƒÂµes no chat", category: "chat", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "chat_messages>=200", icon: "Ã°Å¸Â§Â ", reference: "" },
  { name: "Eco", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "chat", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "repeat_message_streak>=5", icon: "Ã°Å¸Å’â‚¬", reference: "" },
  { name: "Na Disputa", description: "Entrar no top 100", category: "ranking", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "ranking<=100", icon: "Ã°Å¸Â¥â€°", reference: "" },
  { name: "Elite", description: "Entrar no top 10", category: "ranking", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "ranking<=10", icon: "Ã°Å¸Â¥Ë†", reference: "" },
  { name: "O Escolhido", description: "AlcanÃƒÂ§ar #1", category: "ranking", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "ranking==1", icon: "Ã°Å¸Â¥â€¡", reference: "" },
  { name: "Ghost", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "ranking", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "top10_no_friends", icon: "Ã°Å¸â€˜Â¤", reference: "" },
  { name: "Primeiros Voos", description: "Primeira etapa do Handstand", category: "habilidades", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "skill_stage:Handstand>=1", icon: "Ã°Å¸â€¢Å Ã¯Â¸Â", reference: "" },
  { name: "Mestre do EquilÃƒÂ­brio", description: "Handstand completo", category: "habilidades", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "skill_stage:Handstand>=6", icon: "Ã°Å¸Â¤Â¸", reference: "" },
  { name: "Kalista", description: "Todas as skills calistÃƒÂªnicas", category: "habilidades", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "all_calisthenics", icon: "Ã¢Å¡â€Ã¯Â¸Â", reference: "" },
  { name: "Jogador", description: "Primeiro minigame", category: "minigames", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "minigames_played>=1", icon: "Ã°Å¸Å½Â®", reference: "" },
  { name: "Competidor", description: "Vencer 10 minigames", category: "minigames", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "minigames_won>=10", icon: "Ã°Å¸Ââ€¦", reference: "" },
  { name: "ImbatÃƒÂ­vel", description: "50 vitÃƒÂ³rias seguidas", category: "minigames", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "minigame_win_streak>=50", icon: "Ã°Å¸â€Â¥", reference: "" },
  { name: "Mestre ArtesÃƒÂ£o", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "craft_master", icon: "Ã°Å¸â€ºÂ Ã¯Â¸Â", reference: "Hollow Knight" },
  { name: "InsÃƒÂ´nia", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "mission_2am_4am", icon: "Ã°Å¸Å’â„¢", reference: "" },
  { name: "Fantasma", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "open_gap6_complete_day7", icon: "Ã°Å¸â€˜Â»", reference: "" },
  { name: "Conversa de Louco", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "chat_session_100", icon: "Ã°Å¸Â¤Â¯", reference: "" },
  { name: "Glitch", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "report_bug_chat", icon: "Ã°Å¸ÂÅ¾", reference: "" },
  { name: "Aquecendo o Motor", description: "3 dias seguidos", category: "streak", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "streak>=3", icon: "Ã°Å¸â€Â¥", reference: "" },
  { name: "Semana Completa", description: "7 dias seguidos", category: "streak", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "streak>=7", icon: "Ã°Å¸â€œâ€ ", reference: "" },
  { name: "Ritmo Certo", description: "14 dias seguidos", category: "streak", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=14", icon: "Ã°Å¸Å¸Â¢", reference: "" },
  { name: "Sem Parar", description: "21 dias seguidos", category: "streak", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=21", icon: "Ã°Å¸ÂÆ’", reference: "" },
  { name: "MÃƒÂªs de Ferro", description: "30 dias seguidos", category: "streak", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=30", icon: "Ã°Å¸â€™Âª", reference: "" },
  { name: "Disciplina Absurda", description: "60 dias seguidos", category: "streak", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=60", icon: "Ã°Å¸Â§Â±", reference: "" },
  { name: "InabalÃƒÂ¡vel", description: "100 dias seguidos", category: "streak", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "streak>=100", icon: "Ã°Å¸â€ºÂ¡Ã¯Â¸Â", reference: "" },
  { name: "Um Ano de Dor", description: "365 dias seguidos", category: "streak", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "streak>=365", icon: "Ã°Å¸â€œâ€º", reference: "" },
  { name: "Acontece", description: "Quebrar streak pela primeira vez", category: "streak_break", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "streak_break>=1", icon: "Ã°Å¸â€™Â¥", reference: "" },
  { name: "Voltar ÃƒÂ© DifÃƒÂ­cil", description: "Quebrar streak de 30+", category: "streak_break", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak_break>=30", icon: "Ã¢â€ Â©Ã¯Â¸Â", reference: "" },
  { name: "Tudo Ruiu", description: "Quebrar streak de 100+", category: "streak_break", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak_break>=100", icon: "Ã°Å¸Å’ÂªÃ¯Â¸Â", reference: "" },
  { name: "A Queda Ãƒâ€°pica", description: "Quebrar streak de 365+", category: "streak_break", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "streak_break>=365", icon: "Ã°Å¸â€¢Â³Ã¯Â¸Â", reference: "" },
  { name: "Tudo pela Streak", description: "Manter streak com 1 missÃƒÂ£o em 7 dias", category: "streak_minimal", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "minimal_streak>=7", icon: "1Ã¯Â¸ÂÃ¢Æ’Â£", reference: "" },
  { name: "O Minimalista", description: "Manter streak com 1 missÃƒÂ£o em 30 dias", category: "streak_minimal", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "minimal_streak>=30", icon: "Ã°Å¸Â§Â©", reference: "" },
  { name: "Engenharia de Streak", description: "Manter streak com 1 missÃƒÂ£o em 100 dias", category: "streak_minimal", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "minimal_streak>=100", icon: "Ã¢Å¡â„¢Ã¯Â¸Â", reference: "" },
  { name: "A Arte da PreguiÃƒÂ§a", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "streak_minimal", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "single_mission_30", icon: "Ã°Å¸ËœÂ´", reference: "" },
  { name: "De Volta ao Jogo", description: "Reconstruir para 7 dias", category: "streak_rebuild", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "rebuild>=7", icon: "Ã°Å¸â€Â", reference: "" },
  { name: "FÃƒÂªnix", description: "Quebrar 30+ e reconstruir 30+", category: "streak_rebuild", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "rebuild_from30", icon: "Ã°Å¸Â¦â€¦", reference: "" },
  { name: "Lenda Resiliente", description: "Quebrar 100+ e reconstruir 100+", category: "streak_rebuild", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "rebuild_from100", icon: "Ã°Å¸Â§Â¬", reference: "" },
  { name: "Por um Fio", description: "ÃƒÅ¡ltimos 5 minutos 5x", category: "timing", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "timing_last5m>=5", icon: "Ã¢ÂÂ³", reference: "" },
  { name: "Especialista em Timing", description: "ÃƒÅ¡ltimos 5 minutos 20x", category: "timing", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "timing_last5m>=20", icon: "Ã°Å¸Å½Â¯", reference: "" },
  { name: "MissÃƒÂ£o ÃƒÂ s 23:59", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "timing", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "timing_2355_streak>=7", icon: "Ã°Å¸â€¢â€º", reference: "" },
  { name: "404 Not Found", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "route_not_found", icon: "Ã¢Ââ€œ", reference: "" },
  { name: "Hoje NÃƒÂ£o", description: "Falhar 1 missÃƒÂ£o da meta", category: "meta_fail", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_fail>=1", icon: "Ã°Å¸â„¢Æ’", reference: "" },
  { name: "AmanhÃƒÂ£ Eu ComeÃƒÂ§o", description: "Falhar 3 missÃƒÂµes da meta em dias diferentes", category: "meta_fail", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_fail_days>=3", icon: "Ã°Å¸â€œâ€ ", reference: "" },
  { name: "Meta? Que Meta?", description: "Falhar 5 missÃƒÂµes da meta", category: "meta_fail", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_fail>=5", icon: "Ã°Å¸Å½Â¯", reference: "" },
  { name: "Plano de Mentira", description: "Falhar 15 missÃƒÂµes da meta", category: "meta_fail", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_fail>=15", icon: "Ã°Å¸Â§Â¾", reference: "" },
  { name: "Autobiotagem", description: "Falhar 30 missÃƒÂµes da meta", category: "meta_fail", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_fail>=30", icon: "Ã°Å¸Â§Â¨", reference: "" },
  { name: "Speedrun do Fracasso", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_fail", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "goal_fail_7d", icon: "Ã°Å¸ÂÂ´", reference: "" },
  { name: "No Caminho Certo", description: "7 missÃƒÂµes da meta concluÃƒÂ­das", category: "meta_done", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "goal_done>=7", icon: "Ã¢Å¾Â¡Ã¯Â¸Â", reference: "" },
  { name: "Focado", description: "30 missÃƒÂµes da meta concluÃƒÂ­das", category: "meta_done", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_done>=30", icon: "Ã°Å¸Å½Â¯", reference: "" },
  { name: "Sem Desvios", description: "7 dias sem falhar missÃƒÂ£o da meta", category: "meta_done", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_nofail>=7", icon: "Ã°Å¸Â§Â­", reference: "" },
  { name: "Comprometido", description: "100 missÃƒÂµes da meta concluÃƒÂ­das", category: "meta_done", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_done>=100", icon: "Ã°Å¸â€œÅ’", reference: "" },
  { name: "Olho no Alvo", description: "30 dias sem falhar missÃƒÂ£o da meta", category: "meta_done", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_nofail>=30", icon: "Ã°Å¸â€˜ÂÃ¯Â¸Â", reference: "" },
  { name: "ObsessÃƒÂ£o SaudÃƒÂ¡vel", description: "365 missÃƒÂµes da meta", category: "meta_done", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_done>=365", icon: "Ã°Å¸Â§Â ", reference: "" },
  { name: "InabalÃƒÂ¡vel no PropÃƒÂ³sito", description: "100 dias sem falhar missÃƒÂ£o da meta", category: "meta_done", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_nofail>=100", icon: "Ã°Å¸â€ºÂ¡Ã¯Â¸Â", reference: "" },
  { name: "A Meta era Essa?", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_change", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "goal_return_30", icon: "Ã°Å¸â€â€ž", reference: "" },
  { name: "Primeiro Resultado", description: "10% da meta", category: "meta_progress", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "goal_progress>=10", icon: "Ã°Å¸â€Å¸", reference: "" },
  { name: "Meio Caminho", description: "50% da meta", category: "meta_progress", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_progress>=50", icon: "5Ã¯Â¸ÂÃ¢Æ’Â£0Ã¯Â¸ÂÃ¢Æ’Â£", reference: "" },
  { name: "Quase LÃƒÂ¡", description: "90% da meta", category: "meta_progress", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_progress>=90", icon: "9Ã¯Â¸ÂÃ¢Æ’Â£0Ã¯Â¸ÂÃ¢Æ’Â£", reference: "" },
  { name: "Meta Batida", description: "100% da meta", category: "meta_progress", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_progress>=100", icon: "Ã°Å¸â€™Â¯", reference: "" },
  { name: "AlÃƒÂ©m da Meta", description: "120% da meta", category: "meta_progress", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_progress>=120", icon: "Ã°Å¸Å¡â‚¬", reference: "" },
  { name: "Overachiever", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_progress", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "goal_half_time", icon: "Ã¢Å¡Â¡", reference: "" },
  { name: "Novo CapÃƒÂ­tulo", description: "Primeira troca de meta", category: "meta_change", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_change>=1", icon: "Ã°Å¸â€œâ€“", reference: "" },
  { name: "Indefinido", description: "3 trocas de meta", category: "meta_change", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_change>=3", icon: "Ã°Å¸Â§Â­", reference: "" },
  { name: "A Jornada ÃƒÂ© o Destino", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_change", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "all_goals_done", icon: "Ã°Å¸â€”ÂºÃ¯Â¸Â", reference: "" },
  { name: "Dupla AmeaÃƒÂ§a", description: "Streak 30 + meta perfeita", category: "meta_combo", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "combo30", icon: "Ã¢Å¡â€Ã¯Â¸Â", reference: "" },
  { name: "MÃƒÂ¡quina de Resultados", description: "Streak 100 + meta perfeita", category: "meta_combo", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "combo100", icon: "Ã°Å¸ÂÂ­", reference: "" },
  { name: "PerfeiÃƒÂ§ÃƒÂ£o", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_combo", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "combo30_all", icon: "Ã¢Å“Â¨", reference: "" },
];

function conditioningOrder(level: ConditioningLevel): number {
  return { sedentario: 0, iniciante: 1, intermediario: 2, avancado: 3 }[level] ?? 0;
}

function skillTierOrder(tier: string): number {
  return { iniciante: 1, intermediario: 2, avancado: 3, calistenico: 4 }[tier as keyof Record<string, number>] ?? 1;
}

async function ensureGamificationCatalog(db: D1Database) {
  for (const skill of coreSkillSeeds) {
    await db.prepare(`INSERT INTO skills (name, category, difficulty, description, calories_per_rep, strength_gain, constitution_gain, vitality_gain, dexterity_gain, focus_gain, required_level, tier, level_required, prerequisites, attribute_requirements, unlock_message, updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM skills WHERE name = ?)`)
      .bind(skill.name, skill.category, skill.difficulty, skill.description, 0.5, 1, 1, 1, 1, 1, skill.requiredLevel, skill.tier, skill.requiredLevel, JSON.stringify(skill.prerequisites ?? []), JSON.stringify(skill.attributeRequirements ?? {}), skill.unlockMessage, skill.name)
      .run();
  }

  for (const stage of stageProgressionSeed) {
    const skill = await db.prepare("SELECT id FROM skills WHERE name = ?").bind(stage.skillName).first<{ id: number }>();
    if (!skill?.id) continue;
    await db.prepare(`INSERT INTO skill_stages (skill_id, stage_number, name, description, level_required, exercise_reference, updated_at)
      SELECT ?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM skill_stages WHERE skill_id = ? AND stage_number = ?)`)
      .bind(skill.id, stage.stageNumber, stage.name, stage.description, stage.levelRequired, stage.exerciseReference, skill.id, stage.stageNumber)
      .run();
  }

  for (const achievement of achievementSeeds) {
    const achievementName = repairKnownMojibakeString(achievement.name);
    const achievementDescription = repairKnownMojibake(achievement.description) ?? achievement.description;
    const achievementRarity = repairKnownMojibakeString(achievement.rarity);
    const achievementReference = repairKnownMojibake(achievement.reference) ?? achievement.reference;

    await db.prepare(`INSERT INTO achievements (name, description, rarity, icon, requirement_type, requirement_value, category, color, secret, condition, reference, updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM achievements WHERE name = ?)`)
      .bind(achievementName, achievementDescription, achievementRarity, achievement.icon, "event", 1, achievement.category, achievement.color, achievement.secret, achievement.condition, achievementReference, achievementName)
      .run();
  }

  for (const title of titleSeeds) {
    await db.prepare(`INSERT INTO titles (name, rarity, requirement_type, requirement_value, description, reference, unlock_condition, updated_at)
      SELECT ?,?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM titles WHERE name = ?)`)
      .bind(title.name, title.rarity, "event", 1, title.description, title.reference, title.unlock_condition, title.name)
      .run();
  }
}

async function ensureUserCounterRow(db: D1Database, userId: string) {
  await db.prepare(`INSERT OR IGNORE INTO user_event_counters (user_id, updated_at) VALUES (?, datetime('now'))`).bind(userId).run();
}

async function cleanupSettledMissions(db: D1Database, userId: string): Promise<void> {
  await db.prepare(
    `DELETE FROM missions
      WHERE user_id = ?
        AND COALESCE(status, 'pending') IN ('completed', 'expired', 'failed')
        AND datetime(updated_at) < datetime('now', '${SETTLED_MISSION_MAX_AGE_SQL_MODIFIER}')`
  ).bind(userId).run();
}

async function cleanupSettledMissionsWithGuard(db: D1Database, userId: string): Promise<void> {
  try {
    await cleanupSettledMissions(db, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const missingStatusColumn = message.includes("no such column") && message.includes("status");
    if (missingStatusColumn) {
      return;
    }
    throw error;
  }
}

async function expirePendingMissionsAndUpdateStreak(db: D1Database, userId: string) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

  let expired: { results: Array<{ id: number }> } = { results: [] };
  try {
    expired = await db.prepare(
      `SELECT id FROM missions WHERE user_id = ? AND is_completed = 0 AND COALESCE(status,'pending') = 'pending' AND deadline IS NOT NULL AND date(deadline) < date('now')`
    ).bind(userId).all<{ id: number }>();
  } catch {
    // status column may not exist before latest migration
  }

  for (const mission of expired.results) {
    await db.prepare("UPDATE missions SET status = 'failed', updated_at = datetime('now') WHERE id = ?").bind(mission.id).run();
    await onMissionFailed(db, userId, mission.id);
  }
  const progression = await db.prepare("SELECT current_streak, best_streak, last_activity_date FROM user_progression WHERE user_id = ?").bind(userId).first<{ current_streak: number; best_streak: number; last_activity_date: string | null }>();

  const completedToday = await db.prepare(
    `SELECT COUNT(*) as c FROM missions WHERE user_id = ? AND is_completed = 1 AND date(completed_at) = ?`
  ).bind(userId, today).first<{ c: number }>();

  const completedYesterday = await db.prepare(
    `SELECT COUNT(*) as c, MAX(completed_at) as last_time FROM missions WHERE user_id = ? AND is_completed = 1 AND date(completed_at) = ?`
  ).bind(userId, yesterday).first<{ c: number; last_time: string | null }>();

  const currentStreak = Number(progression?.current_streak ?? 0);
  const lastActivity = progression?.last_activity_date;

  if (lastActivity && lastActivity < yesterday && currentStreak > 0) {
    await onStreakBroken(db, userId, currentStreak);
    await db.prepare("UPDATE user_progression SET current_streak = 0, updated_at = datetime('now') WHERE user_id = ?").bind(userId).run();
  }

  if (Number(completedYesterday?.c ?? 0) > 0 && lastActivity !== yesterday) {
    const previousBest = Number(progression?.best_streak ?? 0);
    const rebuilt = currentStreak + 1;
    await db.prepare(`UPDATE user_progression SET current_streak = ?, best_streak = MAX(COALESCE(best_streak,0), ?), last_activity_date = ?, updated_at = datetime('now') WHERE user_id = ?`)
      .bind(rebuilt, rebuilt, yesterday, userId).run();
    await onStreakContinued(db, userId, rebuilt, Number(completedYesterday?.c ?? 0), completedYesterday?.last_time ?? undefined);
    await onStreakRebuilt(db, userId, rebuilt, previousBest);
  }

  if (Number(completedToday?.c ?? 0) > 0) {
    const refreshed = await db.prepare("SELECT current_streak FROM user_progression WHERE user_id = ?").bind(userId).first<{ current_streak: number }>();
    await onStreakContinued(db, userId, Number(refreshed?.current_streak ?? 0), Number(completedToday?.c ?? 0));
  }
}

async function logUserEvent(db: D1Database, userId: string, eventType: string, payload: Record<string, unknown>) {
  await db.prepare(`INSERT INTO user_event_log (user_id, event_type, payload_json) VALUES (?, ?, ?)`)
    .bind(userId, eventType, JSON.stringify(payload)).run();
}

async function runMissionLifecycleHookSafely(
  userId: string,
  phase: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error("[missions][lifecycle]", {
      userId,
      phase,
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

async function unlockTitleIfNeeded(db: D1Database, userId: string, titleName: string) {
  const title = await db.prepare("SELECT id FROM titles WHERE name = ?").bind(titleName).first<{ id: number }>();
  if (!title?.id) return;
  await db.prepare(`INSERT OR IGNORE INTO user_titles (user_id, title_id, unlocked_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`)
    .bind(userId, title.id).run();
}

async function unlockAchievementIfNeeded(db: D1Database, userId: string, achievementName: string, progressCurrent = 1, progressRequired = 1) {
  const normalizedAchievementName = repairKnownMojibakeString(achievementName);
  const achievement = await db.prepare("SELECT id FROM achievements WHERE name = ? OR name = ? LIMIT 1").bind(normalizedAchievementName, achievementName).first<{ id: number }>();
  if (!achievement?.id) return;
  const normalizedCurrent = Math.max(1, Math.floor(progressCurrent));
  const normalizedRequired = Math.max(1, Math.floor(progressRequired));
  const existing = await db.prepare(
    `SELECT id
       FROM user_achievements
      WHERE user_id = ? AND achievement_id = ?
      ORDER BY id ASC
      LIMIT 1`
  ).bind(userId, achievement.id).first<{ id: number }>();

  if (existing?.id) {
    await db.prepare(
      `UPDATE user_achievements
          SET progress_current = MAX(COALESCE(progress_current, 0), ?),
              progress_required = MAX(COALESCE(progress_required, 0), ?),
              updated_at = datetime('now')
        WHERE id = ?`
    ).bind(normalizedCurrent, normalizedRequired, existing.id).run();

    // Safety net: keep only one record per user + achievement.
    await db.prepare(
      `DELETE FROM user_achievements
        WHERE user_id = ? AND achievement_id = ? AND id <> ?`
    ).bind(userId, achievement.id, existing.id).run();
    return;
  }

  await db.prepare(
    `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, progress_current, progress_required, updated_at)
      VALUES (?, ?, datetime('now'), ?, ?, datetime('now'))`
  ).bind(userId, achievement.id, normalizedCurrent, normalizedRequired).run();
}

async function evaluateMissionAchievementsAndTitles(db: D1Database, userId: string) {
  const counters = await db.prepare("SELECT * FROM user_event_counters WHERE user_id = ?").bind(userId).first<Record<string, unknown>>();
  const missionsCompleted = Number(counters?.missions_completed ?? 0);
  const consecutiveDays = Number(counters?.consecutive_days_completed ?? 0);

  if (missionsCompleted >= 1) await unlockAchievementIfNeeded(db, userId, "Primeiro Passo", missionsCompleted, 1);
  if (missionsCompleted >= 7) await unlockAchievementIfNeeded(db, userId, "Aquecendo", missionsCompleted, 7);
  if (missionsCompleted >= 30) await unlockAchievementIfNeeded(db, userId, "Rotina Formada", missionsCompleted, 30);
  if (missionsCompleted >= 100) await unlockAchievementIfNeeded(db, userId, "MÃƒÂ¡quina", missionsCompleted, 100);
  if (missionsCompleted >= 365) await unlockAchievementIfNeeded(db, userId, "Lenda Viva", missionsCompleted, 365);
  if (consecutiveDays >= 5) await unlockAchievementIfNeeded(db, userId, "Sem Desculpas", consecutiveDays, 5);
  if (consecutiveDays >= 30) {
    await unlockAchievementIfNeeded(db, userId, "ImparÃƒÂ¡vel", consecutiveDays, 30);
    await unlockTitleIfNeeded(db, userId, "Rocky");
  }
  if (missionsCompleted >= 300) await unlockTitleIfNeeded(db, userId, "300");
  if (missionsCompleted >= 120) await unlockTitleIfNeeded(db, userId, "Shoto Style");
}

async function evaluateChatAchievements(db: D1Database, userId: string) {
  const counters = await db.prepare("SELECT chat_messages, repeated_message_streak FROM user_event_counters WHERE user_id = ?")
    .bind(userId).first<{ chat_messages: number; repeated_message_streak: number }>();
  const total = Number(counters?.chat_messages ?? 0);
  const repeat = Number(counters?.repeated_message_streak ?? 0);

  if (total >= 1) await unlockAchievementIfNeeded(db, userId, "Primeira Conversa", total, 1);
  if (total >= 50) await unlockAchievementIfNeeded(db, userId, "Curioso", total, 50);
  if (total >= 200) await unlockAchievementIfNeeded(db, userId, "Aprendiz Dedicado", total, 200);
  if (repeat >= 5) await unlockAchievementIfNeeded(db, userId, "Eco", repeat, 5);
}

async function evaluateLevelTitles(db: D1Database, userId: string, level: number) {
  const byLevel: Array<[number, string]> = [
    [1, "Recruta"], [5, "Guerreiro do Core"], [10, "Veterano de Ferro"], [15, "LÃƒÂ¢mina Afiada"],
    [20, "Mestre do Peso Corporal"], [30, "O ÃƒÅ¡ltimo de NÃƒÂ³s"], [50, "LendÃƒÂ¡rio"],
  ];
  for (const [threshold, name] of byLevel) {
    if (level >= threshold) await unlockTitleIfNeeded(db, userId, name);
  }
}

async function onStreakContinued(db: D1Database, userId: string, streakDays: number, missionsCompletedToday: number, lastMissionDate?: string | undefined) {
  await logUserEvent(db, userId, "onStreakContinued", { streakDays, missionsCompletedToday });

  const milestones: Array<[number, string]> = [
    [3, "Aquecendo o Motor"], [7, "Semana Completa"], [14, "Ritmo Certo"], [21, "Sem Parar"],
    [30, "MÃƒÂªs de Ferro"], [60, "Disciplina Absurda"], [100, "InabalÃƒÂ¡vel"], [365, "Um Ano de Dor"],
  ];
  for (const [value, name] of milestones) {
    if (streakDays >= value) await unlockAchievementIfNeeded(db, userId, name, streakDays, value);
  }

  if (missionsCompletedToday === 1) {
    await db.prepare(`UPDATE user_event_counters
      SET minimal_streak_days = COALESCE(minimal_streak_days,0)+1,
          single_mission_days_streak = COALESCE(single_mission_days_streak,0)+1,
          updated_at = datetime('now')
      WHERE user_id = ?`).bind(userId).run();
  } else if (missionsCompletedToday > 1) {
    await db.prepare(`UPDATE user_event_counters
      SET single_mission_days_streak = 0,
          updated_at = datetime('now')
      WHERE user_id = ?`).bind(userId).run();
  }

  const counters = await db.prepare(`SELECT minimal_streak_days, single_mission_days_streak, timing_last5m_count, timing_2355_streak FROM user_event_counters WHERE user_id = ?`)
    .bind(userId).first<{ minimal_streak_days: number; single_mission_days_streak: number; timing_last5m_count: number; timing_2355_streak: number }>();
  const minimal = Number(counters?.minimal_streak_days ?? 0);
  const singleStreak = Number(counters?.single_mission_days_streak ?? 0);
  if (minimal >= 7) await unlockAchievementIfNeeded(db, userId, "Tudo pela Streak", minimal, 7);
  if (minimal >= 30) await unlockAchievementIfNeeded(db, userId, "O Minimalista", minimal, 30);
  if (minimal >= 100) await unlockAchievementIfNeeded(db, userId, "Engenharia de Streak", minimal, 100);
  if (singleStreak >= 30) await unlockAchievementIfNeeded(db, userId, "A Arte da PreguiÃƒÂ§a", singleStreak, 30);

  if (lastMissionDate) {
    const d = new Date(lastMissionDate);
    const h = d.getHours();
    const m = d.getMinutes();
    if (h === 23 && m >= 55) {
      await db.prepare(`UPDATE user_event_counters SET timing_last5m_count = COALESCE(timing_last5m_count,0)+1, timing_2355_streak = COALESCE(timing_2355_streak,0)+1, updated_at=datetime('now') WHERE user_id = ?`)
        .bind(userId).run();
      const t = await db.prepare(`SELECT timing_last5m_count, timing_2355_streak FROM user_event_counters WHERE user_id = ?`).bind(userId).first<{ timing_last5m_count: number; timing_2355_streak: number }>();
      if (Number(t?.timing_last5m_count ?? 0) >= 5) await unlockAchievementIfNeeded(db, userId, "Por um Fio", Number(t?.timing_last5m_count ?? 0), 5);
      if (Number(t?.timing_last5m_count ?? 0) >= 20) await unlockAchievementIfNeeded(db, userId, "Especialista em Timing", Number(t?.timing_last5m_count ?? 0), 20);
      if (Number(t?.timing_2355_streak ?? 0) >= 7) await unlockAchievementIfNeeded(db, userId, "MissÃƒÂ£o ÃƒÂ s 23:59", Number(t?.timing_2355_streak ?? 0), 7);
    } else {
      await db.prepare(`UPDATE user_event_counters SET timing_2355_streak = 0, updated_at=datetime('now') WHERE user_id = ?`).bind(userId).run();
    }
  }
}

async function onStreakBroken(db: D1Database, userId: string, streakDaysBefore: number) {
  await logUserEvent(db, userId, "onStreakBroken", { streakDaysBefore });
  await db.prepare(`UPDATE user_event_counters
    SET streak_loss_count = COALESCE(streak_loss_count,0)+1,
        last_streak_break_size = ?,
        single_mission_days_streak = 0,
        updated_at = datetime('now')
    WHERE user_id = ?`).bind(streakDaysBefore, userId).run();

  if (streakDaysBefore >= 1) await unlockAchievementIfNeeded(db, userId, "Acontece", streakDaysBefore, 1);
  if (streakDaysBefore >= 30) await unlockAchievementIfNeeded(db, userId, "Voltar ÃƒÂ© DifÃƒÂ­cil", streakDaysBefore, 30);
  if (streakDaysBefore >= 100) await unlockAchievementIfNeeded(db, userId, "Tudo Ruiu", streakDaysBefore, 100);
  if (streakDaysBefore >= 365) await unlockAchievementIfNeeded(db, userId, "A Queda Ãƒâ€°pica", streakDaysBefore, 365);
}

async function onStreakRebuilt(db: D1Database, userId: string, newStreakDays: number, previousBestStreak: number) {
  await logUserEvent(db, userId, "onStreakRebuilt", { newStreakDays, previousBestStreak });
  if (newStreakDays >= 7) await unlockAchievementIfNeeded(db, userId, "De Volta ao Jogo", newStreakDays, 7);
  if (previousBestStreak >= 30 && newStreakDays >= 30) await unlockAchievementIfNeeded(db, userId, "FÃƒÂªnix", newStreakDays, 30);
  if (previousBestStreak >= 100 && newStreakDays >= 100) await unlockAchievementIfNeeded(db, userId, "Lenda Resiliente", newStreakDays, 100);
}

async function onMissionFailed(db: D1Database, userId: string, missionId: number) {
  await logUserEvent(db, userId, "onMissionFailed", { missionId });
  await db.prepare(`UPDATE user_event_counters SET missions_failed = COALESCE(missions_failed,0)+1, updated_at=datetime('now') WHERE user_id = ?`).bind(userId).run();
  await checkMissionRelevance(userId, missionId, db, 'failed');
}

type GoalMissionRelevance = {
  isGoalRelevant: boolean;
  missionGroup: string;
  missionType: string;
  userGoal: string;
};

async function ensureGoalStatsRow(db: D1Database, userId: string, goal: string | null) {
  await db.prepare(`INSERT OR IGNORE INTO user_goal_stats (user_id, original_goal, current_goal, updated_at) VALUES (?, ?, ?, datetime('now'))`)
    .bind(userId, goal ?? 'saude_geral', goal ?? 'saude_geral').run();
}

async function getMissionContext(db: D1Database, missionId: number) {
  return db.prepare(
    `SELECT m.id, m.type, m.title, m.description, s.category as skill_category
      FROM missions m
      LEFT JOIN skills s ON s.id = m.skill_id
      WHERE m.id = ?`
  ).bind(missionId).first<{ id: number; type: string; title: string; description: string | null; skill_category: string | null }>();
}

function isMissionRelevantToGoal(missionGroup: string, missionType: string, userGoal: string) {
  const group = missionGroup.toLowerCase();
  if (userGoal === 'ganhar_massa') return ['peito', 'costas', 'pernas', 'ombro', 'triceps', 'biceps'].some((g) => group.includes(g)) || missionType !== 'daily';
  if (userGoal === 'perder_peso') return ['full', 'core', 'cardio', 'mobilidade'].some((g) => group.includes(g)) || missionType === 'daily';
  if (userGoal === 'resistencia') return ['core', 'pernas', 'cardio'].some((g) => group.includes(g)) || missionType !== 'monthly';
  if (userGoal === 'calistenia') return ['calistenia', 'core', 'yoga'].some((g) => group.includes(g));
  return true;
}

async function checkMissionRelevance(userId: string, missionId: number, db: D1Database, mode: 'failed' | 'completed'): Promise<GoalMissionRelevance> {
  const [mission, profile] = await Promise.all([
    getMissionContext(db, missionId),
    db.prepare("SELECT main_goal FROM user_profiles WHERE user_id = ?").bind(userId).first<{ main_goal: string | null }>(),
  ]);

  const userGoal = profile?.main_goal ?? 'saude_geral';
  await ensureGoalStatsRow(db, userId, userGoal);

  const missionGroup = String(mission?.skill_category ?? mission?.title ?? mission?.description ?? 'geral');
  const missionType = String(mission?.type ?? 'daily');
  const isGoalRelevant = isMissionRelevantToGoal(missionGroup, missionType, userGoal);

  if (!isGoalRelevant) return { isGoalRelevant, missionGroup, missionType, userGoal };

  const today = new Date().toISOString().split('T')[0];
  const stats = await db.prepare("SELECT * FROM user_goal_stats WHERE user_id = ?").bind(userId).first<Record<string, unknown>>();

  if (mode === 'failed') {
    const sameDay = String(stats?.goal_fail_last_day ?? '') === today;
    const failCount = Number(stats?.goal_fail_count ?? 0) + 1;
    const distinctDays = Number(stats?.goal_fail_distinct_days ?? 0) + (sameDay ? 0 : 1);
    const consecutiveFailDays = sameDay ? Number(stats?.goal_fail_consecutive_days ?? 0) : Number(stats?.goal_fail_consecutive_days ?? 0) + 1;
    await db.prepare(`UPDATE user_goal_stats SET goal_fail_count = ?, goal_fail_distinct_days = ?, goal_fail_last_day = ?, goal_fail_consecutive_days = ?, updated_at = datetime('now') WHERE user_id = ?`)
      .bind(failCount, distinctDays, today, consecutiveFailDays, userId).run();
    await onGoalMissionFailed(db, userId, failCount, distinctDays, consecutiveFailDays);
  } else {
    const sameDay = String(stats?.goal_completed_last_day ?? '') === today;
    const completedCount = Number(stats?.goal_completed_count ?? 0) + 1;
    const completedConsecutive = sameDay ? Number(stats?.goal_completed_consecutive_days ?? 0) : Number(stats?.goal_completed_consecutive_days ?? 0) + 1;
    const noFailStreak = sameDay ? Number(stats?.goal_no_fail_streak_days ?? 0) : Number(stats?.goal_no_fail_streak_days ?? 0) + 1;
    await db.prepare(`UPDATE user_goal_stats SET goal_completed_count = ?, goal_completed_last_day = ?, goal_completed_consecutive_days = ?, goal_no_fail_streak_days = ?,
      missions_after_return = CASE WHEN returned_to_original_count > 0 AND current_goal = original_goal THEN COALESCE(missions_after_return,0) + 1 ELSE missions_after_return END,
      updated_at = datetime('now') WHERE user_id = ?`)
      .bind(completedCount, today, completedConsecutive, noFailStreak, userId).run();
    const returnedStats = await db.prepare("SELECT missions_after_return, returned_to_original_count FROM user_goal_stats WHERE user_id = ?").bind(userId).first<{ missions_after_return: number; returned_to_original_count: number }>();
    if (Number(returnedStats?.returned_to_original_count ?? 0) > 0 && Number(returnedStats?.missions_after_return ?? 0) >= 30) {
      await unlockAchievementIfNeeded(db, userId, 'A Meta era Essa?', Number(returnedStats?.missions_after_return ?? 0), 30);
    }
    await onGoalMissionCompleted(db, userId, completedCount, completedConsecutive, noFailStreak);
  }

  return { isGoalRelevant, missionGroup, missionType, userGoal };
}

async function onGoalMissionFailed(db: D1Database, userId: string, failCount: number, distinctDays: number, consecutiveFailDays: number) {
  await logUserEvent(db, userId, 'onGoalMissionFailed', { failCount, distinctDays, consecutiveFailDays });
  if (failCount >= 1) await unlockAchievementIfNeeded(db, userId, 'Hoje NÃƒÂ£o', failCount, 1);
  if (distinctDays >= 3) await unlockAchievementIfNeeded(db, userId, 'AmanhÃƒÂ£ Eu ComeÃƒÂ§o', distinctDays, 3);
  if (failCount >= 5) await unlockAchievementIfNeeded(db, userId, 'Meta? Que Meta?', failCount, 5);
  if (failCount >= 15) await unlockAchievementIfNeeded(db, userId, 'Plano de Mentira', failCount, 15);
  if (failCount >= 30) await unlockAchievementIfNeeded(db, userId, 'Autobiotagem', failCount, 30);
  if (consecutiveFailDays >= 7) await unlockAchievementIfNeeded(db, userId, 'Speedrun do Fracasso', consecutiveFailDays, 7);
}

async function onGoalMissionCompleted(db: D1Database, userId: string, completedCount: number, consecutiveDays: number, noFailStreak: number) {
  await logUserEvent(db, userId, 'onGoalMissionCompleted', { completedCount, consecutiveDays, noFailStreak });
  if (completedCount >= 7) await unlockAchievementIfNeeded(db, userId, 'No Caminho Certo', completedCount, 7);
  if (completedCount >= 30) await unlockAchievementIfNeeded(db, userId, 'Focado', completedCount, 30);
  if (completedCount >= 100) await unlockAchievementIfNeeded(db, userId, 'Comprometido', completedCount, 100);
  if (completedCount >= 365) await unlockAchievementIfNeeded(db, userId, 'ObsessÃƒÂ£o SaudÃƒÂ¡vel', completedCount, 365);
  if (consecutiveDays >= 7) await unlockAchievementIfNeeded(db, userId, 'Sem Desvios', consecutiveDays, 7);
  if (consecutiveDays >= 30) await unlockAchievementIfNeeded(db, userId, 'Olho no Alvo', consecutiveDays, 30);
  if (noFailStreak >= 100) await unlockAchievementIfNeeded(db, userId, 'InabalÃƒÂ¡vel no PropÃƒÂ³sito', noFailStreak, 100);

  const streak = await db.prepare("SELECT current_streak FROM user_progression WHERE user_id = ?").bind(userId).first<{ current_streak: number }>();
  if (Number(streak?.current_streak ?? 0) >= 30 && noFailStreak >= 30) await unlockAchievementIfNeeded(db, userId, 'Dupla AmeaÃƒÂ§a', 30, 30);
  if (Number(streak?.current_streak ?? 0) >= 100 && noFailStreak >= 100) await unlockAchievementIfNeeded(db, userId, 'MÃƒÂ¡quina de Resultados', 100, 100);
}

async function onGoalProgress(db: D1Database, userId: string, progressPercent: number) {
  await logUserEvent(db, userId, 'onGoalProgress', { progressPercent });
  if (progressPercent >= 10) await unlockAchievementIfNeeded(db, userId, 'Primeiro Resultado', progressPercent, 10);
  if (progressPercent >= 50) await unlockAchievementIfNeeded(db, userId, 'Meio Caminho', progressPercent, 50);
  if (progressPercent >= 90) await unlockAchievementIfNeeded(db, userId, 'Quase LÃƒÂ¡', progressPercent, 90);
  if (progressPercent >= 100) await unlockAchievementIfNeeded(db, userId, 'Meta Batida', progressPercent, 100);
  if (progressPercent >= 120) await unlockAchievementIfNeeded(db, userId, 'AlÃƒÂ©m da Meta', progressPercent, 120);
}

async function onGoalChanged(db: D1Database, userId: string, oldGoal: string, newGoal: string, changeCount: number) {
  await logUserEvent(db, userId, 'onGoalChanged', { oldGoal, newGoal, changeCount });
  if (changeCount >= 1) await unlockAchievementIfNeeded(db, userId, 'Novo CapÃƒÂ­tulo', changeCount, 1);
  if (changeCount >= 3) await unlockAchievementIfNeeded(db, userId, 'Indefinido', changeCount, 3);
}

async function onMissionComplete(db: D1Database, userId: string, missionId: number) {
  await runMissionLifecycleHookSafely(userId, "mission_complete_log", () =>
    logUserEvent(db, userId, "onMissionComplete", { missionId }),
  );
  await runMissionLifecycleHookSafely(userId, "mission_complete_achievements", () =>
    evaluateMissionAchievementsAndTitles(db, userId),
  );
}

async function onLevelUp(db: D1Database, userId: string, newLevel: number) {
  await logUserEvent(db, userId, "onLevelUp", { newLevel });
  await evaluateLevelTitles(db, userId, newLevel);
}

async function onChatMessage(db: D1Database, userId: string, messageCount: number) {
  await logUserEvent(db, userId, "onChatMessage", { messageCount });
  await evaluateChatAchievements(db, userId);
}

async function onSkillUnlocked(db: D1Database, userId: string, skillId: number) {
  await logUserEvent(db, userId, "onSkillUnlocked", { skillId });
  const skill = await db.prepare("SELECT name, tier FROM skills WHERE id = ?").bind(skillId).first<{ name: string; tier: string }>();
  const count = await db.prepare("SELECT COUNT(*) as c FROM user_skills WHERE user_id = ?").bind(userId).first<{ c: number }>();
  const unlockedCount = Number(count?.c ?? 0);
  if (unlockedCount >= 5) await unlockTitleIfNeeded(db, userId, "Demon Slayer");

  if (skill?.name === "Handstand") {
    await unlockAchievementIfNeeded(db, userId, "Primeiros Voos", 1, 1);
  }

  const calisthenics = await db.prepare(
    `SELECT COUNT(*) as c FROM user_skills us INNER JOIN skills s ON s.id = us.skill_id WHERE us.user_id = ? AND s.tier = 'calistenico'`
  ).bind(userId).first<{ c: number }>();
  if (Number(calisthenics?.c ?? 0) >= 9) {
    await unlockAchievementIfNeeded(db, userId, "Kalista", Number(calisthenics?.c ?? 0), 9);
  }
}

async function onRankingUpdate(db: D1Database, userId: string, position: number) {
  await logUserEvent(db, userId, "onRankingUpdate", { position });
}

async function onFriendAdded(db: D1Database, userId: string) {
  await logUserEvent(db, userId, "onFriendAdded", {});
  const [rankData, friendsCount] = await Promise.all([
    db.prepare(`SELECT COUNT(*) + 1 as position FROM user_progression WHERE (level > (SELECT level FROM user_progression WHERE user_id = ?) OR (level = (SELECT level FROM user_progression WHERE user_id = ?) AND xp > (SELECT xp FROM user_progression WHERE user_id = ?)))`)
      .bind(userId, userId, userId).first<{ position: number }>(),
    db.prepare(`SELECT COUNT(*) as c FROM friendships WHERE user_id = ? OR friend_id = ? OR friend_user_id = ?`).bind(userId, userId, userId).first<{ c: number }>(),
  ]);
  if (Number(rankData?.position ?? 999) <= 10 && Number(friendsCount?.c ?? 0) === 0) {
    await unlockAchievementIfNeeded(db, userId, "Ghost", 1, 1);
  }
}

async function onProfileCustomization(db: D1Database, userId: string, customizations: Record<string, unknown>) {
  await logUserEvent(db, userId, "onProfileCustomization", customizations);
}

async function onAppOpen(db: D1Database, userId: string, timestamp: string) {
  await ensureUserCounterRow(db, userId);
  const current = await db.prepare("SELECT app_last_open_at FROM user_event_counters WHERE user_id = ?").bind(userId).first<{ app_last_open_at: string | null }>();
  const previous = current?.app_last_open_at ? new Date(current.app_last_open_at).getTime() : Date.now();
  const now = new Date(timestamp).getTime();
  const gapDays = Math.max(0, Math.floor((now - previous) / 86400000));
  await db.prepare(`UPDATE user_event_counters SET app_last_open_at = ?, app_open_gap_days = ?, updated_at = datetime('now') WHERE user_id = ?`)
    .bind(timestamp, gapDays, userId).run();
  await logUserEvent(db, userId, "onAppOpen", { gapDays, timestamp });

  const hour = new Date(timestamp).getHours();
  if (hour >= 2 && hour < 4) {
    await unlockAchievementIfNeeded(db, userId, "InsÃƒÂ´nia", 1, 1);
  }

  if (gapDays >= 6) {
    const missionToday = await db.prepare(`SELECT COUNT(*) as c FROM missions WHERE user_id = ? AND is_completed = 1 AND date(completed_at) = date('now')`).bind(userId).first<{ c: number }>();
    if (Number(missionToday?.c ?? 0) >= 1) {
      await unlockAchievementIfNeeded(db, userId, "Fantasma", Number(gapDays), 7);
    }
  }
}

async function buildInitialTrainingPlan(mainGoal: string | null | undefined, conditioning: ConditioningLevel, equipment: string | null | undefined, injuries: string | null | undefined) {
  const restDay = conditioning === "avancado" ? "domingo" : "quarta";
  const weekly = {
    segunda: { focus: "push", muscles: ["chest", "shoulders", "triceps"], intensity: "moderada" },
    terca: { focus: "legs", muscles: ["legs", "glutes", "core"], intensity: "moderada" },
    quarta: { focus: "rest", muscles: ["mobility", "stretching"], intensity: "leve" },
    quinta: { focus: "pull", muscles: ["back", "biceps", "core"], intensity: "moderada" },
    sexta: { focus: mainGoal === "calistenia" ? "skill" : "conditioning", muscles: ["full body"], intensity: "moderada" },
    sabado: { focus: "recovery", muscles: ["mobility", "core"], intensity: "leve" },
    domingo: { focus: restDay === "domingo" ? "rest" : "optional", muscles: ["walk", "stretching"], intensity: "leve" },
  };

  return {
    goal: mainGoal ?? "saude_geral",
    conditioning,
    equipment: equipment ?? "",
    injuries: injuries ?? "",
    rest_days: [restDay],
    weekly,
    progression: "Primeiras 4 semanas com progressÃƒÂ£o linear de volume e tÃƒÂ©cnica.",
  };
}

function normalizeTrainingFrequencyInput(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 4;
  return Math.max(1, Math.min(7, Math.round(numeric)));
}

async function upsertTrainingPlan(
  db: D1Database,
  userId: string,
  plan: Record<string, unknown>,
  mainGoal: string | null,
  conditioning: ConditioningLevel,
  equipment: string | null,
  injuries: string | null,
  trainingFrequency: number | null | undefined,
) {
  const normalizedTrainingFrequency = normalizeTrainingFrequencyInput(trainingFrequency);
  await db.prepare(`INSERT INTO user_training_plans (user_id, main_goal, conditioning, training_frequency, equipment, injuries, weekly_plan_json, progression_notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      main_goal=excluded.main_goal,
      conditioning=excluded.conditioning,
      training_frequency=excluded.training_frequency,
      equipment=excluded.equipment,
      injuries=excluded.injuries,
      weekly_plan_json=excluded.weekly_plan_json,
      progression_notes=excluded.progression_notes,
      updated_at=datetime('now')`)
    .bind(
      userId,
      mainGoal,
      conditioning,
      normalizedTrainingFrequency,
      equipment ?? "",
      injuries ?? "",
      JSON.stringify(plan),
      "progressao de base",
    )
    .run();
}

async function tryUnlockSkillsForLevel(db: D1Database, userId: string, level: number) {
  const [profile, attrs] = await Promise.all([
    db.prepare("SELECT initial_conditioning FROM user_profiles WHERE user_id = ?").bind(userId).first<{ initial_conditioning: ConditioningLevel }>(),
    db.prepare("SELECT strength, constitution, vitality, dexterity, focus FROM user_attributes WHERE user_id = ?").bind(userId).first<Record<string, number>>(),
  ]);
  const conditioning = (profile?.initial_conditioning ?? "iniciante") as ConditioningLevel;

  const candidates = await db.prepare(
    `SELECT id, name, tier, level_required, prerequisites, attribute_requirements FROM skills
      WHERE COALESCE(level_required, required_level) <= ?
      AND id NOT IN (SELECT skill_id FROM user_skills WHERE user_id = ?)`
  ).bind(level, userId).all<{ id: number; name: string; tier: string; level_required: number; prerequisites?: string | undefined; attribute_requirements?: string | undefined }>();

  for (const skill of candidates.results) {
    if (skillTierOrder(skill.tier) > conditioningOrder(conditioning) + 1) continue;
    const prereqNames = JSON.parse(skill.prerequisites || "[]") as string[];
    let hasPrereq = true;
    for (const prereq of prereqNames) {
      const row = await db.prepare(`SELECT 1 FROM user_skills us INNER JOIN skills s ON s.id = us.skill_id WHERE us.user_id = ? AND s.name = ?`).bind(userId, prereq).first();
      if (!row) {
        hasPrereq = false;
        break;
      }
    }
    if (!hasPrereq) continue;

    const req = JSON.parse(skill.attribute_requirements || "{}") as Record<string, number>;
    const attributesOk = Object.entries(req).every(([key, value]) => Number(attrs?.[key] ?? 0) >= Number(value));
    if (!attributesOk) continue;

    await db.prepare(`INSERT OR IGNORE INTO user_skills (user_id, skill_id, status, current_stage, total_reps, total_time, best_reps, unlocked_at, updated_at)
      VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`).bind(userId, skill.id).run();
    await db.prepare(`UPDATE user_event_counters SET skills_unlocked = COALESCE(skills_unlocked,0)+1, updated_at=datetime('now') WHERE user_id = ?`).bind(userId).run();
    await onSkillUnlocked(db, userId, skill.id);
  }
}

/** XP para completar o nível atual e avançar (barra cheia). Igual ao front: `Math.max(100, level * 100)`. */
function xpRequiredToAdvanceFromLevel(level: number): number {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  return Math.max(100, L * 100);
}

function parseProgressionXpLevel(row: { xp?: unknown; level?: unknown } | null | undefined): { xp: number; level: number } {
  const level = Math.max(1, Math.floor(Number(row?.level ?? 1)));
  const xp = Math.max(0, Math.floor(Number(row?.xp ?? 0)));
  return { xp, level };
}

/** Aplica ganho de XP e resolve todos os level-ups (evita depender de SELECT pós-UPDATE no D1 e permite vários níveis de uma vez). */
function computeXpAndLevelAfterGain(xp: number, level: number, xpDelta: number): { xp: number; level: number; levelsGained: number } {
  const add = Math.max(0, Math.floor(Number(xpDelta) || 0));
  let x = Math.max(0, Math.floor(xp)) + add;
  let L = Math.max(1, Math.floor(level));
  let gained = 0;
  const maxIterations = 1000;
  for (let i = 0; i < maxIterations; i += 1) {
    const need = xpRequiredToAdvanceFromLevel(L);
    if (x < need) break;
    x -= need;
    L += 1;
    gained += 1;
  }
  return { xp: x, level: L, levelsGained: gained };
}

/**
 * Lê progression, soma XP/pontos, aplica todas as subidas de nível de uma vez e dispara hooks por nível.
 * Usar em qualquer fluxo que conceda XP (missão, circuito, mensal, minigame).
 */
async function applyXpPointsAndResolveLevels(
  db: D1Database,
  userId: string,
  xpDelta: number,
  pointsDelta: number,
): Promise<{ leveledUp: boolean; newLevel: number; levelsGained: number }> {
  const row = await db
    .prepare("SELECT xp, level FROM user_progression WHERE user_id = ?")
    .bind(userId)
    .first<{ xp: number | null; level: number | null }>();
  if (!row) {
    return { leveledUp: false, newLevel: 1, levelsGained: 0 };
  }
  const before = parseProgressionXpLevel(row);
  const next = computeXpAndLevelAfterGain(before.xp, before.level, xpDelta);
  const pointsAdd = Math.max(0, Math.floor(Number(pointsDelta) || 0)) + 100 * next.levelsGained;

  if (next.levelsGained === 0 && next.xp === before.xp && next.level === before.level && pointsAdd === 0) {
    return { leveledUp: false, newLevel: before.level, levelsGained: 0 };
  }

  await db
    .prepare(
      `UPDATE user_progression SET xp = ?, level = ?, points = COALESCE(points, 0) + ?, updated_at = datetime('now') WHERE user_id = ?`,
    )
    .bind(next.xp, next.level, pointsAdd, userId)
    .run();

  if (next.levelsGained > 0) {
    invalidateRankingCache();
    for (let lvl = before.level + 1; lvl <= next.level; lvl += 1) {
      await runMissionLifecycleHookSafely(userId, "on_level_up", () => onLevelUp(db, userId, lvl));
      await runMissionLifecycleHookSafely(userId, "unlock_skills", () => tryUnlockSkillsForLevel(db, userId, lvl));
    }
  } else if (xpDelta !== 0 || pointsDelta !== 0) {
    invalidateRankingCache();
  }

  return {
    leveledUp: next.levelsGained > 0,
    newLevel: next.level,
    levelsGained: next.levelsGained,
  };
}

app.get("/favicon.ico", (c) => {
  return c.body(new Uint8Array(), {
    status: 200,
    headers: {
      "Content-Type": "image/x-icon",
    },
  });
});

const CORS_ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const DEFAULT_CORS_ALLOW_HEADERS = "Content-Type, Authorization";
const CORS_PREFLIGHT_MAX_AGE_SECONDS = "86400";

function resolveCorsAllowHeaders(requestHeaders: Headers): string {
  const requestedHeaders = requestHeaders.get("Access-Control-Request-Headers");
  return requestedHeaders && requestedHeaders.trim().length > 0
    ? requestedHeaders
    : DEFAULT_CORS_ALLOW_HEADERS;
}

function mergeVaryHeader(existingValue: string | null, nextValues: string[]): string {
  const merged = new Set(
    (existingValue ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );

  for (const value of nextValues) {
    merged.add(value);
  }

  return Array.from(merged).join(", ");
}

function applyCorsHeadersToContext(
  c: import("hono").Context<AppContext>,
  origin: string | null,
  allowHeaders: string
) {
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
  }

  c.header("Access-Control-Allow-Headers", allowHeaders);
  c.header("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  c.header("Access-Control-Max-Age", CORS_PREFLIGHT_MAX_AGE_SECONDS);
  c.header(
    "Vary",
    mergeVaryHeader(c.res.headers.get("Vary"), [
      "Origin",
      "Access-Control-Request-Headers",
      "Access-Control-Request-Method",
    ])
  );
}

function applyCorsHeadersToResponseHeaders(
  headers: Headers,
  origin: string | null,
  allowHeaders: string
) {
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  headers.set("Access-Control-Allow-Headers", allowHeaders);
  headers.set("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  headers.set("Access-Control-Max-Age", CORS_PREFLIGHT_MAX_AGE_SECONDS);
  headers.set(
    "Vary",
    mergeVaryHeader(headers.get("Vary"), [
      "Origin",
      "Access-Control-Request-Headers",
      "Access-Control-Request-Method",
    ])
  );
}

app.use("*", async (c, next) => {
  const requestOrigin = c.req.header("Origin");
  const origin = resolveCorsOrigin(requestOrigin, c.env);
  const allowHeaders = resolveCorsAllowHeaders(c.req.raw.headers);

  if (requestOrigin && !origin) {
    if (c.req.method === "OPTIONS") {
      return c.newResponse("", {
        status: 403,
      });
    }

    return c.json(
      {
        error: "Origin não permitida",
        code: "ORIGIN_NOT_ALLOWED",
      },
      403
    );
  }

  applyCorsHeadersToContext(c, origin, allowHeaders);

  if (c.req.method === "OPTIONS") {
    return c.newResponse("", {
      status: 204,
    });
  }

  await next();
});

// Helper: Gera cookie com configuraÃƒÂ§ÃƒÂµes corretas
function shouldUseSecureCookie(requestUrl: string): boolean {
  try {
    return new URL(requestUrl).protocol === "https:";
  } catch {
    return true;
  }
}

function buildSessionCookieAttributes(requestUrl: string, maxAgeSeconds: number): string {
  const secureCookie = shouldUseSecureCookie(requestUrl);
  const attributes = [
    "Path=/",
    "HttpOnly",
    secureCookie ? "SameSite=None" : "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (secureCookie) {
    attributes.push("Secure");
    // Required for reliable cross-site cookie storage when frontend and API are in different domains.
    attributes.push("Partitioned");
  }

  return attributes.join("; ");
}

export function generateCookie(sessionId: string, requestUrl: string) {
  const encodedSessionId = encodeURIComponent(sessionId);
  return `session_id=${encodedSessionId}; ${buildSessionCookieAttributes(requestUrl, 2_592_000)}`;
}

function generateExpiredSessionCookie(requestUrl: string) {
  return `session_id=; ${buildSessionCookieAttributes(requestUrl, 0)}`;
}



// Helpers de senha (PBKDF2)
const encoder = new TextEncoder();

async function deriveKeyFromPassword(password: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  return keyMaterial;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const keyMaterial = await deriveKeyFromPassword(password);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 60_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return toHex(derivedBits);
}

function parseSubscriptionEventLog(raw: string | null): SubscriptionEventLogEntry[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry) => isRecord(entry))
      .map((entry) => {
        const type = typeof entry.type === "string" ? entry.type : "unknown";
        const source = entry.source === "webhook" ? "webhook" : "checkout";
        const status = normalizePlanStatus(typeof entry.status === "string" ? entry.status : "pending");
        const receivedAt = typeof entry.received_at === "string" ? entry.received_at : new Date().toISOString();
        return {
          type,
          source,
          status,
          received_at: receivedAt,
        } satisfies SubscriptionEventLogEntry;
      });
  } catch {
    return [];
  }
}

function serializeSubscriptionEventLog(entries: SubscriptionEventLogEntry[]): string {
  return JSON.stringify(entries.slice(-100));
}

function parseSubscriptionMetadata(raw: string | null): SubscriptionMetadata {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const metadata: SubscriptionMetadata = {};
    if (typeof parsed.customer_name === "string") metadata.customer_name = parsed.customer_name;
    if (typeof parsed.external_status === "string") metadata.external_status = parsed.external_status;
    if (typeof parsed.failure_reason === "string") metadata.failure_reason = parsed.failure_reason;
    if (typeof parsed.last_event_id === "string") metadata.last_event_id = parsed.last_event_id;
    if (typeof parsed.last_event_type === "string") metadata.last_event_type = parsed.last_event_type;
    if (typeof parsed.checkout_tracking_id === "string") metadata.checkout_tracking_id = parsed.checkout_tracking_id;
    if (typeof parsed.checkout_tracking_user_id === "string") metadata.checkout_tracking_user_id = parsed.checkout_tracking_user_id;
    if (typeof parsed.checkout_tracking_plan_id === "string" && isPublicPlanId(parsed.checkout_tracking_plan_id)) {
      metadata.checkout_tracking_plan_id = parsed.checkout_tracking_plan_id;
    }
    if (typeof parsed.promo_code === "string") metadata.promo_code = parsed.promo_code;
    if (typeof parsed.promo_description === "string") metadata.promo_description = parsed.promo_description;
    if (typeof parsed.promo_effect === "string" && isPromoCodeEffect(parsed.promo_effect)) {
      metadata.promo_effect = parsed.promo_effect;
    }
    if (typeof parsed.promo_effect_value === "string") metadata.promo_effect_value = parsed.promo_effect_value;
    return metadata;
  } catch {
    return {};
  }
}

function serializeSubscriptionMetadata(metadata: SubscriptionMetadata): string {
  return JSON.stringify(metadata);
}

const SUBSCRIPTION_SELECT_SQL = `SELECT
  id,
  user_id,
  plan_id,
  status,
  payment_method,
  amount,
  external_order_id,
  external_subscription_id,
  customer_email,
  checkout_url,
  product_id,
  started_at,
  expires_at,
  metadata_json,
  webhook_event_log,
  created_at,
  updated_at
FROM subscriptions`;

async function getSubscriptionById(db: D1Database, subscriptionId: string): Promise<SubscriptionRecord | null> {
  return db
    .prepare(`${SUBSCRIPTION_SELECT_SQL} WHERE id = ?`)
    .bind(subscriptionId)
    .first<SubscriptionRecord>();
}

async function getSubscriptionByExternalOrderId(
  db: D1Database,
  externalOrderId: string,
): Promise<SubscriptionRecord | null> {
  return db
    .prepare(`${SUBSCRIPTION_SELECT_SQL} WHERE external_order_id = ?`)
    .bind(externalOrderId)
    .first<SubscriptionRecord>();
}

async function getLatestSubscriptionByUser(db: D1Database, userId: string): Promise<SubscriptionRecord | null> {
  return db
    .prepare(`${SUBSCRIPTION_SELECT_SQL} WHERE user_id = ? ORDER BY datetime(updated_at) DESC LIMIT 1`)
    .bind(userId)
    .first<SubscriptionRecord>();
}

async function getUserIdByEmail(db: D1Database, email: string): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const row = await db
    .prepare("SELECT id FROM users WHERE lower(email) = ? LIMIT 1")
    .bind(normalizedEmail)
    .first<{ id: string }>();

  return row?.id ?? null;
}

async function recordCaktoWebhookReceipt(
  db: D1Database,
  params: {
    eventId: string;
    eventType: string;
    externalOrderId?: string | null;
    identifiedUserId?: string | null;
    customerEmail?: string | null;
    payloadJson: string;
  },
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT id FROM cakto_webhook_events WHERE id = ? LIMIT 1")
    .bind(params.eventId)
    .first<{ id: string }>();
  if (existing?.id) {
    return false;
  }

  await db.prepare(
    `INSERT INTO cakto_webhook_events (
      id,
      event_type,
      external_order_id,
      identified_user_id,
      customer_email,
      status,
      payload_json,
      received_at
    ) VALUES (?, ?, ?, ?, ?, 'received', ?, datetime('now'))`
  ).bind(
    params.eventId,
    params.eventType,
    params.externalOrderId ?? null,
    params.identifiedUserId ?? null,
    params.customerEmail ?? null,
    params.payloadJson,
  ).run();

  return true;
}

async function updateCaktoWebhookEventStatus(
  db: D1Database,
  eventId: string,
  params: {
    status: CaktoWebhookEventStatus;
    externalOrderId?: string | null;
    identifiedUserId?: string | null;
    customerEmail?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `UPDATE cakto_webhook_events
      SET status = ?,
          external_order_id = COALESCE(?, external_order_id),
          identified_user_id = COALESCE(?, identified_user_id),
          customer_email = COALESCE(?, customer_email),
          error_message = ?,
          processed_at = CASE WHEN ? IN ('processed', 'ignored', 'failed') THEN datetime('now') ELSE processed_at END
      WHERE id = ?`
  ).bind(
    params.status,
    params.externalOrderId ?? null,
    params.identifiedUserId ?? null,
    params.customerEmail ?? null,
    params.errorMessage ?? null,
    params.status,
    eventId,
  ).run();
}

async function ensureSubscriptionRecord(
  db: D1Database,
  params: {
    id?: string | null;
    externalOrderId?: string | null;
    status: PlanStatus;
    eventType: string;
    source: "checkout" | "webhook";
    userId?: string | null;
    planId?: string | null;
    paymentMethod?: string | null;
    amount?: number | null;
    externalSubscriptionId?: string | null;
    customerEmail?: string | null;
    checkoutUrl?: string | null;
    productId?: string | null;
    startedAt?: string | null;
    expiresAt?: string | null;
    metadata?: SubscriptionMetadata | null;
  },
): Promise<SubscriptionRecord | null> {
  const existing =
    (params.externalOrderId ? await getSubscriptionByExternalOrderId(db, params.externalOrderId) : null) ??
    (params.id ? await getSubscriptionById(db, params.id) : null);
  const recordId = existing?.id ?? params.id ?? crypto.randomUUID();
  const nextUserId = params.userId ?? existing?.user_id ?? null;
  const nextPlanId = params.planId ?? existing?.plan_id ?? null;
  const nextPaymentMethodRaw = params.paymentMethod ?? existing?.payment_method ?? null;
  const nextAmountRaw = params.amount ?? existing?.amount ?? null;
  const nextAmount = parseInteger(nextAmountRaw);
  const nextExternalOrderId = params.externalOrderId ?? existing?.external_order_id ?? null;
  const nextExternalSubscriptionId = params.externalSubscriptionId ?? existing?.external_subscription_id ?? null;
  const nextCustomerEmail = params.customerEmail ?? existing?.customer_email ?? null;
  const nextCheckoutUrl = params.checkoutUrl ?? existing?.checkout_url ?? null;
  const nextProductId = params.productId ?? existing?.product_id ?? null;
  const nextStartedAt = params.startedAt ?? existing?.started_at ?? null;
  const nextExpiresAt = params.expiresAt ?? existing?.expires_at ?? null;

  if (!nextUserId || !nextPlanId || !nextPaymentMethodRaw || nextAmount === null) {
    return null;
  }

  const nextPaymentMethod = normalizeUserPaymentMethod(nextPaymentMethodRaw);
  if (nextPaymentMethod === "none") {
    return null;
  }

  const nextStatus = normalizePlanStatus(params.status);
  const nextLog = parseSubscriptionEventLog(existing?.webhook_event_log ?? null);
  nextLog.push({
    type: params.eventType,
    source: params.source,
    status: nextStatus,
    received_at: new Date().toISOString(),
  });
  const serializedLog = serializeSubscriptionEventLog(nextLog);
  const nextMetadata: SubscriptionMetadata = {
    ...parseSubscriptionMetadata(existing?.metadata_json ?? null),
    ...(params.metadata ?? {}),
  };
  const serializedMetadata = serializeSubscriptionMetadata(nextMetadata);

  if (existing) {
    await db.prepare(
      `UPDATE subscriptions
      SET user_id = ?, plan_id = ?, status = ?, payment_method = ?, amount = ?, external_order_id = ?, external_subscription_id = ?, customer_email = ?, checkout_url = ?, product_id = ?, started_at = ?, expires_at = ?, metadata_json = ?, webhook_event_log = ?, updated_at = datetime('now')
      WHERE id = ?`
    ).bind(
      nextUserId,
      nextPlanId,
      nextStatus,
      nextPaymentMethod,
      nextAmount,
      nextExternalOrderId,
      nextExternalSubscriptionId,
      nextCustomerEmail,
      nextCheckoutUrl,
      nextProductId,
      nextStartedAt,
      nextExpiresAt,
      serializedMetadata,
      serializedLog,
      recordId,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO subscriptions (
        id, user_id, plan_id, status, payment_method, amount, external_order_id, external_subscription_id, customer_email, checkout_url, product_id, started_at, expires_at, metadata_json, webhook_event_log, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(
      recordId,
      nextUserId,
      nextPlanId,
      nextStatus,
      nextPaymentMethod,
      nextAmount,
      nextExternalOrderId,
      nextExternalSubscriptionId,
      nextCustomerEmail,
      nextCheckoutUrl,
      nextProductId,
      nextStartedAt,
      nextExpiresAt,
      serializedMetadata,
      serializedLog,
    ).run();
  }

  return getSubscriptionById(db, recordId);
}

async function syncUserPlanFromSubscription(
  db: D1Database,
  subscription: SubscriptionRecord,
  options?: {
    preserveActiveAccess?: boolean;
    keepCurrentState?: boolean;
    markOnboardingCompleted?: boolean;
  },
): Promise<void> {
  const preserveActiveAccess = options?.preserveActiveAccess === true;
  const keepCurrentState = options?.keepCurrentState === true;
  const currentUser = await getUserAuthRecordById(db, subscription.user_id);

  if (keepCurrentState && currentUser) {
    return;
  }

  const nextPlanId = normalizePlanId(subscription.plan_id);
  const nextStatus = normalizePlanStatus(subscription.status);
  const nextPaymentMethod = normalizeUserPaymentMethod(subscription.payment_method);

  if (preserveActiveAccess && currentUser && hasPlanAccess(currentUser.plan_id, currentUser.plan_status)) {
    await updateUserPlanState(db, subscription.user_id, {
      planId: currentUser.plan_id,
      status: currentUser.plan_status,
      paymentMethod: nextPaymentMethod === "none" ? currentUser.payment_method : nextPaymentMethod,
      markOnboardingCompleted: options?.markOnboardingCompleted ?? false,
    });
    return;
  }

  await updateUserPlanState(db, subscription.user_id, {
    planId: nextPlanId,
    status: nextStatus,
    paymentMethod: nextPaymentMethod,
    markOnboardingCompleted: options?.markOnboardingCompleted ?? false,
  });
}

function resolveCheckoutAmount(planId: PublicPlanId): number {
  return CHECKOUT_PLAN_CATALOG[planId].amount;
}

function resolveCheckoutUrl(planId: PublicPlanId): string {
  return CHECKOUT_PLAN_CATALOG[planId].checkout_url;
}

function resolveCheckoutProductId(planId: PublicPlanId): string {
  return CHECKOUT_PLAN_CATALOG[planId].product_id;
}

async function startCheckoutForUser(
  db: D1Database,
  env: Env,
  params: {
    userId: string;
    planId: PublicPlanId;
    paymentMethod: CheckoutPaymentMethod;
    cardNumber?: string | undefined;
    cardHolderName?: string | undefined;
    cardExpiry?: string | undefined;
    promoCode?: string | undefined;
    markOnboardingCompleted: boolean;
  },
): Promise<CheckoutStartResult> {
  const normalizedPromoCode = normalizePromoCodeValue(params.promoCode);
  const appliedPromo =
    normalizedPromoCode.length > 0
      ? await applyPromoCodeForUser(db, env, {
        userId: params.userId,
        code: normalizedPromoCode,
        markOnboardingCompleted: params.markOnboardingCompleted,
      })
      : null;

  if (normalizedPromoCode.length > 0 && !appliedPromo) {
    throw createInvalidPromoCodeError();
  }

  if (appliedPromo?.vip_activated) {
    return {
      checkout_status: "vip_active",
      plan_id: "vip",
      plan_status: "active",
      payment_method: appliedPromo.payment_method ?? "card",
      amount: 0,
      checkout_url: null,
      product_id: null,
      subscription_id: appliedPromo.subscription_id ?? crypto.randomUUID(),
      message: "Código promocional aplicado. Seu acesso VIP foi liberado.",
    };
  }

  const subscriptionId = crypto.randomUUID();
  const amount = resolveCheckoutAmount(params.planId);
  const checkoutUrl = buildTrackedCheckoutUrl(resolveCheckoutUrl(params.planId), {
    checkoutId: subscriptionId,
    userId: params.userId,
    planId: params.planId,
  });
  const productId = resolveCheckoutProductId(params.planId);
  const pendingSubscription = await ensureSubscriptionRecord(db, {
    id: subscriptionId,
    userId: params.userId,
    planId: params.planId,
    status: "pending",
    paymentMethod: params.paymentMethod,
    amount,
    eventType: "checkout.started",
    source: "checkout",
    checkoutUrl,
    productId,
    metadata: {
      checkout_tracking_id: subscriptionId,
      checkout_tracking_user_id: params.userId,
      checkout_tracking_plan_id: params.planId,
      last_event_type: "checkout.started",
      promo_code: appliedPromo?.code,
      promo_description: appliedPromo?.description,
      promo_effect: appliedPromo?.effect,
      promo_effect_value: appliedPromo?.effect_value ?? undefined,
    },
  });

  if (!pendingSubscription) {
    throw new Error("Failed to create pending checkout.");
  }

  if (appliedPromo) {
    await attachPromoCodeUsageToSubscription(db, appliedPromo.promo_code_id, params.userId, pendingSubscription.id);
  }

  const currentUser = await getUserAuthRecordById(db, params.userId);
  if (!currentUser || !hasPlanAccess(currentUser.plan_id, currentUser.plan_status)) {
    await updateUserPlanState(db, params.userId, {
      planId: params.planId,
      status: "pending",
      paymentMethod: params.paymentMethod,
      markOnboardingCompleted: false,
    });
  }

  return {
    checkout_status: "pending",
    plan_id: params.planId,
    plan_status: "pending",
    payment_method: params.paymentMethod,
    amount,
    checkout_url: checkoutUrl,
    product_id: productId,
    subscription_id: subscriptionId,
    message: "Pagamento iniciado. Aguarde a confirmação para liberar o acesso.",
  };
}

type CaktoUserSyncMode = "apply" | "preserve-active" | "keep-current";

function resolveCaktoSyncMode(eventType: string): { status: PlanStatus; syncMode: CaktoUserSyncMode; paymentMethod: UserPaymentMethod | null } {
  switch (eventType) {
    case "purchase_approved":
    case "subscription_created":
    case "subscription_renewed":
      return { status: "active", syncMode: "apply", paymentMethod: null };
    case "subscription_canceled":
      return { status: "cancelled", syncMode: "apply", paymentMethod: null };
    case "purchase_refused":
      return { status: "failed", syncMode: "keep-current", paymentMethod: null };
    case "checkout_abandonment":
      return { status: "pending", syncMode: "keep-current", paymentMethod: null };
    default:
      return { status: "pending", syncMode: "preserve-active", paymentMethod: null };
  }
}

function mergeCaktoOrderSnapshots(primary: CaktoOrderSnapshot, fallback: CaktoOrderSnapshot | null): CaktoOrderSnapshot {
  if (!fallback) return primary;

  return {
    eventType: primary.eventType ?? fallback.eventType,
    eventId: primary.eventId ?? fallback.eventId,
    secret: primary.secret ?? fallback.secret,
    externalOrderId: primary.externalOrderId ?? fallback.externalOrderId,
    externalSubscriptionId: primary.externalSubscriptionId ?? fallback.externalSubscriptionId,
    checkoutUrl: primary.checkoutUrl ?? fallback.checkoutUrl,
    customerEmail: primary.customerEmail ?? fallback.customerEmail,
    customerName: primary.customerName ?? fallback.customerName,
    paymentMethod: primary.paymentMethod !== "none" ? primary.paymentMethod : fallback.paymentMethod,
    planId: primary.planId ?? fallback.planId,
    productId: primary.productId ?? fallback.productId,
    productName: primary.productName ?? fallback.productName,
    amountCents: primary.amountCents ?? fallback.amountCents,
    externalStatus: primary.externalStatus ?? fallback.externalStatus,
    startedAt: primary.startedAt ?? fallback.startedAt,
    expiresAt: primary.expiresAt ?? fallback.expiresAt,
    failureReason: primary.failureReason ?? fallback.failureReason,
    tracking: {
      checkoutId: primary.tracking.checkoutId ?? fallback.tracking.checkoutId,
      userId: primary.tracking.userId ?? fallback.tracking.userId,
      planId: primary.tracking.planId ?? fallback.tracking.planId,
    },
    rawEvent: primary.rawEvent,
    rawData: Object.keys(primary.rawData).length > 0 ? primary.rawData : fallback.rawData,
  };
}

async function hashWebhookBody(rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(rawBody));
  return toHex(digest);
}

async function resolveCaktoWebhookEventId(snapshot: CaktoOrderSnapshot, rawBody: string): Promise<string> {
  if (snapshot.eventId) return snapshot.eventId;
  const hashed = await hashWebhookBody(rawBody);
  return `${snapshot.eventType ?? "unknown"}:${hashed}`;
}

async function resolveWebhookUserIdFromSnapshot(db: D1Database, snapshot: CaktoOrderSnapshot): Promise<string | null> {
  if (snapshot.tracking.userId) {
    const trackedUser = await getUserAuthRecordById(db, snapshot.tracking.userId);
    if (trackedUser?.id) return trackedUser.id;
  }

  if (snapshot.customerEmail) {
    return getUserIdByEmail(db, snapshot.customerEmail);
  }

  return null;
}

async function resolveSubscriptionAnchorId(
  db: D1Database,
  snapshot: CaktoOrderSnapshot,
  userId: string | null,
): Promise<string | null> {
  if (snapshot.tracking.checkoutId) {
    return snapshot.tracking.checkoutId;
  }

  if (!userId) return null;

  const latest = await getLatestSubscriptionByUser(db, userId);
  if (!latest) return null;
  if (normalizePlanStatus(latest.status) !== "pending") return null;
  if (snapshot.planId && latest.plan_id !== snapshot.planId) return null;
  return latest.id;
}

async function enrichCaktoSnapshotFromApi(
  env: Env,
  snapshot: CaktoOrderSnapshot,
): Promise<CaktoOrderSnapshot> {
  const shouldFetchByOrderId =
    Boolean(snapshot.externalOrderId) &&
    (!snapshot.customerEmail || !snapshot.planId || snapshot.amountCents === null || snapshot.paymentMethod === "none");

  if (shouldFetchByOrderId && snapshot.externalOrderId) {
    try {
      const order = await fetchCaktoOrderById(env, snapshot.externalOrderId, CAKTO_PLAN_CATALOG);
      return mergeCaktoOrderSnapshots(snapshot, order);
    } catch (error) {
      console.error("[cakto][order-by-id]", {
        orderId: snapshot.externalOrderId,
        message: getErrorMessage(error),
      });
    }
  }

  const shouldFetchByCustomer =
    Boolean(snapshot.customerEmail) &&
    (!snapshot.externalOrderId || !snapshot.planId || snapshot.amountCents === null);

  if (shouldFetchByCustomer && snapshot.customerEmail) {
    try {
      const order = await fetchLatestCaktoOrderByCustomer(env, snapshot.customerEmail, CAKTO_PLAN_CATALOG);
      return mergeCaktoOrderSnapshots(snapshot, order);
    } catch (error) {
      console.error("[cakto][order-by-customer]", {
        customerEmail: snapshot.customerEmail,
        message: getErrorMessage(error),
      });
    }
  }

  return snapshot;
}

async function processCaktoWebhook(
  c: import("hono").Context<AppContext>,
  rawBody: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const initialSnapshot = parseCaktoWebhookPayload(payload, CAKTO_PLAN_CATALOG);
  const eventType = initialSnapshot.eventType;
  const eventId = await resolveCaktoWebhookEventId(initialSnapshot, rawBody);

  if (!eventType || !WEBHOOK_SUPPORTED_EVENTS.has(eventType)) {
    const registered = await recordCaktoWebhookReceipt(c.env.fitloot_db, {
      eventId,
      eventType: eventType ?? "unknown",
      externalOrderId: initialSnapshot.externalOrderId,
      customerEmail: initialSnapshot.customerEmail,
      payloadJson: rawBody,
    });
    if (registered) {
      await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
        status: "ignored",
        externalOrderId: initialSnapshot.externalOrderId,
        customerEmail: initialSnapshot.customerEmail,
      });
    }
    return;
  }

  const registered = await recordCaktoWebhookReceipt(c.env.fitloot_db, {
    eventId,
    eventType,
    externalOrderId: initialSnapshot.externalOrderId,
    customerEmail: initialSnapshot.customerEmail,
    payloadJson: rawBody,
  });

  if (!registered) {
    console.info("[cakto][webhook][duplicate]", { eventId, eventType });
    return;
  }

  console.info("[cakto][webhook][payload]", {
    eventId,
    eventType,
    payload,
  });

  await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
    status: "processing",
    externalOrderId: initialSnapshot.externalOrderId,
    customerEmail: initialSnapshot.customerEmail,
  });

  try {
    const snapshot = await enrichCaktoSnapshotFromApi(c.env, initialSnapshot);
    const userId = await resolveWebhookUserIdFromSnapshot(c.env.fitloot_db, snapshot);
    if (!userId) {
      await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
        status: "failed",
        externalOrderId: snapshot.externalOrderId,
        customerEmail: snapshot.customerEmail,
        errorMessage: "USER_NOT_IDENTIFIED",
      });
      return;
    }

    const anchorId = await resolveSubscriptionAnchorId(c.env.fitloot_db, snapshot, userId);
    const latestSubscription = await getLatestSubscriptionByUser(c.env.fitloot_db, userId);
    const effectivePlanId =
      snapshot.planId ??
      (latestSubscription && isPublicPlanId(latestSubscription.plan_id) ? latestSubscription.plan_id : null);
    const effectiveAmount =
      snapshot.amountCents ??
      (latestSubscription ? Number(latestSubscription.amount) : null) ??
      (effectivePlanId ? resolveCheckoutAmount(effectivePlanId) : null);
    const syncRule = resolveCaktoSyncMode(eventType);
    const paymentMethod =
      syncRule.paymentMethod ??
      (snapshot.paymentMethod !== "none" ? snapshot.paymentMethod : normalizeUserPaymentMethod(latestSubscription?.payment_method));

    if (!effectivePlanId || effectiveAmount === null || paymentMethod === "none") {
      await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
        status: "failed",
        externalOrderId: snapshot.externalOrderId,
        identifiedUserId: userId,
        customerEmail: snapshot.customerEmail,
        errorMessage: "INSUFFICIENT_CHECKOUT_CONTEXT",
      });
      return;
    }

    const subscription = await ensureSubscriptionRecord(c.env.fitloot_db, {
      id: anchorId,
      externalOrderId: snapshot.externalOrderId,
      externalSubscriptionId: snapshot.externalSubscriptionId,
      userId,
      planId: effectivePlanId,
      status: syncRule.status,
      paymentMethod,
      amount: effectiveAmount,
      customerEmail: snapshot.customerEmail,
      checkoutUrl: snapshot.checkoutUrl,
      productId: snapshot.productId,
      startedAt: snapshot.startedAt ?? (syncRule.status === "active" ? new Date().toISOString() : null),
      expiresAt: snapshot.expiresAt,
      eventType,
      source: "webhook",
      metadata: {
        customer_name: snapshot.customerName ?? undefined,
        external_status: snapshot.externalStatus ?? undefined,
        failure_reason: snapshot.failureReason ?? undefined,
        last_event_id: eventId,
        last_event_type: eventType,
        checkout_tracking_id: snapshot.tracking.checkoutId ?? undefined,
        checkout_tracking_user_id: userId,
        checkout_tracking_plan_id: effectivePlanId,
      },
    });

    if (!subscription) {
      await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
        status: "failed",
        externalOrderId: snapshot.externalOrderId,
        identifiedUserId: userId,
        customerEmail: snapshot.customerEmail,
        errorMessage: "SUBSCRIPTION_UPSERT_FAILED",
      });
      return;
    }

    await syncUserPlanFromSubscription(c.env.fitloot_db, subscription, {
      keepCurrentState: syncRule.syncMode === "keep-current",
      preserveActiveAccess: syncRule.syncMode === "preserve-active",
      markOnboardingCompleted: true,
    });

    await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
      status: "processed",
      externalOrderId: snapshot.externalOrderId,
      identifiedUserId: userId,
      customerEmail: snapshot.customerEmail,
    });
  } catch (error) {
    console.error("[cakto][webhook][process]", {
      message: getErrorMessage(error),
      payload,
    });
    await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
      status: "failed",
      externalOrderId: initialSnapshot.externalOrderId,
      customerEmail: initialSnapshot.customerEmail,
      errorMessage: getErrorMessage(error),
    });
  }
}

// Auth endpoints (e-mail/senha)
app.post(
  "/api/auth/register",
  zValidator("json", AuthRegisterRequestSchema),
  async (c) => {
    const schemaReady = await hasCoreSchema(c.env.fitloot_db);
    if (!schemaReady) return databaseNotInitializedResponse(c);

    try {
      const data = c.req.valid("json");

      const existing = await c.env.fitloot_db
        .prepare("SELECT id FROM users WHERE email = ?")
        .bind(data.email)
        .first();

      if (existing) {
        return c.json({ error: "E-mail jÃƒÂ¡ cadastrado" }, 409);
      }

      const userId = crypto.randomUUID();
      const salt = crypto.randomUUID();
      const passwordHash = await hashPassword(data.password, salt);

      await c.env.fitloot_db
        .prepare(
          "INSERT INTO users (id, email, name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(userId, data.email, data.name ?? "", passwordHash, salt)
        .run();

      const [planIdColumnExists, planStatusColumnExists, paymentMethodColumnExists, onboardingColumnExists] = await Promise.all([
        hasTableColumn(c.env.fitloot_db, "users", "plan_id"),
        hasTableColumn(c.env.fitloot_db, "users", "plan_status"),
        hasTableColumn(c.env.fitloot_db, "users", "payment_method"),
        hasTableColumn(c.env.fitloot_db, "users", "onboarding_completed"),
      ]);

      if (planIdColumnExists && planStatusColumnExists) {
        const assignments = ["plan_id = 'basic'", "plan_status = 'failed'"];
        if (paymentMethodColumnExists) {
          assignments.push("payment_method = 'none'");
        }
        if (onboardingColumnExists) {
          assignments.push("onboarding_completed = 0");
        }

        await c.env.fitloot_db
          .prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`)
          .bind(userId)
          .run();
      }

      return c.json({ success: true }, 201);
    } catch (error) {
      console.error("[register]", error);
      return c.json(
        { error: "Erro interno ao criar usuÃƒÂ¡rio", code: "INTERNAL_ERROR" },
        500
      );
    }
  }
);

app.get("/api/auth/check-availability", async (c) => {
  const emailQuery = (c.req.query("email") || "").trim().toLowerCase();
  const usernameQuery = (c.req.query("username") || "").trim();

  if (!emailQuery && !usernameQuery) {
    return c.json({
      emailAvailable: null,
      usernameAvailable: null,
      message: "Informe email e/ou username para validaÃƒÂ§ÃƒÂ£o.",
    }, 400);
  }

  try {
    const [emailExisting, usernameExisting] = await Promise.all([
      emailQuery
        ? c.env.fitloot_db.prepare("SELECT id FROM users WHERE lower(email) = ?").bind(emailQuery).first<{ id: string }>()
        : Promise.resolve(null),
      usernameQuery
        ? c.env.fitloot_db.prepare("SELECT id FROM user_profiles WHERE username = ?").bind(usernameQuery).first<{ id: string }>()
        : Promise.resolve(null),
    ]);

    return c.json({
      emailAvailable: emailQuery ? !emailExisting : null,
      usernameAvailable: usernameQuery ? !usernameExisting : null,
    });
  } catch (error) {
    console.error("[check-availability]", error);
    return c.json({ error: "Falha ao validar disponibilidade." }, 500);
  }
});

app.post(
  "/api/auth/login",
  zValidator("json", LoginRequestSchema),
  async (c) => {
    const schemaReady = await hasCoreSchema(c.env.fitloot_db);
    if (!schemaReady) return databaseNotInitializedResponse(c);

    const data = c.req.valid("json");

    const userRow = await c.env.fitloot_db
      .prepare(
        "SELECT id, password_hash, password_salt FROM users WHERE email = ?"
      )
      .bind(data.email)
      .first<{
        id: string;
        password_hash: string | null;
        password_salt: string | null;
      }>();

    if (!userRow) {
      return c.json(
        { error: "Nenhuma conta encontrada com esse e-mail.", code: "USER_NOT_FOUND" },
        404
      );
    }

    if (!userRow.password_hash || !userRow.password_salt) {
      return c.json({ error: "Credenciais invÃƒÂ¡lidas" }, 401);
    }

    const computed = await hashPassword(data.password, userRow.password_salt);
    if (computed !== userRow.password_hash) {
      return c.json({ error: "Credenciais invÃƒÂ¡lidas" }, 401);
    }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    await c.env.fitloot_db
      .prepare(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
      )
      .bind(sessionId, userRow.id, expiresAt)
      .run();

    const cookie = generateCookie(sessionId, c.req.url);
    c.header("Set-Cookie", cookie);

    return c.json({ success: true }, 200);
  }
);

app.get("/api/users/me", authMiddleware, async (c) => {
  const user = c.get("user");

  try {
    if (!user?.id) {
      return c.json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado", code: "USER_NOT_FOUND" }, 404);
    }

    const userRecord = await getUserAuthRecordById(c.env.fitloot_db, user.id);
    const profileRecord = await c.env.fitloot_db.prepare(
      "SELECT showcased_achievements FROM user_profiles WHERE user_id = ?"
    ).bind(user.id).first<{ showcased_achievements?: string | null }>();

    if (!userRecord) {
      return c.json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado", code: "USER_NOT_FOUND" }, 404);
    }

    return c.json({
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      avatar_url: userRecord.avatar_url ?? undefined,
      showcased_achievements: profileRecord?.showcased_achievements ?? null,
      onboarding_completed: userRecord.onboarding_completed,
      plan_id: userRecord.plan_id,
      plan_status: userRecord.plan_status,
      payment_method: userRecord.payment_method,
    });
  } catch (err) {
    console.error("[/api/users/me] Erro interno:", {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      userId: user?.id,
    });

    if (isMissingSchemaError(err)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/app/open", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const timestamp = new Date().toISOString();
    await onAppOpen(c.env.fitloot_db, user.id, timestamp);
    return c.json({ success: true });
  } catch (error) {
    console.error("[/api/app/open]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return c.json({ success: true, degraded: true }, 200);
    }

    return internalErrorResponse(c);
  }
});

app.post('/api/events/route-not-found', authMiddleware, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    await logUserEvent(c.env.fitloot_db, user.id, 'onRouteNotFound', {});
    await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, '404 Not Found', 1, 1);
    return c.json({ success: true });
  } catch (error) {
    console.error("[/api/events/route-not-found]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return c.json({ success: true, degraded: true }, 200);
    }

    return internalErrorResponse(c);
  }
});

app.patch(
  "/api/users/me",
  authMiddleware,
  zValidator("json", UpdateMeRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const data = c.req.valid("json");

    if (data.name !== undefined) {
      await c.env.fitloot_db
        .prepare("UPDATE users SET name = ? WHERE id = ?")
        .bind(data.name, user.id)
        .run();
    }
    if (data.photo_url !== undefined) {
      await c.env.fitloot_db
        .prepare("UPDATE users SET avatar_url = ? WHERE id = ?")
        .bind(data.photo_url || null, user.id)
        .run();
    }

    await onProfileCustomization(c.env.fitloot_db, user.id, {
      name_changed: data.name !== undefined,
      photo_changed: data.photo_url !== undefined,
    });

    const updated = await getUserAuthRecordById(c.env.fitloot_db, user.id);
    return c.json(updated ?? c.get("user"));
  }
);

app.post(
  "/api/users/plan",
  authMiddleware,
  zValidator("json", UserPlanRequestSchema),
  async (c) => {
    c.req.valid("json");
    return c.json(
      {
        error: "Endpoint desativado para evitar atualização manual de plano. Use o fluxo de checkout.",
        code: "PLAN_ENDPOINT_DISABLED",
      },
      410
    );
  }
);

app.post(
  "/api/promo/validate",
  zValidator("json", PromoCodeRequestSchema),
  async (c) => {
    const schemaReady = await hasCoreSchema(c.env.fitloot_db);
    if (!schemaReady) {
      return databaseNotInitializedResponse(c);
    }

    try {
      const data = c.req.valid("json");
      const promoValidation = await validatePromoCodeRecord(c.env.fitloot_db, data.code);

      if (!promoValidation) {
        return c.json({ valid: false, message: "Código inválido ou expirado" }, 200);
      }

      if (promoValidation.effect === "activate_vip" && !matchesVipActivationCode(c.env, normalizePromoCodeValue(data.code))) {
        return c.json({ valid: false, message: "Código inválido ou expirado" }, 200);
      }

      return c.json({
        valid: true,
        description: promoValidation.description,
        effect: promoValidation.effect,
        effect_value: promoValidation.effectValue,
      });
    } catch (error) {
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      throw error;
    }
  }
);

app.post(
  "/api/promo/apply",
  authMiddleware,
  zValidator("json", PromoCodeRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const data = c.req.valid("json");
      const appliedPromo = await withTransaction(c.env.fitloot_db, async () => (
        applyPromoCodeForUser(c.env.fitloot_db, c.env, {
          userId: user.id,
          code: data.code,
          markOnboardingCompleted: Number(user.onboarding_completed) === 1,
        })
      ));

      if (!appliedPromo) {
        return c.json({ valid: false, message: "Código inválido ou expirado" }, 400);
      }

      const refreshedUser = await getUserAuthRecordById(c.env.fitloot_db, user.id);
      return c.json({
        success: true,
        valid: true,
        ...appliedPromo,
        user: refreshedUser,
      });
    } catch (error) {
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      throw error;
    }
  }
);

app.post(
  "/api/checkout/start",
  authMiddleware,
  zValidator("json", CheckoutStartRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const data = c.req.valid("json");
      const checkoutResult = await withTransaction(c.env.fitloot_db, async () => (
        startCheckoutForUser(c.env.fitloot_db, c.env, {
          userId: user.id,
          planId: data.plan_id,
          paymentMethod: data.payment_method,
          cardNumber: data.card_number,
          cardHolderName: data.card_holder_name,
          cardExpiry: data.card_expiry,
          promoCode: data.promo_code,
          markOnboardingCompleted: false,
        })
      ));

      const refreshedUser = await getUserAuthRecordById(c.env.fitloot_db, user.id);

      return c.json({
        success: true,
        ...checkoutResult,
        user: refreshedUser,
      });
    } catch (error) {
      if (isInvalidPromoCodeError(error)) {
        return c.json({ error: "Código inválido ou expirado" }, 400);
      }
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      throw error;
    }
  }
);

app.get("/api/subscription/status", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const [latestSubscription, refreshedUser] = await Promise.all([
    getLatestSubscriptionByUser(c.env.fitloot_db, user.id),
    getUserAuthRecordById(c.env.fitloot_db, user.id),
  ]);

  if (!refreshedUser) {
    return c.json({ error: "Usuário não encontrado", code: "USER_NOT_FOUND" }, 404);
  }

  const effectivePublicPlanId =
    normalizePublicPlanIdFromValue(latestSubscription?.plan_id ?? null) ??
    (isPublicPlanId(refreshedUser.plan_id) ? refreshedUser.plan_id : null);
  const currentPlanAmount = effectivePublicPlanId ? resolveCheckoutAmount(effectivePublicPlanId) : 0;
  const checkoutUrl =
    latestSubscription?.checkout_url ??
    (effectivePublicPlanId ? resolveCheckoutUrl(effectivePublicPlanId) : null);
  const productId =
    latestSubscription?.product_id ??
    (effectivePublicPlanId ? resolveCheckoutProductId(effectivePublicPlanId) : null);

  return c.json({
    plan_id: refreshedUser.plan_id,
    plan_status: refreshedUser.plan_status,
    payment_method: refreshedUser.payment_method,
    has_access: Number(refreshedUser.onboarding_completed) === 1 && hasPlanAccess(refreshedUser.plan_id, refreshedUser.plan_status),
    amount: latestSubscription ? Number(latestSubscription.amount) : currentPlanAmount,
    checkout_url: checkoutUrl,
    product_id: productId,
    subscription: latestSubscription
      ? {
        id: latestSubscription.id,
        status: normalizePlanStatus(latestSubscription.status),
        payment_method: normalizeUserPaymentMethod(latestSubscription.payment_method),
        amount: Number(latestSubscription.amount),
        external_order_id: latestSubscription.external_order_id,
        external_subscription_id: latestSubscription.external_subscription_id,
        customer_email: latestSubscription.customer_email,
        started_at: latestSubscription.started_at,
        expires_at: latestSubscription.expires_at,
        updated_at: latestSubscription.updated_at,
      }
      : null,
  });
});

async function handleCaktoWebhookRequest(c: import("hono").Context<AppContext>) {
  const rawBody = await c.req.text();

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!isRecord(parsed)) {
      return c.json({ received: true, ignored: true }, 200);
    }
    payload = parsed;
  } catch {
    return c.json({ received: true, ignored: true }, 200);
  }

  const configuredSecret =
    (typeof c.env.CAKTO_WEBHOOK_SECRET === "string" && c.env.CAKTO_WEBHOOK_SECRET.trim()) ||
    (typeof c.env.WEBHOOK_SECRET === "string" && c.env.WEBHOOK_SECRET.trim()) ||
    "";
  const receivedSecret = resolveWebhookSecret(payload, c.req.raw.headers);

  if (configuredSecret && receivedSecret !== configuredSecret) {
    return c.json({ error: "Unauthorized", code: "CAKTO_WEBHOOK_SECRET_INVALID" }, 401);
  }

  c.executionCtx.waitUntil(processCaktoWebhook(c, rawBody, payload));
  return c.json({ received: true }, 200);
}

app.post("/api/cakto/webhook", async (c) => handleCaktoWebhookRequest(c));
app.post("/api/webhook/payment", async (c) => handleCaktoWebhookRequest(c));

app.get("/api/logout", async (c) => {
  const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));
  let accountReset = false;

  if (sessionId) {
    try {
      const session = await c.env.fitloot_db
        .prepare("SELECT user_id FROM sessions WHERE id = ?")
        .bind(sessionId)
        .first<{ user_id: string }>();

      if (session?.user_id) {
        const userRecord = await getUserAuthRecordById(c.env.fitloot_db, session.user_id);
        if (userRecord && shouldPurgeUserOnLogout(userRecord)) {
          await purgeUserAccountData(c.env.fitloot_db, session.user_id);
          accountReset = true;
        } else {
          await c.env.fitloot_db
            .prepare("DELETE FROM sessions WHERE id = ?")
            .bind(sessionId)
            .run();
        }
      } else {
        await c.env.fitloot_db
          .prepare("DELETE FROM sessions WHERE id = ?")
          .bind(sessionId)
          .run();
      }
    } catch (error) {
      console.error("[/api/logout][cleanup]", {
        message: getErrorMessage(error),
      });
      return c.json({ error: "Erro ao encerrar sessão", code: "LOGOUT_CLEANUP_FAILED" }, 500);
    }
  }

  c.header(
    "Set-Cookie",
    generateExpiredSessionCookie(c.req.url)
  );

  return c.json({ success: true, account_reset: accountReset });
});


// User profile endpoints
app.get("/api/profile", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    if (Number(user.onboarding_completed ?? 0) !== 1) {
      return c.json({ error: "Perfil nao encontrado", code: "PROFILE_NOT_FOUND" }, 404);
    }

    const profile = await c.env.fitloot_db.prepare(
      "SELECT * FROM user_profiles WHERE user_id = ?"
    ).bind(user.id).first();

    if (!profile) {
      return c.json({ error: "Perfil nao encontrado", code: "PROFILE_NOT_FOUND" }, 404);
    }

    return c.json(profile);
  } catch (error) {
    console.error("[/api/profile]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/profile/customization", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const customPrimaryColor = typeof body.custom_primary_color === 'string' ? body.custom_primary_color : null;
  const customSecondaryColor = typeof body.custom_secondary_color === 'string' ? body.custom_secondary_color : null;
  const customBackgroundType = typeof body.custom_background_type === 'string' ? body.custom_background_type : null;
  const customBackgroundValue = typeof body.custom_background_value === 'string' ? body.custom_background_value : null;
  const customFont = typeof body.custom_font === 'string' ? body.custom_font : null;
  const customTitleId = Number.isFinite(Number(body.custom_title_id)) ? Number(body.custom_title_id) : null;
  const showcasedAchievements = Array.isArray(body.showcased_achievements) ? JSON.stringify(body.showcased_achievements) : null;

  await c.env.fitloot_db.prepare(
    `UPDATE user_profiles SET
      custom_primary_color = COALESCE(?, custom_primary_color),
      custom_secondary_color = COALESCE(?, custom_secondary_color),
      custom_background_type = COALESCE(?, custom_background_type),
      custom_background_value = COALESCE(?, custom_background_value),
      custom_font = COALESCE(?, custom_font),
      custom_title_id = COALESCE(?, custom_title_id),
      showcased_achievements = COALESCE(?, showcased_achievements),
      updated_at = datetime('now')
      WHERE user_id = ?`
  ).bind(customPrimaryColor, customSecondaryColor, customBackgroundType, customBackgroundValue, customFont, customTitleId, showcasedAchievements, user.id).run();

  await onProfileCustomization(c.env.fitloot_db, user.id, {
    custom_primary_color: customPrimaryColor,
    custom_secondary_color: customSecondaryColor,
    custom_background_type: customBackgroundType,
    custom_background_value: customBackgroundValue,
    custom_font: customFont,
    custom_title_id: customTitleId,
    showcased_achievements: showcasedAchievements,
  });

  const done = [customPrimaryColor, customSecondaryColor, customBackgroundType, customBackgroundValue, customFont, customTitleId, showcasedAchievements]
    .every((v) => v !== null && v !== undefined && v !== "");
  if (done) {
    await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, "Mestre ArtesÃƒÂ£o", 1, 1);
  }

  const profile = await c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first();
  return c.json({ success: true, profile });
});

app.post("/api/profile/skill-focus", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { active_skill_focus?: string | undefined };
  const focus = body.active_skill_focus === 'yoga' ? 'yoga' : 'calistenia';
  await c.env.fitloot_db.prepare("UPDATE user_profiles SET active_skill_focus = ?, updated_at = datetime('now') WHERE user_id = ?")
    .bind(focus, user.id).run();

  return c.json({ success: true, active_skill_focus: focus });
});

app.post("/api/profile/goal", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { main_goal?: string | undefined };
  const newGoal = String(body.main_goal ?? '').trim();
  if (!newGoal) return c.json({ error: 'main_goal obrigatÃƒÂ³rio' }, 400);

  const current = await c.env.fitloot_db.prepare("SELECT main_goal FROM user_profiles WHERE user_id = ?").bind(user.id).first<{ main_goal: string | null }>();
  const oldGoal = current?.main_goal ?? 'saude_geral';

  await c.env.fitloot_db.prepare("UPDATE user_profiles SET main_goal = ?, updated_at = datetime('now') WHERE user_id = ?").bind(newGoal, user.id).run();
  await ensureGoalStatsRow(c.env.fitloot_db, user.id, newGoal);

  const stats = await c.env.fitloot_db.prepare("SELECT goal_change_count, original_goal, completed_goals FROM user_goal_stats WHERE user_id = ?").bind(user.id).first<{ goal_change_count: number; original_goal: string; completed_goals: string | null }>();
  const changeCount = Number(stats?.goal_change_count ?? 0) + (oldGoal !== newGoal ? 1 : 0);
  const completedGoals = new Set<string>(JSON.parse(stats?.completed_goals || '[]'));
  if (oldGoal) completedGoals.add(oldGoal);

  let returned = 0;
  if ((stats?.original_goal ?? oldGoal) === newGoal && oldGoal !== newGoal) {
    returned = 1;
  }

  await c.env.fitloot_db.prepare(`UPDATE user_goal_stats SET current_goal = ?, goal_change_count = ?, completed_goals = ?, returned_to_original_count = COALESCE(returned_to_original_count,0) + ?, missions_after_return = CASE WHEN ? = 1 THEN 0 ELSE missions_after_return END, updated_at = datetime('now') WHERE user_id = ?`)
    .bind(newGoal, changeCount, JSON.stringify(Array.from(completedGoals)), returned, returned, user.id).run();

  await onGoalChanged(c.env.fitloot_db, user.id, oldGoal, newGoal, changeCount);
  if (completedGoals.size >= 5) await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'A Jornada ÃƒÂ© o Destino', completedGoals.size, 5);

  const [profileForRegeneration, planForRegeneration] = await Promise.all([
    c.env.fitloot_db
      .prepare("SELECT initial_conditioning, injuries, equipment FROM user_profiles WHERE user_id = ?")
      .bind(user.id)
      .first<{ initial_conditioning: string | null; injuries: string | null; equipment: string | null }>(),
    c.env.fitloot_db
      .prepare("SELECT training_frequency FROM user_training_plans WHERE user_id = ?")
      .bind(user.id)
      .first<{ training_frequency: number | null }>(),
  ]);
  const conditioning = normalizeConditioning(profileForRegeneration?.initial_conditioning);
  const injuries = typeof profileForRegeneration?.injuries === "string" ? profileForRegeneration.injuries : "";
  const equipment = typeof profileForRegeneration?.equipment === "string" ? profileForRegeneration.equipment : "";
  const trainingFrequency = normalizeTrainingFrequencyInput(planForRegeneration?.training_frequency);
  const refreshedPlan = await buildInitialTrainingPlan(newGoal, conditioning, equipment, injuries);
  await upsertTrainingPlan(
    c.env.fitloot_db,
    user.id,
    refreshedPlan as unknown as Record<string, unknown>,
    newGoal,
    conditioning,
    equipment,
    injuries,
    trainingFrequency,
  );

  const dailyCycleStart = missionCycleStartIso("daily");
  await c.env.fitloot_db.prepare(
    `DELETE FROM missions
      WHERE user_id = ?
        AND type = 'daily'
        AND is_completed = 0
        AND COALESCE(mission_origin, 'regular') = 'regular'
        AND datetime(created_at) >= datetime(?)`
  ).bind(user.id, dailyCycleStart).run();
  c.executionCtx.waitUntil((async () => {
    try {
      await createMissionsForPeriod(c.env, c.env.fitloot_db, user.id, "daily", MISSION_LIMITS.daily);
      invalidateMissionListCache(user.id);
    } catch (error) {
      console.error("[/api/profile/goal][background-missions]", {
        userId: user.id,
        message: getErrorMessage(error),
      });
    }
  })());

  return c.json({ success: true, old_goal: oldGoal, new_goal: newGoal, change_count: changeCount });
});

type FeedbackKind = "Sugestao" | "Bug" | "Elogio" | "Outro";

type FeedbackEmailPayload = {
  kind: FeedbackKind;
  message: string;
  userName: string;
  userUsername: string;
  userEmail: string;
  userLevel: number;
  timestamp: string;
};

function normalizeFeedbackKind(raw: unknown): FeedbackKind {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "sugestao" || value === "sugestão" || value === "suggestion") return "Sugestao";
  if (value === "bug") return "Bug";
  if (value === "elogio" || value === "praise") return "Elogio";
  return "Outro";
}

function buildFeedbackEmailText(payload: FeedbackEmailPayload): string {
  return [
    `Tipo: ${payload.kind}`,
    `Usuario: ${payload.userName} (@${payload.userUsername})`,
    `Email: ${payload.userEmail}`,
    `Nivel: ${payload.userLevel}`,
    `Data: ${payload.timestamp}`,
    "",
    "Mensagem:",
    payload.message,
  ].join("\n");
}

async function sendFeedbackViaResend(env: Env, subject: string, textBody: string, replyTo: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    return false;
  }

  const fromAddress = env.FEEDBACK_FROM_EMAIL ?? "FitLoot <feedback@fitloot.app>";
  const response = await fetchResponseWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: ["suportefitloot@gmail.com"],
      subject,
      text: textBody,
      reply_to: replyTo,
    }),
  }, 8_000);

  if (!response.ok) {
    const reason = await response.text();
    throw new Error(`resend-failed:${response.status}:${reason}`);
  }

  return true;
}

async function sendFeedbackViaMailChannels(subject: string, textBody: string, payload: FeedbackEmailPayload, env: Env): Promise<void> {
  const fromAddress = env.FEEDBACK_FROM_EMAIL ?? "feedback@fitloot.app";
  const response = await fetchResponseWithTimeout("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: "suportefitloot@gmail.com", name: "FitLoot Suporte" }],
        },
      ],
      from: {
        email: fromAddress,
        name: "FitLoot Feedback",
      },
      reply_to: {
        email: payload.userEmail,
        name: payload.userName,
      },
      subject,
      content: [
        {
          type: "text/plain",
          value: textBody,
        },
      ],
    }),
  }, 8_000);

  if (!response.ok) {
    const reason = await response.text();
    throw new Error(`mailchannels-failed:${response.status}:${reason}`);
  }
}

app.post("/api/feedback", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const body = await c.req.json().catch(() => ({})) as { type?: unknown; message?: unknown };
    const kind = normalizeFeedbackKind(body.type);
    const message = String(body.message ?? "").trim();

    if (message.length < 5) {
      return c.json({ error: "Escreva uma mensagem com pelo menos 5 caracteres." }, 400);
    }

    const [profile, progression] = await Promise.all([
      c.env.fitloot_db
        .prepare("SELECT full_name, username FROM user_profiles WHERE user_id = ?")
        .bind(user.id)
        .first<{ full_name: string | null; username: string | null }>(),
      c.env.fitloot_db
        .prepare("SELECT level FROM user_progression WHERE user_id = ?")
        .bind(user.id)
        .first<{ level: number | null }>(),
    ]);

    const feedbackPayload: FeedbackEmailPayload = {
      kind,
      message,
      userName: profile?.full_name ?? user.name,
      userUsername: profile?.username ?? user.email.split("@")[0],
      userEmail: user.email,
      userLevel: Number(progression?.level ?? 1),
      timestamp: new Date().toISOString(),
    };

    const subject = `[FitLoot Feedback] ${feedbackPayload.kind} - ${feedbackPayload.userName}`;
    const textBody = buildFeedbackEmailText(feedbackPayload);

    let provider: "resend" | "mailchannels" = "mailchannels";

    try {
      const sentByResend = await sendFeedbackViaResend(c.env, subject, textBody, feedbackPayload.userEmail);
      if (sentByResend) {
        provider = "resend";
      } else {
        await sendFeedbackViaMailChannels(subject, textBody, feedbackPayload, c.env);
      }
    } catch (primaryError) {
      console.warn("[/api/feedback][primary-provider-failed]", {
        message: getErrorMessage(primaryError),
      });
      await sendFeedbackViaMailChannels(subject, textBody, feedbackPayload, c.env);
      provider = "mailchannels";
    }

    return c.json({ success: true, provider });
  } catch (error) {
    console.error("[/api/feedback]", {
      message: getErrorMessage(error),
      userId: user.id,
    });
    return c.json({ error: "Nao foi possivel enviar o feedback agora." }, 500);
  }
});

app.post("/api/onboarding", authMiddleware, zValidator("json", OnboardingRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const data = c.req.valid("json");
  await ensureGamificationCatalog(c.env.fitloot_db);

  const selectedGoals = Array.from(
    new Set(
      (Array.isArray(data.goals) && data.goals.length > 0 ? data.goals : [data.main_goal])
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0),
    ),
  );
  const username = data.username.trim();
  const fullName = data.full_name.trim();
  const primaryGoal = selectedGoals[0] ?? data.main_goal;
  const trainingFrequency = normalizeTrainingFrequencyInput(data.training_frequency);
  const goalsJson = JSON.stringify(selectedGoals);

  if (username.length < 3 || fullName.length === 0) {
    return c.json({ error: "Dados de identidade invalidos" }, 400);
  }

  const existingUsername = await c.env.fitloot_db.prepare(
    "SELECT user_id FROM user_profiles WHERE username = ? LIMIT 1"
  ).bind(username).first<{ user_id: string | null }>();

  if (existingUsername?.user_id && existingUsername.user_id !== user.id) {
    return c.json({ error: "Username already taken" }, 400);
  }

  let initialAttrs = { strength: 10, constitution: 10, vitality: 10, dexterity: 10, focus: 10 };
  if (data.initial_conditioning === "iniciante") {
    initialAttrs = { strength: 15, constitution: 15, vitality: 15, dexterity: 12, focus: 12 };
  } else if (data.initial_conditioning === "intermediario") {
    initialAttrs = { strength: 25, constitution: 25, vitality: 25, dexterity: 20, focus: 20 };
  } else if (data.initial_conditioning === "avancado") {
    initialAttrs = { strength: 40, constitution: 40, vitality: 40, dexterity: 35, focus: 35 };
  }

  initialAttrs.strength += Math.floor(data.initial_pushups / 5);
  initialAttrs.constitution += Math.floor(data.initial_situps / 5);
  initialAttrs.vitality += Math.floor(data.initial_squats / 5);

  const conditioning = data.initial_conditioning as ConditioningLevel;
  const maxTier = conditioningOrder(conditioning);
  const [hasInitialPushupsColumn, hasInitialSitupsColumn, hasInitialSquatsColumn] = await Promise.all([
    hasTableColumn(c.env.fitloot_db, "user_profiles", "initial_pushups"),
    hasTableColumn(c.env.fitloot_db, "user_profiles", "initial_situps"),
    hasTableColumn(c.env.fitloot_db, "user_profiles", "initial_squats"),
  ]);
  let checkoutResult: CheckoutStartResult | undefined;
  try {
    await withTransaction(c.env.fitloot_db, async () => {
      const profileColumns = [
        "user_id",
        "username",
        "full_name",
        "weight",
        "height",
        "initial_conditioning",
        "injuries",
        "equipment",
        "main_goal",
        "age",
        "gender",
        "goals_json",
        "updated_at",
      ];
      const profileValues: unknown[] = [
        user.id,
        username,
        fullName,
        data.weight,
        data.height,
        data.initial_conditioning,
        data.injuries || "",
        data.equipment || "",
        primaryGoal,
        data.age,
        data.gender,
        goalsJson,
      ];
      const profilePlaceholders = ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "datetime('now')"];
      const profileUpdates = [
        "username = excluded.username",
        "full_name = excluded.full_name",
        "weight = excluded.weight",
        "height = excluded.height",
        "initial_conditioning = excluded.initial_conditioning",
        "injuries = excluded.injuries",
        "equipment = excluded.equipment",
        "main_goal = excluded.main_goal",
        "age = excluded.age",
        "gender = excluded.gender",
        "goals_json = excluded.goals_json",
        "updated_at = datetime('now')",
      ];

      if (hasInitialPushupsColumn) {
        profileColumns.splice(profileColumns.length - 1, 0, "initial_pushups");
        profilePlaceholders.splice(profilePlaceholders.length - 1, 0, "?");
        profileValues.push(data.initial_pushups);
        profileUpdates.splice(profileUpdates.length - 1, 0, "initial_pushups = excluded.initial_pushups");
      }
      if (hasInitialSitupsColumn) {
        profileColumns.splice(profileColumns.length - 1, 0, "initial_situps");
        profilePlaceholders.splice(profilePlaceholders.length - 1, 0, "?");
        profileValues.push(data.initial_situps);
        profileUpdates.splice(profileUpdates.length - 1, 0, "initial_situps = excluded.initial_situps");
      }
      if (hasInitialSquatsColumn) {
        profileColumns.splice(profileColumns.length - 1, 0, "initial_squats");
        profilePlaceholders.splice(profilePlaceholders.length - 1, 0, "?");
        profileValues.push(data.initial_squats);
        profileUpdates.splice(profileUpdates.length - 1, 0, "initial_squats = excluded.initial_squats");
      }

      await c.env.fitloot_db.prepare(
        `INSERT INTO user_profiles (${profileColumns.join(", ")})
         VALUES (${profilePlaceholders.join(", ")})
         ON CONFLICT(user_id) DO UPDATE SET ${profileUpdates.join(", ")}`
      ).bind(...profileValues).run();

      await c.env.fitloot_db.prepare(
        `INSERT INTO user_attributes (user_id, strength, constitution, vitality, dexterity, focus, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          strength = excluded.strength,
          constitution = excluded.constitution,
          vitality = excluded.vitality,
          dexterity = excluded.dexterity,
          focus = excluded.focus,
          updated_at = datetime('now')`
      ).bind(user.id, initialAttrs.strength, initialAttrs.constitution, initialAttrs.vitality, initialAttrs.dexterity, initialAttrs.focus).run();

      await c.env.fitloot_db.prepare(
        `INSERT OR IGNORE INTO user_progression (user_id, xp, level, points, current_streak, best_streak, updated_at)
        VALUES (?, 0, 1, 0, 0, 0, datetime('now'))`
      ).bind(user.id).run();

      const initialSkills = await c.env.fitloot_db.prepare(
        `SELECT id, tier, level_required FROM skills`
      ).all<{ id: number; tier: string; level_required: number }>();

      for (const skill of initialSkills.results) {
        if (skillTierOrder(skill.tier) <= Math.max(1, maxTier) && Number(skill.level_required ?? 1) <= 1) {
          await c.env.fitloot_db.prepare(
            `INSERT OR IGNORE INTO user_skills (user_id, skill_id, status, current_stage, total_reps, total_time, best_reps, unlocked_at, updated_at)
            VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`
          ).bind(user.id, skill.id).run();
        }
      }

      const plan = await buildInitialTrainingPlan(primaryGoal, conditioning, data.equipment ?? null, data.injuries ?? null);
      await upsertTrainingPlan(
        c.env.fitloot_db,
        user.id,
        plan,
        primaryGoal,
        conditioning,
        data.equipment ?? null,
        data.injuries ?? null,
        trainingFrequency,
      );

      checkoutResult = await startCheckoutForUser(c.env.fitloot_db, c.env, {
        userId: user.id,
        planId: data.plan_id,
        paymentMethod: data.payment_method,
        cardNumber: data.card_number,
        cardHolderName: data.card_holder_name,
        cardExpiry: data.card_expiry,
        promoCode: data.promo_code,
        markOnboardingCompleted: false,
      });

      await ensureGoalStatsRow(c.env.fitloot_db, user.id, primaryGoal);
      await ensureUserCounterRow(c.env.fitloot_db, user.id);
      await logUserEvent(c.env.fitloot_db, user.id, "onboarding_submitted", {
        conditioning,
        main_goal: primaryGoal,
        goals: selectedGoals,
        training_frequency: trainingFrequency,
        plan_id: checkoutResult.plan_id,
        plan_status: checkoutResult.plan_status,
        amount: checkoutResult.amount,
      });
      await evaluateLevelTitles(c.env.fitloot_db, user.id, 1);
    });
  } catch (error) {
    if (isInvalidPromoCodeError(error)) {
      return c.json({ error: "Código inválido ou expirado" }, 400);
    }
    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    throw error;
  }

  if (!checkoutResult) {
    throw new Error("Checkout result missing after onboarding transaction.");
  }

  c.executionCtx.waitUntil((async () => {
    try {
      await ensurePeriodicMissions(c.env, c.env.fitloot_db, user.id);
      invalidateMissionListCache(user.id);
    } catch (error) {
      console.error("[/api/onboarding][background-missions]", {
        userId: user.id,
        message: getErrorMessage(error),
      });
    }
  })());

  return c.json({ success: true, plan_created: true, ...checkoutResult }, 201);
});

// Progression endpoints
app.get("/api/progression", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    let progression = await c.env.fitloot_db.prepare(
      "SELECT * FROM user_progression WHERE user_id = ?"
    ).bind(user.id).first<Record<string, unknown>>();

    if (!progression) {
      await c.env.fitloot_db.prepare(
        `INSERT INTO user_progression (user_id, xp, level, points, current_streak, best_streak, updated_at)
        VALUES (?, 0, 1, 0, 0, 0, datetime('now'))`
      ).bind(user.id).run();

      progression = await c.env.fitloot_db.prepare(
        "SELECT * FROM user_progression WHERE user_id = ?"
      ).bind(user.id).first<Record<string, unknown>>();
    }

    if (!progression) {
      return c.json({ error: "Progress?o n?o encontrada", code: "PROGRESSION_NOT_FOUND" }, 404);
    }

    const beforeReconcile = parseProgressionXpLevel(progression);
    const overflowPreview = computeXpAndLevelAfterGain(beforeReconcile.xp, beforeReconcile.level, 0);
    let celebrateLevel: number | undefined;
    if (overflowPreview.levelsGained > 0) {
      const applied = await applyXpPointsAndResolveLevels(c.env.fitloot_db, user.id, 0, 0);
      celebrateLevel = applied.newLevel;
      const refreshed = await c.env.fitloot_db
        .prepare("SELECT * FROM user_progression WHERE user_id = ?")
        .bind(user.id)
        .first<Record<string, unknown>>();
      if (refreshed) {
        progression = refreshed;
      }
    }

    return c.json({
      ...progression,
      ...(typeof celebrateLevel === "number" && celebrateLevel > 0 ? { celebrate_level: celebrateLevel } : {}),
    });
  } catch (error) {
    console.error("[/api/progression]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.get("/api/attributes", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const attributes = await c.env.fitloot_db.prepare(
    "SELECT * FROM user_attributes WHERE user_id = ?"
  ).bind(user.id).first();

  return c.json(attributes);
});

// Skills endpoints
app.get("/api/skills", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const userSkills = await c.env.fitloot_db.prepare(
    `SELECT s.*, us.total_reps, us.total_time, us.best_reps, us.unlocked_at, us.status, us.current_stage,
      (SELECT COUNT(*) FROM skill_stages ss WHERE ss.skill_id = s.id) as total_stages
    FROM skills s
    INNER JOIN user_skills us ON s.id = us.skill_id
    WHERE us.user_id = ?
    ORDER BY COALESCE(s.level_required, s.required_level), s.id`
  ).bind(user.id).all();

  return c.json(userSkills.results);
});

app.get("/api/skills/available", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const progression = await c.env.fitloot_db.prepare(
    "SELECT level FROM user_progression WHERE user_id = ?"
  ).bind(user.id).first();

  const availableSkills = await c.env.fitloot_db.prepare(
    `SELECT s.* FROM skills s
    WHERE COALESCE(s.level_required, s.required_level) <= ?
    AND s.id NOT IN (SELECT skill_id FROM user_skills WHERE user_id = ?)
    ORDER BY COALESCE(s.level_required, s.required_level), s.id`
  ).bind(progression?.level || 1, user.id).all();

  return c.json(availableSkills.results);
});

app.post("/api/skills/:id/stage/complete", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const skillId = Number(c.req.param("id"));
  if (!Number.isFinite(skillId)) return c.json({ error: "Invalid skill" }, 400);

  const [progression, skillProgress] = await Promise.all([
    c.env.fitloot_db.prepare("SELECT level FROM user_progression WHERE user_id = ?").bind(user.id).first<{ level: number }>(),
    c.env.fitloot_db.prepare("SELECT current_stage FROM user_skills WHERE user_id = ? AND skill_id = ?").bind(user.id, skillId).first<{ current_stage: number }>(),
  ]);

  if (!skillProgress) return c.json({ error: "Skill not unlocked" }, 404);

  const nextStage = Number(skillProgress.current_stage ?? 0) + 1;
  const stageData = await c.env.fitloot_db.prepare(
    "SELECT * FROM skill_stages WHERE skill_id = ? AND stage_number = ?"
  ).bind(skillId, nextStage).first<{ level_required: number; stage_number: number }>();

  if (!stageData) return c.json({ error: "No next stage" }, 400);
  if (Number(progression?.level ?? 1) < Number(stageData.level_required ?? 1)) {
    return c.json({ error: "NÃƒÂ­vel insuficiente para esta etapa" }, 400);
  }

  await c.env.fitloot_db.prepare(
    "UPDATE user_skills SET current_stage = ?, status = 'in_progress', updated_at = datetime('now') WHERE user_id = ? AND skill_id = ?"
  ).bind(nextStage, user.id, skillId).run();

  if (nextStage >= 6) {
    await c.env.fitloot_db.prepare(
      "UPDATE user_skills SET status = 'unlocked', updated_at = datetime('now') WHERE user_id = ? AND skill_id = ?"
    ).bind(user.id, skillId).run();

    const skill = await c.env.fitloot_db.prepare("SELECT name FROM skills WHERE id = ?").bind(skillId).first<{ name: string }>();
    const titleBySkill: Record<string, string> = {
      Handstand: "O Equilibrista",
      "Muscle Up": "Acima de Todos",
      Planche: "ForÃƒÂ§a Gravitacional",
      "Human Flag": "Bandeira Humana",
      "Front Lever": "Suspenso no Tempo",
    };
    const title = titleBySkill[skill?.name ?? ""];
    if (title) await unlockTitleIfNeeded(c.env.fitloot_db, user.id, title);

    if (skill?.name === "Handstand") {
      await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, "Mestre do EquilÃƒÂ­brio", 6, 6);
    }
  }

  return c.json({ success: true, current_stage: nextStage });
});

// Missions endpoints
type MissionSubtaskRow = {
  id: number;
  parent_mission_id: number;
  mission_type: string;
  subtask_title: string;
  compatibility_key: string;
  compatibility_terms_json: string | null;
  required_count: number;
  current_count: number;
  is_completed: number;
  created_at: string;
  updated_at: string;
};

type NormalizedMissionSubtask = {
  id: number;
  parent_mission_id: number;
  mission_type: string;
  subtask_title: string;
  compatibility_key: string;
  compatibility_terms: string[];
  required_count: number;
  current_count: number;
  is_completed: boolean;
};

const MISSION_SUBTASK_SCHEMA_TTL_MS = 60_000;
let missionSubtaskSchemaCheckedAt = 0;

function parseJsonStringArray(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((item): item is string => typeof item === "string");
  }

  if (typeof rawValue !== "string") return [];
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function ensureMissionSubtaskSchema(db: D1Database): Promise<void> {
  const now = Date.now();
  if (now - missionSubtaskSchemaCheckedAt < MISSION_SUBTASK_SCHEMA_TTL_MS) return;

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS mission_subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_mission_id INTEGER NOT NULL,
      mission_type TEXT NOT NULL DEFAULT 'daily',
      subtask_title TEXT NOT NULL,
      compatibility_key TEXT NOT NULL,
      compatibility_terms_json TEXT NOT NULL DEFAULT '[]',
      required_count INTEGER NOT NULL DEFAULT 1,
      current_count INTEGER NOT NULL DEFAULT 0,
      is_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_mission_subtasks_parent ON mission_subtasks(parent_mission_id)"
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_mission_subtasks_parent_completed ON mission_subtasks(parent_mission_id, is_completed)"
  ).run();

  missionSubtaskSchemaCheckedAt = now;
}

function normalizeMissionSubtaskRow(row: MissionSubtaskRow): NormalizedMissionSubtask {
  const requiredCount = Math.max(1, Number(row.required_count ?? 1));
  const currentCount = Math.max(0, Number(row.current_count ?? 0));

  return {
    id: Number(row.id),
    parent_mission_id: Number(row.parent_mission_id),
    mission_type: typeof row.mission_type === "string" ? row.mission_type : "daily",
    subtask_title: typeof row.subtask_title === "string" ? row.subtask_title : "Missao diaria",
    compatibility_key: typeof row.compatibility_key === "string" ? row.compatibility_key : "",
    compatibility_terms: parseJsonStringArray(row.compatibility_terms_json),
    required_count: requiredCount,
    current_count: Math.min(requiredCount, currentCount),
    is_completed: Number(row.is_completed ?? 0) === 1 || currentCount >= requiredCount,
  };
}

function missionSubtasksToCircuitTasks(subtasks: readonly NormalizedMissionSubtask[]): CircuitTask[] {
  return subtasks.map((subtask) => ({
    id: `subtask-${subtask.id}`,
    label: subtask.subtask_title,
    mission_type: subtask.compatibility_key,
    required_count: subtask.required_count,
    current_count: Math.min(subtask.required_count, subtask.current_count),
    completed: subtask.is_completed,
  }));
}

async function loadMissionSubtasksByParentIds(
  db: D1Database,
  parentIds: readonly number[],
): Promise<Map<number, NormalizedMissionSubtask[]>> {
  const grouped = new Map<number, NormalizedMissionSubtask[]>();
  if (parentIds.length === 0) return grouped;

  await ensureMissionSubtaskSchema(db);
  const placeholders = parentIds.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT
        id,
        parent_mission_id,
        mission_type,
        subtask_title,
        compatibility_key,
        compatibility_terms_json,
        required_count,
        current_count,
        is_completed,
        created_at,
        updated_at
      FROM mission_subtasks
      WHERE parent_mission_id IN (${placeholders})
      ORDER BY parent_mission_id ASC, id ASC`
  ).bind(...parentIds).all<MissionSubtaskRow>();

  for (const row of Array.isArray(rows.results) ? rows.results : []) {
    const normalized = normalizeMissionSubtaskRow(row);
    const current = grouped.get(normalized.parent_mission_id) ?? [];
    current.push(normalized);
    grouped.set(normalized.parent_mission_id, current);
  }

  return grouped;
}

async function hydrateMissionRowsWithSubtasks(
  db: D1Database,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const missionIds = rows
    .map((row) => Number(row.id ?? 0))
    .filter((missionId) => Number.isInteger(missionId) && missionId > 0);
  if (missionIds.length === 0) return rows;

  const subtaskMap = await loadMissionSubtasksByParentIds(db, missionIds);
  if (subtaskMap.size === 0) return rows;

  return rows.map((row) => {
    const missionId = Number(row.id ?? 0);
    const subtasks = subtaskMap.get(missionId);
    if (!subtasks || subtasks.length === 0) return row;

    return {
      ...row,
      circuit_tasks_json: JSON.stringify(missionSubtasksToCircuitTasks(subtasks)),
      progress_value: subtasks.reduce((total, subtask) => total + Math.min(subtask.required_count, subtask.current_count), 0),
    };
  });
}

function parseMissionArrayField(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((item): item is string => typeof item === "string");
  }
  if (typeof rawValue !== "string") return [];
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseCircuitTaskField(rawValue: unknown): CircuitTask[] {
  const parseValue = (value: unknown): CircuitTask[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((task): CircuitTask | null => {
        if (typeof task !== "object" || task === null) return null;
        const record = task as Record<string, unknown>;
        if (typeof record.id !== "string" || typeof record.label !== "string" || typeof record.mission_type !== "string") {
          return null;
        }
        const requiredCount = Number(record.required_count ?? 0);
        const currentCount = Number(record.current_count ?? 0);
        return {
          id: record.id,
          label: record.label,
          mission_type: record.mission_type,
          required_count: requiredCount > 0 ? requiredCount : 1,
          current_count: currentCount >= 0 ? currentCount : 0,
          completed: Boolean(record.completed),
        };
      })
      .filter((task): task is CircuitTask => task !== null);
  };

  if (Array.isArray(rawValue)) {
    return parseValue(rawValue);
  }
  if (typeof rawValue !== "string") return [];
  try {
    return parseValue(JSON.parse(rawValue) as unknown);
  } catch {
    return [];
  }
}

function normalizeMissionMetricType(rawType: unknown, rawTargetTime: unknown): MissionMetricType {
  if (
    rawType === "repetitions" ||
    rawType === "duration_seconds" ||
    rawType === "sets_reps" ||
    rawType === "steps" ||
    rawType === "distance_meters" ||
    rawType === "duration_minutes" ||
    rawType === "circuit_tasks"
  ) {
    return rawType;
  }

  const targetTime = Number(rawTargetTime ?? 0);
  if (targetTime > 0) return "duration_seconds";
  return "repetitions";
}

type NormalizedMissionComputedFields = {
  metric_type: MissionMetricType;
  metric_value: number;
  metric_unit: string;
  sets: number | null;
  rest_seconds: number | null;
  instructions: string[];
  exercise_instructions_en: string[];
  exercise_instructions_pt: string[];
  muscle_groups: string[];
  exercise_secondary_muscles: string[];
  attributes_benefited: string[];
  safety_tips: string[];
  circuit_tasks: CircuitTask[];
  exercise_type: string;
  body_area: string;
  exercise_name: string | null;
  exercise_equipment: string | null;
  exercise_body_part: string | null;
  exercise_target: string | null;
  exercise_db_gif_url: string | null;
  exercise_db_image_url: string | null;
  duration_estimate_minutes: number | undefined;
  exercise_category: string;
  difficulty_level: string | undefined;
  video_url: string | null;
  thumbnail_url: string | null;
  mission_origin: "regular" | "ai";
  goal: string | null;
  is_ai_special: number;
  progress_value: number | undefined;
};

function normalizeMissionRow(rawMission: Record<string, unknown>): Record<string, unknown> & NormalizedMissionComputedFields {
  const metricType = normalizeMissionMetricType(rawMission.metric_type, rawMission.target_time);
  const targetReps = Number(rawMission.target_reps ?? 0);
  const targetTime = Number(rawMission.target_time ?? 0);
  const metricValue = Number(rawMission.metric_value ?? (metricType === "duration_seconds" ? targetTime : targetReps));
  const durationEstimate = shouldShowMissionDuration(typeof rawMission.type === "string" ? rawMission.type : undefined)
    ? Number(rawMission.duration_estimate_minutes ?? 0)
    : 0;
  const metricUnit = typeof rawMission.metric_unit === "string" && rawMission.metric_unit.length > 0
    ? rawMission.metric_unit
    : metricUnitByType(metricType);
  const circuitTasks = localizeCircuitTasksForDisplay(parseCircuitTaskField(rawMission.circuit_tasks_json));
  const rawTitle = typeof rawMission.title === "string" ? rawMission.title : "Miss\u00e3o";
  const displayTitle = typeof rawMission.title === "string"
    ? stripMissionDisplayTitlePrefix(rawTitle)
    : "Miss\u00e3o";
  const displayDescription = typeof rawMission.description === "string"
    ? (localizeMissionText(rawMission.description) ?? rawMission.description)
    : rawMission.description;
  const localizedGoal = resolveMissionDisplayGoal(rawMission, circuitTasks);
  const progressValue = rawMission.progress_value === null || rawMission.progress_value === undefined
    ? (circuitTasks.length > 0 ? circuitTasks.filter((task) => task.completed).length : undefined)
    : Number(rawMission.progress_value);
  const displayImageUrl = resolveMissionDisplayImage(rawMission);

  return {
    ...rawMission,
    title: displayTitle,
    description: displayDescription,
    metric_type: metricType,
    metric_value: metricValue > 0 ? metricValue : 1,
    metric_unit: metricUnit,
    sets: rawMission.sets === null || rawMission.sets === undefined ? null : Number(rawMission.sets),
    rest_seconds: rawMission.rest_seconds === null || rawMission.rest_seconds === undefined ? null : Number(rawMission.rest_seconds),
    instructions: localizeMissionTextArray(parseMissionArrayField(rawMission.instructions_json)),
    exercise_instructions_en: localizeMissionTextArray(parseMissionArrayField(rawMission.exercise_instructions_en_json)),
    exercise_instructions_pt: localizeMissionTextArray(parseMissionArrayField(rawMission.exercise_instructions_pt_json)),
    muscle_groups: localizeMissionTextArray(parseMissionArrayField(rawMission.muscle_groups_json)),
    exercise_secondary_muscles: localizeMissionTextArray(parseMissionArrayField(rawMission.exercise_secondary_muscles_json)),
    attributes_benefited: localizeMissionTextArray(parseMissionArrayField(rawMission.attributes_benefited_json)),
    safety_tips: localizeMissionTextArray(parseMissionArrayField(rawMission.safety_tips_json)),
    circuit_tasks: circuitTasks,
    exercise_type: typeof rawMission.exercise_type === "string" ? rawMission.exercise_type : "forca",
    body_area: rawMission.body_area === "upper" || rawMission.body_area === "lower" || rawMission.body_area === "core" || rawMission.body_area === "full_body"
      ? rawMission.body_area
      : "full_body",
    exercise_name: typeof rawMission.exercise_name === "string" ? (localizeMissionText(rawMission.exercise_name) ?? rawMission.exercise_name) : null,
    exercise_equipment: typeof rawMission.exercise_equipment === "string" ? (localizeMissionText(rawMission.exercise_equipment) ?? rawMission.exercise_equipment) : null,
    exercise_body_part: typeof rawMission.exercise_body_part === "string" ? (localizeMissionText(rawMission.exercise_body_part) ?? rawMission.exercise_body_part) : null,
    exercise_target: typeof rawMission.exercise_target === "string" ? (localizeMissionText(rawMission.exercise_target) ?? rawMission.exercise_target) : null,
    image_url: normalizeMissionMediaUrl(displayImageUrl) ?? displayImageUrl,
    exercise_db_gif_url: normalizeMissionMediaUrl(typeof rawMission.exercise_db_gif_url === "string" ? rawMission.exercise_db_gif_url : null),
    exercise_db_image_url: normalizeMissionMediaUrl(typeof rawMission.exercise_db_image_url === "string" ? rawMission.exercise_db_image_url : null),
    duration_estimate_minutes: durationEstimate > 0 ? durationEstimate : undefined,
    exercise_category: typeof rawMission.exercise_category === "string" ? rawMission.exercise_category : "default",
    difficulty_level: localizeDifficultyLabel(typeof rawMission.difficulty_level === "string" ? rawMission.difficulty_level : undefined),
    video_url: normalizeMissionMediaUrl(typeof rawMission.video_url === "string" ? rawMission.video_url : null),
    thumbnail_url: normalizeMissionMediaUrl(typeof rawMission.thumbnail_url === "string" ? rawMission.thumbnail_url : null),
    mission_origin: rawMission.mission_origin === "ai" ? "ai" : "regular",
    goal: localizedGoal,
    is_ai_special: Number(rawMission.is_ai_special ?? 0) === 1 ? 1 : 0,
    progress_value: progressValue,
  };
}

type NormalizedMissionRow = Record<string, unknown> & NormalizedMissionComputedFields;

const MISSION_TITLE_PREFIX_PATTERN = /^(?:miss(?:\u00e3o|ao)\s+(?:di[a\u00e1]ria|semanal|mensal)|daily mission|weekly mission|monthly mission|meta\s+(?:di[a\u00e1]ria|semanal|mensal)|daily goal|weekly goal|monthly goal)\s*:\s*/i;

function stripMissionDisplayTitlePrefix(value: string): string {
  const localized = localizeMissionText(value) ?? value;
  const stripped = localized.replace(MISSION_TITLE_PREFIX_PATTERN, "").trim();
  return stripped.length > 0 ? stripped : localized.trim();
}

function formatIntegerPtBr(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("pt-BR");
}

function resolveExplicitMonthlyDisplayGoal(rawMission: Record<string, unknown>): string | null {
  if (rawMission.type !== "monthly") return null;

  const rawTitle = typeof rawMission.title === "string" ? rawMission.title : "";
  const title = stripMissionDisplayTitlePrefix(rawTitle);
  if (title.length === 0) return null;

  const normalizedTitle = normalizeMatchText(title);
  const metricType = normalizeMissionMetricType(rawMission.metric_type, rawMission.target_time);
  const targetBase = metricType === "duration_seconds"
    ? Number(rawMission.target_time ?? rawMission.metric_value ?? 0)
    : Number(rawMission.metric_value ?? rawMission.target_reps ?? rawMission.target_time ?? 0);
  const target = Math.max(1, Math.round(targetBase));
  const rawExerciseName = typeof rawMission.exercise_name === "string" && rawMission.exercise_name.trim().length > 0
    ? rawMission.exercise_name
    : extractExerciseName(title);
  const exerciseName = stripMissionDisplayTitlePrefix(rawExerciseName).trim();
  const namedSuffix = exerciseName.length > 0 && normalizeMatchText(exerciseName) !== normalizedTitle
    ? ` de ${exerciseName}`
    : "";

  if (normalizedTitle.includes("consistencia mensal")) {
    return `${formatIntegerPtBr(target)} miss\u00f5es conclu\u00eddas`;
  }

  if (normalizedTitle.includes("distancia mensal")) {
    const stepTarget = metricType === "steps" ? target : Math.max(1, Math.round(target / 0.75));
    return `${formatIntegerPtBr(stepTarget)} passos acumulados`;
  }

  if (normalizedTitle.includes("dias ativos") || normalizedTitle.includes("streak mensal") || normalizedTitle.includes("pratica ativa")) {
    return `${formatIntegerPtBr(target)} dias ativos no m\u00eas`;
  }

  if (normalizedTitle.includes("circuitos semanais")) {
    return `${formatIntegerPtBr(target)} circuitos semanais conclu\u00eddos`;
  }

  if (normalizedTitle.includes("volume mensal") || normalizedTitle.includes("ritmo mensal")) {
    return `${formatIntegerPtBr(target)} miss\u00f5es conclu\u00eddas`;
  }

  if (normalizedTitle.includes("desafio cardio")) {
    return `${formatIntegerPtBr(target)} passos acumulados`;
  }

  if (metricType === "steps") {
    return `${formatIntegerPtBr(target)} passos${namedSuffix}`;
  }

  if (metricType === "distance_meters") {
    const kilometers = target / 1000;
    const formattedDistance = kilometers.toLocaleString("pt-BR", {
      minimumFractionDigits: kilometers % 1 === 0 ? 0 : 1,
      maximumFractionDigits: 1,
    });
    return `${formattedDistance} km${namedSuffix}`;
  }

  if (metricType === "duration_minutes") {
    return `${formatIntegerPtBr(target)} minutos${namedSuffix}`;
  }

  if (metricType === "duration_seconds") {
    const minutes = Math.max(1, Math.round(target / 60));
    return `${formatIntegerPtBr(minutes)} minutos${namedSuffix}`;
  }

  if (metricType === "sets_reps" || metricType === "repetitions") {
    return `${formatIntegerPtBr(target)} repeti\u00e7\u00f5es${namedSuffix}`;
  }

  return null;
}

function missionSummaryFromNormalized(mission: NormalizedMissionRow): Record<string, unknown> {
  return {
    id: mission.id,
    user_id: mission.user_id,
    type: mission.type,
    title: mission.title,
    description: mission.description,
    skill_id: mission.skill_id,
    target_reps: mission.target_reps,
    target_time: mission.target_time,
    metric_type: mission.metric_type,
    metric_value: mission.metric_value,
    progress_value: mission.progress_value,
    metric_unit: mission.metric_unit,
    sets: mission.sets,
    rest_seconds: mission.rest_seconds,
    instructions: mission.instructions,
    safety_tips: mission.safety_tips,
    video_url: mission.video_url,
    exercise_instructions_en: mission.exercise_instructions_en,
    exercise_instructions_pt: mission.exercise_instructions_pt,
    image_url: mission.image_url,
    exercise_db_gif_url: mission.exercise_db_gif_url,
    exercise_db_image_url: mission.exercise_db_image_url,
    muscle_groups: mission.muscle_groups,
    exercise_secondary_muscles: mission.exercise_secondary_muscles,
    exercise_name: mission.exercise_name,
    exercise_equipment: mission.exercise_equipment,
    exercise_body_part: mission.exercise_body_part,
    exercise_target: mission.exercise_target,
    exercise_type: mission.exercise_type,
    body_area: mission.body_area,
    duration_estimate_minutes: mission.duration_estimate_minutes,
    exercise_category: mission.exercise_category,
    mission_origin: mission.mission_origin,
    goal: mission.goal,
    is_ai_special: mission.is_ai_special,
    circuit_tasks: mission.circuit_tasks,
    difficulty_level: mission.difficulty_level,
    thumbnail_url: mission.thumbnail_url,
    xp_reward: mission.xp_reward,
    points_reward: mission.points_reward,
    deadline: mission.deadline,
    is_completed: mission.is_completed,
    completed_at: mission.completed_at,
    verified_by_sensor: mission.verified_by_sensor,
    status: mission.status,
    created_at: mission.created_at,
    updated_at: mission.updated_at,
  };
}

type MonthlyCounterSnapshot = {
  month_key: string;
  missions_completed: number;
  distance_meters: number;
  streak_days: number;
  weekly_circuits_completed: number;
};

let monthlyCounterSchemaCheckedAt = 0;
const MONTHLY_COUNTER_SCHEMA_TTL_MS = 60_000;

async function ensureMonthlyCounterSchema(db: D1Database): Promise<void> {
  const now = Date.now();
  if (now - monthlyCounterSchemaCheckedAt < MONTHLY_COUNTER_SCHEMA_TTL_MS) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS user_monthly_counters (
      user_id TEXT NOT NULL,
      month_key TEXT NOT NULL,
      missions_completed INTEGER DEFAULT 0,
      distance_meters INTEGER DEFAULT 0,
      streak_days INTEGER DEFAULT 0,
      weekly_circuits_completed INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, month_key)
    )`
  ).run();
  monthlyCounterSchemaCheckedAt = now;
}

function currentMonthKey(reference = new Date()): string {
  const year = reference.getUTCFullYear();
  const month = String(reference.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function monthStartIso(reference = new Date()): string {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString();
}

function monthlyCounterValueByMission(mission: Record<string, unknown>, counters: MonthlyCounterSnapshot): number {
  const title = normalizeMatchText(String(mission.title ?? ""));
  const metricType = normalizeMissionMetricType(mission.metric_type, mission.target_time);
  if (title.includes("circuitos semanais")) return counters.weekly_circuits_completed;
  if (title.includes("dias ativos") || title.includes("streak") || title.includes("pratica ativa")) return counters.streak_days;
  if (metricType === "steps" || title.includes("passos") || title.includes("distancia") || title.includes("cardio")) {
    return Math.max(0, Math.round(counters.distance_meters / 0.75));
  }
  return counters.missions_completed;
}

function monthlyMissionProgressValue(mission: Record<string, unknown>, counters: MonthlyCounterSnapshot): number {
  const target = Math.max(1, Number(mission.metric_value ?? mission.target_reps ?? 1));
  const value = Math.max(0, monthlyCounterValueByMission(mission, counters));
  return Math.min(target, value);
}

async function recomputeMonthlyCounters(db: D1Database, userId: string, reference = new Date()): Promise<MonthlyCounterSnapshot> {
  await ensureMonthlyCounterSchema(db);
  const monthKey = currentMonthKey(reference);
  const monthStart = monthStartIso(reference);
  const aggregate = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN is_completed = 1 AND type = 'daily' THEN 1 ELSE 0 END), 0) as missions_completed,
       COALESCE(SUM(
         CASE
           WHEN is_completed = 1 AND type = 'daily' AND metric_type = 'distance_meters' THEN COALESCE(metric_value, 0)
           WHEN is_completed = 1 AND type = 'daily' AND metric_type = 'steps' THEN CAST(COALESCE(metric_value, 0) * 0.75 AS INTEGER)
           ELSE 0
         END
       ), 0) as distance_meters,
       COALESCE(COUNT(DISTINCT CASE WHEN is_completed = 1 AND type = 'daily' THEN date(completed_at) END), 0) as streak_days,
       COALESCE(SUM(CASE WHEN is_completed = 1 AND type = 'weekly' AND metric_type = 'circuit_tasks' THEN 1 ELSE 0 END), 0) as weekly_circuits_completed
     FROM missions
     WHERE user_id = ?
       AND completed_at IS NOT NULL
       AND date(completed_at) >= date(?)`
  ).bind(userId, monthStart).first<{
    missions_completed: number;
    distance_meters: number;
    streak_days: number;
    weekly_circuits_completed: number;
  }>();

  const snapshot: MonthlyCounterSnapshot = {
    month_key: monthKey,
    missions_completed: Number(aggregate?.missions_completed ?? 0),
    distance_meters: Number(aggregate?.distance_meters ?? 0),
    streak_days: Number(aggregate?.streak_days ?? 0),
    weekly_circuits_completed: Number(aggregate?.weekly_circuits_completed ?? 0),
  };

  await db.prepare(
    `INSERT INTO user_monthly_counters (
       user_id, month_key, missions_completed, distance_meters, streak_days, weekly_circuits_completed, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, month_key) DO UPDATE SET
       missions_completed = excluded.missions_completed,
       distance_meters = excluded.distance_meters,
       streak_days = excluded.streak_days,
       weekly_circuits_completed = excluded.weekly_circuits_completed,
       updated_at = datetime('now')`
  ).bind(
    userId,
    snapshot.month_key,
    snapshot.missions_completed,
    snapshot.distance_meters,
    snapshot.streak_days,
    snapshot.weekly_circuits_completed,
  ).run();

  return snapshot;
}

async function getMonthlyCounters(db: D1Database, userId: string): Promise<MonthlyCounterSnapshot> {
  await ensureMonthlyCounterSchema(db);
  const monthKey = currentMonthKey();
  const row = await db.prepare(
    `SELECT month_key, missions_completed, distance_meters, streak_days, weekly_circuits_completed
     FROM user_monthly_counters
     WHERE user_id = ? AND month_key = ?`
  ).bind(userId, monthKey).first<{
    month_key: string;
    missions_completed: number;
    distance_meters: number;
    streak_days: number;
    weekly_circuits_completed: number;
  }>();
  if (row) {
    return {
      month_key: row.month_key,
      missions_completed: Number(row.missions_completed ?? 0),
      distance_meters: Number(row.distance_meters ?? 0),
      streak_days: Number(row.streak_days ?? 0),
      weekly_circuits_completed: Number(row.weekly_circuits_completed ?? 0),
    };
  }
  return recomputeMonthlyCounters(db, userId);
}

async function updateMonthlyMissionProgress(userId: string, db: D1Database): Promise<void> {
  const counters = await recomputeMonthlyCounters(db, userId);
  const missionsHaveStatus = await hasTableColumn(db, "missions", "status");
  const monthlyMissions = await db.prepare(
    `SELECT * FROM missions
     WHERE user_id = ?
       AND type = 'monthly'
       AND is_completed = 0
       AND NOT EXISTS (
         SELECT 1 FROM mission_subtasks ms WHERE ms.parent_mission_id = missions.id
       )
       AND (deadline IS NULL OR deadline > datetime('now'))`
  ).bind(userId).all<Record<string, unknown>>();

  for (const mission of monthlyMissions.results) {
    const progress = monthlyMissionProgressValue(mission, counters);
    const target = Math.max(1, Number(mission.metric_value ?? mission.target_reps ?? 1));
    if (progress < target) continue;

    if (missionsHaveStatus) {
      await db.prepare(
        `UPDATE missions
         SET is_completed = 1, status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND is_completed = 0`
      ).bind(mission.id).run();
    } else {
      await db.prepare(
        `UPDATE missions
         SET is_completed = 1, completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND is_completed = 0`
      ).bind(mission.id).run();
    }

    const xpReward = Number(mission.xp_reward ?? 0);
    const pointsReward = Number(mission.points_reward ?? 0);
    if (xpReward > 0 || pointsReward > 0) {
      await applyXpPointsAndResolveLevels(db, userId, xpReward, pointsReward);
    }
    await onMissionComplete(db, userId, Number(mission.id));
  }
}

type MissionListCacheEntry = {
  payload: Record<string, unknown>[];
  expiresAt: number;
};

const MISSION_LIST_CACHE_TTL_MS = 20_000;
const MISSION_LIST_CACHE_MAX_ENTRIES = 400;
const MISSION_REFRESH_DEBOUNCE_MS = 15_000;
const MISSION_REFRESH_TRACK_TTL_MS = 24 * 60 * 60 * 1000;
const MISSION_REFRESH_TRACK_MAX_KEYS = 3_000;
const MISSION_REFRESH_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const missionListCache = new Map<string, MissionListCacheEntry>();
const missionRefreshLocks = new Map<string, Promise<void>>();
const missionRefreshLastRun = new Map<string, number>();
let missionRefreshLastCleanupAt = 0;

function missionListCacheKey(userId: string): string {
  return `missions:${userId}`;
}

function readMissionListCache(userId: string): Record<string, unknown>[] | null {
  const entry = missionListCache.get(missionListCacheKey(userId));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    missionListCache.delete(missionListCacheKey(userId));
    return null;
  }
  return entry.payload;
}

function writeMissionListCache(userId: string, payload: Record<string, unknown>[]): void {
  missionListCache.set(missionListCacheKey(userId), {
    payload,
    expiresAt: Date.now() + MISSION_LIST_CACHE_TTL_MS,
  });

  if (missionListCache.size <= MISSION_LIST_CACHE_MAX_ENTRIES) return;
  const oldestKey = missionListCache.keys().next().value;
  if (typeof oldestKey === "string") {
    missionListCache.delete(oldestKey);
  }
}

function clearMissionListCache(userId: string): void {
  missionListCache.delete(missionListCacheKey(userId));
}

function invalidateMissionListCache(userId: string): void {
  clearMissionListCache(userId);
  missionRefreshLastRun.delete(userId);
}

function streamJsonArrayResponse(items: readonly unknown[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("["));
      for (let index = 0; index < items.length; index += 1) {
        if (index > 0) {
          controller.enqueue(encoder.encode(","));
        }
        controller.enqueue(encoder.encode(JSON.stringify(items[index])));
      }
      controller.enqueue(encoder.encode("]"));
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanupMissionRefreshTracking(now: number): void {
  if (now - missionRefreshLastCleanupAt < MISSION_REFRESH_CLEANUP_INTERVAL_MS) return;

  for (const [trackedUserId, lastRun] of missionRefreshLastRun.entries()) {
    if (now - lastRun > MISSION_REFRESH_TRACK_TTL_MS) {
      missionRefreshLastRun.delete(trackedUserId);
    }
  }

  if (missionRefreshLastRun.size > MISSION_REFRESH_TRACK_MAX_KEYS) {
    const overflow = missionRefreshLastRun.size - MISSION_REFRESH_TRACK_MAX_KEYS;
    const iterator = missionRefreshLastRun.keys();
    for (let index = 0; index < overflow; index += 1) {
      const nextKey = iterator.next().value;
      if (typeof nextKey === "string") {
        missionRefreshLastRun.delete(nextKey);
      }
    }
  }

  missionRefreshLastCleanupAt = now;
}

function shouldDebounceMissionRefresh(userId: string, now: number): boolean {
  const lastRun = missionRefreshLastRun.get(userId) ?? 0;
  return now - lastRun < MISSION_REFRESH_DEBOUNCE_MS;
}

async function runMissionRefreshStepSafely(
  userId: string,
  phase: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error("[missions][refresh]", {
      userId,
      phase,
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

function createMissionRefreshPromise(env: Env, db: D1Database, userId: string): Promise<void> {
  const inflight = missionRefreshLocks.get(userId);
  if (inflight) {
    return inflight;
  }

  const refreshPromise = (async () => {
    try {
      await runMissionRefreshStepSafely(userId, "repair_legacy_periodic", () =>
        repairLegacyPeriodicMissions(env, db, userId),
      );
      await runMissionRefreshStepSafely(userId, "ensure_periodic", () =>
        ensurePeriodicMissions(env, db, userId),
      );
      await runMissionRefreshStepSafely(userId, "repair_legacy_daily_metadata", () =>
        repairLegacyDailyMissionMetadata(env, db, userId),
      );
      await runMissionRefreshStepSafely(userId, "update_monthly_progress", () =>
        updateMonthlyMissionProgress(userId, db),
      );
      clearMissionListCache(userId);
      missionRefreshLastRun.set(userId, Date.now());
    } finally {
      missionRefreshLocks.delete(userId);
    }
  })();

  missionRefreshLocks.set(userId, refreshPromise);
  return refreshPromise;
}

async function ensurePeriodicMissionsWithGuard(
  env: Env,
  db: D1Database,
  userId: string,
  options?: { force?: boolean | undefined },
): Promise<void> {
  if (options?.force === true) {
    await createMissionRefreshPromise(env, db, userId);
    return;
  }

  const now = Date.now();
  cleanupMissionRefreshTracking(now);
  if (shouldDebounceMissionRefresh(userId, now)) {
    return;
  }

  await createMissionRefreshPromise(env, db, userId);
}

function schedulePeriodicMissionsRefreshWithGuard(
  env: Env,
  db: D1Database,
  userId: string,
  executionCtx: ExecutionContext,
): boolean {
  const now = Date.now();
  cleanupMissionRefreshTracking(now);
  if (shouldDebounceMissionRefresh(userId, now) || missionRefreshLocks.has(userId)) {
    return false;
  }

  const refreshPromise = createMissionRefreshPromise(env, db, userId);
  executionCtx.waitUntil(
    refreshPromise.catch((error) => {
      console.error("[missions][background-refresh]", {
        userId,
        message: getErrorMessage(error),
      });
    }),
  );

  return true;
}

function normalizeMatchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function localizeDifficultyLabel(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const normalized = normalizeMatchText(value);
  if (normalized.includes("avanc")) return "Avan\u00e7ado";
  if (normalized.includes("inter")) return "Intermedi\u00e1rio";
  if (normalized.includes("sedent")) return "Sedent\u00e1rio";
  if (normalized.includes("inic")) return "Iniciante";
  return localizeMissionText(value) ?? value;
}

function localizeCircuitTasksForDisplay(tasks: CircuitTask[]): CircuitTask[] {
  return tasks.map((task) => ({
    ...task,
    label: localizeMissionText(task.label) ?? task.label,
  }));
}

function resolveMissionDisplayGoal(
  rawMission: Record<string, unknown>,
  circuitTasks: CircuitTask[],
): string | null {
  const rawGoal = rawMission.goal;
  const missionType = rawMission.type;
  if (missionType === "monthly" && circuitTasks.length === 0) {
    const explicitMonthlyGoal = resolveExplicitMonthlyDisplayGoal(rawMission);
    if (explicitMonthlyGoal) {
      return explicitMonthlyGoal;
    }
  }
  if (typeof rawGoal === "string" && rawGoal.trim().length > 0) {
    return localizeMissionText(rawGoal) ?? rawGoal;
  }
  if ((missionType !== "weekly" && missionType !== "monthly") || circuitTasks.length === 0) {
    return null;
  }
  return buildMissionDisplayGoalFromTasks(
    circuitTasks.map((task) => task.label),
    missionType,
  );
}

function resolveMissionDisplayImage(rawMission: Record<string, unknown>): string | null {
  const imageCandidates = [
    rawMission.image_url,
    rawMission.exercise_db_gif_url,
    rawMission.thumbnail_url,
    rawMission.exercise_db_image_url,
  ];
  for (const candidate of imageCandidates) {
    const normalized = normalizeMissionMediaUrl(typeof candidate === "string" ? candidate : null);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function missionMatchesTask(completedMission: Record<string, unknown>, task: CircuitTask): boolean {
  if (String(completedMission.type ?? "") !== "daily") {
    return false;
  }

  const taskKey = normalizeMatchText(task.mission_type);
  const title = normalizeMatchText(String(completedMission.title ?? ""));
  const description = normalizeMatchText(String(completedMission.description ?? ""));
  const exerciseCategory = normalizeMatchText(String(completedMission.exercise_category ?? ""));
  const metricType = normalizeMatchText(String(completedMission.metric_type ?? ""));
  const muscleGroups = parseMissionArrayField(completedMission.muscle_groups_json).map((item) => normalizeMatchText(item));

  const corpus = [title, description, exerciseCategory, metricType, ...muscleGroups].join(" ");
  return corpus.includes(taskKey);
}

async function grantCircuitRewards(db: D1Database, userId: string, missionRow: Record<string, unknown>) {
  const xpReward = Number(missionRow.xp_reward ?? 0);
  const pointsReward = Number(missionRow.points_reward ?? 0);

  if (xpReward <= 0 && pointsReward <= 0) return;

  await applyXpPointsAndResolveLevels(db, userId, xpReward, pointsReward);
}

function buildCompletedMissionCorpus(completedMission: Record<string, unknown>): string {
  const title = normalizeMatchText(String(completedMission.title ?? ""));
  const description = normalizeMatchText(String(completedMission.description ?? ""));
  const exerciseCategory = normalizeMatchText(String(completedMission.exercise_category ?? ""));
  const exerciseName = normalizeMatchText(String(completedMission.exercise_name ?? ""));
  const exerciseTarget = normalizeMatchText(String(completedMission.exercise_target ?? ""));
  const metricType = normalizeMatchText(String(completedMission.metric_type ?? ""));
  const muscleGroups = parseMissionArrayField(completedMission.muscle_groups_json).map((item) => normalizeMatchText(item));

  return [title, description, exerciseCategory, exerciseName, exerciseTarget, metricType, ...muscleGroups]
    .filter((value) => value.length > 0)
    .join(" ");
}

function missionSubtaskMatchesCompletedMission(
  completedMission: Record<string, unknown>,
  subtask: NormalizedMissionSubtask,
): boolean {
  if (String(completedMission.type ?? "") !== "daily") {
    return false;
  }

  const completedCorpus = buildCompletedMissionCorpus(completedMission);
  const terms = [
    normalizeMatchText(subtask.compatibility_key),
    ...subtask.compatibility_terms.map((term) => normalizeMatchText(term)),
  ].filter((term) => term.length > 0);

  return terms.some((term) => completedCorpus.includes(term));
}

async function refreshMissionFromSubtasks(
  db: D1Database,
  userId: string,
  parentMissionId: number,
): Promise<void> {
  const missionRow = await db.prepare(
    `SELECT *
      FROM missions
      WHERE id = ? AND user_id = ?`
  ).bind(parentMissionId, userId).first<Record<string, unknown>>();
  if (!missionRow) return;

  const subtasksMap = await loadMissionSubtasksByParentIds(db, [parentMissionId]);
  const subtasks = subtasksMap.get(parentMissionId) ?? [];
  if (subtasks.length === 0) return;

  const circuitTasks = missionSubtasksToCircuitTasks(subtasks);
  const completedSubtaskCount = subtasks.filter((subtask) => subtask.is_completed).length;
  const hasProgressValueColumn = await hasTableColumn(db, "missions", "progress_value");
  if (hasProgressValueColumn) {
    await db.prepare(
      `UPDATE missions
        SET circuit_tasks_json = ?, progress_value = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).bind(JSON.stringify(circuitTasks), completedSubtaskCount, parentMissionId).run();
  } else {
    await db.prepare(
      `UPDATE missions
        SET circuit_tasks_json = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).bind(JSON.stringify(circuitTasks), parentMissionId).run();
  }

  const allCompleted = subtasks.every((subtask) => subtask.is_completed);
  if (!allCompleted) return;

  const missionsHaveStatus = await hasTableColumn(db, "missions", "status");
  const completionResult = missionsHaveStatus
    ? await db.prepare(
        `UPDATE missions
      SET is_completed = 1,
          status = 'completed',
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ? AND is_completed = 0`
      ).bind(parentMissionId).run()
    : await db.prepare(
        `UPDATE missions
      SET is_completed = 1,
          completed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ? AND is_completed = 0`
      ).bind(parentMissionId).run();

  if (Number(completionResult.meta.changes ?? 0) === 0) return;

  await grantCircuitRewards(db, userId, missionRow);
  await onMissionComplete(db, userId, parentMissionId);
}

async function updateMissionSubtaskProgress(userId: string, completedMission: Record<string, unknown>, db: D1Database) {
  await ensureMissionSubtaskSchema(db);

  const activeSubtasks = await db.prepare(
    `SELECT
        ms.id,
        ms.parent_mission_id,
        ms.mission_type,
        ms.subtask_title,
        ms.compatibility_key,
        ms.compatibility_terms_json,
        ms.required_count,
        ms.current_count,
        ms.is_completed,
        ms.created_at,
        ms.updated_at
      FROM mission_subtasks ms
      INNER JOIN missions m ON m.id = ms.parent_mission_id
      WHERE m.user_id = ?
        AND m.type IN ('weekly', 'monthly')
        AND m.is_completed = 0
        AND (m.deadline IS NULL OR m.deadline > datetime('now'))
        AND ms.is_completed = 0`
  ).bind(userId).all<MissionSubtaskRow>();

  const touchedParentIds = new Set<number>();
  for (const row of Array.isArray(activeSubtasks.results) ? activeSubtasks.results : []) {
    const subtask = normalizeMissionSubtaskRow(row);
    if (!missionSubtaskMatchesCompletedMission(completedMission, subtask)) continue;

    const nextCount = Math.min(subtask.required_count, subtask.current_count + 1);
    const isCompleted = nextCount >= subtask.required_count ? 1 : 0;
    await db.prepare(
      `UPDATE mission_subtasks
        SET current_count = ?,
            is_completed = ?,
            updated_at = datetime('now')
        WHERE id = ?`
    ).bind(nextCount, isCompleted, subtask.id).run();
    touchedParentIds.add(subtask.parent_mission_id);
  }

  for (const parentMissionId of touchedParentIds) {
    await refreshMissionFromSubtasks(db, userId, parentMissionId);
  }
}

async function updateCircuitProgress(userId: string, completedMission: Record<string, unknown>, db: D1Database) {
  const circuits = await db.prepare(
    `SELECT * FROM missions
      WHERE user_id = ?
        AND type = 'weekly'
        AND metric_type = 'circuit_tasks'
        AND is_completed = 0
        AND NOT EXISTS (
          SELECT 1 FROM mission_subtasks ms WHERE ms.parent_mission_id = missions.id
        )
        AND (deadline IS NULL OR deadline > datetime('now'))`
  ).bind(userId).all<Record<string, unknown>>();

  for (const circuit of circuits.results) {
    const tasks = parseCircuitTaskField(circuit.circuit_tasks_json);
    if (tasks.length === 0) continue;

    let changed = false;
    for (const task of tasks) {
      if (task.completed) continue;
      if (!missionMatchesTask(completedMission, task)) continue;

      task.current_count += 1;
      if (task.current_count >= task.required_count) {
        task.completed = true;
      }
      changed = true;
    }

    if (!changed) continue;

    const allCompleted = tasks.every((task) => task.completed);

    await db.prepare(
      `UPDATE missions
         SET circuit_tasks_json = ?, metric_value = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(JSON.stringify(tasks), tasks.filter((task) => task.completed).length, circuit.id).run();

    if (allCompleted) {
      const missionsHaveStatus = await hasTableColumn(db, "missions", "status");
      if (missionsHaveStatus) {
        await db.prepare(
          `UPDATE missions
           SET is_completed = 1, status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND is_completed = 0`
        ).bind(circuit.id).run();
      } else {
        await db.prepare(
          `UPDATE missions
           SET is_completed = 1, completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND is_completed = 0`
        ).bind(circuit.id).run();
      }

      await grantCircuitRewards(db, userId, circuit);
      await onMissionComplete(db, userId, Number(circuit.id));
    }
  }
}

function missionMetadataLooksMismatched(
  exerciseName: string,
  row: Record<string, unknown>,
): boolean {
  const normalizedExerciseName = normalizeMatchText(exerciseName);
  const normalizedResolvedName = normalizeMatchText(String(row.exercise_name ?? ""));
  const normalizedTarget = normalizeMatchText(String(row.exercise_target ?? ""));
  const normalizedBodyPart = normalizeMatchText(String(row.exercise_body_part ?? ""));

  if (normalizedExerciseName.includes("push") || normalizedExerciseName.includes("flexao")) {
    return !normalizedResolvedName.includes("push")
      || normalizedTarget.includes("abs")
      || normalizedBodyPart.includes("waist");
  }

  if (normalizedExerciseName.includes("plank") || normalizedExerciseName.includes("prancha")) {
    return !normalizedResolvedName.includes("plank")
      || (normalizedTarget.length > 0 && !normalizedTarget.includes("abs"))
      || (normalizedBodyPart.length > 0 && !normalizedBodyPart.includes("waist"));
  }

  if (normalizedExerciseName.includes("lunge") || normalizedExerciseName.includes("avanco")) {
    return !normalizedResolvedName.includes("lunge")
      || normalizedTarget.includes("abs")
      || normalizedBodyPart.includes("waist");
  }

  if (normalizedExerciseName.includes("squat") || normalizedExerciseName.includes("agach")) {
    return !normalizedResolvedName.includes("squat")
      || normalizedTarget.includes("abs")
      || normalizedBodyPart.includes("waist");
  }

  return false;
}

async function repairLegacyDailyMissionMetadata(env: Env, db: D1Database, userId: string): Promise<void> {
  const rows = await db.prepare(
    `SELECT
        id,
        title,
        exercise_name,
        exercise_equipment,
        exercise_body_part,
        exercise_target,
        exercise_db_gif_url,
        exercise_db_image_url,
        image_url,
        video_url,
        thumbnail_url
      FROM missions
      WHERE user_id = ?
        AND type = 'daily'
        AND is_completed = 0
        AND (deadline IS NULL OR deadline > datetime('now'))`
  ).bind(userId).all<Record<string, unknown>>();

  for (const row of Array.isArray(rows.results) ? rows.results : []) {
    const hasMedia = [
      row.exercise_db_gif_url,
      row.exercise_db_image_url,
      row.image_url,
      row.video_url,
      row.thumbnail_url,
    ].some((value) => typeof value === "string" && normalizeMissionMediaUrl(value) !== null);
    const hasExerciseMetadata = [
      row.exercise_equipment,
      row.exercise_body_part,
      row.exercise_target,
    ].some((value) => typeof value === "string" && value.trim().length > 0 && normalizeMatchText(value) !== "full body");

    const rawExerciseName = typeof row.exercise_name === "string" && row.exercise_name.trim().length > 0
      ? row.exercise_name
      : extractExerciseName(typeof row.title === "string" ? row.title : "");
    const exerciseName = rawExerciseName.trim();
    if (exerciseName.length === 0) {
      continue;
    }

    if (hasMedia && hasExerciseMetadata && !missionMetadataLooksMismatched(exerciseName, row)) {
      continue;
    }

    const enriched = await enrichExercise(exerciseName, env).catch(() => null);
    if (!enriched) {
      continue;
    }

    await db.prepare(
      `UPDATE missions
         SET exercise_name = ?,
             exercise_equipment = ?,
             exercise_body_part = ?,
             exercise_target = ?,
             exercise_secondary_muscles_json = ?,
             exercise_db_gif_url = ?,
             exercise_db_image_url = ?,
             image_url = ?,
             video_url = ?,
             thumbnail_url = ?,
             muscle_groups_json = ?,
             body_area = ?,
             updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      enriched.name,
      enriched.equipment || null,
      enriched.bodyPart || null,
      enriched.target || null,
      JSON.stringify(Array.isArray(enriched.secondaryMuscles) ? enriched.secondaryMuscles : []),
      enriched.exerciseDbGifUrl,
      enriched.exerciseDbImageUrl,
      enriched.imageUrl,
      enriched.videoUrl,
      enriched.thumbnailUrl,
      JSON.stringify(resolveExerciseApiMuscleGroups(enriched)),
      resolveExerciseApiBodyArea(enriched, exerciseName),
      row.id,
    ).run();
  }
}

app.get("/api/missions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const forceRefresh = c.req.query("refresh") === "1";
    if (forceRefresh) {
      await ensurePeriodicMissionsWithGuard(c.env, c.env.fitloot_db, user.id, { force: true });
    } else {
      schedulePeriodicMissionsRefreshWithGuard(c.env, c.env.fitloot_db, user.id, c.executionCtx);
    }

    if (!forceRefresh) {
      const cached = readMissionListCache(user.id);
      if (cached) {
        return streamJsonArrayResponse(cached);
      }
    }

    let missions;
    try {
      missions = await c.env.fitloot_db.prepare(
        `SELECT m.*, s.name as skill_name FROM missions m
        LEFT JOIN skills s ON m.skill_id = s.id
        WHERE m.user_id = ?
        AND (
          (m.is_completed = 0 AND (m.deadline IS NULL OR m.deadline > datetime('now')))
          OR (m.is_completed = 1 AND datetime(COALESCE(m.completed_at, m.updated_at)) >= datetime('now', '-30 day'))
          OR (COALESCE(m.status,'pending') IN ('failed', 'expired') AND date(m.updated_at) >= date('now', '-3 day'))
        )
        ORDER BY CASE m.type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 ELSE 4 END, m.created_at DESC
        LIMIT 240`
      ).bind(user.id).all();
    } catch (statusQueryError) {
      const message = getErrorMessage(statusQueryError).toLowerCase();
      const missingStatusColumn = message.includes("no such column") && message.includes("status");
      if (!missingStatusColumn) {
        throw statusQueryError;
      }

      missions = await c.env.fitloot_db.prepare(
        `SELECT m.*, s.name as skill_name FROM missions m
        LEFT JOIN skills s ON m.skill_id = s.id
        WHERE m.user_id = ?
        AND (
          (m.is_completed = 0 AND (m.deadline IS NULL OR m.deadline > datetime('now')))
          OR (m.is_completed = 1 AND datetime(COALESCE(m.completed_at, m.updated_at)) >= datetime('now', '-30 day'))
        )
        ORDER BY CASE m.type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 ELSE 4 END, m.created_at DESC
        LIMIT 240`
      ).bind(user.id).all();
    }

    const missionList = await hydrateMissionRowsWithSubtasks(
      c.env.fitloot_db,
      (Array.isArray(missions.results) ? missions.results : []) as Record<string, unknown>[],
    );
    const monthlyCounters = await getMonthlyCounters(c.env.fitloot_db, user.id);
    const withProgress = missionList.map((row) => {
      const rawMission = row as Record<string, unknown>;
      const normalizedMission = normalizeMissionRow(rawMission);
      const isMonthly = rawMission.type === "monthly";
      if (!isMonthly) return normalizedMission;
      if (normalizedMission.circuit_tasks.length > 0 && normalizedMission.progress_value !== undefined) {
        return normalizedMission;
      }

      const isCompleted = Number(rawMission.is_completed ?? 0) === 1;
      return {
        ...normalizedMission,
        progress_value: isCompleted
          ? Number(normalizedMission.metric_value ?? 1)
          : monthlyMissionProgressValue(rawMission, monthlyCounters),
      };
    });
    const summaries = withProgress.map((mission) => missionSummaryFromNormalized(mission as NormalizedMissionRow));
    writeMissionListCache(user.id, summaries);
    return streamJsonArrayResponse(summaries);
  } catch (error) {
    console.error("[/api/missions]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.get("/api/missions/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const missionId = Number(c.req.param("id"));
  if (!Number.isInteger(missionId) || missionId <= 0) {
    return c.json({ error: "Mission id invalido" }, 400);
  }

  try {
    const row = await c.env.fitloot_db.prepare(
      `SELECT m.*, s.name as skill_name
       FROM missions m
       LEFT JOIN skills s ON m.skill_id = s.id
       WHERE m.id = ? AND m.user_id = ?`
    ).bind(missionId, user.id).first<Record<string, unknown>>();

    if (!row) {
      return c.json({ error: "Mission not found" }, 404);
    }

    const hydratedRows = await hydrateMissionRowsWithSubtasks(c.env.fitloot_db, [row]);
    const normalized = normalizeMissionRow(hydratedRows[0] ?? row);
    if (
      normalized.type === "monthly" &&
      Number(normalized.is_completed ?? 0) !== 1 &&
      !(normalized.circuit_tasks.length > 0 && normalized.progress_value !== undefined)
    ) {
      const monthlyCounters = await getMonthlyCounters(c.env.fitloot_db, user.id);
      normalized.progress_value = monthlyMissionProgressValue(row, monthlyCounters);
    }

    return c.json(normalized);
  } catch (error) {
    console.error("[/api/missions/:id]", {
      message: getErrorMessage(error),
      userId: user.id,
      missionId,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/missions/generate", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const result = await generateStructuredMissionPlanForUser(c.env, c.env.fitloot_db, user.id, {
      isAiSpecial: false,
      dailyTarget: MISSION_LIMITS.daily,
      weeklyTarget: MISSION_LIMITS.weekly,
      monthlyTarget: MISSION_LIMITS.monthly,
    });

    return c.json({
      success: true,
      generated: !result.already_active,
      code: result.already_active ? "MISSIONS_ALREADY_ACTIVE" : undefined,
      used_ai: result.used_ai,
      invalid_ratio: result.invalid_ratio,
      missions: result.missions,
    });
  } catch (error) {
    console.error("[/api/missions/generate]", {
      message: getErrorMessage(error),
      userId: user.id,
    });
    return internalErrorResponse(c);
  }
});

app.post("/api/missions/generate/ai-special", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const result = await generateStructuredMissionPlanForUser(c.env, c.env.fitloot_db, user.id, {
      isAiSpecial: true,
      dailyTarget: 1,
      weeklyTarget: 0,
      monthlyTarget: 0,
    });

    return c.json({
      success: true,
      generated: !result.already_active,
      code: result.already_active ? "AI_SPECIAL_ALREADY_ACTIVE" : undefined,
      used_ai: result.used_ai,
      invalid_ratio: result.invalid_ratio,
      missions: result.missions,
    });
  } catch (error) {
    console.error("[/api/missions/generate/ai-special]", {
      message: getErrorMessage(error),
      userId: user.id,
    });
    return internalErrorResponse(c);
  }
});

app.post("/api/missions/complete", authMiddleware, zValidator("json", CompleteMissionRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const data = c.req.valid("json");
  const completedMetricValue = Number(data.metric_completed ?? data.reps_completed ?? data.time_completed ?? 0);
  let completionPhase = "load_mission";

  try {
    const mission = await c.env.fitloot_db.prepare(
      "SELECT * FROM missions WHERE id = ? AND user_id = ? AND is_completed = 0"
    ).bind(data.mission_id, user.id).first<{
      id: number;
      type: string;
      xp_reward: number | null;
      points_reward: number | null;
      skill_id: number | null;
    }>();

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    if (mission.type === "weekly" || mission.type === "monthly") {
      return c.json(
        {
          error: "Missoes semanais e mensais nao podem ser concluidas manualmente. O progresso acontece automaticamente pelas missoes diarias compativeis.",
          code: "MISSION_AUTO_PROGRESS_ONLY",
        },
        400,
      );
    }

    let streakMultiplier = 1;
    let xpGained = 0;
    let pointsGained = 0;
    let leveledUp = false;

    completionPhase = "schema_probe";
    const [missionsTableHasStatus, countersHaveConsecutiveDays, countersHaveLongestDays] =
      await Promise.all([
        hasTableColumn(c.env.fitloot_db, "missions", "status"),
        hasTableColumn(c.env.fitloot_db, "user_event_counters", "consecutive_days_completed"),
        hasTableColumn(c.env.fitloot_db, "user_event_counters", "longest_consecutive_days"),
      ]);
    const countersHaveStreakDayColumns = countersHaveConsecutiveDays && countersHaveLongestDays;

    completionPhase = "transaction";
    await withTransaction(c.env.fitloot_db, async () => {
      completionPhase = "mark_completed";
      if (missionsTableHasStatus) {
        await c.env.fitloot_db.prepare(
          `UPDATE missions SET is_completed = 1, status = 'completed', completed_at = datetime('now'),
        verified_by_sensor = ?, updated_at = datetime('now')
        WHERE id = ?`
        ).bind(data.sensor_verified ? 1 : 0, data.mission_id).run();
      } else {
        await c.env.fitloot_db.prepare(
          `UPDATE missions SET is_completed = 1, completed_at = datetime('now'),
        verified_by_sensor = ?, updated_at = datetime('now')
        WHERE id = ?`
        ).bind(data.sensor_verified ? 1 : 0, data.mission_id).run();
      }

      completionPhase = "load_progression";
      const progression = await c.env.fitloot_db.prepare(
        "SELECT * FROM user_progression WHERE user_id = ?"
      ).bind(user.id).first<UserProgression>();

      const today = assertString(safeGet(new Date().toISOString().split('T'), 0));
      let newStreak = Number(progression?.current_streak || 0);

      if (progression?.last_activity_date !== today) {
        completionPhase = "calculate_streak";
        const yesterday = assertString(safeGet(new Date(Date.now() - 86400000).toISOString().split('T'), 0));
        newStreak = 1;

        if (progression?.last_activity_date === yesterday) {
          newStreak = Number(progression?.current_streak || 0) + 1;
        }

        streakMultiplier = 1 + (newStreak * 0.1);

        completionPhase = "update_streak_db";
        await c.env.fitloot_db.prepare(
          `UPDATE user_progression SET current_streak = ?, best_streak = MAX(best_streak, ?), 
          last_activity_date = ?, updated_at = datetime('now')
          WHERE user_id = ?`
        ).bind(newStreak, newStreak, today, user.id).run();
      } else {
        streakMultiplier = 1 + (Number(progression?.current_streak || 0) * 0.1);
      }

      completionPhase = "calculate_rewards";
      xpGained = Math.max(0, Math.floor(Number(mission.xp_reward || 0) * streakMultiplier));
      pointsGained = Math.max(0, Number(mission.points_reward || 0));

      completionPhase = "award_xp_and_levels";
      const progressionOutcome = await applyXpPointsAndResolveLevels(c.env.fitloot_db, user.id, xpGained, pointsGained);
      leveledUp = progressionOutcome.leveledUp;

      completionPhase = "update_event_counters_db";
      await ensureUserCounterRow(c.env.fitloot_db, user.id);
      const currentHour = new Date().getHours();
      if (countersHaveStreakDayColumns) {
        await c.env.fitloot_db.prepare(
          `UPDATE user_event_counters
          SET missions_completed = COALESCE(missions_completed, 0) + 1,
              consecutive_days_completed = ?,
              longest_consecutive_days = MAX(COALESCE(longest_consecutive_days, 0), ?),
              updated_at = datetime('now')
          WHERE user_id = ?`
        ).bind(newStreak, newStreak, user.id).run();
      } else {
        await c.env.fitloot_db.prepare(
          `UPDATE user_event_counters
          SET missions_completed = COALESCE(missions_completed, 0) + 1,
              updated_at = datetime('now')
          WHERE user_id = ?`
        ).bind(user.id).run();
      }

      completionPhase = "lifecycle_mission_events";
      await runMissionLifecycleHookSafely(user.id, "mission_complete_event", () =>
        logUserEvent(c.env.fitloot_db, user.id, 'mission_complete', {
          missionId: mission.id,
          period: mission.type,
          xpGained,
          pointsGained,
          hour: currentHour,
          leveledUp,
        }),
      );

      completionPhase = "lifecycle_streak";
      const completedToday = await c.env.fitloot_db.prepare("SELECT COUNT(*) as c FROM missions WHERE user_id = ? AND is_completed = 1 AND date(completed_at) = date('now')").bind(user.id).first<{ c: number }>();
      await runMissionLifecycleHookSafely(user.id, "streak_continued", () =>
        onStreakContinued(c.env.fitloot_db, user.id, newStreak, Number(completedToday?.c ?? 1), new Date().toISOString()),
      );

      completionPhase = "lifecycle_on_mission_complete";
      await runMissionLifecycleHookSafely(user.id, "on_mission_complete_hook", () =>
        onMissionComplete(c.env.fitloot_db, user.id, Number(mission.id))
      );

      completionPhase = "lifecycle_subtasks";
      await runMissionLifecycleHookSafely(user.id, "update_subtasks", () =>
        updateMissionSubtaskProgress(user.id, mission as Record<string, unknown>, c.env.fitloot_db),
      );

      completionPhase = "lifecycle_weekly_circuits";
      await runMissionLifecycleHookSafely(user.id, "update_weekly_circuits", () =>
        updateCircuitProgress(user.id, mission as Record<string, unknown>, c.env.fitloot_db),
      );

      completionPhase = "lifecycle_monthly_progress";
      await runMissionLifecycleHookSafely(user.id, "update_monthly_progress", () =>
        updateMonthlyMissionProgress(user.id, c.env.fitloot_db),
      );

      completionPhase = "lifecycle_goal_progress";
      await runMissionLifecycleHookSafely(user.id, "goal_progress", async () => {
        const relevance = await checkMissionRelevance(user.id, Number(mission.id), c.env.fitloot_db, 'completed');
        if (!relevance.isGoalRelevant) return;

        const gs = await c.env.fitloot_db.prepare("SELECT goal_completed_count FROM user_goal_stats WHERE user_id = ?").bind(user.id).first<{ goal_completed_count: number }>();
        const progressPercent = Math.min(200, Math.floor((Number(gs?.goal_completed_count ?? 0) / 100) * 100));
        await c.env.fitloot_db.prepare("UPDATE user_goal_stats SET goal_progress_percent = ?, updated_at = datetime('now') WHERE user_id = ?").bind(progressPercent, user.id).run();
        await onGoalProgress(c.env.fitloot_db, user.id, progressPercent);
      });

      if (currentHour >= 2 && currentHour < 4) {
        completionPhase = "lifecycle_night_achievement";
        await runMissionLifecycleHookSafely(user.id, "night_achievement", () =>
          unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'Insônia', 1, 1),
        );
      }

      completionPhase = "update_skill_progress";
      const missionRecord = mission as Record<string, unknown>;
      const missionMetricType = normalizeMissionMetricType(
        missionRecord.metric_type,
        missionRecord.target_time
      );
      const repsForSkill = missionMetricType === "repetitions" || missionMetricType === "sets_reps"
        ? completedMetricValue
        : 0;
      const timeForSkill = missionMetricType === "duration_seconds"
        ? completedMetricValue
        : missionMetricType === "duration_minutes"
          ? completedMetricValue * 60
          : 0;

      if (mission.skill_id && (repsForSkill > 0 || timeForSkill > 0)) {
        completionPhase = "update_skill_stats_db";
        await c.env.fitloot_db.prepare(
          `UPDATE user_skills SET total_reps = total_reps + ?, total_time = total_time + ?, best_reps = MAX(best_reps, ?), updated_at = datetime('now')
          WHERE user_id = ? AND skill_id = ?`
        ).bind(repsForSkill, timeForSkill, repsForSkill, user.id, mission.skill_id).run();

        const skill = await c.env.fitloot_db.prepare(
          "SELECT * FROM skills WHERE id = ?"
        ).bind(mission.skill_id).first();

        if (skill) {
          completionPhase = "update_attributes_db";
          await c.env.fitloot_db.prepare(
            `UPDATE user_attributes SET 
            strength = strength + ?, constitution = constitution + ?, 
            vitality = vitality + ?, dexterity = dexterity + ?, 
            focus = focus + ?, updated_at = datetime('now')
            WHERE user_id = ?`
          ).bind(
            skill.strength_gain, skill.constitution_gain,
            skill.vitality_gain, skill.dexterity_gain,
            skill.focus_gain, user.id
          ).run();
        }
      }
      completionPhase = "completed";
    });

    try {
      invalidateRankingCache();
      invalidateMissionListCache(user.id);
    } catch (cacheError) {
      console.error("[/api/missions/complete] cache invalidation failed:", cacheError);
    }

    c.executionCtx.waitUntil(
      ensurePeriodicMissionsWithGuard(c.env, c.env.fitloot_db, user.id, { force: true }).catch((refreshError) => {
        console.error("[/api/missions/complete][refresh]", {
          userId: user.id,
          missionId: data.mission_id,
          message: getErrorMessage(refreshError),
        });
      }),
    );

    return c.json({
      success: true,
      xpGained,
      pointsGained,
      leveledUp,
      streakMultiplier: streakMultiplier.toFixed(1)
    });
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.error("[/api/missions/complete]", {
      userId: user.id,
      missionId: data.mission_id,
      phase: completionPhase,
      message: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json({ error: "Erro interno", code: "INTERNAL_ERROR", phase: completionPhase, detail: errorMsg }, 500);
  }
});

// Achievements and titles
app.get("/api/achievements", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const achievements = await c.env.fitloot_db.prepare(
    `SELECT a.*, ua.unlocked_at, ua.progress_current, ua.progress_required,
    CASE WHEN ua.id IS NOT NULL THEN 1 ELSE 0 END as unlocked
    FROM achievements a
    LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?
    ORDER BY a.secret ASC, a.rarity, a.id`
  ).bind(user.id).all<Record<string, unknown>>();

  const mapped = achievements.results.map((achievement) => {
    const normalizedAchievement = {
      ...achievement,
      name: typeof achievement.name === "string" ? repairKnownMojibakeString(achievement.name) : achievement.name,
      description:
        typeof achievement.description === "string"
          ? repairKnownMojibakeString(achievement.description)
          : achievement.description,
      rarity:
        typeof achievement.rarity === "string"
          ? repairKnownMojibakeString(achievement.rarity)
          : achievement.rarity,
      reference:
        typeof achievement.reference === "string"
          ? repairKnownMojibakeString(achievement.reference)
          : achievement.reference,
    };
    const unlocked = Number(achievement.unlocked ?? 0) === 1;
    const isSecret = Number(achievement.secret ?? 0) === 1;
    if (isSecret && !unlocked) {
      return {
        ...normalizedAchievement,
        name: "?",
        description: "Conquista secreta",
        condition: null,
        icon: "Ã¢Ââ€œ",
      };
    }
    return normalizedAchievement;
  });

  return c.json(mapped);
});

app.get("/api/titles", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const titles = await c.env.fitloot_db.prepare(
      `SELECT t.*, ut.is_active, ut.unlocked_at,
      CASE WHEN ut.id IS NOT NULL THEN 1 ELSE 0 END as unlocked
      FROM titles t
      LEFT JOIN user_titles ut ON t.id = ut.title_id AND ut.user_id = ?
      ORDER BY t.rarity, t.id`
    ).bind(user.id).all();

    return c.json(Array.isArray(titles.results) ? titles.results : []);
  } catch (error) {
    console.error("[/api/titles]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/titles/:id/activate", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const titleId = parseInt(c.req.param("id"));

  // Deactivate all titles
  await c.env.fitloot_db.prepare(
    "UPDATE user_titles SET is_active = 0, is_equipped = 0 WHERE user_id = ?"
  ).bind(user.id).run();

  // Activate selected title
  await c.env.fitloot_db.prepare(
    "UPDATE user_titles SET is_active = 1, is_equipped = 1, updated_at = datetime('now') WHERE user_id = ? AND title_id = ?"
  ).bind(user.id, titleId).run();

  return c.json({ success: true });
});

// Shop endpoints
const SHOP_PRODUCTS_CACHE_TTL_MS = 2 * 60_000;
let shopProductsCacheEntry: { payload: Record<string, unknown>[]; expiresAt: number } | null = null;

function readShopProductsCache(): Record<string, unknown>[] | null {
  if (!shopProductsCacheEntry) return null;
  if (shopProductsCacheEntry.expiresAt <= Date.now()) {
    shopProductsCacheEntry = null;
    return null;
  }
  return shopProductsCacheEntry.payload;
}

function writeShopProductsCache(payload: Record<string, unknown>[]): void {
  shopProductsCacheEntry = {
    payload,
    expiresAt: Date.now() + SHOP_PRODUCTS_CACHE_TTL_MS,
  };
}

function invalidateShopProductsCache(): void {
  shopProductsCacheEntry = null;
}

app.get("/api/shop/products", authMiddleware, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 200), 1), 500);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

  const cachedProducts = readShopProductsCache();
  if (cachedProducts && offset === 0 && limit >= cachedProducts.length) {
    return streamJsonArrayResponse(cachedProducts);
  }

  const products = await c.env.fitloot_db.prepare(
    `SELECT p.*, sp.name as partner_name, sp.logo_url as partner_logo
    FROM shop_products p
    INNER JOIN shop_partners sp ON p.partner_id = sp.id
    WHERE p.is_available = 1
    ORDER BY p.category, p.points_cost
    LIMIT ? OFFSET ?`
  ).bind(limit, offset).all<Record<string, unknown>>();

  const payload = Array.isArray(products.results) ? products.results : [];
  if (offset === 0) {
    writeShopProductsCache(payload);
  }

  return streamJsonArrayResponse(payload);
});

app.post("/api/shop/purchase/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const productId = parseInt(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as { request_id?: string | undefined };
  const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";

  if (requestId) {
    const existingOrder = await c.env.fitloot_db.prepare(
      "SELECT qr_code FROM coupon_orders WHERE user_id = ? AND request_id = ? LIMIT 1"
    ).bind(user.id, requestId).first<{ qr_code: string }>();
    if (existingOrder?.qr_code) {
      return c.json({ success: true, qr_code: existingOrder.qr_code, reused: true });
    }
  }

  const product = await c.env.fitloot_db.prepare(
    "SELECT * FROM shop_products WHERE id = ? AND is_available = 1"
  ).bind(productId).first();

  if (!product) {
    return c.json({ error: "Product not found" }, 404);
  }

  const progression = await c.env.fitloot_db.prepare(
    "SELECT points FROM user_progression WHERE user_id = ?"
  ).bind(user.id).first();

  if (Number(progression?.points || 0) < Number(product.points_cost || 0)) {
    return c.json({ error: "Insufficient points" }, 400);
  }

  const qrCode = `FITLOOT-${crypto.randomUUID()}`;

  try {
    await withTransaction(c.env.fitloot_db, async () => {
      const deduction = await c.env.fitloot_db.prepare(
        "UPDATE user_progression SET points = points - ?, updated_at = datetime('now') WHERE user_id = ? AND points >= ?"
      ).bind(product.points_cost, user.id, product.points_cost).run();
      if (Number(deduction.meta?.changes ?? 0) === 0) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      await c.env.fitloot_db.prepare(
        `INSERT INTO coupon_orders (user_id, product_id, points_spent, qr_code, request_id, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).bind(user.id, productId, product.points_cost, qrCode, requestId || null).run();
    });
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (message.includes("insufficient_points")) {
      return c.json({ error: "Insufficient points" }, 400);
    }
    if (requestId && message.includes("unique") && message.includes("coupon_orders.request_id")) {
      const existingOrder = await c.env.fitloot_db.prepare(
        "SELECT qr_code FROM coupon_orders WHERE user_id = ? AND request_id = ? LIMIT 1"
      ).bind(user.id, requestId).first<{ qr_code: string }>();
      if (existingOrder?.qr_code) {
        return c.json({ success: true, qr_code: existingOrder.qr_code, reused: true });
      }
    }
    throw error;
  }

  invalidateRankingCache();
  invalidateShopProductsCache();

  return c.json({ success: true, qr_code: qrCode });
});

app.get("/api/shop/orders", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 80), 1), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

  const orders = await c.env.fitloot_db.prepare(
    `SELECT co.*, p.name as product_name, p.image_url
    FROM coupon_orders co
    INNER JOIN shop_products p ON co.product_id = p.id
    WHERE co.user_id = ?
    ORDER BY co.created_at DESC
    LIMIT ? OFFSET ?`
  ).bind(user.id, limit, offset).all();

  return c.json(orders.results);
});

// Daily metrics
app.get("/api/metrics/today", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const today = assertString(safeGet(new Date().toISOString().split('T'), 0));

    let metrics = await c.env.fitloot_db.prepare(
      "SELECT * FROM daily_metrics WHERE user_id = ? AND date = ?"
    ).bind(user.id, today).first();

    if (!metrics) {
      await c.env.fitloot_db.prepare(
        `INSERT INTO daily_metrics (user_id, date, steps, calories_burned, updated_at)
        VALUES (?, ?, 0, 0, datetime('now'))`
      ).bind(user.id, today).run();

      metrics = await c.env.fitloot_db.prepare(
        "SELECT * FROM daily_metrics WHERE user_id = ? AND date = ?"
      ).bind(user.id, today).first();
    }

    return c.json(metrics ?? { user_id: user.id, date: today, steps: 0, calories_burned: 0 });
  } catch (error) {
    console.error("[/api/metrics/today]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/metrics/update", authMiddleware, zValidator("json", UpdateDailyMetricsRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const data = c.req.valid("json");
  const today = assertString(safeGet(new Date().toISOString().split('T'), 0));

  await c.env.fitloot_db.prepare(
    `INSERT INTO daily_metrics (user_id, date, steps, calories_burned, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, date) DO UPDATE SET
    steps = ?, calories_burned = ?, updated_at = datetime('now')`
  ).bind(user.id, today, data.steps, data.calories_burned, data.steps, data.calories_burned).run();

  return c.json({ success: true });
});

// Food diary
app.post("/api/food/scan", authMiddleware, zValidator("json", FoodScanRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const data = c.req.valid("json");

  await c.env.fitloot_db.prepare(
    `INSERT INTO food_diary (user_id, food_name, calories, meal_type, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(user.id, data.food_name, data.calories || 0, data.meal_type || 'lanche').run();

  return c.json({ success: true });
});

app.get("/api/food/today", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const today = assertString(safeGet(new Date().toISOString().split('T'), 0));
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 300);

  const foods = await c.env.fitloot_db.prepare(
    `SELECT * FROM food_diary 
    WHERE user_id = ? AND DATE(scanned_at) = ?
    ORDER BY scanned_at DESC
    LIMIT ?`
  ).bind(user.id, today, limit).all();

  return c.json(foods.results);
});

type RankingRow = {
  user_id: string;
  username: string;
  full_name: string;
  level: number;
  xp: number;
  current_streak: number;
  points: number;
};

const RANKING_CACHE_TTL_MS = 15_000;
let rankingCacheEntry: { rows: RankingRow[]; expiresAt: number } | null = null;

function readRankingCache(): RankingRow[] | null {
  if (!rankingCacheEntry) return null;
  if (rankingCacheEntry.expiresAt <= Date.now()) {
    rankingCacheEntry = null;
    return null;
  }
  return rankingCacheEntry.rows;
}

function writeRankingCache(rows: RankingRow[]): void {
  rankingCacheEntry = {
    rows,
    expiresAt: Date.now() + RANKING_CACHE_TTL_MS,
  };
}

function invalidateRankingCache(): void {
  rankingCacheEntry = null;
}

// Ranking
app.get("/api/ranking/global", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let rankingRows = readRankingCache();
  if (!rankingRows) {
    const ranking = await c.env.fitloot_db.prepare(
      `SELECT up.user_id, up.username, up.full_name, pr.level, pr.xp, pr.current_streak, pr.points
      FROM user_profiles up
      INNER JOIN user_progression pr ON up.user_id = pr.user_id
      ORDER BY pr.level DESC, pr.xp DESC
      LIMIT 100`
    ).all<RankingRow>();
    rankingRows = Array.isArray(ranking.results) ? ranking.results : [];
    writeRankingCache(rankingRows);
  }

  const position = rankingRows.findIndex((row) => row.user_id === user.id) + 1;
  if (position > 0) {
    await ensureUserCounterRow(c.env.fitloot_db, user.id);
    await onRankingUpdate(c.env.fitloot_db, user.id, position);
    if (position <= 100) await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'Na Disputa', 100 - position + 1, 100);
    if (position <= 10) await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'Elite', 10 - position + 1, 10);
    if (position === 1) await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'O Escolhido', 1, 1);
  }

  const sanitized = rankingRows.map((row) => {
    const sanitized = { ...(row as Record<string, unknown>) };
    delete sanitized.user_id;
    return sanitized;
  });
  return streamJsonArrayResponse(sanitized);
});

// Friends endpoints
app.get("/api/friends/search", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const username = (c.req.query("username") ?? "").trim();
  if (username.length < 3) return c.json([]);

  const users = await c.env.fitloot_db.prepare(
    `SELECT up.user_id, up.username, up.full_name, pr.level, pr.xp
      FROM user_profiles up
      INNER JOIN user_progression pr ON up.user_id = pr.user_id
      WHERE up.user_id != ? AND up.username LIKE ?
      LIMIT 20`
  ).bind(user.id, `%${username}%`).all();

  return c.json(users.results);
});

app.get("/api/users/search", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 3) return c.json([]);
  const users = await c.env.fitloot_db.prepare(
    `SELECT up.user_id, up.username, up.full_name, pr.level, pr.xp
      FROM user_profiles up
      INNER JOIN user_progression pr ON up.user_id = pr.user_id
      WHERE up.user_id != ? AND up.username LIKE ?
      LIMIT 20`
  ).bind(user.id, `%${q}%`).all();
  return c.json(users.results);
});

app.post("/api/friends/request", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { username?: string | undefined; friend_user_id?: string | undefined };
  const username = String(body.username ?? "").trim();
  let targetUserId = String(body.friend_user_id ?? "").trim();

  if (!targetUserId) {
    if (!username) return c.json({ error: "username ÃƒÂ© obrigatÃƒÂ³rio" }, 400);
    const target = await c.env.fitloot_db.prepare("SELECT user_id FROM user_profiles WHERE username = ?").bind(username).first<{ user_id: string }>();
    if (!target?.user_id) return c.json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado" }, 404);
    targetUserId = target.user_id;
  }

  if (targetUserId === user.id) return c.json({ error: "NÃƒÂ£o ÃƒÂ© possÃƒÂ­vel adicionar a si mesmo" }, 400);

  const existingFriend = await c.env.fitloot_db.prepare(
    `SELECT id FROM friendships
      WHERE (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)
         OR (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)`
  ).bind(user.id, targetUserId, targetUserId, user.id).first();
  if (existingFriend) return c.json({ error: "JÃƒÂ¡ sÃƒÂ£o amigos" }, 400);

  const existingReq = await c.env.fitloot_db.prepare(
    `SELECT id FROM friend_requests WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) AND status = 'pending'`
  ).bind(user.id, targetUserId, targetUserId, user.id).first();
  if (existingReq) return c.json({ error: "SolicitaÃƒÂ§ÃƒÂ£o pendente" }, 400);

  await c.env.fitloot_db.prepare(
    `INSERT INTO friend_requests (from_user_id, to_user_id, status, updated_at) VALUES (?, ?, 'pending', datetime('now'))`
  ).bind(user.id, targetUserId).run();

  return c.json({ success: true }, 201);
});

app.post("/api/friends/accept", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { request_id?: number | undefined };
  const requestId = Number(body.request_id);
  if (!requestId) return c.json({ error: "request_id obrigatÃƒÂ³rio" }, 400);

  const request = await c.env.fitloot_db.prepare(
    `SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`
  ).bind(requestId, user.id).first<{ id: number; from_user_id: string; to_user_id: string }>();
  if (!request) return c.json({ error: "SolicitaÃƒÂ§ÃƒÂ£o nÃƒÂ£o encontrada" }, 404);

  await withTransaction(c.env.fitloot_db, async () => {
    await c.env.fitloot_db.prepare(
      "UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?"
    ).bind(requestId).run();
    await c.env.fitloot_db.prepare(
      `INSERT OR IGNORE INTO friendships (user_id, friend_user_id, friend_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'accepted', datetime('now'), datetime('now'))`
    ).bind(request.from_user_id, request.to_user_id, request.to_user_id).run();
    await c.env.fitloot_db.prepare(
      `INSERT OR IGNORE INTO friendships (user_id, friend_user_id, friend_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'accepted', datetime('now'), datetime('now'))`
    ).bind(request.to_user_id, request.from_user_id, request.from_user_id).run();
  });

  await onFriendAdded(c.env.fitloot_db, request.to_user_id);
  await onFriendAdded(c.env.fitloot_db, request.from_user_id);

  return c.json({ success: true });
});

app.post("/api/friends/reject", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { request_id?: number | undefined };
  const requestId = Number(body.request_id);
  if (!requestId) return c.json({ error: "request_id obrigatÃƒÂ³rio" }, 400);

  await c.env.fitloot_db.prepare(
    `UPDATE friend_requests SET status = 'rejected', updated_at = datetime('now') WHERE id = ? AND to_user_id = ?`
  ).bind(requestId, user.id).run();

  return c.json({ success: true });
});

app.delete("/api/friends/:friendId", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const friendId = c.req.param("friendId");
  await c.env.fitloot_db.prepare(
    `DELETE FROM friendships
      WHERE (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)
         OR (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)`
  )
    .bind(user.id, friendId, friendId, user.id).run();
  return c.json({ success: true });
});

app.get("/api/friends", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 120), 1), 300);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

  const friends = await c.env.fitloot_db.prepare(
    `SELECT f.id, COALESCE(f.friend_id, f.friend_user_id) as friend_user_id, up.username as friend_username,
      up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
      pr.current_streak as friend_streak
    FROM friendships f
    INNER JOIN user_profiles up ON COALESCE(f.friend_id, f.friend_user_id) = up.user_id
    INNER JOIN user_progression pr ON COALESCE(f.friend_id, f.friend_user_id) = pr.user_id
    WHERE f.user_id = ?
    ORDER BY friend_level DESC, friend_xp DESC
    LIMIT ? OFFSET ?`
  ).bind(user.id, limit, offset).all();

  return c.json(friends.results);
});

app.get("/api/friends/requests", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 80), 1), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

  const requests = await c.env.fitloot_db.prepare(
    `SELECT fr.id, fr.from_user_id as friend_user_id, up.username as friend_username,
      up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
      pr.current_streak as friend_streak, fr.created_at
    FROM friend_requests fr
    INNER JOIN user_profiles up ON fr.from_user_id = up.user_id
    INNER JOIN user_progression pr ON fr.from_user_id = pr.user_id
    WHERE fr.to_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
    LIMIT ? OFFSET ?`
  ).bind(user.id, limit, offset).all();

  return c.json(requests.results);
});

// legacy aliases
app.get("/api/friends/list", authMiddleware, async (c) => app.fetch(new Request(new URL('/api/friends', c.req.url).toString(), { method: 'GET', headers: c.req.raw.headers }), c.env, c.executionCtx));
app.post("/api/friends/:id/accept", authMiddleware, async (c) => app.fetch(new Request(new URL('/api/friends/accept', c.req.url).toString(), { method: 'POST', headers: c.req.raw.headers, body: JSON.stringify({ request_id: Number(c.req.param('id')) }) }), c.env, c.executionCtx));
app.post("/api/friends/:id/reject", authMiddleware, async (c) => app.fetch(new Request(new URL('/api/friends/reject', c.req.url).toString(), { method: 'POST', headers: c.req.raw.headers, body: JSON.stringify({ request_id: Number(c.req.param('id')) }) }), c.env, c.executionCtx));

async function registerMiniGameResult(db: D1Database, userId: string, didWin: boolean) {
  await ensureUserCounterRow(db, userId);

  await db.prepare(
    `UPDATE user_event_counters
      SET minigames_played = COALESCE(minigames_played, 0) + 1,
          minigames_won = COALESCE(minigames_won, 0) + ?,
          minigame_win_streak = CASE
            WHEN ? = 1 THEN COALESCE(minigame_win_streak, 0) + 1
            ELSE 0
          END,
          updated_at = datetime('now')
      WHERE user_id = ?`
  ).bind(didWin ? 1 : 0, didWin ? 1 : 0, userId).run();

  const counters = await db.prepare(
    "SELECT minigames_played, minigames_won, minigame_win_streak FROM user_event_counters WHERE user_id = ?"
  ).bind(userId).first<{ minigames_played: number; minigames_won: number; minigame_win_streak: number }>();

  const played = Number(counters?.minigames_played ?? 0);
  const won = Number(counters?.minigames_won ?? 0);
  const winStreak = Number(counters?.minigame_win_streak ?? 0);

  if (played >= 1) {
    await unlockAchievementIfNeeded(db, userId, "Jogador", played, 1);
  }
  if (won >= 10) {
    await unlockAchievementIfNeeded(db, userId, "Competidor", won, 10);
  }
  if (winStreak >= 50) {
    await unlockAchievementIfNeeded(db, userId, "Imbati­vel", winStreak, 50);
  }
}
// Mini-games endpoints
app.post("/api/mini-games/challenge", authMiddleware, zValidator("json", MiniGameChallengeRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const data = c.req.valid("json");

  let challengedUserId = data.challenged_user_id;

  // If random opponent, find a random user with similar level
  if (data.opponent_type === 'random') {
    const progression = await c.env.fitloot_db.prepare(
      "SELECT level FROM user_progression WHERE user_id = ?"
    ).bind(user.id).first();

    const level = Number(progression?.level || 1);
    const minLevel = Math.max(1, level - 5);
    const maxLevel = level + 5;

    const randomUser = await c.env.fitloot_db.prepare(
      `SELECT user_id FROM user_progression 
      WHERE user_id != ? AND level BETWEEN ? AND ?
      ORDER BY RANDOM()
      LIMIT 1`
    ).bind(user.id, minLevel, maxLevel).first();

    if (!randomUser) {
      return c.json({ error: "No suitable opponent found" }, 404);
    }

    challengedUserId = randomUser.user_id as string;
  }

  if (!challengedUserId) {
    return c.json({ error: "Opponent not specified" }, 400);
  }

  if (challengedUserId === user.id) {
    return c.json({ error: "Cannot challenge yourself" }, 400);
  }

  const [targetUser, skill] = await Promise.all([
    c.env.fitloot_db.prepare("SELECT user_id FROM user_profiles WHERE user_id = ?").bind(challengedUserId).first<{ user_id: string }>(),
    c.env.fitloot_db.prepare("SELECT id FROM skills WHERE id = ?").bind(data.skill_id).first<{ id: number }>(),
  ]);

  if (!targetUser) {
    return c.json({ error: "Opponent not found" }, 404);
  }

  if (!skill) {
    return c.json({ error: "Skill not found" }, 404);
  }

  const existingGame = await c.env.fitloot_db.prepare(
    `SELECT id FROM mini_games
      WHERE skill_id = ?
      AND status IN ('pending', 'active')
      AND ((challenger_user_id = ? AND challenged_user_id = ?) OR (challenger_user_id = ? AND challenged_user_id = ?))`
  ).bind(data.skill_id, user.id, challengedUserId, challengedUserId, user.id).first<{ id: number }>();

  if (existingGame?.id) {
    return c.json({ error: "Existing challenge in progress" }, 409);
  }

  // Calculate rewards based on difficulty
  const xpReward = data.target_reps * 5;
  const pointsReward = data.target_reps;
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  await c.env.fitloot_db.prepare(
    `INSERT INTO mini_games (challenger_user_id, challenged_user_id, skill_id, 
    target_reps, status, xp_reward, points_reward, deadline, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, datetime('now'))`
  ).bind(user.id, challengedUserId, data.skill_id, data.target_reps, xpReward, pointsReward, deadline).run();

  return c.json({ success: true }, 201);
});

app.get("/api/mini-games/active", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 120), 1), 250);

  const games = await c.env.fitloot_db.prepare(
    `SELECT mg.*, 
    s.name as skill_name,
    up1.username as challenger_username,
    up2.username as challenged_username
    FROM mini_games mg
    INNER JOIN skills s ON mg.skill_id = s.id
    INNER JOIN user_profiles up1 ON mg.challenger_user_id = up1.user_id
    INNER JOIN user_profiles up2 ON mg.challenged_user_id = up2.user_id
    WHERE (mg.challenger_user_id = ? OR mg.challenged_user_id = ?)
    ORDER BY 
      CASE mg.status 
        WHEN 'active' THEN 1 
        WHEN 'pending' THEN 2 
        ELSE 3 
      END,
      mg.created_at DESC
    LIMIT ?`
  ).bind(user.id, user.id, limit).all();

  return c.json(games.results);
});

app.post("/api/mini-games/:id/accept", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const gameId = Number(c.req.param("id"));
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return c.json({ error: "Invalid game id" }, 400);
  }

  const accepted = await c.env.fitloot_db.prepare(
    `UPDATE mini_games SET status = 'active', updated_at = datetime('now')
      WHERE id = ? AND challenged_user_id = ? AND status = 'pending'`
  ).bind(gameId, user.id).run();

  const changes = Number((accepted as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (changes === 0) {
    return c.json({ error: "Game not found" }, 404);
  }

  return c.json({ success: true });
});

app.post("/api/mini-games/:id/complete", authMiddleware, zValidator("json", MiniGameCompleteRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const gameId = Number(c.req.param("id"));
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return c.json({ error: "Invalid game id" }, 400);
  }

  const data = c.req.valid("json");

  const game = await c.env.fitloot_db.prepare(
    `SELECT id, challenger_user_id, challenged_user_id, target_reps, xp_reward, points_reward
      FROM mini_games
      WHERE id = ? AND status = 'active'`
  ).bind(gameId).first<{
    id: number;
    challenger_user_id: string;
    challenged_user_id: string;
    target_reps: number;
    xp_reward: number;
    points_reward: number;
  }>();

  if (!game) {
    return c.json({ error: "Game not found" }, 404);
  }

  const isParticipant = game.challenger_user_id === user.id || game.challenged_user_id === user.id;
  if (!isParticipant) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (Number(data.reps_completed) < Number(game.target_reps ?? 0)) {
    return c.json({ error: "Target reps not reached" }, 400);
  }

  const winnerUserId = user.id;
  const loserUserId = winnerUserId === game.challenger_user_id ? game.challenged_user_id : game.challenger_user_id;

  const completeUpdate = await c.env.fitloot_db.prepare(
    `UPDATE mini_games
      SET status = 'completed', winner_user_id = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'active'`
  ).bind(winnerUserId, gameId).run();

  const completeChanges = Number((completeUpdate as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (completeChanges === 0) {
    return c.json({ error: "Game already completed" }, 409);
  }

  const winnerXp = Number(game.xp_reward ?? 0);
  const winnerPoints = Number(game.points_reward ?? 0);
  const loserXp = Math.floor(winnerXp / 2);
  const loserPoints = Math.floor(winnerPoints / 2);

  await Promise.all([
    applyXpPointsAndResolveLevels(c.env.fitloot_db, winnerUserId, winnerXp, winnerPoints),
    applyXpPointsAndResolveLevels(c.env.fitloot_db, loserUserId, loserXp, loserPoints),
    registerMiniGameResult(c.env.fitloot_db, winnerUserId, true),
    registerMiniGameResult(c.env.fitloot_db, loserUserId, false),
    logUserEvent(c.env.fitloot_db, winnerUserId, "onMiniGameComplete", {
      gameId,
      won: true,
      reps_completed: data.reps_completed,
      time_seconds: data.time_seconds,
    }),
    logUserEvent(c.env.fitloot_db, loserUserId, "onMiniGameComplete", {
      gameId,
      won: false,
      reps_completed: data.reps_completed,
      time_seconds: data.time_seconds,
    }),
  ]);
  invalidateRankingCache();

  return c.json({
    success: true,
    winner: winnerUserId,
    xp_gained: winnerXp,
    points_gained: winnerPoints,
  });
});

type MissionPeriod = "daily" | "weekly" | "monthly";
type WeekdayPtBr = "segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado" | "domingo";
type MissionExerciseCategory =
  | "plank"
  | "isometric"
  | "walk"
  | "run"
  | "yoga"
  | "stretching"
  | "mobility"
  | "strength"
  | "abdominal"
  | "cardio_circuit"
  | "default";
type MissionExerciseType = "forca" | "cardio" | "flexibilidade" | "equilibrio";
type MissionBodyArea = "upper" | "lower" | "core" | "full_body";

type MissionPayload = {
  title: string;
  description: string;
  goal?: string | null;
  metric_type: MissionMetricType;
  metric_value: number;
  metric_unit: string;
  sets: number | null;
  rest_seconds: number | null;
  instructions: string[];
  exercise_instructions_en: string[];
  exercise_instructions_pt: string[];
  image_url: string | null;
  exercise_db_gif_url: string | null;
  exercise_db_image_url: string | null;
  muscle_groups: string[];
  exercise_secondary_muscles: string[];
  exercise_name: string | null;
  exercise_equipment: string | null;
  exercise_body_part: string | null;
  exercise_target: string | null;
  exercise_type: MissionExerciseType;
  body_area: MissionBodyArea;
  attributes_benefited: string[];
  xp_reward: number;
  points_reward: number;
  duration_estimate_minutes: number | null;
  exercise_category: MissionExerciseCategory;
  mission_origin: "regular" | "ai";
  is_ai_special?: number;
  circuit_tasks: CircuitTask[];
  safety_tips: string[];
  difficulty_level: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  target_reps: number | null;
  target_time: number | null;
};

type ExerciseRef = {
  name: string;
  muscle: string;
  equipment?: string | undefined;
  difficulty?: string | undefined;
  instructions?: string | undefined;
  image_url?: string | undefined;
  body_part?: string | undefined;
};

function resolveExerciseApiMuscleGroups(exercise: Pick<EnrichedExercise, "target" | "secondaryMuscles"> | null | undefined): string[] {
  return mergeUniqueStrings(
    [
      typeof exercise?.target === "string" ? exercise.target : "",
      ...(Array.isArray(exercise?.secondaryMuscles) ? exercise.secondaryMuscles : []),
    ],
    6,
  );
}

function resolveExerciseApiBodyArea(
  exercise: Pick<EnrichedExercise, "bodyPart" | "target"> | null | undefined,
  fallbackMuscle: string,
): MissionBodyArea {
  return inferBodyArea(exercise?.bodyPart || exercise?.target || fallbackMuscle);
}

type WeeklyPlanDay = {
  focus: string;
  muscles: string[];
  exercises: string[];
  intensity: string;
  rest_day: boolean;
};

type MissionPromptContext = {
  mainGoal: string;
  injuries: string;
  equipment: string;
  level: number;
  completionRate: number;
  capacitySummary: string;
  attributes: {
    strength: number;
    constitution: number;
    vitality: number;
    dexterity: number;
    focus: number;
  };
};

const WEEKDAY_ORDER: WeekdayPtBr[] = [
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo",
];

const MISSION_METRIC_RULES_PROMPT = [
  "TABELA OBRIGATORIA DE METRICAS POR EXERCICIO:",
  "- Flexao, agachamento, abdominal, burpee, barra => sets_reps ('3 series de 12 repeticoes')",
  "- Prancha, hollow body, wall sit, dead hang, l-sit => duration_seconds ('3 series de 30 segundos')",
  "- Corrida, ciclismo => distance_meters ('2 km')",
  "- Caminhada => steps ('8.000 passos')",
  "- Yoga, alongamento, mobilidade => duration_minutes ('15 minutos')",
  "- Circuito completo ou sessao longa => circuit_tasks e SEMPRE semanal (nunca diaria)",
].join("\n");

const METRIC_TYPE_MAP: Record<MissionExerciseCategory, MissionMetricType> = {
  plank: "duration_seconds",
  isometric: "duration_seconds",
  walk: "steps",
  run: "distance_meters",
  yoga: "duration_minutes",
  stretching: "duration_minutes",
  mobility: "duration_minutes",
  strength: "sets_reps",
  abdominal: "sets_reps",
  cardio_circuit: "circuit_tasks",
  default: "sets_reps",
};

function futureIsoForPeriod(period: MissionPeriod, reference = new Date()): string {
  const date = new Date(reference);

  if (period === "daily") {
    date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  if (period === "weekly") {
    const day = date.getUTCDay();
    const shift = day === 0 ? 1 : 8 - day;
    date.setUTCDate(date.getUTCDate() + shift);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  date.setUTCMonth(date.getUTCMonth() + 1, 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function normalizeExerciseCategory(name: string, muscle: string): MissionExerciseCategory {
  const text = `${name} ${muscle}`.toLowerCase();

  if (text.includes("plank") || text.includes("prancha")) return "plank";
  if (text.includes("hold") || text.includes("isometric") || text.includes("isometr")) return "isometric";
  if (text.includes("walk") || text.includes("caminha") || text.includes("step")) return "walk";
  if (text.includes("run") || text.includes("corrid") || text.includes("jog") || text.includes("sprint") || text.includes("cicl")) return "run";
  if (text.includes("yoga") || text.includes("pose")) return "yoga";
  if (text.includes("stretch") || text.includes("along")) return "stretching";
  if (text.includes("mobility") || text.includes("mobilidade")) return "mobility";
  if (text.includes("circuit") || text.includes("circuito") || text.includes("hiit")) return "cardio_circuit";
  if (text.includes("abdominal") || text.includes("crunch") || text.includes("situp") || text.includes("sit-up") || text.includes("sit up")) return "abdominal";
  if (text.includes("push") || text.includes("squat") || text.includes("lunge") || text.includes("pull") || text.includes("press")) return "strength";
  return "default";
}

function inferExerciseType(category: MissionExerciseCategory): MissionExerciseType {
  if (category === "run" || category === "walk" || category === "cardio_circuit") return "cardio";
  if (category === "yoga" || category === "stretching" || category === "mobility") return "flexibilidade";
  if (category === "plank" || category === "isometric") return "equilibrio";
  return "forca";
}

function inferBodyArea(muscle: string): MissionBodyArea {
  const value = muscle.toLowerCase();
  if (value.includes("core") || value.includes("abs")) return "core";
  if (value.includes("leg") || value.includes("glute") || value.includes("calf")) return "lower";
  if (value.includes("chest") || value.includes("back") || value.includes("shoulder") || value.includes("arm") || value.includes("triceps") || value.includes("biceps")) return "upper";
  return "full_body";
}

function inferAttributes(category: MissionExerciseCategory): string[] {
  if (category === "run" || category === "walk") return ["resistencia", "cardio", "consistencia"];
  if (category === "yoga" || category === "stretching" || category === "mobility") return ["mobilidade", "flexibilidade", "controle"];
  if (category === "plank" || category === "isometric") return ["estabilidade", "core", "foco"];
  if (category === "cardio_circuit") return ["resistencia", "agilidade", "cardio"];
  return ["forca", "resistencia", "potencia"];
}

function missionConfigByPeriod(period: MissionPeriod) {
  if (period === "weekly") {
    return {
      amount: MISSION_LIMITS.weekly,
      xp: 170,
      points: 50,
      titlePrefix: "Missao Semanal",
    };
  }

  if (period === "monthly") {
    return {
      amount: MISSION_LIMITS.monthly,
      xp: 420,
      points: 130,
      titlePrefix: "Missao Mensal",
    };
  }

  return {
    amount: MISSION_LIMITS.daily,
    xp: 65,
    points: 14,
    titlePrefix: "Missao Diaria",
  };
}

function metricValueByPeriod(metricType: MissionMetricType, period: MissionPeriod) {
  const table: Record<MissionMetricType, Record<MissionPeriod, number>> = {
    repetitions: { daily: 30, weekly: 180, monthly: 680 },
    duration_seconds: { daily: 90, weekly: 480, monthly: 1800 },
    sets_reps: { daily: 36, weekly: 220, monthly: 760 },
    steps: { daily: 8000, weekly: 45000, monthly: 180000 },
    distance_meters: { daily: 2000, weekly: 12000, monthly: 50000 },
    duration_minutes: { daily: 15, weekly: 45, monthly: 180 },
    circuit_tasks: { daily: 3, weekly: 4, monthly: 5 },
  };
  return table[metricType][period];
}

function conditioningVolumeFactor(conditioning: ConditioningLevel): number {
  if (conditioning === "sedentario") return 0.6;
  if (conditioning === "iniciante") return 0.82;
  if (conditioning === "avancado") return 1.15;
  return 1;
}

function conditionedMetricValue(
  metricType: MissionMetricType,
  period: MissionPeriod,
  conditioning: ConditioningLevel,
  volumeMultiplier: number,
): number {
  const base = metricValueByPeriod(metricType, period);
  const conditioned = base * conditioningVolumeFactor(conditioning) * volumeMultiplier;
  return Math.max(1, Math.round(conditioned));
}

function missionCycleStartIso(period: MissionPeriod, reference = new Date()): string {
  const date = new Date(reference);

  if (period === "daily") {
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  if (period === "weekly") {
    const day = date.getUTCDay();
    const shift = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - shift);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function currentWeekKey(reference = new Date()): string {
  return missionCycleStartIso("weekly", reference).split("T")[0] ?? "";
}

function buildPlanProfileHash(mainGoal: string, conditioning: ConditioningLevel, injuries: string, equipment: string): string {
  return [mainGoal, conditioning, injuries, equipment]
    .map((item) => item.trim().toLowerCase())
    .join("|");
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

function fallbackExercisesByFocus(focus: string, muscles: string[]): string[] {
  const normalized = focus.toLowerCase();
  if (normalized.includes("push")) {
    return ["Push-up", "Pike Push-up", "Triceps Dip", "Plank Reach", "Diamond Push-up"];
  }
  if (normalized.includes("pull")) {
    return ["Pull-up", "Dead Hang", "Bodyweight Row", "Superman Hold", "Reverse Snow Angel"];
  }
  if (normalized.includes("leg")) {
    return ["Air Squat", "Lunge", "Glute Bridge", "Wall Sit", "Calf Raise"];
  }
  if (normalized.includes("core")) {
    return ["Plank", "Hollow Body Hold", "Abdominal Crunch", "Mountain Climber", "Dead Bug"];
  }
  if (normalized.includes("rest") || normalized.includes("recover")) {
    return ["Mobility Flow", "Alongamento Dinamico", "Yoga Flow", "Caminhada Leve", "Respiracao Guiada"];
  }
  if (normalized.includes("yoga")) {
    return ["Yoga Flow", "Downward Dog", "Child Pose", "Warrior Sequence", "Mobility Flow"];
  }
  if (muscles.some((muscle) => muscle.toLowerCase().includes("core"))) {
    return ["Plank", "Abdominal Crunch", "Hollow Body Hold", "Dead Bug", "Bird Dog"];
  }
  return ["Push-up", "Air Squat", "Plank", "Lunge", "Burpee", "Caminhada Ativa"];
}

function normalizeWeeklyPlanDay(
  rawDay: unknown,
  fallbackFocus: string,
  fallbackMuscles: string[],
): WeeklyPlanDay {
  const source = typeof rawDay === "object" && rawDay !== null ? rawDay as Record<string, unknown> : {};
  const focus = typeof source.focus === "string" && source.focus.trim().length > 0 ? source.focus : fallbackFocus;
  const muscles = toStringArray(source.muscles);
  const exercises = toStringArray(source.exercises);
  const intensity = typeof source.intensity === "string" && source.intensity.trim().length > 0 ? source.intensity : "moderada";
  const restDay = Boolean(source.rest_day) || focus.toLowerCase().includes("rest");
  const normalizedMuscles = muscles.length > 0 ? muscles : fallbackMuscles;
  const normalizedExercises = exercises.length > 0 ? exercises : fallbackExercisesByFocus(focus, normalizedMuscles);

  return {
    focus,
    muscles: normalizedMuscles.slice(0, 5),
    exercises: normalizedExercises.slice(0, 10),
    intensity,
    rest_day: restDay,
  };
}

function completionRate(completedCount: number, failedCount: number): number {
  const total = completedCount + failedCount;
  if (total <= 0) return 0.7;
  return completedCount / total;
}

function normalizeVolumeMultiplier(previous: number, rate: number): number {
  let target = previous;
  if (rate >= 0.8) target = Math.min(1.6, previous + 0.1);
  else if (rate <= 0.45) target = Math.max(0.6, previous - 0.1);
  return Math.max(previous - 0.1, Math.min(previous + 0.1, Number(target.toFixed(2))));
}

function buildCapacitySummary(rows: Array<{ skill_name: string; best_reps: number; total_time: number }>): string {
  if (rows.length === 0) return "Sem historico suficiente";
  return rows
    .slice(0, 8)
    .map((row) => `${row.skill_name} (best reps ${row.best_reps}, tempo ${row.total_time}s)`)
    .join("; ");
}

function uniqueExercises(entries: Array<{ name: string; muscle: string }>): Array<{ name: string; muscle: string }> {
  const output: Array<{ name: string; muscle: string }> = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = normalizeMatchText(entry.name);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function inferSets(metricType: MissionMetricType, period: MissionPeriod): number | null {
  if (metricType === "duration_seconds") {
    if (period === "daily") return 3;
    if (period === "weekly") return 6;
    return 10;
  }
  if (metricType === "sets_reps") {
    if (period === "daily") return 3;
    if (period === "weekly") return 5;
    return 8;
  }
  return null;
}

function inferRestSeconds(metricType: MissionMetricType): number | null {
  if (metricType === "duration_seconds" || metricType === "sets_reps") return 60;
  return null;
}

function isMissionMetricType(value: unknown): value is MissionMetricType {
  return (
    value === "repetitions" ||
    value === "duration_seconds" ||
    value === "sets_reps" ||
    value === "steps" ||
    value === "distance_meters" ||
    value === "duration_minutes" ||
    value === "circuit_tasks"
  );
}

function estimateMissionDuration(metricType: MissionMetricType, metricValue: number): number {
  if (metricType === "duration_seconds") {
    return Math.max(3, Math.ceil(metricValue / 60));
  }

  if (metricType === "duration_minutes") {
    return Math.max(1, metricValue);
  }

  if (metricType === "circuit_tasks") {
    return 45;
  }

  return Math.max(8, Math.floor(metricValue / 4));
}

function applyMissionMetricContext(
  payload: MissionPayload,
  period: MissionPeriod,
  exerciseName: string,
  desiredMetricType: MissionMetricType,
  desiredMetricValue: number,
  options?: {
    conditioning?: ConditioningLevel | undefined;
    volumeMultiplier?: number | undefined;
  },
): MissionPayload {
  const normalizedMetricType = period !== "weekly" && desiredMetricType === "circuit_tasks"
    ? "sets_reps"
    : desiredMetricType;
  const baselineMetricValue = options?.conditioning
    ? conditionedMetricValue(
      normalizedMetricType,
      period,
      options.conditioning,
      options.volumeMultiplier ?? 1,
    )
    : metricValueByPeriod(normalizedMetricType, period);
  const minValue = Math.max(1, Math.round(baselineMetricValue * 0.4));
  const maxValue = Math.max(minValue, Math.round(baselineMetricValue * 1.8));
  const normalizedMetricValue = Math.min(maxValue, Math.max(minValue, Math.round(desiredMetricValue)));

  const sets = normalizedMetricType === "circuit_tasks" ? null : inferSets(normalizedMetricType, period);
  const restSeconds = normalizedMetricType === "circuit_tasks" ? null : inferRestSeconds(normalizedMetricType);
  const targetReps =
    normalizedMetricType === "duration_seconds" ||
      normalizedMetricType === "duration_minutes" ||
      normalizedMetricType === "circuit_tasks"
      ? null
      : normalizedMetricValue;
  const targetTime =
    normalizedMetricType === "duration_seconds"
      ? normalizedMetricValue
      : normalizedMetricType === "duration_minutes"
        ? normalizedMetricValue * 60
        : null;

  return {
    ...payload,
    metric_type: normalizedMetricType,
    metric_value: normalizedMetricValue,
    metric_unit: metricUnitByType(normalizedMetricType),
    sets,
    rest_seconds: restSeconds,
    description: normalizedMetricType === "circuit_tasks"
      ? payload.description
      : buildMissionDescriptionFromInstructions(
        wrapMissionInstructionsWithStretching(payload.instructions, exerciseName),
        buildMissionDescription(exerciseName, normalizedMetricType, normalizedMetricValue, sets),
      ),
    duration_estimate_minutes: shouldShowMissionDuration(period)
      ? estimateMissionDuration(normalizedMetricType, normalizedMetricValue)
      : null,
    circuit_tasks: normalizedMetricType === "circuit_tasks" ? buildCircuitTasks(exerciseName, period) : [],
    target_reps: targetReps,
    target_time: targetTime,
    exercise_category: normalizedMetricType === "circuit_tasks" ? "cardio_circuit" : payload.exercise_category,
  };
}

function buildCircuitTasks(exerciseName: string, period: MissionPeriod): CircuitTask[] {
  return buildCircuitTasksV2(exerciseName, period);
}

function buildMissionDescription(exerciseName: string, metricType: MissionMetricType, metricValue: number, sets: number | null): string {
  return buildMissionDescriptionV2(exerciseName, metricType, metricValue, sets);
}

function buildMissionInstructions(exerciseName: string, metricType: MissionMetricType, sets: number | null, restSeconds: number | null, apiInstruction?: string | undefined): string[] {
  return buildMissionInstructionsV2(exerciseName, metricType, sets, restSeconds, apiInstruction);
}

function normalizeMissionCopy(value: string): string {
  return repairKnownMojibakeString(localizeMissionText(value) ?? value)
    .replace(/\s+/g, " ")
    .trim();
}

function ensureSentence(value: string): string {
  const normalized = normalizeMissionCopy(value);
  if (normalized.length === 0) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function stripMissionTaskPrefix(value: string): string {
  return normalizeMissionCopy(value)
    .replace(/^Conclua\s+\d+\s+miss(?:\u00f5es|oes)\s+di[a\u00e1]rias\s+de\s+/i, "")
    .replace(/^Miss(?:\u00e3o|ao)\s+Di[a\u00e1]ria:\s+/i, "")
    .trim();
}

function missionStretchFocus(value: string): string {
  const target = inferMissionVisualTarget(value);
  if (target === "upper body") return "ombros, peito e costas";
  if (target === "legs") return "quadris, coxas e panturrilhas";
  if (target === "core") return "abd\u00f4men, lombar e quadris";
  if (target === "mobility") return "ombros, coluna, quadris e tornozelos";
  return "corpo inteiro";
}

function buildStretchingTip(exerciseName: string, phase: "before" | "after"): string {
  const focus = missionStretchFocus(exerciseName);
  if (phase === "before") {
    return ensureSentence(`Antes de come\u00e7ar, fa\u00e7a alongamento din\u00e2mico leve em ${focus} por 2 minutos para preparar o corpo`);
  }
  return ensureSentence(`Ao finalizar, alongue ${focus} novamente e respire fundo para evitar dores musculares intensas`);
}

function wrapMissionInstructionsWithStretching(instructions: readonly string[], exerciseName: string): string[] {
  const warmup = buildStretchingTip(exerciseName, "before");
  const cooldown = buildStretchingTip(exerciseName, "after");
  const middle = instructions
    .map((item) => ensureSentence(item))
    .filter((item) => item.length > 0)
    .filter((item) => {
      const normalized = normalizeMatchText(item);
      return normalized !== normalizeMatchText(warmup) && normalized !== normalizeMatchText(cooldown);
    });

  if (middle.length === 0) {
    middle.push(ensureSentence(`Execute ${exerciseName} com movimento controlado e respira\u00e7\u00e3o constante`));
  }

  return [warmup, ...middle.slice(0, 4), cooldown];
}

function formatMissionRequirement(requiredCount: number, title: string): string {
  const missionName = stripMissionTaskPrefix(title);
  const countLabel = `${requiredCount} miss${requiredCount === 1 ? "\u00e3o" : "\u00f5es"} di\u00e1rias`;
  return `${countLabel} de ${missionName}`;
}

function buildPeriodicMissionDescriptionV2(
  missionName: string,
  period: "weekly" | "monthly",
  requirements: ReadonlyArray<{ title: string; requiredCount: number }>,
): string {
  const periodLabel = period === "weekly" ? "nesta semana" : "ao longo deste m\u00eas";
  const requirementList = requirements
    .map((item) => formatMissionRequirement(item.requiredCount, item.title))
    .join(", ");
  const requirementSentence = ensureSentence(
    `Miss\u00f5es di\u00e1rias que comp\u00f5em ${normalizeMissionCopy(missionName)} ${periodLabel}: ${requirementList}`,
  );
  const progressSentence = ensureSentence(
    "O progresso atualiza automaticamente sempre que uma miss\u00e3o di\u00e1ria compat\u00edvel for conclu\u00edda",
  );
  return [
    buildStretchingTip(missionName, "before"),
    requirementSentence,
    progressSentence,
    buildStretchingTip(missionName, "after"),
  ].join(" ");
}

function buildMissionDescriptionFromInstructions(
  instructions: readonly string[],
  fallbackDescription: string,
): string {
  const normalized = instructions
    .map((item) => ensureSentence(item))
    .filter((item) => item.length > 0)
    .slice(0, 6);
  return normalized.length > 0 ? normalized.join(" ") : fallbackDescription;
}

function buildCircuitTasksV2(exerciseName: string, period: MissionPeriod): CircuitTask[] {
  const normalizedName = normalizeMatchText(exerciseName);
  const baseRequired = period === "weekly" ? 5 : period === "monthly" ? 7 : 3;
  const fullBodyRequired = period === "weekly" ? 3 : baseRequired;

  const toTask = (missionType: string, exerciseLabel: string, requiredCount = baseRequired): CircuitTask => ({
    id: crypto.randomUUID(),
    label: `Conclua ${requiredCount} miss\u00f5es di\u00e1rias de ${exerciseLabel}`,
    mission_type: missionType,
    required_count: requiredCount,
    current_count: 0,
    completed: false,
  });

  if (normalizedName.includes("upper body") || normalizedName.includes("parte superior")) {
    return [
      toTask("push-up", "flex\u00e3o"),
      toTask("abdominal", "abdominal"),
      toTask("plank", "prancha"),
    ];
  }

  if (normalizedName.includes("lower body") || normalizedName.includes("parte inferior")) {
    return [
      toTask("squat", "agachamento"),
      toTask("lunge", "avan\u00e7o"),
      toTask("glute bridge", "ponte de gl\u00fateos"),
    ];
  }

  if (normalizedName.includes("core")) {
    return [
      toTask("abdominal", "abdominal"),
      toTask("plank", "prancha"),
      toTask("hollow body", "hollow body"),
    ];
  }

  if (normalizedName.includes("mobility") || normalizedName.includes("recovery") || normalizedName.includes("mobilidade") || normalizedName.includes("recupera")) {
    return [
      toTask("stretching", "alongamento"),
      toTask("walk", "caminhada"),
      toTask("yoga", "yoga"),
    ];
  }

  return [
    toTask("push-up", "flex\u00e3o", fullBodyRequired),
    toTask("squat", "agachamento", fullBodyRequired),
    toTask("abdominal", "abdominal", fullBodyRequired),
    toTask("plank", "prancha", fullBodyRequired),
  ];
}

function buildMissionDescriptionV2(
  exerciseName: string,
  metricType: MissionMetricType,
  metricValue: number,
  sets: number | null,
  period: MissionPeriod = "daily",
): string {
  const goalText = formatMissionGoal(metricType, metricValue, sets ?? undefined);
  if (metricType === "circuit_tasks") {
    return buildPeriodicMissionDescriptionV2(
      exerciseName,
      period === "monthly" ? "monthly" : "weekly",
      buildCircuitTasksV2(exerciseName, period).map((task) => ({
        title: task.label,
        requiredCount: task.required_count,
      })),
    );
  }
  if (metricType === "duration_seconds" && sets) {
    const secondsPerSet = Math.max(10, Math.floor(metricValue / sets));
    return ensureSentence(`Fa\u00e7a ${sets} s\u00e9ries de ${exerciseName}, sustentando ${secondsPerSet} segundos por s\u00e9rie com alinhamento firme`);
  }
  if (metricType === "sets_reps" && sets) {
    const repsPerSet = Math.max(4, Math.floor(metricValue / sets));
    return ensureSentence(`Execute ${sets} s\u00e9ries de ${repsPerSet} repeti\u00e7\u00f5es de ${exerciseName} com amplitude segura e cad\u00eancia controlada`);
  }
  if (metricType === "steps") {
    return ensureSentence(`Some ${metricValue.toLocaleString("pt-BR")} passos no dia com caminhada ativa em ritmo confort\u00e1vel`);
  }
  if (metricType === "distance_meters") {
    const km = (metricValue / 1000).toFixed(metricValue >= 1000 ? 1 : 0);
    return ensureSentence(`Cubra ${km} km de corrida ou trote sem perder a postura e o ritmo`);
  }
  if (metricType === "duration_minutes") {
    return ensureSentence(`Treine ${exerciseName} por ${metricValue} minutos com movimentos controlados e respira\u00e7\u00e3o regular`);
  }
  return ensureSentence(`Cumpra a meta de ${goalText} em ${exerciseName} com foco total na t\u00e9cnica`);
}

function buildMissionInstructionsV2(
  exerciseName: string,
  metricType: MissionMetricType,
  sets: number | null,
  restSeconds: number | null,
  apiInstruction?: string | undefined,
): string[] {
  const instructions: string[] = [];

  if (metricType === "circuit_tasks") {
    return wrapMissionInstructionsWithStretching(
      [
        "Confira a lista de miss\u00f5es di\u00e1rias do circuito antes de iniciar a semana.",
        "Priorize as di\u00e1rias do mesmo grupo muscular para fazer o progresso subir mais r\u00e1pido.",
        "Acompanhe o contador de cada subtarefa e mantenha consist\u00eancia entre os dias de treino.",
        "As recompensas s\u00e3o liberadas automaticamente quando todas as subtarefas forem conclu\u00eddas.",
      ],
      exerciseName,
    );
  }

  if (apiInstruction) {
    instructions.push(apiInstruction.slice(0, 180));
  }

  instructions.push(`Ajuste a postura e organize o ritmo de execu\u00e7\u00e3o para ${exerciseName}.`);

  if (metricType === "duration_seconds" || metricType === "duration_minutes") {
    instructions.push("Mantenha a respira\u00e7\u00e3o constante durante toda a execu\u00e7\u00e3o.");
  }

  if (metricType === "sets_reps" || metricType === "repetitions") {
    instructions.push("Execute cada repeti\u00e7\u00e3o com amplitude segura, sem perder o controle.");
  }

  if (sets && restSeconds) {
    instructions.push(`Siga ${sets} s\u00e9ries com ${restSeconds} segundos de descanso entre elas.`);
  }

  instructions.push("Interrompa imediatamente se sentir dor aguda, tontura ou perda de estabilidade.");
  return wrapMissionInstructionsWithStretching(instructions, exerciseName).slice(0, 6);
}

function buildMissionPayload(params: {
  period: MissionPeriod;
  titlePrefix: string;
  exerciseName: string;
  muscle: string;
  imageUrl?: string | undefined;
  exerciseDbGifUrl?: string | undefined;
  exerciseDbImageUrl?: string | undefined;
  exerciseEquipment?: string | undefined;
  exerciseBodyPart?: string | undefined;
  exerciseTarget?: string | undefined;
  exerciseSecondaryMuscles?: string[] | undefined;
  exerciseInstructionsEn?: string[] | undefined;
  exerciseInstructionsPt?: string[] | undefined;
  videoUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  instruction?: string | undefined;
  safetyTips?: string[] | undefined;
  difficultyLevel?: string | undefined;
  missionOrigin?: "regular" | "ai" | undefined;
  xp: number;
  points: number;
  forceCategory?: MissionExerciseCategory | undefined;
}): MissionPayload {
  let category = params.forceCategory ?? normalizeExerciseCategory(params.exerciseName, params.muscle);
  let metricType = METRIC_TYPE_MAP[category] ?? getMissionMetricType(params.exerciseName);

  if (params.period !== "weekly" && metricType === "circuit_tasks") {
    metricType = "sets_reps";
    category = "strength";
  }

  const metricValue = metricValueByPeriod(metricType, params.period);
  const metricUnit = metricUnitByType(metricType);
  const sets = metricType === "circuit_tasks" ? null : inferSets(metricType, params.period);
  const restSeconds = metricType === "circuit_tasks" ? null : inferRestSeconds(metricType);
  const bodyArea = inferBodyArea(params.muscle);
  const exerciseType = inferExerciseType(category);
  const attributes = inferAttributes(category);
  const instructions = buildMissionInstructions(params.exerciseName, metricType, sets, restSeconds, params.instruction);
  const circuitTasks = metricType === "circuit_tasks" ? buildCircuitTasks(params.exerciseName, params.period) : [];

  const targetReps = metricType === "duration_seconds" || metricType === "duration_minutes" || metricType === "circuit_tasks" ? null : metricValue;
  const targetTime = metricType === "duration_seconds"
    ? metricValue
    : metricType === "duration_minutes"
      ? metricValue * 60
      : null;

  return {
    title: `${params.titlePrefix}: ${params.exerciseName}`,
    description: metricType === "circuit_tasks"
      ? ""
      : buildMissionDescriptionFromInstructions(
        instructions,
        buildMissionDescription(params.exerciseName, metricType, metricValue, sets),
      ),
    goal: null,
    metric_type: metricType,
    metric_value: metricValue,
    metric_unit: metricUnit,
    sets,
    rest_seconds: restSeconds,
    instructions,
    exercise_instructions_en: Array.isArray(params.exerciseInstructionsEn) ? params.exerciseInstructionsEn.slice(0, 8) : [],
    exercise_instructions_pt: Array.isArray(params.exerciseInstructionsPt) ? params.exerciseInstructionsPt.slice(0, 8) : [],
    image_url: params.imageUrl ?? null,
    exercise_db_gif_url: params.exerciseDbGifUrl ?? null,
    exercise_db_image_url: params.exerciseDbImageUrl ?? null,
    muscle_groups: [params.muscle],
    exercise_secondary_muscles: Array.isArray(params.exerciseSecondaryMuscles) ? params.exerciseSecondaryMuscles.slice(0, 8) : [],
    exercise_name: params.exerciseName,
    exercise_equipment: params.exerciseEquipment ?? null,
    exercise_body_part: params.exerciseBodyPart ?? null,
    exercise_target: params.exerciseTarget ?? null,
    exercise_type: exerciseType,
    body_area: bodyArea,
    attributes_benefited: attributes,
    xp_reward: params.xp,
    points_reward: params.points,
    duration_estimate_minutes: shouldShowMissionDuration(params.period)
      ? estimateMissionDuration(metricType, metricValue)
      : null,
    exercise_category: category,
    mission_origin: params.missionOrigin ?? "regular",
    is_ai_special: params.missionOrigin === "ai" ? 1 : 0,
    circuit_tasks: circuitTasks,
    safety_tips: Array.isArray(params.safetyTips) ? params.safetyTips : ["Mantenha postura segura e interrompa em caso de dor aguda."],
    difficulty_level: params.difficultyLevel ?? null,
    video_url: params.videoUrl ?? null,
    thumbnail_url: params.thumbnailUrl ?? null,
    target_reps: targetReps,
    target_time: targetTime,
  };
}

async function insertMission(
  db: D1Database,
  userId: string,
  period: MissionPeriod,
  deadline: string,
  mission: MissionPayload,
  skillId: number | null,
): Promise<number | null> {
  const [hasGoalColumn, hasAiSpecialColumn] = await Promise.all([
    hasTableColumn(db, "missions", "goal"),
    hasTableColumn(db, "missions", "is_ai_special"),
  ]);

  const columns = [
    "user_id",
    "type",
    "title",
    "description",
    "skill_id",
    "target_reps",
    "target_time",
    "xp_reward",
    "points_reward",
    "deadline",
    "metric_type",
    "metric_value",
    "metric_unit",
    "sets",
    "rest_seconds",
    "instructions_json",
    "exercise_instructions_en_json",
    "exercise_instructions_pt_json",
    "exercise_db_gif_url",
    "exercise_db_image_url",
    "exercise_name",
    "exercise_equipment",
    "exercise_body_part",
    "exercise_target",
    "exercise_secondary_muscles_json",
    "image_url",
    "muscle_groups_json",
    "exercise_type",
    "body_area",
    "attributes_benefited_json",
    "duration_estimate_minutes",
    "exercise_category",
    "mission_origin",
    "circuit_tasks_json",
    "safety_tips_json",
    "difficulty_level",
    "video_url",
    "thumbnail_url",
    "updated_at",
  ];
  const values: unknown[] = [
    userId,
    period,
    mission.title,
    mission.description,
    skillId,
    mission.target_reps,
    mission.target_time,
    mission.xp_reward,
    mission.points_reward,
    deadline,
    mission.metric_type,
    mission.metric_value,
    mission.metric_unit,
    mission.sets,
    mission.rest_seconds,
    JSON.stringify(mission.instructions),
    JSON.stringify(mission.exercise_instructions_en),
    JSON.stringify(mission.exercise_instructions_pt),
    mission.exercise_db_gif_url,
    mission.exercise_db_image_url,
    mission.exercise_name,
    mission.exercise_equipment,
    mission.exercise_body_part,
    mission.exercise_target,
    JSON.stringify(mission.exercise_secondary_muscles),
    mission.image_url,
    JSON.stringify(mission.muscle_groups),
    mission.exercise_type,
    mission.body_area,
    JSON.stringify(mission.attributes_benefited),
    mission.duration_estimate_minutes,
    mission.exercise_category,
    mission.mission_origin,
    JSON.stringify(mission.circuit_tasks),
    JSON.stringify(mission.safety_tips),
    mission.difficulty_level,
    mission.video_url,
    mission.thumbnail_url,
  ];
  const placeholders = columns.map(() => "?");

  if (hasGoalColumn) {
    columns.splice(columns.length - 1, 0, "goal");
    placeholders.splice(placeholders.length - 1, 0, "?");
    values.push(mission.goal ?? null);
  }

  if (hasAiSpecialColumn) {
    columns.splice(columns.length - 1, 0, "is_ai_special");
    placeholders.splice(placeholders.length - 1, 0, "?");
    values.push(Number(mission.is_ai_special ?? 0) === 1 ? 1 : 0);
  }

  placeholders[placeholders.length - 1] = "datetime('now')";

  const sql = `INSERT INTO missions (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
  const result = await db.prepare(sql).bind(...values).run();
  const insertedId = Number(result.meta.last_row_id ?? 0);
  return insertedId > 0 ? insertedId : null;
}

async function fetchExerciseDbExercises(env: Env, muscle: string, equipment: string): Promise<ExerciseRef[]> {
  const results = await searchExerciseDB(muscle, env);
  return results.slice(0, 8).map((item) => ({
    name: item.name,
    muscle: item.target ?? muscle,
    equipment: item.equipment ?? (equipment || "bodyweight"),
    difficulty: "intermediate",
    instructions: Array.isArray(item.instructions) ? String(item.instructions[0] ?? "") : "",
    image_url: normalizeMissionMediaUrl(item.gifUrl ?? item.imageUrl ?? item.thumbnailUrl ?? null) ?? undefined,
    body_part: item.bodyPart,
  }));
}

function pickLocalExercises(muscle: string): ExerciseRef[] {
  return localExercisePool.filter((ex) => ex.muscle.includes(muscle) || muscle === "full body" || muscle === "mobility");
}

async function resolveExercisesWithFallback(env: Env, muscle: string, equipment: string): Promise<{ source: string; exercises: ExerciseRef[] }> {
  try {
    const ex = await fetchExerciseDbExercises(env, muscle, equipment);
    if (ex.length > 0) return { source: "exercise_db", exercises: ex };
  } catch (error) {
    console.warn("[exercise-db]", error);
  }

  return { source: "local_pool", exercises: pickLocalExercises(muscle) };
}

function getWeekdayPtBr(now = new Date()) {
  return ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][now.getDay()];
}

function fallbackMissionsForPeriod(period: MissionPeriod, titlePrefix: string, xp: number, points: number): MissionPayload[] {
  if (period !== "daily") return [];

  return [
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Prancha Isometrica",
      muscle: "core",
      xp,
      points,
      forceCategory: "plank",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Caminhada Ativa",
      muscle: "legs",
      xp,
      points,
      forceCategory: "walk",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Agachamento Livre",
      muscle: "legs",
      xp,
      points,
      forceCategory: "strength",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Corrida Leve",
      muscle: "legs",
      xp,
      points,
      forceCategory: "run",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Alongamento Guiado",
      muscle: "mobility",
      xp,
      points,
      forceCategory: "stretching",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Abdominal Controlado",
      muscle: "core",
      xp,
      points,
      forceCategory: "strength",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Flexao de Braco",
      muscle: "chest",
      xp,
      points,
      forceCategory: "strength",
    }),
  ];
}

type ExerciseInstructionPayload = {
  instructions: string[];
  musclesAffected: string[];
  attributesBenefited: string[];
  safetyTips: string[];
  difficultyLevel: string;
  metricType: MissionMetricType;
  metricValue: number;
};

function ensureInstructionSteps(
  instructions: string[],
  exerciseName: string,
  metricType: MissionMetricType,
  sets: number | null,
  restSeconds: number | null,
): string[] {
  const compact = instructions
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const fallback = buildMissionInstructions(exerciseName, metricType, sets, restSeconds);
  const merged = [...compact];
  for (const step of fallback) {
    if (merged.length >= 6) break;
    if (!merged.includes(step)) merged.push(step);
  }
  return wrapMissionInstructionsWithStretching(merged.slice(0, 6), exerciseName);
}

function normalizeInstructionList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function mergeUniqueStrings(values: string[], limit: number): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
    if (merged.length >= limit) break;
  }
  return merged;
}

async function translateExerciseInstructionsToPt(
  instructionsEn: string[],
  exerciseName: string,
  env: Env,
): Promise<string[]> {
  const normalizedInstructions = normalizeInstructionList(instructionsEn, 8);
  if (normalizedInstructions.length === 0) return [];
  const apiKey = getHuggingFaceApiKey(env);
  if (!apiKey) return normalizedInstructions;

  const prompt = [
    "Traduza os passos de execucao para portugues brasileiro.",
    "Mantenha o mesmo numero de passos e nao adicione explicacoes extras.",
    `Exercicio: ${exerciseName}`,
    "Responda APENAS JSON valido no formato:",
    '{ "instructions_pt": ["passo 1", "passo 2"] }',
    "",
    `instructions_en: ${JSON.stringify(normalizedInstructions)}`,
  ].join("\n");

  try {
    const completion = await fetchJsonWithTimeout<{ choices?: Array<{ message?: { content?: string | undefined } }> }>(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b:groq",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
          response_format: { type: "json_object" },
        }),
      },
      timeoutMsByService.huggingface,
    );

    const rawContent = safeGet(completion.choices ?? [], 0)?.message?.content ?? "";
    const parsed = JSON.parse(rawContent) as { instructions_pt?: unknown };
    const translated = normalizeInstructionList(parsed.instructions_pt, 8);
    return translated.length > 0 ? translated : normalizedInstructions;
  } catch {
    return normalizedInstructions;
  }
}

async function getExerciseInstructionsFromAI(
  exerciseName: string,
  metricType: MissionMetricType,
  conditioningLevel: string,
  env: Env,
  period: MissionPeriod = "daily",
  promptContext?: MissionPromptContext | undefined,
): Promise<ExerciseInstructionPayload> {
  const fallbackSets = inferSets(metricType, period);
  const fallbackRestSeconds = inferRestSeconds(metricType);
  const fallback: ExerciseInstructionPayload = {
    instructions: ensureInstructionSteps(
      [
        `Prepare-se para executar ${exerciseName} com postura segura.`,
        "Mantenha ritmo constante e respiracao controlada durante toda a execucao.",
        "Respeite a tecnica e interrompa em caso de dor aguda.",
      ],
      exerciseName,
      metricType,
      fallbackSets,
      fallbackRestSeconds,
    ),
    musclesAffected: [],
    attributesBenefited: [],
    safetyTips: ["Mantenha alinhamento corporal e evite compensacoes."],
    difficultyLevel: "iniciante",
    metricType: metricType === "circuit_tasks" && period !== "weekly" ? "sets_reps" : metricType,
    metricValue: metricValueByPeriod(metricType === "circuit_tasks" && period !== "weekly" ? "sets_reps" : metricType, period),
  };

  const apiKey = getHuggingFaceApiKey(env);
  if (!apiKey) return fallback;

  const promptLines = [
    `Exercicio: ${exerciseName}`,
    `Nivel do usuario: ${conditioningLevel}`,
    `Tipo de metrica: ${metricType}`,
    `Periodo da missao: ${period}`,
  ];
  if (promptContext) {
    promptLines.push(
      `Objetivo principal: ${promptContext.mainGoal}`,
      `Lesoes/restricoes: ${promptContext.injuries || "nenhuma"}`,
      `Equipamentos disponiveis: ${promptContext.equipment || "nenhum"}`,
      `Nivel do personagem: ${promptContext.level}`,
      `Taxa de conclusao recente: ${(promptContext.completionRate * 100).toFixed(1)}%`,
      `Capacidade por exercicio base: ${promptContext.capacitySummary}`,
      `Atributos do personagem: forca ${promptContext.attributes.strength}, constituicao ${promptContext.attributes.constitution}, vitalidade ${promptContext.attributes.vitality}, destreza ${promptContext.attributes.dexterity}, foco ${promptContext.attributes.focus}`,
      "",
      MISSION_METRIC_RULES_PROMPT,
    );
  }

  const prompt = [
    ...promptLines,
    "",
    "Retorne 4 a 6 passos curtos em portugues brasileiro para a execucao do treino.",
    "O primeiro passo deve incluir aquecimento ou alongamento leve antes da execucao.",
    "O ultimo passo deve incluir alongamento final para evitar dores musculares intensas.",
    "Responda APENAS em JSON valido:",
    "{",
    '  "instructions": ["passo 1", "passo 2", "passo 3", "passo 4"],',
    '  "musclesAffected": ["musculo"],',
    '  "attributesBenefited": ["forca"],',
    '  "safetyTips": ["dica"],',
    '  "difficultyLevel": "iniciante|intermediario|avancado",',
    '  "metricType": "repetitions|duration_seconds|sets_reps|steps|distance_meters|duration_minutes|circuit_tasks",',
    '  "metricValue": 1',
    "}",
  ].join("\n");

  try {
    const completion = await fetchJsonWithTimeout<{ choices?: Array<{ message?: { content?: string | undefined } }> }>(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b:groq",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
          response_format: { type: "json_object" },
        }),
      },
      timeoutMsByService.huggingface
    );

    const rawContent = safeGet(completion.choices ?? [], 0)?.message?.content ?? "";
    const parsed = JSON.parse(rawContent) as Partial<ExerciseInstructionPayload>;
    const parsedMetricType = isMissionMetricType(parsed.metricType) ? parsed.metricType : fallback.metricType;
    const parsedMetricValue = toPositiveInt(parsed.metricValue, fallback.metricValue);
    const parsedSets = inferSets(parsedMetricType, period);
    const parsedRestSeconds = inferRestSeconds(parsedMetricType);
    return {
      instructions: ensureInstructionSteps(
        Array.isArray(parsed.instructions) && parsed.instructions.length > 0
          ? parsed.instructions.map((item) => String(item)).slice(0, 6)
          : fallback.instructions,
        exerciseName,
        parsedMetricType,
        parsedSets,
        parsedRestSeconds,
      ),
      musclesAffected: Array.isArray(parsed.musclesAffected)
        ? parsed.musclesAffected.map((item) => String(item)).slice(0, 6)
        : fallback.musclesAffected,
      attributesBenefited: Array.isArray(parsed.attributesBenefited)
        ? parsed.attributesBenefited.map((item) => String(item)).slice(0, 6)
        : fallback.attributesBenefited,
      safetyTips: Array.isArray(parsed.safetyTips) && parsed.safetyTips.length > 0
        ? parsed.safetyTips.map((item) => String(item)).slice(0, 4)
        : fallback.safetyTips,
      difficultyLevel: typeof parsed.difficultyLevel === "string" && parsed.difficultyLevel.length > 0
        ? parsed.difficultyLevel
        : fallback.difficultyLevel,
      metricType: parsedMetricType,
      metricValue: parsedMetricValue,
    };
  } catch {
    return fallback;
  }
}

async function mapWithConcurrency<TInput, TResult>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) return [];

  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results: TResult[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () => worker()),
  );

  return results;
}

async function createMissionsForPeriod(env: Env, db: D1Database, userId: string, period: MissionPeriod, requestedAmount?: number) {
  if (period !== "daily") {
    const boundedRequestedAmount = Math.max(1, Math.min(requestedAmount ?? MISSION_LIMITS[period], MISSION_LIMITS[period]));
    const activeCounts = await getActiveCycleMissionCounts(db, userId, "regular");
    if (activeCounts.daily === 0) {
      await createMissionsForPeriod(env, db, userId, "daily", MISSION_LIMITS.daily);
    }
    await ensureStructuredPeriodicMissionsFromExistingDailyBlueprints(env, db, userId, {
      weeklyTarget: period === "weekly" ? boundedRequestedAmount : 0,
      monthlyTarget: period === "monthly" ? boundedRequestedAmount : 0,
    });
    return;
  }

  const [
    profile,
    progression,
    attributes,
    history,
    capacityRows,
    planRow,
  ] = await Promise.all([
    db.prepare("SELECT main_goal, initial_conditioning, injuries, equipment, active_skill_focus FROM user_profiles WHERE user_id = ?")
      .bind(userId)
      .first<{
        main_goal: string | null;
        initial_conditioning: string | null;
        injuries: string | null;
        equipment: string | null;
        active_skill_focus: string | null;
      }>(),
    db.prepare("SELECT level FROM user_progression WHERE user_id = ?").bind(userId).first<{ level: number | null }>(),
    db.prepare("SELECT strength, constitution, vitality, dexterity, focus FROM user_attributes WHERE user_id = ?")
      .bind(userId)
      .first<{ strength: number | null; constitution: number | null; vitality: number | null; dexterity: number | null; focus: number | null }>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) as completed_count,
         COALESCE(SUM(CASE WHEN COALESCE(status,'pending') IN ('failed', 'expired') THEN 1 ELSE 0 END), 0) as failed_count
       FROM missions
       WHERE user_id = ?
         AND datetime(created_at) >= datetime('now', '-7 day')`
    ).bind(userId).first<{ completed_count: number; failed_count: number }>(),
    db.prepare(
      `SELECT s.name as skill_name, COALESCE(us.best_reps,0) as best_reps, COALESCE(us.total_time,0) as total_time
       FROM user_skills us
       INNER JOIN skills s ON s.id = us.skill_id
       WHERE us.user_id = ?
       ORDER BY COALESCE(us.best_reps,0) DESC, COALESCE(us.total_time,0) DESC`
    ).bind(userId).all<{ skill_name: string; best_reps: number; total_time: number }>(),
    db.prepare("SELECT weekly_plan_json, training_frequency FROM user_training_plans WHERE user_id = ?")
      .bind(userId)
      .first<{ weekly_plan_json: string | null; training_frequency: number | null }>(),
  ]);

  const mainGoal = typeof profile?.main_goal === "string" ? profile.main_goal.trim() : "";
  const conditioningSource = typeof profile?.initial_conditioning === "string" ? profile.initial_conditioning : "";
  if (!mainGoal || !conditioningSource) {
    console.warn(`[missions] dados obrigatorios ausentes para ${userId}`);
    return;
  }

  const conditioning = normalizeConditioning(conditioningSource);
  const injuries = typeof profile?.injuries === "string" ? profile.injuries : "";
  const equipment = typeof profile?.equipment === "string" ? profile.equipment : "";
  const completedCount = Number(history?.completed_count ?? 0);
  const failedCount = Number(history?.failed_count ?? 0);
  const currentRate = completionRate(completedCount, failedCount);
  const weekKey = currentWeekKey();
  const profileHash = buildPlanProfileHash(mainGoal, conditioning, injuries, equipment);

  const previousPlanRaw = typeof planRow?.weekly_plan_json === "string" && planRow.weekly_plan_json.trim().length > 0
    ? JSON.parse(planRow.weekly_plan_json) as Record<string, unknown>
    : null;
  const previousWeekKey = typeof previousPlanRaw?.week_key === "string" ? previousPlanRaw.week_key : "";
  const previousHash = typeof previousPlanRaw?.profile_hash === "string" ? previousPlanRaw.profile_hash : "";
  const previousVolumeMultiplier = typeof previousPlanRaw?.volume_multiplier === "number" ? previousPlanRaw.volume_multiplier : 1;
  const trainingFrequency = normalizeTrainingFrequencyInput(planRow?.training_frequency);
  const volumeMultiplier = normalizeVolumeMultiplier(previousVolumeMultiplier, currentRate);
  const mustRegeneratePlan = !previousPlanRaw || previousWeekKey !== weekKey || previousHash !== profileHash;

  const fallbackPlan = await buildInitialTrainingPlan(mainGoal, conditioning, equipment, injuries);
  const fallbackWeekly = typeof fallbackPlan.weekly === "object" && fallbackPlan.weekly !== null
    ? fallbackPlan.weekly as Record<string, unknown>
    : {};
  const normalizedWeeklyPlan = {} as Record<WeekdayPtBr, WeeklyPlanDay>;
  for (const day of WEEKDAY_ORDER) {
    const daySource = mustRegeneratePlan
      ? fallbackWeekly[day]
      : (typeof previousPlanRaw?.weekly === "object" && previousPlanRaw.weekly !== null
        ? (previousPlanRaw.weekly as Record<string, unknown>)[day]
        : fallbackWeekly[day]);
    normalizedWeeklyPlan[day] = normalizeWeeklyPlanDay(daySource, day, ["full body"]);
  }

  const weeklyPlanApiKey = getHuggingFaceApiKey(env);
  if (mustRegeneratePlan && weeklyPlanApiKey) {
    const capacitySummary = buildCapacitySummary(capacityRows.results);
    const aiPlanPrompt = [
      "Gere um plano semanal de treino e responda APENAS JSON valido com chave weekly e progression_expected.",
      "Cada dia da semana deve conter focus, muscles[], exercises[], intensity e rest_day.",
      `Objetivo: ${mainGoal}`,
      `Condicionamento: ${conditioning}`,
      `Lesoes/restricoes: ${injuries || "nenhuma"}`,
      `Equipamentos: ${equipment || "nenhum"}`,
      `Taxa de conclusao da semana anterior: ${(currentRate * 100).toFixed(1)}%`,
      `Capacidade atual por exercicio base: ${capacitySummary}`,
      `Ajuste de volume obrigatorio: ${Math.round(volumeMultiplier * 100)}% do baseline, variando no maximo 10%.`,
      MISSION_METRIC_RULES_PROMPT,
    ].join("\n");

    try {
      const completion = await fetchJsonWithTimeout<{ choices?: Array<{ message?: { content?: string | undefined } }> }>(
        "https://router.huggingface.co/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${weeklyPlanApiKey}`,
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b:groq",
            messages: [{ role: "user", content: aiPlanPrompt }],
            max_tokens: 1200,
            response_format: { type: "json_object" },
          }),
        },
        timeoutMsByService.huggingface,
      );
      const content = safeGet(completion.choices ?? [], 0)?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const parsedWeekly = typeof parsed.weekly === "object" && parsed.weekly !== null
        ? parsed.weekly as Record<string, unknown>
        : {};
      for (const day of WEEKDAY_ORDER) {
        normalizedWeeklyPlan[day] = normalizeWeeklyPlanDay(
          parsedWeekly[day],
          normalizedWeeklyPlan[day].focus,
          normalizedWeeklyPlan[day].muscles,
        );
      }
    } catch {
      // keep fallback plan
    }
  }

  const planToStore = {
    week_key: weekKey,
    profile_hash: profileHash,
    volume_multiplier: volumeMultiplier,
    progression_expected: "Progressao semanal ajustada em no maximo 10% conforme taxa de conclusao.",
    weekly: normalizedWeeklyPlan,
  };

  if (mustRegeneratePlan) {
    await upsertTrainingPlan(
      db,
      userId,
      planToStore as unknown as Record<string, unknown>,
      mainGoal,
      conditioning,
      equipment,
      injuries,
      trainingFrequency,
    );
  }

  const promptContext: MissionPromptContext = {
    mainGoal,
    injuries,
    equipment,
    level: Number(progression?.level ?? 1),
    completionRate: currentRate,
    capacitySummary: buildCapacitySummary(capacityRows.results),
    attributes: {
      strength: Number(attributes?.strength ?? 0),
      constitution: Number(attributes?.constitution ?? 0),
      vitality: Number(attributes?.vitality ?? 0),
      dexterity: Number(attributes?.dexterity ?? 0),
      focus: Number(attributes?.focus ?? 0),
    },
  };

  const config = missionConfigByPeriod(period);
  const targetAmount = Math.max(1, Math.min(requestedAmount ?? config.amount, MISSION_LIMITS[period]));
  const deadline = futureIsoForPeriod(period);

  const validateMission = (mission: MissionPayload): MissionPayload => {
    const exerciseName = extractExerciseName(mission.title);
    let metricType = mission.metric_type;
    const expected = getMissionMetricType(exerciseName);
    metricType = expected === "circuit_tasks" ? "sets_reps" : expected;
    const metricValue = conditionedMetricValue(metricType, "daily", conditioning, volumeMultiplier);
    let fixed = applyMissionMetricContext(
      mission,
      "daily",
      exerciseName,
      metricType,
      metricValue,
      { conditioning, volumeMultiplier },
    );
    fixed.instructions = ensureInstructionSteps(fixed.instructions, exerciseName, fixed.metric_type, fixed.sets, fixed.rest_seconds);
    fixed.description = fixed.metric_type === "circuit_tasks"
      ? buildPeriodicMissionDescriptionV2(
        exerciseName,
        "weekly",
        fixed.circuit_tasks.map((task) => ({
          title: task.label,
          requiredCount: task.required_count,
        })),
      )
      : buildMissionDescriptionFromInstructions(
        fixed.instructions,
        buildMissionDescription(exerciseName, fixed.metric_type, fixed.metric_value, fixed.sets),
      );
    if (classifyMission(fixed.title, fixed.duration_estimate_minutes ?? undefined) === "weekly") {
      fixed = applyMissionMetricContext(
        fixed,
        "daily",
        exerciseName,
        "sets_reps",
        conditionedMetricValue("sets_reps", "daily", conditioning, volumeMultiplier),
        { conditioning, volumeMultiplier },
      );
      fixed.duration_estimate_minutes = Math.min(25, fixed.duration_estimate_minutes ?? 25);
      fixed.description = buildMissionDescriptionFromInstructions(
        fixed.instructions,
        buildMissionDescription(exerciseName, fixed.metric_type, fixed.metric_value, fixed.sets),
      );
    }
    return fixed;
  };

  const buildFromExercise = async (
    exerciseName: string,
    muscle: string,
    forceCategory?: MissionExerciseCategory | undefined,
  ): Promise<MissionPayload> => {
    const initialMetricHintRaw = getMissionMetricType(exerciseName);
    const initialMetricHint = period === "daily" && initialMetricHintRaw === "circuit_tasks"
      ? "sets_reps"
      : initialMetricHintRaw;
    const shouldEnrichWithExerciseApi = period === "daily";

    const [enriched, precomputedAiContext] = await Promise.all([
      shouldEnrichWithExerciseApi
        ? enrichExercise(exerciseName, env).catch(() => null)
        : Promise.resolve(null),
      getExerciseInstructionsFromAI(
        exerciseName,
        initialMetricHint,
        conditioning,
        env,
        period,
        promptContext,
      ).catch(() => null),
    ]);

    const resolvedName = shouldEnrichWithExerciseApi
      ? (enriched?.name || exerciseName)
      : exerciseName;
    const metricHintRaw = getMissionMetricType(resolvedName);
    const metricHint = period === "daily" && metricHintRaw === "circuit_tasks" ? "sets_reps" : metricHintRaw;
    const canReuseAiContext =
      precomputedAiContext !== null &&
      normalizeMatchText(resolvedName) === normalizeMatchText(exerciseName) &&
      precomputedAiContext.metricType === metricHint;

    const apiInstructionsEn = normalizeInstructionList(enriched?.instructions, 8);
    const [aiContext, apiInstructionsPt] = await Promise.all([
      canReuseAiContext
        ? Promise.resolve(precomputedAiContext as ExerciseInstructionPayload)
        : getExerciseInstructionsFromAI(
          resolvedName,
          metricHint,
          conditioning,
          env,
          period,
          promptContext,
        ),
      translateExerciseInstructionsToPt(apiInstructionsEn, resolvedName, env),
    ]);

    const apiMuscles = mergeUniqueStrings(
      [
        enriched?.target || muscle,
        ...(Array.isArray(enriched?.secondaryMuscles) ? enriched.secondaryMuscles : []),
      ],
      8,
    );

    const missionMediaUrl = enriched?.gifUrl
      ?? enriched?.exerciseDbGifUrl
      ?? (enriched?.videoUrl ? (enriched.thumbnailUrl ?? null) : null)
      ?? enriched?.imageUrl
      ?? null;
    const baseMission = buildMissionPayload({
      period,
      titlePrefix: config.titlePrefix,
      exerciseName: resolvedName,
      muscle: shouldEnrichWithExerciseApi ? (enriched?.target || muscle) : muscle,
      imageUrl: missionMediaUrl ?? undefined,
      exerciseDbGifUrl: enriched?.exerciseDbGifUrl ?? undefined,
      exerciseDbImageUrl: enriched?.exerciseDbImageUrl ?? undefined,
      exerciseEquipment: enriched?.equipment || undefined,
      exerciseBodyPart: enriched?.bodyPart || undefined,
      exerciseTarget: enriched?.target || muscle,
      exerciseSecondaryMuscles: enriched?.secondaryMuscles ?? [],
      exerciseInstructionsEn: apiInstructionsEn,
      exerciseInstructionsPt: apiInstructionsPt,
      videoUrl: enriched?.videoUrl ?? undefined,
      thumbnailUrl: enriched?.thumbnailUrl ?? undefined,
      instruction: safeGet(apiInstructionsPt.length > 0 ? apiInstructionsPt : apiInstructionsEn, 0),
      safetyTips: aiContext.safetyTips,
      difficultyLevel: aiContext.difficultyLevel,
      xp: config.xp,
      points: config.points,
      forceCategory,
    });
    const metricType = period === "daily" && aiContext.metricType === "circuit_tasks" ? "sets_reps" : aiContext.metricType;
    const withMetric = applyMissionMetricContext(
      baseMission,
      period,
      resolvedName,
      metricType,
      aiContext.metricValue,
      { conditioning, volumeMultiplier },
    );

    const aiInstructionSource = normalizeInstructionList(aiContext.instructions, 6);
    let mergedInstructionSource = apiInstructionsPt.slice(0, 6);
    if (mergedInstructionSource.length < 4) {
      mergedInstructionSource = mergeUniqueStrings(
        [...mergedInstructionSource, ...aiInstructionSource],
        6,
      );
    }
    if (mergedInstructionSource.length === 0) {
      mergedInstructionSource = aiInstructionSource;
    }

    withMetric.instructions = ensureInstructionSteps(
      mergedInstructionSource.length > 0 ? mergedInstructionSource : withMetric.instructions,
      resolvedName,
      withMetric.metric_type,
      withMetric.sets,
      withMetric.rest_seconds,
    );
    withMetric.description = withMetric.metric_type === "circuit_tasks"
      ? ""
      : buildMissionDescriptionFromInstructions(
        withMetric.instructions,
        buildMissionDescription(resolvedName, withMetric.metric_type, withMetric.metric_value, withMetric.sets),
      );
    withMetric.exercise_instructions_en = apiInstructionsEn;
    withMetric.exercise_instructions_pt = apiInstructionsPt;
    withMetric.safety_tips = aiContext.safetyTips.length > 0 ? aiContext.safetyTips.slice(0, 4) : withMetric.safety_tips;
    withMetric.muscle_groups = apiMuscles;
    withMetric.exercise_secondary_muscles = mergeUniqueStrings(
      Array.isArray(enriched?.secondaryMuscles) ? enriched.secondaryMuscles : [],
      8,
    );
    withMetric.exercise_name = resolvedName;
    withMetric.exercise_equipment = enriched?.equipment ?? null;
    withMetric.exercise_body_part = enriched?.bodyPart ?? null;
    withMetric.exercise_target = enriched?.target ?? null;
    withMetric.body_area = resolveExerciseApiBodyArea(enriched, muscle);
    withMetric.exercise_db_gif_url = enriched?.exerciseDbGifUrl ?? withMetric.exercise_db_gif_url;
    withMetric.exercise_db_image_url = enriched?.exerciseDbImageUrl ?? withMetric.exercise_db_image_url;
    withMetric.attributes_benefited = aiContext.attributesBenefited.length > 0
      ? aiContext.attributesBenefited.slice(0, 6)
      : withMetric.attributes_benefited;
    withMetric.difficulty_level = aiContext.difficultyLevel;
    withMetric.image_url = missionMediaUrl;
    withMetric.video_url = enriched?.videoUrl ?? withMetric.video_url;
    withMetric.thumbnail_url = enriched?.thumbnailUrl ?? withMetric.thumbnail_url;
    if (withMetric.metric_type === "circuit_tasks") {
      withMetric.image_url = null;
      withMetric.exercise_db_gif_url = null;
      withMetric.exercise_db_image_url = null;
      withMetric.video_url = null;
      withMetric.thumbnail_url = null;
      withMetric.exercise_name = null;
      withMetric.exercise_equipment = null;
      withMetric.exercise_body_part = null;
      withMetric.exercise_target = null;
      withMetric.exercise_secondary_muscles = [];
      withMetric.muscle_groups = mergeUniqueStrings(withMetric.circuit_tasks.map((task) => task.label), 6);
    }
    return validateMission(withMetric);
  };

  const missionsToInsert: MissionPayload[] = [];
  const weekday = getWeekdayPtBr() as WeekdayPtBr;
  const dayPlan = normalizedWeeklyPlan[weekday] ?? normalizedWeeklyPlan.segunda;
  const primaryMuscle = safeGet(dayPlan.muscles, 0) ?? "full body";
  const sourceExercises = await resolveExercisesWithFallback(env, primaryMuscle, equipment || "bodyweight");
  const plannedCount = Math.max(1, Math.round(targetAmount * 0.7));
  const variationCount = Math.max(0, targetAmount - plannedCount);
  const plannedEntries = [
    ...dayPlan.exercises.map((name) => ({ name, muscle: primaryMuscle })),
    ...sourceExercises.exercises.map((exercise) => ({ name: exercise.name, muscle: exercise.muscle })),
  ];
  const plannedUnique = uniqueExercises(plannedEntries).slice(0, plannedCount);
  const variationEntries = uniqueExercises([
    ...capacityRows.results.map((row) => ({ name: row.skill_name, muscle: primaryMuscle })),
    ...localExercisePool.map((exercise) => ({ name: exercise.name, muscle: exercise.muscle })),
    ...sourceExercises.exercises.map((exercise) => ({ name: exercise.name, muscle: exercise.muscle })),
  ]).filter((entry) => !plannedUnique.some((planned) => normalizeMatchText(planned.name) === normalizeMatchText(entry.name)))
    .slice(0, variationCount);
  const selectedEntries = [...plannedUnique, ...variationEntries].slice(0, targetAmount);
  const built = await mapWithConcurrency(
    selectedEntries,
    2,
    async (entry) => buildFromExercise(entry.name, entry.muscle),
  );
  missionsToInsert.push(...built);

  const fallbackPool = fallbackMissionsForPeriod("daily", config.titlePrefix, config.xp, config.points);
  while (missionsToInsert.length < targetAmount) {
    const fallback = fallbackPool[missionsToInsert.length % fallbackPool.length];
    missionsToInsert.push(validateMission(fallback));
  }

  for (const mission of missionsToInsert.slice(0, targetAmount)) {
    await insertMission(db, userId, period, deadline, mission, null);
  }
}

type StructuredDailyMissionDraft = {
  name?: string | undefined;
  description?: string | undefined;
  exercise_type?: string | undefined;
  muscle_group?: string | undefined;
  metric_type?: string | undefined;
  sets?: number | undefined;
  reps_or_value?: number | undefined;
  unit?: string | undefined;
  difficulty?: string | undefined;
  xp_reward?: number | undefined;
  fitcoins_reward?: number | undefined;
  estimated_minutes?: number | undefined;
};

type StructuredPeriodicMissionDraft = {
  name?: string | undefined;
  description?: string | undefined;
  goal?: string | undefined;
  xp_reward?: number | undefined;
  fitcoins_reward?: number | undefined;
  subtasks?: string[] | undefined;
};

type StructuredMissionPlanDraft = {
  weekly_plan?: {
    daily_missions?: StructuredDailyMissionDraft[] | undefined;
    weekly_missions?: StructuredPeriodicMissionDraft[] | undefined;
    monthly_missions?: StructuredPeriodicMissionDraft[] | undefined;
  } | undefined;
};

type MissionHistorySummaryRow = {
  title: string | null;
  type: string | null;
  status: string | null;
  is_completed: number | null;
  metric_type: string | null;
  metric_value: number | null;
  created_at: string | null;
  completed_at: string | null;
};

type MissionGenerationProfileSnapshot = {
  userId: string;
  mainGoal: string;
  goals: string[];
  conditioning: ConditioningLevel;
  injuries: string;
  equipment: string;
  trainingFrequency: number;
  weekKey: string;
  profileHash: string;
  volumeMultiplier: number;
  weeklyPlan: Record<WeekdayPtBr, WeeklyPlanDay>;
  recentHistory: MissionHistorySummaryRow[];
  completionRate: number;
  level: number;
  attributes: {
    strength: number;
    constitution: number;
    vitality: number;
    dexterity: number;
    focus: number;
  };
  capacitySummary: string;
  initialCapacities: {
    pushups: number;
    situps: number;
    squats: number;
  };
};

type ResolvedMissionSubtask = {
  title: string;
  compatibilityKey: string;
  compatibilityTerms: string[];
  requiredCount: number;
};

type MissionBlueprint = {
  period: MissionPeriod;
  name: string;
  description: string;
  goal: string | null;
  exerciseName: string;
  muscle: string;
  metricType: MissionMetricType;
  metricValue: number;
  xpReward: number;
  pointsReward: number;
  difficultyLevel: string;
  missionOrigin: "regular" | "ai";
  isAiSpecial: boolean;
  compatibilityKey: string;
  compatibilityTerms: string[];
  subtasks: ResolvedMissionSubtask[];
};

type MonthlyCounterSource = "missions_completed" | "steps_equivalent" | "streak_days" | "weekly_circuits_completed";

function roundToNearest(value: number, step: number): number {
  if (step <= 1) return Math.round(value);
  return Math.round(value / step) * step;
}

function clampMonthlyTarget(value: number, min: number, max: number, step = 1): number {
  return Math.max(min, Math.min(max, roundToNearest(value, step)));
}

function normalizeGoalKeyword(value: string): string {
  return normalizeMatchText(value);
}

function monthlyMissionCompletionTarget(profile: MissionGenerationProfileSnapshot): number {
  const conditioningBonus = profile.conditioning === "avancado"
    ? 8
    : profile.conditioning === "intermediario"
      ? 4
      : 0;
  const estimated = profile.trainingFrequency * 6 + Math.round(profile.completionRate * 10) + conditioningBonus;
  return clampMonthlyTarget(estimated, 20, 45, 5);
}

function monthlyStepsEquivalentTarget(profile: MissionGenerationProfileSnapshot, boost = 0): number {
  const goal = normalizeGoalKeyword(profile.mainGoal);
  let estimated = 80_000 + Math.max(0, profile.trainingFrequency - 3) * 10_000 + boost;
  if (
    goal.includes("perda") ||
    goal.includes("emagrec") ||
    goal.includes("condicion") ||
    goal.includes("resist") ||
    goal.includes("corrid") ||
    goal.includes("caminha") ||
    goal.includes("cardio")
  ) {
    estimated += 20_000;
  }
  if (profile.conditioning === "intermediario") estimated += 10_000;
  if (profile.conditioning === "avancado") estimated += 20_000;
  return clampMonthlyTarget(estimated, 80_000, 180_000, 5_000);
}

function monthlyActiveDaysTarget(profile: MissionGenerationProfileSnapshot, boost = 0): number {
  const conditioningBonus = profile.conditioning === "avancado"
    ? 2
    : profile.conditioning === "intermediario"
      ? 1
      : 0;
  const estimated = profile.trainingFrequency * 4 + Math.round(profile.completionRate * 4) + conditioningBonus + boost;
  return clampMonthlyTarget(estimated, 12, 24);
}

function monthlyWeeklyCircuitTarget(profile: MissionGenerationProfileSnapshot): number {
  const estimated = Math.round(profile.trainingFrequency / 2) + 1;
  return clampMonthlyTarget(estimated, 2, 4);
}

function buildMonthlyCounterGoal(
  source: MonthlyCounterSource,
  metricValue: number,
): string {
  if (source === "steps_equivalent") {
    return `${formatIntegerPtBr(metricValue)} passos acumulados`;
  }
  if (source === "streak_days") {
    return `${formatIntegerPtBr(metricValue)} dias ativos no mês`;
  }
  if (source === "weekly_circuits_completed") {
    return `${formatIntegerPtBr(metricValue)} circuitos semanais concluídos`;
  }
  return `${formatIntegerPtBr(metricValue)} missões concluídas`;
}

function buildMonthlyCounterMissionBlueprints(
  profile: MissionGenerationProfileSnapshot,
  targetCount: number,
  options?: {
    missionOrigin?: "regular" | "ai" | undefined;
    isAiSpecial?: boolean | undefined;
  },
): MissionBlueprint[] {
  if (targetCount <= 0) return [];

  const missionTarget = monthlyMissionCompletionTarget(profile);
  const stepsTarget = monthlyStepsEquivalentTarget(profile);
  const activeDaysTarget = monthlyActiveDaysTarget(profile);
  const circuitsTarget = monthlyWeeklyCircuitTarget(profile);
  const mainGoal = normalizeGoalKeyword(profile.mainGoal);

  const goalBasedChallenge = mainGoal.includes("flex")
    || mainGoal.includes("mobil")
    || mainGoal.includes("along")
    || mainGoal.includes("yoga")
    ? {
      name: "Prática Ativa do Mês",
      source: "streak_days" as MonthlyCounterSource,
      metricType: "repetitions" as MissionMetricType,
      metricValue: monthlyActiveDaysTarget(profile, 2),
      muscle: "full body",
    }
    : mainGoal.includes("massa")
      || mainGoal.includes("forca")
      || mainGoal.includes("hipertrof")
      ? {
        name: "Volume Mensal de Treinos",
        source: "missions_completed" as MonthlyCounterSource,
        metricType: "repetitions" as MissionMetricType,
        metricValue: clampMonthlyTarget(missionTarget + 5, 25, 50, 5),
        muscle: "full body",
      }
      : {
        name: "Desafio Cardio do Mês",
        source: "steps_equivalent" as MonthlyCounterSource,
        metricType: "steps" as MissionMetricType,
        metricValue: monthlyStepsEquivalentTarget(profile, 20_000),
        muscle: "legs",
      };

  const definitions = [
    {
      name: "Consistência Mensal de Missões",
      source: "missions_completed" as MonthlyCounterSource,
      metricType: "repetitions" as MissionMetricType,
      metricValue: missionTarget,
      muscle: "full body",
    },
    {
      name: "Distância Mensal Acumulada",
      source: "steps_equivalent" as MonthlyCounterSource,
      metricType: "steps" as MissionMetricType,
      metricValue: stepsTarget,
      muscle: "legs",
    },
    {
      name: "Dias Ativos no Mês",
      source: "streak_days" as MonthlyCounterSource,
      metricType: "repetitions" as MissionMetricType,
      metricValue: activeDaysTarget,
      muscle: "full body",
    },
    {
      name: "Circuitos Semanais Concluídos",
      source: "weekly_circuits_completed" as MonthlyCounterSource,
      metricType: "repetitions" as MissionMetricType,
      metricValue: circuitsTarget,
      muscle: "full body",
    },
    goalBasedChallenge,
  ].slice(0, targetCount);

  return definitions.map((definition, index) => {
    const goal = buildMonthlyCounterGoal(definition.source, definition.metricValue);
    const xpReward = clampXpRewardByPeriod("monthly", 620 + index * 25);
    return {
      period: "monthly",
      name: definition.name,
      description: "",
      goal,
      exerciseName: definition.name,
      muscle: definition.muscle,
      metricType: definition.metricType,
      metricValue: definition.metricValue,
      xpReward,
      pointsReward: derivePointsRewardByPeriod("monthly", 140 + index * 8, xpReward),
      difficultyLevel: profile.conditioning,
      missionOrigin: options?.missionOrigin ?? "regular",
      isAiSpecial: options?.isAiSpecial ?? false,
      compatibilityKey: normalizeMatchText(definition.name),
      compatibilityTerms: [definition.name, goal],
      subtasks: [],
    } satisfies MissionBlueprint;
  });
}

type StructuredGenerationOptions = {
  isAiSpecial: boolean;
  dailyTarget: number;
  weeklyTarget: number;
  monthlyTarget: number;
};

type GeneratedMissionPlanResult = {
  missions: Array<MissionPayload & { type: MissionPeriod }>;
  used_ai: boolean;
  invalid_ratio: number;
  already_active: boolean;
};

const MISSION_GENERATION_AI_TIMEOUT_MS = 8_000;
const MISSION_GENERATION_MEDIA_CONCURRENCY = 3;

function parseGoalsJson(rawValue: unknown, fallbackGoal: string): string[] {
  const parsedGoals = parseJsonStringArray(rawValue);
  const normalizedGoals = parsedGoals
    .map((goal) => goal.trim())
    .filter((goal) => goal.length > 0);
  if (normalizedGoals.length > 0) {
    return Array.from(new Set(normalizedGoals));
  }
  return [fallbackGoal];
}

function normalizeDifficultyLabel(value: unknown, fallback: ConditioningLevel): string {
  const raw = typeof value === "string" ? normalizeMatchText(value) : "";
  if (raw.includes("avanc")) return "avancado";
  if (raw.includes("inter")) return "intermediario";
  if (raw.includes("sedent")) return "sedentario";
  if (raw.includes("inic")) return "iniciante";
  return fallback;
}

function clampXpRewardByPeriod(period: MissionPeriod, rawValue: unknown): number {
  const fallback = missionConfigByPeriod(period).xp;
  const numeric = toPositiveInt(rawValue, fallback);
  if (period === "monthly") return Math.min(1000, Math.max(500, numeric));
  if (period === "weekly") return Math.min(500, Math.max(200, numeric));
  return Math.min(200, Math.max(50, numeric));
}

function derivePointsRewardByPeriod(period: MissionPeriod, rawValue: unknown, xpReward: number): number {
  const fallback = missionConfigByPeriod(period).points;
  const numeric = toPositiveInt(rawValue, fallback);
  if (numeric > 0) return numeric;
  if (period === "monthly") return Math.max(80, Math.round(xpReward * 0.25));
  if (period === "weekly") return Math.max(40, Math.round(xpReward * 0.2));
  return Math.max(10, Math.round(xpReward * 0.15));
}

function isCircuitLikeText(value: string): boolean {
  const normalized = normalizeMatchText(value);
  return normalized.includes("circuit")
    || normalized.includes("circuito")
    || normalized.includes("hiit")
    || normalized.includes("sessao")
    || normalized.includes("session longa")
    || normalized.includes("sessao longa");
}

function structuredMetricTypeToMissionMetric(
  rawMetricType: unknown,
  exerciseName: string,
  exerciseType: string,
  muscleGroup: string,
  period: MissionPeriod,
): MissionMetricType {
  const normalizedRaw = typeof rawMetricType === "string" ? normalizeMatchText(rawMetricType) : "";
  const expected = getMissionMetricType(`${exerciseName} ${exerciseType} ${muscleGroup}`);

  let resolved: MissionMetricType;
  if (normalizedRaw === "seconds" || normalizedRaw === "segundos") resolved = "duration_seconds";
  else if (normalizedRaw === "distance" || normalizedRaw === "distancia") resolved = "distance_meters";
  else if (normalizedRaw === "steps" || normalizedRaw === "passos") resolved = "steps";
  else if (normalizedRaw === "minutes" || normalizedRaw === "minutos") resolved = "duration_minutes";
  else resolved = "sets_reps";

  if (expected === "circuit_tasks") {
    return period === "daily" ? "sets_reps" : "circuit_tasks";
  }

  return expected !== "sets_reps" || normalizedRaw.length === 0 ? expected : resolved;
}

function convertStructuredMetricValue(metricType: MissionMetricType, rawValue: unknown, rawUnit: unknown): number {
  const numeric = toPositiveInt(rawValue, metricValueByPeriod(metricType, metricType === "circuit_tasks" ? "weekly" : "daily"));
  const unit = typeof rawUnit === "string" ? normalizeMatchText(rawUnit) : "";

  if (metricType === "distance_meters") {
    if (unit.includes("km")) return Math.max(100, numeric * 1000);
    return numeric >= 100 ? numeric : numeric * 1000;
  }

  return numeric;
}

function buildMissionCompatibilityTerms(name: string, muscle: string, metricType: MissionMetricType): string[] {
  const exerciseName = extractExerciseName(name);
  const category = normalizeExerciseCategory(exerciseName, muscle);
  const localizedName = localizeMissionText(name);
  const localizedExerciseName = localizeMissionText(exerciseName);
  const localizedMuscle = localizeMissionText(muscle);
  const localizedCategory = localizeMissionText(category);
  return mergeUniqueStrings(
    [
      exerciseName,
      name,
      localizedExerciseName ?? "",
      localizedName ?? "",
      muscle,
      localizedMuscle ?? "",
      category,
      localizedCategory ?? "",
      metricType,
    ],
    12,
  );
}

const LEGACY_WEEKLY_CIRCUIT_NAMES = [
  "Full Body Calisthenics Circuit",
  "Upper Body Strength & Core",
  "Lower Body Power",
  "Core Control Circuit",
  "Mobility & Recovery Circuit",
] as const;

function summarizeRecentMissionHistory(history: MissionHistorySummaryRow[]): string {
  if (history.length === 0) return "Sem historico recente";
  return history
    .slice(0, 12)
    .map((entry) => {
      const title = entry.title ?? "Missao";
      const status = entry.status ?? (Number(entry.is_completed ?? 0) === 1 ? "completed" : "pending");
      const type = entry.type ?? "daily";
      return `${title} (${type}, ${status})`;
    })
    .join("; ");
}

function resolveInitialCapacities(
  profile: Record<string, unknown>,
  capacityRows: Array<{ skill_name: string; best_reps: number; total_time: number }>,
): { pushups: number; situps: number; squats: number } {
  const fromProfile = {
    pushups: Math.max(0, Number(profile.initial_pushups ?? 0)),
    situps: Math.max(0, Number(profile.initial_situps ?? 0)),
    squats: Math.max(0, Number(profile.initial_squats ?? 0)),
  };

  if (fromProfile.pushups > 0 || fromProfile.situps > 0 || fromProfile.squats > 0) {
    return fromProfile;
  }

  const findBest = (matcher: (skillName: string) => boolean, fallback: number) => {
    const matched = capacityRows.find((row) => matcher(normalizeMatchText(row.skill_name)));
    return matched ? Math.max(fallback, Number(matched.best_reps ?? 0)) : fallback;
  };

  return {
    pushups: findBest((value) => value.includes("push") || value.includes("flexao"), 10),
    situps: findBest((value) => value.includes("abdominal") || value.includes("sit"), 12),
    squats: findBest((value) => value.includes("squat") || value.includes("agach"), 15),
  };
}

async function loadMissionGenerationProfile(
  db: D1Database,
  userId: string,
): Promise<MissionGenerationProfileSnapshot | null> {
  const [profile, progression, attributes, historySummary, recentHistoryRows, capacityRows, planRow] = await Promise.all([
    db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(userId).first<Record<string, unknown>>(),
    db.prepare("SELECT level FROM user_progression WHERE user_id = ?").bind(userId).first<{ level: number | null }>(),
    db.prepare("SELECT strength, constitution, vitality, dexterity, focus FROM user_attributes WHERE user_id = ?")
      .bind(userId)
      .first<{ strength: number | null; constitution: number | null; vitality: number | null; dexterity: number | null; focus: number | null }>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) as completed_count,
         COALESCE(SUM(CASE WHEN COALESCE(status,'pending') IN ('failed', 'expired') THEN 1 ELSE 0 END), 0) as failed_count
       FROM missions
       WHERE user_id = ?
         AND datetime(created_at) >= datetime('now', '-7 day')`
    ).bind(userId).first<{ completed_count: number; failed_count: number }>(),
    db.prepare(
      `SELECT title, type, status, is_completed, metric_type, metric_value, created_at, completed_at
       FROM missions
       WHERE user_id = ?
         AND datetime(created_at) >= datetime('now', '-7 day')
       ORDER BY datetime(created_at) DESC
       LIMIT 20`
    ).bind(userId).all<MissionHistorySummaryRow>(),
    db.prepare(
      `SELECT s.name as skill_name, COALESCE(us.best_reps,0) as best_reps, COALESCE(us.total_time,0) as total_time
       FROM user_skills us
       INNER JOIN skills s ON s.id = us.skill_id
       WHERE us.user_id = ?
       ORDER BY COALESCE(us.best_reps,0) DESC, COALESCE(us.total_time,0) DESC`
    ).bind(userId).all<{ skill_name: string; best_reps: number; total_time: number }>(),
    db.prepare("SELECT weekly_plan_json, training_frequency FROM user_training_plans WHERE user_id = ?")
      .bind(userId)
      .first<{ weekly_plan_json: string | null; training_frequency: number | null }>(),
  ]);

  const mainGoal = typeof profile?.main_goal === "string" ? profile.main_goal.trim() : "";
  const conditioningSource = typeof profile?.initial_conditioning === "string" ? profile.initial_conditioning : "";
  if (!profile || !mainGoal || !conditioningSource) {
    return null;
  }

  const conditioning = normalizeConditioning(conditioningSource);
  const injuries = typeof profile.injuries === "string" ? profile.injuries : "";
  const equipment = typeof profile.equipment === "string" ? profile.equipment : "";
  const goals = parseGoalsJson(profile.goals_json, mainGoal);
  const completedCount = Number(historySummary?.completed_count ?? 0);
  const failedCount = Number(historySummary?.failed_count ?? 0);
  const completionRateValue = completionRate(completedCount, failedCount);
  const weekKey = currentWeekKey();
  const profileHash = buildPlanProfileHash(mainGoal, conditioning, injuries, equipment);
  const previousPlanRaw = typeof planRow?.weekly_plan_json === "string" && planRow.weekly_plan_json.trim().length > 0
    ? JSON.parse(planRow.weekly_plan_json) as Record<string, unknown>
    : null;
  const previousWeekKey = typeof previousPlanRaw?.week_key === "string" ? previousPlanRaw.week_key : "";
  const previousHash = typeof previousPlanRaw?.profile_hash === "string" ? previousPlanRaw.profile_hash : "";
  const previousVolumeMultiplier = typeof previousPlanRaw?.volume_multiplier === "number" ? previousPlanRaw.volume_multiplier : 1;
  const volumeMultiplier = normalizeVolumeMultiplier(previousVolumeMultiplier, completionRateValue);
  const fallbackPlan = await buildInitialTrainingPlan(mainGoal, conditioning, equipment, injuries);
  const fallbackWeekly = typeof fallbackPlan.weekly === "object" && fallbackPlan.weekly !== null
    ? fallbackPlan.weekly as Record<string, unknown>
    : {};
  const normalizedWeeklyPlan = {} as Record<WeekdayPtBr, WeeklyPlanDay>;
  for (const day of WEEKDAY_ORDER) {
    const daySource = previousPlanRaw && previousWeekKey === weekKey && previousHash === profileHash
      ? (typeof previousPlanRaw.weekly === "object" && previousPlanRaw.weekly !== null
        ? (previousPlanRaw.weekly as Record<string, unknown>)[day]
        : fallbackWeekly[day])
      : fallbackWeekly[day];
    normalizedWeeklyPlan[day] = normalizeWeeklyPlanDay(daySource, day, ["full body"]);
  }

  const capacityRowsArray = Array.isArray(capacityRows.results) ? capacityRows.results : [];

  return {
    userId,
    mainGoal,
    goals,
    conditioning,
    injuries,
    equipment,
    trainingFrequency: normalizeTrainingFrequencyInput(planRow?.training_frequency),
    weekKey,
    profileHash,
    volumeMultiplier,
    weeklyPlan: normalizedWeeklyPlan,
    recentHistory: Array.isArray(recentHistoryRows.results) ? recentHistoryRows.results : [],
    completionRate: completionRateValue,
    level: Number(progression?.level ?? 1),
    attributes: {
      strength: Number(attributes?.strength ?? 0),
      constitution: Number(attributes?.constitution ?? 0),
      vitality: Number(attributes?.vitality ?? 0),
      dexterity: Number(attributes?.dexterity ?? 0),
      focus: Number(attributes?.focus ?? 0),
    },
    capacitySummary: buildCapacitySummary(capacityRowsArray),
    initialCapacities: resolveInitialCapacities(profile, capacityRowsArray),
  };
}

function buildStructuredPlanPrompt(
  profile: MissionGenerationProfileSnapshot,
  options: StructuredGenerationOptions,
  retryReason?: string,
): string {
  const currentDay = profile.weeklyPlan[getWeekdayPtBr() as WeekdayPtBr] ?? profile.weeklyPlan.segunda;
  const specialRule = options.isAiSpecial
    ? "Gere apenas missoes especiais em daily_missions. weekly_missions e monthly_missions devem ser arrays vazios."
    : "Gere um plano completo com daily_missions, weekly_missions e monthly_missions respeitando os limites informados.";

  return [
    "Voce esta gerando um plano de missoes fitness para o app FitLoot.",
    "Responda APENAS JSON valido, sem markdown, sem comentarios e sem texto extra.",
    specialRule,
    `Limites: daily_missions=${options.dailyTarget}, weekly_missions=${options.weeklyTarget}, monthly_missions=${options.monthlyTarget}.`,
    "Sua funcao aqui e somente montar o plano adaptado ao usuario: escolha exercicios, volume, metas e recompensas. Alvo muscular, equipamento, instrucoes tecnicas detalhadas, GIFs e videos serao preenchidos pelas APIs de exercicio depois.",
    "Em daily_missions.name, use o nome canonico do exercicio em ingles, como aparece em catalogos de exercicios (ex.: Push-up, Air Squat, Plank, Crunch, Lunge, Glute Bridge, Walking, Running, Yoga Flow). Nao invente nomes criativos para o exercicio.",
    "Use SOMENTE metric_type: reps, seconds, distance, steps, minutes.",
    "Prancha nunca usa repeticoes.",
    "Circuito completo ou sessao longa nunca pode ser daily_mission.",
    "Weekly e monthly nao podem ter tempo estimado.",
    "Weekly devem ter goal e subtasks compostas por nomes de daily_missions compativeis.",
    "Monthly_missions podem vir vazias, porque as metas mensais regulares sao geradas pelo sistema com objetivos acumulados do mes.",
    "Em daily_missions.description, escreva 3 a 5 passos curtos de execucao em portugues brasileiro.",
    "O primeiro passo da description deve incluir alongamento ou aquecimento leve antes do treino.",
    "O ultimo passo da description deve incluir alongamento final para evitar dores musculares intensas.",
    "Para indicar quantidade em weekly_missions.subtasks, repita o nome da mesma daily_mission no array.",
    'Exemplo de circuito: "Forca de Membros Superiores e Core" => subtasks repetidas de "flexao", "abdominal" e "prancha" ate representar 5 missoes de cada.',
    "Weekly devem concentrar os detalhes em goal e subtasks. Nao liste as subtasks dentro de description.",
    `Objetivo principal: ${profile.mainGoal}`,
    `Objetivos adicionais: ${profile.goals.join(", ")}`,
    `Condicionamento: ${profile.conditioning}`,
    `Treinos por semana: ${profile.trainingFrequency}`,
    `Capacidade declarada: flexao ${profile.initialCapacities.pushups}, abdominal ${profile.initialCapacities.situps}, agachamento ${profile.initialCapacities.squats}`,
    `Resumo de capacidade/historico: ${profile.capacitySummary}`,
    `Lesoes/restricoes: ${profile.injuries || "nenhuma"}`,
    `Equipamentos disponiveis: ${profile.equipment || "nenhum"}`,
    `Taxa de conclusao dos ultimos 7 dias: ${(profile.completionRate * 100).toFixed(1)}%`,
    `Resumo das missoes recentes: ${summarizeRecentMissionHistory(profile.recentHistory)}`,
    `Dia atual do plano semanal: foco=${currentDay.focus}; musculos=${currentDay.muscles.join(", ")}; exercicios=${currentDay.exercises.join(", ")}`,
    `Ajuste obrigatorio de volume: ${Math.round(profile.volumeMultiplier * 100)}% do baseline, variando no maximo 10%.`,
    MISSION_METRIC_RULES_PROMPT,
    retryReason ? `ERROS A CORRIGIR: ${retryReason}` : "",
    '{ "weekly_plan": { "daily_missions": [], "weekly_missions": [], "monthly_missions": [] } }',
  ].filter((line) => line.length > 0).join("\n");
}

async function requestStructuredMissionPlanFromAI(
  env: Env,
  prompt: string,
): Promise<StructuredMissionPlanDraft> {
  const apiKey = getHuggingFaceApiKey(env);
  if (!apiKey) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "Hugging Face nao configurada.");
  }

  const completion = await fetchJsonWithTimeout<OpenAIChatCompletionResponse>(
    "https://router.huggingface.co/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b:groq",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2200,
        response_format: { type: "json_object" },
      }),
    },
    MISSION_GENERATION_AI_TIMEOUT_MS,
  );

  const content = safeGet(completion.choices ?? [], 0)?.message?.content ?? "{}";
  return JSON.parse(content) as StructuredMissionPlanDraft;
}

function buildFallbackStructuredPlan(
  profile: MissionGenerationProfileSnapshot,
  options: StructuredGenerationOptions,
): StructuredMissionPlanDraft {
  const weekday = getWeekdayPtBr() as WeekdayPtBr;
  const dayPlan = profile.weeklyPlan[weekday] ?? profile.weeklyPlan.segunda;
  const primaryMuscle = safeGet(dayPlan.muscles, 0) ?? "full body";
  const candidateEntries = uniqueExercises([
    ...dayPlan.exercises.map((name) => ({ name, muscle: primaryMuscle })),
    ...fallbackExercisesByFocus(dayPlan.focus, dayPlan.muscles).map((name) => ({ name, muscle: primaryMuscle })),
  ]);

  const dailyMissions = candidateEntries.slice(0, options.dailyTarget).map((entry, index) => {
    const metricType = getMissionMetricType(`${entry.name} ${entry.muscle}`);
    const resolvedMetricType = metricType === "circuit_tasks" ? "sets_reps" : metricType;
    const metricValue = conditionedMetricValue(resolvedMetricType, "daily", profile.conditioning, profile.volumeMultiplier);
    return {
      name: entry.name,
      description: buildMissionDescriptionFromInstructions(
        buildMissionInstructions(entry.name, resolvedMetricType, inferSets(resolvedMetricType, "daily"), inferRestSeconds(resolvedMetricType)),
        buildMissionDescription(entry.name, resolvedMetricType, metricValue, inferSets(resolvedMetricType, "daily")),
      ),
      exercise_type: inferExerciseType(normalizeExerciseCategory(entry.name, entry.muscle)),
      muscle_group: entry.muscle,
      metric_type:
        resolvedMetricType === "duration_seconds" ? "seconds"
          : resolvedMetricType === "distance_meters" ? "distance"
            : resolvedMetricType === "steps" ? "steps"
              : resolvedMetricType === "duration_minutes" ? "minutes"
                : "reps",
      sets: inferSets(resolvedMetricType, "daily") ?? undefined,
      reps_or_value: metricValue,
      unit: metricUnitByType(resolvedMetricType),
      difficulty: profile.conditioning,
      xp_reward: clampXpRewardByPeriod("daily", missionConfigByPeriod("daily").xp + index * 6),
      fitcoins_reward: derivePointsRewardByPeriod("daily", missionConfigByPeriod("daily").points + index * 2, missionConfigByPeriod("daily").xp),
      estimated_minutes: estimateMissionDuration(resolvedMetricType, metricValue),
    } satisfies StructuredDailyMissionDraft;
  });

  const weeklyMissions = LEGACY_WEEKLY_CIRCUIT_NAMES
    .slice(0, options.weeklyTarget)
    .map((missionName, index) => ({
      name: missionName,
      description: "",
      goal: `Conclua as miss\u00f5es di\u00e1rias compat\u00edveis do circuito ${missionName} nesta semana.`,
      xp_reward: clampXpRewardByPeriod("weekly", 260 + index * 15),
      fitcoins_reward: derivePointsRewardByPeriod("weekly", 55 + index * 3, 260 + index * 15),
      subtasks: [],
    }));

  return {
    weekly_plan: {
      daily_missions: dailyMissions,
      weekly_missions: options.isAiSpecial ? [] : weeklyMissions,
      monthly_missions: [],
    },
  };
}

function resolveDailyBlueprintForSubtask(
  rawSubtask: string,
  dailyBlueprints: readonly MissionBlueprint[],
): MissionBlueprint | null {
  const normalizedSubtask = normalizeMatchText(rawSubtask);
  for (const blueprint of dailyBlueprints) {
    if (normalizeMatchText(blueprint.name).includes(normalizedSubtask)) return blueprint;
    if (normalizedSubtask.includes(normalizeMatchText(blueprint.name))) return blueprint;
    if (blueprint.compatibilityTerms.some((term) => normalizeMatchText(term).includes(normalizedSubtask) || normalizedSubtask.includes(normalizeMatchText(term)))) {
      return blueprint;
    }
  }
  return null;
}

function buildLegacyCircuitSubtaskNames(missionName: string, period: MissionPeriod): string[] {
  if (period !== "weekly") return [];
  const circuitTasks = buildCircuitTasks(missionName, period);
  return circuitTasks.flatMap((task) =>
    Array.from({ length: Math.max(1, task.required_count) }, () => {
      const localizedLabel = localizeMissionText(task.label) ?? task.label;
      const compatibleDailyName = stripMissionTaskPrefix(localizedLabel);
      return compatibleDailyName.length > 0 ? compatibleDailyName : task.mission_type;
    }),
  );
}

function buildFallbackPeriodicSubtaskNames(
  period: MissionPeriod,
  index: number,
  dailyBlueprints: readonly MissionBlueprint[],
  profile: MissionGenerationProfileSnapshot,
  missionName?: string,
): string[] {
  if (typeof missionName === "string" && missionName.trim().length > 0) {
    const legacyCircuitSubtasks = buildLegacyCircuitSubtaskNames(missionName, period);
    if (legacyCircuitSubtasks.length > 0) {
      return legacyCircuitSubtasks;
    }
  }
  if (dailyBlueprints.length === 0) return ["Missao diaria"];
  if (period === "weekly") {
    return [dailyBlueprints[index % dailyBlueprints.length].name];
  }
  const repeatCount = Math.max(2, Math.min(4, profile.trainingFrequency));
  return Array.from({ length: repeatCount }, () => dailyBlueprints[index % dailyBlueprints.length].name);
}

function resolveMissionSubtasks(
  rawSubtasks: string[] | undefined,
  dailyBlueprints: readonly MissionBlueprint[],
  period: MissionPeriod,
  index: number,
  profile: MissionGenerationProfileSnapshot,
  missionName?: string,
): { subtasks: ResolvedMissionSubtask[]; invalidCount: number } {
  const requestedSubtasks = Array.isArray(rawSubtasks) && rawSubtasks.length > 0
    ? rawSubtasks
    : buildFallbackPeriodicSubtaskNames(period, index, dailyBlueprints, profile, missionName);

  const aggregated = new Map<string, ResolvedMissionSubtask>();
  let invalidCount = 0;

  for (const rawSubtask of requestedSubtasks) {
    const directMatch = resolveDailyBlueprintForSubtask(rawSubtask, dailyBlueprints);
    const match = directMatch;
    if (!match) {
      invalidCount += 1;
      continue;
    }
    if (!directMatch) {
      invalidCount += 1;
    }

    const existing = aggregated.get(match.compatibilityKey);
    if (existing) {
      existing.requiredCount += 1;
      continue;
    }

    aggregated.set(match.compatibilityKey, {
      title: match.name,
      compatibilityKey: match.compatibilityKey,
      compatibilityTerms: match.compatibilityTerms,
      requiredCount: 1,
    });
  }

  if (aggregated.size === 0) {
    const fallbackMatch = dailyBlueprints[index % Math.max(1, dailyBlueprints.length)] ?? null;
    if (fallbackMatch) {
      invalidCount += 1;
      aggregated.set(fallbackMatch.compatibilityKey, {
        title: fallbackMatch.name,
        compatibilityKey: fallbackMatch.compatibilityKey,
        compatibilityTerms: fallbackMatch.compatibilityTerms,
        requiredCount: period === "monthly" ? Math.max(2, Math.min(4, profile.trainingFrequency)) : 1,
      });
    }
  }

  return {
    subtasks: Array.from(aggregated.values()),
    invalidCount,
  };
}

function resolvePeriodicMissionBlueprints(params: {
  period: "weekly" | "monthly";
  targetCount: number;
  drafts: readonly StructuredPeriodicMissionDraft[];
  fallbackDrafts: readonly StructuredPeriodicMissionDraft[];
  dailyBlueprints: readonly MissionBlueprint[];
  profile: MissionGenerationProfileSnapshot;
  missionOrigin: "regular" | "ai";
  isAiSpecial: boolean;
}): { blueprints: MissionBlueprint[]; invalidCount: number; totalCount: number } {
  const blueprints: MissionBlueprint[] = [];
  let invalidCount = 0;
  let totalCount = 0;

  for (let index = 0; index < params.targetCount; index += 1) {
    totalCount += 1;
    const draft = params.drafts[index];
    const source = draft ?? params.fallbackDrafts[index % Math.max(1, params.fallbackDrafts.length)] ?? null;
    if (!source) continue;
    if (!draft) invalidCount += 1;

    const name = toSafeString(source.name, `${params.period === "weekly" ? "Missão Semanal" : "Missão Mensal"} ${index + 1}`);
    const subtaskResolution = resolveMissionSubtasks(
      source.subtasks,
      params.dailyBlueprints,
      params.period,
      index,
      params.profile,
      name,
    );
    invalidCount += subtaskResolution.invalidCount;
    if (subtaskResolution.subtasks.length === 0) {
      invalidCount += 1;
      continue;
    }

    const goalInput = typeof source.goal === "string" ? source.goal.trim() : "";
    if (goalInput.length === 0) {
      invalidCount += 1;
    }

    const description = "";

    const goal = buildMissionDisplayGoalFromTasks(
      subtaskResolution.subtasks.map((subtask) => subtask.title),
      params.period,
    ) ?? toSafeString(
      source.goal,
      params.period === "weekly"
        ? `Conclua as miss\u00f5es di\u00e1rias compat\u00edveis desta miss\u00e3o nesta semana.`
        : `Conclua as miss\u00f5es di\u00e1rias compat\u00edveis desta miss\u00e3o ao longo deste m\u00eas.`,
    );

    const rawXpReward = toPositiveInt(source.xp_reward, missionConfigByPeriod(params.period).xp);
    const xpReward = clampXpRewardByPeriod(params.period, source.xp_reward);
    if (xpReward !== rawXpReward) {
      invalidCount += 1;
    }

    blueprints.push({
      period: params.period,
      name,
      description,
      goal,
      exerciseName: name,
      muscle: "full body",
      metricType: "circuit_tasks",
      metricValue: Math.max(1, subtaskResolution.subtasks.reduce((total, subtask) => total + subtask.requiredCount, 0)),
      xpReward,
      pointsReward: derivePointsRewardByPeriod(params.period, source.fitcoins_reward, xpReward),
      difficultyLevel: params.profile.conditioning,
      missionOrigin: params.missionOrigin,
      isAiSpecial: params.isAiSpecial,
      compatibilityKey: normalizeMatchText(name),
      compatibilityTerms: [name, goal],
      subtasks: subtaskResolution.subtasks,
    });
  }

  return { blueprints, invalidCount, totalCount };
}

function metricValidationRange(
  metricType: MissionMetricType,
  period: MissionPeriod,
  profile: MissionGenerationProfileSnapshot,
): { min: number; max: number } {
  const baselineMetricValue = conditionedMetricValue(
    metricType,
    period,
    profile.conditioning,
    profile.volumeMultiplier,
  );
  const min = Math.max(1, Math.round(baselineMetricValue * 0.4));
  const max = Math.max(min, Math.round(baselineMetricValue * 1.8));
  return { min, max };
}

function validateStructuredMissionPlan(
  planDraft: StructuredMissionPlanDraft,
  profile: MissionGenerationProfileSnapshot,
  options: StructuredGenerationOptions,
): { blueprints: MissionBlueprint[]; invalidCount: number; totalCount: number } {
  const dailyDrafts = Array.isArray(planDraft.weekly_plan?.daily_missions) ? planDraft.weekly_plan?.daily_missions ?? [] : [];
  const weeklyDrafts = Array.isArray(planDraft.weekly_plan?.weekly_missions) ? planDraft.weekly_plan?.weekly_missions ?? [] : [];
  const blueprints: MissionBlueprint[] = [];
  let invalidCount = 0;
  let totalCount = 0;
  const promotedWeeklyDrafts: StructuredPeriodicMissionDraft[] = [];

  for (const draft of dailyDrafts.slice(0, options.dailyTarget + 3)) {
    totalCount += 1;
    const name = toSafeString(draft.name, `Missao Diaria ${blueprints.length + 1}`);
    const description = toSafeString(draft.description, `Complete a meta proposta em ${name}.`);
    const exerciseType = toSafeString(draft.exercise_type, name);
    const muscleGroup = toSafeString(draft.muscle_group, "full body");
    const expectedMetricType = getMissionMetricType(`${name} ${exerciseType} ${muscleGroup}`);
    if (expectedMetricType === "circuit_tasks" || isCircuitLikeText(name) || isCircuitLikeText(exerciseType)) {
      promotedWeeklyDrafts.push({
        name,
        description,
        goal: `Conclua o circuito ${name} nesta semana`,
        xp_reward: clampXpRewardByPeriod("weekly", draft.xp_reward),
        fitcoins_reward: derivePointsRewardByPeriod("weekly", draft.fitcoins_reward, clampXpRewardByPeriod("weekly", draft.xp_reward)),
        subtasks: [],
      });
      invalidCount += 1;
      continue;
    }

    const metricType = structuredMetricTypeToMissionMetric(draft.metric_type, name, exerciseType, muscleGroup, "daily");
    if (metricType !== expectedMetricType) {
      invalidCount += 1;
    }
    const metricValue = convertStructuredMetricValue(metricType, draft.reps_or_value, draft.unit);
    const metricRange = metricValidationRange(metricType, "daily", profile);
    if (metricValue < metricRange.min || metricValue > metricRange.max) {
      invalidCount += 1;
    }
    const rawXpReward = toPositiveInt(draft.xp_reward, missionConfigByPeriod("daily").xp);
    const xpReward = clampXpRewardByPeriod("daily", draft.xp_reward);
    if (xpReward !== rawXpReward) {
      invalidCount += 1;
    }
    const pointsReward = derivePointsRewardByPeriod("daily", draft.fitcoins_reward, xpReward);
    blueprints.push({
      period: "daily",
      name,
      description,
      goal: null,
      exerciseName: name,
      muscle: muscleGroup,
      metricType,
      metricValue,
      xpReward,
      pointsReward,
      difficultyLevel: normalizeDifficultyLabel(draft.difficulty, profile.conditioning),
      missionOrigin: options.isAiSpecial ? "ai" : "regular",
      isAiSpecial: options.isAiSpecial,
      compatibilityKey: normalizeMatchText(extractExerciseName(name)),
      compatibilityTerms: buildMissionCompatibilityTerms(name, muscleGroup, metricType),
      subtasks: [],
    });
  }

  const fallbackPlan = buildFallbackStructuredPlan(profile, options);
  const fallbackDailyDrafts = Array.isArray(fallbackPlan.weekly_plan?.daily_missions)
    ? fallbackPlan.weekly_plan?.daily_missions ?? []
    : [];
  while (blueprints.length < options.dailyTarget) {
    const fallbackDraft = fallbackDailyDrafts[blueprints.length % Math.max(1, fallbackDailyDrafts.length)];
    if (!fallbackDraft) break;
    totalCount += 1;
    invalidCount += 1;
    const name = toSafeString(fallbackDraft.name, `Missao Diaria ${blueprints.length + 1}`);
    const muscleGroup = toSafeString(fallbackDraft.muscle_group, "full body");
    const metricType = structuredMetricTypeToMissionMetric(fallbackDraft.metric_type, name, String(fallbackDraft.exercise_type ?? name), muscleGroup, "daily");
    blueprints.push({
      period: "daily",
      name,
      description: toSafeString(fallbackDraft.description, `Complete a meta proposta em ${name}.`),
      goal: null,
      exerciseName: name,
      muscle: muscleGroup,
      metricType,
      metricValue: convertStructuredMetricValue(metricType, fallbackDraft.reps_or_value, fallbackDraft.unit),
      xpReward: clampXpRewardByPeriod("daily", fallbackDraft.xp_reward),
      pointsReward: derivePointsRewardByPeriod("daily", fallbackDraft.fitcoins_reward, clampXpRewardByPeriod("daily", fallbackDraft.xp_reward)),
      difficultyLevel: normalizeDifficultyLabel(fallbackDraft.difficulty, profile.conditioning),
      missionOrigin: options.isAiSpecial ? "ai" : "regular",
      isAiSpecial: options.isAiSpecial,
      compatibilityKey: normalizeMatchText(extractExerciseName(name)),
      compatibilityTerms: buildMissionCompatibilityTerms(name, muscleGroup, metricType),
      subtasks: [],
    });
  }

  const dailyBlueprints = blueprints.filter((blueprint) => blueprint.period === "daily");
  if (options.isAiSpecial) {
    return {
      blueprints: dailyBlueprints.slice(0, options.dailyTarget),
      invalidCount,
      totalCount: Math.max(totalCount, options.dailyTarget),
    };
  }

  const weeklyResolution = resolvePeriodicMissionBlueprints({
    period: "weekly",
    targetCount: options.weeklyTarget,
    drafts: [...weeklyDrafts, ...promotedWeeklyDrafts],
    fallbackDrafts: fallbackPlan.weekly_plan?.weekly_missions ?? [],
    dailyBlueprints,
    profile,
    missionOrigin: "regular",
    isAiSpecial: false,
  });
  totalCount += weeklyResolution.totalCount;
  invalidCount += weeklyResolution.invalidCount;
  blueprints.push(...weeklyResolution.blueprints);

  if (options.monthlyTarget > 0) {
    totalCount += options.monthlyTarget;
    blueprints.push(
      ...buildMonthlyCounterMissionBlueprints(profile, options.monthlyTarget, {
        missionOrigin: "regular",
        isAiSpecial: false,
      }),
    );
  }

  return { blueprints, invalidCount, totalCount };
}

async function materializeMissionBlueprint(
  env: Env,
  profile: MissionGenerationProfileSnapshot,
  blueprint: MissionBlueprint,
): Promise<MissionPayload> {
  const config = missionConfigByPeriod(blueprint.period);
  const shouldEnrichWithExerciseApi = blueprint.period === "daily";
  const [enriched, aiContext] = await Promise.all([
    shouldEnrichWithExerciseApi
      ? enrichExercise(blueprint.exerciseName, env).catch(() => null)
      : Promise.resolve(null),
    getExerciseInstructionsFromAI(
      blueprint.exerciseName,
      blueprint.period === "daily" ? blueprint.metricType : "circuit_tasks",
      profile.conditioning,
      env,
      blueprint.period,
      {
        mainGoal: profile.mainGoal,
        injuries: profile.injuries,
        equipment: profile.equipment,
        level: profile.level,
        completionRate: profile.completionRate,
        capacitySummary: profile.capacitySummary,
        attributes: profile.attributes,
      },
    ).catch(() => null),
  ]);

  const apiInstructionsEn = normalizeInstructionList(enriched?.instructions, 8);
  const apiInstructionsPt = await translateExerciseInstructionsToPt(apiInstructionsEn, blueprint.exerciseName, env);
  const resolvedName = shouldEnrichWithExerciseApi
    ? (enriched?.name || blueprint.exerciseName)
    : blueprint.exerciseName;
  const baseMission = buildMissionPayload({
    period: blueprint.period,
    titlePrefix: config.titlePrefix,
    exerciseName: resolvedName,
    muscle: shouldEnrichWithExerciseApi ? (enriched?.target || blueprint.muscle) : blueprint.muscle,
    imageUrl: shouldEnrichWithExerciseApi ? (enriched?.imageUrl ?? undefined) : undefined,
    exerciseDbGifUrl: shouldEnrichWithExerciseApi ? (enriched?.exerciseDbGifUrl ?? undefined) : undefined,
    exerciseDbImageUrl: shouldEnrichWithExerciseApi ? (enriched?.exerciseDbImageUrl ?? undefined) : undefined,
    exerciseEquipment: shouldEnrichWithExerciseApi ? (enriched?.equipment || undefined) : undefined,
    exerciseBodyPart: shouldEnrichWithExerciseApi ? (enriched?.bodyPart || undefined) : undefined,
    exerciseTarget: shouldEnrichWithExerciseApi ? (enriched?.target || blueprint.muscle) : undefined,
    exerciseSecondaryMuscles: enriched?.secondaryMuscles ?? [],
    exerciseInstructionsEn: apiInstructionsEn,
    exerciseInstructionsPt: apiInstructionsPt,
    videoUrl: shouldEnrichWithExerciseApi ? (enriched?.videoUrl ?? undefined) : undefined,
    thumbnailUrl: shouldEnrichWithExerciseApi ? (enriched?.thumbnailUrl ?? undefined) : undefined,
    instruction: safeGet(apiInstructionsPt.length > 0 ? apiInstructionsPt : apiInstructionsEn, 0),
    safetyTips: aiContext?.safetyTips,
    difficultyLevel: blueprint.difficultyLevel,
    missionOrigin: blueprint.missionOrigin,
    xp: blueprint.xpReward,
    points: blueprint.pointsReward,
    forceCategory: blueprint.period === "daily" ? normalizeExerciseCategory(resolvedName, blueprint.muscle) : "cardio_circuit",
  });

  if (blueprint.period === "daily") {
    const withMetric = applyMissionMetricContext(
      baseMission,
      "daily",
      resolvedName,
      blueprint.metricType,
      blueprint.metricValue,
      { conditioning: profile.conditioning, volumeMultiplier: profile.volumeMultiplier },
    );
    withMetric.title = `${config.titlePrefix}: ${blueprint.name}`;
    withMetric.mission_origin = blueprint.missionOrigin;
    withMetric.is_ai_special = blueprint.isAiSpecial ? 1 : 0;
    withMetric.instructions = ensureInstructionSteps(
      apiInstructionsPt.length > 0 ? apiInstructionsPt : withMetric.instructions,
      resolvedName,
      withMetric.metric_type,
      withMetric.sets,
      withMetric.rest_seconds,
    );
    withMetric.description = buildMissionDescriptionFromInstructions(
      withMetric.instructions,
      toSafeString(
        blueprint.description,
        buildMissionDescription(resolvedName, withMetric.metric_type, withMetric.metric_value, withMetric.sets),
      ),
    );
    withMetric.exercise_instructions_en = apiInstructionsEn;
    withMetric.exercise_instructions_pt = apiInstructionsPt;
    withMetric.safety_tips = aiContext?.safetyTips?.length ? aiContext.safetyTips.slice(0, 4) : withMetric.safety_tips;
    withMetric.difficulty_level = blueprint.difficultyLevel;
    withMetric.exercise_name = enriched?.name ?? resolvedName;
    withMetric.exercise_equipment = enriched?.equipment ?? null;
    withMetric.exercise_body_part = enriched?.bodyPart ?? null;
    withMetric.exercise_target = enriched?.target ?? null;
    withMetric.exercise_secondary_muscles = mergeUniqueStrings(
      Array.isArray(enriched?.secondaryMuscles) ? enriched.secondaryMuscles : [],
      8,
    );
    withMetric.muscle_groups = resolveExerciseApiMuscleGroups(enriched);
    withMetric.body_area = resolveExerciseApiBodyArea(enriched, blueprint.muscle);
    return withMetric;
  }

  if (blueprint.period === "monthly" && blueprint.subtasks.length === 0 && blueprint.metricType !== "circuit_tasks") {
    const withMetric = applyMissionMetricContext(
      baseMission,
      "monthly",
      resolvedName,
      blueprint.metricType,
      blueprint.metricValue,
      { conditioning: profile.conditioning, volumeMultiplier: profile.volumeMultiplier },
    );
    withMetric.title = `${config.titlePrefix}: ${blueprint.name}`;
    withMetric.description = "";
    withMetric.goal = blueprint.goal;
    withMetric.mission_origin = blueprint.missionOrigin;
    withMetric.is_ai_special = blueprint.isAiSpecial ? 1 : 0;
    withMetric.instructions = [];
    withMetric.exercise_instructions_en = [];
    withMetric.exercise_instructions_pt = [];
    withMetric.safety_tips = [];
    withMetric.difficulty_level = blueprint.difficultyLevel;
    withMetric.image_url = null;
    withMetric.exercise_db_gif_url = null;
    withMetric.exercise_db_image_url = null;
    withMetric.video_url = null;
    withMetric.thumbnail_url = null;
    withMetric.exercise_name = null;
    withMetric.exercise_equipment = null;
    withMetric.exercise_body_part = null;
    withMetric.exercise_target = null;
    withMetric.exercise_secondary_muscles = [];
    withMetric.muscle_groups = [];
    withMetric.circuit_tasks = [];
    withMetric.duration_estimate_minutes = null;
    withMetric.sets = null;
    withMetric.rest_seconds = null;
    withMetric.target_time = null;
    withMetric.target_reps = blueprint.metricType === "steps" || blueprint.metricType === "distance_meters"
      ? null
      : Math.max(1, blueprint.metricValue);
    return withMetric;
  }

  const circuitTasks = blueprint.subtasks.map((subtask) => ({
    id: crypto.randomUUID(),
    label: subtask.title,
    mission_type: subtask.compatibilityKey,
    required_count: subtask.requiredCount,
    current_count: 0,
    completed: false,
  }));
  return {
    ...baseMission,
    title: `${config.titlePrefix}: ${blueprint.name}`,
    description: "",
    goal: blueprint.goal,
    metric_type: "circuit_tasks",
    metric_value: Math.max(1, blueprint.subtasks.reduce((total, subtask) => total + subtask.requiredCount, 0)),
    metric_unit: metricUnitByType("circuit_tasks"),
    sets: null,
    rest_seconds: null,
    duration_estimate_minutes: null,
    circuit_tasks: circuitTasks,
    target_reps: null,
    target_time: null,
    exercise_category: "cardio_circuit",
    mission_origin: blueprint.missionOrigin,
    is_ai_special: blueprint.isAiSpecial ? 1 : 0,
    instructions: ensureInstructionSteps(
      apiInstructionsPt.length > 0 ? apiInstructionsPt : baseMission.instructions,
      resolvedName,
      "circuit_tasks",
      null,
      null,
    ),
    exercise_instructions_en: apiInstructionsEn,
    exercise_instructions_pt: apiInstructionsPt,
    safety_tips: aiContext?.safetyTips?.length ? aiContext.safetyTips.slice(0, 4) : baseMission.safety_tips,
    difficulty_level: blueprint.difficultyLevel,
    image_url: null,
    exercise_db_gif_url: null,
    exercise_db_image_url: null,
    video_url: null,
    thumbnail_url: null,
    exercise_name: null,
    exercise_equipment: null,
    exercise_body_part: null,
    exercise_target: null,
    exercise_secondary_muscles: [],
    muscle_groups: mergeUniqueStrings(blueprint.subtasks.map((subtask) => subtask.title), 6),
  };
}

async function createMissionSubtasks(
  db: D1Database,
  parentMissionId: number,
  subtasks: readonly ResolvedMissionSubtask[],
): Promise<void> {
  if (subtasks.length === 0) return;

  await ensureMissionSubtaskSchema(db);
  for (const subtask of subtasks) {
    await db.prepare(
      `INSERT INTO mission_subtasks (
        parent_mission_id,
        mission_type,
        subtask_title,
        compatibility_key,
        compatibility_terms_json,
        required_count,
        current_count,
        is_completed,
        updated_at
      ) VALUES (?, 'daily', ?, ?, ?, ?, 0, 0, datetime('now'))`
    ).bind(
      parentMissionId,
      subtask.title,
      subtask.compatibilityKey,
      JSON.stringify(subtask.compatibilityTerms),
      Math.max(1, subtask.requiredCount),
    ).run();
  }
}

async function replaceMissionSubtasks(
  db: D1Database,
  parentMissionId: number,
  subtasks: readonly ResolvedMissionSubtask[],
): Promise<void> {
  await ensureMissionSubtaskSchema(db);
  await db.prepare(
    `DELETE FROM mission_subtasks
      WHERE parent_mission_id = ?`
  ).bind(parentMissionId).run();
  await createMissionSubtasks(db, parentMissionId, subtasks);
}

type MissionGenerationScope = "regular" | "ai_special";

async function getActiveCycleMissionCounts(
  db: D1Database,
  userId: string,
  scope: MissionGenerationScope,
): Promise<Record<MissionPeriod, number>> {
  const counts: Record<MissionPeriod, number> = {
    daily: 0,
    weekly: 0,
    monthly: 0,
  };
  const hasAiSpecialColumn = await hasTableColumn(db, "missions", "is_ai_special");
  const scopeSql = scope === "ai_special"
    ? (hasAiSpecialColumn
      ? "AND COALESCE(is_ai_special, 0) = 1"
      : "AND COALESCE(mission_origin, 'regular') = 'ai'")
    : (hasAiSpecialColumn
      ? "AND COALESCE(is_ai_special, 0) = 0 AND COALESCE(mission_origin, 'regular') = 'regular'"
      : "AND COALESCE(mission_origin, 'regular') = 'regular'");

  for (const period of ["daily", "weekly", "monthly"] as const) {
    const cycleStart = missionCycleStartIso(period);
    const row = await db.prepare(
      `SELECT COUNT(*) as count
       FROM missions
       WHERE user_id = ?
         AND type = ?
         ${scopeSql}
         AND is_completed = 0
         AND datetime(created_at) >= datetime(?)
         AND (deadline IS NULL OR deadline > datetime('now'))`
    ).bind(userId, period, cycleStart).first<{ count: number }>();
    counts[period] = Number(row?.count ?? 0);
  }

  return counts;
}

async function listCurrentCycleMissions(
  db: D1Database,
  userId: string,
  scope: MissionGenerationScope,
): Promise<Array<MissionPayload & { type: MissionPeriod }>> {
  const hasAiSpecialColumn = await hasTableColumn(db, "missions", "is_ai_special");
  const scopeSql = scope === "ai_special"
    ? (hasAiSpecialColumn
      ? "AND COALESCE(is_ai_special, 0) = 1"
      : "AND COALESCE(mission_origin, 'regular') = 'ai'")
    : (hasAiSpecialColumn
      ? "AND COALESCE(is_ai_special, 0) = 0 AND COALESCE(mission_origin, 'regular') = 'regular'"
      : "AND COALESCE(mission_origin, 'regular') = 'regular'");
  const rows = await db.prepare(
    `SELECT *
     FROM missions
     WHERE user_id = ?
       ${scopeSql}
       AND is_completed = 0
       AND (deadline IS NULL OR deadline > datetime('now'))
     ORDER BY CASE type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 ELSE 4 END, created_at DESC`
  ).bind(userId).all<Record<string, unknown>>();

  const hydrated = await hydrateMissionRowsWithSubtasks(db, Array.isArray(rows.results) ? rows.results : []);
  return hydrated
    .map((row) => normalizeMissionRow(row))
    .filter((mission) => {
      if (mission.type !== "daily" && mission.type !== "weekly" && mission.type !== "monthly") {
        return false;
      }
      const createdAt = Date.parse(String(mission.created_at ?? ""));
      const cycleStart = Date.parse(missionCycleStartIso(mission.type));
      return Number.isFinite(createdAt) ? createdAt >= cycleStart : true;
    })
    .map((mission) => missionSummaryFromNormalized(mission) as unknown as MissionPayload & { type: MissionPeriod });
}

type MaterializedMissionEntry = {
  blueprint: MissionBlueprint;
  mission: MissionPayload;
};

function buildDailyBlueprintFromMissionPayload(
  mission: MissionPayload & { type: MissionPeriod },
  profile: MissionGenerationProfileSnapshot,
): MissionBlueprint | null {
  if (mission.type !== "daily") return null;
  const exerciseName = typeof mission.exercise_name === "string" && mission.exercise_name.trim().length > 0
    ? mission.exercise_name.trim()
    : extractExerciseName(mission.title);
  const muscle = mission.exercise_target
    ?? mission.muscle_groups?.[0]
    ?? "full body";
  const metricType = mission.metric_type;
  if (
    metricType !== "repetitions" &&
    metricType !== "duration_seconds" &&
    metricType !== "sets_reps" &&
    metricType !== "steps" &&
    metricType !== "distance_meters" &&
    metricType !== "duration_minutes" &&
    metricType !== "circuit_tasks"
  ) {
    return null;
  }

  const missionName = exerciseName.trim().length > 0 ? exerciseName : extractExerciseName(mission.title);
  return {
    period: "daily",
    name: missionName,
    description: mission.description ?? `Complete a meta proposta em ${missionName}.`,
    goal: null,
    exerciseName: missionName,
    muscle,
    metricType,
    metricValue: Math.max(1, Number(mission.metric_value ?? mission.target_reps ?? mission.target_time ?? 1)),
    xpReward: Math.max(1, Number(mission.xp_reward ?? missionConfigByPeriod("daily").xp)),
    pointsReward: Math.max(1, Number(mission.points_reward ?? missionConfigByPeriod("daily").points)),
    difficultyLevel: normalizeDifficultyLabel(mission.difficulty_level, profile.conditioning),
    missionOrigin: "regular",
    isAiSpecial: false,
    compatibilityKey: normalizeMatchText(extractExerciseName(mission.title)),
    compatibilityTerms: mergeUniqueStrings(
      [
        ...buildMissionCompatibilityTerms(missionName, muscle, metricType),
        mission.title,
        ...(Array.isArray(mission.muscle_groups) ? mission.muscle_groups : []),
        ...(Array.isArray(mission.exercise_secondary_muscles) ? mission.exercise_secondary_muscles : []),
      ],
      12,
    ),
    subtasks: [],
  };
}

function buildPeriodicFallbackDraftsFromDailyBlueprints(
  profile: MissionGenerationProfileSnapshot,
  dailyBlueprints: readonly MissionBlueprint[],
  targets: { weekly: number; monthly: number },
): { weekly: StructuredPeriodicMissionDraft[]; monthly: StructuredPeriodicMissionDraft[] } {
  const monthlyRepeatCount = Math.max(2, Math.min(4, profile.trainingFrequency));
  const weekly = LEGACY_WEEKLY_CIRCUIT_NAMES
    .slice(0, targets.weekly)
    .map((missionName, index) => ({
      name: missionName,
      description: `O progresso desta miss\u00e3o semanal \u00e9 atualizado automaticamente ao concluir as miss\u00f5es di\u00e1rias compat\u00edveis do circuito ${missionName}.`,
      goal: `Conclua as miss\u00f5es di\u00e1rias compat\u00edveis do circuito ${missionName} nesta semana.`,
      xp_reward: clampXpRewardByPeriod("weekly", 260 + index * 15),
      fitcoins_reward: derivePointsRewardByPeriod("weekly", 55 + index * 3, 260 + index * 15),
      subtasks: [],
    }));
  const monthly = Array.from({ length: targets.monthly }, (_, index) => {
    const dailyBlueprint = dailyBlueprints[index % Math.max(1, dailyBlueprints.length)];
    const dailyMissionName = dailyBlueprint?.name ?? "Missão diária";
    return {
      name: `Meta Mensal: ${dailyMissionName}`,
      description: `Evolua esta miss\u00e3o mensal com repeti\u00e7\u00f5es da miss\u00e3o di\u00e1ria ${dailyMissionName} ao longo do m\u00eas.`,
      goal: `Conclua as miss\u00f5es di\u00e1rias compat\u00edveis de ${dailyMissionName} ao longo deste m\u00eas.`,
      xp_reward: clampXpRewardByPeriod("monthly", 620 + index * 25),
      fitcoins_reward: derivePointsRewardByPeriod("monthly", 140 + index * 8, 620 + index * 25),
      subtasks: Array.from({ length: monthlyRepeatCount }, () => dailyMissionName),
    } satisfies StructuredPeriodicMissionDraft;
  });

  return { weekly, monthly };
}

async function materializeMissionBlueprints(
  env: Env,
  profile: MissionGenerationProfileSnapshot,
  blueprints: readonly MissionBlueprint[],
): Promise<MaterializedMissionEntry[]> {
  return mapWithConcurrency(
    blueprints,
    MISSION_GENERATION_MEDIA_CONCURRENCY,
    async (blueprint) => ({
      blueprint,
      mission: await materializeMissionBlueprint(env, profile, blueprint),
    }),
  );
}

async function deleteMissionEntries(db: D1Database, missionIds: readonly number[]): Promise<void> {
  if (missionIds.length === 0) return;
  const placeholders = missionIds.map(() => "?").join(", ");
  await db.prepare(
    `DELETE FROM mission_subtasks
      WHERE parent_mission_id IN (${placeholders})`
  ).bind(...missionIds).run();
  await db.prepare(
    `DELETE FROM missions
      WHERE id IN (${placeholders})`
  ).bind(...missionIds).run();
}

async function persistMaterializedMissionEntries(
  db: D1Database,
  profile: MissionGenerationProfileSnapshot,
  materialized: readonly MaterializedMissionEntry[],
  options?: { replaceMissionIds?: readonly number[] | undefined },
): Promise<void> {
  const replaceMissionIds = options?.replaceMissionIds ?? [];

  await withTransaction(db, async () => {
    if (!materialized.some((entry) => entry.blueprint.isAiSpecial)) {
      await upsertTrainingPlan(
        db,
        profile.userId,
        {
          week_key: profile.weekKey,
          profile_hash: profile.profileHash,
          volume_multiplier: profile.volumeMultiplier,
          progression_expected: "Progressao semanal ajustada em no maximo 10% conforme taxa de conclusao.",
          weekly: profile.weeklyPlan,
        },
        profile.mainGoal,
        profile.conditioning,
        profile.equipment,
        profile.injuries,
        profile.trainingFrequency,
      );
    }

    await deleteMissionEntries(db, replaceMissionIds);

    for (const entry of materialized) {
      const insertedMissionId = await insertMission(
        db,
        profile.userId,
        entry.blueprint.period,
        futureIsoForPeriod(entry.blueprint.period),
        entry.mission,
        null,
      );
      if (insertedMissionId && entry.blueprint.subtasks.length > 0) {
        await createMissionSubtasks(db, insertedMissionId, entry.blueprint.subtasks);
      }
    }
  });
}

async function persistGeneratedMissionPlan(
  env: Env,
  db: D1Database,
  profile: MissionGenerationProfileSnapshot,
  blueprints: readonly MissionBlueprint[],
): Promise<Array<MissionPayload & { type: MissionPeriod }>> {
  const materialized = await materializeMissionBlueprints(env, profile, blueprints);
  await persistMaterializedMissionEntries(db, profile, materialized);

  invalidateMissionListCache(profile.userId);
  return materialized.map((entry) => ({ ...entry.mission, type: entry.blueprint.period }));
}

async function listCurrentCycleRegularDailyBlueprints(
  db: D1Database,
  userId: string,
  profile: MissionGenerationProfileSnapshot,
): Promise<MissionBlueprint[]> {
  const missions = await listCurrentCycleMissions(db, userId, "regular");
  return missions
    .map((mission) => buildDailyBlueprintFromMissionPayload(mission, profile))
    .filter((mission): mission is MissionBlueprint => mission !== null);
}

async function ensureStructuredPeriodicMissionsFromExistingDailyBlueprints(
  env: Env,
  db: D1Database,
  userId: string,
  params: {
    weeklyTarget: number;
    monthlyTarget: number;
    weeklyDrafts?: readonly StructuredPeriodicMissionDraft[] | undefined;
    monthlyDrafts?: readonly StructuredPeriodicMissionDraft[] | undefined;
    replaceMissionIds?: readonly number[] | undefined;
  },
): Promise<number> {
  if (params.weeklyTarget <= 0 && params.monthlyTarget <= 0) {
    return 0;
  }

  const profile = await loadMissionGenerationProfile(db, userId);
  if (!profile) return 0;

  const dailyBlueprints = await listCurrentCycleRegularDailyBlueprints(db, userId, profile);
  if (dailyBlueprints.length === 0) {
    return 0;
  }

  const fallbackDrafts = buildPeriodicFallbackDraftsFromDailyBlueprints(profile, dailyBlueprints, {
    weekly: params.weeklyTarget,
    monthly: params.monthlyTarget,
  });
  const weeklyResolution = resolvePeriodicMissionBlueprints({
    period: "weekly",
    targetCount: params.weeklyTarget,
    drafts: params.weeklyDrafts ?? [],
    fallbackDrafts: fallbackDrafts.weekly,
    dailyBlueprints,
    profile,
    missionOrigin: "regular",
    isAiSpecial: false,
  });
  const monthlyBlueprints = buildMonthlyCounterMissionBlueprints(profile, params.monthlyTarget, {
    missionOrigin: "regular",
    isAiSpecial: false,
  });
  const blueprints = [...weeklyResolution.blueprints, ...monthlyBlueprints];
  if (blueprints.length === 0) {
    return 0;
  }

  const materialized = await materializeMissionBlueprints(env, profile, blueprints);
  await persistMaterializedMissionEntries(db, profile, materialized, {
    replaceMissionIds: params.replaceMissionIds,
  });
  invalidateMissionListCache(profile.userId);
  return blueprints.length;
}

function isCurrentMonthlyCounterMissionRow(row: Record<string, unknown>): boolean {
  const title = normalizeMatchText(typeof row.title === "string" ? row.title : "");
  const goal = normalizeMatchText(typeof row.goal === "string" ? row.goal : "");
  const metricType = normalizeMissionMetricType(row.metric_type, row.target_time);
  const metricValue = Math.max(0, Number(row.metric_value ?? row.target_reps ?? row.target_time ?? 0));

  if (title.includes("consistencia mensal")) {
    return goal.includes("missoes concluidas") && metricValue >= 20 && metricValue <= 50;
  }
  if (title.includes("distancia mensal")) {
    return (goal.includes("passos acumulados") || metricType === "steps") && metricValue >= 80_000 && metricValue <= 180_000;
  }
  if (title.includes("dias ativos") || title.includes("streak mensal") || title.includes("pratica ativa")) {
    return goal.includes("dias ativos") && metricValue >= 12 && metricValue <= 24;
  }
  if (title.includes("circuitos semanais")) {
    return goal.includes("circuitos semanais") && metricValue >= 2 && metricValue <= 4;
  }
  if (title.includes("volume mensal") || title.includes("ritmo mensal")) {
    return goal.includes("missoes concluidas") && metricValue >= 20 && metricValue <= 50;
  }
  if (title.includes("desafio cardio")) {
    return goal.includes("passos acumulados") && metricValue >= 100_000 && metricValue <= 200_000;
  }

  return false;
}

async function repairLegacyPeriodicMissions(_env: Env, db: D1Database, userId: string): Promise<void> {
  const rows = await db.prepare(
    `SELECT id, type, title, description, goal, metric_type, metric_value, target_reps, target_time
      FROM missions
      WHERE user_id = ?
        AND type IN ('weekly', 'monthly')
        AND is_completed = 0
        AND COALESCE(mission_origin, 'regular') = 'regular'
        AND (deadline IS NULL OR deadline > datetime('now'))`
  ).bind(userId).all<Record<string, unknown>>();
  const periodicRows = Array.isArray(rows.results) ? rows.results : [];
  if (periodicRows.length === 0) return;

  const parentIds = periodicRows
    .map((row) => Number(row.id))
    .filter((missionId) => Number.isInteger(missionId) && missionId > 0);
  if (parentIds.length === 0) return;

  const subtasksByParentId = await loadMissionSubtasksByParentIds(db, parentIds);
  const weeklyRowsToRepair = periodicRows.filter((row) => {
    if (row.type !== "weekly") return false;
    const missionId = Number(row.id);
    const hasGoal = typeof row.goal === "string" && row.goal.trim().length > 0;
    return (subtasksByParentId.get(missionId)?.length ?? 0) === 0 || !hasGoal;
  });
  const monthlyRowsToRepair = periodicRows.filter((row) => {
    if (row.type !== "monthly") return false;
    return !isCurrentMonthlyCounterMissionRow(row);
  });

  if (weeklyRowsToRepair.length === 0 && monthlyRowsToRepair.length === 0) {
    return;
  }

  const profile = await loadMissionGenerationProfile(db, userId);
  if (!profile) return;

  const dailyBlueprints = await listCurrentCycleRegularDailyBlueprints(db, userId, profile);
  if (dailyBlueprints.length === 0) return;

  const fallbackDrafts = buildPeriodicFallbackDraftsFromDailyBlueprints(profile, dailyBlueprints, {
    weekly: weeklyRowsToRepair.length,
    monthly: monthlyRowsToRepair.length,
  });
  const weeklyDrafts = weeklyRowsToRepair.map((row) => ({
    name: stripMissionDisplayTitlePrefix(typeof row.title === "string" ? row.title : "Full Body Calisthenics Circuit"),
    description: typeof row.description === "string" && row.description.trim().length > 0
      ? row.description
      : "O progresso desta miss\u00e3o semanal \u00e9 atualizado automaticamente ao concluir as miss\u00f5es di\u00e1rias compat\u00edveis.",
    goal: typeof row.goal === "string" ? row.goal : undefined,
    subtasks: [],
  } satisfies StructuredPeriodicMissionDraft));
  const weeklyResolution = resolvePeriodicMissionBlueprints({
    period: "weekly",
    targetCount: weeklyRowsToRepair.length,
    drafts: weeklyDrafts,
    fallbackDrafts: fallbackDrafts.weekly,
    dailyBlueprints,
    profile,
    missionOrigin: "regular",
    isAiSpecial: false,
  });
  const monthlyBlueprints = buildMonthlyCounterMissionBlueprints(profile, monthlyRowsToRepair.length, {
    missionOrigin: "regular",
    isAiSpecial: false,
  });
  const hasProgressValueColumn = await hasTableColumn(db, "missions", "progress_value");
  const monthlyCounters = monthlyRowsToRepair.length > 0
    ? await getMonthlyCounters(db, userId)
    : null;
  const weeklyConfig = missionConfigByPeriod("weekly");
  const monthlyConfig = missionConfigByPeriod("monthly");

  await withTransaction(db, async () => {
    for (let index = 0; index < weeklyRowsToRepair.length; index += 1) {
      const row = weeklyRowsToRepair[index];
      const blueprint = weeklyResolution.blueprints[index];
      const missionId = Number(row?.id ?? 0);
      if (!row || !blueprint || !Number.isInteger(missionId) || missionId <= 0) {
        continue;
      }

      const title = `${weeklyConfig.titlePrefix}: ${stripMissionDisplayTitlePrefix(blueprint.name)}`;
      const circuitTasks = blueprint.subtasks.map((subtask) => ({
        id: crypto.randomUUID(),
        label: subtask.title,
        mission_type: subtask.compatibilityKey,
        required_count: Math.max(1, subtask.requiredCount),
        current_count: 0,
        completed: false,
      }));
      const muscleGroupsJson = JSON.stringify(mergeUniqueStrings(blueprint.subtasks.map((subtask) => subtask.title), 6));
      const metricValue = Math.max(1, blueprint.subtasks.reduce((total, subtask) => total + subtask.requiredCount, 0));
      const weeklySql = hasProgressValueColumn
        ? `UPDATE missions
             SET title = ?,
                 description = '',
                 goal = ?,
                 metric_type = 'circuit_tasks',
                 metric_value = ?,
                 metric_unit = ?,
                 target_reps = NULL,
                 target_time = NULL,
                 sets = NULL,
                 rest_seconds = NULL,
                 duration_estimate_minutes = NULL,
                 exercise_category = 'cardio_circuit',
                 exercise_type = 'cardio_circuit',
                 body_area = 'full_body',
                 mission_origin = 'regular',
                 circuit_tasks_json = ?,
                 safety_tips_json = '[]',
                 difficulty_level = ?,
                 progress_value = 0,
                 image_url = NULL,
                 exercise_db_gif_url = NULL,
                 exercise_db_image_url = NULL,
                 video_url = NULL,
                 thumbnail_url = NULL,
                 exercise_name = NULL,
                 exercise_equipment = NULL,
                 exercise_body_part = NULL,
                 exercise_target = NULL,
                 exercise_secondary_muscles_json = '[]',
                 muscle_groups_json = ?,
                 is_ai_special = 0,
                 updated_at = datetime('now')
           WHERE id = ?`
        : `UPDATE missions
             SET title = ?,
                 description = '',
                 goal = ?,
                 metric_type = 'circuit_tasks',
                 metric_value = ?,
                 metric_unit = ?,
                 target_reps = NULL,
                 target_time = NULL,
                 sets = NULL,
                 rest_seconds = NULL,
                 duration_estimate_minutes = NULL,
                 exercise_category = 'cardio_circuit',
                 exercise_type = 'cardio_circuit',
                 body_area = 'full_body',
                 mission_origin = 'regular',
                 circuit_tasks_json = ?,
                 safety_tips_json = '[]',
                 difficulty_level = ?,
                 image_url = NULL,
                 exercise_db_gif_url = NULL,
                 exercise_db_image_url = NULL,
                 video_url = NULL,
                 thumbnail_url = NULL,
                 exercise_name = NULL,
                 exercise_equipment = NULL,
                 exercise_body_part = NULL,
                 exercise_target = NULL,
                 exercise_secondary_muscles_json = '[]',
                 muscle_groups_json = ?,
                 is_ai_special = 0,
                 updated_at = datetime('now')
           WHERE id = ?`;
      await db.prepare(weeklySql).bind(
        title,
        blueprint.goal,
        metricValue,
        metricUnitByType("circuit_tasks"),
        JSON.stringify(circuitTasks),
        blueprint.difficultyLevel,
        muscleGroupsJson,
        missionId,
      ).run();
      await replaceMissionSubtasks(db, missionId, blueprint.subtasks);
    }

    for (let index = 0; index < monthlyRowsToRepair.length; index += 1) {
      const row = monthlyRowsToRepair[index];
      const blueprint = monthlyBlueprints[index];
      const missionId = Number(row?.id ?? 0);
      if (!row || !blueprint || !Number.isInteger(missionId) || missionId <= 0) {
        continue;
      }

      const title = `${monthlyConfig.titlePrefix}: ${stripMissionDisplayTitlePrefix(blueprint.name)}`;
      const targetReps =
        blueprint.metricType === "duration_seconds" || blueprint.metricType === "duration_minutes"
          ? null
          : blueprint.metricValue;
      const targetTime =
        blueprint.metricType === "duration_seconds" || blueprint.metricType === "duration_minutes"
          ? blueprint.metricValue
          : null;
      const progressValue = monthlyCounters
        ? monthlyMissionProgressValue(
          {
            title,
            metric_type: blueprint.metricType,
            metric_value: blueprint.metricValue,
            target_reps: targetReps,
            target_time: targetTime,
          },
          monthlyCounters,
        )
        : 0;
      const monthlySql = hasProgressValueColumn
        ? `UPDATE missions
             SET title = ?,
                 description = '',
                 goal = ?,
                 metric_type = ?,
                 metric_value = ?,
                 metric_unit = ?,
                 target_reps = ?,
                 target_time = ?,
                 sets = NULL,
                 rest_seconds = NULL,
                 duration_estimate_minutes = NULL,
                 exercise_category = 'monthly_counter',
                 exercise_type = 'meta_mensal',
                 body_area = 'full_body',
                 mission_origin = 'regular',
                 circuit_tasks_json = '[]',
                 safety_tips_json = '[]',
                 difficulty_level = ?,
                 progress_value = ?,
                 image_url = NULL,
                 exercise_db_gif_url = NULL,
                 exercise_db_image_url = NULL,
                 video_url = NULL,
                 thumbnail_url = NULL,
                 exercise_name = NULL,
                 exercise_equipment = NULL,
                 exercise_body_part = NULL,
                 exercise_target = NULL,
                 exercise_secondary_muscles_json = '[]',
                 muscle_groups_json = '[]',
                 is_ai_special = 0,
                 updated_at = datetime('now')
           WHERE id = ?`
        : `UPDATE missions
             SET title = ?,
                 description = '',
                 goal = ?,
                 metric_type = ?,
                 metric_value = ?,
                 metric_unit = ?,
                 target_reps = ?,
                 target_time = ?,
                 sets = NULL,
                 rest_seconds = NULL,
                 duration_estimate_minutes = NULL,
                 exercise_category = 'monthly_counter',
                 exercise_type = 'meta_mensal',
                 body_area = 'full_body',
                 mission_origin = 'regular',
                 circuit_tasks_json = '[]',
                 safety_tips_json = '[]',
                 difficulty_level = ?,
                 image_url = NULL,
                 exercise_db_gif_url = NULL,
                 exercise_db_image_url = NULL,
                 video_url = NULL,
                 thumbnail_url = NULL,
                 exercise_name = NULL,
                 exercise_equipment = NULL,
                 exercise_body_part = NULL,
                 exercise_target = NULL,
                 exercise_secondary_muscles_json = '[]',
                 muscle_groups_json = '[]',
                 is_ai_special = 0,
                 updated_at = datetime('now')
           WHERE id = ?`;
      await db.prepare(monthlySql).bind(
        title,
        blueprint.goal,
        blueprint.metricType,
        blueprint.metricValue,
        metricUnitByType(blueprint.metricType),
        targetReps,
        targetTime,
        blueprint.difficultyLevel,
        ...(hasProgressValueColumn ? [progressValue] : []),
        missionId,
      ).run();
      await db.prepare(
        `DELETE FROM mission_subtasks
          WHERE parent_mission_id = ?`
      ).bind(missionId).run();
    }
  });
}

async function generateStructuredMissionPlanForUser(
  env: Env,
  db: D1Database,
  userId: string,
  options: StructuredGenerationOptions,
): Promise<GeneratedMissionPlanResult> {
  const profile = await loadMissionGenerationProfile(db, userId);
  if (!profile) {
    throw new Error("MISSION_GENERATION_PROFILE_INCOMPLETE");
  }

  if (!options.isAiSpecial) {
    await repairLegacyPeriodicMissions(env, db, userId);
  }

  const activeCounts = await getActiveCycleMissionCounts(db, userId, options.isAiSpecial ? "ai_special" : "regular");
  const hasActiveMissions = options.isAiSpecial
    ? activeCounts.daily >= options.dailyTarget
    : activeCounts.daily > 0 || activeCounts.weekly > 0 || activeCounts.monthly > 0;
  if (hasActiveMissions) {
    return {
      missions: await listCurrentCycleMissions(db, userId, options.isAiSpecial ? "ai_special" : "regular"),
      used_ai: false,
      invalid_ratio: 0,
      already_active: true,
    };
  }

  const fallbackPlan = buildFallbackStructuredPlan(profile, options);
  const apiKey = getHuggingFaceApiKey(env);
  let validation = validateStructuredMissionPlan(fallbackPlan, profile, options);
  let usedAi = false;

  if (apiKey) {
    let retryReason = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const aiPlan = await requestStructuredMissionPlanFromAI(
          env,
          buildStructuredPlanPrompt(profile, options, retryReason || undefined),
        );
        const aiValidation = validateStructuredMissionPlan(aiPlan, profile, options);
        const invalidRatio = aiValidation.totalCount > 0
          ? aiValidation.invalidCount / aiValidation.totalCount
          : 0;
        if (invalidRatio > 0.3 && attempt === 0) {
          retryReason = `Mais de 30% das missoes vieram invalidas (${Math.round(invalidRatio * 100)}%). Corrija metricas, XP, subtasks e circuitos diarios.`;
          continue;
        }

        if (invalidRatio <= 0.3) {
          validation = aiValidation;
          usedAi = true;
        }
        break;
      } catch (error) {
        if (attempt === 0) {
          retryReason = `A resposta anterior falhou: ${getErrorMessage(error)}`;
          continue;
        }
      }
    }
  }

  const missions = await persistGeneratedMissionPlan(env, db, profile, validation.blueprints);
  return {
    missions,
    used_ai: usedAi,
    invalid_ratio: validation.totalCount > 0 ? validation.invalidCount / validation.totalCount : 0,
    already_active: false,
  };
}

async function ensurePeriodicMissions(env: Env, db: D1Database, userId: string) {
  const activeRegularCounts = await getActiveCycleMissionCounts(db, userId, "regular");
  const shouldGenerateWholePlan =
    activeRegularCounts.daily === 0 &&
    activeRegularCounts.weekly === 0 &&
    activeRegularCounts.monthly === 0;

  if (shouldGenerateWholePlan) {
    try {
      await generateStructuredMissionPlanForUser(env, db, userId, {
        isAiSpecial: false,
        dailyTarget: MISSION_LIMITS.daily,
        weeklyTarget: MISSION_LIMITS.weekly,
        monthlyTarget: MISSION_LIMITS.monthly,
      });
      return;
    } catch (error) {
      console.error("[missions][structured-generate-fallback]", {
        userId,
        message: getErrorMessage(error),
      });
    }
  }

  const periods: MissionPeriod[] = ["daily", "weekly", "monthly"];
  const missingPeriodicTargets = {
    weekly: 0,
    monthly: 0,
  };

  for (const period of periods) {
    const cycleStart = missionCycleStartIso(period);
    await db.prepare(
      `UPDATE missions
         SET status = 'failed', updated_at = datetime('now')
       WHERE user_id = ?
         AND type = ?
         AND is_completed = 0
         AND COALESCE(mission_origin, 'regular') = 'regular'
         AND COALESCE(status, 'pending') = 'pending'
         AND datetime(created_at) < datetime(?)`
    ).bind(userId, period, cycleStart).run();

    const generatedInCycle = await db.prepare(
      `SELECT COUNT(*) as count
       FROM missions
       WHERE user_id = ?
         AND type = ?
         AND COALESCE(mission_origin, 'regular') = 'regular'
         AND datetime(created_at) >= datetime(?)`
    ).bind(userId, period, cycleStart).first<{ count: number }>();

    const existingCount = Number(generatedInCycle?.count ?? 0);
    const missingCount = Math.max(0, MISSION_LIMITS[period] - existingCount);
    if (missingCount > 0) {
      if (period === "daily") {
        await createMissionsForPeriod(env, db, userId, period, missingCount);
      } else {
        missingPeriodicTargets[period] = missingCount;
      }
    }
  }

  if (missingPeriodicTargets.weekly > 0 || missingPeriodicTargets.monthly > 0) {
    await ensureStructuredPeriodicMissionsFromExistingDailyBlueprints(env, db, userId, {
      weeklyTarget: missingPeriodicTargets.weekly,
      monthlyTarget: missingPeriodicTargets.monthly,
    });
  }
}

// AI-powered endpoints

type ApiErrorCode =
  | "SERVICE_NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE"
  | "RATE_LIMITED";

class ApiIntegrationError extends Error {
  code: ApiErrorCode;
  status: number;

  constructor(code: ApiErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_CALLS = 20;
const RATE_LIMIT_MAX_KEYS = 2_000;
const timeoutMsByService = {
  huggingface: 12000,
  usda: 8000,
  rapidapi: 8000,
} as const;

const requestRateMap = new Map<string, number[]>();
let rateMapLastCleanupAt = 0;

function cleanupRateLimitMap(now: number): void {
  if (now - rateMapLastCleanupAt < RATE_LIMIT_WINDOW_MS) return;

  for (const [mapKey, hits] of requestRateMap.entries()) {
    const validHits = hits.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
    if (validHits.length === 0) {
      requestRateMap.delete(mapKey);
    } else if (validHits.length !== hits.length) {
      requestRateMap.set(mapKey, validHits);
    }
  }

  if (requestRateMap.size > RATE_LIMIT_MAX_KEYS) {
    const overflow = requestRateMap.size - RATE_LIMIT_MAX_KEYS;
    const iterator = requestRateMap.keys();
    for (let index = 0; index < overflow; index += 1) {
      const keyToDelete = iterator.next().value;
      if (typeof keyToDelete === "string") {
        requestRateMap.delete(keyToDelete);
      }
    }
  }

  rateMapLastCleanupAt = now;
}

function enforceRateLimit(key: string) {
  const now = Date.now();
  cleanupRateLimitMap(now);
  const hits = requestRateMap.get(key) ?? [];
  const validHits = hits.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (validHits.length >= RATE_LIMIT_MAX_CALLS) {
    throw new ApiIntegrationError("RATE_LIMITED", 429, "Muitas requisiÃƒÂ§ÃƒÂµes externas. Tente novamente em instantes.");
  }
  validHits.push(now);
  requestRateMap.set(key, validHits);
}

function toFriendlyErrorResponse(error: unknown) {
  if (error instanceof ApiIntegrationError) {
    return {
      status: error.status,
      payload: {
        error: error.message,
        code: error.code,
      },
    };
  }
  return {
    status: 500,
    payload: {
      error: "ServiÃƒÂ§o temporariamente indisponÃƒÂ­vel. Tente novamente em alguns instantes.",
      code: "UPSTREAM_ERROR" satisfies ApiErrorCode,
    },
  };
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.status === 401 || response.status === 403) {
      throw new ApiIntegrationError("AUTH_FAILED", 502, "Falha de autenticaÃƒÂ§ÃƒÂ£o com serviÃƒÂ§o externo.");
    }
    if (!response.ok) {
      throw new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar serviÃƒÂ§o externo.");
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiIntegrationError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new ApiIntegrationError("TIMEOUT", 504, "Tempo de resposta excedido em serviÃƒÂ§o externo.");
    }
    throw new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar serviÃƒÂ§o externo.");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchResponseWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiIntegrationError("TIMEOUT", 504, "Tempo de resposta excedido em serviÃƒÂ§o externo.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAIChat(
  c: import("hono").Context<AppContext>,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1000,
  jsonMode = false
) {
  const apiKey = getHuggingFaceApiKey(c.env);
  if (!apiKey) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "Hugging Face nÃƒÂ£o configurada.");
  }
  enforceRateLimit(`huggingface:${c.get("user")?.id ?? "anon"}`);
  return fetchJsonWithTimeout<OpenAIChatCompletionResponse>(
    "https://router.huggingface.co/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b:groq",
        messages,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    },
    timeoutMsByService.huggingface
  );
}

type USDAResponse = {
  foods?: Array<{
    description?: string | undefined;
    foodNutrients?: Array<{ nutrientName?: string | undefined; value?: number | undefined }>;
  }>;
};

type RapidApiNutritionResponse = Array<{
  name?: string | undefined;
  calories?: number | undefined;
  protein_g?: number | undefined;
  carbohydrates_total_g?: number | undefined;
  fat_total_g?: number | undefined;
}>;

async function searchFoodOnUSDA(c: import("hono").Context<AppContext>, query: string) {
  if (!c.env.USDA_API_KEY) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "USDA nÃƒÂ£o configurada.");
  }
  enforceRateLimit(`usda:${c.get("user")?.id ?? "anon"}`);
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", c.env.USDA_API_KEY);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", "1");
  return fetchJsonWithTimeout<USDAResponse>(url.toString(), { method: "GET" }, timeoutMsByService.usda);
}

async function searchFoodOnRapidApi(c: import("hono").Context<AppContext>, query: string) {
  if (!c.env.RAPID_API_KEY) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "RapidAPI nÃƒÂ£o configurada.");
  }
  const host = c.env.RAPID_API_HOST || "nutrition-by-api-ninjas.p.rapidapi.com";
  enforceRateLimit(`rapidapi:${c.get("user")?.id ?? "anon"}`);
  const url = `https://${host}/v1/nutrition?query=${encodeURIComponent(query)}`;
  return fetchJsonWithTimeout<RapidApiNutritionResponse>(
    url,
    {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": c.env.RAPID_API_KEY,
        "X-RapidAPI-Host": host,
      },
    },
    timeoutMsByService.rapidapi
  );
}

function parseNutritionFromOcrLabel(text: string) {
  if (!text) return null;

  const normalize = (value?: string | undefined) => (value ? Number(value.replace(",", ".")) : null);
  const kcal = normalize(safeGet(text.match(/(\d+[.,]?\d*)\s*kcal/i) ?? [], 1));
  const kJ = normalize(safeGet(text.match(/(\d+[.,]?\d*)\s*kj/i) ?? [], 1));
  const protein = normalize(safeGet(text.match(/prote[iÃƒÂ­]n[aa]s?[^\d]*(\d+[.,]?\d*)\s*g/i) ?? [], 1));
  const carbs = normalize(safeGet(text.match(/carboidratos?[^\d]*(\d+[.,]?\d*)\s*g/i) ?? [], 1));
  const fats = normalize(safeGet(text.match(/gorduras?(?:\s+totais?)?[^\d]*(\d+[.,]?\d*)\s*g/i) ?? [], 1));

  if ([kcal, kJ, protein, carbs, fats].every((item) => item === null)) {
    return null;
  }

  return {
    calories: kcal,
    energy_kj: kJ,
    protein,
    carbs,
    fats,
  };
}

type MissionDraft = {
  title?: string | undefined;
  description?: string | undefined;
  skill_name?: string | undefined;
  muscle?: string | undefined;
  exercise_category?: MissionExerciseCategory | undefined;
  metric_value?: number | undefined;
  sets?: number | undefined;
  rest_seconds?: number | undefined;
  instructions?: string[] | undefined;
  image_url?: string | undefined;
  xp_reward?: number | undefined;
  points_reward?: number | undefined;
};

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | undefined;
    };
  }>;
}

function normalizeConditioning(value: unknown): ConditioningLevel {
  if (value === "sedentario" || value === "iniciante" || value === "intermediario" || value === "avancado") {
    return value;
  }
  return "iniciante";
}

function toSafeString(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function toPositiveInt(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : fallback;
}

function extractExerciseName(title: string): string {
  const normalized = title.trim();
  if (!normalized.includes(":")) {
    return normalized;
  }
  const pieces = normalized.split(":");
  const suffix = pieces.slice(1).join(":").trim();
  return suffix.length > 0 ? suffix : normalized;
}

function xpByConditioning(conditioning: ConditioningLevel): number {
  if (conditioning === "avancado") return 95;
  if (conditioning === "intermediario") return 75;
  if (conditioning === "sedentario") return 35;
  return 55;
}

function pointsByConditioning(conditioning: ConditioningLevel): number {
  if (conditioning === "avancado") return 24;
  if (conditioning === "intermediario") return 18;
  if (conditioning === "sedentario") return 8;
  return 12;
}

function sanitizeMissionDraft(raw: MissionDraft, conditioning: ConditioningLevel, index: number): MissionPayload {
  const baseTitle = `Missao Diaria ${index + 1}`;
  const exerciseName = toSafeString(raw.skill_name ?? raw.title, baseTitle);
  const muscle = toSafeString(raw.muscle, "full body");
  const forcedCategory = raw.exercise_category ?? normalizeExerciseCategory(exerciseName, muscle);

  const payload = buildMissionPayload({
    period: "daily",
    titlePrefix: "Missao Diaria",
    exerciseName,
    muscle,
    imageUrl: raw.image_url,
    missionOrigin: "ai",
    xp: toPositiveInt(raw.xp_reward, xpByConditioning(conditioning)),
    points: toPositiveInt(raw.points_reward, pointsByConditioning(conditioning)),
    forceCategory: forcedCategory,
  });

  const safeMetricValue = payload.metric_type === "duration_minutes"
    ? Math.min(toPositiveInt(raw.metric_value, payload.metric_value), 25)
    : toPositiveInt(raw.metric_value, payload.metric_value);
  const safeSets = raw.sets ? Math.max(1, raw.sets) : payload.sets;
  const safeRest = raw.rest_seconds ? Math.max(15, raw.rest_seconds) : payload.rest_seconds;

  return {
    ...payload,
    title: toSafeString(raw.title, payload.title),
    description: toSafeString(
      raw.description,
      buildMissionDescriptionFromInstructions(
        payload.instructions,
        buildMissionDescription(exerciseName, payload.metric_type, safeMetricValue, safeSets),
      ),
    ),
    metric_value: safeMetricValue,
    sets: safeSets,
    rest_seconds: safeRest,
    target_reps: payload.metric_type === "duration_seconds" || payload.metric_type === "duration_minutes" ? null : safeMetricValue,
    target_time: payload.metric_type === "duration_seconds" ? safeMetricValue : payload.metric_type === "duration_minutes" ? safeMetricValue * 60 : null,
    instructions: Array.isArray(raw.instructions) && raw.instructions.length > 0
      ? raw.instructions.map((item) => toSafeString(item, "")).filter((item) => item.length > 0).slice(0, 5)
      : payload.instructions,
  };
}

// Fallback generator para missoes baseadas em condicionamento
async function generateFallbackMissions(
  conditioning: ConditioningLevel = "iniciante",
  skills: Array<{ name: string; category?: string | undefined }> = []
): Promise<MissionPayload[]> {
  if (skills.length === 0) {
    return fallbackMissionsForPeriod("daily", "Missao Diaria", xpByConditioning(conditioning), pointsByConditioning(conditioning))
      .map((mission) => ({ ...mission, mission_origin: "ai" }));
  }

  return skills.slice(0, 3).map((skill, index) =>
    sanitizeMissionDraft(
      {
        title: `Missao Diaria: ${skill.name}`,
        skill_name: skill.name,
        muscle: skill.category ?? "full body",
      },
      conditioning,
      index
    )
  );
}

type AiMissionGenerationResult = {
  missions: Array<MissionPayload & { type: MissionPeriod }>;
  fallback: boolean;
  error: string | null;
};

const MISSION_JOB_SCHEMA_TTL_MS = 60_000;
let missionJobSchemaCheckedAt = 0;

async function ensureMissionJobSchema(db: D1Database): Promise<void> {
  const now = Date.now();
  if (now - missionJobSchemaCheckedAt < MISSION_JOB_SCHEMA_TTL_MS) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS mission_generation_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_mission_generation_jobs_user_status ON mission_generation_jobs(user_id, status)"
  ).run();
  missionJobSchemaCheckedAt = now;
}

async function generateAiMissionsForUser(
  env: Env,
  db: D1Database,
  userId: string,
  conditioningInput?: unknown
): Promise<AiMissionGenerationResult> {
  const [profile, skills] = await Promise.all([
    db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(userId).first<Record<string, unknown>>(),
    db.prepare(
      "SELECT s.* FROM skills s\n        INNER JOIN user_skills us ON s.id = us.skill_id\n        WHERE us.user_id = ?"
    ).bind(userId).all<{ id: number; name: string; category?: string | undefined }>(),
  ]);

  const conditioning = normalizeConditioning(conditioningInput ?? profile?.initial_conditioning);
  const skillRows = skills.results as Array<{ id: number; name: string; category?: string | undefined }>;
  const baseMissions = await generateFallbackMissions(conditioning, skillRows);

  let aiMissions: MissionPayload[] = [];
  let fallback = false;
  let error: string | null = null;

  const aiPrompt = [
    "Gere duas missoes fitness especificas para hoje e responda JSON com a chave missions (array).",
    "Cada missao deve conter: title, description, skill_name, muscle, exercise_category, metric_type, metric_value, sets, rest_seconds.",
    "Categorias permitidas: plank, isometric, walk, run, yoga, stretching, mobility, strength, cardio_circuit.",
    "Condicionamento: " + conditioning,
    "Objetivo: " + String(profile?.main_goal ?? "saude_geral"),
    "Lesoes: " + String(profile?.injuries ?? "nenhuma"),
    "Equipamentos: " + String(profile?.equipment ?? "nenhum"),
    MISSION_METRIC_RULES_PROMPT,
  ].join("\n");

  const apiKey = getHuggingFaceApiKey(env);
  if (apiKey) {
    try {
      const completion = await fetchJsonWithTimeout<{ choices?: Array<{ message?: { content?: string | undefined } }> }>(
        "https://router.huggingface.co/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b:groq",
            messages: [{ role: "user", content: aiPrompt }],
            max_tokens: 800,
            response_format: { type: "json_object" },
          }),
        },
        timeoutMsByService.huggingface
      );

      const content = safeGet(completion.choices ?? [], 0)?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as { missions?: MissionDraft[] };
      const parsedMissions = Array.isArray(parsed.missions) ? parsed.missions : [];
      aiMissions = parsedMissions.slice(0, 2).map((mission, index) =>
        sanitizeMissionDraft(mission, conditioning, index + 3)
      );
    } catch {
      error = "Falha na IA";
      fallback = true;
    }
  } else {
    fallback = true;
    error = "IA indisponivel";
  }

  const totalMissions = [...baseMissions.slice(0, 3), ...aiMissions.slice(0, 2)].slice(0, 5);
  const aiMissionEntries = await mapWithConcurrency(
    totalMissions,
    2,
    async (mission) => {
      const missionPeriod: MissionPeriod =
        mission.metric_type === "circuit_tasks" ||
          classifyMission(mission.title, mission.duration_estimate_minutes ?? undefined) === "weekly"
          ? "weekly"
          : "daily";

      const exerciseName = extractExerciseName(mission.title);
      const shouldEnrichWithExerciseApi = missionPeriod === "daily";
      const [enrichedMedia, aiContext] = await Promise.all([
        shouldEnrichWithExerciseApi
          ? enrichExercise(exerciseName, env).catch(() => null)
          : Promise.resolve(null),
        getExerciseInstructionsFromAI(
          exerciseName,
          mission.metric_type,
          conditioning,
          env,
          missionPeriod
        ),
      ]);
      const apiInstructionsEn = normalizeInstructionList(enrichedMedia?.instructions, 8);
      const apiInstructionsPt = await translateExerciseInstructionsToPt(apiInstructionsEn, exerciseName, env);
      const missionMediaUrl = enrichedMedia?.gifUrl
        ?? enrichedMedia?.exerciseDbGifUrl
        ?? (enrichedMedia?.videoUrl ? (enrichedMedia?.thumbnailUrl ?? null) : null)
        ?? enrichedMedia?.imageUrl
        ?? mission.image_url
        ?? mission.thumbnail_url
        ?? null;

      const withMetric = applyMissionMetricContext(
        {
          ...mission,
          image_url: missionMediaUrl,
          exercise_db_gif_url: mission.exercise_db_gif_url ?? enrichedMedia?.exerciseDbGifUrl ?? null,
          exercise_db_image_url: mission.exercise_db_image_url ?? enrichedMedia?.exerciseDbImageUrl ?? null,
          exercise_name: mission.exercise_name ?? enrichedMedia?.name ?? exerciseName,
          exercise_equipment: mission.exercise_equipment ?? (enrichedMedia?.equipment || null),
          exercise_body_part: mission.exercise_body_part ?? (enrichedMedia?.bodyPart || null),
          exercise_target: mission.exercise_target ?? (enrichedMedia?.target || null),
          exercise_secondary_muscles: mission.exercise_secondary_muscles.length > 0
            ? mission.exercise_secondary_muscles
            : mergeUniqueStrings(
              Array.isArray(enrichedMedia?.secondaryMuscles) ? enrichedMedia.secondaryMuscles : [],
              8,
            ),
          exercise_instructions_en: mission.exercise_instructions_en.length > 0 ? mission.exercise_instructions_en : apiInstructionsEn,
          exercise_instructions_pt: mission.exercise_instructions_pt.length > 0 ? mission.exercise_instructions_pt : apiInstructionsPt,
          video_url: mission.video_url ?? enrichedMedia?.videoUrl ?? null,
          thumbnail_url: mission.thumbnail_url ?? enrichedMedia?.thumbnailUrl ?? null,
        },
        missionPeriod,
        exerciseName,
        aiContext.metricType,
        aiContext.metricValue
      );

      const aiInstructionSource = normalizeInstructionList(aiContext.instructions, 6);
      let mergedInstructionSource = apiInstructionsPt.slice(0, 6);
      if (mergedInstructionSource.length < 4) {
        mergedInstructionSource = mergeUniqueStrings([...mergedInstructionSource, ...aiInstructionSource], 6);
      }
      if (mergedInstructionSource.length === 0) {
        mergedInstructionSource = aiInstructionSource;
      }

      const combinedMuscles = resolveExerciseApiMuscleGroups(enrichedMedia);

      const withDetails: MissionPayload = {
        ...withMetric,
        mission_origin: "ai",
        instructions: ensureInstructionSteps(
          mergedInstructionSource.length > 0 ? mergedInstructionSource : withMetric.instructions,
          exerciseName,
          withMetric.metric_type,
          withMetric.sets,
          withMetric.rest_seconds,
        ),
        exercise_instructions_en: apiInstructionsEn,
        exercise_instructions_pt: apiInstructionsPt,
        safety_tips: aiContext.safetyTips.length > 0 ? aiContext.safetyTips.slice(0, 4) : withMetric.safety_tips,
        difficulty_level: aiContext.difficultyLevel,
        muscle_groups: combinedMuscles,
        exercise_secondary_muscles: mergeUniqueStrings(
          Array.isArray(enrichedMedia?.secondaryMuscles) ? enrichedMedia.secondaryMuscles : [],
          8,
        ),
        exercise_name: enrichedMedia?.name || (withMetric.exercise_name ?? exerciseName),
        exercise_equipment: enrichedMedia?.equipment ?? null,
        exercise_body_part: enrichedMedia?.bodyPart ?? null,
        exercise_target: enrichedMedia?.target ?? null,
        exercise_db_gif_url: enrichedMedia?.exerciseDbGifUrl ?? withMetric.exercise_db_gif_url,
        exercise_db_image_url: enrichedMedia?.exerciseDbImageUrl ?? withMetric.exercise_db_image_url,
        attributes_benefited: aiContext.attributesBenefited.length > 0
          ? aiContext.attributesBenefited.slice(0, 6)
          : withMetric.attributes_benefited,
      };
      withDetails.body_area = resolveExerciseApiBodyArea(
        enrichedMedia,
        mission.exercise_target ?? mission.muscle_groups[0] ?? exerciseName,
      );
      withDetails.description = withDetails.metric_type === "circuit_tasks"
        ? ""
        : buildMissionDescriptionFromInstructions(
          withDetails.instructions,
          buildMissionDescription(exerciseName, withDetails.metric_type, withDetails.metric_value, withDetails.sets),
        );
      if (withDetails.metric_type === "circuit_tasks") {
        withDetails.image_url = null;
        withDetails.exercise_db_gif_url = null;
        withDetails.exercise_db_image_url = null;
        withDetails.video_url = null;
        withDetails.thumbnail_url = null;
        withDetails.exercise_name = null;
        withDetails.exercise_equipment = null;
        withDetails.exercise_body_part = null;
        withDetails.exercise_target = null;
        withDetails.exercise_secondary_muscles = [];
        withDetails.muscle_groups = mergeUniqueStrings(withDetails.circuit_tasks.map((task) => task.label), 6);
      }

      return {
        period: missionPeriod,
        deadline: futureIsoForPeriod(missionPeriod),
        mission: withDetails,
      };
    },
  );

  for (const entry of aiMissionEntries) {
    const mission = entry.mission;
    const missionSkillName = toSafeString(mission.title, "").toLowerCase();
    const skill = missionSkillName
      ? skillRows.find((skillRow) => skillRow.name.toLowerCase().includes(missionSkillName))
      : null;

    await insertMission(
      db,
      userId,
      entry.period,
      entry.deadline,
      entry.mission,
      skill?.id ?? null,
    );
  }

  invalidateMissionListCache(userId);

  return {
    missions: aiMissionEntries.map((entry) => ({ ...entry.mission, type: entry.period })),
    fallback,
    error,
  };
}

// 1. Generate personalized missions using AI (background processing with status endpoint)
app.post("/api/ai/generate-missions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    await ensureMissionJobSchema(c.env.fitloot_db);
    const requestBody = await c.req.json().catch(() => ({})) as { conditioning?: unknown };
    const jobId = crypto.randomUUID();

    await c.env.fitloot_db.prepare(
      `INSERT INTO mission_generation_jobs (id, user_id, status, result_json, error_message, updated_at)
       VALUES (?, ?, 'processing', NULL, NULL, datetime('now'))`
    ).bind(jobId, user.id).run();

    c.executionCtx.waitUntil((async () => {
      try {
        const result = await generateAiMissionsForUser(c.env, c.env.fitloot_db, user.id, requestBody.conditioning);
        await c.env.fitloot_db.prepare(
          `UPDATE mission_generation_jobs
             SET status = 'completed', result_json = ?, error_message = NULL, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`
        ).bind(JSON.stringify(result), jobId, user.id).run();
      } catch (jobError) {
        console.error("[/api/ai/generate-missions][job]", {
          message: getErrorMessage(jobError),
          userId: user.id,
          jobId,
        });
        await c.env.fitloot_db.prepare(
          `UPDATE mission_generation_jobs
             SET status = 'failed', error_message = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`
        ).bind(getErrorMessage(jobError), jobId, user.id).run();
      }
    })());

    return c.json({
      success: true,
      status: "processing",
      job_id: jobId,
    }, 202);
  } catch (routeError) {
    console.error("[/api/ai/generate-missions]", {
      message: getErrorMessage(routeError),
      userId: user.id,
    });

    if (isMissingSchemaError(routeError)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.get("/api/ai/generate-missions/status", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const jobId = String(c.req.query("job_id") ?? "").trim();
  if (!jobId) {
    return c.json({ error: "job_id obrigatorio" }, 400);
  }

  try {
    await ensureMissionJobSchema(c.env.fitloot_db);
    const job = await c.env.fitloot_db.prepare(
      `SELECT id, status, result_json, error_message, created_at, updated_at
       FROM mission_generation_jobs
       WHERE id = ? AND user_id = ?`
    ).bind(jobId, user.id).first<{
      id: string;
      status: string;
      result_json: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>();

    if (!job) {
      return c.json({ error: "Job nao encontrado" }, 404);
    }

    if (job.status === "completed") {
      const parsed = job.result_json ? JSON.parse(job.result_json) as AiMissionGenerationResult : null;
      return c.json({
        success: true,
        status: "completed",
        missions: parsed?.missions ?? [],
        fallback: Boolean(parsed?.fallback),
        error: parsed?.error ?? null,
        job_id: job.id,
      });
    }

    if (job.status === "failed") {
      return c.json({
        success: false,
        status: "failed",
        error: job.error_message ?? "Falha ao gerar missoes",
        job_id: job.id,
      }, 500);
    }

    return c.json({
      success: true,
      status: "processing",
      job_id: job.id,
      updated_at: job.updated_at,
    }, 202);
  } catch (error) {
    console.error("[/api/ai/generate-missions/status]", {
      message: getErrorMessage(error),
      userId: user.id,
      jobId,
    });
    return internalErrorResponse(c);
  }
});

// 2. AI Fitness Chatbot
app.post("/api/ai/chat", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const raw = await c.req.json();
    const parsed = AiChatRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
    }
    const { message: userMessage, history: conversationHistory = [], mode = "suporte", session_count } = parsed.data;

    await ensureUserCounterRow(c.env.fitloot_db, user.id);
    const currentCounter = await c.env.fitloot_db.prepare("SELECT chat_messages, repeated_message_streak, last_chat_message FROM user_event_counters WHERE user_id = ?")
      .bind(user.id).first<{ chat_messages: number; repeated_message_streak: number; last_chat_message: string | null }>();
    const sameMessage = (currentCounter?.last_chat_message ?? "") === userMessage;
    const nextRepeat = sameMessage ? Number(currentCounter?.repeated_message_streak ?? 0) + 1 : 1;
    await c.env.fitloot_db.prepare(
      `UPDATE user_event_counters SET
        chat_messages = COALESCE(chat_messages, 0) + 1,
        repeated_message_streak = ?,
        last_chat_message = ?,
        updated_at = datetime('now')
      WHERE user_id = ?`
    ).bind(nextRepeat, userMessage, user.id).run();
    await logUserEvent(c.env.fitloot_db, user.id, 'chat_message', { size: userMessage.length, repeated: sameMessage });
    await onChatMessage(c.env.fitloot_db, user.id, Number(session_count ?? (Number(currentCounter?.chat_messages ?? 0) + 1)));
    if (Number(session_count ?? 0) >= 100) {
      await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, "Conversa de Louco", Number(session_count), 100);
    }

    const [profile, progression, attributes] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(user.id).first(),
    ]);

    const systemPrompt = `VocÃƒÂª ÃƒÂ© o assistente oficial do app FitBot.
Sua funÃƒÂ§ÃƒÂ£o ÃƒÂ© responder de forma ÃƒÂºtil, natural, objetiva e agradÃƒÂ¡vel, ajudando o usuÃƒÂ¡rio com treino, evoluÃƒÂ§ÃƒÂ£o fÃƒÂ­sica, hÃƒÂ¡bitos, alimentaÃƒÂ§ÃƒÂ£o e uso do app.

REGRAS DE COMPORTAMENTO

1. TOM DE VOZ
- Fale de forma humana, natural, clara e amigÃƒÂ¡vel.
- Seja acolhedor, mas sem exagero.
- Evite linguagem robÃƒÂ³tica.
- Evite parecer um coach caricato ou motivacional demais.
- Evite excesso de entusiasmo, emojis e frases decoradas.

2. OBJETIVIDADE
- Responda exatamente o que o usuÃƒÂ¡rio pediu.
- NÃƒÂ£o acrescente explicaÃƒÂ§ÃƒÂµes longas sem necessidade.
- NÃƒÂ£o desvie do assunto.
- NÃƒÂ£o invente contexto extra.
- Se a pergunta for simples, responda de forma simples.

3. PERSONALIZAÃƒâ€¡ÃƒÆ’O
- Personalize a resposta quando isso realmente agregar valor.
- Use o nome do usuÃƒÂ¡rio com moderaÃƒÂ§ÃƒÂ£o.
- Nunca repita o nome do usuÃƒÂ¡rio em toda mensagem.
- SÃƒÂ³ use o nome em momentos especÃƒÂ­ficos: primeira saudaÃƒÂ§ÃƒÂ£o, incentivo pontual, contexto em que a personalizaÃƒÂ§ÃƒÂ£o melhora a experiÃƒÂªncia.
- Na maior parte do tempo, responda sem citar o nome.

4. ESTILO DE RESPOSTA
- Prefira respostas curtas ou mÃƒÂ©dias.
- SÃƒÂ³ faÃƒÂ§a respostas longas quando o usuÃƒÂ¡rio pedir detalhes.
- Evite introduÃƒÂ§ÃƒÂµes desnecessÃƒÂ¡rias.
- VÃƒÂ¡ direto ao ponto.
- Organize a resposta com clareza.
- Quando ÃƒÂºtil, divida em etapas simples.

5. PROIBIÃƒâ€¡Ãƒâ€¢ES DE ESTILO
- NÃƒÂ£o use frases como "Estou aqui pronto para ajudar vocÃƒÂª a evoluir", "Vamos nessa rumo ao seu objetivo", "bora ganhar XP", "estou aqui para te acompanhar nessa jornada".
- NÃƒÂ£o transforme toda resposta em mensagem motivacional.
- NÃƒÂ£o tente ser engraÃƒÂ§ado o tempo todo.
- NÃƒÂ£o use o nome do usuÃƒÂ¡rio repetidamente.
- NÃƒÂ£o enfeite respostas com texto desnecessÃƒÂ¡rio.

6. QUANDO O USUÃƒÂRIO MANDAR MENSAGEM CONFUSA
- PeÃƒÂ§a esclarecimento de forma curta e natural.
- Tom: "NÃƒÂ£o entendi muito bem. Me explica de outro jeito?" ou "Pode reformular? Quero te responder certo."
- NÃƒÂ£o faÃƒÂ§a textos longos para dizer que nÃƒÂ£o entendeu.

7. QUANDO O USUÃƒÂRIO FIZER PERGUNTA DIRETA
- Responda diretamente, sem introduÃƒÂ§ÃƒÂ£o.

8. QUANDO O USUÃƒÂRIO PEDIR AJUDA PRÃƒÂTICA
- Entregue aÃƒÂ§ÃƒÂ£o concreta: treino, ajuste de rotina, sugestÃƒÂ£o alimentar, explicaÃƒÂ§ÃƒÂ£o objetiva.
- Menos fala inspiracional, mais utilidade.

9. QUANDO NÃƒÆ’O SOUBER OU FALTAR CONTEXTO
- Admita de forma simples e peÃƒÂ§a apenas a informaÃƒÂ§ÃƒÂ£o necessÃƒÂ¡ria.
- NÃƒÂ£o invente.

10. FORMATO IDEAL
- Pergunta simples -> resposta curta
- Pergunta pratica -> resposta objetiva com passos
- Pergunta complexa -> resposta clara, sem enrolacao
- Duvida emocional -> resposta acolhedora, mas sobria

11. REGRA FINAL
Antes de responder, avalie: Estou respondendo exatamente o que foi pedido? Estou sendo mais longo do que preciso? Estou usando o nome sem necessidade? Estou parecendo natural ou teatral? Se estiver teatral ou motivacional demais, simplifique.

INSTRUÃƒâ€¡Ãƒâ€¢ES EXTRAS DE ESTILO
- NÃƒÂ£o use mais de 1 emoji por resposta, e apenas quando combinar naturalmente.
- Responda primeiro, explique depois se necessÃƒÂ¡rio.
- Se a pergunta for curta, a resposta tambÃƒÂ©m deve ser curta.
- Se o usuÃƒÂ¡rio estiver irritado ou impaciente, seja ainda mais direto.
- NUNCA use markdown na resposta. NÃƒÂ£o use **, *, |, #, ---, tabelas ou qualquer sÃƒÂ­mbolo de formataÃƒÂ§ÃƒÂ£o. Escreva em texto puro e natural.

Contexto do usuÃƒÂ¡rio:
- Nome: ${profile?.full_name}
- NÃƒÂ­vel: ${progression?.level}
- XP: ${progression?.xp}
- Streak: ${progression?.current_streak} dias
- Objetivo: ${profile?.main_goal}
- Condicionamento: ${profile?.initial_conditioning}
- ForÃƒÂ§a: ${attributes?.strength}
- Modo: ${mode}`;

    const openaiData = await callOpenAIChat(c, [
      { role: "system", content: systemPrompt },
      ...conversationHistory.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: "user", content: userMessage },
    ]);

    const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "";
    return c.json({ message: content });
  } catch (error) {
    console.error("[ai-chat]", error);
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});

type AiRecommendationsPayload = {
  next_skill_recommendation: {
    name: string;
    reason: string;
  };
  weak_attribute: {
    name: string;
    suggestion: string;
  };
  training_focus: {
    type: string;
    reason: string;
  };
  motivation_message: string;
};

type AiRecommendationSkillRow = {
  name: string;
  total_reps: number;
  best_reps: number;
};

function toRoundedNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function buildFallbackRecommendations(params: {
  level: number;
  streak: number;
  goal: string | null | undefined;
  attributes: {
    strength: number;
    constitution: number;
    vitality: number;
    dexterity: number;
    focus: number;
  };
  skills: AiRecommendationSkillRow[];
}): AiRecommendationsPayload {
  const goal = typeof params.goal === "string" ? params.goal : "";
  const focusByGoal: Record<string, { type: string; reason: string }> = {
    perder_peso: {
      type: "Condicionamento",
      reason: "Aumente a frequencia de sessoes dinamicas para elevar o gasto calorico com consistencia.",
    },
    ganhar_massa: {
      type: "Forca progressiva",
      reason: "Priorize sobrecarga gradual e execucao controlada para sustentar ganho de massa.",
    },
    resistencia: {
      type: "Volume e resistencia",
      reason: "Blocos mais longos e descansos menores ajudam a consolidar sua resistencia.",
    },
    calistenia: {
      type: "Tecnica de base",
      reason: "Fortalecer movimentos fundamentais melhora o controle corporal para a progressao na calistenia.",
    },
    saude_geral: {
      type: "Constancia semanal",
      reason: "Rotina equilibrada e aderente costuma gerar o melhor resultado para saude geral.",
    },
  };

  const weakestAttributeCandidates: Array<{ name: string; value: number; suggestion: string }> = [
    {
      name: "Forca",
      value: params.attributes.strength,
      suggestion: "Inclua exercicios compostos e aumente a carga ou repeticoes de forma gradual.",
    },
    {
      name: "Constituicao",
      value: params.attributes.constitution,
      suggestion: "Combine volume moderado com recuperacao consistente para aguentar mais sessoes na semana.",
    },
    {
      name: "Vitalidade",
      value: params.attributes.vitality,
      suggestion: "Mantenha cardio leve e pausas bem distribuidas para melhorar energia ao longo do treino.",
    },
    {
      name: "Destreza",
      value: params.attributes.dexterity,
      suggestion: "Trabalhe controle de movimento e amplitude para ganhar precisao e mobilidade.",
    },
    {
      name: "Foco",
      value: params.attributes.focus,
      suggestion: "Use treinos curtos com meta clara para aumentar concentracao e regularidade.",
    },
  ];
  const weakestAttribute = weakestAttributeCandidates.sort((left, right) => left.value - right.value)[0];

  const topSkill = params.skills[0] ?? null;
  const focus = focusByGoal[goal] ?? {
    type: "Evolucao equilibrada",
    reason: "A melhor recomendacao agora e sustentar consistencia e ajustar o treino com base no seu progresso recente.",
  };

  return {
    next_skill_recommendation: topSkill
      ? {
        name: topSkill.name,
        reason: `Voce ja construiu base em ${topSkill.name}. Vale aprofundar essa skill enquanto mantem progressao controlada nas demais.`,
      }
      : {
        name: "Fundamentos de corpo livre",
        reason: "Comece pelas skills basicas para construir repertorio tecnico e facilitar as proximas evolucoes.",
      },
    weak_attribute: {
      name: weakestAttribute.name,
      suggestion: weakestAttribute.suggestion,
    },
    training_focus: focus,
    motivation_message:
      params.streak >= 7
        ? `Voce ja acumula ${params.streak} dias de streak. O melhor proximo passo e proteger essa consistencia enquanto sobe o nivel.`
        : `Seu nivel ${params.level} ja mostra progresso. Mantenha constancia nos proximos dias para transformar ritmo em resultado.`,
  };
}

function mergeRecommendationsWithFallback(
  raw: unknown,
  fallback: AiRecommendationsPayload,
): AiRecommendationsPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const data = raw as Record<string, unknown>;
  const nextSkill = data.next_skill_recommendation;
  const weakAttribute = data.weak_attribute;
  const trainingFocus = data.training_focus;

  const nextSkillRecord =
    nextSkill && typeof nextSkill === "object" && !Array.isArray(nextSkill)
      ? nextSkill as Record<string, unknown>
      : null;
  const weakAttributeRecord =
    weakAttribute && typeof weakAttribute === "object" && !Array.isArray(weakAttribute)
      ? weakAttribute as Record<string, unknown>
      : null;
  const trainingFocusRecord =
    trainingFocus && typeof trainingFocus === "object" && !Array.isArray(trainingFocus)
      ? trainingFocus as Record<string, unknown>
      : null;

  return {
    next_skill_recommendation: {
      name:
        typeof nextSkillRecord?.name === "string" && nextSkillRecord.name.trim().length > 0
          ? nextSkillRecord.name.trim()
          : fallback.next_skill_recommendation.name,
      reason:
        typeof nextSkillRecord?.reason === "string" && nextSkillRecord.reason.trim().length > 0
          ? nextSkillRecord.reason.trim()
          : fallback.next_skill_recommendation.reason,
    },
    weak_attribute: {
      name:
        typeof weakAttributeRecord?.name === "string" && weakAttributeRecord.name.trim().length > 0
          ? weakAttributeRecord.name.trim()
          : fallback.weak_attribute.name,
      suggestion:
        typeof weakAttributeRecord?.suggestion === "string" && weakAttributeRecord.suggestion.trim().length > 0
          ? weakAttributeRecord.suggestion.trim()
          : fallback.weak_attribute.suggestion,
    },
    training_focus: {
      type:
        typeof trainingFocusRecord?.type === "string" && trainingFocusRecord.type.trim().length > 0
          ? trainingFocusRecord.type.trim()
          : fallback.training_focus.type,
      reason:
        typeof trainingFocusRecord?.reason === "string" && trainingFocusRecord.reason.trim().length > 0
          ? trainingFocusRecord.reason.trim()
          : fallback.training_focus.reason,
    },
    motivation_message:
      typeof data.motivation_message === "string" && data.motivation_message.trim().length > 0
        ? data.motivation_message.trim()
        : fallback.motivation_message,
  };
}

// 3. AI Recommendations Engine
app.get("/api/ai/recommendations", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const [profile, progression, attributes, skills, completedMissions] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare(`
        SELECT s.*, us.total_reps, us.best_reps 
        FROM skills s
        INNER JOIN user_skills us ON s.id = us.skill_id
        WHERE us.user_id = ?
        ORDER BY us.total_reps DESC
      `).bind(user.id).all(),
      c.env.fitloot_db.prepare(`
        SELECT COUNT(*) as count 
        FROM missions 
        WHERE user_id = ? AND is_completed = 1
      `).bind(user.id).first(),
    ]);

    const skillRows = Array.isArray(skills.results)
      ? (skills.results as Array<{ name?: unknown; total_reps?: unknown; best_reps?: unknown }>)
        .map((skill) => ({
          name: typeof skill.name === "string" && skill.name.trim().length > 0 ? skill.name.trim() : "Skill sem nome",
          total_reps: toRoundedNumber(skill.total_reps),
          best_reps: toRoundedNumber(skill.best_reps),
        }))
      : [];

    const userStats = {
      level: toRoundedNumber(progression?.level),
      total_missions: toRoundedNumber(completedMissions?.count),
      streak: toRoundedNumber(progression?.current_streak),
    };

    const fallbackRecommendations = buildFallbackRecommendations({
      level: userStats.level,
      streak: userStats.streak,
      goal: typeof profile?.main_goal === "string" ? profile.main_goal : null,
      attributes: {
        strength: toRoundedNumber(attributes?.strength),
        constitution: toRoundedNumber(attributes?.constitution),
        vitality: toRoundedNumber(attributes?.vitality),
        dexterity: toRoundedNumber(attributes?.dexterity),
        focus: toRoundedNumber(attributes?.focus),
      },
      skills: skillRows,
    });

    const prompt = `Analise este perfil fitness gamificado e gere recomendaÃƒÂ§ÃƒÂµes personalizadas em JSON.
NÃƒÂ­vel: ${progression?.level}
XP: ${progression?.xp}
MissÃƒÂµes completas: ${completedMissions?.count}
Streak: ${progression?.current_streak}
Objetivo: ${profile?.main_goal}
Atributos: forÃƒÂ§a ${attributes?.strength}, constituiÃƒÂ§ÃƒÂ£o ${attributes?.constitution}, vitalidade ${attributes?.vitality}, destreza ${attributes?.dexterity}, foco ${attributes?.focus}
Skills: ${skillRows.slice(0, 5).map((skill) => `${skill.name}:${skill.total_reps}`).join(",")}`;

    if (!getHuggingFaceApiKey(c.env)) {
      return c.json({
        success: true,
        recommendations: fallbackRecommendations,
        user_stats: userStats,
        degraded: true,
        source: "fallback",
      });
    }

    let recommendations = fallbackRecommendations;
    let degraded = false;

    try {
      const openaiData = await callOpenAIChat(c, [{ role: "user", content: prompt }], 1000, true);
      const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "{}";
      recommendations = mergeRecommendationsWithFallback(JSON.parse(content), fallbackRecommendations);
    } catch (error) {
      degraded = true;
      console.error("[/api/ai/recommendations][upstream]", {
        userId: user.id,
        message: getErrorMessage(error),
      });
    }

    return c.json({
      success: true,
      recommendations,
      user_stats: userStats,
      degraded,
      source: degraded ? "fallback" : "ai",
    });
  } catch (error) {
    console.error("[/api/ai/recommendations]", {
      userId: user.id,
      message: getErrorMessage(error),
    });
    return c.json({
      success: true,
      recommendations: buildFallbackRecommendations({
        level: 1,
        streak: 0,
        goal: null,
        attributes: {
          strength: 0,
          constitution: 0,
          vitality: 0,
          dexterity: 0,
          focus: 0,
        },
        skills: [],
      }),
      user_stats: {
        level: 1,
        total_missions: 0,
        streak: 0,
      },
      degraded: true,
      source: "fallback",
    });
  }
});

// 4. AI workout suggestions
app.get("/api/ai/workout-suggestions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const [profile, progression, metrics] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM daily_metrics WHERE user_id = ? ORDER BY date DESC LIMIT 1").bind(user.id).first(),
    ]);

    const prompt = `Sugira treino em JSON com workout_type, duration_minutes, intensity, exercises e motivation. Contexto: nÃƒÂ­vel ${progression?.level}, objetivo ${profile?.main_goal}, passos ${metrics?.steps || 0}, calorias ${metrics?.calories_burned || 0}.`;

    const openaiData = await callOpenAIChat(c, [{ role: "user", content: prompt }], 900, true);
    const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "{}";
    const workout = JSON.parse(content) as Record<string, unknown>;

    return c.json({
      success: true,
      workout,
    });
  } catch (error) {
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});

type IdentifiedFoodItem = {
  food_name: string;
  portion_description?: string | undefined;
  portion_multiplier?: number | undefined;
};

function isIdentifiedFoodItem(item: unknown): item is IdentifiedFoodItem {
  if (!item || typeof item !== "object") return false;
  const value = item as { food_name?: unknown };
  return typeof value.food_name === "string" && value.food_name.trim().length > 0;
}

// 5. Food analysis pipeline (MediaPipe client detection + USDA + RapidAPI fallback + AI estimate)
app.post("/api/ai/analyze-food", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const raw = await c.req.json();
    const parsed = AiAnalyzeFoodRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
    }

    const { food_description, identified_items = [], ocr_text } = parsed.data;
    let items: IdentifiedFoodItem[] = identified_items.filter(isIdentifiedFoodItem);

    if (items.length === 0 && food_description) {
      const identifyPrompt = `Analise a refeiÃƒÂ§ÃƒÂ£o e responda APENAS em JSON no formato {"items":[{"food_name":"","portion_description":"","portion_multiplier":1}]}.
Contexto textual: ${food_description || "nÃƒÂ£o informado"}
Texto OCR do rÃƒÂ³tulo: ${ocr_text || "nÃƒÂ£o identificado"}.`;
      const aiData = await callOpenAIChat(c, [{ role: "user", content: identifyPrompt }], 700, true);
      const aiContent = safeGet(aiData.choices ?? [], 0)?.message?.content ?? "{}";
      const identified = JSON.parse(aiContent) as {
        items?: Array<{ food_name?: string | undefined; portion_description?: string | undefined; portion_multiplier?: number | undefined }>;
      };
      items = (identified.items ?? []).filter(isIdentifiedFoodItem);
    }

    const ocrNutrition = parseNutritionFromOcrLabel(ocr_text ?? "");

    if (items.length === 0 && !ocrNutrition) {
      throw new ApiIntegrationError("INVALID_RESPONSE", 422, "NÃƒÂ£o foi possÃƒÂ­vel identificar alimentos na imagem. Tente novamente com outra foto.");
    }

    const analyzedItems: Array<{
      food_name: string;
      portion_description: string;
      calories: number | null;
      protein: number | null;
      carbs: number | null;
      fats: number | null;
      energy_kj: number | null;
      source: "usda" | "rapidapi" | "estimate" | "ocr_label";
      warning?: string | undefined;
    }> = [];

    for (const item of items) {
      const query = assertString(item.food_name).trim();
      if (!query) {
        continue;
      }
      const multiplier = Number(item.portion_multiplier ?? 1);

      try {
        const usda = await searchFoodOnUSDA(c, query);
        const first = safeGet(usda.foods ?? [], 0);
        if (!first) throw new Error("not-found");
        const nutrients = first.foodNutrients ?? [];
        const byName = (name: string) => nutrients.find((n) => n.nutrientName?.toLowerCase() === name.toLowerCase())?.value ?? null;

        const calories = byName("Energy");
        const protein = byName("Protein");
        const carbs = byName("Carbohydrate, by difference");
        const fats = byName("Total lipid (fat)");

        analyzedItems.push({
          food_name: query,
          portion_description: item.portion_description || "porÃƒÂ§ÃƒÂ£o estimada",
          calories: calories !== null ? Math.round(calories * multiplier) : null,
          energy_kj: calories !== null ? Math.round(calories * 4.184 * multiplier) : null,
          protein: protein !== null ? Number((protein * multiplier).toFixed(1)) : null,
          carbs: carbs !== null ? Number((carbs * multiplier).toFixed(1)) : null,
          fats: fats !== null ? Number((fats * multiplier).toFixed(1)) : null,
          source: "usda",
        });
      } catch (itemError) {
        console.warn(`[analyze-food][usda-fallback] ${query}`, itemError);
        try {
          const rapidResult = await searchFoodOnRapidApi(c, query);
          const firstRapid = safeGet(rapidResult ?? [], 0);
          if (!firstRapid) {
            throw new Error("rapidapi-not-found");
          }

          const rapidCalories = Number(firstRapid.calories ?? 0);
          const rapidProtein = Number(firstRapid.protein_g ?? 0);
          const rapidCarbs = Number(firstRapid.carbohydrates_total_g ?? 0);
          const rapidFats = Number(firstRapid.fat_total_g ?? 0);

          analyzedItems.push({
            food_name: query,
            portion_description: item.portion_description || "porÃƒÂ§ÃƒÂ£o estimada",
            calories: Number.isFinite(rapidCalories) ? Math.round(rapidCalories * multiplier) : null,
            energy_kj: Number.isFinite(rapidCalories) ? Math.round(rapidCalories * 4.184 * multiplier) : null,
            protein: Number.isFinite(rapidProtein) ? Number((rapidProtein * multiplier).toFixed(1)) : null,
            carbs: Number.isFinite(rapidCarbs) ? Number((rapidCarbs * multiplier).toFixed(1)) : null,
            fats: Number.isFinite(rapidFats) ? Number((rapidFats * multiplier).toFixed(1)) : null,
            source: "rapidapi",
            warning: "Alimento nÃƒÂ£o encontrado no USDA. Valores retornados pela RapidAPI.",
          });
        } catch (rapidError) {
          console.warn(`[analyze-food][rapidapi-fallback] ${query}`, rapidError);
          const estimatePrompt = `Estime APENAS JSON com calories, protein, carbs, fats para ${query} (${item.portion_description || "porÃƒÂ§ÃƒÂ£o mÃƒÂ©dia"}).`;
          const fallbackData = await callOpenAIChat(c, [{ role: "user", content: estimatePrompt }], 350, true);
          const estimate = JSON.parse(safeGet(fallbackData.choices ?? [], 0)?.message?.content ?? "{}") as {
            calories?: number | undefined;
            protein?: number | undefined;
            carbs?: number | undefined;
            fats?: number | undefined;
          };

          analyzedItems.push({
            food_name: query,
            portion_description: item.portion_description || "porÃƒÂ§ÃƒÂ£o estimada",
            calories: estimate.calories ?? null,
            energy_kj: estimate.calories ? Math.round(estimate.calories * 4.184) : null,
            protein: estimate.protein ?? null,
            carbs: estimate.carbs ?? null,
            fats: estimate.fats ?? null,
            source: "estimate",
            warning: "Alimento nÃƒÂ£o encontrado no USDA/RapidAPI. Valores estimados por IA.",
          });
        }
      }
    }

    if (ocrNutrition) {
      analyzedItems.push({
        food_name: "RÃƒÂ³tulo identificado",
        portion_description: "dados extraÃƒÂ­dos do rÃƒÂ³tulo",
        calories: ocrNutrition.calories,
        energy_kj: ocrNutrition.energy_kj,
        protein: ocrNutrition.protein,
        carbs: ocrNutrition.carbs,
        fats: ocrNutrition.fats,
        source: "ocr_label",
      });
    }

    const totals = analyzedItems.reduce(
      (acc, item) => {
        acc.calories += item.calories ?? 0;
        acc.energy_kj += item.energy_kj ?? 0;
        acc.protein += item.protein ?? 0;
        acc.carbs += item.carbs ?? 0;
        acc.fats += item.fats ?? 0;
        return acc;
      },
      { calories: 0, energy_kj: 0, protein: 0, carbs: 0, fats: 0 }
    );

    const macroTotal = totals.protein + totals.carbs + totals.fats;
    const percentages = {
      protein: macroTotal > 0 ? Number(((totals.protein / macroTotal) * 100).toFixed(1)) : 0,
      carbs: macroTotal > 0 ? Number(((totals.carbs / macroTotal) * 100).toFixed(1)) : 0,
      fats: macroTotal > 0 ? Number(((totals.fats / macroTotal) * 100).toFixed(1)) : 0,
    };

    return c.json({
      success: true,
      ocr_text: ocr_text || undefined,
      items: analyzedItems,
      totals: {
        calories: Math.round(totals.calories),
        energy_kj: Math.round(totals.energy_kj),
        protein: Number(totals.protein.toFixed(1)),
        carbs: Number(totals.carbs.toFixed(1)),
        fats: Number(totals.fats.toFixed(1)),
        macro_percentages: percentages,
      },
      has_estimates: analyzedItems.some((item) => item.source !== "usda"),
      estimation_warning: analyzedItems.some((item) => item.source === "estimate")
        ? "Alguns alimentos nÃƒÂ£o foram encontrados no USDA/RapidAPI e foram estimados por IA."
        : undefined,
    });
  } catch (error) {
    console.error("[analyze-food]", error);
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});


app.get("/health", async (c) => {
  const host = new URL(c.req.url).hostname;
  const schemaReady = await hasCoreSchema(c.env.fitloot_db);
  const environment = host === "localhost" || host === "127.0.0.1" ? "local" : "production";

  return c.json({
    ok: true,
    timestamp: new Date().toISOString(),
    hasHuggingFace: Boolean(getHuggingFaceApiKey(c.env)),
    hasOpenAI: false,
    hasUSDA: Boolean(c.env.USDA_API_KEY),
    hasRapidAPI: Boolean(c.env.RAPID_API_KEY),
    hasVision: false,
    hasDB: Boolean(c.env.fitloot_db),
    hasCoreSchema: schemaReady,
    environment,
  });
});

async function processDailyReset(env: Env) {
  await processDailyResetForAllUsers({
    db: env.fitloot_db,
    processUser: async (userId) => {
      try {
        await ensureUserCounterRow(env.fitloot_db, userId);
        await cleanupSettledMissionsWithGuard(env.fitloot_db, userId);
        await expirePendingMissionsAndUpdateStreak(env.fitloot_db, userId);
        await ensurePeriodicMissions(env, env.fitloot_db, userId);
      } catch (error) {
        console.error("[processDailyReset][user]", {
          userId,
          message: getErrorMessage(error),
        });
      }
    },
  });
}

// 6. Healthchecks for external services
app.get("/api/health/external", authMiddleware, async (c) => {
  return c.json({
    huggingface: Boolean(getHuggingFaceApiKey(c.env)),
    openai: false,
    usda: Boolean(c.env.USDA_API_KEY),
    rapidapi: Boolean(c.env.RAPID_API_KEY),
    google_vision: false,
    anthropic: Boolean(c.env.ANTHROPIC_API_KEY),
  });
});

app.get("/api/health/openai", authMiddleware, async (c) => c.json({ ok: false, deprecated: true }));
app.get("/api/health/huggingface", authMiddleware, async (c) => c.json({ ok: Boolean(getHuggingFaceApiKey(c.env)) }));
app.get("/api/health/usda", authMiddleware, async (c) => c.json({ ok: Boolean(c.env.USDA_API_KEY) }));
app.get("/api/health/rapidapi", authMiddleware, async (c) => c.json({ ok: Boolean(c.env.RAPID_API_KEY) }));
app.get("/api/health/vision", authMiddleware, async (c) => c.json({ ok: false, deprecated: true }));

// -----------------------------
// SPA fallback (APENAS apÃƒÂ³s todas as rotas /api/* definidas)
// -----------------------------
app.get("*", async (c, next) => {
  // Se for rota API, passa adiante para as rotas definidas
  if (c.req.path.startsWith("/api")) {
    return next();
  }

  try {
    // c.req ÃƒÂ© um Request vÃƒÂ¡lido para passar ao binding ASSETS
    return await c.env.ASSETS.fetch(c.req.raw);
  } catch {
    // se falhar, passa para prÃƒÂ³ximos handlers (ou 404)
    return next();
  }
});

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "https://fitloot.vercel.app",
  "https://fitloot-worker.suportefitloot.workers.dev",
];

const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  "https://fitloot-*.vercel.app",
];

function wildcardPatternToRegExp(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed.includes("*")) return null;

  const escaped = trimmed
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp(`^${escaped}$`);
}

function buildAllowedOrigins(env: Env) {
  const configuredOrigins = [env.FRONTEND_ORIGIN, env.FRONTEND_ORIGINS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const exactOrigins = new Set<string>([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...configuredOrigins.filter((origin) => !origin.includes("*")),
  ]);
  const wildcardPatterns = [
    ...DEFAULT_ALLOWED_ORIGIN_PATTERNS,
    ...configuredOrigins.filter((origin) => origin.includes("*")),
  ]
    .map((pattern) => wildcardPatternToRegExp(pattern))
    .filter((pattern): pattern is RegExp => pattern !== null);

  return { exactOrigins, wildcardPatterns };
}

function resolveCorsOrigin(requestOrigin: string | undefined, env: Env) {
  const { exactOrigins, wildcardPatterns } = buildAllowedOrigins(env);

  if (!requestOrigin) {
    return null;
  }

  if (exactOrigins.has(requestOrigin)) {
    return requestOrigin;
  }

  return wildcardPatterns.some((pattern) => pattern.test(requestOrigin)) ? requestOrigin : null;
}

async function handleFetchWithGuard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    return await app.fetch(request, env, ctx);
  } catch (error) {
    console.error("[worker][fetch-guard]", {
      method: request.method,
      url: request.url,
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    const origin = resolveCorsOrigin(request.headers.get("Origin") ?? undefined, env);
    const allowHeaders = resolveCorsAllowHeaders(request.headers);
    const headers = new Headers({
      "Content-Type": "application/json",
    });
    applyCorsHeadersToResponseHeaders(headers, origin, allowHeaders);

    return new Response(
      JSON.stringify({
        error: "Erro interno",
        code: "INTERNAL_ERROR",
      }),
      {
        status: 500,
        headers,
      }
    );
  }
}

async function runScheduledWithGuard(event: ScheduledEvent, env: Env): Promise<void> {
  try {
    await processDailyReset(env);
  } catch (error) {
    console.error("[worker][scheduled-guard]", {
      cron: event.cron,
      scheduledTime: event.scheduledTime,
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

export default {
  fetch: handleFetchWithGuard,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runScheduledWithGuard(event, env).catch((error) => {
        console.error("[worker][scheduled][unhandled]", {
          message: getErrorMessage(error),
        });
      })
    );
  },
};

