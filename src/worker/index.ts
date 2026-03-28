import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  MiniGameChallengeRequestSchema,
  MiniGameCompleteRequestSchema,
  AuthRegisterRequestSchema,
  LoginRequestSchema,
  ConditioningLevel,
  MissionMetricType,
  CircuitTask,
  type PromoCodeEffect,
} from "../shared/types";
import {
  repairKnownMojibake,
  repairKnownMojibakeString,
} from "../shared/textEncoding";
import {
  variantSkillSeeds,
  PARENT_SKILL_MAP,
  type VariantSkillSeed,
} from "../shared/coreSkillSeeds";
import {
  listSupportedMissionExerciseNamesByMuscle,
  resolveExerciseDisplayNamePt,
  resolvePreferredExerciseDbId,
  resolveSupportedMissionExerciseName,
} from "../shared/exerciseCatalog";

const VARIANT_SEED_BY_NAME = new Map<string, VariantSkillSeed>(variantSkillSeeds.map((v) => [v.namePt, v]));
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
import { safeGet } from "../utils/typeHelpers";
import {
  ApiIntegrationError,
  callOpenAIChatWithFallback,
  enforceRateLimit,
  fetchJsonWithTimeout,
  fetchResponseWithTimeout,
  requestHuggingFaceStructuredContent,
  requestHuggingFaceVisionStructuredContent,
  timeoutMsByService,
  toFriendlyErrorResponse,
} from "./services/aiTransport";
import {
  buildTrackedCheckoutUrl,
  fetchCaktoOrderById,
  fetchLatestCaktoOrderByCustomer,
  parseCaktoWebhookPayload,
  type CaktoOrderSnapshot,
} from "./services/cakto";
import { enrichExercise, type EnrichedExercise } from "./services/exerciseEnrichment";
import {
  CAKTO_PLAN_CATALOG,
  CHECKOUT_PLAN_CATALOG,
  PLAN_GUARD_EXEMPT_PATHS,
  WEBHOOK_SUPPORTED_EVENTS,
} from "./core/constants";
import {
  databaseNotInitializedResponse,
  hasCoreSchema,
  hasTableColumn,
} from "./core/database";
import {
  createInvalidPromoCodeError,
  getErrorMessage,
} from "./core/errors";
import {
  getHuggingFaceApiKey,
} from "./core/providerConfig";
import type {
  AppContext,
  AuthUser,
  CaktoWebhookEventStatus,
  CheckoutPaymentMethod,
  CheckoutStartResult,
  Env,
  PlanId,
  PlanStatus,
  PromoApplyResult,
  PromoCodeRecord,
  PromoCodeUsageRecord,
  PromoValidationSuccess,
  PublicPlanId,
  SkillSeed,
  SkillStageSeed,
  SubscriptionEventLogEntry,
  SubscriptionMetadata,
  SubscriptionRecord,
  UserAuthRecord,
  UserPaymentMethod,
} from "./core/types";
import { registerFriendsRoutes } from "./routes/friends";
import { registerHealthRoutes } from "./routes/health";
import { registerMetricsRoutes } from "./routes/metrics";
import { registerProgressionRoutes } from "./routes/progression";
import { registerShopRoutes } from "./routes/shop";
import { registerAchievementRoutes } from "./routes/achievements";
import { registerAccountRoutes } from "./routes/account";
import { registerBillingRoutes } from "./routes/billing";
import { registerProfileRoutes } from "./routes/profile";
import { registerMissionRoutes } from "./routes/missions";
import { registerAiRoutes } from "./routes/ai";
import { createMissionGenerationService } from "./services/missionGeneration";
import { createBackgroundProcessingService } from "./services/backgroundProcessing";
import { createMissionPlanPersistenceService } from "./services/missionPlanPersistence";

let catalogInitCheckedAt = 0;
let catalogInitPromise: Promise<void> | null = null;
const STREAK_REFRESH_DEBOUNCE_MS = 60_000;
const STREAK_REFRESH_MAX_KEYS = 4_000;
/** Missoes nao-diarias com status terminal: remocao apos este intervalo. Diarias concluidas ficam ate o proximo dia (UTC). */
const SETTLED_MISSION_MAX_AGE_SQL_MODIFIER = "-2 minutes";
const streakRefreshLocks = new Map<string, Promise<void>>();
const streakRefreshLastRun = new Map<string, number>();
const CATALOG_CACHE_TTL_MS = 60_000;

const missionPlanPersistenceService = createMissionPlanPersistenceService({
  buildMissionCompatibilityTerms,
  buildMonthlyCounterMissionBlueprints: (profile, targetCount, options) =>
    buildMonthlyCounterMissionBlueprints(
      profile as MissionGenerationProfileSnapshot,
      targetCount,
      options,
    ),
  createMissionSubtasks,
  extractExerciseName,
  futureIsoForPeriod,
  getMonthlyCounters,
  hasTableColumn,
  invalidateMissionListCache,
  insertMission: (db, userId, period, deadline, mission, skillId) =>
    insertMission(db, userId, period, deadline, mission as unknown as MissionPayload, skillId),
  listCurrentCycleMissions,
  loadMissionGenerationProfile,
  loadMissionSubtasksByParentIds,
  mapWithConcurrency,
  materializeMissionBlueprint: (env, profile, blueprint) =>
    materializeMissionBlueprint(
      env,
      profile as MissionGenerationProfileSnapshot,
      blueprint as MissionBlueprint,
    ),
  materializationConcurrency: 3,
  mergeUniqueStrings: (values, maxLength) => mergeUniqueStrings(values, maxLength),
  metricUnitByType,
  missionConfigByPeriod,
  missionCycleStartIso,
  monthlyMissionProgressValue: (mission, monthlyCounters) =>
    monthlyMissionProgressValue(mission, monthlyCounters as MonthlyCounterSnapshot),
  normalizeDifficultyLabel: (value, fallback) =>
    normalizeDifficultyLabel(value, fallback as ConditioningLevel),
  normalizeMatchText,
  normalizeMissionMetricType,
  replaceMissionSubtasks,
  resolvePeriodicMissionBlueprints: (params) =>
    resolvePeriodicMissionBlueprints({
      ...params,
      drafts: params.drafts as readonly StructuredPeriodicMissionDraft[],
      fallbackDrafts: params.fallbackDrafts as readonly StructuredPeriodicMissionDraft[],
      dailyBlueprints: params.dailyBlueprints as readonly MissionBlueprint[],
      profile: params.profile as MissionGenerationProfileSnapshot,
    }),
  resolveSkillIdForExerciseMission,
  serializeTrainingPlanChatPreferences: (preferences) =>
    serializeTrainingPlanChatPreferences(
      preferences as TrainingPlanChatPreferences | null,
    ),
  stripMissionDisplayTitlePrefix,
  upsertTrainingPlan: (
    db,
    userId,
    plan,
    mainGoal,
    conditioning,
    equipment,
    injuries,
    trainingFrequency,
  ) =>
    upsertTrainingPlan(
      db,
      userId,
      plan,
      mainGoal,
      conditioning as ConditioningLevel,
      equipment,
      injuries,
      trainingFrequency,
    ),
  withTransaction,
});

const {
  generateStructuredMissionPlanForUser,
  ensurePeriodicMissions,
} = createMissionGenerationService({
  buildFallbackStructuredPlan,
  buildStructuredPlanPrompt,
  createMissionsForPeriod,
  ensureStructuredPeriodicMissionsFromExistingDailyBlueprints:
    missionPlanPersistenceService.ensureStructuredPeriodicMissionsFromExistingDailyBlueprints,
  getActiveCycleMissionCounts,
  listCurrentCycleMissions,
  loadMissionGenerationProfile,
  missionCycleStartIso,
  persistGeneratedMissionPlan: missionPlanPersistenceService.persistGeneratedMissionPlan,
  repairLegacyPeriodicMissions: missionPlanPersistenceService.repairLegacyPeriodicMissions,
  requestStructuredMissionPlanFromAI,
  validateStructuredMissionPlan,
});

const {
  runScheduledWithGuard,
} = createBackgroundProcessingService({
  cleanupSettledMissionsWithGuard,
  ensurePeriodicMissions,
  ensureUserCounterRow,
  expirePendingMissionsAndUpdateStreak,
});

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

// Middleware de autenticaÃ§Ã£o prÃ³prio
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
    message: "CÃ³digo promocional aplicado ao checkout.",
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
      return c.json({ error: "UsuÃ¡rio nÃ£o encontrado", code: "USER_NOT_FOUND" }, 404);
    }

    const hasUnlockedAccess =
      Number(userRecord.onboarding_completed) === 1 &&
      hasPlanAccess(userRecord.plan_id, userRecord.plan_status);

    if (!shouldBypassPlanGuard(c.req.path) && !hasUnlockedAccess) {
      const isPending = userRecord.plan_status === "pending";
      return c.json(
        {
          error: isPending
            ? "Pagamento em processamento. Aguarde a confirmaÃ§Ã£o para liberar o acesso."
            : "Pagamento nÃ£o aprovado. Atualize seu plano para liberar o acesso.",
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

    c.executionCtx.waitUntil(
      (async () => {
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
      })(),
    );

    c.executionCtx.waitUntil(
      (async () => {
        try {
          await ensureCaminhadaLeveUserSkill(c.env.fitloot_db, userRecord.id);
          await tryUnlockSkillsFromPerformance(c.env.fitloot_db, userRecord.id);
        } catch (e) {
          console.error("[authMiddleware][skillConsistency]", {
            userId: userRecord.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      })(),
    );

    await next();
  } catch (error) {
    console.error("[authMiddleware]", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
  }
}

const app = new Hono<AppContext>();

app.onError((error, c) => {
  console.error("[worker][unhandled]", {
    path: c.req.path,
    method: c.req.method,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  const origin = resolveCorsOrigin(c.req.header("Origin") ?? undefined, c.env);
  const allowHeaders = resolveCorsAllowHeaders(c.req.raw.headers);
  applyCorsHeadersToContext(c, origin, allowHeaders);
  return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
});

const localExercisePool: ExerciseRef[] = [
  { name: "Push-up", muscle: "chest", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Air Squat", muscle: "legs", equipment: "bodyweight", difficulty: "beginner" },
  { name: "High Plank", muscle: "core", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Glute Bridge", muscle: "glutes", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Burpee", muscle: "full body", equipment: "bodyweight", difficulty: "intermediate" },
  { name: "Pike Push-up", muscle: "shoulders", equipment: "bodyweight", difficulty: "intermediate" },
  { name: "Lunge", muscle: "legs", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Quarter Sit-up", muscle: "core", equipment: "bodyweight", difficulty: "beginner" },
];

const coreSkillSeeds: SkillSeed[] = [
  { name: "Flex\u00e3o", category: "peito", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Empurrar horizontal com peso corporal", unlockMessage: "Flex\u00e3o desbloqueada." },
  { name: "Agachamento", category: "pernas", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Base para for\u00e7a de membros inferiores", unlockMessage: "Agachamento desbloqueado." },
  { name: "Abdominal", category: "core", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Fortalecimento de core", unlockMessage: "Abdominal desbloqueado." },
  { name: "Prancha", category: "core", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Isometria de core", unlockMessage: "Prancha desbloqueada." },
  {
    name: "Caminhada leve",
    category: "cardio",
    difficulty: "basico",
    tier: "iniciante",
    requiredLevel: 1,
    description: "Volume de passos e cardio leve (base para condicionamento)",
    unlockMessage: "Caminhada leve desbloqueada.",
  },
  { name: "Barra Fixa", category: "costas", difficulty: "intermediario", tier: "intermediario", requiredLevel: 5, description: "Puxada vertical", unlockMessage: "Barra fixa dispon\u00edvel." },
  { name: "Dips", category: "triceps", difficulty: "intermediario", tier: "intermediario", requiredLevel: 7, description: "Empurrar em barras paralelas", unlockMessage: "Dips desbloqueado." },
  { name: "Handstand", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 6, description: "ProgressÃ£o de equilÃ­brio invertido", unlockMessage: "Inicie sua jornada no handstand.", prerequisites: ["Prancha"], attributeRequirements: { strength: 20, dexterity: 20 } },
  { name: "Front Lever", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 10, description: "Alavanca frontal", unlockMessage: "Front Lever desbloqueado.", prerequisites: ["Barra Fixa"], attributeRequirements: { strength: 30 } },
  { name: "Back Lever", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 10, description: "Alavanca posterior", unlockMessage: "Back Lever desbloqueado.", prerequisites: ["Barra Fixa"], attributeRequirements: { strength: 30 } },
  { name: "Planche", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 12, description: "SustentaÃ§Ã£o horizontal", unlockMessage: "Planche desbloqueada.", prerequisites: ["Dips"], attributeRequirements: { strength: 38 } },
  { name: "Human Flag", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 14, description: "Bandeira humana", unlockMessage: "Human Flag desbloqueada.", attributeRequirements: { strength: 42, dexterity: 30 } },
  { name: "Muscle Up", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 11, description: "TransiÃ§Ã£o de barra", unlockMessage: "Muscle Up desbloqueado.", prerequisites: ["Barra Fixa", "Dips"], attributeRequirements: { strength: 36 } },
  { name: "Pistol Squat", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 9, description: "Agachamento unilateral", unlockMessage: "Pistol Squat desbloqueado.", prerequisites: ["Agachamento"], attributeRequirements: { vitality: 28 } },
  { name: "Dragon Flag", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 13, description: "Core avanÃ§ado", unlockMessage: "Dragon Flag desbloqueada.", prerequisites: ["Abdominal"], attributeRequirements: { strength: 34, focus: 24 } },
  { name: "L-Sit", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 8, description: "SustentaÃ§Ã£o em L", unlockMessage: "L-Sit desbloqueado.", prerequisites: ["Prancha"], attributeRequirements: { strength: 24, focus: 18 } },
  { name: "Crow Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 6, description: "EquilÃ­brio em braÃ§os", unlockMessage: "Crow Pose desbloqueada.", attributeRequirements: { focus: 18, dexterity: 18 } },
  { name: "Headstand", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 8, description: "Invertida na cabeÃ§a", unlockMessage: "Headstand desbloqueada.", attributeRequirements: { strength: 22, focus: 22 } },
  { name: "Wheel Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 9, description: "Ponte avanÃ§ada", unlockMessage: "Wheel Pose desbloqueada.", attributeRequirements: { vitality: 20 } },
  { name: "Firefly Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 11, description: "EquilÃ­brio avanÃ§ado", unlockMessage: "Firefly Pose desbloqueada.", attributeRequirements: { strength: 28, focus: 22 } },
  { name: "Eight Angle Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 12, description: "TorÃ§Ã£o com braÃ§os", unlockMessage: "Eight Angle Pose desbloqueada.", attributeRequirements: { dexterity: 30, focus: 24 } },
  { name: "Scorpion Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 15, description: "Invertida avanÃ§ada", unlockMessage: "Scorpion Pose desbloqueada.", attributeRequirements: { strength: 35, dexterity: 32 } },
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
    description: `ProgressÃ£o ${idx + 1} de ${skillName}`,
    levelRequired: 4 + idx * 2 + idxSkill % 2,
    exerciseReference: name,
  })));

const titleSeeds = [
  { name: "Recruta", description: "Primeiros passos", reference: "RPG", unlock_condition: "level:1", rarity: "Comum" },
  { name: "Guerreiro do Core", description: "NÃ­vel 5", reference: "Calistenia", unlock_condition: "level:5", rarity: "Comum" },
  { name: "Veterano de Ferro", description: "NÃ­vel 10", reference: "MusculaÃ§Ã£o", unlock_condition: "level:10", rarity: "Incomum" },
  { name: "LÃ¢mina Afiada", description: "NÃ­vel 15", reference: "AÃ§Ã£o", unlock_condition: "level:15", rarity: "Raro" },
  { name: "Mestre do Peso Corporal", description: "NÃ­vel 20", reference: "Calistenia", unlock_condition: "level:20", rarity: "Raro" },
  { name: "O Ãšltimo de NÃ³s", description: "NÃ­vel 30", reference: "TLOU", unlock_condition: "level:30", rarity: "MÃ­tico" },
  { name: "LendÃ¡rio", description: "NÃ­vel 50", reference: "RPG", unlock_condition: "level:50", rarity: "MÃ­tico" },
  { name: "O Equilibrista", description: "Handstand completo", reference: "Calistenia", unlock_condition: "skill:Handstand:6", rarity: "Raro" },
  { name: "Acima de Todos", description: "Muscle Up completo", reference: "Calistenia", unlock_condition: "skill:Muscle Up:6", rarity: "Raro" },
  { name: "ForÃ§a Gravitacional", description: "Planche completa", reference: "Calistenia", unlock_condition: "skill:Planche:6", rarity: "MÃ­tico" },
  { name: "Bandeira Humana", description: "Human Flag completa", reference: "Calistenia", unlock_condition: "skill:Human Flag:6", rarity: "MÃ­tico" },
  { name: "Suspenso no Tempo", description: "Front Lever completo", reference: "Calistenia", unlock_condition: "skill:Front Lever:6", rarity: "Raro" },
  { name: "Shoto Style", description: "ReferÃªncia Street Fighter", reference: "Street Fighter", unlock_condition: "missions:120", rarity: "Incomum" },
  { name: "Iron Fist", description: "ReferÃªncia Tekken", reference: "Tekken", unlock_condition: "strength:80", rarity: "Raro" },
  { name: "King of Iron Body", description: "ReferÃªncia jogos de luta", reference: "Fighting Games", unlock_condition: "level:35", rarity: "MÃ­tico" },
  { name: "300", description: "300 treinos completados", reference: "Filme 300", unlock_condition: "missions:300", rarity: "MÃ­tico" },
  { name: "Rocky", description: "30 dias de streak", reference: "Rocky", unlock_condition: "streak:30", rarity: "Raro" },
  { name: "Predador", description: "CaÃ§a semanal concluÃ­da", reference: "Predador", unlock_condition: "weekly:1", rarity: "Incomum" },
  { name: "Chosen Undead", description: "Falhou e insistiu", reference: "Dark Souls", unlock_condition: "failures:10", rarity: "Secreto" },
  { name: "The Witcher", description: "Contrato semanal", reference: "The Witcher", unlock_condition: "weekly:5", rarity: "Raro" },
  { name: "Demon Slayer", description: "5 habilidades desbloqueadas", reference: "Anime", unlock_condition: "skills:5", rarity: "Raro" },
  { name: "Hollow", description: "Perdeu sequÃªncia 3x", reference: "Hollow Knight", unlock_condition: "streak_loss:3", rarity: "Secreto" },
];

const achievementSeeds = [
  { name: "Primeiro Passo", description: "Completar a primeira missÃ£o", category: "missoes", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "missions_completed>=1", icon: "", reference: "" },
  { name: "Aquecendo", description: "Completar 7 missÃµes", category: "missoes", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "missions_completed>=7", icon: "", reference: "" },
  { name: "Rotina Formada", description: "Completar 30 missÃµes", category: "missoes", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "missions_completed>=30", icon: "", reference: "" },
  { name: "Sem Desculpas", description: "5 dias seguidos", category: "missoes", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=5", icon: "", reference: "" },
  { name: "MÃ¡quina", description: "Completar 100 missÃµes", category: "missoes", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "missions_completed>=100", icon: "", reference: "" },
  { name: "ImparÃ¡vel", description: "30 dias consecutivos", category: "missoes", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=30", icon: "", reference: "" },
  { name: "Lenda Viva", description: "365 missÃµes", category: "missoes", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "missions_completed>=365", icon: "", reference: "" },
  { name: "Primeira Conversa", description: "Primeira mensagem no FitBot", category: "chat", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "chat_messages>=1", icon: "", reference: "" },
  { name: "Curioso", description: "50 perguntas ao FitBot", category: "chat", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "chat_messages>=50", icon: "", reference: "" },
  { name: "Aprendiz Dedicado", description: "200 interaÃ§Ãµes no chat", category: "chat", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "chat_messages>=200", icon: "", reference: "" },
  { name: "Eco", description: "CondiÃ§Ã£o secreta", category: "chat", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "repeat_message_streak>=5", icon: "", reference: "" },
  { name: "Na Disputa", description: "Entrar no top 100", category: "ranking", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "ranking<=100", icon: "", reference: "" },
  { name: "Elite", description: "Entrar no top 10", category: "ranking", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "ranking<=10", icon: "", reference: "" },
  { name: "O Escolhido", description: "AlcanÃ§ar #1", category: "ranking", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "ranking==1", icon: "", reference: "" },
  { name: "Ghost", description: "CondiÃ§Ã£o secreta", category: "ranking", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "top10_no_friends", icon: "", reference: "" },
  { name: "Primeiros Voos", description: "Primeira etapa do Handstand", category: "habilidades", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "skill_stage:Handstand>=1", icon: "", reference: "" },
  { name: "Mestre do EquilÃ­brio", description: "Handstand completo", category: "habilidades", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "skill_stage:Handstand>=6", icon: "", reference: "" },
  { name: "Kalista", description: "Todas as skills calistÃªnicas", category: "habilidades", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "all_calisthenics", icon: "", reference: "" },
  { name: "Jogador", description: "Primeiro minigame", category: "minigames", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "minigames_played>=1", icon: "", reference: "" },
  { name: "Competidor", description: "Vencer 10 minigames", category: "minigames", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "minigames_won>=10", icon: "", reference: "" },
  { name: "ImbatÃ­vel", description: "50 vitÃ³rias seguidas", category: "minigames", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "minigame_win_streak>=50", icon: "", reference: "" },
  { name: "Mestre ArtesÃ£o", description: "CondiÃ§Ã£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "craft_master", icon: "", reference: "Hollow Knight" },
  { name: "InsÃ´nia", description: "CondiÃ§Ã£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "mission_2am_4am", icon: "", reference: "" },
  { name: "Fantasma", description: "CondiÃ§Ã£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "open_gap6_complete_day7", icon: "", reference: "" },
  { name: "Conversa de Louco", description: "CondiÃ§Ã£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "chat_session_100", icon: "", reference: "" },
  { name: "Glitch", description: "CondiÃ§Ã£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "report_bug_chat", icon: "", reference: "" },
  { name: "Aquecendo o Motor", description: "3 dias seguidos", category: "streak", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "streak>=3", icon: "", reference: "" },
  { name: "Semana Completa", description: "7 dias seguidos", category: "streak", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "streak>=7", icon: "", reference: "" },
  { name: "Ritmo Certo", description: "14 dias seguidos", category: "streak", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=14", icon: "", reference: "" },
  { name: "Sem Parar", description: "21 dias seguidos", category: "streak", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=21", icon: "", reference: "" },
  { name: "MÃªs de Ferro", description: "30 dias seguidos", category: "streak", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=30", icon: "", reference: "" },
  { name: "Disciplina Absurda", description: "60 dias seguidos", category: "streak", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=60", icon: "", reference: "" },
  { name: "InabalÃ¡vel", description: "100 dias seguidos", category: "streak", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "streak>=100", icon: "", reference: "" },
  { name: "Um Ano de Dor", description: "365 dias seguidos", category: "streak", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "streak>=365", icon: "", reference: "" },
  { name: "Acontece", description: "Quebrar streak pela primeira vez", category: "streak_break", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "streak_break>=1", icon: "", reference: "" },
  { name: "Voltar Ã© DifÃ­cil", description: "Quebrar streak de 30+", category: "streak_break", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak_break>=30", icon: "", reference: "" },
  { name: "Tudo Ruiu", description: "Quebrar streak de 100+", category: "streak_break", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak_break>=100", icon: "", reference: "" },
  { name: "A Queda Ã‰pica", description: "Quebrar streak de 365+", category: "streak_break", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "streak_break>=365", icon: "", reference: "" },
  { name: "Tudo pela Streak", description: "Manter streak com 1 missÃ£o em 7 dias", category: "streak_minimal", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "minimal_streak>=7", icon: "", reference: "" },
  { name: "O Minimalista", description: "Manter streak com 1 missÃ£o em 30 dias", category: "streak_minimal", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "minimal_streak>=30", icon: "", reference: "" },
  { name: "Engenharia de Streak", description: "Manter streak com 1 missÃ£o em 100 dias", category: "streak_minimal", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "minimal_streak>=100", icon: "", reference: "" },
  { name: "A Arte da PreguiÃ§a", description: "CondiÃ§Ã£o secreta", category: "streak_minimal", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "single_mission_30", icon: "", reference: "" },
  { name: "De Volta ao Jogo", description: "Reconstruir para 7 dias", category: "streak_rebuild", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "rebuild>=7", icon: "", reference: "" },
  { name: "FÃªnix", description: "Quebrar 30+ e reconstruir 30+", category: "streak_rebuild", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "rebuild_from30", icon: "", reference: "" },
  { name: "Lenda Resiliente", description: "Quebrar 100+ e reconstruir 100+", category: "streak_rebuild", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "rebuild_from100", icon: "", reference: "" },
  { name: "Por um Fio", description: "Ãšltimos 5 minutos 5x", category: "timing", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "timing_last5m>=5", icon: "", reference: "" },
  { name: "Especialista em Timing", description: "Ãšltimos 5 minutos 20x", category: "timing", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "timing_last5m>=20", icon: "", reference: "" },
  { name: "MissÃ£o Ã s 23:59", description: "CondiÃ§Ã£o secreta", category: "timing", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "timing_2355_streak>=7", icon: "", reference: "" },
  { name: "404 Not Found", description: "CondiÃ§Ã£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "route_not_found", icon: "", reference: "" },
  { name: "Hoje NÃ£o", description: "Falhar 1 missÃ£o da meta", category: "meta_fail", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_fail>=1", icon: "", reference: "" },
  { name: "AmanhÃ£ Eu ComeÃ§o", description: "Falhar 3 missÃµes da meta em dias diferentes", category: "meta_fail", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_fail_days>=3", icon: "", reference: "" },
  { name: "Meta? Que Meta?", description: "Falhar 5 missÃµes da meta", category: "meta_fail", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_fail>=5", icon: "", reference: "" },
  { name: "Plano de Mentira", description: "Falhar 15 missÃµes da meta", category: "meta_fail", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_fail>=15", icon: "", reference: "" },
  { name: "Autobiotagem", description: "Falhar 30 missÃµes da meta", category: "meta_fail", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "goal_fail>=30", icon: "", reference: "" },
  { name: "Speedrun do Fracasso", description: "CondiÃ§Ã£o secreta", category: "meta_fail", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "goal_fail_7d", icon: "", reference: "" },
  { name: "No Caminho Certo", description: "7 missÃµes da meta concluÃ­das", category: "meta_done", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "goal_done>=7", icon: "", reference: "" },
  { name: "Focado", description: "30 missÃµes da meta concluÃ­das", category: "meta_done", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_done>=30", icon: "", reference: "" },
  { name: "Sem Desvios", description: "7 dias sem falhar missÃ£o da meta", category: "meta_done", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_nofail>=7", icon: "", reference: "" },
  { name: "Comprometido", description: "100 missÃµes da meta concluÃ­das", category: "meta_done", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_done>=100", icon: "", reference: "" },
  { name: "Olho no Alvo", description: "30 dias sem falhar missÃ£o da meta", category: "meta_done", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_nofail>=30", icon: "", reference: "" },
  { name: "ObsessÃ£o SaudÃ¡vel", description: "365 missÃµes da meta", category: "meta_done", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "goal_done>=365", icon: "", reference: "" },
  { name: "InabalÃ¡vel no PropÃ³sito", description: "100 dias sem falhar missÃ£o da meta", category: "meta_done", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "goal_nofail>=100", icon: "", reference: "" },
  { name: "A Meta era Essa?", description: "CondiÃ§Ã£o secreta", category: "meta_change", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "goal_return_30", icon: "", reference: "" },
  { name: "Primeiro Resultado", description: "10% da meta", category: "meta_progress", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "goal_progress>=10", icon: "", reference: "" },
  { name: "Meio Caminho", description: "50% da meta", category: "meta_progress", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_progress>=50", icon: "", reference: "" },
  { name: "Quase LÃ¡", description: "90% da meta", category: "meta_progress", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_progress>=90", icon: "", reference: "" },
  { name: "Meta Batida", description: "100% da meta", category: "meta_progress", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "goal_progress>=100", icon: "", reference: "" },
  { name: "AlÃ©m da Meta", description: "120% da meta", category: "meta_progress", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "goal_progress>=120", icon: "", reference: "" },
  { name: "Overachiever", description: "CondiÃ§Ã£o secreta", category: "meta_progress", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "goal_half_time", icon: "", reference: "" },
  { name: "Novo CapÃ­tulo", description: "Primeira troca de meta", category: "meta_change", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_change>=1", icon: "", reference: "" },
  { name: "Indefinido", description: "3 trocas de meta", category: "meta_change", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_change>=3", icon: "", reference: "" },
  { name: "A Jornada Ã© o Destino", description: "CondiÃ§Ã£o secreta", category: "meta_change", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "all_goals_done", icon: "", reference: "" },
  { name: "Dupla AmeaÃ§a", description: "Streak 30 + meta perfeita", category: "meta_combo", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "combo30", icon: "", reference: "" },
  { name: "MÃ¡quina de Resultados", description: "Streak 100 + meta perfeita", category: "meta_combo", rarity: "MÃ­tico", color: "#EF4444", secret: 0, condition: "combo100", icon: "", reference: "" },
  { name: "PerfeiÃ§Ã£o", description: "CondiÃ§Ã£o secreta", category: "meta_combo", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "combo30_all", icon: "", reference: "" },
];

function conditioningOrder(level: ConditioningLevel): number {
  return { sedentario: 0, iniciante: 1, intermediario: 2, avancado: 3 }[level] ?? 0;
}

function skillTierOrder(tier: string): number {
  return { iniciante: 1, intermediario: 2, avancado: 3, calistenico: 4 }[tier as keyof Record<string, number>] ?? 1;
}

const VARIANT_CATEGORY_BY_PARENT: Record<string, string> = {
  FlexÃµes: "peito",
  Agachamentos: "pernas",
  Pranchas: "core",
  Abdominais: "core",
};

const PERFORMANCE_ONLY_LEVEL = 999;

async function ensureGamificationCatalog(db: D1Database) {
  for (const skill of coreSkillSeeds) {
    await db.prepare(`INSERT INTO skills (name, category, difficulty, description, calories_per_rep, strength_gain, constitution_gain, vitality_gain, dexterity_gain, focus_gain, required_level, tier, level_required, prerequisites, attribute_requirements, unlock_message, updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM skills WHERE name = ?)`)
      .bind(skill.name, skill.category, skill.difficulty, skill.description, 0.5, 1, 1, 1, 1, 1, skill.requiredLevel, skill.tier, skill.requiredLevel, JSON.stringify(skill.prerequisites ?? []), JSON.stringify(skill.attributeRequirements ?? {}), skill.unlockMessage, skill.name)
      .run();
  }

  for (const v of variantSkillSeeds) {
    const parentName = PARENT_SKILL_MAP[v.parentSkill] ?? v.parentSkill;
    const category = VARIANT_CATEGORY_BY_PARENT[v.parentSkill] ?? "core";
    const prereqs = JSON.stringify([parentName]);
    const unlockMsg = `${v.namePt} desbloqueada(o).`;
    await db.prepare(`INSERT INTO skills (name, category, difficulty, description, calories_per_rep, strength_gain, constitution_gain, vitality_gain, dexterity_gain, focus_gain, required_level, tier, level_required, prerequisites, attribute_requirements, unlock_message, updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM skills WHERE name = ?)`)
      .bind(v.namePt, category, "intermediario", `Variante de ${parentName}`, 0.5, 1, 1, 1, 1, 1, PERFORMANCE_ONLY_LEVEL, "intermediario", PERFORMANCE_ONLY_LEVEL, prereqs, "{}", unlockMsg, v.namePt)
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

async function ensureUserAttributesRow(db: D1Database, userId: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO user_attributes (user_id, strength, constitution, vitality, dexterity, focus, updated_at)
     VALUES (?, 0, 0, 0, 0, 0, datetime('now'))`,
  ).bind(userId).run();
}

async function ensureCaminhadaLeveUserSkill(db: D1Database, userId: string): Promise<void> {
  const skill = await db.prepare("SELECT id FROM skills WHERE name = ?").bind("Caminhada leve").first<{ id: number }>();
  if (!skill?.id) return;
  await db.prepare(`INSERT OR IGNORE INTO user_skills (user_id, skill_id, status, current_stage, total_reps, total_time, best_reps, unlocked_at, updated_at)
    VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`).bind(userId, skill.id).run();
}

async function cleanupSettledMissions(db: D1Database, userId: string): Promise<void> {
  await db.prepare(
    `DELETE FROM missions
      WHERE user_id = ?
        AND (
          (
            COALESCE(status, 'pending') IN ('expired', 'failed')
            AND datetime(updated_at) < datetime('now', '${SETTLED_MISSION_MAX_AGE_SQL_MODIFIER}')
          )
          OR (
            COALESCE(status, 'pending') = 'completed'
            AND (
              (type = 'daily' AND date(COALESCE(completed_at, updated_at)) < date('now'))
              OR (type != 'daily' AND datetime(updated_at) < datetime('now', '${SETTLED_MISSION_MAX_AGE_SQL_MODIFIER}'))
            )
          )
        )`
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
    await db.prepare("UPDATE missions SET status = 'expired', updated_at = datetime('now') WHERE id = ?").bind(mission.id).run();
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
  if (missionsCompleted >= 100) await unlockAchievementIfNeeded(db, userId, "MÃ¡quina", missionsCompleted, 100);
  if (missionsCompleted >= 365) await unlockAchievementIfNeeded(db, userId, "Lenda Viva", missionsCompleted, 365);
  if (consecutiveDays >= 5) await unlockAchievementIfNeeded(db, userId, "Sem Desculpas", consecutiveDays, 5);
  if (consecutiveDays >= 30) {
    await unlockAchievementIfNeeded(db, userId, "ImparÃ¡vel", consecutiveDays, 30);
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
    [1, "Recruta"], [5, "Guerreiro do Core"], [10, "Veterano de Ferro"], [15, "LÃ¢mina Afiada"],
    [20, "Mestre do Peso Corporal"], [30, "O Ãšltimo de NÃ³s"], [50, "LendÃ¡rio"],
  ];
  for (const [threshold, name] of byLevel) {
    if (level >= threshold) await unlockTitleIfNeeded(db, userId, name);
  }
}

async function onStreakContinued(db: D1Database, userId: string, streakDays: number, missionsCompletedToday: number, lastMissionDate?: string | undefined) {
  await logUserEvent(db, userId, "onStreakContinued", { streakDays, missionsCompletedToday });

  const milestones: Array<[number, string]> = [
    [3, "Aquecendo o Motor"], [7, "Semana Completa"], [14, "Ritmo Certo"], [21, "Sem Parar"],
    [30, "MÃªs de Ferro"], [60, "Disciplina Absurda"], [100, "InabalÃ¡vel"], [365, "Um Ano de Dor"],
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
  if (singleStreak >= 30) await unlockAchievementIfNeeded(db, userId, "A Arte da PreguiÃ§a", singleStreak, 30);

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
      if (Number(t?.timing_2355_streak ?? 0) >= 7) await unlockAchievementIfNeeded(db, userId, "MissÃ£o Ã s 23:59", Number(t?.timing_2355_streak ?? 0), 7);
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
  if (streakDaysBefore >= 30) await unlockAchievementIfNeeded(db, userId, "Voltar Ã© DifÃ­cil", streakDaysBefore, 30);
  if (streakDaysBefore >= 100) await unlockAchievementIfNeeded(db, userId, "Tudo Ruiu", streakDaysBefore, 100);
  if (streakDaysBefore >= 365) await unlockAchievementIfNeeded(db, userId, "A Queda Ã‰pica", streakDaysBefore, 365);
}

async function onStreakRebuilt(db: D1Database, userId: string, newStreakDays: number, previousBestStreak: number) {
  await logUserEvent(db, userId, "onStreakRebuilt", { newStreakDays, previousBestStreak });
  if (newStreakDays >= 7) await unlockAchievementIfNeeded(db, userId, "De Volta ao Jogo", newStreakDays, 7);
  if (previousBestStreak >= 30 && newStreakDays >= 30) await unlockAchievementIfNeeded(db, userId, "FÃªnix", newStreakDays, 30);
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
  if (failCount >= 1) await unlockAchievementIfNeeded(db, userId, 'Hoje NÃ£o', failCount, 1);
  if (distinctDays >= 3) await unlockAchievementIfNeeded(db, userId, 'AmanhÃ£ Eu ComeÃ§o', distinctDays, 3);
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
  if (completedCount >= 365) await unlockAchievementIfNeeded(db, userId, 'ObsessÃ£o SaudÃ¡vel', completedCount, 365);
  if (consecutiveDays >= 7) await unlockAchievementIfNeeded(db, userId, 'Sem Desvios', consecutiveDays, 7);
  if (consecutiveDays >= 30) await unlockAchievementIfNeeded(db, userId, 'Olho no Alvo', consecutiveDays, 30);
  if (noFailStreak >= 100) await unlockAchievementIfNeeded(db, userId, 'InabalÃ¡vel no PropÃ³sito', noFailStreak, 100);

  const streak = await db.prepare("SELECT current_streak FROM user_progression WHERE user_id = ?").bind(userId).first<{ current_streak: number }>();
  if (Number(streak?.current_streak ?? 0) >= 30 && noFailStreak >= 30) await unlockAchievementIfNeeded(db, userId, 'Dupla AmeaÃ§a', 30, 30);
  if (Number(streak?.current_streak ?? 0) >= 100 && noFailStreak >= 100) await unlockAchievementIfNeeded(db, userId, 'MÃ¡quina de Resultados', 100, 100);
}

async function onGoalProgress(db: D1Database, userId: string, progressPercent: number) {
  await logUserEvent(db, userId, 'onGoalProgress', { progressPercent });
  if (progressPercent >= 10) await unlockAchievementIfNeeded(db, userId, 'Primeiro Resultado', progressPercent, 10);
  if (progressPercent >= 50) await unlockAchievementIfNeeded(db, userId, 'Meio Caminho', progressPercent, 50);
  if (progressPercent >= 90) await unlockAchievementIfNeeded(db, userId, 'Quase LÃ¡', progressPercent, 90);
  if (progressPercent >= 100) await unlockAchievementIfNeeded(db, userId, 'Meta Batida', progressPercent, 100);
  if (progressPercent >= 120) await unlockAchievementIfNeeded(db, userId, 'AlÃ©m da Meta', progressPercent, 120);
}

async function onGoalChanged(db: D1Database, userId: string, oldGoal: string, newGoal: string, changeCount: number) {
  await logUserEvent(db, userId, 'onGoalChanged', { oldGoal, newGoal, changeCount });
  if (changeCount >= 1) await unlockAchievementIfNeeded(db, userId, 'Novo CapÃ­tulo', changeCount, 1);
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
    await unlockAchievementIfNeeded(db, userId, "InsÃ´nia", 1, 1);
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
    quarta: { focus: "active_recovery", muscles: ["full body", "core"], intensity: "leve" },
    quinta: { focus: "pull", muscles: ["back", "biceps", "core"], intensity: "moderada" },
    sexta: { focus: mainGoal === "calistenia" ? "skill" : "conditioning", muscles: ["full body"], intensity: "moderada" },
    sabado: { focus: "conditioning", muscles: ["full body", "core"], intensity: "moderada" },
    domingo: { focus: restDay === "domingo" ? "rest" : "optional", muscles: ["walk", "stretching"], intensity: "leve" },
  };

  return {
    goal: mainGoal ?? "saude_geral",
    conditioning,
    equipment: equipment ?? "",
    injuries: injuries ?? "",
    rest_days: [restDay],
    weekly,
    progression: "Primeiras 4 semanas com progressÃ£o linear de volume e tÃ©cnica.",
  };
}

type TrainingPlanChatPreferences = {
  planFocus: string | null;
  routineStyle: string | null;
  summary: string | null;
  constraints: string[];
  userRequest: string | null;
  updatedAt: string;
};

function parseStoredPlanRecord(rawValue: unknown): Record<string, unknown> | null {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeOptionalPlanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePlanConstraintList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 6);
}

function normalizeTrainingPlanChatPreferences(value: unknown): TrainingPlanChatPreferences | null {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
  if (!source) return null;

  const planFocus = normalizeOptionalPlanText(source.plan_focus ?? source.planFocus);
  const routineStyle = normalizeOptionalPlanText(source.routine_style ?? source.routineStyle);
  const summary = normalizeOptionalPlanText(source.summary ?? source.adjustment_summary ?? source.adjustmentSummary);
  const constraints = normalizePlanConstraintList(source.constraints);
  const userRequest = normalizeOptionalPlanText(source.user_request ?? source.userRequest);
  const updatedAt = normalizeOptionalPlanText(source.updated_at ?? source.updatedAt) ?? new Date().toISOString();

  if (!planFocus && !routineStyle && !summary && constraints.length === 0 && !userRequest) {
    return null;
  }

  return {
    planFocus,
    routineStyle,
    summary,
    constraints,
    userRequest,
    updatedAt,
  };
}

function serializeTrainingPlanChatPreferences(preferences: TrainingPlanChatPreferences | null): Record<string, unknown> | null {
  if (!preferences) return null;
  return {
    plan_focus: preferences.planFocus,
    routine_style: preferences.routineStyle,
    summary: preferences.summary,
    constraints: preferences.constraints,
    user_request: preferences.userRequest,
    updated_at: preferences.updatedAt,
  };
}

function summarizeTrainingPlanChatPreferences(preferences: TrainingPlanChatPreferences | null): string {
  if (!preferences) return "";

  const parts = [
    preferences.summary,
    preferences.planFocus ? `foco: ${preferences.planFocus}` : "",
    preferences.routineStyle ? `estilo: ${preferences.routineStyle}` : "",
    preferences.constraints.length > 0 ? `diretrizes: ${preferences.constraints.join(", ")}` : "",
  ]
    .map((item) => item?.trim() ?? "")
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);

  return parts.join(" | ");
}

function trainingPlanChatPreferencesHash(preferences: TrainingPlanChatPreferences | null): string {
  return summarizeTrainingPlanChatPreferences(preferences)
    .split("|")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .join("|");
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
  const existingRow = await db.prepare("SELECT weekly_plan_json FROM user_training_plans WHERE user_id = ?")
    .bind(userId)
    .first<{ weekly_plan_json: string | null }>();
  const existingPlan = parseStoredPlanRecord(existingRow?.weekly_plan_json);
  const existingPreferences = normalizeTrainingPlanChatPreferences(existingPlan?.chat_preferences);
  const hasIncomingPreferences = Object.prototype.hasOwnProperty.call(plan, "chat_preferences");
  const incomingPreferences = normalizeTrainingPlanChatPreferences(plan.chat_preferences);
  const planToStore: Record<string, unknown> = { ...plan };

  if (hasIncomingPreferences) {
    if (incomingPreferences) {
      planToStore.chat_preferences = serializeTrainingPlanChatPreferences(incomingPreferences);
    } else {
      delete planToStore.chat_preferences;
    }
  } else if (existingPreferences) {
    planToStore.chat_preferences = serializeTrainingPlanChatPreferences(existingPreferences);
  }

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
      JSON.stringify(planToStore),
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

/** Desbloqueia variantes quando o parent atinge o threshold (reps ou tempo). */
async function tryUnlockSkillsFromPerformance(db: D1Database, userId: string): Promise<void> {
  const profile = await db.prepare("SELECT initial_conditioning FROM user_profiles WHERE user_id = ?").bind(userId).first<{ initial_conditioning: string }>();
  const conditioning = (profile?.initial_conditioning ?? "iniciante") as ConditioningLevel;
  const maxTier = conditioningOrder(conditioning) + 1;

  for (const v of variantSkillSeeds) {
    const parentName = PARENT_SKILL_MAP[v.parentSkill] ?? v.parentSkill;
    const [parentSkill, childSkill, hasChild] = await Promise.all([
      db.prepare("SELECT id FROM skills WHERE name = ?").bind(parentName).first<{ id: number }>(),
      db.prepare("SELECT id, tier FROM skills WHERE name = ?").bind(v.namePt).first<{ id: number; tier: string }>(),
      db.prepare("SELECT 1 FROM user_skills us INNER JOIN skills s ON s.id = us.skill_id WHERE us.user_id = ? AND s.name = ?").bind(userId, v.namePt).first(),
    ]);
    if (!parentSkill?.id || !childSkill?.id || hasChild) continue;
    if (skillTierOrder(childSkill.tier) > maxTier) continue;

    const parentStats = await db.prepare(
      "SELECT best_reps, total_reps, total_time FROM user_skills WHERE user_id = ? AND skill_id = ?"
    ).bind(userId, parentSkill.id).first<{ best_reps: number; total_reps: number; total_time: number }>();
    if (!parentStats) continue;

    const th = v.threshold;
    const meetsThreshold = v.thresholdType === "reps"
      ? (Number(parentStats.best_reps ?? 0) >= th || Number(parentStats.total_reps ?? 0) >= th)
      : Number(parentStats.total_time ?? 0) >= th;
    if (!meetsThreshold) continue;

    const result = await db.prepare(`INSERT OR IGNORE INTO user_skills (user_id, skill_id, status, current_stage, total_reps, total_time, best_reps, unlocked_at, updated_at)
      VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`).bind(userId, childSkill.id).run();
    if (result.meta.changes > 0) {
      await db.prepare(`UPDATE user_event_counters SET skills_unlocked = COALESCE(skills_unlocked,0)+1, updated_at=datetime('now') WHERE user_id = ?`).bind(userId).run();
      await onSkillUnlocked(db, userId, childSkill.id);
    }
  }
}

/** XP para completar o nÃ­vel atual e avanÃ§ar (barra cheia). Igual ao front: `Math.max(100, level * 100)`. */
function xpRequiredToAdvanceFromLevel(level: number): number {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  return Math.max(100, L * 100);
}

function parseProgressionXpLevel(row: { xp?: unknown; level?: unknown } | null | undefined): { xp: number; level: number } {
  const level = Math.max(1, Math.floor(Number(row?.level ?? 1)));
  const xp = Math.max(0, Math.floor(Number(row?.xp ?? 0)));
  return { xp, level };
}

/** Aplica ganho de XP e resolve todos os level-ups (evita depender de SELECT pÃ³s-UPDATE no D1 e permite vÃ¡rios nÃ­veis de uma vez). */
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
 * LÃª progression, soma XP/pontos, aplica todas as subidas de nÃ­vel de uma vez e dispara hooks por nÃ­vel.
 * Usar em qualquer fluxo que conceda XP (missÃ£o, circuito, mensal, minigame).
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
  const createCorsResponse = (
    body: BodyInit | null,
    init: ResponseInit,
    responseOrigin: string | null = origin
  ) => {
    const headers = new Headers(init.headers);
    applyCorsHeadersToResponseHeaders(headers, responseOrigin, allowHeaders);
    return new Response(body, {
      ...init,
      headers,
    });
  };

  if (requestOrigin && !origin) {
    if (c.req.method === "OPTIONS") {
      return createCorsResponse("", {
        status: 403,
      });
    }

    return createCorsResponse(
      JSON.stringify({
        error: "Origin nÃ£o permitida",
        code: "ORIGIN_NOT_ALLOWED",
      }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
        },
      },
      null
    );
  }

  applyCorsHeadersToContext(c, origin, allowHeaders);

  if (c.req.method === "OPTIONS") {
    return createCorsResponse("", {
      status: 204,
    });
  }

  await next();
  applyCorsHeadersToResponseHeaders(c.res.headers, origin, allowHeaders);
});

// Helper: Gera cookie com configuraÃ§Ãµes corretas
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
      message: "CÃ³digo promocional aplicado. Seu acesso VIP foi liberado.",
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
    message: "Pagamento iniciado. Aguarde a confirmaÃ§Ã£o para liberar o acesso.",
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
        return c.json({ error: "E-mail jÃ¡ cadastrado" }, 409);
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
        { error: "Erro interno ao criar usuÃ¡rio", code: "INTERNAL_ERROR" },
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
      message: "Informe email e/ou username para validaÃ§Ã£o.",
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
      return c.json({ error: "Credenciais invÃ¡lidas" }, 401);
    }

    const computed = await hashPassword(data.password, userRow.password_salt);
    if (computed !== userRow.password_hash) {
      return c.json({ error: "Credenciais invÃ¡lidas" }, 401);
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

registerAccountRoutes(app, {
  authMiddleware,
  generateExpiredSessionCookie,
  getSessionIdFromCookieHeader,
  getUserAuthRecordById,
  logUserEvent,
  onAppOpen,
  onProfileCustomization,
  shouldPurgeUserOnLogout,
  unlockAchievementIfNeeded,
});

registerBillingRoutes(app, {
  authMiddleware,
  applyPromoCodeForUser,
  getLatestSubscriptionByUser,
  getUserAuthRecordById,
  hasPlanAccess,
  matchesVipActivationCode,
  normalizePlanStatus,
  normalizePromoCodeValue,
  normalizePublicPlanIdFromValue,
  normalizeUserPaymentMethod,
  processCaktoWebhook,
  resolveCheckoutAmount,
  resolveCheckoutProductId,
  resolveCheckoutUrl,
  startCheckoutForUser,
  validatePromoCodeRecord,
  withTransaction,
});

registerProfileRoutes(app, {
  authMiddleware,
  buildInitialTrainingPlan,
  conditioningOrder,
  createMissionsForPeriod,
  ensureGamificationCatalog,
  ensureGoalStatsRow,
  ensurePeriodicMissions,
  ensureUserCounterRow,
  evaluateLevelTitles,
  fetchResponseWithTimeout,
  invalidateMissionListCache,
  logUserEvent,
  missionCycleStartIso,
  normalizeConditioning,
  normalizeTrainingFrequencyInput,
  onGoalChanged,
  onProfileCustomization,
  startCheckoutForUser,
  skillTierOrder,
  unlockAchievementIfNeeded,
  upsertTrainingPlan,
  withTransaction,
});

// Progression endpoints
registerProgressionRoutes(app, {
  authMiddleware,
  applyXpPointsAndResolveLevels,
  computeXpAndLevelAfterGain,
  parseProgressionXpLevel,
  unlockAchievementIfNeeded,
  unlockTitleIfNeeded,
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
  exercise_db_id: string | null;
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
    exercise_name: typeof rawMission.exercise_name === "string"
      ? (
        resolveExerciseDisplayNamePt(rawMission.exercise_name)
        ?? localizeMissionText(rawMission.exercise_name)
        ?? rawMission.exercise_name
      )
      : null,
    exercise_db_id: typeof rawMission.exercise_db_id === "string" && rawMission.exercise_db_id.trim().length > 0
      ? rawMission.exercise_db_id.trim()
      : null,
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
  const canonicalTitle = resolveExerciseDisplayNamePt(stripped) ?? stripped;
  return canonicalTitle.length > 0 ? canonicalTitle : localized.trim();
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

  if (normalizedTitle.includes("passos do mes")) {
    return `${formatIntegerPtBr(target)} passos acumulados`;
  }

  if (normalizedTitle.includes("distancia mensal")) {
    if (metricType === "distance_meters") {
      const kilometers = target / 1000;
      return `${kilometers.toLocaleString("pt-BR", {
        minimumFractionDigits: kilometers % 1 === 0 ? 0 : 1,
        maximumFractionDigits: 1,
      })} km acumulados`;
    }
    return `${formatIntegerPtBr(target)} passos acumulados`;
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
    if (metricType === "distance_meters") {
      const kilometers = target / 1000;
      return `${kilometers.toLocaleString("pt-BR", {
        minimumFractionDigits: kilometers % 1 === 0 ? 0 : 1,
        maximumFractionDigits: 1,
      })} km acumulados`;
    }
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
  const goal = normalizeMatchText(String(mission.goal ?? ""));
  const metricType = normalizeMissionMetricType(mission.metric_type, mission.target_time);
  if (title.includes("circuitos semanais")) return counters.weekly_circuits_completed;
  if (title.includes("dias ativos") || title.includes("streak") || title.includes("pratica ativa")) return counters.streak_days;
  if (metricType === "distance_meters" || goal.includes(" km") || goal.includes("metros acumulados")) {
    return Math.max(0, Math.round(counters.distance_meters));
  }
  if (metricType === "steps" || title.includes("passos") || goal.includes("passos acumulados")) {
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
  const [hasMetricTypeColumn, hasMetricValueColumn] = await Promise.all([
    hasTableColumn(db, "missions", "metric_type"),
    hasTableColumn(db, "missions", "metric_value"),
  ]);
  const metricTypeSql = hasMetricTypeColumn ? "metric_type" : "NULL";
  const metricValueSql = hasMetricValueColumn ? "metric_value" : "NULL";
  const aggregate = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN is_completed = 1 AND type = 'daily' THEN 1 ELSE 0 END), 0) as missions_completed,
       COALESCE(SUM(
         CASE
           WHEN is_completed = 1 AND type = 'daily' AND ${metricTypeSql} = 'distance_meters' THEN COALESCE(${metricValueSql}, target_reps, target_time, 0)
           WHEN is_completed = 1 AND type = 'daily' AND ${metricTypeSql} = 'steps' THEN CAST(COALESCE(${metricValueSql}, target_reps, 0) * 0.75 AS INTEGER)
           ELSE 0
         END
       ), 0) as distance_meters,
       COALESCE(COUNT(DISTINCT CASE WHEN is_completed = 1 AND type = 'daily' THEN date(completed_at) END), 0) as streak_days,
       COALESCE(SUM(CASE WHEN is_completed = 1 AND type = 'weekly' AND ${metricTypeSql} = 'circuit_tasks' THEN 1 ELSE 0 END), 0) as weekly_circuits_completed
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
  const hasProgressValueColumn = await hasTableColumn(db, "missions", "progress_value");
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
    if (hasProgressValueColumn) {
      await db.prepare(
        `UPDATE missions
           SET progress_value = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(Math.min(target, progress), mission.id).run();
    }
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
const PERIODIC_PROGRESS_RECOMPUTE_DEBOUNCE_MS = 15_000;
const MISSION_REFRESH_TRACK_TTL_MS = 24 * 60 * 60 * 1000;
const MISSION_REFRESH_TRACK_MAX_KEYS = 3_000;
const MISSION_REFRESH_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const DAILY_METADATA_REPAIR_DEBOUNCE_MS = 60_000;

const missionListCache = new Map<string, MissionListCacheEntry>();
const missionRefreshLocks = new Map<string, Promise<void>>();
const missionRefreshLastRun = new Map<string, number>();
const periodicProgressRecomputeLocks = new Map<string, Promise<void>>();
const periodicProgressRecomputeLastRun = new Map<string, number>();
const dailyMetadataRepairLocks = new Map<string, Promise<void>>();
const dailyMetadataRepairLastRun = new Map<string, number>();
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

function cleanupPeriodicProgressTracking(now: number): void {
  for (const [trackedUserId, lastRun] of periodicProgressRecomputeLastRun.entries()) {
    if (now - lastRun > MISSION_REFRESH_TRACK_TTL_MS) {
      periodicProgressRecomputeLastRun.delete(trackedUserId);
    }
  }

  if (periodicProgressRecomputeLastRun.size > MISSION_REFRESH_TRACK_MAX_KEYS) {
    const overflow = periodicProgressRecomputeLastRun.size - MISSION_REFRESH_TRACK_MAX_KEYS;
    const iterator = periodicProgressRecomputeLastRun.keys();
    for (let index = 0; index < overflow; index += 1) {
      const nextKey = iterator.next().value;
      if (typeof nextKey === "string") {
        periodicProgressRecomputeLastRun.delete(nextKey);
      }
    }
  }
}

function shouldDebounceMissionRefresh(userId: string, now: number): boolean {
  const lastRun = missionRefreshLastRun.get(userId) ?? 0;
  return now - lastRun < MISSION_REFRESH_DEBOUNCE_MS;
}

function shouldDebouncePeriodicProgressRecompute(userId: string, now: number): boolean {
  const lastRun = periodicProgressRecomputeLastRun.get(userId) ?? 0;
  return now - lastRun < PERIODIC_PROGRESS_RECOMPUTE_DEBOUNCE_MS;
}

function createPeriodicProgressRecomputePromise(userId: string, db: D1Database): Promise<void> {
  const inflight = periodicProgressRecomputeLocks.get(userId);
  if (inflight) {
    return inflight;
  }

  const recomputePromise = (async () => {
    try {
      await recomputeActivePeriodicMissionProgress(userId, db);
      clearMissionListCache(userId);
      periodicProgressRecomputeLastRun.set(userId, Date.now());
    } finally {
      periodicProgressRecomputeLocks.delete(userId);
    }
  })();

  periodicProgressRecomputeLocks.set(userId, recomputePromise);
  return recomputePromise;
}

function schedulePeriodicProgressRecomputeWithGuard(
  userId: string,
  db: D1Database,
  executionCtx: ExecutionContext,
): boolean {
  const now = Date.now();
  cleanupPeriodicProgressTracking(now);
  if (shouldDebouncePeriodicProgressRecompute(userId, now) || periodicProgressRecomputeLocks.has(userId)) {
    return false;
  }

  const recomputePromise = createPeriodicProgressRecomputePromise(userId, db);
  executionCtx.waitUntil(
    recomputePromise.catch((error) => {
      console.error("[missions][background-periodic-progress]", {
        userId,
        message: getErrorMessage(error),
      });
    }),
  );
  return true;
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

type MissionRefreshMode = "safe" | "full";

function createMissionRefreshPromise(
  env: Env,
  db: D1Database,
  userId: string,
  mode: MissionRefreshMode = "safe",
): Promise<void> {
  const inflight = missionRefreshLocks.get(userId);
  if (inflight) {
    return inflight;
  }

  const refreshPromise = (async () => {
    try {
      await runMissionRefreshStepSafely(userId, "repair_legacy_periodic", () =>
        missionPlanPersistenceService.repairLegacyPeriodicMissions(env, db, userId),
      );
      if (mode === "full") {
        await runMissionRefreshStepSafely(userId, "ensure_periodic", () =>
          ensurePeriodicMissions(env, db, userId),
        );
        await runMissionRefreshStepSafely(userId, "repair_legacy_daily_metadata", () =>
          repairLegacyDailyMissionMetadata(env, db, userId),
        );
      }
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
  options?: { force?: boolean | undefined; mode?: MissionRefreshMode | undefined },
): Promise<void> {
  const mode = options?.mode ?? "safe";
  if (options?.force === true) {
    await createMissionRefreshPromise(env, db, userId, mode);
    return;
  }

  const now = Date.now();
  cleanupMissionRefreshTracking(now);
  if (shouldDebounceMissionRefresh(userId, now)) {
    return;
  }

  await createMissionRefreshPromise(env, db, userId, mode);
}

function schedulePeriodicMissionsRefreshWithGuard(
  env: Env,
  db: D1Database,
  userId: string,
  executionCtx: ExecutionContext,
  mode: MissionRefreshMode = "safe",
): boolean {
  const now = Date.now();
  cleanupMissionRefreshTracking(now);
  if (shouldDebounceMissionRefresh(userId, now) || missionRefreshLocks.has(userId)) {
    return false;
  }

  const refreshPromise = createMissionRefreshPromise(env, db, userId, mode);
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

function scheduleLegacyDailyMetadataRepairWithGuard(
  env: Env,
  db: D1Database,
  userId: string,
  executionCtx: ExecutionContext,
): boolean {
  const now = Date.now();
  const lastRun = dailyMetadataRepairLastRun.get(userId) ?? 0;
  if (now - lastRun < DAILY_METADATA_REPAIR_DEBOUNCE_MS) {
    return false;
  }

  const inflight = dailyMetadataRepairLocks.get(userId);
  if (inflight) {
    return false;
  }

  const repairPromise = (async () => {
    try {
      await repairLegacyDailyMissionMetadata(env, db, userId, { limit: 4 });
      clearMissionListCache(userId);
      dailyMetadataRepairLastRun.set(userId, Date.now());
    } catch (error) {
      console.error("[missions][legacy-daily-repair]", {
        userId,
        message: getErrorMessage(error),
      });
    } finally {
      dailyMetadataRepairLocks.delete(userId);
    }
  })();

  dailyMetadataRepairLocks.set(userId, repairPromise);
  executionCtx.waitUntil(repairPromise);
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

  const taskTerms = [
    normalizeMatchText(task.mission_type),
    normalizeMatchText(stripMissionTaskPrefix(localizeMissionText(task.label) ?? task.label)),
  ].filter((term) => term.length > 0);

  return matchTermsAgainstCompletedMission(completedMission, taskTerms);
}

async function grantCircuitRewards(db: D1Database, userId: string, missionRow: Record<string, unknown>) {
  const xpReward = Number(missionRow.xp_reward ?? 0);
  const pointsReward = Number(missionRow.points_reward ?? 0);

  if (xpReward <= 0 && pointsReward <= 0) return;

  await applyXpPointsAndResolveLevels(db, userId, xpReward, pointsReward);
}

function buildCompletedMissionMatchCandidates(completedMission: Record<string, unknown>): string[] {
  const rawTitle = String(completedMission.title ?? "");
  const exerciseNameRaw = String(completedMission.exercise_name ?? "");
  const exerciseName = normalizeMatchText(exerciseNameRaw);
  const localizedExerciseName = normalizeMatchText(localizeMissionText(exerciseNameRaw) ?? exerciseNameRaw);
  const supportedExerciseNameRaw = resolveSupportedMissionExerciseName(exerciseNameRaw);
  const supportedExerciseName = normalizeMatchText(supportedExerciseNameRaw ?? "");
  const supportedExerciseDisplay = normalizeMatchText(
    resolveExerciseDisplayNamePt(supportedExerciseNameRaw ?? exerciseNameRaw)
      ?? supportedExerciseNameRaw
      ?? exerciseNameRaw,
  );
  const hasResolvedExerciseName =
    exerciseName.length > 0
    || localizedExerciseName.length > 0
    || supportedExerciseName.length > 0;
  const title = hasResolvedExerciseName ? "" : normalizeMatchText(rawTitle);
  const strippedTitle = hasResolvedExerciseName ? "" : normalizeMatchText(stripMissionDisplayTitlePrefix(rawTitle));
  const exerciseCategory = normalizeMatchText(String(completedMission.exercise_category ?? ""));
  const skillName = normalizeMatchText(String(completedMission.skill_name ?? ""));
  const metricType = normalizeMatchText(String(completedMission.metric_type ?? ""));

  return Array.from(
    new Set(
      [
        title,
        strippedTitle,
        exerciseName,
        localizedExerciseName,
        supportedExerciseName,
        supportedExerciseDisplay,
        exerciseCategory,
        skillName,
        metricType,
      ]
        .filter((value) => value.length > 0),
    ),
  );
}

function matchTermsAgainstCompletedMission(completedMission: Record<string, unknown>, terms: readonly string[]): boolean {
  const candidates = buildCompletedMissionMatchCandidates(completedMission);
  if (candidates.length === 0) return false;

  return terms.some((term) => {
    const normalizedTerm = normalizeMatchText(term);
    if (normalizedTerm.length === 0) return false;

    return candidates.some((candidate) =>
      candidate === normalizedTerm
      || candidate.startsWith(`${normalizedTerm} `)
      || candidate.endsWith(` ${normalizedTerm}`)
      || candidate.includes(` ${normalizedTerm} `)
      || normalizedTerm.includes(candidate),
    );
  });
}

function missionSubtaskMatchesCompletedMission(
  completedMission: Record<string, unknown>,
  subtask: NormalizedMissionSubtask,
): boolean {
  if (String(completedMission.type ?? "") !== "daily") {
    return false;
  }

  const terms = [
    normalizeMatchText(subtask.compatibility_key),
    ...subtask.compatibility_terms.map((term) => normalizeMatchText(term)),
  ].filter((term) => term.length > 0);

  return matchTermsAgainstCompletedMission(completedMission, terms);
}

function isMissionCompletionWithinParentWindow(
  completedMission: Record<string, unknown>,
  parentMission: Record<string, unknown>,
): boolean {
  const completedAt = typeof completedMission.completed_at === "string" ? completedMission.completed_at : "";
  const parentCreatedAt = typeof parentMission.created_at === "string" ? parentMission.created_at : "";
  const parentDeadline = typeof parentMission.deadline === "string" ? parentMission.deadline : "";

  if (completedAt.length === 0) return false;
  if (parentCreatedAt.length > 0 && completedAt < parentCreatedAt) return false;
  if (parentDeadline.length > 0 && completedAt > parentDeadline) return false;
  return true;
}

async function recomputeActivePeriodicMissionProgress(userId: string, db: D1Database): Promise<void> {
  const periodicRows = await db.prepare(
    `SELECT *
       FROM missions
      WHERE user_id = ?
        AND type IN ('weekly', 'monthly')
        AND is_completed = 0
        AND (deadline IS NULL OR deadline > datetime('now'))`,
  ).bind(userId).all<Record<string, unknown>>();

  const activePeriodicMissions = Array.isArray(periodicRows.results) ? periodicRows.results : [];
  if (activePeriodicMissions.length === 0) return;

  const completedDailyRows = await db.prepare(
    `SELECT *
       FROM missions
      WHERE user_id = ?
        AND type = 'daily'
        AND is_completed = 1
        AND completed_at IS NOT NULL
        AND datetime(completed_at) >= datetime('now', '-45 day')`,
  ).bind(userId).all<Record<string, unknown>>();
  const completedDailyMissions = Array.isArray(completedDailyRows.results) ? completedDailyRows.results : [];
  const parentIds = activePeriodicMissions.map((row) => Number(row.id ?? 0)).filter((id) => id > 0);
  const subtasksByParentId = await loadMissionSubtasksByParentIds(db, parentIds);
  const hasProgressValueColumn = await hasTableColumn(db, "missions", "progress_value");
  const missionsHaveStatus = await hasTableColumn(db, "missions", "status");

  for (const missionRow of activePeriodicMissions) {
    const missionId = Number(missionRow.id ?? 0);
    if (missionId <= 0) continue;

    const eligibleDailies = completedDailyMissions.filter((completedMission) =>
      isMissionCompletionWithinParentWindow(completedMission, missionRow),
    );
    const subtasks = subtasksByParentId.get(missionId) ?? [];

    if (subtasks.length > 0) {
      let changed = false;

      for (const subtask of subtasks) {
        const matchedCount = eligibleDailies.reduce((total, completedMission) =>
          missionSubtaskMatchesCompletedMission(completedMission, subtask) ? total + 1 : total,
        0);
        const nextCount = Math.min(subtask.required_count, matchedCount);
        const nextCompleted = nextCount >= subtask.required_count ? 1 : 0;

        if (nextCount === subtask.current_count && nextCompleted === (subtask.is_completed ? 1 : 0)) {
          continue;
        }

        changed = true;
        await db.prepare(
          `UPDATE mission_subtasks
              SET current_count = ?,
                  is_completed = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).bind(nextCount, nextCompleted, subtask.id).run();
      }

      if (changed) {
        await refreshMissionFromSubtasks(db, userId, missionId);
      }
      continue;
    }

    if (normalizeMissionMetricType(missionRow.metric_type, missionRow.target_time) !== "circuit_tasks") {
      continue;
    }

    const circuitTasks = parseCircuitTaskField(missionRow.circuit_tasks_json);
    if (circuitTasks.length === 0) continue;

    let changed = false;
    const recomputedTasks = circuitTasks.map((task) => {
      const matchedCount = eligibleDailies.reduce((total, completedMission) =>
        missionMatchesTask(completedMission, task) ? total + 1 : total,
      0);
      const currentCount = Math.min(task.required_count, matchedCount);
      const completed = currentCount >= task.required_count;

      if (currentCount !== task.current_count || completed !== task.completed) {
        changed = true;
      }

      return {
        ...task,
        current_count: currentCount,
        completed,
      };
    });

    if (!changed) continue;

    const progressValue = recomputedTasks.reduce(
      (total, task) => total + Math.min(task.required_count, task.current_count),
      0,
    );
    if (hasProgressValueColumn) {
      await db.prepare(
        `UPDATE missions
            SET circuit_tasks_json = ?,
                progress_value = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      ).bind(JSON.stringify(recomputedTasks), progressValue, missionId).run();
    } else {
      await db.prepare(
        `UPDATE missions
            SET circuit_tasks_json = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      ).bind(JSON.stringify(recomputedTasks), missionId).run();
    }

    if (!recomputedTasks.every((task) => task.completed)) {
      continue;
    }

    if (missionsHaveStatus) {
      await db.prepare(
        `UPDATE missions
            SET is_completed = 1,
                status = 'completed',
                completed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ? AND is_completed = 0`,
      ).bind(missionId).run();
    } else {
      await db.prepare(
        `UPDATE missions
            SET is_completed = 1,
                completed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ? AND is_completed = 0`,
      ).bind(missionId).run();
    }

    await grantCircuitRewards(db, userId, missionRow);
    await onMissionComplete(db, userId, missionId);
  }
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
  const progressValue = subtasks.reduce(
    (total, subtask) => total + Math.min(subtask.required_count, subtask.current_count),
    0,
  );
  const hasProgressValueColumn = await hasTableColumn(db, "missions", "progress_value");
  if (hasProgressValueColumn) {
    await db.prepare(
      `UPDATE missions
        SET circuit_tasks_json = ?, progress_value = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).bind(JSON.stringify(circuitTasks), progressValue, parentMissionId).run();
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
    const hasProgressValueColumn = await hasTableColumn(db, "missions", "progress_value");
    const progressValue = tasks.reduce(
      (total, task) => total + Math.min(task.required_count, task.current_count),
      0,
    );

    if (hasProgressValueColumn) {
      await db.prepare(
        `UPDATE missions
           SET circuit_tasks_json = ?, progress_value = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(JSON.stringify(tasks), progressValue, circuit.id).run();
    } else {
      await db.prepare(
        `UPDATE missions
           SET circuit_tasks_json = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(JSON.stringify(tasks), circuit.id).run();
    }

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
      || normalizedResolvedName.includes("twist")
      || normalizedResolvedName.includes("weighted")
      || normalizedResolvedName.includes("power point")
      || (normalizedTarget.length > 0 && !normalizedTarget.includes("abs"))
      || (normalizedBodyPart.length > 0 && !normalizedBodyPart.includes("waist"));
  }

  if (
    normalizedExerciseName.includes("crunch")
    || normalizedExerciseName.includes("abdominal")
    || normalizedExerciseName.includes("sit up")
    || normalizedExerciseName.includes("situp")
  ) {
    const resolvedLooksAbdominal =
      normalizedResolvedName.includes("crunch")
      || normalizedResolvedName.includes("sit up")
      || normalizedResolvedName.includes("situp");
    const targetLooksAbdominal =
      normalizedTarget.includes("abs")
      || normalizedTarget.includes("waist");
    const bodyPartLooksAbdominal =
      normalizedBodyPart.includes("waist")
      || normalizedBodyPart.includes("abs");
    const resolvedLooksWrongVariant =
      normalizedResolvedName.includes("weighted")
      || normalizedResolvedName.includes("oblique")
      || normalizedResolvedName.includes("groin")
      || normalizedResolvedName.includes("reverse");
    return !resolvedLooksAbdominal
      || !targetLooksAbdominal
      || !bodyPartLooksAbdominal
      || resolvedLooksWrongVariant;
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

  if (normalizedExerciseName.includes("dead bug")) {
    return !normalizedResolvedName.includes("dead bug")
      || (normalizedTarget.length > 0 && !normalizedTarget.includes("abs"))
      || (normalizedBodyPart.length > 0 && !normalizedBodyPart.includes("waist"));
  }

  if (normalizedExerciseName.includes("bird dog")) {
    return !normalizedResolvedName.includes("bird dog")
      || normalizedResolvedName.includes("weighted")
      || normalizedResolvedName.includes("machine");
  }

  if (normalizedExerciseName.includes("hollow")) {
    return !normalizedResolvedName.includes("hollow")
      || normalizedResolvedName.includes("weighted")
      || normalizedResolvedName.includes("machine");
  }

  return false;
}

function resolveLegacyDailyRepairIdentity(
  row: Record<string, unknown>,
): {
  sourceExerciseName: string;
  supportedExerciseName: string | null;
} {
  const storedExerciseName =
    typeof row.exercise_name === "string" ? stripMissionDisplayTitlePrefix(row.exercise_name).trim() : "";
  const titleExerciseName =
    typeof row.title === "string" ? extractExerciseName(row.title).trim() : "";
  const localizedStoredExerciseName =
    typeof localizeMissionText(storedExerciseName) === "string" ? String(localizeMissionText(storedExerciseName)).trim() : "";
  const localizedTitleExerciseName =
    typeof localizeMissionText(titleExerciseName) === "string" ? String(localizeMissionText(titleExerciseName)).trim() : "";

  const storedSupportedExerciseName =
    resolveSupportedMissionExerciseName(storedExerciseName)
    ?? resolveSupportedMissionExerciseName(localizedStoredExerciseName);
  const titleSupportedExerciseName =
    resolveSupportedMissionExerciseName(titleExerciseName)
    ?? resolveSupportedMissionExerciseName(localizedTitleExerciseName);

  let supportedExerciseName = storedSupportedExerciseName ?? titleSupportedExerciseName ?? null;
  if (
    storedSupportedExerciseName &&
    titleSupportedExerciseName &&
    missionMetadataLooksMismatched(storedSupportedExerciseName, row)
  ) {
    supportedExerciseName = titleSupportedExerciseName;
  }

  const sourceExerciseName =
    supportedExerciseName
    || storedExerciseName
    || localizedStoredExerciseName
    || titleExerciseName
    || localizedTitleExerciseName
    || "";

  return {
    sourceExerciseName: sourceExerciseName.trim(),
    supportedExerciseName,
  };
}

function legacyDailyMetricNeedsRepair(
  exerciseName: string,
  metricType: MissionMetricType,
  metricValue: number,
): boolean {
  const expectedMetricType = getMissionMetricType(exerciseName);
  if (metricType !== expectedMetricType) {
    return true;
  }

  if (expectedMetricType === "steps") return metricValue < 2_000;
  if (expectedMetricType === "distance_meters") return metricValue < 800;
  if (expectedMetricType === "duration_minutes") return metricValue < 5;
  if (expectedMetricType === "duration_seconds") return metricValue < 30;
  return false;
}

async function repairLegacyDailyMissionMetadata(
  env: Env,
  db: D1Database,
  userId: string,
  options?: { limit?: number | undefined },
): Promise<void> {
  const hasExerciseDbIdColumn = await hasTableColumn(db, "missions", "exercise_db_id");
  const rows = await db.prepare(
    `SELECT *
      FROM missions
      WHERE user_id = ?
        AND type = 'daily'
        AND is_completed = 0
        AND (deadline IS NULL OR deadline > datetime('now'))
      ORDER BY datetime(created_at) DESC, id DESC`
  ).bind(userId).all<Record<string, unknown>>();
  const maxRepairs = Math.max(1, Number(options?.limit ?? Number.POSITIVE_INFINITY));
  let repairedCount = 0;
  const missionIdsToRegenerate: number[] = [];

  for (const row of Array.isArray(rows.results) ? rows.results : []) {
    if (repairedCount >= maxRepairs) {
      break;
    }

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

    const repairIdentity = resolveLegacyDailyRepairIdentity(row);
    const exerciseName = (repairIdentity.supportedExerciseName ?? repairIdentity.sourceExerciseName).trim();
    if (exerciseName.length === 0) {
      continue;
    }

    const currentMetricType = normalizeMissionMetricType(row.metric_type, row.target_time);
    const currentMetricValue = Math.max(1, Number(row.metric_value ?? row.target_reps ?? row.target_time ?? 1));
    const requiresMetricRepair = legacyDailyMetricNeedsRepair(exerciseName, currentMetricType, currentMetricValue);
    const currentInstructionsEn = parseMissionArrayField(row.exercise_instructions_en_json);
    const currentInstructionsPt = parseMissionArrayField(row.exercise_instructions_pt_json);
    const requiresInstructionTranslationRepair =
      Boolean(getHuggingFaceApiKey(env)) &&
      exerciseInstructionPtNeedsAiTranslation(currentInstructionsEn, currentInstructionsPt);
    const hasSupportedExercise = repairIdentity.supportedExerciseName !== null;

    if (
      !hasSupportedExercise &&
      (!hasMedia || !hasExerciseMetadata || requiresMetricRepair || requiresInstructionTranslationRepair)
    ) {
      const missionId = Number(row.id ?? 0);
      if (missionId > 0) {
        missionIdsToRegenerate.push(missionId);
        repairedCount += 1;
      }
      continue;
    }

    if (
      hasMedia &&
      hasExerciseMetadata &&
      !missionMetadataLooksMismatched(exerciseName, row) &&
      !requiresMetricRepair &&
      !requiresInstructionTranslationRepair
    ) {
      continue;
    }

    const preferredExerciseDbId = resolvePreferredExerciseDbId(exerciseName);
    const enriched = await enrichExercise(exerciseName, env, {
      exerciseDbId: preferredExerciseDbId ?? (typeof row.exercise_db_id === "string" ? row.exercise_db_id : null),
    }).catch(() => null);
    const apiInstructionsEn = normalizeInstructionList(enriched?.instructions, 8);
    const resolvedExerciseName = enriched?.name || exerciseName;
    const resolvedExerciseDisplayName = resolveExerciseDisplayNamePt(resolvedExerciseName) ?? resolvedExerciseName;
    const sourceInstructionsEn = apiInstructionsEn.length > 0 ? apiInstructionsEn : currentInstructionsEn;
    const apiInstructionsPt = sourceInstructionsEn.length > 0
      ? await translateExerciseInstructionsToPt(sourceInstructionsEn, resolvedExerciseDisplayName, env)
      : currentInstructionsPt;
    const localizedApiInstructionsPt = localizeMissionTextArray(apiInstructionsPt);
    const currentSets = row.sets === null || row.sets === undefined ? null : Number(row.sets);
    const currentRestSeconds = row.rest_seconds === null || row.rest_seconds === undefined ? null : Number(row.rest_seconds);
    const mergedSteps = sourceInstructionsEn.length > 0
      ? (localizedApiInstructionsPt.length > 0 ? localizedApiInstructionsPt : localizeInstructionListFallback(sourceInstructionsEn))
      : parseMissionArrayField(row.instructions_json);
    const persistedInstructions = ensureInstructionSteps(
      normalizeInstructionList(mergedSteps, 6),
      resolvedExerciseDisplayName,
      currentMetricType,
      currentSets,
      currentRestSeconds,
    );

    if (requiresMetricRepair) {
      const resolvedTarget = enriched?.target || "";
      const resolvedCategory = normalizeExerciseCategory(resolvedExerciseDisplayName, resolvedTarget);
      const repairedMetricPayload = applyMissionMetricContext(
        {
          title: typeof row.title === "string" && row.title.trim().length > 0
            ? row.title
            : `Missao Diaria: ${resolvedExerciseDisplayName}`,
          description: typeof row.description === "string" ? row.description : "",
          goal: typeof row.goal === "string" ? row.goal : null,
          metric_type: currentMetricType,
          metric_value: currentMetricValue,
          metric_unit: typeof row.metric_unit === "string" && row.metric_unit.trim().length > 0
            ? row.metric_unit
            : metricUnitByType(currentMetricType),
          sets: currentSets,
          rest_seconds: currentRestSeconds,
          instructions: persistedInstructions,
          exercise_instructions_en: apiInstructionsEn,
          exercise_instructions_pt: localizedApiInstructionsPt,
          image_url: enriched?.imageUrl ?? null,
          exercise_db_gif_url: enriched?.exerciseDbGifUrl ?? null,
          exercise_db_image_url: enriched?.exerciseDbImageUrl ?? null,
          muscle_groups: resolveExerciseApiMuscleGroups(enriched),
          exercise_secondary_muscles: Array.isArray(enriched?.secondaryMuscles) ? enriched.secondaryMuscles : [],
          exercise_name: resolvedExerciseDisplayName,
          exercise_db_id: enriched?.id ?? preferredExerciseDbId ?? null,
          exercise_equipment: enriched?.equipment || null,
          exercise_body_part: enriched?.bodyPart || null,
          exercise_target: enriched?.target || null,
          exercise_type: inferExerciseType(resolvedCategory),
          body_area: resolveExerciseApiBodyArea(enriched, exerciseName),
          attributes_benefited: inferAttributes(resolvedCategory),
          xp_reward: 0,
          points_reward: 0,
          duration_estimate_minutes: row.duration_estimate_minutes === null || row.duration_estimate_minutes === undefined
            ? null
            : Number(row.duration_estimate_minutes),
          exercise_category: resolvedCategory,
          mission_origin: "regular",
          is_ai_special: 0,
          circuit_tasks: [],
          safety_tips: [],
          difficulty_level: null,
          video_url: enriched?.videoUrl ?? null,
          thumbnail_url: enriched?.thumbnailUrl ?? null,
          target_reps: row.target_reps === null || row.target_reps === undefined ? null : Number(row.target_reps),
          target_time: row.target_time === null || row.target_time === undefined ? null : Number(row.target_time),
        },
        "daily",
        resolvedExerciseDisplayName,
        getMissionMetricType(resolvedExerciseDisplayName),
        metricValueByPeriod(getMissionMetricType(resolvedExerciseDisplayName), "daily"),
      );

      const repairedTitle = `Missao Diaria: ${resolvedExerciseDisplayName}`;
      const metricRepairSql = hasExerciseDbIdColumn
        ? `UPDATE missions
         SET title = ?,
             description = ?,
             metric_type = ?,
             metric_value = ?,
             metric_unit = ?,
             target_reps = ?,
             target_time = ?,
             sets = ?,
             rest_seconds = ?,
             duration_estimate_minutes = ?,
             exercise_category = ?,
             exercise_type = ?,
             exercise_name = ?,
             exercise_db_id = ?,
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
             exercise_instructions_en_json = ?,
             exercise_instructions_pt_json = ?,
             instructions_json = ?,
             updated_at = datetime('now')
        WHERE id = ?`
        : `UPDATE missions
         SET title = ?,
             description = ?,
             metric_type = ?,
             metric_value = ?,
             metric_unit = ?,
             target_reps = ?,
             target_time = ?,
             sets = ?,
             rest_seconds = ?,
             duration_estimate_minutes = ?,
             exercise_category = ?,
             exercise_type = ?,
             exercise_name = ?,
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
             exercise_instructions_en_json = ?,
             exercise_instructions_pt_json = ?,
             instructions_json = ?,
             updated_at = datetime('now')
       WHERE id = ?`;

      const metricRepairValues: unknown[] = [
        repairedTitle,
        repairedMetricPayload.description,
        repairedMetricPayload.metric_type,
        repairedMetricPayload.metric_value,
        repairedMetricPayload.metric_unit,
        repairedMetricPayload.target_reps,
        repairedMetricPayload.target_time,
        repairedMetricPayload.sets,
        repairedMetricPayload.rest_seconds,
        repairedMetricPayload.duration_estimate_minutes,
        repairedMetricPayload.exercise_category,
        repairedMetricPayload.exercise_type,
        resolveExerciseDisplayNamePt(repairedMetricPayload.exercise_name) ?? repairedMetricPayload.exercise_name,
      ];

      if (hasExerciseDbIdColumn) {
        metricRepairValues.push(repairedMetricPayload.exercise_db_id);
      }

      metricRepairValues.push(
        repairedMetricPayload.exercise_equipment,
        repairedMetricPayload.exercise_body_part,
        repairedMetricPayload.exercise_target,
        JSON.stringify(repairedMetricPayload.exercise_secondary_muscles),
        repairedMetricPayload.exercise_db_gif_url,
        repairedMetricPayload.exercise_db_image_url,
        repairedMetricPayload.image_url,
        repairedMetricPayload.video_url,
        repairedMetricPayload.thumbnail_url,
        JSON.stringify(repairedMetricPayload.muscle_groups),
        repairedMetricPayload.body_area,
        JSON.stringify(repairedMetricPayload.exercise_instructions_en),
        JSON.stringify(repairedMetricPayload.exercise_instructions_pt),
        JSON.stringify(repairedMetricPayload.instructions),
        row.id,
      );

      await db.prepare(metricRepairSql).bind(...metricRepairValues).run();
      repairedCount += 1;
      continue;
    }

    const preserveExistingMedia = !missionMetadataLooksMismatched(exerciseName, row);
    const resolvedExerciseDbIdForStorage = enriched?.id ?? preferredExerciseDbId ?? null;
    const resolvedExerciseDbGifUrl = enriched?.exerciseDbGifUrl
      ?? (preserveExistingMedia ? normalizeMissionMediaUrl(typeof row.exercise_db_gif_url === "string" ? row.exercise_db_gif_url : null) : null);
    const resolvedExerciseDbImageUrl = enriched?.exerciseDbImageUrl
      ?? (preserveExistingMedia ? normalizeMissionMediaUrl(typeof row.exercise_db_image_url === "string" ? row.exercise_db_image_url : null) : null);
    const resolvedImageUrl = enriched?.imageUrl
      ?? (preserveExistingMedia ? normalizeMissionMediaUrl(typeof row.image_url === "string" ? row.image_url : null) : null);
    const resolvedVideoUrl = enriched?.videoUrl
      ?? (preserveExistingMedia ? normalizeMissionMediaUrl(typeof row.video_url === "string" ? row.video_url : null) : null);
    const resolvedThumbnailUrl = enriched?.thumbnailUrl
      ?? (preserveExistingMedia ? normalizeMissionMediaUrl(typeof row.thumbnail_url === "string" ? row.thumbnail_url : null) : null);
    const repairedTitle = `Missao Diaria: ${resolvedExerciseDisplayName}`;
    const metadataRepairSql = hasExerciseDbIdColumn
      ? `UPDATE missions
         SET title = ?,
             exercise_name = ?,
             exercise_db_id = ?,
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
             exercise_instructions_en_json = ?,
             exercise_instructions_pt_json = ?,
             instructions_json = ?,
             updated_at = datetime('now')
        WHERE id = ?`
      : `UPDATE missions
         SET title = ?,
             exercise_name = ?,
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
             exercise_instructions_en_json = ?,
             exercise_instructions_pt_json = ?,
             instructions_json = ?,
             updated_at = datetime('now')
       WHERE id = ?`;

    const metadataRepairValues: unknown[] = [
      repairedTitle,
      resolvedExerciseDisplayName,
    ];

    if (hasExerciseDbIdColumn) {
      metadataRepairValues.push(resolvedExerciseDbIdForStorage);
    }

    metadataRepairValues.push(
      enriched?.equipment || null,
      enriched?.bodyPart || null,
      enriched?.target || null,
      JSON.stringify(Array.isArray(enriched?.secondaryMuscles) ? enriched.secondaryMuscles : []),
      resolvedExerciseDbGifUrl,
      resolvedExerciseDbImageUrl,
      resolvedImageUrl,
      resolvedVideoUrl,
      resolvedThumbnailUrl,
      JSON.stringify(resolveExerciseApiMuscleGroups(enriched)),
      resolveExerciseApiBodyArea(enriched, exerciseName),
      JSON.stringify(apiInstructionsEn),
      JSON.stringify(localizedApiInstructionsPt),
      JSON.stringify(persistedInstructions),
      row.id,
    );

    await db.prepare(metadataRepairSql).bind(...metadataRepairValues).run();
    repairedCount += 1;
  }

  if (missionIdsToRegenerate.length > 0) {
    const placeholders = missionIdsToRegenerate.map(() => "?").join(", ");
    await db.prepare(
      `DELETE FROM missions
       WHERE user_id = ?
         AND type = 'daily'
         AND id IN (${placeholders})`,
    ).bind(userId, ...missionIdsToRegenerate).run();
    await createMissionsForPeriod(env, db, userId, "daily", missionIdsToRegenerate.length);
    invalidateMissionListCache(userId);
  }
}



registerMissionRoutes(
  app,
  {
    applyMissionAttributeDeltaToUser: (db, userId, delta) =>
      applyMissionAttributeDeltaToUser(db, userId, delta as MissionAttributeDelta),
    applyXpPointsAndResolveLevels,
    checkMissionRelevance,
    clearMissionListCache,
    computeMissionTypeAttributeDelta: (
      missionRecord,
      missionMetricType,
      completedMetricValue,
    ) =>
      computeMissionTypeAttributeDelta(
        missionRecord,
        missionMetricType as MissionMetricType,
        completedMetricValue,
      ),
    ensureInstructionSteps: (
      steps,
      exerciseName,
      metricType,
      sets,
      restSeconds,
    ) =>
      ensureInstructionSteps(
        steps,
        exerciseName,
        metricType as MissionMetricType,
        sets ?? null,
        restSeconds ?? null,
      ),
    ensurePeriodicMissionsWithGuard: (env, db, userId, options) =>
      ensurePeriodicMissionsWithGuard(env, db, userId, options),
    ensureUserAttributesRow,
    ensureUserCounterRow,
    extractExerciseName,
    generateStructuredMissionPlanForUser,
    getMonthlyCounters,
    hydrateMissionRowsWithSubtasks,
    invalidateMissionListCache,
    invalidateRankingCache,
    logUserEvent,
    missionSummaryFromNormalized: (mission) =>
      missionSummaryFromNormalized(mission as NormalizedMissionRow),
    monthlyMissionProgressValue: (mission, monthlyCounters) =>
      monthlyMissionProgressValue(mission, monthlyCounters as MonthlyCounterSnapshot),
    normalizeInstructionList,
    normalizeMatchText,
    normalizeMissionMetricType,
    normalizeMissionRow: (row) => normalizeMissionRow(row),
    onGoalProgress,
    onMissionComplete,
    onStreakContinued,
    readMissionListCache,
    runMissionLifecycleHookSafely,
    scheduleLegacyDailyMetadataRepairWithGuard,
    schedulePeriodicMissionsRefreshWithGuard: (
      env,
      db,
      userId,
      executionCtx,
      mode,
    ) =>
      schedulePeriodicMissionsRefreshWithGuard(
        env,
        db,
        userId,
        executionCtx,
        mode,
      ),
    schedulePeriodicProgressRecomputeWithGuard,
    streamJsonArrayResponse,
    totalSkillTableAttributeGain,
    translateExerciseInstructionsToPt,
    tryUnlockSkillsFromPerformance,
    unlockAchievementIfNeeded,
    updateCircuitProgress,
    updateMissionSubtaskProgress,
    updateMonthlyMissionProgress,
    withTransaction,
    writeMissionListCache,
  },
  authMiddleware,
);

// Achievements and titles
registerAchievementRoutes(app, { authMiddleware });

// Shop endpoints
registerShopRoutes(app, {
  authMiddleware,
  invalidateRankingCache,
  streamJsonArrayResponse,
  withTransaction,
});

// Daily metrics
registerMetricsRoutes(app, { authMiddleware });

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
registerFriendsRoutes(app, {
  authMiddleware,
  onFriendAdded,
  withTransaction,
});

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
    await unlockAchievementIfNeeded(db, userId, "ImbatiÂ­vel", winStreak, 50);
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
  exercise_db_id: string | null;
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

type MissionAttributeDelta = {
  strength: number;
  constitution: number;
  vitality: number;
  dexterity: number;
  focus: number;
};

function emptyMissionAttributeDelta(): MissionAttributeDelta {
  return { strength: 0, constitution: 0, vitality: 0, dexterity: 0, focus: 0 };
}

function scaleMissionAttributeDelta(delta: MissionAttributeDelta, factor: number): MissionAttributeDelta {
  const f = Math.max(0, Math.min(3, Math.floor(factor)));
  if (f <= 0) return emptyMissionAttributeDelta();
  return {
    strength: delta.strength * f,
    constitution: delta.constitution * f,
    vitality: delta.vitality * f,
    dexterity: delta.dexterity * f,
    focus: delta.focus * f,
  };
}

/** Ganhos base por categoria de exercÃ­cio da missÃ£o (quando nÃ£o hÃ¡ skill ou skill sem gains). */
function baseMissionAttributeDeltaForExerciseCategory(category: string): MissionAttributeDelta {
  const c = String(category || "default").toLowerCase();
  switch (c) {
    case "plank":
    case "isometric":
      return { strength: 0, constitution: 1, vitality: 0, dexterity: 1, focus: 1 };
    case "walk":
      return { strength: 0, constitution: 1, vitality: 1, dexterity: 0, focus: 1 };
    case "run":
      return { strength: 0, constitution: 1, vitality: 2, dexterity: 1, focus: 0 };
    case "yoga":
      return { strength: 0, constitution: 0, vitality: 1, dexterity: 1, focus: 1 };
    case "stretching":
    case "mobility":
      return { strength: 0, constitution: 1, vitality: 0, dexterity: 2, focus: 1 };
    case "cardio_circuit":
      return { strength: 1, constitution: 1, vitality: 1, dexterity: 1, focus: 0 };
    case "abdominal":
      return { strength: 1, constitution: 1, vitality: 0, dexterity: 1, focus: 1 };
    case "strength":
      return { strength: 1, constitution: 1, vitality: 1, dexterity: 1, focus: 0 };
    default:
      return { strength: 1, constitution: 1, vitality: 1, dexterity: 1, focus: 0 };
  }
}

function tweakMissionAttributeDeltaForBodyArea(delta: MissionAttributeDelta, bodyArea: string): MissionAttributeDelta {
  const out = { ...delta };
  const b = String(bodyArea || "").toLowerCase();
  if (b === "upper") out.strength += 1;
  else if (b === "lower") out.vitality += 1;
  else if (b === "core") out.constitution += 1;
  return out;
}

function tweakMissionAttributeDeltaForExerciseType(delta: MissionAttributeDelta, exerciseType: string): MissionAttributeDelta {
  const out = { ...delta };
  const t = String(exerciseType || "").toLowerCase();
  if (t === "cardio") {
    out.vitality += 1;
    out.constitution += 1;
  } else if (t === "flexibilidade") {
    out.dexterity += 1;
    out.focus += 1;
  } else if (t === "equilibrio") {
    out.focus += 1;
    out.constitution += 1;
  }
  return out;
}

function missionCompletionEffortFactor(
  metricType: MissionMetricType,
  completedValue: number,
  missionMetricValue: number,
): number {
  if (completedValue <= 0) return 1;
  const target = Math.max(1, Math.floor(Number(missionMetricValue) || 1));
  if (metricType === "repetitions" || metricType === "sets_reps") {
    const ratio = completedValue / target;
    return Math.max(1, Math.min(2, Math.round(Math.min(1.15, Math.max(0.75, ratio)) * 1.5)));
  }
  if (metricType === "duration_seconds") {
    return Math.max(1, Math.min(2, 1 + Math.floor(completedValue / 120)));
  }
  if (metricType === "duration_minutes") {
    return Math.max(1, Math.min(2, 1 + Math.floor((completedValue * 60) / 120)));
  }
  if (metricType === "steps") {
    return Math.max(1, Math.min(2, 1 + Math.floor(completedValue / 4000)));
  }
  if (metricType === "distance_meters") {
    return Math.max(1, Math.min(2, 1 + Math.floor(completedValue / 1500)));
  }
  return 1;
}

function computeMissionTypeAttributeDelta(
  missionRow: Record<string, unknown>,
  metricType: MissionMetricType,
  completedMetricValue: number,
): MissionAttributeDelta {
  const category = String(missionRow.exercise_category ?? "default");
  const bodyArea = String(missionRow.body_area ?? "full_body");
  const exerciseType = String(missionRow.exercise_type ?? "forca");
  const metricValue = Number(
    missionRow.metric_value ?? missionRow.target_reps ?? missionRow.target_time ?? 1,
  );
  let base = baseMissionAttributeDeltaForExerciseCategory(category);
  base = tweakMissionAttributeDeltaForBodyArea(base, bodyArea);
  base = tweakMissionAttributeDeltaForExerciseType(base, exerciseType);
  const factor = missionCompletionEffortFactor(metricType, completedMetricValue, metricValue);
  return scaleMissionAttributeDelta(base, factor);
}

function totalSkillTableAttributeGain(skill: Record<string, unknown>): number {
  return (
    Number(skill.strength_gain ?? 0) +
    Number(skill.constitution_gain ?? 0) +
    Number(skill.vitality_gain ?? 0) +
    Number(skill.dexterity_gain ?? 0) +
    Number(skill.focus_gain ?? 0)
  );
}

async function applyMissionAttributeDeltaToUser(db: D1Database, userId: string, delta: MissionAttributeDelta): Promise<void> {
  const total =
    delta.strength + delta.constitution + delta.vitality + delta.dexterity + delta.focus;
  if (total <= 0) return;
  await ensureUserAttributesRow(db, userId);
  await db
    .prepare(
      `UPDATE user_attributes SET
        strength = strength + ?,
        constitution = constitution + ?,
        vitality = vitality + ?,
        dexterity = dexterity + ?,
        focus = focus + ?,
        updated_at = datetime('now')
      WHERE user_id = ?`,
    )
    .bind(delta.strength, delta.constitution, delta.vitality, delta.dexterity, delta.focus, userId)
    .run();
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

function buildPlanProfileHash(
  mainGoal: string,
  conditioning: ConditioningLevel,
  injuries: string,
  equipment: string,
  chatPreferences: TrainingPlanChatPreferences | null = null,
): string {
  return [mainGoal, conditioning, injuries, equipment, trainingPlanChatPreferencesHash(chatPreferences)]
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
    return ["High Plank", "Crunch Floor", "Quarter Sit-up", "Mountain Climber", "Dead Bug"];
  }
  if (normalized.includes("active_recovery") || (normalized.includes("active") && normalized.includes("recover"))) {
    return ["Walking", "Stretching", "Mobility Flow", "Glute Bridge", "Air Squat"];
  }
  if (normalized.includes("rest") || normalized.includes("recover")) {
    return ["Walking", "Stretching", "Mobility Flow", "Yoga Flow", "Glute Bridge"];
  }
  if (normalized.includes("yoga")) {
    return ["Yoga Flow", "Downward Dog", "Child Pose", "Warrior Sequence", "Mobility Flow"];
  }
  if (muscles.some((muscle) => muscle.toLowerCase().includes("core"))) {
    return ["High Plank", "Crunch Floor", "Quarter Sit-up", "Dead Bug", "Mountain Climber"];
  }
  return ["Push-up", "Air Squat", "High Plank", "Lunge", "Burpee", "Walking"];
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

function mobilityHeavyExerciseName(name: string): boolean {
  const n = normalizeMatchText(name);
  if (n.includes("alongamento") || n.includes("stretch") || n.includes("mobility")) return true;
  if (n.includes("yoga") || n.includes("respiracao") || n.includes("guiad")) return true;
  if (n.includes("flow") && !n.includes("push") && !n.includes("pike")) return true;
  return false;
}

function skillFocusMatchesExercise(exerciseName: string, focusRaw: string): boolean {
  const focus = normalizeMatchText(focusRaw.trim());
  if (focus.length < 2) return false;
  const ex = normalizeMatchText(exerciseName);
  if (ex.includes(focus) || focus.includes(ex)) return true;
  const tokens = focus.split(/[\s,/|]+/).filter((t) => t.length >= 3);
  return tokens.some((t) => ex.includes(t));
}

type DailyMissionExercisePick = { name: string; muscle: string };

function canonicalizeDailyMissionExerciseEntries(
  entries: Array<{ name: string; muscle: string }>,
): Array<{ name: string; muscle: string }> {
  return uniqueExercises(
    entries
      .map((entry) => {
        const supportedExerciseName = resolveSupportedMissionExerciseName(entry.name);
        if (!supportedExerciseName) return null;
        return {
          name: supportedExerciseName,
          muscle: entry.muscle,
        };
      })
      .filter((entry): entry is { name: string; muscle: string } => entry !== null),
  );
}

function selectDailyMissionExerciseEntries(params: {
  targetAmount: number;
  primaryMuscle: string;
  conditioning: ConditioningLevel;
  dayPlan: WeeklyPlanDay;
  capacityRows: { results?: unknown };
  sourceExercises: ExerciseRef[];
  activeSkillFocus: string;
}): DailyMissionExercisePick[] {
  const {
    targetAmount,
    primaryMuscle,
    conditioning,
    dayPlan,
    capacityRows,
    sourceExercises,
    activeSkillFocus,
  } = params;

  const skillResults = Array.isArray(capacityRows.results)
    ? (capacityRows.results as Array<{ skill_name: string }>)
    : [];
  const skillExerciseEntries = canonicalizeDailyMissionExerciseEntries(
    skillResults.map((row) => ({ name: row.skill_name, muscle: primaryMuscle })),
  );

  const planExerciseEntries = canonicalizeDailyMissionExerciseEntries(
    dayPlan.exercises.map((name) => ({ name, muscle: primaryMuscle })),
  );

  const apiExerciseEntries = canonicalizeDailyMissionExerciseEntries(
    sourceExercises.map((exercise) => ({ name: exercise.name, muscle: exercise.muscle })),
  );

  const boostedSkills = activeSkillFocus
    ? skillExerciseEntries.filter((e) => skillFocusMatchesExercise(e.name, activeSkillFocus))
    : [];
  const otherSkills = skillExerciseEntries.filter(
    (e) => !boostedSkills.some((b) => normalizeMatchText(b.name) === normalizeMatchText(e.name)),
  );

  const maxMobility =
    conditioning === "sedentario" ? 2 : dayPlan.rest_day ? 2 : 1;

  const ordered: DailyMissionExercisePick[] = [];
  const seen = new Set<string>();
  let mobilityCount = 0;

  const tryAdd = (entry: DailyMissionExercisePick, respectMobilityCap: boolean): boolean => {
    const key = normalizeMatchText(entry.name);
    if (seen.has(key)) return false;
    const heavy = mobilityHeavyExerciseName(entry.name);
    if (respectMobilityCap && heavy && mobilityCount >= maxMobility) return false;
    if (respectMobilityCap && heavy) mobilityCount += 1;
    seen.add(key);
    ordered.push(entry);
    return true;
  };

  for (const e of boostedSkills) tryAdd(e, false);
  for (const e of otherSkills) tryAdd(e, false);
  for (const e of planExerciseEntries) tryAdd(e, true);
  for (const e of apiExerciseEntries) tryAdd(e, true);
  for (const e of canonicalizeDailyMissionExerciseEntries(
    localExercisePool.map((exercise) => ({
      name: exercise.name,
      muscle: exercise.muscle,
    })),
  )) {
    tryAdd(e, true);
  }

  const fillPool = canonicalizeDailyMissionExerciseEntries([
    ...skillExerciseEntries,
    ...planExerciseEntries,
    ...apiExerciseEntries,
    ...localExercisePool.map((exercise) => ({ name: exercise.name, muscle: exercise.muscle })),
  ]);

  for (const e of fillPool) {
    if (ordered.length >= targetAmount) break;
    tryAdd(e, false);
  }

  return ordered.slice(0, targetAmount);
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
  exerciseDbId?: string | undefined;
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
  const canonicalExerciseName = resolveExerciseDisplayNamePt(params.exerciseName) ?? params.exerciseName;
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
  const instructions = buildMissionInstructions(canonicalExerciseName, metricType, sets, restSeconds, params.instruction);
  const circuitTasks = metricType === "circuit_tasks" ? buildCircuitTasks(canonicalExerciseName, params.period) : [];

  const targetReps = metricType === "duration_seconds" || metricType === "duration_minutes" || metricType === "circuit_tasks" ? null : metricValue;
  const targetTime = metricType === "duration_seconds"
    ? metricValue
    : metricType === "duration_minutes"
      ? metricValue * 60
      : null;

  return {
    title: `${params.titlePrefix}: ${canonicalExerciseName}`,
    description: metricType === "circuit_tasks"
      ? ""
      : buildMissionDescriptionFromInstructions(
        instructions,
        buildMissionDescription(canonicalExerciseName, metricType, metricValue, sets),
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
    exercise_name: canonicalExerciseName,
    exercise_db_id: params.exerciseDbId ?? null,
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

/**
 * Liga missÃ£o â†” habilidade desbloqueada pelo nome do exercÃ­cio (inglÃªs da ExerciseDB / portuguÃªs do app).
 * Variantes (exerciseDbTerms) tÃªm matching especÃ­fico; skills base usam padrÃµes amplos.
 */
function exerciseMatchesUnlockedSkill(exerciseNorm: string, skillNorm: string, variantSeed?: VariantSkillSeed | null): boolean {
  if (variantSeed) {
    const terms = [...variantSeed.exerciseDbTerms, ...(variantSeed.aliases ?? [])];
    for (const t of terms) {
      const tNorm = normalizeMatchText(repairKnownMojibakeString(t));
      if (tNorm.length >= 3 && (exerciseNorm.includes(tNorm) || tNorm.includes(exerciseNorm))) return true;
    }
  }

  if (skillNorm.length >= 4 && exerciseNorm.includes(skillNorm)) return true;
  if (exerciseNorm.length >= 4 && skillNorm.includes(exerciseNorm)) return true;

  if (skillNorm.includes("flex")) {
    return /(push|flex|diamond|close[\s-]?grip|pec|peitoral|bench)/.test(exerciseNorm);
  }
  if (skillNorm.includes("agach")) {
    return /(squat|agach|pistol|leg[\s-]?press|wall[\s-]?sit)/.test(exerciseNorm);
  }
  if (skillNorm.includes("pranch") || skillNorm === "plank") {
    return /(plank|pranch|hollow)/.test(exerciseNorm) && !/(push|flex)/.test(exerciseNorm);
  }
  if (skillNorm.includes("abdom")) {
    return /(crunch|sit[\s-]?up|abdom|leg[\s-]?raise|toe[\s-]?touch)/.test(exerciseNorm);
  }
  if (skillNorm.includes("caminh") || skillNorm.includes("walk")) {
    return /(walk|caminh|marcha|marching)/.test(exerciseNorm);
  }
  if (skillNorm.includes("barra") && skillNorm.includes("fix")) {
    return /(pull|chin|lat|remada|row|dead[\s-]?hang)/.test(exerciseNorm);
  }
  if (skillNorm.includes("dip")) {
    return /(\bdips?\b|parallel)/.test(exerciseNorm);
  }

  return false;
}

async function resolveSkillIdForExerciseMission(
  db: D1Database,
  userId: string,
  exerciseName: string | null | undefined,
): Promise<number | null> {
  if (typeof exerciseName !== "string" || exerciseName.trim().length === 0) return null;

  const rows = await db
    .prepare(
      `SELECT s.id, s.name FROM skills s
       INNER JOIN user_skills us ON us.skill_id = s.id AND us.user_id = ?`,
    )
    .bind(userId)
    .all<{ id: number; name: string }>();

  const exerciseNorm = normalizeMatchText(repairKnownMojibakeString(exerciseName));
  const list = Array.isArray(rows.results) ? rows.results : [];
  list.sort(
    (a, b) => repairKnownMojibakeString(b.name).length - repairKnownMojibakeString(a.name).length,
  );

  for (const row of list) {
    const skillNorm = normalizeMatchText(repairKnownMojibakeString(row.name));
    const variantSeed = VARIANT_SEED_BY_NAME.get(row.name) ?? null;
    if (exerciseMatchesUnlockedSkill(exerciseNorm, skillNorm, variantSeed)) return row.id;
  }
  return null;
}

async function insertMission(
  db: D1Database,
  userId: string,
  period: MissionPeriod,
  deadline: string,
  mission: MissionPayload,
  skillId: number | null,
): Promise<number | null> {
  const [hasGoalColumn, hasAiSpecialColumn, hasExerciseDbIdColumn] = await Promise.all([
    hasTableColumn(db, "missions", "goal"),
    hasTableColumn(db, "missions", "is_ai_special"),
    hasTableColumn(db, "missions", "exercise_db_id"),
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
    "exercise_db_id",
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
    mission.exercise_db_id,
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

  if (!hasExerciseDbIdColumn) {
    const exerciseDbIdIndex = columns.indexOf("exercise_db_id");
    if (exerciseDbIdIndex >= 0) {
      columns.splice(exerciseDbIdIndex, 1);
      placeholders.splice(exerciseDbIdIndex, 1);
      values.splice(exerciseDbIdIndex, 1);
    }
  }

  placeholders[placeholders.length - 1] = "datetime('now')";

  const sql = `INSERT INTO missions (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
  const result = await db.prepare(sql).bind(...values).run();
  const insertedId = Number(result.meta.last_row_id ?? 0);
  return insertedId > 0 ? insertedId : null;
}

async function fetchExerciseDbExercises(_env: Env, muscle: string, _equipment: string): Promise<ExerciseRef[]> {
  void _env;
  void _equipment;
  return listSupportedMissionExerciseNamesByMuscle(muscle).map((name) => ({
    name,
    muscle,
    equipment: "bodyweight",
    difficulty: "intermediate",
    instructions: "",
  }));
}

function pickLocalExercises(muscle: string): ExerciseRef[] {
  return localExercisePool.filter((ex) => ex.muscle.includes(muscle) || muscle === "full body" || muscle === "mobility");
}

async function resolveExercisesWithFallback(env: Env, muscle: string, equipment: string): Promise<{ source: string; exercises: ExerciseRef[] }> {
  try {
    const ex = await fetchExerciseDbExercises(env, muscle, equipment);
    if (ex.length > 0) return { source: "catalog", exercises: ex };
  } catch (error) {
    console.warn("[exercise-db]", error);
  }

  return { source: "local_pool", exercises: pickLocalExercises(muscle) };
}

function fallbackExerciseEntriesForPeriod(period: MissionPeriod): ExerciseRef[] {
  if (period !== "daily") return [];

  return [
    { name: "high plank", muscle: "core" },
    { name: "crunch floor", muscle: "core" },
    { name: "air squat", muscle: "legs" },
    { name: "walking", muscle: "legs" },
    { name: "running", muscle: "legs" },
    { name: "stretching", muscle: "mobility" },
    { name: "push-up", muscle: "chest" },
    { name: "dead bug", muscle: "core" },
  ];
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

const INSTRUCTION_STEP_PREFIX_REGEX = new RegExp(String.raw`^\s*(?:step|passo)\s*\d+\s*(?::|\.|\)|-)?\s*`, "iu");
const INSTRUCTION_NUMERIC_PREFIX_REGEX = new RegExp(String.raw`^\s*\d+\s*(?::|\.|\)|-)\s*`, "u");

function sanitizeMissionInstructionText(value: string): string {
  return value
    .replace(INSTRUCTION_STEP_PREFIX_REGEX, "")
    .replace(INSTRUCTION_NUMERIC_PREFIX_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsInstructionText(value: string): boolean {
  return /\p{L}/u.test(value);
}

function ensureInstructionSteps(
  instructions: string[],
  exerciseName: string,
  metricType: MissionMetricType,
  sets: number | null,
  restSeconds: number | null,
): string[] {
  const compact = instructions
    .map((item) => sanitizeMissionInstructionText(item))
    .filter((item) => item.length > 0 && containsInstructionText(item));
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
    .map((item) => sanitizeMissionInstructionText(String(item)))
    .filter((item) => item.length > 0 && containsInstructionText(item))
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

function stripModelJsonFence(raw: string): string {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(t);
  if (fence?.[1]) return fence[1].trim();
  return t;
}

function extractFirstJsonObject(raw: string): string | null {
  const source = stripModelJsonFence(raw).trim();
  const start = source.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseJsonObjectFromModelContent<T>(rawContent: string): T | null {
  const trimmed = stripModelJsonFence(rawContent).trim();
  const candidates = [trimmed, extractFirstJsonObject(trimmed)].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0,
  );

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }

  return null;
}

function parseInstructionListFromLooseModelContent(rawContent: string): string[] | null {
  const instructionStepPrefixPattern = new RegExp(
    String.raw`^\s*(?:step\s*\d+\s*[:.-]?|\d+\s*[.)-:]?\s*|[-*\u2022]\s+)`,
    "i",
  );
  const parsed = parseJsonObjectFromModelContent<{
    instructions_pt?: unknown;
    instructions?: unknown;
    steps?: unknown;
  }>(rawContent);
  const fromJson = normalizeInstructionList(
    parsed?.instructions_pt ?? parsed?.instructions ?? parsed?.steps,
    8,
  );
  if (fromJson.length > 0) {
    return fromJson;
  }

  const lines = stripModelJsonFence(rawContent)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(instructionStepPrefixPattern, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
  const normalized = normalizeInstructionList(lines, 8);
  return normalized.length > 0 ? normalized : null;
}

function parseInstructionsPtFromModelContent(rawContent: string): string[] | null {
  const translated = parseInstructionListFromLooseModelContent(rawContent);
  return translated && translated.length > 0 ? translated : null;
}

/** EN veio da API de exercÃ­cio mas PT estÃ¡ vazio ou ainda Ã© cÃ³pia 1:1 do inglÃªs. */
const ENGLISH_INSTRUCTION_TOKEN_REGEX =
  /\b(with|your|feet|foot|hands?|arms?|body|core|floor|ground|starting|start|position|pause|moment|above|push|pull|straighten|repeat|desired|number|repetitions?|seconds?|hold|keep|slightly|together|bend|bending|lower|raise|return|towards?|while|shoulders?|chest|elbows?|back)\b/i;

function instructionStillLooksEnglish(referenceEn: string, candidatePt: string): boolean {
  const normalizedReference = normalizeMatchText(referenceEn);
  const normalizedCandidate = normalizeMatchText(candidatePt);
  if (!normalizedCandidate) return true;
  if (normalizedCandidate === normalizedReference) return true;
  return ENGLISH_INSTRUCTION_TOKEN_REGEX.test(candidatePt);
}

function exerciseInstructionPtNeedsAiTranslation(en: string[], pt: string[]): boolean {
  const normEn = normalizeInstructionList(en, 8);
  const normPt = normalizeInstructionList(pt, 8);
  if (normEn.length === 0) return false;
  if (normPt.length === 0) return true;
  if (normEn.length !== normPt.length) return true;
  for (let i = 0; i < normEn.length; i++) {
    if (instructionStillLooksEnglish(normEn[i] ?? "", normPt[i] ?? "")) {
      return true;
    }
  }
  return false;
}

function localizeInstructionListFallback(instructionsEn: string[]): string[] {
  return normalizeInstructionList(
    instructionsEn.map((line) => localizeMissionText(line) ?? line),
    8,
  );
}

function finalizeTranslatedInstructionList(referenceEn: string[], candidatePt: string[]): string[] {
  const normalizedReference = normalizeInstructionList(referenceEn, 8);
  const normalizedCandidate = normalizeInstructionList(
    candidatePt.map((line) => localizeMissionText(line) ?? line),
    8,
  );

  if (normalizedReference.length === 0) {
    return normalizedCandidate;
  }

  const fallbackLocalized = localizeInstructionListFallback(normalizedReference);
  const finalized = normalizedReference.map((sourceLine, index) => {
    const translatedLine = normalizedCandidate[index] ?? "";
    if (!translatedLine || instructionStillLooksEnglish(sourceLine, translatedLine)) {
      return fallbackLocalized[index] ?? translatedLine;
    }
    return translatedLine;
  });

  return normalizeInstructionList(finalized, 8);
}

async function translateExerciseInstructionsToPt(
  instructionsEn: string[],
  exerciseName: string,
  env: Env,
): Promise<string[]> {
  const normalizedInstructions = normalizeInstructionList(instructionsEn, 8);
  if (normalizedInstructions.length === 0) return [];
  const apiKey = getHuggingFaceApiKey(env);
  if (!apiKey) {
    return localizeInstructionListFallback(normalizedInstructions);
  }

  const prompt = [
    "Voce traduz passos de execucao de exercicios (ingles) para portugues brasileiro (PT-BR).",
    "Mantenha exatamente o mesmo numero de itens no array, na mesma ordem.",
    "Nao deixe nenhuma palavra em ingles no resultado final.",
    "Preserve numeros, unidades (s, min, kg, repeticoes) e nomes proprios de exercicios quando fizer sentido.",
    "Tom: instrucoes curtas e claras para um app de fitness; sem introducao nem comentarios fora do JSON.",
    `Exercicio: ${exerciseName}`,
    "Responda APENAS JSON valido:",
    '{ "instructions_pt": ["passo 1", "passo 2"] }',
    "",
    `instructions_en: ${JSON.stringify(normalizedInstructions)}`,
  ].join("\n");

  try {
    const rawContent = await requestHuggingFaceStructuredContent(
      apiKey,
      [{ role: "user", content: prompt }],
      900,
      "translateExerciseInstructionsToPt",
      timeoutMsByService.huggingface,
    );
    const translated = parseInstructionsPtFromModelContent(rawContent);
    if (translated && translated.length > 0) {
      const finalized = finalizeTranslatedInstructionList(normalizedInstructions, translated);
      if (finalized.length === normalizedInstructions.length) {
        return finalized;
      }
      if (finalized.length > 0) {
        return finalized;
      }
    }
  } catch (err) {
    console.warn("[translateExerciseInstructionsToPt] model call failed", {
      exerciseName,
      message: getErrorMessage(err),
      details: err instanceof ApiIntegrationError ? err.details : undefined,
    });
  }
  return finalizeTranslatedInstructionList(normalizedInstructions, localizeInstructionListFallback(normalizedInstructions));
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
    const rawContent = await requestHuggingFaceStructuredContent(
      apiKey,
      [{ role: "user", content: prompt }],
      500,
      "getExerciseInstructionsFromAI",
      timeoutMsByService.huggingface,
    );
    const parsed =
      parseJsonObjectFromModelContent<Partial<ExerciseInstructionPayload>>(rawContent) ?? {};
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
  } catch (error) {
    console.warn("[getExerciseInstructionsFromAI] using fallback", {
      exerciseName,
      period,
      message: getErrorMessage(error),
      details: error instanceof ApiIntegrationError ? error.details : undefined,
    });
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

async function topUpStructuredDailyMissionsForUser(
  env: Env,
  db: D1Database,
  userId: string,
  requestedAmount: number,
): Promise<void> {
  const profile = await loadMissionGenerationProfile(db, userId);
  if (!profile) return;

  const boundedRequestedAmount = Math.max(1, Math.min(requestedAmount, MISSION_LIMITS.daily));
  const generationOptions: StructuredGenerationOptions = {
    isAiSpecial: false,
    dailyTarget: MISSION_LIMITS.daily,
    weeklyTarget: 0,
    monthlyTarget: 0,
  };

  const existingDailyBlueprints = await missionPlanPersistenceService.listCurrentCycleRegularDailyBlueprints(
    db,
    userId,
    profile,
  );
  const existingKeys = new Set(
    existingDailyBlueprints.map((blueprint) => `${blueprint.compatibilityKey}:${blueprint.metricType}`),
  );

  const fallbackPlan = buildFallbackStructuredPlan(profile, generationOptions);
  let validation = validateStructuredMissionPlan(fallbackPlan, profile, generationOptions);
  const apiKey = getHuggingFaceApiKey(env);
  let retryReason = "";

  if (apiKey) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const aiPlan = await requestStructuredMissionPlanFromAI(
          env,
          buildStructuredPlanPrompt(profile, generationOptions, retryReason || undefined),
        );
        const aiValidation = validateStructuredMissionPlan(aiPlan, profile, generationOptions);
        const invalidRatio = aiValidation.totalCount > 0
          ? aiValidation.invalidCount / aiValidation.totalCount
          : 0;
        if (invalidRatio > 0.3 && attempt === 0) {
          retryReason = `Mais de 30% das missÃµes diÃ¡rias vieram invÃ¡lidas (${Math.round(invalidRatio * 100)}%). Corrija nomes canÃ´nicos, mÃ©tricas e volume.`;
          continue;
        }
        if (invalidRatio <= 0.3) {
          validation = aiValidation;
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

  const dailyCandidates = validation.blueprints.filter((blueprint) => blueprint.period === "daily");
  const selected: MissionBlueprint[] = [];
  const selectedKeys = new Set<string>();
  const addCandidate = (candidate: MissionBlueprint, allowExistingDuplicate = false) => {
    if (selected.length >= boundedRequestedAmount) return;
    const key = `${candidate.compatibilityKey}:${candidate.metricType}`;
    if (!allowExistingDuplicate && existingKeys.has(key)) return;
    if (selectedKeys.has(key)) return;
    selected.push(candidate);
    selectedKeys.add(key);
  };

  for (const candidate of dailyCandidates) {
    addCandidate(candidate);
  }
  for (const candidate of dailyCandidates) {
    addCandidate(candidate, true);
  }
  while (selected.length < boundedRequestedAmount && dailyCandidates.length > 0) {
    const fallbackCandidate = dailyCandidates[selected.length % dailyCandidates.length];
    if (!fallbackCandidate) break;
    selected.push(fallbackCandidate);
  }

  if (selected.length === 0) return;

  const materialized = await missionPlanPersistenceService.materializeMissionBlueprints(
    env,
    profile,
    selected.slice(0, boundedRequestedAmount),
  );
  await missionPlanPersistenceService.persistMaterializedMissionEntries(db, profile, materialized);
  invalidateMissionListCache(profile.userId);
}

async function createMissionsForPeriod(env: Env, db: D1Database, userId: string, period: MissionPeriod, requestedAmount?: number) {
  if (period !== "daily") {
    const boundedRequestedAmount = Math.max(1, Math.min(requestedAmount ?? MISSION_LIMITS[period], MISSION_LIMITS[period]));
    const activeCounts = await getActiveCycleMissionCounts(db, userId, "regular");
    if (activeCounts.daily === 0) {
      await createMissionsForPeriod(env, db, userId, "daily", MISSION_LIMITS.daily);
    }
    await missionPlanPersistenceService.ensureStructuredPeriodicMissionsFromExistingDailyBlueprints(env, db, userId, {
      weeklyTarget: period === "weekly" ? boundedRequestedAmount : 0,
      monthlyTarget: period === "monthly" ? boundedRequestedAmount : 0,
    });
    return;
  }

  const boundedRequestedAmount = Math.max(1, Math.min(requestedAmount ?? MISSION_LIMITS.daily, MISSION_LIMITS.daily));
  await topUpStructuredDailyMissionsForUser(env, db, userId, boundedRequestedAmount);
  return;

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

  const profileMainGoal = profile?.main_goal;
  const rawMainGoal = String(profileMainGoal ?? "");
  const mainGoal = rawMainGoal.trim();
  const profileConditioning = profile?.initial_conditioning;
  const conditioningSource = String(profileConditioning ?? "");
  if (!mainGoal || !conditioningSource) {
    console.warn(`[missions] dados obrigatorios ausentes para ${userId}`);
    return;
  }

  const conditioning = normalizeConditioning(conditioningSource);
  const profileInjuries = profile?.injuries;
  const rawInjuries = String(profileInjuries ?? "");
  const injuries = rawInjuries;
  const profileEquipment = profile?.equipment;
  const rawEquipment = String(profileEquipment ?? "");
  const equipment = rawEquipment;
  const profileActiveSkillFocus = profile?.active_skill_focus;
  const rawActiveSkillFocus = String(profileActiveSkillFocus ?? "");
  const activeSkillFocus = rawActiveSkillFocus.trim();
  const completedCount = Number(history?.completed_count ?? 0);
  const failedCount = Number(history?.failed_count ?? 0);
  const currentRate = completionRate(completedCount, failedCount);
  const weekKey = currentWeekKey();
  const previousPlanRaw = parseStoredPlanRecord(planRow?.weekly_plan_json);
  const chatPlanPreferences = normalizeTrainingPlanChatPreferences(previousPlanRaw?.chat_preferences);
  const profileHash = buildPlanProfileHash(mainGoal, conditioning, injuries, equipment, chatPlanPreferences);
  const previousWeekKeyRaw = previousPlanRaw?.week_key;
  const previousWeekKey = typeof previousWeekKeyRaw === "string" ? previousWeekKeyRaw : "";
  const previousHashRaw = previousPlanRaw?.profile_hash;
  const previousHash = typeof previousHashRaw === "string" ? previousHashRaw : "";
  const previousVolumeMultiplierRaw = previousPlanRaw?.volume_multiplier;
  const previousVolumeMultiplierValue = Number(previousVolumeMultiplierRaw ?? 1);
  const previousVolumeMultiplier = Number.isFinite(previousVolumeMultiplierValue) ? previousVolumeMultiplierValue : 1;
  const trainingFrequency = normalizeTrainingFrequencyInput(planRow?.training_frequency);
  const volumeMultiplier = normalizeVolumeMultiplier(previousVolumeMultiplier, currentRate);
  const mustRegeneratePlan = !previousPlanRaw || previousWeekKey !== weekKey || previousHash !== profileHash;

  const fallbackPlan = await buildInitialTrainingPlan(mainGoal, conditioning, equipment, injuries);
  const fallbackWeekly = typeof fallbackPlan.weekly === "object" && fallbackPlan.weekly !== null
    ? fallbackPlan.weekly as Record<string, unknown>
    : {};
  const normalizedWeeklyPlan = {} as Record<WeekdayPtBr, WeeklyPlanDay>;
  for (const day of WEEKDAY_ORDER) {
    const previousWeekly = previousPlanRaw?.weekly;
    const daySource = mustRegeneratePlan
      ? fallbackWeekly[day]
      : (typeof previousWeekly === "object" && previousWeekly !== null
        ? (previousWeekly as Record<string, unknown>)[day]
        : fallbackWeekly[day]);
    normalizedWeeklyPlan[day] = normalizeWeeklyPlanDay(daySource, day, ["full body"]);
  }

  const weeklyPlanApiKeyValue = getHuggingFaceApiKey(env) ?? "";
  if (mustRegeneratePlan && weeklyPlanApiKeyValue.length > 0) {
    const capacitySummary = buildCapacitySummary(capacityRows.results);
    const aiPlanPrompt = [
      "Gere um plano semanal de treino e responda APENAS JSON valido com chave weekly e progression_expected.",
      "Cada dia da semana deve conter focus, muscles[], exercises[], intensity e rest_day.",
      "Varie exercicios por dia (empurrar, puxar, pernas, core, cardio leve); no maximo 1 dia com foco dominante em alongamento/mobilidade por semana.",
      `Objetivo: ${mainGoal}`,
      `Condicionamento: ${conditioning}`,
      `Lesoes/restricoes: ${injuries || "nenhuma"}`,
      `Equipamentos: ${equipment || "nenhum"}`,
      `Taxa de conclusao da semana anterior: ${(currentRate * 100).toFixed(1)}%`,
      `Habilidades e desempenho do usuario (priorizar nomes alinhados a estas skills nos exercicios): ${capacitySummary}`,
      activeSkillFocus ? `Foco ativo de habilidade no perfil (prioridade nos exercicios diarios): ${activeSkillFocus}` : "",
      chatPlanPreferences ? `Preferencia ativa do usuario vinda do chat para as proximas geracoes: ${summarizeTrainingPlanChatPreferences(chatPlanPreferences)}. Essa preferencia substitui instrucoes anteriores conflitantes.` : "",
      `Ajuste de volume obrigatorio: ${Math.round(volumeMultiplier * 100)}% do baseline, variando no maximo 10%.`,
      MISSION_METRIC_RULES_PROMPT,
    ]
      .filter((line) => line.length > 0)
      .join("\n");

    try {
      const content = await requestHuggingFaceStructuredContent(
        weeklyPlanApiKeyValue,
        [{ role: "user", content: aiPlanPrompt }],
        1200,
        "weeklyTrainingPlan",
        timeoutMsByService.huggingface,
      );
      const parsed = parseJsonObjectFromModelContent<Record<string, unknown>>(content) ?? {};
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

  const serializedChatPlanPreferences = serializeTrainingPlanChatPreferences(chatPlanPreferences);
  const planToStore = {
    week_key: weekKey,
    profile_hash: profileHash,
    volume_multiplier: volumeMultiplier,
    progression_expected: "Progressao semanal ajustada em no maximo 10% conforme taxa de conclusao.",
    weekly: normalizedWeeklyPlan,
    ...(serializedChatPlanPreferences ? { chat_preferences: serializedChatPlanPreferences } : {}),
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
    const supportedExerciseName = resolveSupportedMissionExerciseName(exerciseName) ?? exerciseName;
    const initialMetricHintRaw = getMissionMetricType(supportedExerciseName);
    const initialMetricHint = period === "daily" && initialMetricHintRaw === "circuit_tasks"
      ? "sets_reps"
      : initialMetricHintRaw;
    const shouldEnrichWithExerciseApi = period === "daily";

    const [enriched, precomputedAiContext] = await Promise.all([
      shouldEnrichWithExerciseApi
        ? enrichExercise(supportedExerciseName, env).catch(() => null)
        : Promise.resolve(null),
      getExerciseInstructionsFromAI(
        supportedExerciseName,
        initialMetricHint,
        conditioning,
        env,
        period,
        promptContext,
      ).catch(() => null),
    ]);

    const resolvedName = shouldEnrichWithExerciseApi
      ? (enriched?.name || supportedExerciseName)
      : supportedExerciseName;
    const metricHintRaw = getMissionMetricType(resolvedName);
    const metricHint = period === "daily" && metricHintRaw === "circuit_tasks" ? "sets_reps" : metricHintRaw;
    const canReuseAiContext =
      precomputedAiContext !== null &&
      normalizeMatchText(resolvedName) === normalizeMatchText(supportedExerciseName) &&
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
    const localizedApiInstructionsPt = localizeMissionTextArray(apiInstructionsPt);

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
      exerciseDbId: enriched?.id,
      muscle: shouldEnrichWithExerciseApi ? (enriched?.target || muscle) : muscle,
      imageUrl: missionMediaUrl ?? undefined,
      exerciseDbGifUrl: enriched?.exerciseDbGifUrl ?? undefined,
      exerciseDbImageUrl: enriched?.exerciseDbImageUrl ?? undefined,
      exerciseEquipment: enriched?.equipment || undefined,
      exerciseBodyPart: enriched?.bodyPart || undefined,
      exerciseTarget: enriched?.target || muscle,
      exerciseSecondaryMuscles: enriched?.secondaryMuscles ?? [],
      exerciseInstructionsEn: apiInstructionsEn,
      exerciseInstructionsPt: localizedApiInstructionsPt,
      videoUrl: enriched?.videoUrl ?? undefined,
      thumbnailUrl: enriched?.thumbnailUrl ?? undefined,
      instruction: safeGet(localizedApiInstructionsPt.length > 0 ? localizedApiInstructionsPt : apiInstructionsEn, 0),
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
    let mergedInstructionSource = localizedApiInstructionsPt.slice(0, 6);
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
    withMetric.exercise_instructions_pt = localizedApiInstructionsPt;
    withMetric.safety_tips = aiContext.safetyTips.length > 0 ? aiContext.safetyTips.slice(0, 4) : withMetric.safety_tips;
    withMetric.muscle_groups = apiMuscles;
    withMetric.exercise_secondary_muscles = mergeUniqueStrings(
      Array.isArray(enriched?.secondaryMuscles) ? enriched.secondaryMuscles : [],
      8,
    );
    withMetric.exercise_name = resolveExerciseDisplayNamePt(resolvedName) ?? resolvedName;
    withMetric.exercise_db_id = enriched?.id ?? withMetric.exercise_db_id;
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
      withMetric.exercise_db_id = null;
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
  const selectedEntries = selectDailyMissionExerciseEntries({
    targetAmount,
    primaryMuscle,
    conditioning,
    dayPlan,
    capacityRows,
    sourceExercises: sourceExercises.exercises,
    activeSkillFocus,
  });
  const built = await mapWithConcurrency(
    selectedEntries,
    2,
    async (entry) => buildFromExercise(entry.name, entry.muscle),
  );
  missionsToInsert.push(...built);

  const fallbackPool = fallbackExerciseEntriesForPeriod("daily");
  while (missionsToInsert.length < targetAmount) {
    const fallback = fallbackPool[missionsToInsert.length % fallbackPool.length];
    if (!fallback) break;
    missionsToInsert.push(await buildFromExercise(fallback.name, fallback.muscle));
  }

  for (const mission of missionsToInsert.slice(0, targetAmount)) {
    const skillId = await resolveSkillIdForExerciseMission(db, userId, mission.exercise_name);
    await insertMission(db, userId, period, deadline, mission, skillId);
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
  chatPlanPreferences: TrainingPlanChatPreferences | null;
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

type MonthlyCounterSource =
  | "missions_completed"
  | "steps"
  | "distance_meters"
  | "streak_days"
  | "weekly_circuits_completed";

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

function monthlyDistanceMetersTarget(profile: MissionGenerationProfileSnapshot, boost = 0): number {
  const goal = normalizeGoalKeyword(profile.mainGoal);
  let estimated = 18_000 + Math.max(0, profile.trainingFrequency - 3) * 3_500 + boost;
  if (
    goal.includes("perda") ||
    goal.includes("emagrec") ||
    goal.includes("condicion") ||
    goal.includes("resist") ||
    goal.includes("corrid") ||
    goal.includes("caminha") ||
    goal.includes("cardio")
  ) {
    estimated += 8_000;
  }
  if (profile.conditioning === "intermediario") estimated += 4_000;
  if (profile.conditioning === "avancado") estimated += 8_000;
  return clampMonthlyTarget(estimated, 18_000, 60_000, 1_000);
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
  if (source === "steps") {
    return `${formatIntegerPtBr(metricValue)} passos acumulados`;
  }
  if (source === "distance_meters") {
    const kilometers = metricValue / 1000;
    return `${kilometers.toLocaleString("pt-BR", {
      minimumFractionDigits: kilometers % 1 === 0 ? 0 : 1,
      maximumFractionDigits: 1,
    })} km acumulados`;
  }
  if (source === "streak_days") {
    return `${formatIntegerPtBr(metricValue)} dias ativos no mÃªs`;
  }
  if (source === "weekly_circuits_completed") {
    return `${formatIntegerPtBr(metricValue)} circuitos semanais concluÃ­dos`;
  }
  return `${formatIntegerPtBr(metricValue)} missÃµes concluÃ­das`;
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
  const distanceTarget = monthlyDistanceMetersTarget(profile);
  const activeDaysTarget = monthlyActiveDaysTarget(profile);
  const mainGoal = normalizeGoalKeyword(profile.mainGoal);

  const goalBasedChallenge = mainGoal.includes("flex")
    || mainGoal.includes("mobil")
    || mainGoal.includes("along")
    || mainGoal.includes("yoga")
    ? {
      name: "PrÃ¡tica Ativa do MÃªs",
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
      : mainGoal.includes("cardio")
        || mainGoal.includes("condicion")
        || mainGoal.includes("perda")
        || mainGoal.includes("corrid")
        || mainGoal.includes("caminha")
        ? {
          name: "Desafio Cardio do MÃªs",
          source: "distance_meters" as MonthlyCounterSource,
          metricType: "distance_meters" as MissionMetricType,
          metricValue: monthlyDistanceMetersTarget(profile, 8_000),
          muscle: "legs",
        }
        : {
          name: "Circuitos Semanais ConcluÃ­dos",
          source: "weekly_circuits_completed" as MonthlyCounterSource,
          metricType: "repetitions" as MissionMetricType,
          metricValue: monthlyWeeklyCircuitTarget(profile),
          muscle: "full body",
        };

  const definitions = [
    {
      name: "ConsistÃªncia Mensal de MissÃµes",
      source: "missions_completed" as MonthlyCounterSource,
      metricType: "repetitions" as MissionMetricType,
      metricValue: missionTarget,
      muscle: "full body",
    },
    {
      name: "Passos do MÃªs",
      source: "steps" as MonthlyCounterSource,
      metricType: "steps" as MissionMetricType,
      metricValue: stepsTarget,
      muscle: "legs",
    },
    {
      name: "DistÃ¢ncia Mensal Acumulada",
      source: "distance_meters" as MonthlyCounterSource,
      metricType: "distance_meters" as MissionMetricType,
      metricValue: distanceTarget,
      muscle: "legs",
    },
    {
      name: "Dias Ativos no MÃªs",
      source: "streak_days" as MonthlyCounterSource,
      metricType: "repetitions" as MissionMetricType,
      metricValue: activeDaysTarget,
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

const MISSION_GENERATION_AI_TIMEOUT_MS = 8_000;

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
  const previousPlanRaw = parseStoredPlanRecord(planRow?.weekly_plan_json);
  const chatPlanPreferences = normalizeTrainingPlanChatPreferences(previousPlanRaw?.chat_preferences);
  const profileHash = buildPlanProfileHash(mainGoal, conditioning, injuries, equipment, chatPlanPreferences);
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
    chatPlanPreferences,
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
  const activeChatPreferenceSummary = summarizeTrainingPlanChatPreferences(profile.chatPlanPreferences);

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
    activeChatPreferenceSummary.length > 0
      ? `Preferencia ativa do usuario vinda do chat: ${activeChatPreferenceSummary}. Essa preferencia substitui qualquer foco anterior conflitante e deve orientar as proximas geracoes.`
      : "",
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

  const content = await requestHuggingFaceStructuredContent(
    apiKey,
    [{ role: "user", content: prompt }],
    2200,
    "requestStructuredMissionPlanFromAI",
    MISSION_GENERATION_AI_TIMEOUT_MS,
  );
  const parsed = parseJsonObjectFromModelContent<StructuredMissionPlanDraft>(content);
  if (!parsed) {
    throw new ApiIntegrationError("INVALID_RESPONSE", 502, "Plano estruturado invalido retornado pela IA.");
  }
  return parsed;
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

    const name = toSafeString(source.name, `${params.period === "weekly" ? "MissÃ£o Semanal" : "MissÃ£o Mensal"} ${index + 1}`);
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
    const rawName = toSafeString(draft.name, `Missao Diaria ${blueprints.length + 1}`);
    const supportedExerciseName = resolveSupportedMissionExerciseName(rawName) ?? rawName;
    const name = resolveExerciseDisplayNamePt(supportedExerciseName) ?? rawName;
    if (normalizeMatchText(rawName) !== normalizeMatchText(supportedExerciseName)) {
      invalidCount += 1;
    }
    const description = toSafeString(draft.description, `Complete a meta proposta em ${name}.`);
    const exerciseType = toSafeString(draft.exercise_type, name);
    const muscleGroup = toSafeString(draft.muscle_group, "full body");
    const expectedMetricType = getMissionMetricType(`${supportedExerciseName} ${exerciseType} ${muscleGroup}`);
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

    const metricType = structuredMetricTypeToMissionMetric(
      draft.metric_type,
      supportedExerciseName,
      exerciseType,
      muscleGroup,
      "daily",
    );
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
      exerciseName: supportedExerciseName,
      muscle: muscleGroup,
      metricType,
      metricValue,
      xpReward,
      pointsReward,
      difficultyLevel: normalizeDifficultyLabel(draft.difficulty, profile.conditioning),
      missionOrigin: options.isAiSpecial ? "ai" : "regular",
      isAiSpecial: options.isAiSpecial,
      compatibilityKey: normalizeMatchText(extractExerciseName(supportedExerciseName)),
      compatibilityTerms: buildMissionCompatibilityTerms(`${name} ${supportedExerciseName}`, muscleGroup, metricType),
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
    const rawName = toSafeString(fallbackDraft.name, `Missao Diaria ${blueprints.length + 1}`);
    const supportedExerciseName = resolveSupportedMissionExerciseName(rawName) ?? rawName;
    const name = resolveExerciseDisplayNamePt(supportedExerciseName) ?? rawName;
    const muscleGroup = toSafeString(fallbackDraft.muscle_group, "full body");
    const metricType = structuredMetricTypeToMissionMetric(
      fallbackDraft.metric_type,
      supportedExerciseName,
      String(fallbackDraft.exercise_type ?? supportedExerciseName),
      muscleGroup,
      "daily",
    );
    blueprints.push({
      period: "daily",
      name,
      description: toSafeString(fallbackDraft.description, `Complete a meta proposta em ${name}.`),
      goal: null,
      exerciseName: supportedExerciseName,
      muscle: muscleGroup,
      metricType,
      metricValue: convertStructuredMetricValue(metricType, fallbackDraft.reps_or_value, fallbackDraft.unit),
      xpReward: clampXpRewardByPeriod("daily", fallbackDraft.xp_reward),
      pointsReward: derivePointsRewardByPeriod("daily", fallbackDraft.fitcoins_reward, clampXpRewardByPeriod("daily", fallbackDraft.xp_reward)),
      difficultyLevel: normalizeDifficultyLabel(fallbackDraft.difficulty, profile.conditioning),
      missionOrigin: options.isAiSpecial ? "ai" : "regular",
      isAiSpecial: options.isAiSpecial,
      compatibilityKey: normalizeMatchText(extractExerciseName(supportedExerciseName)),
      compatibilityTerms: buildMissionCompatibilityTerms(`${name} ${supportedExerciseName}`, muscleGroup, metricType),
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
  const supportedExerciseName = shouldEnrichWithExerciseApi
    ? (resolveSupportedMissionExerciseName(blueprint.exerciseName) ?? blueprint.exerciseName)
    : blueprint.exerciseName;
  const [enriched, aiContext] = await Promise.all([
    shouldEnrichWithExerciseApi
      ? enrichExercise(supportedExerciseName, env).catch(() => null)
      : Promise.resolve(null),
    getExerciseInstructionsFromAI(
      supportedExerciseName,
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
  const apiInstructionsPt = await translateExerciseInstructionsToPt(apiInstructionsEn, supportedExerciseName, env);
  const localizedApiInstructionsPt = localizeMissionTextArray(apiInstructionsPt);
  const resolvedName = shouldEnrichWithExerciseApi
    ? (enriched?.name || supportedExerciseName)
    : supportedExerciseName;
  const baseMission = buildMissionPayload({
    period: blueprint.period,
    titlePrefix: config.titlePrefix,
    exerciseName: resolvedName,
    exerciseDbId: enriched?.id,
    muscle: shouldEnrichWithExerciseApi ? (enriched?.target || blueprint.muscle) : blueprint.muscle,
    imageUrl: shouldEnrichWithExerciseApi ? (enriched?.imageUrl ?? undefined) : undefined,
    exerciseDbGifUrl: shouldEnrichWithExerciseApi ? (enriched?.exerciseDbGifUrl ?? undefined) : undefined,
    exerciseDbImageUrl: shouldEnrichWithExerciseApi ? (enriched?.exerciseDbImageUrl ?? undefined) : undefined,
    exerciseEquipment: shouldEnrichWithExerciseApi ? (enriched?.equipment || undefined) : undefined,
    exerciseBodyPart: shouldEnrichWithExerciseApi ? (enriched?.bodyPart || undefined) : undefined,
    exerciseTarget: shouldEnrichWithExerciseApi ? (enriched?.target || blueprint.muscle) : undefined,
    exerciseSecondaryMuscles: enriched?.secondaryMuscles ?? [],
    exerciseInstructionsEn: apiInstructionsEn,
    exerciseInstructionsPt: localizedApiInstructionsPt,
    videoUrl: shouldEnrichWithExerciseApi ? (enriched?.videoUrl ?? undefined) : undefined,
    thumbnailUrl: shouldEnrichWithExerciseApi ? (enriched?.thumbnailUrl ?? undefined) : undefined,
    instruction: safeGet(localizedApiInstructionsPt.length > 0 ? localizedApiInstructionsPt : apiInstructionsEn, 0),
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
    withMetric.title = `${config.titlePrefix}: ${resolveExerciseDisplayNamePt(enriched?.name ?? supportedExerciseName) ?? blueprint.name}`;
    withMetric.mission_origin = blueprint.missionOrigin;
    withMetric.is_ai_special = blueprint.isAiSpecial ? 1 : 0;
    withMetric.instructions = ensureInstructionSteps(
      localizedApiInstructionsPt.length > 0 ? localizedApiInstructionsPt : withMetric.instructions,
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
    withMetric.exercise_instructions_pt = localizedApiInstructionsPt;
    withMetric.safety_tips = aiContext?.safetyTips?.length ? aiContext.safetyTips.slice(0, 4) : withMetric.safety_tips;
    withMetric.difficulty_level = blueprint.difficultyLevel;
    withMetric.exercise_name = resolveExerciseDisplayNamePt(enriched?.name ?? resolvedName) ?? (enriched?.name ?? resolvedName);
    withMetric.exercise_db_id = enriched?.id ?? withMetric.exercise_db_id;
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
    const targetMetricValue = Math.max(1, Math.round(blueprint.metricValue));
    const withMetric: MissionPayload = {
      ...baseMission,
      title: `${config.titlePrefix}: ${blueprint.name}`,
      description: "",
      goal: blueprint.goal,
      metric_type: blueprint.metricType,
      metric_value: targetMetricValue,
      metric_unit: metricUnitByType(blueprint.metricType),
      sets: null,
      rest_seconds: null,
      instructions: [],
      exercise_instructions_en: [],
      exercise_instructions_pt: [],
      image_url: null,
      exercise_db_gif_url: null,
      exercise_db_image_url: null,
      muscle_groups: [],
      exercise_secondary_muscles: [],
      exercise_name: null,
      exercise_db_id: null,
      exercise_equipment: null,
      exercise_body_part: null,
      exercise_target: null,
      exercise_type: blueprint.metricType === "steps" || blueprint.metricType === "distance_meters" ? "cardio" : "forca",
      body_area: blueprint.metricType === "steps" || blueprint.metricType === "distance_meters" ? "lower" : "full_body",
      attributes_benefited: [],
      duration_estimate_minutes: null,
      exercise_category: blueprint.metricType === "steps" || blueprint.metricType === "distance_meters" ? "walk" : "default",
      mission_origin: blueprint.missionOrigin,
      is_ai_special: blueprint.isAiSpecial ? 1 : 0,
      circuit_tasks: [],
      safety_tips: [],
      difficulty_level: blueprint.difficultyLevel,
      video_url: null,
      thumbnail_url: null,
      target_reps: null,
      target_time: null,
    };
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
    withMetric.exercise_db_id = null;
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
    withMetric.target_reps = null;
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
      localizedApiInstructionsPt.length > 0 ? localizedApiInstructionsPt : baseMission.instructions,
      resolvedName,
      "circuit_tasks",
      null,
      null,
    ),
    exercise_instructions_en: apiInstructionsEn,
    exercise_instructions_pt: localizedApiInstructionsPt,
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


// AI-powered endpoints



function shouldInspectTrainingPlanPreferenceRequest(message: string): boolean {
  const normalized = normalizeMatchText(message);
  if (normalized.length === 0) return false;

  const planContextKeywords = [
    "plano",
    "rotina",
    "missao",
    "missoes",
    "proxim",
    "daqui pra frente",
    "a partir de agora",
  ];
  const changeIntentKeywords = [
    "adicion",
    "inclu",
    "apli",
    "salv",
    "ajust",
    "muda",
    "troca",
    "substit",
    "adapt",
    "configur",
    "quero",
    "prefiro",
    "deixa",
    "usa",
    "use",
  ];
  const focusKeywords = [
    "foco",
    "forca",
    "resistencia",
    "resist",
    "condicion",
    "mobilidade",
    "flexibilidade",
    "hipertrof",
    "massa",
    "emagrec",
    "curta",
    "rapido",
  ];

  const hasPlanContext = planContextKeywords.some((keyword) => normalized.includes(keyword));
  const hasChangeIntent = changeIntentKeywords.some((keyword) => normalized.includes(keyword));
  const hasFocusKeyword = focusKeywords.some((keyword) => normalized.includes(keyword));
  const mentionsTraining = normalized.includes("treino");

  return (hasPlanContext && hasChangeIntent)
    || (hasFocusKeyword && hasChangeIntent && (hasPlanContext || mentionsTraining));
}

async function maybeApplyTrainingPlanPreferenceFromChat(
  c: import("hono").Context<AppContext>,
  params: {
    userId: string;
    userMessage: string;
    mainGoal: string;
    conditioning: ConditioningLevel;
    equipment: string;
    injuries: string;
    trainingFrequency: number;
    existingPlanJson: string | null;
    activePreferences: TrainingPlanChatPreferences | null;
  },
): Promise<TrainingPlanChatPreferences | null> {
  if (!shouldInspectTrainingPlanPreferenceRequest(params.userMessage)) {
    return null;
  }

  const currentPreferenceSummary = summarizeTrainingPlanChatPreferences(params.activePreferences);
  const classificationPrompt = [
    "Analise se a mensagem do usuario pede para alterar a abordagem do plano de treino futuro que orienta a geracao das proximas missoes.",
    "Considere como alteracao valida pedidos como foco em forca, resistencia, hipertrofia, condicionamento, emagrecimento, mobilidade, flexibilidade, rotina curta, treinos rapidos ou adaptacao da rotina.",
    "Nao marque alteracao quando o usuario estiver apenas tirando uma duvida geral, pedindo explicacao de exercicio, falando de dor sem pedir mudanca de plano, ou comentando desempenho sem pedir ajuste futuro.",
    "Se houver nova preferencia, ela substitui a anterior.",
    "Responda APENAS JSON valido neste formato:",
    '{"should_update_training_plan":false,"plan_focus":null,"routine_style":null,"summary":null,"constraints":[]}',
  ].join("\n");

  const classificationUserMessage = [
    `Mensagem do usuario: ${params.userMessage}`,
    `Objetivo atual: ${params.mainGoal}`,
    `Condicionamento atual: ${params.conditioning}`,
    `Treinos por semana: ${params.trainingFrequency}`,
    currentPreferenceSummary.length > 0 ? `Preferencia ativa atual: ${currentPreferenceSummary}` : "Preferencia ativa atual: nenhuma",
  ].join("\n");

  try {
    const classificationResponse = await callOpenAIChatWithFallback(
      c,
      [
        { role: "system", content: classificationPrompt },
        { role: "user", content: classificationUserMessage },
      ],
      220,
      true,
    );
    const rawContent = safeGet(classificationResponse.choices ?? [], 0)?.message?.content ?? "";
    const parsed = parseJsonObjectFromModelContent<Record<string, unknown>>(rawContent);
    const shouldUpdateTrainingPlan = parsed
      ? parsed.should_update_training_plan === true || parsed.should_update_training_plan === "true"
      : false;
    if (!shouldUpdateTrainingPlan) {
      return null;
    }
    if (!parsed) {
      return null;
    }

    const normalizedPreferences = normalizeTrainingPlanChatPreferences({
      plan_focus: parsed.plan_focus,
      routine_style: parsed.routine_style,
      summary: parsed.summary,
      constraints: parsed.constraints,
      user_request: params.userMessage,
      updated_at: new Date().toISOString(),
    });
    if (!normalizedPreferences) {
      return null;
    }

    const existingPlan = parseStoredPlanRecord(params.existingPlanJson)
      ?? (await buildInitialTrainingPlan(
        params.mainGoal,
        params.conditioning,
        params.equipment,
        params.injuries,
      )) as Record<string, unknown>;
    const nextPlan: Record<string, unknown> = {
      ...existingPlan,
      chat_preferences: serializeTrainingPlanChatPreferences(normalizedPreferences),
      profile_hash: "",
      week_key: currentWeekKey(),
    };

    await upsertTrainingPlan(
      c.env.fitloot_db,
      params.userId,
      nextPlan,
      params.mainGoal,
      params.conditioning,
      params.equipment,
      params.injuries,
      params.trainingFrequency,
    );

    return normalizedPreferences;
  } catch (error) {
    console.warn("[ai-chat][plan-preference]", {
      userId: params.userId,
      message: getErrorMessage(error),
      details: error instanceof ApiIntegrationError ? error.details : undefined,
    });
    return null;
  }
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
  const rawExerciseName = toSafeString(raw.skill_name ?? raw.title, baseTitle);
  const exerciseName = resolveSupportedMissionExerciseName(rawExerciseName) ?? rawExerciseName;
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
    title: toSafeString(raw.title, `Missao Diaria: ${resolveExerciseDisplayNamePt(exerciseName) ?? exerciseName}`),
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
      const content = await requestHuggingFaceStructuredContent(
        apiKey,
        [{ role: "user", content: aiPrompt }],
        800,
        "legacyDailyMissionGenerator",
        timeoutMsByService.huggingface,
      );
      const parsed = parseJsonObjectFromModelContent<{ missions?: MissionDraft[] }>(content) ?? {};
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

      const rawExerciseName = extractExerciseName(mission.title);
      const exerciseName = resolveSupportedMissionExerciseName(rawExerciseName) ?? rawExerciseName;
      const shouldEnrichWithExerciseApi = missionPeriod === "daily";
      const [enrichedMedia, aiContext] = await Promise.all([
        shouldEnrichWithExerciseApi
          ? enrichExercise(exerciseName, env, {
            exerciseDbId: mission.exercise_db_id ?? null,
          }).catch(() => null)
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
      const localizedApiInstructionsPt = localizeMissionTextArray(apiInstructionsPt);
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
          exercise_db_id: mission.exercise_db_id ?? enrichedMedia?.id ?? null,
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
          exercise_instructions_pt: mission.exercise_instructions_pt.length > 0 ? mission.exercise_instructions_pt : localizedApiInstructionsPt,
          video_url: mission.video_url ?? enrichedMedia?.videoUrl ?? null,
          thumbnail_url: mission.thumbnail_url ?? enrichedMedia?.thumbnailUrl ?? null,
        },
        missionPeriod,
        exerciseName,
        aiContext.metricType,
        aiContext.metricValue
      );

      const aiInstructionSource = normalizeInstructionList(aiContext.instructions, 6);
      let mergedInstructionSource = localizedApiInstructionsPt.slice(0, 6);
      if (mergedInstructionSource.length < 4) {
        mergedInstructionSource = mergeUniqueStrings([...mergedInstructionSource, ...aiInstructionSource], 6);
      }
      if (mergedInstructionSource.length === 0) {
        mergedInstructionSource = aiInstructionSource;
      }

      const combinedMuscles = resolveExerciseApiMuscleGroups(enrichedMedia);
      const displayExerciseName =
        resolveExerciseDisplayNamePt(enrichedMedia?.name || exerciseName)
        ?? (resolveExerciseDisplayNamePt(rawExerciseName) ?? rawExerciseName);

      const withDetails: MissionPayload = {
        ...withMetric,
        mission_origin: "ai",
        title: missionPeriod === "daily" ? `Missao Diaria: ${displayExerciseName}` : mission.title,
        instructions: ensureInstructionSteps(
          mergedInstructionSource.length > 0 ? mergedInstructionSource : withMetric.instructions,
          exerciseName,
          withMetric.metric_type,
          withMetric.sets,
          withMetric.rest_seconds,
        ),
        exercise_instructions_en: apiInstructionsEn,
        exercise_instructions_pt: localizedApiInstructionsPt,
        safety_tips: aiContext.safetyTips.length > 0 ? aiContext.safetyTips.slice(0, 4) : withMetric.safety_tips,
        difficulty_level: aiContext.difficultyLevel,
        muscle_groups: combinedMuscles,
        exercise_secondary_muscles: mergeUniqueStrings(
          Array.isArray(enrichedMedia?.secondaryMuscles) ? enrichedMedia.secondaryMuscles : [],
          8,
        ),
        exercise_name: resolveExerciseDisplayNamePt(enrichedMedia?.name || (withMetric.exercise_name ?? exerciseName))
          ?? (enrichedMedia?.name || (withMetric.exercise_name ?? exerciseName)),
        exercise_db_id: enrichedMedia?.id ?? withMetric.exercise_db_id,
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
        withDetails.exercise_db_id = null;
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
    const exerciseLabel =
      typeof mission.exercise_name === "string" && mission.exercise_name.trim().length > 0
        ? mission.exercise_name.trim()
        : extractExerciseName(toSafeString(mission.title, ""));
    const skillId = await resolveSkillIdForExerciseMission(db, userId, exerciseLabel);

    await insertMission(
      db,
      userId,
      entry.period,
      entry.deadline,
      entry.mission,
      skillId,
    );
  }

  invalidateMissionListCache(userId);

  return {
    missions: aiMissionEntries.map((entry) => ({ ...entry.mission, type: entry.period })),
    fallback,
    error,
  };
}



registerAiRoutes(app, {
  ApiIntegrationError,
  authMiddleware,
  callOpenAIChatWithFallback,
  ensureMissionJobSchema,
  ensureUserCounterRow,
  enforceRateLimit,
  fetchJsonWithTimeout,
  generateAiMissionsForUser,
  logUserEvent,
  maybeApplyTrainingPlanPreferenceFromChat: (c, params) =>
    maybeApplyTrainingPlanPreferenceFromChat(c, {
      ...params,
      conditioning: params.conditioning as ConditioningLevel,
      activePreferences: params.activePreferences as TrainingPlanChatPreferences | null,
    }),
  normalizeConditioning,
  normalizeMatchText,
  normalizeTrainingFrequencyInput,
  normalizeTrainingPlanChatPreferences,
  onChatMessage,
  parseJsonObjectFromModelContent,
  parseStoredPlanRecord,
  requestHuggingFaceVisionStructuredContent,
  summarizeTrainingPlanChatPreferences: (preferences) =>
    summarizeTrainingPlanChatPreferences(
      preferences as TrainingPlanChatPreferences | null,
    ),
  timeoutMsByService,
  toFriendlyErrorResponse,
  unlockAchievementIfNeeded,
});

registerHealthRoutes(app, { authMiddleware });


// -----------------------------
// SPA fallback (APENAS apÃ³s todas as rotas /api/* definidas)
// -----------------------------
app.get("*", async (c, next) => {
  // Se for rota API, passa adiante para as rotas definidas
  if (c.req.path.startsWith("/api")) {
    return next();
  }

  try {
    // c.req Ã© um Request vÃ¡lido para passar ao binding ASSETS
    return await c.env.ASSETS.fetch(c.req.raw);
  } catch {
    // se falhar, passa para prÃ³ximos handlers (ou 404)
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


