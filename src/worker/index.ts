import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  MiniGameChallengeRequestSchema,
  MiniGameCompleteRequestSchema,
  ConditioningLevel,
  MissionMetricType,
  CircuitTask,
} from "../shared/types";
import {
  resolveExerciseDisplayNamePt,
  resolveExerciseMediaFallbackUrlById,
  isSupportedRouteMissionExercise,
  resolveSupportedMissionExerciseName,
} from "../shared/exerciseCatalog";

import {
  localizeMissionText,
  localizeMissionTextArray,
} from "../shared/missionLocalization";
import {
  calculateRankBenchmarkScore,
  calculateRankConsistencyScore,
  calculateSkillMasteryScore,
  calculateVolumeScore,
  clamp as clampTrainingRankScore,
  scoreToTrainingRank,
} from "../shared/trainingLevels";
import {
  classifyMission,
  getMissionMetricType,
  metricUnitByType,
  shouldShowMissionDuration,
} from "../constants/missionMetrics";
import {
  DEFAULT_SETTLED_MISSION_RETENTION_MODIFIER,
  SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD,
} from "./constants/missionRetention";
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
import { enrichExercise } from "./services/exerciseEnrichment";
import {
  hasTableColumn,
} from "./core/database";
import {
  createDatabaseAdapter,
  resolveDatabaseBackend,
} from "./core/dbAdapter";
import {
  createSupabaseCompatDatabase,
  type RuntimeDatabase,
} from "./core/supabaseCompatDb";
import { createHybridCompatDatabase } from "./core/hybridCompatDb";
import {
  getErrorMessage,
} from "./core/errors";
import {
  applyCorsHeadersToContext,
  applyCorsHeadersToResponseHeaders,
  resolveCorsAllowHeaders,
  resolveCorsOrigin,
} from "./core/cors";
import {
  getHuggingFaceApiKey,
} from "./core/providerConfig";
import type {
  AppContext,
  Env,
} from "./core/types";
import {
  createAuthMiddleware,
  generateCookie,
  generateExpiredSessionCookie,
  getSessionIdFromCookieHeader,
  hashPassword,
} from "./core/sessionAuth";
import {
  deleteRuntimeHttpCacheBySession,
  readRuntimeHttpCache,
  upsertRuntimeHttpCache,
} from "./core/runtimeHttpCacheStore";
import { deleteRuntimeUserProjections } from "./core/runtimeUserProjectionStore";
import { registerFriendsRoutes } from "./routes/friends";
import { registerHealthRoutes } from "./routes/health";
import { registerMetricsRoutes } from "./routes/metrics";
import { registerProgressionRoutes } from "./routes/progression";
import { registerShopRoutes } from "./routes/shop";
import { registerAchievementRoutes } from "./routes/achievements";
import { registerAccountRoutes } from "./routes/account";
import { registerBillingRoutes } from "./routes/billing";
import { registerPresenceRoutes } from "./routes/presence";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerProfileRoutes } from "./routes/profile";
import { registerMissionRoutes } from "./routes/missions";
import { registerAiRoutes } from "./routes/ai";
import { registerAuthRoutes } from "./routes/auth";
import {
  createMissionGenerationService,
  type StructuredGenerationOptions,
} from "./services/missionGeneration";
import { createBackgroundProcessingService } from "./services/backgroundProcessing";
import { createMissionMaterializationService } from "./services/missionMaterialization";
import {
  applyMissionMetricContext,
  buildCircuitTasks,
  buildMissionDescription,
  buildMissionDescriptionFromInstructions,
  buildMissionInstructions,
  conditionedMetricValue,
  currentWeekKey,
  fallbackExercisesByFocus,
  futureIsoForPeriod,
  inferAttributes,
  inferBodyArea,
  inferExerciseType,
  inferRestSeconds,
  inferSets,
  isMissionMetricType,
  estimateMissionDuration,
  metricValueByPeriod,
  missionConfigByPeriod,
  missionCycleStartIso,
  normalizeExerciseCategory,
  stripMissionTaskPrefix,
  type MissionExerciseCategory,
  type MissionPeriod,
  uniqueExercises,
} from "./services/missionComposition";
import {
  normalizeDifficultyLabel,
} from "./services/missionParsing";
import {
  ensureInstructionSteps,
  fallbackMissionsForPeriod,
  mapWithConcurrency,
  mergeUniqueStrings,
  normalizeInstructionList,
  parseJsonObjectFromModelContent,
  resolveExerciseApiBodyArea,
  resolveExerciseApiMuscleGroups,
  resolveMetricTypeForCategory,
  type ExerciseInstructionPayload,
  type MissionPayload,
  type MissionPromptContext,
} from "./services/missionMaterializationSupport";
import {
  createMissionPresentationService,
  formatIntegerPtBr,
  normalizeMatchText,
  normalizeMissionMetricType,
  parseCircuitTaskField,
  parseMissionArrayField,
  stripMissionDisplayTitlePrefix,
  type NormalizedMissionRow,
} from "./services/missionPresentation";
import {
  createMissionBlueprintPlanningService,
  type MissionBlueprint,
  type ResolvedMissionSubtask,
  type StructuredMissionPlanDraft,
  type StructuredPeriodicMissionDraft,
} from "./services/missionBlueprintPlanning";
import { createMissionPlanPersistenceService } from "./services/missionPlanPersistence";
import { createMissionPlanValidationService } from "./services/missionPlanValidation";
import { createLegacyMissionRepairService } from "./services/legacyMissionRepair";
import { createActivatedProfileRecoveryService } from "./services/activatedProfileRecovery";
import {
  createMissionRuntimeStateService,
  type MissionRefreshMode,
} from "./services/missionRuntimeState";
import {
  currentDateKeyInTimeZone,
  missionCycleDateByRow,
  missionCycleDateKey,
  missionCycleEndDateKey,
  missionMonthKey,
  resolveMissionTimeZone,
  shiftMissionDateKey,
} from "./services/missionCycle";
import {
  createAiMissionGenerationService,
  type AiMissionGenerationResult,
} from "./services/aiMissionGeneration";
import {
  createMissionProgressionService,
  type MissionAttributeDelta,
} from "./services/missionProgression";
import {
  conditioningOrder as conditioningOrderService,
  skillTierOrder as skillTierOrderService,
  ensureGamificationCatalog as ensureGamificationCatalogService,
  ensureCaminhadaLeveUserSkill as ensureCaminhadaLeveUserSkillService,
} from "./services/gamificationCatalog";
import { createGamificationLifecycleService } from "./services/gamificationLifecycle";
import {
  buildInitialTrainingPlan as buildInitialTrainingPlanService,
  normalizeTrainingFrequencyInput as normalizeTrainingFrequencyInputService,
  normalizeTrainingPlanChatPreferences as normalizeTrainingPlanChatPreferencesService,
  parseStoredPlanRecord as parseStoredPlanRecordService,
  serializeTrainingPlanChatPreferences as serializeTrainingPlanChatPreferencesService,
  summarizeTrainingPlanChatPreferences as summarizeTrainingPlanChatPreferencesService,
  trainingPlanChatPreferencesHash as trainingPlanChatPreferencesHashService,
  upsertTrainingPlan as upsertTrainingPlanService,
  type TrainingPlanChatPreferences,
} from "./services/trainingPlan";
import {
  createTrainingPlanOrchestrationService,
  type MissionGenerationProfileSnapshot,
} from "./services/trainingPlanOrchestration";
import { createTrainingPlanPreferencesService } from "./services/trainingPlanPreferences";
import {
  getUserAuthRecordById as getUserAuthRecordByIdService,
  hasPlanAccess as hasPlanAccessService,
  normalizePlanStatus as normalizePlanStatusService,
  normalizePublicPlanIdFromValue as normalizePublicPlanIdFromValueService,
  normalizeUserPaymentMethod as normalizeUserPaymentMethodService,
  resolvePlanRedirectPath as resolvePlanRedirectPathService,
  shouldBypassPlanGuard as shouldBypassPlanGuardService,
  shouldPurgeUserOnLogout as shouldPurgeUserOnLogoutService,
} from "./services/userPlanAccess";
import {
  applyPromoCodeForUser as applyPromoCodeForUserService,
  getLatestSubscriptionByUser as getLatestSubscriptionByUserService,
  matchesVipActivationCode as matchesVipActivationCodeService,
  normalizePromoCodeValue as normalizePromoCodeValueService,
  processCaktoWebhook as processCaktoWebhookService,
  reconcilePendingSubscriptionForUser as reconcilePendingSubscriptionForUserService,
  resolveCheckoutAmount as resolveCheckoutAmountService,
  resolveCheckoutProductId as resolveCheckoutProductIdService,
  resolveCheckoutUrl as resolveCheckoutUrlService,
  startCheckoutForUser as startCheckoutForUserService,
  validatePromoCodeRecord as validatePromoCodeRecordService,
} from "./services/subscriptionLifecycle";

const STREAK_REFRESH_DEBOUNCE_MS = 60_000;
const STREAK_REFRESH_MAX_KEYS = 4_000;
const streakRefreshLocks = new Map<string, Promise<void>>();
const streakRefreshLastRun = new Map<string, number>();
let missionRuntimeStateService: ReturnType<typeof createMissionRuntimeStateService> | null = null;

function requireMissionRuntimeStateService(): ReturnType<typeof createMissionRuntimeStateService> {
  if (!missionRuntimeStateService) {
    throw new Error("Mission runtime state service not initialized");
  }
  return missionRuntimeStateService;
}

function readMissionListCache(userId: string): Record<string, unknown>[] | null {
  return requireMissionRuntimeStateService().readMissionListCache(userId);
}

function readMissionDetailCache(
  userId: string,
  missionId: number,
): Record<string, unknown> | null {
  return requireMissionRuntimeStateService().readMissionDetailCache(userId, missionId);
}

function writeMissionListCache(userId: string, payload: Record<string, unknown>[]): void {
  requireMissionRuntimeStateService().writeMissionListCache(userId, payload);
}

function writeMissionDetailCache(
  userId: string,
  missionId: number,
  payload: Record<string, unknown>,
): void {
  requireMissionRuntimeStateService().writeMissionDetailCache(
    userId,
    missionId,
    payload,
  );
}

function clearMissionDetailCache(userId: string, missionId: number): void {
  requireMissionRuntimeStateService().clearMissionDetailCache(userId, missionId);
}

function invalidateMissionListCache(userId: string): void {
  requireMissionRuntimeStateService().invalidateMissionListCache(userId);
}

async function ensurePeriodicMissionsWithGuard(
  env: Env,
  db: D1Database,
  userId: string,
  options?: { force?: boolean | undefined; mode?: MissionRefreshMode | undefined },
): Promise<void> {
  await requireMissionRuntimeStateService().ensurePeriodicMissionsWithGuard(
    env,
    db,
    userId,
    options,
  );
}

function schedulePeriodicMissionsRefreshWithGuard(
  env: Env,
  db: D1Database,
  userId: string,
  executionCtx: ExecutionContext,
  mode: MissionRefreshMode = "safe",
): boolean {
  return requireMissionRuntimeStateService().schedulePeriodicMissionsRefreshWithGuard(
    env,
    db,
    userId,
    executionCtx,
    mode,
  );
}

function schedulePeriodicProgressRecomputeWithGuard(
  userId: string,
  db: D1Database,
  executionCtx: ExecutionContext,
): boolean {
  return requireMissionRuntimeStateService().schedulePeriodicProgressRecomputeWithGuard(
    userId,
    db,
    executionCtx,
  );
}

function scheduleLegacyDailyMetadataRepairWithGuard(
  env: Env,
  db: D1Database,
  userId: string,
  executionCtx: ExecutionContext,
): boolean {
  return requireMissionRuntimeStateService().scheduleLegacyDailyMetadataRepairWithGuard(
    env,
    db,
    userId,
    executionCtx,
  );
}

// Reúne a camada de gamificação em aliases estáveis para o restante do worker.
const gamificationLifecycleService = createGamificationLifecycleService({
  invalidateRankingCache,
});

const {
  applyXpPointsAndResolveLevels: applyXpPointsAndResolveLevelsService,
  checkMissionRelevance: checkMissionRelevanceService,
  computeXpAndLevelAfterGain: computeXpAndLevelAfterGainService,
  ensureGoalStatsRow: ensureGoalStatsRowService,
  ensureUserAttributesRow: ensureUserAttributesRowService,
  ensureUserCounterRow: ensureUserCounterRowService,
  evaluateLevelTitles: evaluateLevelTitlesService,
  consumeRewardNotifications: consumeRewardNotificationsService,
  getRewardNotificationCursor: getRewardNotificationCursorService,
  listRewardNotifications: listRewardNotificationsService,
  logUserEvent: logUserEventService,
  onAppOpen: onAppOpenService,
  onChatMessage: onChatMessageService,
  onFriendAdded: onFriendAddedService,
  onGoalChanged: onGoalChangedService,
  onGoalProgress: onGoalProgressService,
  onMissionComplete: onMissionCompleteService,
  onProfileCustomization: onProfileCustomizationService,
  onRankingUpdate: onRankingUpdateService,
  onStreakBroken: onStreakBrokenService,
  onStreakContinued: onStreakContinuedService,
  onStreakRebuilt: onStreakRebuiltService,
  parseProgressionXpLevel: parseProgressionXpLevelService,
  runMissionLifecycleHookSafely: runMissionLifecycleHookSafelyService,
  tryUnlockSkillsFromPerformance: tryUnlockSkillsFromPerformanceService,
  unlockAchievementIfNeeded: unlockAchievementIfNeededService,
  unlockTitleIfNeeded: unlockTitleIfNeededService,
} = gamificationLifecycleService;
const conditioningOrder = conditioningOrderService;
const skillTierOrder = skillTierOrderService;
const ensureGamificationCatalog = ensureGamificationCatalogService;
const applyXpPointsAndResolveLevels = applyXpPointsAndResolveLevelsService;
const checkMissionRelevance = checkMissionRelevanceService;
const computeXpAndLevelAfterGain = computeXpAndLevelAfterGainService;
const consumeRewardNotifications = consumeRewardNotificationsService;
const ensureUserAttributesRow = ensureUserAttributesRowService;
const logUserEvent = logUserEventService;
const getRewardNotificationCursor = getRewardNotificationCursorService;
const listRewardNotifications = listRewardNotificationsService;
const onFriendAdded = onFriendAddedService;
const onGoalProgress = onGoalProgressService;
const onMissionComplete = onMissionCompleteService;
const onRankingUpdate = onRankingUpdateService;
const onStreakContinued = onStreakContinuedService;
const parseProgressionXpLevel = parseProgressionXpLevelService;
const runMissionLifecycleHookSafely = runMissionLifecycleHookSafelyService;
const tryUnlockSkillsFromPerformance = tryUnlockSkillsFromPerformanceService;
const unlockAchievementIfNeeded = unlockAchievementIfNeededService;
const unlockTitleIfNeeded = unlockTitleIfNeededService;
const ensureUserCounterRow = ensureUserCounterRowService;
const missionProgressionService = createMissionProgressionService({
  ensureUserAttributesRow: ensureUserAttributesRowService,
});
const {
  applyMissionAttributeDeltaToUser,
  computeMissionTypeAttributeDelta,
  totalSkillTableAttributeGain,
} = missionProgressionService;
const normalizePlanStatus = normalizePlanStatusService;
const normalizePublicPlanIdFromValue =
  normalizePublicPlanIdFromValueService;
const normalizeUserPaymentMethod =
  normalizeUserPaymentMethodService;
const hasPlanAccess = hasPlanAccessService;
const resolvePlanRedirectPath = resolvePlanRedirectPathService;
const shouldBypassPlanGuard = shouldBypassPlanGuardService;
const shouldPurgeUserOnLogout = shouldPurgeUserOnLogoutService;
const getUserAuthRecordById = getUserAuthRecordByIdService;
const normalizePromoCodeValue = normalizePromoCodeValueService;
const matchesVipActivationCode = matchesVipActivationCodeService;
const validatePromoCodeRecord = validatePromoCodeRecordService;
const applyPromoCodeForUser = applyPromoCodeForUserService;
const getLatestSubscriptionByUser = getLatestSubscriptionByUserService;
const resolveCheckoutAmount = resolveCheckoutAmountService;
const resolveCheckoutUrl = resolveCheckoutUrlService;
const resolveCheckoutProductId = resolveCheckoutProductIdService;
const startCheckoutForUser = startCheckoutForUserService;
const processCaktoWebhook = processCaktoWebhookService;
const reconcilePendingSubscriptionForUser =
  reconcilePendingSubscriptionForUserService;

// Constrói o middleware de sessão e plano usado pelas rotas protegidas.
const authMiddleware = createAuthMiddleware({
  catalogCacheTtlMs: 120_000,
  sessionCacheTtlMs: 20_000,
  userRecordCacheTtlMs: 60_000,
  cleanupSettledMissionsWithGuard,
  ensureCaminhadaLeveUserSkill: ensureCaminhadaLeveUserSkillService,
  ensureCatalogReady,
  getUserAuthRecordById,
  hasPlanAccess,
  refreshMissionExpiryWithGuard,
  resolvePlanRedirectPath,
  shouldBypassPlanGuard,
  tryUnlockSkillsFromPerformance: tryUnlockSkillsFromPerformanceService,
});

// Materializa blueprints e respostas de IA em payloads persistíveis.
const missionMaterializationService = createMissionMaterializationService({
  applyMissionMetricContext: (
    mission,
    period,
    exerciseName,
    metricType,
    metricValue,
    context,
  ) =>
    applyMissionMetricContext(
      mission as unknown as MissionPayload,
      period,
      exerciseName,
      metricType,
      metricValue,
      context,
    ) as unknown as typeof mission,
  buildCircuitTasks,
  buildMissionDescription,
  buildMissionDescriptionFromInstructions,
  buildMissionInstructions,
  ensureInstructionSteps,
  estimateMissionDuration,
  getMissionMetricType,
  inferAttributes: (category) =>
    inferAttributes(category as MissionExerciseCategory),
  inferBodyArea,
  inferExerciseType: (category) =>
    inferExerciseType(category as MissionExerciseCategory),
  inferRestSeconds,
  inferSets,
  isMissionMetricType,
  mergeUniqueStrings,
  metricUnitByType,
  metricValueByPeriod,
  missionConfigByPeriod,
  normalizeExerciseCategory,
  normalizeInstructionList,
  normalizeMatchText,
  parseJsonObjectFromModelContent,
  resolveExerciseApiBodyArea,
  resolveExerciseApiMuscleGroups,
  resolveExerciseDisplayNamePt,
  resolveMetricTypeForCategory: (category, exerciseName) =>
    resolveMetricTypeForCategory(
      category as MissionExerciseCategory,
      exerciseName,
    ),
  resolveSupportedMissionExerciseName,
  shouldShowMissionDuration,
  toPositiveInt,
  toSafeString,
});

// Planeja blueprints periódicos e prompts estruturados a partir do perfil.
const missionBlueprintPlanningService = createMissionBlueprintPlanningService({
  buildMissionDescription,
  buildMissionDescriptionFromInstructions,
  buildMissionInstructions,
  clampXpRewardByPeriod,
  conditionedMetricValue: (
    metricType,
    period,
    conditioning,
    volumeMultiplier,
  ) =>
    conditionedMetricValue(
      metricType,
      period,
      conditioning as ConditioningLevel,
      volumeMultiplier,
    ),
  derivePointsRewardByPeriod,
  estimateMissionDuration,
  extractExerciseName: (title) =>
    missionMaterializationService.extractExerciseName(title),
  fallbackExercisesByFocus,
  formatIntegerPtBr,
  getCurrentWeekday: () => getWeekdayPtBr(),
  inferExerciseType: (category) =>
    inferExerciseType(category as MissionExerciseCategory),
  inferRestSeconds,
  inferSets,
  mergeUniqueStrings,
  missionConfigByPeriod,
  getMissionMetricRulesPrompt: () => MISSION_METRIC_RULES_PROMPT,
  normalizeExerciseCategory,
  normalizeMatchText,
  parseJsonObjectFromModelContent,
  summarizeTrainingPlanChatPreferences: (preferences) =>
    summarizeTrainingPlanChatPreferencesService(
      preferences as TrainingPlanChatPreferences | null,
    ),
  uniqueExercises,
});
const {
  buildFallbackStructuredPlan,
  buildMissionCompatibilityTerms,
  buildMonthlyCounterMissionBlueprints,
  buildStructuredPlanPrompt,
  requestStructuredMissionPlanFromAI,
} = missionBlueprintPlanningService;

// Valida o plano final antes da persistência e resolve drafts inválidos.
const missionPlanValidationService = createMissionPlanValidationService({
  buildCircuitTasks,
  buildFallbackStructuredPlan: (profile, options) =>
    buildFallbackStructuredPlan(
      profile as MissionGenerationProfileSnapshot,
      options,
    ),
  buildMissionCompatibilityTerms,
  buildMonthlyCounterMissionBlueprints: (profile, targetCount, options) =>
    buildMonthlyCounterMissionBlueprints(
      profile as MissionGenerationProfileSnapshot,
      targetCount,
      options,
    ),
  clampXpRewardByPeriod,
  conditionedMetricValue: (
    metricType,
    period,
    conditioning,
    volumeMultiplier,
  ) =>
    conditionedMetricValue(
      metricType,
      period,
      conditioning as ConditioningLevel,
      volumeMultiplier,
    ),
  convertStructuredMetricValue,
  derivePointsRewardByPeriod,
  extractExerciseName: (title) =>
    missionMaterializationService.extractExerciseName(title),
  isCircuitLikeText,
  missionConfigByPeriod,
  normalizeDifficultyLabel: (value, fallback) =>
    normalizeDifficultyLabel(
      value,
      fallback as ConditioningLevel,
      normalizeMatchText,
    ),
  normalizeMatchText,
  stripMissionTaskPrefix,
  structuredMetricTypeToMissionMetric,
  toPositiveInt,
  toSafeString,
});

// Expõe adaptadores compatíveis com os serviços extraídos sem mexer nos contratos.
const buildMissionPayloadService = (
  params: Parameters<typeof missionMaterializationService.buildMissionPayload>[0],
) => {
  return missionMaterializationService.buildMissionPayload(
    params,
  ) as unknown as MissionPayload;
};
const extractExerciseNameService = (
  title: string,
) => missionMaterializationService.extractExerciseName(title);
const extractExerciseName = extractExerciseNameService;
const missionPresentationService = createMissionPresentationService({
  extractExerciseName,
});
const {
  missionSummaryFromNormalized,
  normalizeMissionRow,
} = missionPresentationService;
const getExerciseInstructionsFromAIService = (
  exerciseName: string,
  metricType: MissionMetricType,
  conditioningLevel: string,
  env: Env,
  period: MissionPeriod = "daily",
  promptContext?: MissionPromptContext | undefined,
) =>
  missionMaterializationService.getExerciseInstructionsFromAI(
    exerciseName,
    metricType,
    conditioningLevel,
    env,
    period,
    promptContext,
  ) as unknown as Promise<ExerciseInstructionPayload>;
const materializeMissionBlueprintService = (
  env: Env,
  profile: MissionGenerationProfileSnapshot,
  blueprint: MissionBlueprint,
) => {
  return missionMaterializationService.materializeMissionBlueprint(
    env,
    profile,
    blueprint,
  ) as unknown as Promise<MissionPayload>;
};
const resolveSkillIdForExerciseMissionService = (
  db: D1Database,
  userId: string,
  exerciseName: string | null | undefined,
) =>
  missionMaterializationService.resolveSkillIdForExerciseMission(
    db,
    userId,
    exerciseName,
  );
const translateExerciseInstructionsToPtService = (
  instructionsEn: string[],
  exerciseName: string,
  env: Env,
) =>
  missionMaterializationService.translateExerciseInstructionsToPt(
    instructionsEn,
    exerciseName,
    env,
  );

// Centraliza leitura e escrita das preferências conversacionais do plano de treino.
const trainingPlanPreferencesService = createTrainingPlanPreferencesService({
  ApiIntegrationError:
    ApiIntegrationError as unknown as new (
      ...args: unknown[]
    ) => Error & { details?: string | undefined },
  buildInitialTrainingPlan: buildInitialTrainingPlanService,
  callOpenAIChatWithFallback,
  currentWeekKey,
  getErrorMessage,
  normalizeTrainingPlanChatPreferences:
    normalizeTrainingPlanChatPreferencesService,
  parseJsonObjectFromModelContent,
  parseStoredPlanRecord: parseStoredPlanRecordService,
  serializeTrainingPlanChatPreferences: (preferences) =>
    serializeTrainingPlanChatPreferencesService(
      preferences as TrainingPlanChatPreferences | null,
    ),
  summarizeTrainingPlanChatPreferences: (preferences) =>
    summarizeTrainingPlanChatPreferencesService(
      preferences as TrainingPlanChatPreferences | null,
  ),
  upsertTrainingPlan: upsertTrainingPlanService,
});

// Persiste planos, subtarefas e reparos periódicos no schema atual e legado.
const missionPlanPersistenceService = createMissionPlanPersistenceService({
  buildMissionCompatibilityTerms,
  buildMonthlyCounterMissionBlueprints: (profile, targetCount, options) =>
    buildMonthlyCounterMissionBlueprints(
      profile as MissionGenerationProfileSnapshot,
      targetCount,
      options,
    ),
  createMissionSubtasks,
  extractExerciseName: extractExerciseNameService,
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
    materializeMissionBlueprintService(
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
    normalizeDifficultyLabel(
      value,
      fallback as ConditioningLevel,
      normalizeMatchText,
    ),
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
  resolveSkillIdForExerciseMission: resolveSkillIdForExerciseMissionService,
  serializeTrainingPlanChatPreferences: (preferences) =>
    serializeTrainingPlanChatPreferencesService(
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
    upsertTrainingPlanService(
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

// Orquestra top-up e geração recorrente sem duplicar regra de negócio no entrypoint.
const trainingPlanOrchestrationService = createTrainingPlanOrchestrationService({
  buildFallbackStructuredPlan: (profile, options) =>
    buildFallbackStructuredPlan(profile, options),
  buildInitialTrainingPlan: buildInitialTrainingPlanService,
  buildStructuredPlanPrompt: (profile, options, retryReason) =>
    buildStructuredPlanPrompt(profile, options, retryReason),
  currentWeekKey,
  fallbackExercisesByFocus,
  getActiveCycleMissionCounts,
  hasTableColumn,
  getErrorMessage,
  listCurrentCycleRegularDailyBlueprints:
    missionPlanPersistenceService.listCurrentCycleRegularDailyBlueprints,
  normalizeConditioning,
  normalizeTrainingFrequencyInput: normalizeTrainingFrequencyInputService,
  normalizeTrainingPlanChatPreferences:
    normalizeTrainingPlanChatPreferencesService,
  parseJsonStringArray,
  parseStoredPlanRecord: parseStoredPlanRecordService,
  persistGeneratedMissionPlan:
    missionPlanPersistenceService.persistGeneratedMissionPlan,
  requestStructuredMissionPlanFromAI,
  summarizeTrainingPlanChatPreferences:
    summarizeTrainingPlanChatPreferencesService,
  trainingPlanChatPreferencesHash: trainingPlanChatPreferencesHashService,
  validateStructuredMissionPlan,
  ensureStructuredPeriodicMissionsFromExistingDailyBlueprints:
    missionPlanPersistenceService.ensureStructuredPeriodicMissionsFromExistingDailyBlueprints,
});

// Mantém o reparo legado isolado para não contaminar o fluxo principal.
const legacyMissionRepairService = createLegacyMissionRepairService({
  applyMissionMetricContext: (
    payload,
    period,
    exerciseName,
    metricType,
    metricValue,
  ) =>
    applyMissionMetricContext(
      payload as unknown as MissionPayload,
      period,
      exerciseName,
      metricType,
      metricValue,
    ) as unknown as typeof payload,
  createMissionsForPeriod,
  ensureInstructionSteps,
  extractExerciseName: extractExerciseNameService,
  getMissionMetricType,
  inferAttributes: (category) =>
    inferAttributes(category as MissionExerciseCategory),
  inferExerciseType: (category) =>
    inferExerciseType(category as MissionExerciseCategory),
  invalidateMissionListCache,
  metricUnitByType,
  metricValueByPeriod: (metricType, period) =>
    metricValueByPeriod(metricType, period),
  normalizeExerciseCategory,
  normalizeInstructionList,
  normalizeMatchText,
  normalizeMissionMetricType,
  parseMissionArrayField,
  resolveExerciseApiBodyArea,
  resolveExerciseApiMuscleGroups,
  stripMissionDisplayTitlePrefix,
  translateExerciseInstructionsToPt: translateExerciseInstructionsToPtService,
});
const repairLegacyDailyMissionMetadata = (
  env: Env,
  db: D1Database,
  userId: string,
  options?: { limit?: number | undefined },
) =>
  legacyMissionRepairService.repairLegacyDailyMissionMetadata(
    env,
    db,
    userId,
    options,
  );

// Encapsula a geração principal de missões regulares e periódicas.
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
  getProfileTimeZone: (profile) =>
    resolveMissionTimeZone(
      (profile as MissionGenerationProfileSnapshot | null | undefined)?.timeZone ?? null,
    ),
  hasTableColumn,
  listCurrentCycleMissions,
  loadMissionGenerationProfile,
  missionCycleDateKey,
  missionCycleStartIso,
  persistGeneratedMissionPlan: missionPlanPersistenceService.persistGeneratedMissionPlan,
  repairLegacyPeriodicMissions: missionPlanPersistenceService.repairLegacyPeriodicMissions,
  requestStructuredMissionPlanFromAI,
  validateStructuredMissionPlan,
});

// Delega o scheduled para um serviço próprio e deixa o entrypoint composicional.
const {
  runScheduledWithGuard,
} = createBackgroundProcessingService({
  cleanupSettledMissionsWithGuard,
  ensurePeriodicMissions,
  ensureUserCounterRow: ensureUserCounterRowService,
  expirePendingMissionsAndUpdateStreak,
});

const activatedProfileRecoveryService = createActivatedProfileRecoveryService({
  buildInitialTrainingPlan: buildInitialTrainingPlanService,
  ensureGoalStatsRow: ensureGoalStatsRowService,
  normalizeConditioning,
  normalizeTrainingFrequencyInput: normalizeTrainingFrequencyInputService,
  upsertTrainingPlan: upsertTrainingPlanService,
});

// Centraliza cache, locks e refresh periódico das missões fora do entrypoint.
missionRuntimeStateService = createMissionRuntimeStateService({
  ensurePeriodicMissions,
  getErrorMessage,
  recomputeActivePeriodicMissionProgress: (userId, db) =>
    recomputeActivePeriodicMissionProgress(userId, db),
  repairLegacyDailyMissionMetadata,
  repairLegacyPeriodicMissions: (env, db, userId) =>
    missionPlanPersistenceService.repairLegacyPeriodicMissions(env, db, userId),
  updateMonthlyMissionProgress: (userId, db) =>
    updateMonthlyMissionProgress(userId, db),
});

// Garante o catálogo antes de qualquer fluxo que dependa de skills e títulos.
async function ensureCatalogReady(db: D1Database) {
  await ensureGamificationCatalog(db);
}

// Controla o debounce do refresh de streak e de expiração de missões.
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

function settledMissionRetentionModifiers(): readonly [string, string, string, string] {
  return [
    SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.daily,
    SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.weekly,
    SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.monthly,
    DEFAULT_SETTLED_MISSION_RETENTION_MODIFIER,
  ] as const;
}

async function cleanupSettledMissions(
  db: D1Database,
  userId: string,
): Promise<void> {
  const retentionModifiers = settledMissionRetentionModifiers();

  await db
    .prepare(
      `DELETE FROM missions
        WHERE user_id = ?
          AND (
            (
              COALESCE(status, 'pending') IN ('expired', 'failed')
              AND datetime(updated_at) < CASE type
                WHEN 'daily' THEN datetime('now', ?)
                WHEN 'weekly' THEN datetime('now', ?)
                WHEN 'monthly' THEN datetime('now', ?)
                ELSE datetime('now', ?)
              END
            )
            OR (
              COALESCE(status, 'pending') = 'completed'
              AND datetime(COALESCE(completed_at, updated_at)) < CASE type
                WHEN 'daily' THEN datetime('now', ?)
                WHEN 'weekly' THEN datetime('now', ?)
                WHEN 'monthly' THEN datetime('now', ?)
                ELSE datetime('now', ?)
              END
            )
          )`,
    )
    .bind(
      userId,
      ...retentionModifiers,
      ...retentionModifiers,
    )
    .run();
}

async function cleanupSettledMissionsLegacy(
  db: D1Database,
  userId: string,
): Promise<void> {
  const retentionModifiers = settledMissionRetentionModifiers();

  await db
    .prepare(
      `DELETE FROM missions
        WHERE user_id = ?
          AND is_completed = 1
          AND datetime(COALESCE(completed_at, updated_at)) < CASE type
            WHEN 'daily' THEN datetime('now', ?)
            WHEN 'weekly' THEN datetime('now', ?)
            WHEN 'monthly' THEN datetime('now', ?)
            ELSE datetime('now', ?)
          END`,
    )
    .bind(
      userId,
      ...retentionModifiers,
    )
    .run();
}

async function cleanupSettledMissionsWithGuard(
  db: D1Database,
  userId: string,
): Promise<void> {
  try {
    await cleanupSettledMissions(db, userId);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();
    const missingStatusColumn =
      message.includes("no such column") && message.includes("status");
    if (missingStatusColumn) {
      await cleanupSettledMissionsLegacy(db, userId);
      return;
    }
    throw error;
  }
}

async function expirePendingMissionsAndUpdateStreak(
  db: D1Database,
  userId: string,
): Promise<void> {
  const now = new Date();
  const cycleSnapshot = await readUserMissionCycleSnapshot(db, userId, now);
  const today = cycleSnapshot.daily;
  const yesterday = cycleSnapshot.yesterday;

  let expired: { results: Array<{ id: number }> } = { results: [] };
  try {
    expired = await db
      .prepare(
        `SELECT id
           FROM missions
          WHERE user_id = ?
            AND is_completed = 0
            AND COALESCE(status,'pending') = 'pending'
            AND (
              (type = 'daily' AND ${missionCycleDateSql()} < ?)
              OR (type = 'weekly' AND ${missionCycleDateSql()} < ?)
              OR (type = 'monthly' AND ${missionCycleDateSql()} < ?)
            )`,
      )
      .bind(
        userId,
        cycleSnapshot.daily,
        cycleSnapshot.weekly,
        cycleSnapshot.monthly,
      )
      .all<{ id: number }>();
  } catch {
    // Compatibiliza a expiração com bancos ainda sem a coluna de status.
  }

  for (const mission of expired.results) {
    await db
      .prepare(
        "UPDATE missions SET status = 'expired', updated_at = datetime('now') WHERE id = ?",
      )
      .bind(mission.id)
      .run();
    await onMissionFailed(db, userId, mission.id);
  }

  const progression = await db
    .prepare(
      "SELECT current_streak, best_streak, last_activity_date FROM user_progression WHERE user_id = ?",
    )
    .bind(userId)
    .first<{
      current_streak: number;
      best_streak: number;
      last_activity_date: string | null;
    }>();

  const completedToday = await db
    .prepare(
      `SELECT COUNT(*) as c
         FROM missions
        WHERE user_id = ?
          AND type = 'daily'
          AND is_completed = 1
          AND ${missionCycleDateSql()} = ?`,
    )
    .bind(userId, today)
    .first<{ c: number }>();

  const completedYesterday = await db
    .prepare(
      `SELECT COUNT(*) as c, MAX(completed_at) as last_time
         FROM missions
        WHERE user_id = ?
          AND type = 'daily'
          AND is_completed = 1
          AND ${missionCycleDateSql()} = ?`,
    )
    .bind(userId, yesterday)
    .first<{ c: number; last_time: string | null }>();

  const currentStreak = Number(progression?.current_streak ?? 0);
  const lastActivity = progression?.last_activity_date;

  if (lastActivity && lastActivity < yesterday && currentStreak > 0) {
    await onStreakBrokenService(db, userId, currentStreak);
    await db
      .prepare(
        "UPDATE user_progression SET current_streak = 0, updated_at = datetime('now') WHERE user_id = ?",
      )
      .bind(userId)
      .run();
  }

  if (Number(completedYesterday?.c ?? 0) > 0 && lastActivity !== yesterday) {
    const previousBest = Number(progression?.best_streak ?? 0);
    const rebuilt = currentStreak + 1;
    await db
      .prepare(
        `UPDATE user_progression
            SET current_streak = ?,
                best_streak = MAX(COALESCE(best_streak, 0), ?),
                last_activity_date = ?,
                updated_at = datetime('now')
          WHERE user_id = ?`,
      )
      .bind(rebuilt, rebuilt, yesterday, userId)
      .run();
    await onStreakContinuedService(
      db,
      userId,
      rebuilt,
      Number(completedYesterday?.c ?? 0),
      completedYesterday?.last_time ?? undefined,
    );
    await onStreakRebuiltService(db, userId, rebuilt, previousBest);
  }

  if (Number(completedToday?.c ?? 0) > 0) {
    const refreshed = await db
      .prepare(
        "SELECT current_streak FROM user_progression WHERE user_id = ?",
      )
      .bind(userId)
      .first<{ current_streak: number }>();
    await onStreakContinuedService(
      db,
      userId,
      Number(refreshed?.current_streak ?? 0),
      Number(completedToday?.c ?? 0),
    );
  }
}

async function onMissionFailed(
  db: D1Database,
  userId: string,
  missionId: number,
): Promise<void> {
  await logUserEventService(db, userId, "onMissionFailed", { missionId });
  await db
    .prepare(
      `UPDATE user_event_counters
          SET missions_failed = COALESCE(missions_failed, 0) + 1,
              updated_at = datetime('now')
        WHERE user_id = ?`,
    )
    .bind(userId)
    .run();
  await checkMissionRelevanceService(userId, missionId, db, "failed");
}

async function withTransaction<T>(
  db: RuntimeDatabase,
  run: () => Promise<T>,
  env?: Pick<Env, "DB_BACKEND">,
): Promise<T> {
  const adapter = createDatabaseAdapter(
    env ?? {},
    db,
  );
  return adapter.transaction(run);
}

type DatabaseTopology = "single" | "hybrid";

function resolveDatabaseTopology(
  env: Pick<Env, "DB_TOPOLOGY" | "DB_BACKEND">,
): DatabaseTopology {
  const normalized = String(env.DB_TOPOLOGY ?? "").trim().toLowerCase();
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "single") return "single";
  return resolveDatabaseBackend(env) === "supabase" ? "hybrid" : "single";
}

function hasExplicitSupabaseWriteConfig(
  env: Pick<Env, "SUPABASE_WRITE_DB_URL" | "SUPABASE_WRITE_HYPERDRIVE">,
): boolean {
  return Boolean(
    (env.SUPABASE_WRITE_DB_URL ?? "").trim() || env.SUPABASE_WRITE_HYPERDRIVE,
  );
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function attachRuntimeDatabase(env: Env): Env {
  const backend = resolveDatabaseBackend(env);
  if (backend !== "supabase") return env;

  const topology = resolveDatabaseTopology(env);
  const runtimeD1 = env.fitloot_runtime_db ?? env.fitloot_db;
  const writeMode = hasExplicitSupabaseWriteConfig(env) ? "write" : "default";
  const enableReadSplit = isTruthyEnvFlag(env.SUPABASE_ENABLE_READ_SPLIT);
  const supabaseWriteDb = createSupabaseCompatDatabase(env, {
    mode: writeMode,
  });

  if (topology === "hybrid") {
    let supabaseReadDb: RuntimeDatabase | null = null;
    if (enableReadSplit) {
      try {
        supabaseReadDb = createSupabaseCompatDatabase(env, {
          mode: "read",
          fallbackToWriteConnection: true,
        });
      } catch (error) {
        console.warn("[hybrid-db][read-init-fallback]", {
          message: getErrorMessage(error),
        });
      }
    }

    return {
      ...env,
      fitloot_runtime_db: runtimeD1,
      fitloot_db: createHybridCompatDatabase({
        supabaseWriteDb,
        supabaseReadDb,
        runtimeDb: runtimeD1,
        readFallbackToWrite: true,
      }) as unknown as D1Database,
    };
  }

  return {
    ...env,
    fitloot_runtime_db: runtimeD1,
    fitloot_db: supabaseWriteDb as unknown as D1Database,
  };
}

// Inicializa o app e concentra o tratamento global de erros HTTP.
const app = new Hono<AppContext>();

const HOT_GET_CACHEABLE_PATHS = new Set<string>([
  "/api/auth/check-availability",
  "/api/users/me",
  "/api/skills",
  "/api/skills/available",
  "/api/titles",
  "/api/achievements",
  "/api/benchmarks",
  "/api/reward-notifications/pending",
  "/api/missions",
  "/api/ranking/global",
  "/api/ranking/friends",
  "/api/food/today",
  "/api/shop/products",
  "/api/shop/orders",
  "/api/ai/recommendations",
  "/api/metrics/today",
]);

const PUBLIC_HOT_CACHEABLE_PATHS = new Set<string>([
  "/api/auth/check-availability",
]);

type CachedResponseSnapshot = {
  status: number;
  headers: Array<[string, string]>;
  body: string;
};

type CachedResponseEntry = {
  expiresAt: number;
  staleUntil: number;
  snapshot: CachedResponseSnapshot;
};

const hotGetResponseCache = new Map<string, CachedResponseEntry>();
const hotGetInflightRequests = new Map<
  string,
  { startedAt: number; promise: Promise<CachedResponseSnapshot | null> }
>();

function readEnvInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function isHotCacheableGetPath(path: string): boolean {
  return HOT_GET_CACHEABLE_PATHS.has(path);
}

function resolveSessionScopedRequestKey(c: {
  req: {
    path: string;
    url: string;
    header: (name: string) => string | undefined;
  };
}): string | null {
  const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));
  const url = new URL(c.req.url);
  if (sessionId) {
    return `${sessionId}:${c.req.path}:${url.search}`;
  }

  if (!PUBLIC_HOT_CACHEABLE_PATHS.has(c.req.path)) {
    return null;
  }

  const ip =
    c.req.header("CF-Connecting-IP")?.trim() ||
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";
  const userAgent = (c.req.header("User-Agent") ?? "").trim();
  return `anon:${ip}:${userAgent}:${c.req.path}:${url.search}`;
}

function resolveRuntimeHotCacheDb(c: {
  env: Pick<Env, "fitloot_db" | "fitloot_runtime_db">;
}): D1Database | null {
  const runtimeDb = c.env.fitloot_runtime_db;
  if (!runtimeDb) return null;
  if (runtimeDb === c.env.fitloot_db) return null;
  return runtimeDb;
}

function tryGetRequestUser(
  c: Pick<import("hono").Context<AppContext>, "get">,
): { id: string } | null {
  try {
    const user = c.get("user") as { id?: unknown } | undefined;
    if (!user || typeof user.id !== "string" || user.id.length === 0) {
      return null;
    }
    return { id: user.id };
  } catch {
    return null;
  }
}

function cloneResponseSnapshot(
  snapshot: CachedResponseSnapshot,
  options: { staleFallback?: boolean } = {},
): Response {
  const headers = new Headers(snapshot.headers);
  if (options.staleFallback) {
    headers.set("x-fitloot-cache", "stale-fallback");
  }

  return new Response(snapshot.body, {
    status: snapshot.status,
    headers,
  });
}

async function captureCacheableResponseSnapshot(
  response: Response,
): Promise<CachedResponseSnapshot | null> {
  if (!response.ok || response.status !== 200) return null;
  const cacheControl = (response.headers.get("Cache-Control") ?? "").toLowerCase();
  if (cacheControl.includes("no-store")) return null;

  const contentType = (response.headers.get("Content-Type") ?? "").toLowerCase();
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    return null;
  }

  const body = await response.clone().text();
  return {
    status: response.status,
    headers: Array.from(response.headers.entries()),
    body,
  };
}

function invalidateSessionScopedHotCache(sessionId: string): void {
  const prefix = `${sessionId}:`;

  for (const key of hotGetResponseCache.keys()) {
    if (key.startsWith(prefix)) {
      hotGetResponseCache.delete(key);
    }
  }
}

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


app.get("/favicon.ico", (c) => {
  return c.body(new Uint8Array(), {
    status: 200,
    headers: {
      "Content-Type": "image/x-icon",
    },
  });
});

// Aplica CORS antes de qualquer rota específica e responde preflight cedo.
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
        error: "Origin n\u00e3o permitida",
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

// Coalesce bursty identical GETs and keep a short user-scoped response cache for hot routes.
app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));
  const runtimeHotCacheDb = resolveRuntimeHotCacheDb(c);
  const isSessionScopedRequestKey = (requestKey: string): boolean =>
    Boolean(sessionId && requestKey.startsWith(`${sessionId}:`));

  if (method === "GET" && isHotCacheableGetPath(c.req.path)) {
    const requestKey = resolveSessionScopedRequestKey(c);
    if (!requestKey) {
      await next();
      return;
    }

    const dedupeWindowMs = readEnvInt(
      c.env.REQUEST_DEDUPE_WINDOW_MS,
      1_800,
      250,
      10_000,
    );
    const cacheTtlMs = readEnvInt(
      c.env.HOT_GET_CACHE_TTL_MS,
      5_000,
      500,
      30_000,
    );
    const staleTtlMs = readEnvInt(
      c.env.HOT_GET_STALE_TTL_MS,
      120_000,
      5_000,
      600_000,
    );
    const now = Date.now();
    const cached = hotGetResponseCache.get(requestKey);
    let staleSnapshot: CachedResponseSnapshot | null = null;
    if (cached && cached.expiresAt > now) {
      return cloneResponseSnapshot(cached.snapshot);
    }
    if (cached) {
      if (cached.staleUntil > now) {
        staleSnapshot = cached.snapshot;
      } else {
        hotGetResponseCache.delete(requestKey);
      }
    }

    const shouldUseRuntimeEdgeCache =
      Boolean(runtimeHotCacheDb) && isSessionScopedRequestKey(requestKey);
    if (!cached && shouldUseRuntimeEdgeCache && runtimeHotCacheDb) {
      try {
        const runtimeCached = await readRuntimeHttpCache(runtimeHotCacheDb, requestKey);
        if (runtimeCached) {
          hotGetResponseCache.set(requestKey, {
            snapshot: runtimeCached.snapshot,
            expiresAt: runtimeCached.expiresAt,
            staleUntil: runtimeCached.staleUntil,
          });

          if (runtimeCached.expiresAt > now) {
            return cloneResponseSnapshot(runtimeCached.snapshot);
          }

          if (runtimeCached.staleUntil > now) {
            staleSnapshot = runtimeCached.snapshot;
          }
        }
      } catch (runtimeCacheError) {
        console.warn("[hot-get-cache][runtime-read]", {
          path: c.req.path,
          message: getErrorMessage(runtimeCacheError),
        });
      }
    }

    const inflight = hotGetInflightRequests.get(requestKey);
    if (inflight && now - inflight.startedAt <= dedupeWindowMs) {
      const sharedSnapshot = await inflight.promise;
      if (sharedSnapshot) {
        return cloneResponseSnapshot(sharedSnapshot);
      }
      if (staleSnapshot) {
        return cloneResponseSnapshot(staleSnapshot, { staleFallback: true });
      }
      await next();
      return;
    }

    const currentRequest = (async () => {
      await next();
      return captureCacheableResponseSnapshot(c.res);
    })();
    hotGetInflightRequests.set(requestKey, {
      startedAt: now,
      promise: currentRequest,
    });

    try {
      const snapshot = await currentRequest;
      if (snapshot) {
        const writtenAt = Date.now();
        const expiresAt = writtenAt + cacheTtlMs;
        const staleUntil = writtenAt + staleTtlMs;
        hotGetResponseCache.set(requestKey, {
          snapshot,
          expiresAt,
          staleUntil,
        });

        if (shouldUseRuntimeEdgeCache && runtimeHotCacheDb && sessionId) {
          c.executionCtx.waitUntil(
            upsertRuntimeHttpCache(runtimeHotCacheDb, {
              cacheKey: requestKey,
              sessionId,
              path: c.req.path,
              expiresAt,
              staleUntil,
              snapshot,
            }).catch((runtimeCacheError) => {
              console.warn("[hot-get-cache][runtime-write]", {
                path: c.req.path,
                message: getErrorMessage(runtimeCacheError),
              });
            }),
          );
        }
      } else if (staleSnapshot && c.res.status >= 500) {
        return cloneResponseSnapshot(staleSnapshot, { staleFallback: true });
      }
    } finally {
      hotGetInflightRequests.delete(requestKey);
    }

    return;
  }

  await next();

  const shouldInvalidateMutationCache =
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "OPTIONS";
  const shouldInvalidateLogoutCache = method === "GET" && c.req.path === "/api/logout";
  const shouldInvalidateAfterRequest =
    c.res.status < 500 &&
    (shouldInvalidateMutationCache || shouldInvalidateLogoutCache);

  if (shouldInvalidateAfterRequest && sessionId) {
    invalidateSessionScopedHotCache(sessionId);
  }

  if (shouldInvalidateAfterRequest && runtimeHotCacheDb) {
    if (sessionId) {
      c.executionCtx.waitUntil(
        deleteRuntimeHttpCacheBySession(runtimeHotCacheDb, sessionId).catch((runtimeCacheError) => {
          console.warn("[hot-get-cache][runtime-invalidate]", {
            path: c.req.path,
            message: getErrorMessage(runtimeCacheError),
          });
        }),
      );
    }

    const requestUser = tryGetRequestUser(c);
    if (requestUser?.id) {
      c.executionCtx.waitUntil(
        deleteRuntimeUserProjections(runtimeHotCacheDb, requestUser.id).catch(
          (runtimeProjectionError) => {
            console.warn("[runtime-projections][invalidate]", {
              path: c.req.path,
              userId: requestUser.id,
              message: getErrorMessage(runtimeProjectionError),
            });
          },
        ),
      );
    }
  }
});

// Registra autenticação, conta, cobrança, onboarding e progressão base.
registerAuthRoutes(app, {
  generateCookie,
  hashPassword,
});

registerAccountRoutes(app, {
  authMiddleware,
  generateExpiredSessionCookie,
  getSessionIdFromCookieHeader,
  getUserAuthRecordById,
  logUserEvent: logUserEventService,
  onAppOpen: onAppOpenService,
  onProfileCustomization: onProfileCustomizationService,
  shouldPurgeUserOnLogout,
  unlockAchievementIfNeeded: unlockAchievementIfNeededService,
});

registerPresenceRoutes(app, {
  authMiddleware,
  getSessionIdFromCookieHeader,
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
  reconcilePendingSubscriptionForUser,
  resolveCheckoutAmount,
  resolveCheckoutProductId,
  resolveCheckoutUrl,
  startCheckoutForUser,
  validatePromoCodeRecord,
  withTransaction,
});

registerOnboardingRoutes(app, {
  authMiddleware,
  buildInitialTrainingPlan: buildInitialTrainingPlanService,
  conditioningOrder,
  ensureGamificationCatalog: ensureGamificationCatalogService,
  ensureGoalStatsRow: ensureGoalStatsRowService,
  ensurePeriodicMissions,
  ensureUserCounterRow: ensureUserCounterRowService,
  evaluateLevelTitles: evaluateLevelTitlesService,
  invalidateMissionListCache,
  logUserEvent: logUserEventService,
  normalizeTrainingFrequencyInput: normalizeTrainingFrequencyInputService,
  startCheckoutForUser,
  skillTierOrder,
  upsertTrainingPlan: upsertTrainingPlanService,
  withTransaction,
});

registerProfileRoutes(app, {
  authMiddleware,
  buildInitialTrainingPlan: buildInitialTrainingPlanService,
  createMissionsForPeriod,
  ensureGoalStatsRow: ensureGoalStatsRowService,
  fetchResponseWithTimeout,
  invalidateMissionListCache,
  missionCycleStartIso,
  normalizeConditioning,
  normalizeTrainingFrequencyInput: normalizeTrainingFrequencyInputService,
  onGoalChanged: onGoalChangedService,
  onProfileCustomization: onProfileCustomizationService,
  repairActivatedProfileState: ({ db, env, user }) =>
    activatedProfileRecoveryService.repairActivatedProfileState({ db, env, user }),
  unlockAchievementIfNeeded: unlockAchievementIfNeededService,
  upsertTrainingPlan: upsertTrainingPlanService,
});

registerProgressionRoutes(app, {
  authMiddleware,
  applyXpPointsAndResolveLevels,
  consumeRewardNotifications,
  computeXpAndLevelAfterGain,
  listRewardNotifications,
  parseProgressionXpLevel,
  unlockAchievementIfNeeded,
  unlockTitleIfNeeded,
});

// Define a base de subtarefas e hidratação compartilhada pelo domínio de missões.
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

  await db
    .prepare("SELECT id FROM mission_subtasks LIMIT 1")
    .all<{ id: number }>();

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

type MonthlyCounterSnapshot = {
  month_key: string;
  missions_completed: number;
  distance_meters: number;
  streak_days: number;
  weekly_circuits_completed: number;
};

let monthlyCounterSchemaCheckedAt = 0;
const MONTHLY_COUNTER_SCHEMA_TTL_MS = 60_000;

// Recalcula o estado mensal usado por metas acumulativas e missões periódicas.
async function ensureMonthlyCounterSchema(db: D1Database): Promise<void> {
  const now = Date.now();
  if (now - monthlyCounterSchemaCheckedAt < MONTHLY_COUNTER_SCHEMA_TTL_MS) return;
  await db
    .prepare("SELECT user_id FROM user_monthly_counters LIMIT 1")
    .all<{ user_id: string }>();
  monthlyCounterSchemaCheckedAt = now;
}

function currentMonthKey(reference = new Date(), timeZone = "UTC"): string {
  return missionMonthKey(timeZone, reference);
}

function minIsoDate(values: string[]): string {
  return values.reduce((currentMin, candidate) => (candidate < currentMin ? candidate : currentMin));
}

function resolvePeriodicMissionDateWindow(
  mission: Record<string, unknown>,
  timeZone: string,
  reference = new Date(),
): { startDate: string; endDate: string } {
  const missionType = String(mission.type ?? "");
  const safePeriod: MissionPeriod =
    missionType === "weekly" || missionType === "monthly" ? missionType : "daily";
  const today = currentDateKeyInTimeZone(reference, timeZone);
  const startDate = missionCycleDateByRow(
    safePeriod,
    typeof mission.cycle_date === "string" ? mission.cycle_date : null,
    typeof mission.created_at === "string" ? mission.created_at : null,
    timeZone,
  );
  const cycleEndDate = missionCycleEndDateKey(safePeriod, startDate);
  const endDate = minIsoDate([today, cycleEndDate]);

  return {
    startDate,
    endDate: endDate < startDate ? startDate : endDate,
  };
}

async function readPeriodicMissionStepProgress(
  db: D1Database,
  userId: string,
  mission: Record<string, unknown>,
): Promise<number> {
  const timeZone = await readUserMissionTimeZone(db, userId);
  const { startDate, endDate } = resolvePeriodicMissionDateWindow(mission, timeZone);
  const aggregate = await db.prepare(
    `SELECT COALESCE(SUM(steps), 0) as steps
       FROM daily_metrics
      WHERE user_id = ?
        AND date >= date(?)
        AND date <= date(?)`,
  ).bind(userId, startDate, endDate).first<{ steps: number }>();

  return Math.max(0, Number(aggregate?.steps ?? 0));
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

async function resolvePeriodicMissionProgressValue(
  userId: string,
  mission: Record<string, unknown>,
  db: D1Database,
  options?: { monthlyCounters?: MonthlyCounterSnapshot | undefined },
): Promise<number> {
  const metricType = normalizeMissionMetricType(mission.metric_type, mission.target_time);
  if (metricType === "steps") {
    return readPeriodicMissionStepProgress(db, userId, mission);
  }

  if (String(mission.type ?? "") === "monthly") {
    const monthlyCounters = options?.monthlyCounters ?? await getMonthlyCounters(db, userId);
    return monthlyMissionProgressValue(mission, monthlyCounters);
  }

  return Math.max(0, Number(mission.progress_value ?? 0));
}

async function recomputeMonthlyCounters(db: D1Database, userId: string, reference = new Date()): Promise<MonthlyCounterSnapshot> {
  await ensureMonthlyCounterSchema(db);
  const timeZone = await readUserMissionTimeZone(db, userId);
  const monthKey = currentMonthKey(reference, timeZone);
  const monthStartDate = missionCycleDateKey("monthly", timeZone, reference);
  const monthEndDate = missionCycleEndDateKey("monthly", monthStartDate);
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
       COALESCE(COUNT(DISTINCT CASE WHEN is_completed = 1 AND type = 'daily' THEN ${missionCycleDateSql()} END), 0) as streak_days,
       COALESCE(SUM(CASE WHEN is_completed = 1 AND type = 'weekly' AND ${metricTypeSql} = 'circuit_tasks' THEN 1 ELSE 0 END), 0) as weekly_circuits_completed
     FROM missions
     WHERE user_id = ?
       AND ${missionCycleDateSql()} >= ?
       AND ${missionCycleDateSql()} <= ?`
  ).bind(userId, monthStartDate, monthEndDate).first<{
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
  const timeZone = await readUserMissionTimeZone(db, userId);
  const monthKey = currentMonthKey(new Date(), timeZone);
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
  return recomputeMonthlyCounters(db, userId, new Date());
}

async function updateMonthlyMissionProgress(userId: string, db: D1Database): Promise<void> {
  const cycleSnapshot = await readUserMissionCycleSnapshot(db, userId);
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

  for (const mission of monthlyMissions.results.filter((row) =>
    missionCycleDateByRow(
      "monthly",
      typeof row.cycle_date === "string" ? row.cycle_date : null,
      typeof row.created_at === "string" ? row.created_at : null,
      cycleSnapshot.timeZone,
    ) === cycleSnapshot.monthly,
  )) {
    const progress = await resolvePeriodicMissionProgressValue(userId, mission, db, {
      monthlyCounters: counters,
    });
    const target = Math.max(1, Number(mission.metric_value ?? mission.target_reps ?? 1));
    if (hasProgressValueColumn) {
      await db.prepare(
        `UPDATE missions
           SET progress_value = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(Math.min(target, progress), mission.id).run();
    }
    if (progress < target) continue;

    await completePeriodicMissionIfPending(db, userId, mission, {
      missionsHaveStatus,
    });
  }
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

async function incrementMissionCompletedCounter(
  db: D1Database,
  userId: string,
): Promise<void> {
  await ensureUserCounterRow(db, userId);
  await db.prepare(
    `UPDATE user_event_counters
        SET missions_completed = COALESCE(missions_completed, 0) + 1,
            updated_at = datetime('now')
      WHERE user_id = ?`,
  ).bind(userId).run();
}

async function completePeriodicMissionIfPending(
  db: D1Database,
  userId: string,
  missionRow: Record<string, unknown>,
  options?: { missionsHaveStatus?: boolean | undefined },
): Promise<boolean> {
  const missionId = Number(missionRow.id ?? 0);
  if (!Number.isInteger(missionId) || missionId <= 0) {
    return false;
  }

  const missionsHaveStatus =
    options?.missionsHaveStatus
    ?? await hasTableColumn(db, "missions", "status");
  const completionResult = missionsHaveStatus
    ? await db.prepare(
        `UPDATE missions
            SET is_completed = 1,
                status = 'completed',
                completed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ? AND is_completed = 0`,
      ).bind(missionId).run()
    : await db.prepare(
        `UPDATE missions
            SET is_completed = 1,
                completed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ? AND is_completed = 0`,
      ).bind(missionId).run();

  if (Number(completionResult.meta.changes ?? 0) === 0) {
    return false;
  }

  await grantCircuitRewards(db, userId, missionRow);
  await incrementMissionCompletedCounter(db, userId);
  await onMissionComplete(db, userId, missionId);
  return true;
}

function buildCompletedMissionMatchCandidates(completedMission: Record<string, unknown>): string[] {
  const rawTitle = String(completedMission.title ?? "");
  const exerciseNameRaw = String(completedMission.exercise_name ?? "");
  const exerciseDbIdRaw = String(completedMission.exercise_db_id ?? "").trim();
  const exerciseDbId = normalizeMatchText(exerciseDbIdRaw);
  const exerciseDbIdTerm = exerciseDbId.length > 0 ? `exercise_db_id:${exerciseDbId}` : "";
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

  return Array.from(
    new Set(
      [
        title,
        strippedTitle,
        exerciseDbId,
        exerciseDbIdTerm,
        exerciseName,
        localizedExerciseName,
        supportedExerciseName,
        supportedExerciseDisplay,
      ]
        .filter((value) => value.length > 0),
    ),
  );
}

function splitMatchTokens(value: string): string[] {
  return normalizeMatchText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function candidateContainsNormalizedTerm(candidate: string, normalizedTerm: string): boolean {
  return candidate === normalizedTerm
    || candidate.startsWith(`${normalizedTerm} `)
    || candidate.endsWith(` ${normalizedTerm}`)
    || candidate.includes(` ${normalizedTerm} `);
}

function candidateContainsAllTermTokens(candidate: string, normalizedTerm: string): boolean {
  const termTokens = splitMatchTokens(normalizedTerm);
  if (termTokens.length < 2) return false;
  const candidateTokens = new Set(splitMatchTokens(candidate));
  return termTokens.every((token) => candidateTokens.has(token));
}

function candidateMatchesMissionTerm(candidate: string, normalizedTerm: string): boolean {
  return candidateContainsNormalizedTerm(candidate, normalizedTerm)
    || candidateContainsAllTermTokens(candidate, normalizedTerm);
}

function matchTermsAgainstCompletedMission(completedMission: Record<string, unknown>, terms: readonly string[]): boolean {
  const candidates = buildCompletedMissionMatchCandidates(completedMission);
  if (candidates.length === 0) return false;

  return terms.some((term) => {
    const normalizedTerm = normalizeMatchText(term);
    if (normalizedTerm.length === 0) return false;

    return candidates.some((candidate) =>
      candidateMatchesMissionTerm(candidate, normalizedTerm),
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
  timeZone: string,
): boolean {
  if (String(completedMission.type ?? "") !== "daily") {
    return false;
  }

  const completedCycleDate = missionCycleDateByRow(
    "daily",
    typeof completedMission.cycle_date === "string" ? completedMission.cycle_date : null,
    typeof completedMission.created_at === "string" ? completedMission.created_at : null,
    timeZone,
  );
  const { startDate, endDate } = resolvePeriodicMissionDateWindow(parentMission, timeZone);
  return completedCycleDate >= startDate && completedCycleDate <= endDate;
}

async function recomputeActivePeriodicMissionProgress(userId: string, db: D1Database): Promise<void> {
  const cycleSnapshot = await readUserMissionCycleSnapshot(db, userId);
  const periodicRows = await db.prepare(
    `SELECT *
       FROM missions
      WHERE user_id = ?
        AND type IN ('weekly', 'monthly')
        AND is_completed = 0
        AND (deadline IS NULL OR deadline > datetime('now'))`,
  ).bind(userId).all<Record<string, unknown>>();

  const activePeriodicMissions = (Array.isArray(periodicRows.results) ? periodicRows.results : []).filter((row) => {
    const missionType = row.type === "weekly" || row.type === "monthly"
      ? row.type
      : null;
    if (!missionType) return false;
    const cycleDate = missionCycleDateByRow(
      missionType,
      typeof row.cycle_date === "string" ? row.cycle_date : null,
      typeof row.created_at === "string" ? row.created_at : null,
      cycleSnapshot.timeZone,
    );
    return cycleDate === cycleSnapshot[missionType];
  });
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
      isMissionCompletionWithinParentWindow(
        completedMission,
        missionRow,
        cycleSnapshot.timeZone,
      ),
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
      } else if (subtasks.every((subtask) => subtask.is_completed)) {
        await completePeriodicMissionIfPending(db, userId, missionRow, {
          missionsHaveStatus,
        });
      }
      continue;
    }

    const missionMetricType = normalizeMissionMetricType(missionRow.metric_type, missionRow.target_time);
    if (missionMetricType === "steps") {
      const progress = await resolvePeriodicMissionProgressValue(userId, missionRow, db);
      const target = Math.max(1, Number(missionRow.metric_value ?? missionRow.target_reps ?? 1));
      const nextProgressValue = Math.min(target, progress);

      if (hasProgressValueColumn && Number(missionRow.progress_value ?? 0) !== nextProgressValue) {
        await db.prepare(
          `UPDATE missions
              SET progress_value = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).bind(nextProgressValue, missionId).run();
      }

      if (progress < target) {
        continue;
      }

      await completePeriodicMissionIfPending(db, userId, missionRow, {
        missionsHaveStatus,
      });
      continue;
    }

    if (missionMetricType !== "circuit_tasks") {
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

    if (!changed) {
      if (recomputedTasks.every((task) => task.completed)) {
        await completePeriodicMissionIfPending(db, userId, missionRow, {
          missionsHaveStatus,
        });
      }
      continue;
    }

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

    await completePeriodicMissionIfPending(db, userId, missionRow, {
      missionsHaveStatus,
    });
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
  await completePeriodicMissionIfPending(db, userId, missionRow, {
    missionsHaveStatus,
  });
}

async function updateMissionSubtaskProgress(userId: string, completedMission: Record<string, unknown>, db: D1Database) {
  await ensureMissionSubtaskSchema(db);
  const cycleSnapshot = await readUserMissionCycleSnapshot(db, userId);

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
        AND (
          (m.type = 'weekly' AND ${missionCycleDateSql("m")} = ?)
          OR (m.type = 'monthly' AND ${missionCycleDateSql("m")} = ?)
        )
        AND ms.is_completed = 0`
  ).bind(
    userId,
    cycleSnapshot.weekly,
    cycleSnapshot.monthly,
  ).all<MissionSubtaskRow>();

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
  const cycleSnapshot = await readUserMissionCycleSnapshot(db, userId);
  const circuits = await db.prepare(
    `SELECT * FROM missions
      WHERE user_id = ?
        AND type = 'weekly'
        AND metric_type = 'circuit_tasks'
        AND is_completed = 0
        AND ${missionCycleDateSql()} = ?
        AND NOT EXISTS (
          SELECT 1 FROM mission_subtasks ms WHERE ms.parent_mission_id = missions.id
        )
        AND (deadline IS NULL OR deadline > datetime('now'))`
  ).bind(userId, cycleSnapshot.weekly).all<Record<string, unknown>>();

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
      await completePeriodicMissionIfPending(db, userId, circuit);
    }
  }
}

// Conecta o módulo de missões aos helpers que ainda precisam ficar no entrypoint.
registerMissionRoutes(
  app,
  {
    applyMissionAttributeDeltaToUser: (db, userId, delta) =>
      applyMissionAttributeDeltaToUser(db, userId, delta as MissionAttributeDelta),
    applyXpPointsAndResolveLevels,
    checkMissionRelevance,
    clearMissionDetailCache,
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
    getRewardNotificationCursor,
    hydrateMissionRowsWithSubtasks,
    invalidateMissionListCache,
    invalidateRankingCache,
    listRewardNotifications,
    logUserEvent,
    missionSummaryFromNormalized: (mission) =>
      missionSummaryFromNormalized(mission as NormalizedMissionRow),
    monthlyMissionProgressValue: (mission, monthlyCounters) =>
      monthlyMissionProgressValue(mission, monthlyCounters as MonthlyCounterSnapshot),
    resolvePeriodicMissionProgressValue: (
      userId,
      mission,
      db,
      monthlyCounters,
    ) => resolvePeriodicMissionProgressValue(userId, mission, db, {
      monthlyCounters: monthlyCounters as MonthlyCounterSnapshot | undefined,
    }),
    normalizeInstructionList,
    normalizeMatchText,
    normalizeMissionMetricType,
    normalizeMissionRow: (row) => normalizeMissionRow(row),
    onGoalProgress,
    onMissionComplete,
    onStreakContinued,
    repairActivatedProfileState: ({ db, env, user }) =>
      activatedProfileRecoveryService.repairActivatedProfileState({ db, env, user }),
    readMissionDetailCache,
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
    translateExerciseInstructionsToPt:
      translateExerciseInstructionsToPtService,
    tryUnlockSkillsFromPerformance,
    unlockAchievementIfNeeded,
    updateCircuitProgress,
    updateMissionSubtaskProgress,
    updateMonthlyMissionProgress,
    withTransaction,
    writeMissionDetailCache,
    writeMissionListCache,
  },
  authMiddleware,
);

// Registra os domínios menores que dependem só do middleware comum.
registerAchievementRoutes(app, { authMiddleware });

registerShopRoutes(app, {
  authMiddleware,
  invalidateRankingCache,
  streamJsonArrayResponse,
  withTransaction,
});

registerMetricsRoutes(app, {
  authMiddleware,
});

type RankingRow = {
  user_id: string;
  username: string;
  full_name: string;
  level: number;
  xp: number;
  current_streak: number;
  points: number;
  training_rank: "iniciante" | "intermediario" | "avancado";
  training_rank_score: number;
};

type TrainingRankingSourceRow = {
  user_id: string;
  username: string;
  full_name: string;
  level: number | string | null;
  xp: number | string | null;
  current_streak: number | string | null;
  best_streak: number | string | null;
  points: number | string | null;
  unlocked_skills: number | string | null;
  unlocked_skill_stages: number | string | null;
  skill_stage_score: number | string | null;
};

const RANKING_CACHE_TTL_MS = 15_000;
let rankingCacheEntry: { rows: RankingRow[]; expiresAt: number } | null = null;

// Mantém o ranking global barato sem perder atualização frequente.
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

function normalizeNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
}

function estimateTrainingBenchmarks(level: number, skillStageScore: number) {
  return {
    pushUpMaxReps: Math.min(Math.max(Math.floor(level * 2.5), 5), 50),
    squatMaxReps: Math.min(Math.max(Math.floor(level * 4), 8), 80),
    plankMaxSeconds: Math.min(Math.max(Math.floor(level * 15), 20), 180),
    sitUpMaxReps: Math.min(Math.max(Math.floor(level * 3), 6), 60),
    skillStageScore,
  };
}

function normalizeTrainingRankingRow(row: TrainingRankingSourceRow): RankingRow {
  const level = Math.max(1, normalizeNonNegativeNumber(row.level, 1));
  const xp = normalizeNonNegativeNumber(row.xp);
  const currentStreak = normalizeNonNegativeNumber(row.current_streak);
  const bestStreak = Math.max(
    currentStreak,
    normalizeNonNegativeNumber(row.best_streak, currentStreak),
  );
  const unlockedSkills = normalizeNonNegativeNumber(row.unlocked_skills);
  const unlockedSkillStages = normalizeNonNegativeNumber(row.unlocked_skill_stages);
  const skillStageScore = normalizeNonNegativeNumber(row.skill_stage_score);
  const totalSessions = Math.max(0, Math.floor(xp / 50));
  const activeWeeks = Math.min(Math.floor(totalSessions / 3), 52);

  const volumeScore = calculateVolumeScore(totalSessions);
  const consistencyScore = calculateRankConsistencyScore(activeWeeks, bestStreak);
  const skillMasteryScore = calculateSkillMasteryScore({
    unlockedSkills,
    unlockedSkillStages,
  });
  const benchmarkScore = calculateRankBenchmarkScore(
    estimateTrainingBenchmarks(level, skillStageScore),
  );
  const trainingRankScore = clampTrainingRankScore(
    volumeScore + consistencyScore + benchmarkScore + skillMasteryScore,
    0,
    100,
  );

  return {
    user_id: row.user_id,
    username: row.username,
    full_name: row.full_name,
    level,
    xp,
    current_streak: currentStreak,
    points: normalizeNonNegativeNumber(row.points),
    training_rank: scoreToTrainingRank(trainingRankScore),
    training_rank_score: trainingRankScore,
  };
}

function sortTrainingRankingRows(rows: RankingRow[]): RankingRow[] {
  return [...rows].sort((left, right) => {
    if (right.training_rank_score !== left.training_rank_score) {
      return right.training_rank_score - left.training_rank_score;
    }
    if (right.level !== left.level) {
      return right.level - left.level;
    }
    if (right.xp !== left.xp) {
      return right.xp - left.xp;
    }
    return left.username.localeCompare(right.username, "pt-BR", {
      sensitivity: "base",
    });
  });
}

async function loadTrainingRankingRows(
  db: D1Database,
  whereClause?: string,
  bindings: unknown[] = [],
): Promise<RankingRow[]> {
  const ranking = await db.prepare(
    `SELECT
      up.user_id,
      up.username,
      up.full_name,
      pr.level,
      pr.xp,
      pr.current_streak,
      pr.best_streak,
      pr.points,
      COALESCE(skill_stats.unlocked_skills, 0) as unlocked_skills,
      COALESCE(skill_stats.unlocked_skill_stages, 0) as unlocked_skill_stages,
      COALESCE(skill_stats.skill_stage_score, 0) as skill_stage_score
    FROM user_profiles up
    INNER JOIN user_progression pr
      ON up.user_id = pr.user_id
    LEFT JOIN (
      SELECT
        user_id,
        COUNT(*) as unlocked_skills,
        SUM(CASE WHEN total_reps >= 100 THEN 1 ELSE 0 END) as unlocked_skill_stages,
        SUM(
          CASE
            WHEN total_reps >= 100 THEN 2.0
            WHEN total_reps >= 50 THEN 1.0
            WHEN total_reps >= 10 THEN 0.5
            ELSE 0
          END
        ) as skill_stage_score
      FROM user_skills
      GROUP BY user_id
    ) skill_stats
      ON skill_stats.user_id = up.user_id
    ${whereClause ? `WHERE ${whereClause}` : ""}`,
  ).bind(...bindings).all<TrainingRankingSourceRow>();

  const sourceRows = Array.isArray(ranking.results) ? ranking.results : [];
  return sortTrainingRankingRows(sourceRows.map(normalizeTrainingRankingRow));
}

app.get("/api/ranking/global", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let rankingRows = readRankingCache();
  if (!rankingRows) {
    rankingRows = (await loadTrainingRankingRows(c.env.fitloot_db)).slice(0, 100);
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

app.get("/api/ranking/friends", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  c.header("Cache-Control", "no-store");

  const rankingRows = await loadTrainingRankingRows(
    c.env.fitloot_db,
    `up.user_id = ? OR up.user_id IN (
      SELECT COALESCE(friend_id, friend_user_id)
      FROM friendships
      WHERE user_id = ?
    )`,
    [user.id, user.id],
  );

  return streamJsonArrayResponse(rankingRows);
});

registerFriendsRoutes(app, {
  authMiddleware,
  onFriendAdded,
  withTransaction,
});

// Consolida counters e recompensas do ciclo de mini-games.
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
    await unlockAchievementIfNeeded(db, userId, "Imbat\u00edvel", winStreak, 50);
  }
}

// Expõe o fluxo de desafio rápido separado do domínio principal de missões.
app.post("/api/mini-games/challenge", authMiddleware, zValidator("json", MiniGameChallengeRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const data = c.req.valid("json");

  let challengedUserId = data.challenged_user_id;

  // Sorteia um oponente com faixa de nível próxima quando o desafio é aleatório.
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

  // Mantém a regra atual de recompensa proporcional à dificuldade do desafio.
  const xpReward = data.target_reps * 5;
  const pointsReward = data.target_reps;
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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
  const rewardNotificationCursor = await getRewardNotificationCursor(
    c.env.fitloot_db,
    winnerUserId,
  );

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

  const rewardEvents = await listRewardNotifications(
    c.env.fitloot_db,
    winnerUserId,
    {
      afterId: rewardNotificationCursor,
      pendingOnly: true,
      limit: 25,
    },
  );

  return c.json({
    success: true,
    winner: winnerUserId,
    xp_gained: winnerXp,
    points_gained: winnerPoints,
    leveledUp: rewardEvents.some((event) => event.type === "level_up"),
    reward_events: rewardEvents,
  });
});

const MISSION_METRIC_RULES_PROMPT = [
  "TABELA OBRIGATORIA DE METRICAS POR EXERCICIO:",
  "- Flexao, agachamento, abdominal, burpee, barra => sets_reps ('3 series de 12 repeticoes')",
  "- Prancha, hollow body, wall sit, dead hang, l-sit => duration_seconds ('3 series de 30 segundos')",
  "- Corrida, ciclismo => distance_meters ('2 km')",
  "- Caminhada => steps ('8.000 passos')",
  "- Yoga, alongamento, mobilidade => duration_minutes ('15 minutos')",
  "- Circuito completo ou sessao longa => circuit_tasks e SEMPRE semanal (nunca diaria)",
].join("\n");

// Faz a ponte final entre payloads de missão e o schema persistido em D1.
async function insertMission(
  db: D1Database,
  userId: string,
  period: MissionPeriod,
  deadline: string,
  mission: MissionPayload,
  skillId: number | null,
): Promise<number | null> {
  const [hasGoalColumn, hasAiSpecialColumn, hasExerciseDbIdColumn, hasCycleDateColumn] = await Promise.all([
    hasTableColumn(db, "missions", "goal"),
    hasTableColumn(db, "missions", "is_ai_special"),
    hasTableColumn(db, "missions", "exercise_db_id"),
    hasTableColumn(db, "missions", "cycle_date"),
  ]);
  const userTimeZone = hasCycleDateColumn
    ? await readUserMissionTimeZone(db, userId)
    : "UTC";
  const cycleDate =
    typeof mission.cycle_date === "string" && mission.cycle_date.trim().length >= 10
      ? mission.cycle_date.trim().slice(0, 10)
      : missionCycleDateKey(period, userTimeZone);
  const normalizedExerciseDbId =
    typeof mission.exercise_db_id === "string" && mission.exercise_db_id.trim().length > 0
      ? mission.exercise_db_id.trim()
      : null;
  const exerciseMediaFallbackUrl = resolveExerciseMediaFallbackUrlById(
    normalizedExerciseDbId,
  );
  const normalizedExerciseDbGifUrl =
    mission.exercise_db_gif_url ?? exerciseMediaFallbackUrl ?? null;
  const normalizedExerciseDbImageUrl =
    mission.exercise_db_image_url ?? exerciseMediaFallbackUrl ?? null;
  const normalizedImageUrl =
    mission.image_url
    ?? normalizedExerciseDbImageUrl
    ?? normalizedExerciseDbGifUrl
    ?? exerciseMediaFallbackUrl
    ?? null;
  const isSupportedRouteDailyMission =
    period === "daily"
    && mission.mission_origin === "regular"
    && isSupportedRouteMissionExercise(
      typeof mission.exercise_name === "string" && mission.exercise_name.trim().length > 0
        ? mission.exercise_name
        : mission.title,
    );

  if (period === "daily" && mission.mission_origin === "regular") {
    if (!normalizedExerciseDbId && !isSupportedRouteDailyMission) {
      throw new Error("REGULAR_DAILY_MISSION_REQUIRES_EXERCISE_DB_ID");
    }
    if (
      !isSupportedRouteDailyMission
      && (!normalizedExerciseDbImageUrl || !normalizedImageUrl)
    ) {
      throw new Error("REGULAR_DAILY_MISSION_REQUIRES_EXERCISE_DB_MEDIA");
    }
  }

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
  const rawDurationEstimate = Number(mission.duration_estimate_minutes);
  const normalizedDurationEstimateMinutes =
    Number.isFinite(rawDurationEstimate) && rawDurationEstimate > 0
      ? Math.round(rawDurationEstimate)
      : 10;
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
    normalizedExerciseDbId,
    normalizedExerciseDbGifUrl,
    normalizedExerciseDbImageUrl,
    mission.exercise_name,
    mission.exercise_equipment,
    mission.exercise_body_part,
    mission.exercise_target,
    JSON.stringify(mission.exercise_secondary_muscles),
    normalizedImageUrl,
    JSON.stringify(mission.muscle_groups),
    mission.exercise_type,
    mission.body_area,
    JSON.stringify(mission.attributes_benefited),
    normalizedDurationEstimateMinutes,
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

  if (hasCycleDateColumn) {
    columns.splice(columns.length - 1, 0, "cycle_date");
    placeholders.splice(placeholders.length - 1, 0, "?");
    values.push(cycleDate);
  }

  placeholders[placeholders.length - 1] = "datetime('now')";

  const sql = `INSERT INTO missions (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`;
  const result = await db.prepare(sql).bind(...values).run();
  const insertedId = Number(result.meta.last_row_id ?? 0);
  return insertedId > 0 ? insertedId : null;
}

function getWeekdayPtBr(now = new Date()) {
  return ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][now.getDay()];
}

async function readUserMissionTimeZone(
  db: D1Database,
  userId: string,
): Promise<string> {
  try {
    const hasTimeZoneColumn = await hasTableColumn(db, "user_profiles", "timezone");
    if (!hasTimeZoneColumn) {
      return "UTC";
    }

    const row = await db.prepare(
      "SELECT timezone FROM user_profiles WHERE user_id = ?",
    ).bind(userId).first<{ timezone: string | null }>();
    return resolveMissionTimeZone(row?.timezone);
  } catch {
    return "UTC";
  }
}

async function readUserMissionCycleSnapshot(
  db: D1Database,
  userId: string,
  reference = new Date(),
): Promise<{
  timeZone: string;
  daily: string;
  weekly: string;
  monthly: string;
  yesterday: string;
}> {
  const timeZone = await readUserMissionTimeZone(db, userId);
  const daily = missionCycleDateKey("daily", timeZone, reference);
  return {
    timeZone,
    daily,
    weekly: missionCycleDateKey("weekly", timeZone, reference),
    monthly: missionCycleDateKey("monthly", timeZone, reference),
    yesterday: shiftMissionDateKey(daily, -1),
  };
}

function missionCycleDateSql(columnPrefix = ""): string {
  const prefix = columnPrefix.trim().length > 0 ? `${columnPrefix}.` : "";
  return `COALESCE(${prefix}cycle_date, substr(CAST(${prefix}created_at AS TEXT), 1, 10))`;
}

// Reúne os adaptadores finais exigidos pela geração estruturada e pela IA.
async function loadMissionGenerationProfile(
  env: Env,
  db: D1Database,
  userId: string,
): Promise<MissionGenerationProfileSnapshot | null> {
  return trainingPlanOrchestrationService.loadMissionGenerationProfile(
    env,
    db,
    userId,
  );
}

async function createMissionsForPeriod(
  env: Env,
  db: D1Database,
  userId: string,
  period: MissionPeriod,
  requestedAmount?: number,
) {
  await trainingPlanOrchestrationService.createMissionsForPeriod(
    env,
    db,
    userId,
    period,
    requestedAmount,
  );
}

async function ensureMissionJobSchema(db: D1Database): Promise<void> {
  await aiMissionGenerationService.ensureMissionJobSchema(db);
}

async function generateAiMissionsForUser(
  env: Env,
  db: D1Database,
  userId: string,
  conditioningInput?: unknown,
): Promise<AiMissionGenerationResult> {
  return aiMissionGenerationService.generateAiMissionsForUser(
    env,
    db,
    userId,
    conditioningInput,
  );
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
  return missionPlanValidationService.resolvePeriodicMissionBlueprints(params);
}

function validateStructuredMissionPlan(
  planDraft: StructuredMissionPlanDraft,
  profile: MissionGenerationProfileSnapshot,
  options: StructuredGenerationOptions,
): { blueprints: MissionBlueprint[]; invalidCount: number; totalCount: number } {
  return missionPlanValidationService.validateStructuredMissionPlan(
    planDraft,
    profile,
    options,
  );
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

function buildMissionCycleSqlFilters(
  scope: MissionGenerationScope,
  hasAiSpecialColumn: boolean,
  hasMissionStatusColumn: boolean,
): { scopeSql: string; pendingStatusSql: string } {
  const scopeSql = scope === "ai_special"
    ? (hasAiSpecialColumn
      ? "AND COALESCE(is_ai_special, 0) = 1"
      : "AND COALESCE(mission_origin, 'regular') = 'ai'")
    : (hasAiSpecialColumn
      ? "AND COALESCE(is_ai_special, 0) = 0 AND COALESCE(mission_origin, 'regular') = 'regular'"
      : "AND COALESCE(mission_origin, 'regular') = 'regular'");
  const pendingStatusSql = hasMissionStatusColumn
    ? "AND COALESCE(status, 'pending') = 'pending'"
    : "";

  return { scopeSql, pendingStatusSql };
}

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
  const [hasAiSpecialColumn, hasMissionStatusColumn] = await Promise.all([
    hasTableColumn(db, "missions", "is_ai_special"),
    hasTableColumn(db, "missions", "status"),
  ]);
  const { scopeSql, pendingStatusSql } = buildMissionCycleSqlFilters(
    scope,
    hasAiSpecialColumn,
    hasMissionStatusColumn,
  );
  const userTimeZone = await readUserMissionTimeZone(db, userId);

  for (const period of ["daily", "weekly", "monthly"] as const) {
    const cycleDate = missionCycleDateKey(period, userTimeZone);
    const row = await db.prepare(
      `SELECT COUNT(*) as count
       FROM missions
       WHERE user_id = ?
         AND type = ?
         ${scopeSql}
         AND is_completed = 0
         ${pendingStatusSql}
         AND ${missionCycleDateSql()} = ?
         AND (deadline IS NULL OR deadline > datetime('now'))`
    ).bind(userId, period, cycleDate).first<{ count: number }>();
    counts[period] = Number(row?.count ?? 0);
  }

  return counts;
}

async function listCurrentCycleMissions(
  db: D1Database,
  userId: string,
  scope: MissionGenerationScope,
): Promise<Array<MissionPayload & { type: MissionPeriod }>> {
  const [hasAiSpecialColumn, hasMissionStatusColumn] = await Promise.all([
    hasTableColumn(db, "missions", "is_ai_special"),
    hasTableColumn(db, "missions", "status"),
  ]);
  const { scopeSql, pendingStatusSql } = buildMissionCycleSqlFilters(
    scope,
    hasAiSpecialColumn,
    hasMissionStatusColumn,
  );
  const userTimeZone = await readUserMissionTimeZone(db, userId);
  const cycleDates = {
    daily: missionCycleDateKey("daily", userTimeZone),
    weekly: missionCycleDateKey("weekly", userTimeZone),
    monthly: missionCycleDateKey("monthly", userTimeZone),
  };
  const rows = await db.prepare(
    `SELECT *
     FROM missions
     WHERE user_id = ?
       ${scopeSql}
       AND is_completed = 0
       ${pendingStatusSql}
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
      const cycleDate = missionCycleDateByRow(
        mission.type,
        typeof mission.cycle_date === "string" ? mission.cycle_date : null,
        typeof mission.created_at === "string" ? mission.created_at : null,
        userTimeZone,
      );
      return cycleDate === cycleDates[mission.type];
    })
    .map((mission) => missionSummaryFromNormalized(mission) as unknown as MissionPayload & { type: MissionPeriod });
}


// Mantém os helpers residuais de IA próximos do registro das rotas que os usam.
function normalizeConditioning(value: unknown): ConditioningLevel {
  if (value === "sedentario" || value === "iniciante" || value === "intermediario" || value === "avancado") {
    return value;
  }
  return "iniciante";
}

function clampXpRewardByPeriod(period: MissionPeriod, rawValue: unknown): number {
  const fallback = missionConfigByPeriod(period).xp;
  const numeric = toPositiveInt(rawValue, fallback);
  if (period === "monthly") return Math.min(1000, Math.max(500, numeric));
  if (period === "weekly") return Math.min(500, Math.max(200, numeric));
  return Math.min(200, Math.max(50, numeric));
}

function derivePointsRewardByPeriod(
  period: MissionPeriod,
  rawValue: unknown,
  xpReward: number,
): number {
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
  const normalizedRaw =
    typeof rawMetricType === "string" ? normalizeMatchText(rawMetricType) : "";
  const expected = getMissionMetricType(
    `${exerciseName} ${exerciseType} ${muscleGroup}`,
  );

  let resolved: MissionMetricType;
  if (normalizedRaw === "seconds" || normalizedRaw === "segundos") {
    resolved = "duration_seconds";
  } else if (normalizedRaw === "distance" || normalizedRaw === "distancia") {
    resolved = "distance_meters";
  } else if (normalizedRaw === "steps" || normalizedRaw === "passos") {
    resolved = "steps";
  } else if (normalizedRaw === "minutes" || normalizedRaw === "minutos") {
    resolved = "duration_minutes";
  } else {
    resolved = "sets_reps";
  }

  if (expected === "circuit_tasks") {
    return period === "daily" ? "sets_reps" : "circuit_tasks";
  }

  return expected !== "sets_reps" || normalizedRaw.length === 0
    ? expected
    : resolved;
}

function convertStructuredMetricValue(
  metricType: MissionMetricType,
  rawValue: unknown,
  rawUnit: unknown,
): number {
  const numeric = toPositiveInt(
    rawValue,
    metricValueByPeriod(
      metricType,
      metricType === "circuit_tasks" ? "weekly" : "daily",
    ),
  );
  const unit = typeof rawUnit === "string" ? normalizeMatchText(rawUnit) : "";

  if (metricType === "distance_meters") {
    if (unit.includes("km")) return Math.max(100, numeric * 1000);
    return numeric >= 100 ? numeric : numeric * 1000;
  }

  return numeric;
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

const aiMissionGenerationService = createAiMissionGenerationService({
  applyMissionMetricContext: (mission, period, exerciseName, metricType, metricValue) =>
    applyMissionMetricContext(
      mission as MissionPayload,
      period,
      exerciseName,
      metricType,
      metricValue,
    ) as unknown as typeof mission,
  buildMissionDescription,
  buildMissionDescriptionFromInstructions,
  buildMissionPayload: (params) =>
    buildMissionPayloadService({
      ...params,
      forceCategory: params.forceCategory as MissionExerciseCategory | undefined,
    }) as unknown as MissionPayload,
  classifyMission,
  enrichExercise,
  ensureInstructionSteps,
  extractExerciseName: extractExerciseNameService,
  fallbackMissionsForPeriod: (period, titlePrefix, xp, points) =>
    fallbackMissionsForPeriod(
      period,
      titlePrefix,
      xp,
      points,
      buildMissionPayloadService,
    ),
  futureIsoForPeriod,
  getExerciseInstructionsFromAI: (
    exerciseName,
    metricType,
    conditioningLevel,
    env,
    period,
  ) =>
    getExerciseInstructionsFromAIService(
      exerciseName,
      metricType,
      conditioningLevel,
      env,
      period,
    ),
  getHuggingFaceApiKey,
  insertMission: (db, userId, period, deadline, mission, skillId) =>
    insertMission(
      db,
      userId,
      period,
      deadline,
      mission as unknown as MissionPayload,
      skillId,
    ),
  invalidateMissionListCache,
  localizeMissionTextArray,
  mapWithConcurrency,
  mergeUniqueStrings,
  missionMetricRulesPrompt: MISSION_METRIC_RULES_PROMPT,
  normalizeConditioning,
  normalizeInstructionList,
  parseJsonObjectFromModelContent,
  pointsByConditioning,
  requestStructuredContent: requestHuggingFaceStructuredContent,
  resolveExerciseApiBodyArea,
  resolveExerciseApiMuscleGroups,
  resolveExerciseDisplayNamePt,
  resolveSkillIdForExerciseMission: resolveSkillIdForExerciseMissionService,
  resolveSupportedMissionExerciseName,
  timeoutMsHuggingFace: timeoutMsByService.huggingface,
  toPositiveInt,
  toSafeString,
  translateExerciseInstructionsToPt: translateExerciseInstructionsToPtService,
  xpByConditioning,
});

// Registra IA e saúde depois que toda a cadeia de geração já foi composta.
registerAiRoutes(app, {
  ApiIntegrationError,
  authMiddleware,
  callOpenAIChatWithFallback,
  ensureMissionJobSchema,
  ensureUserCounterRow: ensureUserCounterRowService,
  enforceRateLimit,
  fetchJsonWithTimeout,
  generateAiMissionsForUser,
  logUserEvent: logUserEventService,
  maybeApplyTrainingPlanPreferenceFromChat: (c, params) =>
    trainingPlanPreferencesService.maybeApplyTrainingPlanPreferenceFromChat(c, {
      ...params,
      conditioning: params.conditioning as ConditioningLevel,
      activePreferences: params.activePreferences as TrainingPlanChatPreferences | null,
    }),
  normalizeConditioning,
  normalizeMatchText,
  normalizeTrainingFrequencyInput: normalizeTrainingFrequencyInputService,
  normalizeTrainingPlanChatPreferences:
    normalizeTrainingPlanChatPreferencesService,
  onChatMessage: onChatMessageService,
  parseJsonObjectFromModelContent,
  parseStoredPlanRecord: parseStoredPlanRecordService,
  requestHuggingFaceVisionStructuredContent,
  summarizeTrainingPlanChatPreferences: (preferences) =>
    summarizeTrainingPlanChatPreferencesService(
      preferences as TrainingPlanChatPreferences | null,
    ),
  timeoutMsByService,
  toFriendlyErrorResponse,
  unlockAchievementIfNeeded: unlockAchievementIfNeededService,
});

registerHealthRoutes(app, { authMiddleware });

// Entrega o frontend somente depois de todas as rotas de API estarem prontas.
app.get("*", async (c, next) => {
  if (c.req.path.startsWith("/api")) {
    return next();
  }

  try {
    return await c.env.ASSETS.fetch(c.req.raw);
  } catch {
    return next();
  }
});

// Fecha o worker com um guard final para fetch e scheduled.
async function handleFetchWithGuard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let runtimeEnv: Env = env;
  try {
    runtimeEnv = attachRuntimeDatabase(env);
    return await app.fetch(request, runtimeEnv, ctx);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const lowerMessage = errorMessage.toLowerCase();
    const hideErrorDetails =
      lowerMessage.includes("supabase") ||
      lowerMessage.includes("postgres") ||
      lowerMessage.includes("connectionstring") ||
      lowerMessage.includes("invalid url");
    console.error("[worker][fetch-guard]", {
      method: request.method,
      url: request.url,
      message: hideErrorDetails ? "Database runtime initialization failed." : errorMessage,
      stack: hideErrorDetails ? undefined : error instanceof Error ? error.stack : undefined,
    });

    const origin = resolveCorsOrigin(request.headers.get("Origin") ?? undefined, runtimeEnv);
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
    let runtimeEnv: Env;
    try {
      runtimeEnv = attachRuntimeDatabase(env);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const lowerMessage = errorMessage.toLowerCase();
      const hideErrorDetails =
        lowerMessage.includes("supabase") ||
        lowerMessage.includes("postgres") ||
        lowerMessage.includes("connectionstring") ||
        lowerMessage.includes("invalid url");

      console.error("[worker][scheduled][runtime-init]", {
        message: hideErrorDetails
          ? "Database runtime initialization failed."
          : errorMessage,
      });
      return;
    }

    ctx.waitUntil(
      runScheduledWithGuard(event, runtimeEnv).catch((error) => {
        console.error("[worker][scheduled][unhandled]", {
          message: getErrorMessage(error),
        });
      })
    );
  },
};





