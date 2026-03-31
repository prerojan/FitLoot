import { describe, expect, it } from "vitest";
import { createMissionPlanValidationService } from "../../worker/services/missionPlanValidation";

function createValidationServiceForTests() {
  return createMissionPlanValidationService({
    buildCircuitTasks: () => [],
    buildFallbackStructuredPlan: () => ({ weekly_plan: {} }),
    buildMissionCompatibilityTerms: (missionName: string) => [missionName],
    buildMonthlyCounterMissionBlueprints: () => [],
    clampXpRewardByPeriod: (_period, rawValue) => Number(rawValue ?? 200),
    conditionedMetricValue: () => 20,
    convertStructuredMetricValue: (_metricType, rawValue) =>
      Math.max(1, Number(rawValue ?? 20)),
    derivePointsRewardByPeriod: (_period, rawValue) => Number(rawValue ?? 40),
    extractExerciseName: (title: string) => title,
    isCircuitLikeText: () => false,
    missionConfigByPeriod: () => ({ xp: 200, points: 40 }),
    normalizeDifficultyLabel: (value: unknown, fallback: string) =>
      typeof value === "string" && value.trim().length > 0 ? value : fallback,
    normalizeMatchText: (value: string) =>
      String(value ?? "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim()
        .toLowerCase(),
    stripMissionTaskPrefix: (title: string) => title,
    structuredMetricTypeToMissionMetric: () => "repetitions",
    toPositiveInt: (value: unknown, fallback: number) =>
      Number.isFinite(Number(value)) ? Number(value) : fallback,
    toSafeString: (value: unknown, fallback: string) =>
      typeof value === "string" && value.trim().length > 0 ? value : fallback,
  });
}

function createDailyBlueprint(params: {
  name: string;
  compatibilityKey: string;
  compatibilityTerms: string[];
}) {
  return {
    period: "daily" as const,
    name: params.name,
    description: "",
    goal: null,
    exerciseName: params.name,
    muscle: "full body",
    metricType: "repetitions" as const,
    metricValue: 20,
    xpReward: 100,
    pointsReward: 20,
    difficultyLevel: "iniciante",
    missionOrigin: "regular" as const,
    isAiSpecial: false,
    compatibilityKey: params.compatibilityKey,
    compatibilityTerms: params.compatibilityTerms,
    subtasks: [],
  };
}

describe("missionPlanValidation.resolvePeriodicMissionBlueprints", () => {
  it("prioriza o match canonico da subtarefa e ignora termo generico de compatibilidade", () => {
    const service = createValidationServiceForTests();
    const dailyBlueprints = [
      createDailyBlueprint({
        name: "Prancha",
        compatibilityKey: "plank",
        compatibilityTerms: ["prancha", "plank", "core", "minutes"],
      }),
      createDailyBlueprint({
        name: "Walking",
        compatibilityKey: "walking",
        compatibilityTerms: ["walking", "walk", "cardio", "minutes"],
      }),
    ];

    const resolution = service.resolvePeriodicMissionBlueprints({
      period: "weekly",
      targetCount: 1,
      drafts: [
        {
          name: "Meta Cardio",
          goal: "Conclua caminhadas",
          xp_reward: 260,
          fitcoins_reward: 52,
          subtasks: ["Concluir walking 20 minutes"],
        },
      ],
      fallbackDrafts: [],
      dailyBlueprints,
      profile: {
        conditioning: "iniciante",
        trainingFrequency: 3,
        volumeMultiplier: 1,
      },
      missionOrigin: "regular",
      isAiSpecial: false,
    });

    expect(resolution.blueprints).toHaveLength(1);
    expect(resolution.blueprints[0].subtasks).toHaveLength(1);
    expect(resolution.blueprints[0].subtasks[0].compatibilityKey).toBe("walking");
  });

  it("mantem correspondencia para variacao textual quando o exercicio base e o mesmo", () => {
    const service = createValidationServiceForTests();
    const dailyBlueprints = [
      createDailyBlueprint({
        name: "Agachamento",
        compatibilityKey: "agachamento",
        compatibilityTerms: ["agachamento", "squat"],
      }),
      createDailyBlueprint({
        name: "Prancha",
        compatibilityKey: "prancha",
        compatibilityTerms: ["prancha", "plank"],
      }),
    ];

    const resolution = service.resolvePeriodicMissionBlueprints({
      period: "weekly",
      targetCount: 1,
      drafts: [
        {
          name: "Meta Pernas",
          goal: "Conclua agachamentos",
          xp_reward: 260,
          fitcoins_reward: 52,
          subtasks: ["agachamento livre"],
        },
      ],
      fallbackDrafts: [],
      dailyBlueprints,
      profile: {
        conditioning: "iniciante",
        trainingFrequency: 3,
        volumeMultiplier: 1,
      },
      missionOrigin: "regular",
      isAiSpecial: false,
    });

    expect(resolution.blueprints).toHaveLength(1);
    expect(resolution.blueprints[0].subtasks).toHaveLength(1);
    expect(resolution.blueprints[0].subtasks[0].compatibilityKey).toBe("agachamento");
  });
});
