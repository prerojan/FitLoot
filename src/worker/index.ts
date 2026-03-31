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
  resolveSupportedMissionExerciseName,
} from "../shared/exerciseCatalog";

import {
  localizeMissionText,
  localizeMissionTextArray,
} from "../shared/missionLocalization";
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
import { registerFriendsRoutes } from "./routes/friends";
import { registerHealthRoutes } from "./routes/health";
import { registerMetricsRoutes } from "./routes/metrics";
import { registerProgressionRoutes } from "./routes/progression";
import { registerShopRoutes } from "./routes/shop";
import { registerAchievementRoutes } from "./routes/achievements";
import { registerAccountRoutes } from "./routes/account";
import { registerBillingRoutes } from "./routes/billing";
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
import {
  createMissionRuntimeStateService,
  type MissionRefreshMode,
} from "./services/missionRuntimeState";
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
  hasTableColumn,
  listCurrentCycleMissions,
  loadMissionGenerationProfile,
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
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now.getTime() - 86_400_000)
    .toISOString()
    .split("T")[0];

  let expired: { results: Array<{ id: number }> } = { results: [] };
  try {
    expired = await db
      .prepare(
        `SELECT id
           FROM missions
          WHERE user_id = ?
            AND is_completed = 0
            AND COALESCE(status,'pending') = 'pending'
            AND deadline IS NOT NULL
            AND date(deadline) < date('now')`,
      )
      .bind(userId)
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
          AND is_completed = 1
          AND date(completed_at) = ?`,
    )
    .bind(userId, today)
    .first<{ c: number }>();

  const completedYesterday = await db
    .prepare(
      `SELECT COUNT(*) as c, MAX(completed_at) as last_time
         FROM missions
        WHERE user_id = ?
          AND is_completed = 1
          AND date(completed_at) = ?`,
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

async function withTransaction<T>(_db: D1Database, run: () => Promise<T>): Promise<T> {
  return run();
}

// Inicializa o app e concentra o tratamento global de erros HTTP.
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
    normalizeInstructionList,
    normalizeMatchText,
    normalizeMissionMetricType,
    normalizeMissionRow: (row) => normalizeMissionRow(row),
    onGoalProgress,
    onMissionComplete,
    onStreakContinued,
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

function getWeekdayPtBr(now = new Date()) {
  return ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][now.getDay()];
}

// Reúne os adaptadores finais exigidos pela geração estruturada e pela IA.
async function loadMissionGenerationProfile(
  db: D1Database,
  userId: string,
): Promise<MissionGenerationProfileSnapshot | null> {
  return trainingPlanOrchestrationService.loadMissionGenerationProfile(
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

  for (const period of ["daily", "weekly", "monthly"] as const) {
    const cycleStart = missionCycleStartIso(period);
    const row = await db.prepare(
      `SELECT COUNT(*) as count
       FROM missions
       WHERE user_id = ?
         AND type = ?
         ${scopeSql}
         AND is_completed = 0
         ${pendingStatusSql}
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
  const [hasAiSpecialColumn, hasMissionStatusColumn] = await Promise.all([
    hasTableColumn(db, "missions", "is_ai_special"),
    hasTableColumn(db, "missions", "status"),
  ]);
  const { scopeSql, pendingStatusSql } = buildMissionCycleSqlFilters(
    scope,
    hasAiSpecialColumn,
    hasMissionStatusColumn,
  );
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
      const createdAt = Date.parse(String(mission.created_at ?? ""));
      const cycleStart = Date.parse(missionCycleStartIso(mission.type));
      return Number.isFinite(createdAt) ? createdAt >= cycleStart : true;
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





