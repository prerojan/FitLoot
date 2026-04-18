import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerMissionRoutes } from "../../worker/routes/missions";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import { createAuthMiddleware, createExecutionContext, createJsonRequest, createTestEnv, TEST_USER } from "./testUtils";

function createMissionDeps(overrides: Partial<Parameters<typeof registerMissionRoutes>[1]> = {}) {
  return {
    applyMissionAttributeDeltaToUser: vi.fn(async () => undefined),
    applyXpPointsAndResolveLevels: vi.fn(async () => ({
      leveledUp: false,
      newLevel: 1,
      levelsGained: 0,
    })),
    checkMissionRelevance: vi.fn(async () => ({ isGoalRelevant: true })),
    clearMissionDetailCache: vi.fn(() => undefined),
    computeMissionTypeAttributeDelta: vi.fn(() => ({
      strength: 0,
      constitution: 0,
      vitality: 0,
      dexterity: 0,
      focus: 0,
    })),
    ensureInstructionSteps: vi.fn((steps: string[]) => steps),
    ensurePeriodicMissionsWithGuard: vi.fn(async () => undefined),
    ensureUserAttributesRow: vi.fn(async () => undefined),
    ensureUserCounterRow: vi.fn(async () => undefined),
    extractExerciseName: vi.fn((title: string) => title),
    generateStructuredMissionPlanForUser: vi.fn(async () => ({
      already_active: false,
      used_ai: false,
      invalid_ratio: 0,
      missions: [],
    })),
    getCurrentCycleMissionCounts: vi.fn(async () => ({
      daily: 1,
      weekly: 1,
      monthly: 1,
    })),
    getMonthlyCounters: vi.fn(async () => ({})),
    getRewardNotificationCursor: vi.fn(async () => 0),
    hydrateMissionRowsWithSubtasks: vi.fn(async (_db: D1Database, rows: Record<string, unknown>[]) => rows),
    invalidateMissionListCache: vi.fn(() => undefined),
    invalidateRankingCache: vi.fn(() => undefined),
    listRewardNotifications: vi.fn(async () => []),
    logUserEvent: vi.fn(async () => undefined),
    missionSummaryFromNormalized: vi.fn((mission: Record<string, unknown>) => mission),
    monthlyMissionProgressValue: vi.fn(() => 0),
    resolvePeriodicMissionProgressValue: vi.fn(async () => 0),
    normalizeInstructionList: vi.fn((value: unknown) => Array.isArray(value) ? value : []),
    normalizeMatchText: vi.fn((value: string) => value.trim().toLowerCase()),
    normalizeMissionMetricType: vi.fn(() => "repetitions"),
    normalizeMissionRow: vi.fn((row: Record<string, unknown>) => row),
    onGoalProgress: vi.fn(async () => undefined),
    onRankingUpdate: vi.fn(async () => undefined),
    onMissionComplete: vi.fn(async () => undefined),
    onStreakContinued: vi.fn(async () => undefined),
    repairActivatedProfileState: vi.fn(async () => ({ user_id: TEST_USER.id })),
    readMissionDetailCache: vi.fn(() => null),
    readMissionListCache: vi.fn(() => null),
    runMissionLifecycleHookSafely: vi.fn(async (_userId: string, _label: string, action: () => Promise<void>) => {
      await action();
    }),
    scheduleLegacyDailyMetadataRepairWithGuard: vi.fn(() => undefined),
    schedulePeriodicMissionsRefreshWithGuard: vi.fn(() => undefined),
    schedulePeriodicProgressRecomputeWithGuard: vi.fn(() => undefined),
    streamJsonArrayResponse: vi.fn((items: readonly unknown[], status: number = 200) =>
      new Response(JSON.stringify(items), {
        status,
        headers: { "content-type": "application/json" },
      })),
    syncTrainingRankState: vi.fn(async () => undefined),
    totalSkillTableAttributeGain: vi.fn(() => 0),
    translateExerciseInstructionsToPt: vi.fn(async (steps: string[]) => steps),
    tryUnlockSkillsFromPerformance: vi.fn(async () => undefined),
    unlockAchievementIfNeeded: vi.fn(async () => undefined),
    updateCircuitProgress: vi.fn(async () => undefined),
    updateMissionSubtaskProgress: vi.fn(async () => undefined),
    updateMonthlyMissionProgress: vi.fn(async () => undefined),
    withTransaction: vi.fn(async (_db: D1Database, action: () => Promise<unknown>) => await action()),
    writeMissionDetailCache: vi.fn(() => undefined),
    writeMissionListCache: vi.fn(() => undefined),
    ...overrides,
  } satisfies Parameters<typeof registerMissionRoutes>[1];
}

describe("mission routes", () => {
  it("serves the cached mission list without hitting the database query path", async () => {
    const cachedMissions = [
      {
        id: 11,
        title: "Missao diaria: Flexao tradicional",
        type: "daily",
        exercise_name: "push-up",
        exercise_db_id: "I4hDWkc",
        image_url: "https://static.exercisedb.dev/media/I4hDWkc.gif",
      },
    ];
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      readMissionListCache: vi.fn(() => cachedMissions),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(cachedMissions);
    expect(deps.schedulePeriodicMissionsRefreshWithGuard).not.toHaveBeenCalled();
    expect(deps.scheduleLegacyDailyMetadataRepairWithGuard).not.toHaveBeenCalled();
    expect(deps.schedulePeriodicProgressRecomputeWithGuard).not.toHaveBeenCalled();
    expect(deps.streamJsonArrayResponse).toHaveBeenCalledWith(cachedMissions);
  });

  it("does not trust an empty cached mission list and runs the self-heal read path", async () => {
    const { db } = createMockD1Database([
      {
        match: "PRAGMA table_info('missions')",
        all: [
          { name: "id" },
          { name: "user_id" },
          { name: "status" },
          { name: "skill_id" },
        ],
      },
      {
        match: "PRAGMA table_info('skills')",
        all: [],
      },
      {
        match: "SELECT m.*, s.name as skill_name FROM missions m",
        all: [],
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      readMissionListCache: vi.fn(() => []),
      getCurrentCycleMissionCounts: vi.fn(async () => ({
        daily: 0,
        weekly: 1,
        monthly: 1,
      })),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(deps.invalidateMissionListCache).toHaveBeenCalledWith(TEST_USER.id);
    expect(deps.ensurePeriodicMissionsWithGuard).toHaveBeenCalledWith(
      env,
      db,
      TEST_USER.id,
      {
        force: true,
        mode: "full",
      },
    );
    expect(deps.writeMissionListCache).not.toHaveBeenCalled();
  });

  it("bypasses cached daily missions that are outside the ExerciseDB-backed catalog", async () => {
    const cachedMissions = [
      {
        id: 21,
        title: "Missao diaria: exercicio guiado",
        type: "daily",
        exercise_name: "exercicio guiado",
        exercise_db_id: null,
        image_url: "https://cdn.example.com/generic.png",
      },
    ];
    const { db } = createMockD1Database([
      {
        match: "PRAGMA table_info('missions')",
        all: [
          { name: "id" },
          { name: "user_id" },
          { name: "status" },
          { name: "skill_id" },
        ],
      },
      {
        match: "PRAGMA table_info('skills')",
        all: [],
      },
      {
        match: "SELECT m.*, s.name as skill_name FROM missions m",
        all: [],
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      readMissionListCache: vi.fn(() => cachedMissions),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([]);
    expect(deps.invalidateMissionListCache).toHaveBeenCalledWith(TEST_USER.id);
    expect(deps.schedulePeriodicMissionsRefreshWithGuard).not.toHaveBeenCalled();
    expect(deps.scheduleLegacyDailyMetadataRepairWithGuard).not.toHaveBeenCalled();
  });

  it("serves a cached mission detail payload without querying the mission detail path", async () => {
    const cachedMissionDetail = {
      id: 15,
      title: "Missao detalhada em cache",
      type: "daily",
      exercise_instructions_en: [],
      exercise_instructions_pt: [],
      instructions: [],
      circuit_tasks: [],
    };
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      readMissionDetailCache: vi.fn(() => cachedMissionDetail),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions/15"),
      env,
      executionCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: 15,
      title: "Missao detalhada em cache",
      type: "daily",
    });
    expect(deps.hydrateMissionRowsWithSubtasks).not.toHaveBeenCalled();
    expect(deps.writeMissionDetailCache).not.toHaveBeenCalled();
  });

  it("keeps refresh reads free from maintenance hooks", async () => {
    const { db } = createMockD1Database([
      {
        match: "PRAGMA table_info('missions')",
        all: [
          { name: "id" },
          { name: "user_id" },
          { name: "status" },
          { name: "skill_id" },
        ],
      },
      {
        match: "PRAGMA table_info('skills')",
        all: [],
      },
      {
        match: "SELECT m.*, s.name as skill_name FROM missions m",
        all: [],
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps();
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions?refresh=1"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(deps.invalidateMissionListCache).toHaveBeenCalledWith(TEST_USER.id);
    expect(deps.schedulePeriodicMissionsRefreshWithGuard).not.toHaveBeenCalled();
    expect(deps.scheduleLegacyDailyMetadataRepairWithGuard).not.toHaveBeenCalled();
    expect(deps.schedulePeriodicProgressRecomputeWithGuard).not.toHaveBeenCalled();
  });

  it("self-heals the mission cycle when the current daily or weekly set is missing", async () => {
    const { db } = createMockD1Database([
      {
        match: "PRAGMA table_info('missions')",
        all: [
          { name: "id" },
          { name: "user_id" },
          { name: "status" },
          { name: "skill_id" },
        ],
      },
      {
        match: "PRAGMA table_info('skills')",
        all: [],
      },
      {
        match: "SELECT m.*, s.name as skill_name FROM missions m",
        all: [],
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      getCurrentCycleMissionCounts: vi.fn(async () => ({
        daily: 0,
        weekly: 0,
        monthly: 5,
      })),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions?refresh=1"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(deps.ensurePeriodicMissionsWithGuard).toHaveBeenCalledWith(
      env,
      db,
      TEST_USER.id,
      {
        force: true,
        mode: "full",
      },
    );
    expect(deps.invalidateMissionListCache).toHaveBeenCalledWith(TEST_USER.id);
  });

  it("filters out settled missions from the previous cycle while keeping the current cycle payload", async () => {
    const { db } = createMockD1Database([
      {
        match: "PRAGMA table_info('missions')",
        all: [
          { name: "id" },
          { name: "user_id" },
          { name: "status" },
          { name: "skill_id" },
        ],
      },
      {
        match: "PRAGMA table_info('skills')",
        all: [],
      },
      {
        match: "SELECT m.*, s.name as skill_name FROM missions m",
        all: [
          {
            id: 11,
            user_id: TEST_USER.id,
            type: "daily",
            title: "Missao Diaria: Agachamento livre",
            status: "pending",
            is_completed: 0,
            cycle_date: "2026-04-08",
            created_at: "2026-04-08T03:10:00.000Z",
            updated_at: "2026-04-08T03:10:00.000Z",
          },
          {
            id: 12,
            user_id: TEST_USER.id,
            type: "daily",
            title: "Missao Diaria: Flexao tradicional",
            status: "expired",
            is_completed: 0,
            cycle_date: "2026-04-07",
            created_at: "2026-04-07T03:10:00.000Z",
            updated_at: "2026-04-08T03:00:00.000Z",
          },
        ],
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps();
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions", {
        headers: {
          "X-FitLoot-Timezone": "America/Sao_Paulo",
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      id: 11,
      status: "pending",
      cycle_date: "2026-04-08",
    });
  });

  it("hydrates weekly and monthly step progress from the periodic progress resolver", async () => {
    const { db } = createMockD1Database([
      {
        match: "PRAGMA table_info('missions')",
        all: [
          { name: "id" },
          { name: "user_id" },
          { name: "status" },
          { name: "skill_id" },
        ],
      },
      {
        match: "PRAGMA table_info('skills')",
        all: [],
      },
      {
        match: "SELECT m.*, s.name as skill_name FROM missions m",
        all: [
          {
            id: 41,
            user_id: TEST_USER.id,
            type: "weekly",
            title: "Passos da semana",
            metric_type: "steps",
            metric_value: 12000,
            progress_value: null,
            is_completed: 0,
          },
          {
            id: 42,
            user_id: TEST_USER.id,
            type: "monthly",
            title: "Passos do mes",
            metric_type: "steps",
            metric_value: 60000,
            progress_value: null,
            is_completed: 0,
          },
        ],
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      normalizeMissionRow: vi.fn((row: Record<string, unknown>) => ({
        ...row,
        circuit_tasks: [],
        exercise_instructions_en: [],
        exercise_instructions_pt: [],
        instructions: [],
      })),
      resolvePeriodicMissionProgressValue: vi.fn(async (_userId: string, mission: Record<string, unknown>) =>
        Number(mission.id) === 41 ? 3456 : 7890,
      ),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      expect.objectContaining({ id: 41, progress_value: 3456 }),
      expect.objectContaining({ id: 42, progress_value: 7890 }),
    ]);
    expect(deps.resolvePeriodicMissionProgressValue).toHaveBeenCalledTimes(2);
  });

  it("prefers live accumulated progress over stale stored values for periodic step missions", async () => {
    const { db } = createMockD1Database([
      {
        match: "PRAGMA table_info('missions')",
        all: [
          { name: "id" },
          { name: "user_id" },
          { name: "status" },
          { name: "skill_id" },
        ],
      },
      {
        match: "PRAGMA table_info('skills')",
        all: [],
      },
      {
        match: "SELECT m.*, s.name as skill_name FROM missions m",
        all: [
          {
            id: 43,
            user_id: TEST_USER.id,
            type: "monthly",
            title: "Passos persistidos",
            metric_type: "steps",
            metric_value: 15000,
            progress_value: 4321,
            is_completed: 0,
          },
        ],
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      getMonthlyCounters: vi.fn(async () => ({
        month_key: "2026-04",
        missions_completed: 0,
        steps: 9876,
        distance_meters: 0,
        streak_days: 0,
        weekly_circuits_completed: 0,
      })),
      normalizeMissionRow: vi.fn((row: Record<string, unknown>) => ({
        ...row,
        circuit_tasks: [],
        exercise_instructions_en: [],
        exercise_instructions_pt: [],
        instructions: [],
      })),
      normalizeMissionMetricType: vi.fn(() => "steps"),
      resolvePeriodicMissionProgressValue: vi.fn(async () => 9876),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      expect.objectContaining({ id: 43, progress_value: 9876 }),
    ]);
    expect(deps.resolvePeriodicMissionProgressValue).toHaveBeenCalledTimes(1);
  });

  it("hydrates mission detail progress for active periodic step missions", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT m.*, NULL as skill_name",
        first: {
          id: 51,
          user_id: TEST_USER.id,
          type: "weekly",
          title: "Passos acumulados",
          metric_type: "steps",
          metric_value: 18000,
          progress_value: null,
          is_completed: 0,
        },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      normalizeMissionRow: vi.fn((row: Record<string, unknown>) => ({
        ...row,
        circuit_tasks: [],
        exercise_instructions_en: [],
        exercise_instructions_pt: [],
        instructions: [],
      })),
      resolvePeriodicMissionProgressValue: vi.fn(async () => 5432),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions/51"),
      env,
      executionCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: 51,
      progress_value: 5432,
    });
    expect(deps.resolvePeriodicMissionProgressValue).toHaveBeenCalledTimes(1);
  });

  it("recomputes mission detail progress when stored accumulated progress is stale", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT m.*, NULL as skill_name",
        first: {
          id: 52,
          user_id: TEST_USER.id,
          type: "monthly",
          title: "Passos do mes",
          metric_type: "steps",
          metric_value: 120000,
          progress_value: 0,
          is_completed: 0,
        },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      getMonthlyCounters: vi.fn(async () => ({
        month_key: "2026-04",
        missions_completed: 0,
        steps: 7654,
        distance_meters: 0,
        streak_days: 0,
        weekly_circuits_completed: 0,
      })),
      normalizeMissionRow: vi.fn((row: Record<string, unknown>) => ({
        ...row,
        circuit_tasks: [],
        exercise_instructions_en: [],
        exercise_instructions_pt: [],
        instructions: [],
      })),
      normalizeMissionMetricType: vi.fn(() => "steps"),
      resolvePeriodicMissionProgressValue: vi.fn(async () => 7654),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions/52"),
      env,
      executionCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: 52,
      progress_value: 7654,
    });
    expect(deps.resolvePeriodicMissionProgressValue).toHaveBeenCalledTimes(1);
  });

  it("invalidates mission caches after generating the regular mission plan", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const deps = createMissionDeps();
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions/generate", { method: "POST" }),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(deps.invalidateMissionListCache).toHaveBeenCalledWith(TEST_USER.id);
  });

  it("invalidates mission caches after generating an AI special mission", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const deps = createMissionDeps();
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions/generate/ai-special", { method: "POST" }),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(deps.invalidateMissionListCache).toHaveBeenCalledWith(TEST_USER.id);
  });

  it("blocks manual completion of weekly and monthly missions", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT * FROM missions WHERE id = ? AND user_id = ? AND is_completed = 0",
        first: {
          id: 42,
          type: "weekly",
          user_id: TEST_USER.id,
          is_completed: 0,
        },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps();
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/missions/complete", {
        method: "POST",
        body: {
          mission_id: 42,
          metric_completed: 0,
          sensor_verified: false,
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      code: "MISSION_AUTO_PROGRESS_ONLY",
    });
    expect(String(payload.error)).toContain("semanais");
    expect(deps.withTransaction).not.toHaveBeenCalled();
  });

  it("blocks manual completion of route-tracking missions before the target is reached", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT * FROM missions WHERE id = ? AND user_id = ? AND is_completed = 0",
        first: {
          id: 88,
          type: "daily",
          user_id: TEST_USER.id,
          is_completed: 0,
          xp_reward: 100,
          points_reward: 10,
          metric_type: "distance_meters",
          metric_value: 1200,
          target_time: null,
          skill_id: null,
          execution_mode: "route_tracking",
        },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      normalizeMissionMetricType: vi.fn(() => "distance_meters"),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/missions/complete", {
        method: "POST",
        body: {
          mission_id: 88,
          metric_completed: 850,
          sensor_verified: true,
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      code: "MISSION_TARGET_NOT_REACHED",
      target: 1200,
      current: 850,
    });
    expect(deps.withTransaction).not.toHaveBeenCalled();
  });

  it("returns the reward events generated during mission completion and derives leveledUp from them", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT * FROM missions WHERE id = ? AND user_id = ? AND is_completed = 0",
        first: {
          id: 77,
          user_id: TEST_USER.id,
          type: "daily",
          is_completed: 0,
          xp_reward: 120,
          points_reward: 12,
          metric_type: "repetitions",
          target_time: null,
          skill_id: null,
        },
      },
      {
        match: "PRAGMA table_info('missions')",
        all: [
          { name: "id" },
          { name: "user_id" },
          { name: "status" },
        ],
      },
      {
        match: "PRAGMA table_info('user_event_counters')",
        all: [
          { name: "user_id" },
          { name: "consecutive_days_completed" },
          { name: "longest_consecutive_days" },
        ],
      },
      {
        match: "UPDATE missions SET is_completed = 1, status = 'completed'",
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: "SELECT * FROM user_progression WHERE user_id = ?",
        first: {
          current_streak: 2,
          last_activity_date: "2099-01-01",
        },
      },
      {
        match: "UPDATE user_progression SET current_streak = ?, best_streak = MAX(best_streak, ?)",
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: "UPDATE user_event_counters",
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: "SELECT COUNT(*) as c FROM missions WHERE user_id = ? AND is_completed = 1",
        first: { c: 1 },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      checkMissionRelevance: vi.fn(async () => ({ isGoalRelevant: false })),
      listRewardNotifications: vi.fn(async () => [
        {
          id: 31,
          type: "level_up",
          level: 6,
          xp_reward: 0,
          points_reward: 0,
          created_at: "2026-03-31T12:00:00.000Z",
        },
        {
          id: 32,
          type: "achievement_unlocked",
          name: "Primeiro Passo",
          xp_reward: 50,
          points_reward: 0,
          created_at: "2026-03-31T12:00:01.000Z",
        },
      ]),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/missions/complete", {
        method: "POST",
        body: {
          mission_id: "77",
          metric_completed: 12,
          reps_completed: 12,
          sensor_verified: true,
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(deps.getRewardNotificationCursor).toHaveBeenCalledWith(db, TEST_USER.id);
    expect(deps.listRewardNotifications).toHaveBeenCalledWith(db, TEST_USER.id, {
      afterId: 0,
      pendingOnly: true,
      limit: 25,
    });
    expect(payload).toMatchObject({
      success: true,
      leveledUp: true,
      reward_events: [
        { id: 31, type: "level_up", level: 6 },
        { id: 32, type: "achievement_unlocked", name: "Primeiro Passo" },
      ],
    });
  });

  it("serves mission details without skill join when skills schema is unavailable", async () => {
    const { db, calls } = createMockD1Database([
      {
        match: "PRAGMA table_info('missions')",
        all: [
          { name: "id" },
          { name: "user_id" },
          { name: "title" },
        ],
      },
      {
        match: "PRAGMA table_info('skills')",
        all: [],
      },
      {
        match: "SELECT m.*, NULL as skill_name",
        first: {
          id: 13,
          user_id: TEST_USER.id,
          title: "Missao legado",
          type: "daily",
        },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      normalizeMissionRow: vi.fn((row: Record<string, unknown>) => ({
        ...row,
        type: "daily",
        circuit_tasks: [],
        exercise_instructions_en: [],
        exercise_instructions_pt: [],
        instructions: [],
      })),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions/13"),
      env,
      executionCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: 13,
      title: "Missao legado",
      type: "daily",
    });
    expect(
      calls.some((call) => call.sql.includes("LEFT JOIN skills")),
    ).toBe(false);
  });

  it("schedules localized instruction persistence for daily mission details even without external AI provider", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT m.*, NULL as skill_name",
        first: {
          id: 21,
          user_id: TEST_USER.id,
          title: "Missao diaria",
          type: "daily",
        },
      },
      {
        match: "UPDATE missions SET exercise_instructions_pt_json = ?, instructions_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        run: { success: true, meta: {} },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      normalizeMissionRow: vi.fn((row: Record<string, unknown>) => ({
        ...row,
        type: "daily",
        metric_type: "repetitions",
        sets: null,
        rest_seconds: null,
        title: "Missao diaria",
        exercise_name: "Push-up",
        exercise_instructions_en: ["Keep your core engaged."],
        exercise_instructions_pt: [],
        instructions: ["Keep your core engaged."],
        circuit_tasks: [],
      })),
      translateExerciseInstructionsToPt: vi.fn(async () => ["Mantenha o core ativado."]),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx, flush } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions/21"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    await flush();
    expect(deps.translateExerciseInstructionsToPt).toHaveBeenCalledTimes(1);
    expect(deps.clearMissionDetailCache).toHaveBeenCalledWith(TEST_USER.id, 21);
  });

  it("recovers the activated profile state and retries mission generation when the mission snapshot is incomplete", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const deps = createMissionDeps({
      generateStructuredMissionPlanForUser: vi
        .fn()
        .mockRejectedValueOnce(new Error("MISSION_GENERATION_PROFILE_INCOMPLETE"))
        .mockResolvedValueOnce({
          already_active: false,
          used_ai: false,
          invalid_ratio: 0,
          missions: [{ id: 91, title: "Missao Diaria: Burpee", type: "daily" }],
        }),
    });
    const app = new Hono<AppContext>();
    registerMissionRoutes(app, deps, createAuthMiddleware());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/missions/generate", {
        method: "POST",
      }),
      env,
      executionCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      generated: true,
      missions: [{ id: 91, title: "Missao Diaria: Burpee", type: "daily" }],
    });
    expect(deps.repairActivatedProfileState).toHaveBeenCalledWith({
      db,
      env,
      user: expect.objectContaining({ id: TEST_USER.id }),
    });
    expect(deps.generateStructuredMissionPlanForUser).toHaveBeenCalledTimes(2);
  });
});
