import { describe, expect, it, vi } from "vitest";
import { createMissionPlanPersistenceService } from "../../worker/services/missionPlanPersistence";
import { createMockD1Database } from "./mockD1";

function createProfile() {
  return {
    userId: "user-1",
    mainGoal: "ganhar_massa",
    conditioning: "iniciante",
    timeZone: "America/Sao_Paulo",
    injuries: "",
    equipment: "bodyweight",
    trainingFrequency: 4,
    weekKey: "2026-04-06",
    profileHash: "hash",
    volumeMultiplier: 1,
    weeklyPlan: {},
    chatPlanPreferences: null,
  };
}

function createMaterializedMission(title: string, metricType: "repetitions" | "circuit_tasks") {
  return {
    title,
    description: "descricao",
    goal: null,
    metric_type: metricType,
    metric_value: metricType === "circuit_tasks" ? 3 : 20,
    metric_unit: metricType === "circuit_tasks" ? "tarefas" : "reps",
    sets: null,
    rest_seconds: null,
    instructions: [],
    exercise_instructions_en: [],
    exercise_instructions_pt: [],
    image_url: null,
    exercise_db_gif_url: null,
    exercise_db_image_url: null,
    muscle_groups: ["full body"],
    exercise_secondary_muscles: [],
    exercise_name: title,
    exercise_db_id: metricType === "circuit_tasks" ? null : "exercise-db-id",
    exercise_equipment: null,
    exercise_body_part: null,
    exercise_target: null,
    exercise_type: "strength" as const,
    body_area: "full" as const,
    attributes_benefited: [],
    xp_reward: 100,
    points_reward: 20,
    duration_estimate_minutes: 10,
    exercise_category: metricType === "circuit_tasks" ? "cardio_circuit" as const : "strength" as const,
    execution_mode: "standard" as const,
    activity_kind: null,
    mission_origin: "regular" as const,
    is_ai_special: 0,
    circuit_tasks: [],
    safety_tips: [],
    difficulty_level: "iniciante",
    video_url: null,
    thumbnail_url: null,
    target_reps: metricType === "repetitions" ? 20 : null,
    target_time: null,
  };
}

describe("missionPlanPersistence.persistGeneratedMissionPlan", () => {
  it("skips inserts that already exist in the current cycle snapshot", async () => {
    const insertMission = vi.fn(async () => 101);
    const service = createMissionPlanPersistenceService({
      buildMissionCompatibilityTerms: (missionName: string) => [missionName],
      buildMonthlyCounterMissionBlueprints: () => [],
      createMissionSubtasks: vi.fn(async () => undefined),
      extractExerciseName: (title: string) =>
        title
          .replace(/^Missao Diaria:\s*/i, "")
          .replace(/^Missao Semanal:\s*/i, "")
          .trim(),
      futureIsoForPeriod: () => "2026-04-08T12:00:00.000Z",
      getMonthlyCounters: vi.fn(async () => ({})),
      hasTableColumn: vi.fn(async () => true),
      invalidateMissionListCache: vi.fn(() => undefined),
      insertMission,
      listCurrentCycleMissions: vi.fn(async () => ([
        {
          type: "daily",
          title: "Missao Diaria: Agachamento livre",
          metric_type: "repetitions",
        },
        {
          type: "weekly",
          title: "Missao Semanal: Full Body Calisthenics Circuit",
          metric_type: "circuit_tasks",
        },
      ])),
      loadMissionGenerationProfile: vi.fn(async () => createProfile()),
      loadMissionSubtasksByParentIds: vi.fn(async () => new Map()),
      mapWithConcurrency: async (items, _concurrency, mapper) =>
        Promise.all(items.map((item, index) => mapper(item, index))),
      materializeMissionBlueprint: vi.fn(async (_env, _profile, blueprint) =>
        createMaterializedMission(
          blueprint.period === "daily"
            ? "Missao Diaria: Agachamento livre"
            : "Missao Semanal: Full Body Calisthenics Circuit",
          blueprint.period === "daily" ? "repetitions" : "circuit_tasks",
        )),
      materializationConcurrency: 4,
      mergeUniqueStrings: (values: string[]) => Array.from(new Set(values)),
      metricUnitByType: () => "reps",
      missionConfigByPeriod: () => ({ xp: 100, points: 20, titlePrefix: "Missao" }),
      missionCycleStartIso: () => "2026-04-08T00:00:00.000Z",
      monthlyMissionProgressValue: () => 0,
      normalizeDifficultyLabel: (value: unknown, fallback: string) =>
        typeof value === "string" && value.trim().length > 0 ? value : fallback,
      normalizeMatchText: (value: string) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .trim()
          .toLowerCase(),
      normalizeMissionMetricType: (rawType: unknown) =>
        rawType === "circuit_tasks" ? "circuit_tasks" : "repetitions",
      replaceMissionSubtasks: vi.fn(async () => undefined),
      resolvePeriodicMissionBlueprints: vi.fn(() => ({
        blueprints: [],
        invalidCount: 0,
        totalCount: 0,
      })),
      resolveSkillIdForExerciseMission: vi.fn(async () => null),
      serializeTrainingPlanChatPreferences: (preferences: unknown) => preferences,
      stripMissionDisplayTitlePrefix: (title: string) =>
        title.replace(/^Missao (Diaria|Semanal|Mensal):\s*/i, "").trim(),
      upsertTrainingPlan: vi.fn(async () => undefined),
      withTransaction: vi.fn(async (_db, run) => await run()),
    });

    await service.persistGeneratedMissionPlan(
      {} as never,
      {} as D1Database,
      createProfile(),
      [
        {
          period: "daily",
          name: "Agachamento livre",
          description: "",
          goal: null,
          exerciseName: "Agachamento livre",
          muscle: "quadriceps",
          metricType: "repetitions",
          metricValue: 20,
          xpReward: 100,
          pointsReward: 20,
          difficultyLevel: "iniciante",
          missionOrigin: "regular",
          isAiSpecial: false,
          compatibilityKey: "agachamento livre",
          compatibilityTerms: ["agachamento livre"],
          subtasks: [],
        },
        {
          period: "weekly",
          name: "Full Body Calisthenics Circuit",
          description: "",
          goal: "Conclua as missoes compativeis",
          exerciseName: "Full Body Calisthenics Circuit",
          muscle: "full body",
          metricType: "circuit_tasks",
          metricValue: 3,
          xpReward: 260,
          pointsReward: 55,
          difficultyLevel: "iniciante",
          missionOrigin: "regular",
          isAiSpecial: false,
          compatibilityKey: "full body calisthenics circuit",
          compatibilityTerms: ["full body calisthenics circuit"],
          subtasks: [],
        },
      ],
    );

    expect(insertMission).not.toHaveBeenCalled();
  });
});

describe("missionPlanPersistence.repairLegacyPeriodicMissions", () => {
  it("preserves weekly subtask progress and never lowers stored monthly progress during repair", async () => {
    const replaceMissionSubtasks = vi.fn(async () => undefined);
    const { db, calls } = createMockD1Database([
      {
        match: /SELECT id, type, title, description, goal, metric_type, metric_value, target_reps, target_time\s+FROM missions/,
        all: [
          {
            id: 71,
            type: "weekly",
            title: "Missao Semanal: Full Body Calisthenics Circuit",
            description: "",
            goal: "",
            metric_type: "circuit_tasks",
            metric_value: 3,
          },
          {
            id: 72,
            type: "monthly",
            title: "Meta Mensal: Passos do mes",
            description: "",
            goal: "Acumule passos",
            metric_type: "steps",
            metric_value: 120000,
            progress_value: 656,
          },
        ],
      },
      {
        match: /UPDATE missions\s+SET title = \?/,
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: /DELETE FROM mission_subtasks\s+WHERE parent_mission_id = \?/,
        run: { success: true, meta: { changes: 1 } },
      },
    ]);

    const service = createMissionPlanPersistenceService({
      buildMissionCompatibilityTerms: (missionName: string) => [missionName],
      buildMonthlyCounterMissionBlueprints: () => [
        {
          period: "monthly",
          name: "Passos do mes",
          description: "",
          goal: "Acumule passos ao longo do mes.",
          exerciseName: "Passos do mes",
          muscle: "full body",
          metricType: "steps",
          metricValue: 120000,
          xpReward: 620,
          pointsReward: 140,
          difficultyLevel: "iniciante",
          missionOrigin: "regular",
          isAiSpecial: false,
          compatibilityKey: "passos-do-mes",
          compatibilityTerms: ["passos do mes"],
          subtasks: [],
        },
      ],
      createMissionSubtasks: vi.fn(async () => undefined),
      extractExerciseName: (title: string) =>
        title
          .replace(/^Missao Diaria:\s*/i, "")
          .replace(/^Missao Semanal:\s*/i, "")
          .trim(),
      futureIsoForPeriod: () => "2026-04-08T12:00:00.000Z",
      getMonthlyCounters: vi.fn(async () => ({
        month_key: "2026-04",
        missions_completed: 0,
        steps: 400,
        distance_meters: 0,
        streak_days: 0,
        weekly_circuits_completed: 0,
      })),
      hasTableColumn: vi.fn(async (_db, _table, column) => column === "progress_value"),
      invalidateMissionListCache: vi.fn(() => undefined),
      insertMission: vi.fn(async () => 1),
      listCurrentCycleMissions: vi.fn(async () => ([
        {
          type: "daily",
          title: "Missao Diaria: Agachamento livre",
          description: "",
          metric_type: "repetitions",
          metric_value: 20,
          target_reps: 20,
          target_time: null,
          xp_reward: 100,
          points_reward: 20,
          exercise_name: "Agachamento livre",
          muscle_groups: ["quadriceps"],
          exercise_secondary_muscles: [],
        },
      ])),
      loadMissionGenerationProfile: vi.fn(async () => createProfile()),
      loadMissionSubtasksByParentIds: vi.fn(async () =>
        new Map([
          [
            71,
            [
              {
                id: 1,
                parent_mission_id: 71,
                mission_type: "daily",
                subtask_title: "Agachamento livre",
                compatibility_key: "agachamento livre",
                compatibility_terms: ["agachamento livre"],
                required_count: 3,
                current_count: 2,
                is_completed: false,
              },
            ],
          ],
        ])),
      mapWithConcurrency: async (items, _concurrency, mapper) =>
        Promise.all(items.map((item, index) => mapper(item, index))),
      materializeMissionBlueprint: vi.fn(async (_env, _profile, blueprint) =>
        createMaterializedMission(blueprint.name, "repetitions")),
      materializationConcurrency: 4,
      mergeUniqueStrings: (values: string[]) => Array.from(new Set(values)),
      metricUnitByType: (metricType) => (metricType === "circuit_tasks" ? "tarefas" : "reps"),
      missionConfigByPeriod: (period) => ({
        xp: period === "weekly" ? 260 : 620,
        points: period === "weekly" ? 55 : 140,
        titlePrefix: period === "weekly" ? "Missao Semanal" : "Meta Mensal",
      }),
      missionCycleStartIso: () => "2026-04-08T00:00:00.000Z",
      monthlyMissionProgressValue: (_mission, counters) => Number(counters.steps ?? 0),
      normalizeDifficultyLabel: (value: unknown, fallback: string) =>
        typeof value === "string" && value.trim().length > 0 ? value : fallback,
      normalizeMatchText: (value: string) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .trim()
          .toLowerCase(),
      normalizeMissionMetricType: (rawType: unknown) =>
        rawType === "steps" ? "steps" : rawType === "circuit_tasks" ? "circuit_tasks" : "repetitions",
      replaceMissionSubtasks,
      resolvePeriodicMissionBlueprints: vi.fn(() => ({
        blueprints: [
          {
            period: "weekly",
            name: "Full Body Calisthenics Circuit",
            description: "",
            goal: "Conclua as missoes compativeis nesta semana.",
            exerciseName: "Full Body Calisthenics Circuit",
            muscle: "full body",
            metricType: "circuit_tasks",
            metricValue: 3,
            xpReward: 260,
            pointsReward: 55,
            difficultyLevel: "iniciante",
            missionOrigin: "regular",
            isAiSpecial: false,
            compatibilityKey: "full-body-calisthenics-circuit",
            compatibilityTerms: ["full body calisthenics circuit"],
            subtasks: [
              {
                title: "Agachamento livre",
                compatibilityKey: "agachamento livre",
                compatibilityTerms: ["agachamento livre"],
                requiredCount: 3,
              },
            ],
          },
        ],
        invalidCount: 0,
        totalCount: 1,
      })),
      resolveSkillIdForExerciseMission: vi.fn(async () => null),
      serializeTrainingPlanChatPreferences: (preferences: unknown) => preferences,
      stripMissionDisplayTitlePrefix: (title: string) =>
        title.replace(/^Missao (Diaria|Semanal|Mensal):\s*/i, "").replace(/^Meta Mensal:\s*/i, "").trim(),
      upsertTrainingPlan: vi.fn(async () => undefined),
      withTransaction: vi.fn(async (_db, run) => await run()),
    });

    await service.repairLegacyPeriodicMissions(
      {} as never,
      db,
      "user-1",
    );

    const weeklyUpdateCall = calls.find((call) =>
      call.method === "run"
      && call.sql.includes("UPDATE missions")
      && call.params.includes(71),
    );
    const monthlyUpdateCall = calls.find((call) =>
      call.method === "run"
      && call.sql.includes("UPDATE missions")
      && call.params.includes(72),
    );

    expect(weeklyUpdateCall?.params).toContain(2);
    expect(monthlyUpdateCall?.params).toContain(656);
    expect(replaceMissionSubtasks).toHaveBeenCalledWith(
      db,
      71,
      expect.arrayContaining([
        expect.objectContaining({
          compatibilityKey: "agachamento livre",
        }),
      ]),
    );
  });
});
