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
    clearMissionListCache: vi.fn(() => undefined),
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
    getMonthlyCounters: vi.fn(async () => ({})),
    hydrateMissionRowsWithSubtasks: vi.fn(async (_db: D1Database, rows: Record<string, unknown>[]) => rows),
    invalidateMissionListCache: vi.fn(() => undefined),
    invalidateRankingCache: vi.fn(() => undefined),
    logUserEvent: vi.fn(async () => undefined),
    missionSummaryFromNormalized: vi.fn((mission: Record<string, unknown>) => mission),
    monthlyMissionProgressValue: vi.fn(() => 0),
    normalizeInstructionList: vi.fn((value: unknown) => Array.isArray(value) ? value : []),
    normalizeMatchText: vi.fn((value: string) => value.trim().toLowerCase()),
    normalizeMissionMetricType: vi.fn(() => "repetitions"),
    normalizeMissionRow: vi.fn((row: Record<string, unknown>) => row),
    onGoalProgress: vi.fn(async () => undefined),
    onMissionComplete: vi.fn(async () => undefined),
    onStreakContinued: vi.fn(async () => undefined),
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
    totalSkillTableAttributeGain: vi.fn(() => 0),
    translateExerciseInstructionsToPt: vi.fn(async (steps: string[]) => steps),
    tryUnlockSkillsFromPerformance: vi.fn(async () => undefined),
    unlockAchievementIfNeeded: vi.fn(async () => undefined),
    updateCircuitProgress: vi.fn(async () => undefined),
    updateMissionSubtaskProgress: vi.fn(async () => undefined),
    updateMonthlyMissionProgress: vi.fn(async () => undefined),
    withTransaction: vi.fn(async (_db: D1Database, action: () => Promise<unknown>) => await action()),
    writeMissionListCache: vi.fn(() => undefined),
    ...overrides,
  } satisfies Parameters<typeof registerMissionRoutes>[1];
}

describe("mission routes", () => {
  it("serves the cached mission list without hitting the database query path", async () => {
    const cachedMissions = [
      {
        id: 11,
        title: "Missao em cache",
        type: "daily",
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
    expect(deps.schedulePeriodicMissionsRefreshWithGuard).toHaveBeenCalledTimes(1);
    expect(deps.scheduleLegacyDailyMetadataRepairWithGuard).toHaveBeenCalledTimes(1);
    expect(deps.schedulePeriodicProgressRecomputeWithGuard).toHaveBeenCalledTimes(1);
    expect(deps.streamJsonArrayResponse).toHaveBeenCalledWith(cachedMissions);
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
});
