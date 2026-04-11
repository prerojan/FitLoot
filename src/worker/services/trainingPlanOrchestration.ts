import { MISSION_LIMITS } from "../../constants/missionMetrics";
import type { ConditioningLevel } from "../../shared/types";
import { getOpenRouterApiKey } from "../core/providerConfig";
import type { Env } from "../core/types";
import type { StructuredGenerationOptions } from "./missionGeneration";
import type {
  MissionBlueprint,
  StructuredMissionPlanDraft,
} from "./missionBlueprintPlanning";
import { sanitizeMissionExerciseNames } from "./missionExerciseSelection";
import type { TrainingPlanChatPreferences } from "./trainingPlan";
import { requestValidatedStructuredPlanWithRetry } from "./structuredPlanRetry";
import {
  missionCycleDateKey,
  missionWeekdayPtBr,
  resolveMissionTimeZone,
} from "./missionCycle";

type MissionPeriod = "daily" | "weekly" | "monthly";

export type WeekdayPtBr =
  | "segunda"
  | "terca"
  | "quarta"
  | "quinta"
  | "sexta"
  | "sabado"
  | "domingo";

export type WeeklyPlanDay = {
  focus: string;
  muscles: string[];
  exercises: string[];
  intensity: string;
  rest_day: boolean;
};

export type MissionHistorySummaryRow = {
  title: string | null;
  type: string | null;
  status: string | null;
  is_completed: number | null;
  metric_type: string | null;
  metric_value: number | null;
  created_at: string | null;
  completed_at: string | null;
};

export type MissionGenerationProfileSnapshot = {
  userId: string;
  mainGoal: string;
  goals: string[];
  conditioning: ConditioningLevel;
  timeZone: string;
  currentWeekday: WeekdayPtBr;
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

type ValidationResult = {
  blueprints: MissionBlueprint[];
  invalidCount: number;
  totalCount: number;
};

type ActiveCycleMissionCounts = Record<MissionPeriod, number>;

type TrainingPlanOrchestrationDeps = {
  buildFallbackStructuredPlan: (
    profile: MissionGenerationProfileSnapshot,
    options: StructuredGenerationOptions,
  ) => StructuredMissionPlanDraft;
  buildInitialTrainingPlan: (
    env: Pick<Env, "RAPID_API_KEY">,
    mainGoal: string | null | undefined,
    conditioning: ConditioningLevel,
    equipment: string | null | undefined,
    injuries: string | null | undefined,
    trainingFrequency: number | null | undefined,
  ) => Promise<Record<string, unknown>>;
  buildStructuredPlanPrompt: (
    profile: MissionGenerationProfileSnapshot,
    options: StructuredGenerationOptions,
    retryReason?: string,
  ) => string;
  currentWeekKey: () => string;
  fallbackExercisesByFocus: (focus: string, muscles: string[]) => string[];
  getActiveCycleMissionCounts: (
    db: D1Database,
    userId: string,
    scope: "regular" | "ai_special",
  ) => Promise<ActiveCycleMissionCounts>;
  hasTableColumn: (
    db: D1Database,
    tableName: string,
    columnName: string,
  ) => Promise<boolean>;
  getErrorMessage: (error: unknown) => string;
  listCurrentCycleRegularDailyBlueprints: (
    db: D1Database,
    userId: string,
    profile: MissionGenerationProfileSnapshot,
  ) => Promise<MissionBlueprint[]>;
  normalizeConditioning: (value: unknown) => ConditioningLevel;
  normalizeTrainingFrequencyInput: (value: unknown) => number;
  normalizeTrainingPlanChatPreferences: (
    value: unknown,
  ) => TrainingPlanChatPreferences | null;
  parseStoredPlanRecord: (
    planJson: string | null | undefined,
  ) => Record<string, unknown> | null;
  persistGeneratedMissionPlan: (
    env: Env,
    db: D1Database,
    profile: MissionGenerationProfileSnapshot,
    blueprints: readonly MissionBlueprint[],
  ) => Promise<unknown[]>;
  requestStructuredMissionPlanFromAI: (
    env: Env,
    prompt: string,
  ) => Promise<StructuredMissionPlanDraft>;
  summarizeTrainingPlanChatPreferences: (
    preferences: TrainingPlanChatPreferences | null,
  ) => string;
  trainingPlanChatPreferencesHash: (
    preferences: TrainingPlanChatPreferences | null,
  ) => string;
  validateStructuredMissionPlan: (
    planDraft: StructuredMissionPlanDraft,
    profile: MissionGenerationProfileSnapshot,
    options: StructuredGenerationOptions,
  ) => ValidationResult;
  ensureStructuredPeriodicMissionsFromExistingDailyBlueprints: (
    env: Env,
    db: D1Database,
    userId: string,
    params: {
      weeklyTarget: number;
      monthlyTarget: number;
      replaceMissionIds?: readonly number[] | undefined;
    },
  ) => Promise<unknown>;
  parseJsonStringArray: (value: unknown) => string[];
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

// Shared normalization helpers keep profile snapshots deterministic before AI generation or fallback drafting.
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
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
  return Math.max(
    previous - 0.1,
    Math.min(previous + 0.1, Number(target.toFixed(2))),
  );
}

function buildCapacitySummary(
  rows: Array<{ skill_name: string; best_reps: number; total_time: number }>,
): string {
  if (rows.length === 0) return "sem historico de skills";
  return rows
    .slice(0, 8)
    .map((row) => {
      const reps = Math.max(0, Number(row.best_reps ?? 0));
      const time = Math.max(0, Number(row.total_time ?? 0));
      if (reps > 0) return `${row.skill_name}: ${reps} reps`;
      if (time > 0) return `${row.skill_name}: ${time}s`;
      return row.skill_name;
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

  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim()
      .toLowerCase();
  const findBest = (matcher: (skillName: string) => boolean, fallback: number) => {
    const matched = capacityRows.find((row) => matcher(normalize(row.skill_name)));
    return matched ? Math.max(fallback, Number(matched.best_reps ?? 0)) : fallback;
  };

  return {
    pushups: findBest(
      (value) => value.includes("push") || value.includes("flexao"),
      10,
    ),
    situps: findBest(
      (value) => value.includes("abdominal") || value.includes("sit"),
      12,
    ),
    squats: findBest(
      (value) => value.includes("squat") || value.includes("agach"),
      15,
    ),
  };
}

function parseGoalsJson(
  parseJsonStringArray: (value: unknown) => string[],
  rawValue: unknown,
  fallbackGoal: string,
): string[] {
  const parsedGoals = parseJsonStringArray(rawValue);
  const normalizedGoals = parsedGoals
    .map((goal) => goal.trim())
    .filter((goal) => goal.length > 0);
  if (normalizedGoals.length > 0) {
    return Array.from(new Set(normalizedGoals));
  }
  return [fallbackGoal];
}

export function buildPlanProfileHash(
  mainGoal: string,
  conditioning: ConditioningLevel,
  injuries: string,
  equipment: string,
  trainingPlanChatPreferencesHash: (
    preferences: TrainingPlanChatPreferences | null,
  ) => string,
  chatPreferences: TrainingPlanChatPreferences | null = null,
): string {
  return [
    mainGoal,
    conditioning,
    injuries,
    equipment,
    trainingPlanChatPreferencesHash(chatPreferences),
  ]
    .map((item) => item.trim().toLowerCase())
    .join("|");
}

export function normalizeWeeklyPlanDay(
  fallbackExercisesByFocus: (focus: string, muscles: string[]) => string[],
  rawDay: unknown,
  fallbackFocus: string,
  fallbackMuscles: string[],
): WeeklyPlanDay {
  const source =
    typeof rawDay === "object" && rawDay !== null
      ? (rawDay as Record<string, unknown>)
      : {};
  const focus =
    typeof source.focus === "string" && source.focus.trim().length > 0
      ? source.focus
      : fallbackFocus;
  const muscles = toStringArray(source.muscles);
  const exercises = toStringArray(source.exercises);
  const intensity =
    typeof source.intensity === "string" && source.intensity.trim().length > 0
      ? source.intensity
      : "moderada";
  const restDay = Boolean(source.rest_day) || focus.toLowerCase().includes("rest");
  const normalizedMuscles = muscles.length > 0 ? muscles : fallbackMuscles;
  const normalizedExercises =
    exercises.length > 0
      ? exercises
      : fallbackExercisesByFocus(focus, normalizedMuscles);

  return {
    focus,
    muscles: normalizedMuscles.slice(0, 5),
    exercises: sanitizeMissionExerciseNames({
      requestedNames: normalizedExercises,
      focus,
      limit: Math.max(3, Math.min(6, normalizedExercises.length || 3)),
      fallbackOrder: ["focus", "catalog"],
    }),
    intensity,
    rest_day: restDay,
  };
}

export function createTrainingPlanOrchestrationService(
  deps: TrainingPlanOrchestrationDeps,
) {
  // Builds the canonical generation snapshot from profile, history, capacities, and stored training-plan context.
  async function loadMissionGenerationProfile(
    env: Pick<Env, "RAPID_API_KEY">,
    db: D1Database,
    userId: string,
  ): Promise<MissionGenerationProfileSnapshot | null> {
    const hasMissionStatusColumn = await deps.hasTableColumn(
      db,
      "missions",
      "status",
    );
    const failedCountExpression = hasMissionStatusColumn
      ? "COALESCE(SUM(CASE WHEN COALESCE(status,'pending') IN ('failed', 'expired') THEN 1 ELSE 0 END), 0)"
      : "0";
    const historyStatusSelect = hasMissionStatusColumn ? "status" : "NULL as status";

    const [
      profile,
      progression,
      attributes,
      historySummary,
      recentHistoryRows,
      capacityRows,
      planRow,
    ] = await Promise.all([
      db
        .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
        .bind(userId)
        .first<Record<string, unknown>>(),
      db
        .prepare("SELECT level FROM user_progression WHERE user_id = ?")
        .bind(userId)
        .first<{ level: number | null }>(),
      db
        .prepare(
          "SELECT strength, constitution, vitality, dexterity, focus FROM user_attributes WHERE user_id = ?",
        )
        .bind(userId)
        .first<{
          strength: number | null;
          constitution: number | null;
          vitality: number | null;
          dexterity: number | null;
          focus: number | null;
        }>(),
      db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END), 0) as completed_count,
             ${failedCountExpression} as failed_count
           FROM missions
           WHERE user_id = ?
             AND datetime(created_at) >= datetime('now', '-7 day')`,
        )
        .bind(userId)
        .first<{ completed_count: number; failed_count: number }>(),
      db
        .prepare(
          `SELECT title, type, ${historyStatusSelect}, is_completed, metric_type, metric_value, created_at, completed_at
           FROM missions
           WHERE user_id = ?
             AND datetime(created_at) >= datetime('now', '-7 day')
           ORDER BY datetime(created_at) DESC
           LIMIT 20`,
        )
        .bind(userId)
        .all<MissionHistorySummaryRow>(),
      db
        .prepare(
          `SELECT s.name as skill_name, COALESCE(us.best_reps,0) as best_reps, COALESCE(us.total_time,0) as total_time
           FROM user_skills us
           INNER JOIN skills s ON s.id = us.skill_id
           WHERE us.user_id = ?
           ORDER BY COALESCE(us.best_reps,0) DESC, COALESCE(us.total_time,0) DESC`,
        )
        .bind(userId)
        .all<{ skill_name: string; best_reps: number; total_time: number }>(),
      db
        .prepare(
          "SELECT weekly_plan_json, training_frequency FROM user_training_plans WHERE user_id = ?",
        )
        .bind(userId)
        .first<{ weekly_plan_json: string | null; training_frequency: number | null }>(),
    ]);

    const mainGoal =
      typeof profile?.main_goal === "string" ? profile.main_goal.trim() : "";
    const conditioningSource =
      typeof profile?.initial_conditioning === "string"
        ? profile.initial_conditioning
        : "";
    if (!profile || !mainGoal || !conditioningSource) {
      return null;
    }

    const conditioning = deps.normalizeConditioning(conditioningSource);
    const timeZone = resolveMissionTimeZone(
      typeof profile.timezone === "string" ? profile.timezone : null,
    );
    const currentWeekday = missionWeekdayPtBr(
      new Date(),
      timeZone,
    ) as WeekdayPtBr;
    const injuries = typeof profile.injuries === "string" ? profile.injuries : "";
    const equipment = typeof profile.equipment === "string" ? profile.equipment : "";
    const goals = parseGoalsJson(deps.parseJsonStringArray, profile.goals_json, mainGoal);
    const completedCount = Number(historySummary?.completed_count ?? 0);
    const failedCount = Number(historySummary?.failed_count ?? 0);
    const completionRateValue = completionRate(completedCount, failedCount);
    const weekKey = missionCycleDateKey("weekly", timeZone);
    const previousPlanRaw = deps.parseStoredPlanRecord(planRow?.weekly_plan_json);
    const chatPlanPreferences = deps.normalizeTrainingPlanChatPreferences(
      previousPlanRaw?.chat_preferences,
    );
    const profileHash = buildPlanProfileHash(
      mainGoal,
      conditioning,
      injuries,
      equipment,
      deps.trainingPlanChatPreferencesHash,
      chatPlanPreferences,
    );
    const previousWeekKey =
      typeof previousPlanRaw?.week_key === "string" ? previousPlanRaw.week_key : "";
    const previousHash =
      typeof previousPlanRaw?.profile_hash === "string"
        ? previousPlanRaw.profile_hash
        : "";
    const previousVolumeMultiplier =
      typeof previousPlanRaw?.volume_multiplier === "number"
        ? previousPlanRaw.volume_multiplier
        : 1;
    const volumeMultiplier = normalizeVolumeMultiplier(
      previousVolumeMultiplier,
      completionRateValue,
    );
    const fallbackPlan = await deps.buildInitialTrainingPlan(
      env,
      mainGoal,
      conditioning,
      equipment,
      injuries,
      planRow?.training_frequency,
    );
    const fallbackWeekly =
      typeof fallbackPlan.weekly === "object" && fallbackPlan.weekly !== null
        ? (fallbackPlan.weekly as Record<string, unknown>)
        : {};
    const normalizedWeeklyPlan = {} as Record<WeekdayPtBr, WeeklyPlanDay>;
    for (const day of WEEKDAY_ORDER) {
      const daySource =
        previousPlanRaw && previousWeekKey === weekKey && previousHash === profileHash
          ? typeof previousPlanRaw.weekly === "object" &&
            previousPlanRaw.weekly !== null
            ? (previousPlanRaw.weekly as Record<string, unknown>)[day]
            : fallbackWeekly[day]
          : fallbackWeekly[day];
      normalizedWeeklyPlan[day] = normalizeWeeklyPlanDay(
        deps.fallbackExercisesByFocus,
        daySource,
        day,
        ["full body"],
      );
    }

    const capacityRowsArray = Array.isArray(capacityRows.results)
      ? capacityRows.results
      : [];

    return {
      userId,
      mainGoal,
      goals,
      conditioning,
      timeZone,
      currentWeekday,
      injuries,
      equipment,
      trainingFrequency: deps.normalizeTrainingFrequencyInput(
        planRow?.training_frequency,
      ),
      weekKey,
      profileHash,
      volumeMultiplier,
      weeklyPlan: normalizedWeeklyPlan,
      recentHistory: Array.isArray(recentHistoryRows.results)
        ? recentHistoryRows.results
        : [],
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

  // Tops up missing daily missions without disturbing an already-valid cycle.
  async function topUpStructuredDailyMissionsForUser(
    env: Env,
    db: D1Database,
    userId: string,
    requestedAmount: number,
  ): Promise<void> {
    const profile = await loadMissionGenerationProfile(env, db, userId);
    if (!profile) return;

    const boundedRequestedAmount = Math.max(
      1,
      Math.min(requestedAmount, MISSION_LIMITS.daily),
    );
    const generationOptions: StructuredGenerationOptions = {
      isAiSpecial: false,
      dailyTarget: MISSION_LIMITS.daily,
      weeklyTarget: 0,
      monthlyTarget: 0,
    };

    const existingDailyBlueprints =
      await deps.listCurrentCycleRegularDailyBlueprints(db, userId, profile);
    const existingKeys = new Set(
      existingDailyBlueprints.map(
        (blueprint) => `${blueprint.compatibilityKey}:${blueprint.metricType}`,
      ),
    );

    const fallbackPlan = deps.buildFallbackStructuredPlan(
      profile,
      generationOptions,
    );
    let validation = deps.validateStructuredMissionPlan(
      fallbackPlan,
      profile,
      generationOptions,
    );
    const apiKey = getOpenRouterApiKey(env);
    if (apiKey) {
      const aiResult = await requestValidatedStructuredPlanWithRetry({
        buildPrompt: (retryReason?: string) =>
          deps.buildStructuredPlanPrompt(
            profile,
            generationOptions,
            retryReason,
          ),
        buildInvalidRatioRetryReason: (invalidRatio) =>
          `Mais de 30% das missões diárias vieram inválidas (${Math.round(invalidRatio * 100)}%). Corrija nomes canônicos, métricas e volume.`,
        getErrorMessage: deps.getErrorMessage,
        requestPlan: (prompt) =>
          deps.requestStructuredMissionPlanFromAI(env, prompt),
        validatePlan: (planDraft) =>
          deps.validateStructuredMissionPlan(
            planDraft,
            profile,
            generationOptions,
          ),
      });
      if (aiResult.accepted && aiResult.validation) {
        validation = aiResult.validation;
      }
    }

    const dailyCandidates = validation.blueprints.filter(
      (blueprint) => blueprint.period === "daily",
    );
    const selected: MissionBlueprint[] = [];
    const selectedKeys = new Set<string>();
    const addCandidate = (
      candidate: MissionBlueprint,
    ) => {
      if (selected.length >= boundedRequestedAmount) return;
      const key = `${candidate.compatibilityKey}:${candidate.metricType}`;
      if (existingKeys.has(key)) return;
      if (selectedKeys.has(key)) return;
      selected.push(candidate);
      selectedKeys.add(key);
    };

    for (const candidate of dailyCandidates) {
      addCandidate(candidate);
    }

    if (selected.length === 0) return;

    await deps.persistGeneratedMissionPlan(
      env,
      db,
      profile,
      selected.slice(0, boundedRequestedAmount),
    );
  }

  // Orchestrates period creation by choosing between AI output, validation, fallback drafting, and persistence.
  async function createMissionsForPeriod(
    env: Env,
    db: D1Database,
    userId: string,
    period: MissionPeriod,
    requestedAmount?: number,
  ): Promise<void> {
    if (period !== "daily") {
      const boundedRequestedAmount = Math.max(
        1,
        Math.min(
          requestedAmount ?? MISSION_LIMITS[period],
          MISSION_LIMITS[period],
        ),
      );
      const activeCounts = await deps.getActiveCycleMissionCounts(
        db,
        userId,
        "regular",
      );
      if (activeCounts.daily === 0) {
        await createMissionsForPeriod(
          env,
          db,
          userId,
          "daily",
          MISSION_LIMITS.daily,
        );
      }
      await deps.ensureStructuredPeriodicMissionsFromExistingDailyBlueprints(
        env,
        db,
        userId,
        {
          weeklyTarget: period === "weekly" ? boundedRequestedAmount : 0,
          monthlyTarget: period === "monthly" ? boundedRequestedAmount : 0,
        },
      );
      return;
    }

    const boundedRequestedAmount = Math.max(
      1,
      Math.min(requestedAmount ?? MISSION_LIMITS.daily, MISSION_LIMITS.daily),
    );
    await topUpStructuredDailyMissionsForUser(
      env,
      db,
      userId,
      boundedRequestedAmount,
    );
  }

  return {
    createMissionsForPeriod,
    loadMissionGenerationProfile,
    topUpStructuredDailyMissionsForUser,
  };
}
