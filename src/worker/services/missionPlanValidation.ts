import type { MissionMetricType } from "../../shared/types";
import {
  resolveExerciseDisplayNamePt,
} from "../../shared/exerciseCatalog";
import {
  buildMissionDisplayGoalFromTasks,
  localizeMissionText,
} from "../../shared/missionLocalization";
import { getMissionMetricType } from "../../constants/missionMetrics";
import type { StructuredGenerationOptions } from "./missionGeneration";
import { resolveMissionExerciseForGeneration } from "./missionExerciseSelection";

type MissionPeriod = "daily" | "weekly" | "monthly";

type StructuredDailyMissionDraftLike = {
  name?: string | undefined;
  description?: string | undefined;
  exercise_type?: string | undefined;
  muscle_group?: string | undefined;
  metric_type?: string | undefined;
  reps_or_value?: number | undefined;
  unit?: string | undefined;
  difficulty?: string | undefined;
  xp_reward?: number | undefined;
  fitcoins_reward?: number | undefined;
};

type StructuredPeriodicMissionDraftLike = {
  name?: string | undefined;
  description?: string | undefined;
  goal?: string | undefined;
  xp_reward?: number | undefined;
  fitcoins_reward?: number | undefined;
  subtasks?: string[] | undefined;
};

type StructuredMissionPlanDraftLike = {
  weekly_plan?: {
    daily_missions?: StructuredDailyMissionDraftLike[] | undefined;
    weekly_missions?: StructuredPeriodicMissionDraftLike[] | undefined;
    monthly_missions?: StructuredPeriodicMissionDraftLike[] | undefined;
  } | undefined;
};

type WeeklyPlanDayLike = {
  focus: string;
  muscles: string[];
  exercises: string[];
};

type MissionGenerationProfileLike = {
  mainGoal: string;
  goals: string[];
  conditioning: string;
  currentWeekday?: string | undefined;
  trainingFrequency: number;
  volumeMultiplier: number;
  weeklyPlan?: Record<string, WeeklyPlanDayLike | undefined> | undefined;
};

type ResolvedMissionSubtaskLike = {
  title: string;
  compatibilityKey: string;
  compatibilityTerms: string[];
  requiredCount: number;
};

type MissionBlueprintLike = {
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
  subtasks: ResolvedMissionSubtaskLike[];
};

type CircuitTaskLike = {
  label: string;
  mission_type: string;
  required_count: number;
};

type MissionConfigLike = {
  xp: number;
  points: number;
};

type ValidationResult<TBlueprint> = {
  blueprints: TBlueprint[];
  invalidCount: number;
  totalCount: number;
};

type MissionPlanValidationDeps = {
  buildCircuitTasks: (
    missionName: string,
    period: MissionPeriod,
  ) => readonly CircuitTaskLike[];
  buildFallbackStructuredPlan: (
    profile: MissionGenerationProfileLike,
    options: StructuredGenerationOptions,
  ) => StructuredMissionPlanDraftLike;
  buildMissionCompatibilityTerms: (
    missionName: string,
    muscle: string,
    metricType: MissionMetricType,
  ) => string[];
  buildMonthlyCounterMissionBlueprints: (
    profile: MissionGenerationProfileLike,
    targetCount: number,
    options: { missionOrigin: "regular"; isAiSpecial: boolean },
  ) => MissionBlueprintLike[];
  clampXpRewardByPeriod: (
    period: MissionPeriod,
    rawValue: unknown,
  ) => number;
  conditionedMetricValue: (
    metricType: MissionMetricType,
    period: MissionPeriod,
    conditioning: string,
    volumeMultiplier: number,
  ) => number;
  convertStructuredMetricValue: (
    metricType: MissionMetricType,
    rawValue: unknown,
    rawUnit: unknown,
  ) => number;
  derivePointsRewardByPeriod: (
    period: MissionPeriod,
    rawValue: unknown,
    xpReward: number,
  ) => number;
  extractExerciseName: (title: string) => string;
  isCircuitLikeText: (value: string) => boolean;
  missionConfigByPeriod: (period: MissionPeriod) => MissionConfigLike;
  normalizeDifficultyLabel: (
    value: unknown,
    fallback: string,
  ) => string;
  normalizeMatchText: (value: string) => string;
  stripMissionTaskPrefix: (title: string) => string;
  structuredMetricTypeToMissionMetric: (
    rawMetricType: unknown,
    exerciseName: string,
    exerciseType: string,
    muscleGroup: string,
    period: MissionPeriod,
  ) => MissionMetricType;
  toPositiveInt: (value: unknown, fallback: number) => number;
  toSafeString: (value: unknown, fallback: string) => string;
};

function resolveCurrentWeeklyPlanDay(
  profile: MissionGenerationProfileLike,
): WeeklyPlanDayLike {
  const weeklyPlan =
    typeof profile.weeklyPlan === "object" && profile.weeklyPlan !== null
      ? profile.weeklyPlan
      : {};
  const currentWeekday =
    typeof profile.currentWeekday === "string" && profile.currentWeekday.trim().length > 0
      ? profile.currentWeekday.trim()
      : "segunda";
  const fallbackDay =
    weeklyPlan.segunda
    ?? Object.values(weeklyPlan).find(
      (day): day is WeeklyPlanDayLike => Boolean(day),
    )
    ?? {
      focus: "full body",
      muscles: ["full body"],
      exercises: [],
    };
  return weeklyPlan[currentWeekday] ?? fallbackDay;
}

function normalizePlannedMuscle(
  requestedMuscle: string,
  plannedDay: WeeklyPlanDayLike,
  normalizeMatchText: (value: string) => string,
): string {
  const normalizedRequested = normalizeMatchText(requestedMuscle);
  const matchingMuscle = plannedDay.muscles.find((candidate) =>
    normalizeMatchText(candidate) === normalizedRequested,
  );
  if (matchingMuscle) {
    return matchingMuscle;
  }
  return plannedDay.muscles[0] ?? requestedMuscle;
}

function resolveSupportedDailyExerciseDraft(
  profile: MissionGenerationProfileLike,
  draft: StructuredDailyMissionDraftLike,
  fallbackName: string,
  deps: Pick<MissionPlanValidationDeps, "normalizeMatchText" | "toSafeString">,
): {
  exerciseName: string | null;
  muscleGroup: string;
  exerciseType: string;
  usedFallback: boolean;
} {
  const rawName = deps.toSafeString(draft.name, fallbackName);
  const rawMuscleGroup = deps.toSafeString(draft.muscle_group, "full body");
  const rawExerciseType = deps.toSafeString(draft.exercise_type, rawName);
  const plannedDay = resolveCurrentWeeklyPlanDay(profile);
  const plannedFocus = plannedDay.focus.trim().length > 0
    ? plannedDay.focus
    : rawExerciseType;
  const muscleGroup = normalizePlannedMuscle(
    rawMuscleGroup,
    plannedDay,
    deps.normalizeMatchText,
  );
  const plannedExercises = Array.isArray(plannedDay.exercises)
    ? plannedDay.exercises.filter((value) => value.trim().length > 0)
    : [];

  const strictSupported =
    resolveMissionExerciseForGeneration({
      requestedName: rawName,
      muscles: plannedDay.muscles.length > 0 ? plannedDay.muscles : [muscleGroup],
      focus: plannedFocus,
    })
    ?? plannedExercises
      .map((candidate) =>
        resolveMissionExerciseForGeneration({
          requestedName: candidate,
          muscles: plannedDay.muscles.length > 0 ? plannedDay.muscles : [muscleGroup],
          focus: plannedFocus,
        }))
      .find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
    ?? resolveMissionExerciseForGeneration({
      requestedName: rawName,
      muscles: [muscleGroup],
      focus: rawExerciseType,
    });

  return {
    exerciseName: strictSupported ?? null,
    muscleGroup,
    exerciseType: plannedFocus,
    usedFallback:
      typeof strictSupported === "string" &&
      deps.normalizeMatchText(strictSupported) !== deps.normalizeMatchText(rawName),
  };
}

function splitNormalizedMatchTokens(normalizedValue: string): string[] {
  return normalizedValue
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function containsWholeNormalizedPhrase(
  haystack: string,
  needle: string,
): boolean {
  return haystack === needle
    || haystack.startsWith(`${needle} `)
    || haystack.endsWith(` ${needle}`)
    || haystack.includes(` ${needle} `);
}

function scoreNormalizedSubtaskToCandidate(
  normalizedSubtask: string,
  normalizedCandidate: string,
): number {
  if (normalizedSubtask.length === 0 || normalizedCandidate.length === 0) {
    return 0;
  }
  if (normalizedSubtask === normalizedCandidate) {
    return 100;
  }
  if (containsWholeNormalizedPhrase(normalizedCandidate, normalizedSubtask)) {
    return 92;
  }

  const subtaskTokens = splitNormalizedMatchTokens(normalizedSubtask);
  const candidateTokens = splitNormalizedMatchTokens(normalizedCandidate);
  const subtaskTokenSet = new Set(subtaskTokens);
  const candidateTokenSet = new Set(candidateTokens);

  if (
    subtaskTokens.length >= 2 &&
    subtaskTokens.every((token) => candidateTokenSet.has(token))
  ) {
    return 86;
  }
  if (containsWholeNormalizedPhrase(normalizedSubtask, normalizedCandidate)) {
    if (candidateTokens.length >= 2) return 78;
    if (
      candidateTokens.length === 1 &&
      candidateTokens[0].length >= 5
    ) {
      return 72;
    }
  }
  if (
    candidateTokens.length >= 2 &&
    candidateTokens.every((token) => subtaskTokenSet.has(token))
  ) {
    return 74;
  }
  return 0;
}

function resolveDailyBlueprintForSubtask(
  normalizeMatchText: (value: string) => string,
  rawSubtask: string,
  dailyBlueprints: readonly MissionBlueprintLike[],
): MissionBlueprintLike | null {
  const normalizedSubtask = normalizeMatchText(rawSubtask);
  if (normalizedSubtask.length === 0) return null;

  let bestPrimaryMatch: { blueprint: MissionBlueprintLike; score: number } | null = null;
  for (const blueprint of dailyBlueprints) {
    const primaryCandidates = [
      normalizeMatchText(blueprint.compatibilityKey),
      normalizeMatchText(blueprint.name),
    ].filter((candidate) => candidate.length > 0);
    const primaryScore = primaryCandidates.reduce(
      (bestScore, candidate) =>
        Math.max(
          bestScore,
          scoreNormalizedSubtaskToCandidate(normalizedSubtask, candidate),
        ),
      0,
    );

    if (
      !bestPrimaryMatch ||
      primaryScore > bestPrimaryMatch.score
    ) {
      bestPrimaryMatch = { blueprint, score: primaryScore };
    }
  }
  if (bestPrimaryMatch && bestPrimaryMatch.score >= 70) {
    return bestPrimaryMatch.blueprint;
  }

  let bestCompatibilityMatch: { blueprint: MissionBlueprintLike; score: number } | null = null;
  for (const blueprint of dailyBlueprints) {
    const compatibilityCandidates = Array.from(
      new Set(
        blueprint.compatibilityTerms
          .map((term) => normalizeMatchText(term))
          .filter((candidate) => candidate.length >= 5),
      ),
    );
    const compatibilityScore = compatibilityCandidates.reduce(
      (bestScore, candidate) =>
        Math.max(
          bestScore,
          scoreNormalizedSubtaskToCandidate(normalizedSubtask, candidate),
        ),
      0,
    );

    if (
      !bestCompatibilityMatch ||
      compatibilityScore > bestCompatibilityMatch.score
    ) {
      bestCompatibilityMatch = { blueprint, score: compatibilityScore };
    }
  }

  if (bestCompatibilityMatch && bestCompatibilityMatch.score >= 85) {
    return bestCompatibilityMatch.blueprint;
  }

  return null;
}

function metricValidationRange(
  conditionedMetricValue: MissionPlanValidationDeps["conditionedMetricValue"],
  metricType: MissionMetricType,
  period: MissionPeriod,
  profile: MissionGenerationProfileLike,
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

export function createMissionPlanValidationService(
  deps: MissionPlanValidationDeps,
) {
  function buildLegacyCircuitSubtaskNames(
    missionName: string,
    period: MissionPeriod,
  ): string[] {
    if (period !== "weekly") return [];
    const circuitTasks = deps.buildCircuitTasks(missionName, period);
    return circuitTasks.flatMap((task) =>
      Array.from({ length: Math.max(1, task.required_count) }, () => {
        const localizedLabel = localizeMissionText(task.label) ?? task.label;
        const compatibleDailyName = deps.stripMissionTaskPrefix(localizedLabel);
        return compatibleDailyName.length > 0 ? compatibleDailyName : task.mission_type;
      }),
    );
  }

  function buildFallbackPeriodicSubtaskNames(
    period: MissionPeriod,
    index: number,
    dailyBlueprints: readonly MissionBlueprintLike[],
    profile: MissionGenerationProfileLike,
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
    return Array.from(
      { length: repeatCount },
      () => dailyBlueprints[index % dailyBlueprints.length].name,
    );
  }

  function resolveMissionSubtasks(
    rawSubtasks: string[] | undefined,
    dailyBlueprints: readonly MissionBlueprintLike[],
    period: MissionPeriod,
    index: number,
    profile: MissionGenerationProfileLike,
    missionName?: string,
  ): { subtasks: ResolvedMissionSubtaskLike[]; invalidCount: number } {
    const requestedSubtasks = Array.isArray(rawSubtasks) && rawSubtasks.length > 0
      ? rawSubtasks
      : buildFallbackPeriodicSubtaskNames(
        period,
        index,
        dailyBlueprints,
        profile,
        missionName,
      );

    const aggregated = new Map<string, ResolvedMissionSubtaskLike>();
    let invalidCount = 0;

    for (const rawSubtask of requestedSubtasks) {
      const match = resolveDailyBlueprintForSubtask(
        deps.normalizeMatchText,
        rawSubtask,
        dailyBlueprints,
      );
      if (!match) {
        invalidCount += 1;
        continue;
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
      const fallbackMatch =
        dailyBlueprints[index % Math.max(1, dailyBlueprints.length)] ?? null;
      if (fallbackMatch) {
        invalidCount += 1;
        aggregated.set(fallbackMatch.compatibilityKey, {
          title: fallbackMatch.name,
          compatibilityKey: fallbackMatch.compatibilityKey,
          compatibilityTerms: fallbackMatch.compatibilityTerms,
          requiredCount:
            period === "monthly"
              ? Math.max(2, Math.min(4, profile.trainingFrequency))
              : 1,
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
    drafts: readonly StructuredPeriodicMissionDraftLike[];
    fallbackDrafts: readonly StructuredPeriodicMissionDraftLike[];
    dailyBlueprints: readonly MissionBlueprintLike[];
    profile: MissionGenerationProfileLike;
    missionOrigin: "regular" | "ai";
    isAiSpecial: boolean;
  }): ValidationResult<MissionBlueprintLike> {
    const blueprints: MissionBlueprintLike[] = [];
    let invalidCount = 0;
    let totalCount = 0;

    for (let index = 0; index < params.targetCount; index += 1) {
      totalCount += 1;
      const draft = params.drafts[index];
      const source =
        draft ??
        params.fallbackDrafts[index % Math.max(1, params.fallbackDrafts.length)] ??
        null;
      if (!source) continue;
      if (!draft) invalidCount += 1;

      const fallbackName = params.period === "weekly"
        ? `Missao Semanal ${index + 1}`
        : `Missao Mensal ${index + 1}`;
      const name = deps.toSafeString(source.name, fallbackName);
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

      const goal = buildMissionDisplayGoalFromTasks(
        subtaskResolution.subtasks.map((subtask) => subtask.title),
        params.period,
      ) ?? deps.toSafeString(
        source.goal,
        params.period === "weekly"
          ? "Conclua as missoes diarias compativeis desta missao nesta semana."
          : "Conclua as missoes diarias compativeis desta missao ao longo deste mes.",
      );

      const rawXpReward = deps.toPositiveInt(
        source.xp_reward,
        deps.missionConfigByPeriod(params.period).xp,
      );
      const xpReward = deps.clampXpRewardByPeriod(params.period, source.xp_reward);
      if (xpReward !== rawXpReward) {
        invalidCount += 1;
      }

      blueprints.push({
        period: params.period,
        name,
        description: "",
        goal,
        exerciseName: name,
        muscle: "full body",
        metricType: "circuit_tasks",
        metricValue: Math.max(
          1,
          subtaskResolution.subtasks.reduce(
            (total, subtask) => total + subtask.requiredCount,
            0,
          ),
        ),
        xpReward,
        pointsReward: deps.derivePointsRewardByPeriod(
          params.period,
          source.fitcoins_reward,
          xpReward,
        ),
        difficultyLevel: params.profile.conditioning,
        missionOrigin: params.missionOrigin,
        isAiSpecial: params.isAiSpecial,
        compatibilityKey: deps.normalizeMatchText(name),
        compatibilityTerms: [name, goal],
        subtasks: subtaskResolution.subtasks,
      });
    }

    return { blueprints, invalidCount, totalCount };
  }

  function validateStructuredMissionPlan(
    planDraft: StructuredMissionPlanDraftLike,
    profile: MissionGenerationProfileLike,
    options: StructuredGenerationOptions,
  ): ValidationResult<MissionBlueprintLike> {
    const dailyDrafts = Array.isArray(planDraft.weekly_plan?.daily_missions)
      ? planDraft.weekly_plan?.daily_missions ?? []
      : [];
    const weeklyDrafts = Array.isArray(planDraft.weekly_plan?.weekly_missions)
      ? planDraft.weekly_plan?.weekly_missions ?? []
      : [];
    const blueprints: MissionBlueprintLike[] = [];
    let invalidCount = 0;
    let totalCount = 0;
    const promotedWeeklyDrafts: StructuredPeriodicMissionDraftLike[] = [];

    for (const draft of dailyDrafts.slice(0, options.dailyTarget + 3)) {
      totalCount += 1;
      const rawName = deps.toSafeString(draft.name, `Missao Diaria ${blueprints.length + 1}`);
      const {
        exerciseName: supportedExerciseName,
        muscleGroup,
        exerciseType,
        usedFallback,
      } = resolveSupportedDailyExerciseDraft(
        profile,
        draft,
        `Missao Diaria ${blueprints.length + 1}`,
        deps,
      );
      if (!supportedExerciseName) {
        invalidCount += 1;
        continue;
      }
      const name = resolveExerciseDisplayNamePt(supportedExerciseName) ?? rawName;
      if (usedFallback) {
        invalidCount += 1;
      }

      const description = deps.toSafeString(
        draft.description,
        `Complete a meta proposta em ${name}.`,
      );
      const expectedMetricType = getMissionMetricType(
        `${supportedExerciseName} ${exerciseType} ${muscleGroup}`,
      );

      if (
        expectedMetricType === "circuit_tasks" ||
        deps.isCircuitLikeText(name) ||
        deps.isCircuitLikeText(exerciseType)
      ) {
        const weeklyXpReward = deps.clampXpRewardByPeriod("weekly", draft.xp_reward);
        promotedWeeklyDrafts.push({
          name,
          description,
          goal: `Conclua o circuito ${name} nesta semana`,
          xp_reward: weeklyXpReward,
          fitcoins_reward: deps.derivePointsRewardByPeriod(
            "weekly",
            draft.fitcoins_reward,
            weeklyXpReward,
          ),
          subtasks: [],
        });
        invalidCount += 1;
        continue;
      }

      const metricType = deps.structuredMetricTypeToMissionMetric(
        draft.metric_type,
        supportedExerciseName,
        exerciseType,
        muscleGroup,
        "daily",
      );
      if (metricType !== expectedMetricType) {
        invalidCount += 1;
      }

      const metricValue = deps.convertStructuredMetricValue(
        metricType,
        draft.reps_or_value,
        draft.unit,
      );
      const metricRange = metricValidationRange(
        deps.conditionedMetricValue,
        metricType,
        "daily",
        profile,
      );
      if (metricValue < metricRange.min || metricValue > metricRange.max) {
        invalidCount += 1;
      }

      const rawXpReward = deps.toPositiveInt(
        draft.xp_reward,
        deps.missionConfigByPeriod("daily").xp,
      );
      const xpReward = deps.clampXpRewardByPeriod("daily", draft.xp_reward);
      if (xpReward !== rawXpReward) {
        invalidCount += 1;
      }

      const pointsReward = deps.derivePointsRewardByPeriod(
        "daily",
        draft.fitcoins_reward,
        xpReward,
      );

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
        difficultyLevel: deps.normalizeDifficultyLabel(
          draft.difficulty,
          profile.conditioning,
        ),
        missionOrigin: options.isAiSpecial ? "ai" : "regular",
        isAiSpecial: options.isAiSpecial,
        compatibilityKey: deps.normalizeMatchText(
          deps.extractExerciseName(supportedExerciseName),
        ),
        compatibilityTerms: deps.buildMissionCompatibilityTerms(
          `${name} ${supportedExerciseName}`,
          muscleGroup,
          metricType,
        ),
        subtasks: [],
      });
    }

    const fallbackPlan = deps.buildFallbackStructuredPlan(profile, options);
    const fallbackDailyDrafts = Array.isArray(fallbackPlan.weekly_plan?.daily_missions)
      ? fallbackPlan.weekly_plan?.daily_missions ?? []
      : [];

    while (blueprints.length < options.dailyTarget) {
      const fallbackDraft =
        fallbackDailyDrafts[
          blueprints.length % Math.max(1, fallbackDailyDrafts.length)
        ];
      if (!fallbackDraft) break;

      totalCount += 1;
      invalidCount += 1;

      const rawName = deps.toSafeString(
        fallbackDraft.name,
        `Missao Diaria ${blueprints.length + 1}`,
      );
      const {
        exerciseName: supportedExerciseName,
        muscleGroup,
        exerciseType,
      } = resolveSupportedDailyExerciseDraft(
        profile,
        fallbackDraft,
        `Missao Diaria ${blueprints.length + 1}`,
        deps,
      );
      if (!supportedExerciseName) {
        break;
      }
      const name = resolveExerciseDisplayNamePt(supportedExerciseName) ?? rawName;
      const metricType = deps.structuredMetricTypeToMissionMetric(
        fallbackDraft.metric_type,
        supportedExerciseName,
        exerciseType,
        muscleGroup,
        "daily",
      );

      const fallbackDailyXpReward = deps.clampXpRewardByPeriod(
        "daily",
        fallbackDraft.xp_reward,
      );

      blueprints.push({
        period: "daily",
        name,
        description: deps.toSafeString(
          fallbackDraft.description,
          `Complete a meta proposta em ${name}.`,
        ),
        goal: null,
        exerciseName: supportedExerciseName,
        muscle: muscleGroup,
        metricType,
        metricValue: deps.convertStructuredMetricValue(
          metricType,
          fallbackDraft.reps_or_value,
          fallbackDraft.unit,
        ),
        xpReward: fallbackDailyXpReward,
        pointsReward: deps.derivePointsRewardByPeriod(
          "daily",
          fallbackDraft.fitcoins_reward,
          fallbackDailyXpReward,
        ),
        difficultyLevel: deps.normalizeDifficultyLabel(
          fallbackDraft.difficulty,
          profile.conditioning,
        ),
        missionOrigin: options.isAiSpecial ? "ai" : "regular",
        isAiSpecial: options.isAiSpecial,
        compatibilityKey: deps.normalizeMatchText(
          deps.extractExerciseName(supportedExerciseName),
        ),
        compatibilityTerms: deps.buildMissionCompatibilityTerms(
          `${name} ${supportedExerciseName}`,
          muscleGroup,
          metricType,
        ),
        subtasks: [],
      });
    }

    const dailyBlueprints = blueprints.filter(
      (blueprint) => blueprint.period === "daily",
    );
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
        ...deps.buildMonthlyCounterMissionBlueprints(profile, options.monthlyTarget, {
          missionOrigin: "regular",
          isAiSpecial: false,
        }),
      );
    }

    return { blueprints, invalidCount, totalCount };
  }

  return {
    resolvePeriodicMissionBlueprints,
    validateStructuredMissionPlan,
  };
}
