import { describe, expect, it, vi } from "vitest";

vi.mock("../../worker/services/exerciseEnrichment", () => ({
  enrichExercise: vi.fn(async () => null),
}));

import { resolveExerciseDisplayNamePt, resolveSupportedMissionExerciseName } from "../../shared/exerciseCatalog";
import { createMissionMaterializationService } from "../../worker/services/missionMaterialization";
import type { Env } from "../../worker/core/types";

function createService() {
  return createMissionMaterializationService({
    applyMissionMetricContext: (mission, _period, _exerciseName, metricType, metricValue) => ({
      ...mission,
      metric_type: metricType,
      metric_value: metricValue,
      metric_unit: "repetitions",
      target_reps: metricType === "sets_reps" ? metricValue : null,
      target_time: null,
    }),
    buildCircuitTasks: () => [],
    buildMissionDescription: (exerciseName) => `Complete ${exerciseName}`,
    buildMissionDescriptionFromInstructions: (_instructions, fallback) => fallback,
    buildMissionInstructions: () => [
      "Prepare-se para o movimento.",
      "Execute a repeticao com controle.",
      "Mantenha a postura.",
      "Finalize com seguranca.",
    ],
    ensureInstructionSteps: (steps) => steps,
    estimateMissionDuration: () => 10,
    getMissionMetricType: () => "sets_reps",
    inferAttributes: () => ["forca"],
    inferBodyArea: () => "lower",
    inferExerciseType: () => "strength",
    inferRestSeconds: () => 45,
    inferSets: () => 3,
    isMissionMetricType: (value): value is "sets_reps" =>
      value === "sets_reps",
    mergeUniqueStrings: (values, limit) =>
      Array.from(new Set(values.filter((value) => value.trim().length > 0))).slice(0, limit),
    metricUnitByType: () => "repetitions",
    metricValueByPeriod: () => 12,
    missionConfigByPeriod: () => ({ titlePrefix: "Missao Diaria" }),
    normalizeExerciseCategory: () => "strength",
    normalizeInstructionList: (value, limit = 8) =>
      Array.isArray(value)
        ? value.map((item) => String(item)).slice(0, limit)
        : [],
    normalizeMatchText: (value) =>
      value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .trim(),
    parseJsonObjectFromModelContent: () => null,
    resolveMetricTypeForCategory: () => "sets_reps",
    resolveExerciseApiBodyArea: () => "lower",
    resolveExerciseApiMuscleGroups: () => ["glutes"],
    resolveExerciseDisplayNamePt: (exerciseName) =>
      resolveExerciseDisplayNamePt(exerciseName) ?? exerciseName,
    resolveSupportedMissionExerciseName: (exerciseName) =>
      resolveSupportedMissionExerciseName(exerciseName),
    shouldShowMissionDuration: () => true,
    toPositiveInt: (value, fallback) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
    },
    toSafeString: (value, fallback) =>
      typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : fallback,
  });
}

describe("missionMaterialization.materializeMissionBlueprint", () => {
  it("replaces unsupported regular daily exercises with a strict ExerciseDB-backed fallback", async () => {
    const service = createService();

    const mission = await service.materializeMissionBlueprint(
      {} as Env,
      {
        mainGoal: "ganho de forca",
        conditioning: "iniciante",
        injuries: "",
        equipment: "",
        volumeMultiplier: 1,
        level: 1,
        completionRate: 0.8,
        capacitySummary: "sem historico",
        attributes: {
          strength: 10,
          constitution: 10,
          vitality: 10,
          dexterity: 10,
          focus: 10,
        },
      },
      {
        period: "daily",
        name: "Sessao lower body guiada",
        description: "Foco em glutes e lower body",
        goal: null,
        exerciseName: "Guided lower-body flow",
        muscle: "glutes",
        metricType: "sets_reps",
        metricValue: 18,
        xpReward: 20,
        pointsReward: 8,
        difficultyLevel: "iniciante",
        missionOrigin: "regular",
        isAiSpecial: false,
        compatibilityKey: "lower-body",
        compatibilityTerms: ["glutes", "lower body"],
        subtasks: [],
      },
    );

    expect(mission.title).toContain("Agachamento livre");
    expect(mission.title.toLowerCase()).not.toContain("guiad");
    expect(mission.exercise_name).toBe("Agachamento livre");
    expect(mission.exercise_db_id).toBe("QChZi3x");
    expect(mission.exercise_db_image_url).toContain("QChZi3x");
    expect(mission.image_url).toContain("QChZi3x");
  });
});
