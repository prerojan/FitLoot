import { describe, expect, it, vi } from "vitest";

vi.mock("../../worker/services/exerciseEnrichment", () => ({
  enrichExercise: vi.fn(async () => null),
}));

import { enrichExercise } from "../../worker/services/exerciseEnrichment";
import { resolveExerciseDisplayNamePt, resolveSupportedMissionExerciseName } from "../../shared/exerciseCatalog";
import { createMissionMaterializationService } from "../../worker/services/missionMaterialization";
import type { Env } from "../../worker/core/types";

function createService() {
  return createMissionMaterializationService({
    applyMissionMetricContext: (mission, _period, _exerciseName, metricType, metricValue) => ({
      ...mission,
      metric_type: metricType,
      metric_value: metricValue,
      metric_unit: metricType === "distance_meters" ? "m" : "repetitions",
      target_reps: metricType === "sets_reps" ? metricValue : null,
      target_time: metricType === "distance_meters" ? null : null,
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
    getMissionMetricType: (exerciseName) =>
      /walking|running|caminhada|corrida/i.test(exerciseName)
        ? "distance_meters"
        : "sets_reps",
    inferAttributes: () => ["forca"],
    inferBodyArea: () => "lower",
    inferExerciseType: (category) =>
      category === "walk" || category === "run" ? "cardio" : "strength",
    inferRestSeconds: () => 45,
    inferSets: () => 3,
    isMissionMetricType: (value): value is "sets_reps" | "distance_meters" =>
      value === "sets_reps" || value === "distance_meters",
    mergeUniqueStrings: (values, limit) =>
      Array.from(new Set(values.filter((value) => value.trim().length > 0))).slice(0, limit),
    metricUnitByType: (metricType) => (metricType === "distance_meters" ? "m" : "repetitions"),
    metricValueByPeriod: (metricType) => (metricType === "distance_meters" ? 2000 : 12),
    missionConfigByPeriod: () => ({ titlePrefix: "Missao Diaria" }),
    normalizeExerciseCategory: (exerciseName) =>
      /walking|caminhada/i.test(exerciseName)
        ? "walk"
        : /running|corrida/i.test(exerciseName)
          ? "run"
          : "strength",
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
    resolveMetricTypeForCategory: (category) =>
      category === "walk" || category === "run" ? "distance_meters" : "sets_reps",
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

  it("keeps allowed route-based regular daily missions without requiring ExerciseDB metadata", async () => {
    const service = createService();
    vi.mocked(enrichExercise).mockClear();

    const mission = await service.materializeMissionBlueprint(
      {} as Env,
      {
        mainGoal: "melhora de cardio",
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
        name: "Corrida leve no bairro",
        description: "Mantenha um ritmo constante.",
        goal: null,
        exerciseName: "running",
        muscle: "legs",
        metricType: "distance_meters",
        metricValue: 2400,
        xpReward: 20,
        pointsReward: 8,
        difficultyLevel: "iniciante",
        missionOrigin: "regular",
        isAiSpecial: false,
        compatibilityKey: "running",
        compatibilityTerms: ["running", "cardio"],
        subtasks: [],
      },
    );

    expect(mission.title).toContain("Corrida leve");
    expect(mission.metric_type).toBe("distance_meters");
    expect(mission.exercise_name).toBe("Corrida leve");
    expect(mission.exercise_db_id).toBeNull();
    expect(mission.exercise_db_image_url).toBeNull();
    expect(mission.image_url).toBeNull();
    expect(mission.exercise_category).toBe("run");
    expect(mission.execution_mode).toBe("route_tracking");
    expect(mission.activity_kind).toBe("running");
    expect(enrichExercise).not.toHaveBeenCalled();
  });
});
