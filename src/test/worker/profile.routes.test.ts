import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import {
  createAuthMiddleware,
  createExecutionContext,
  createTestEnv,
  TEST_USER,
} from "./testUtils";

vi.mock("../../worker/core/database", () => ({
  hasTableColumn: vi.fn(async (_db: D1Database, table: string, column: string) => {
    if (table !== "user_profiles") return false;
    return column === "age" || column === "gender" || column === "goals_json";
  }),
}));

import { registerProfileRoutes } from "../../worker/routes/profile";

function createProfileDeps(overrides: Record<string, unknown> = {}) {
  return {
    authMiddleware: createAuthMiddleware({
      ...TEST_USER,
      onboarding_completed: 1,
      plan_id: "vip",
      plan_status: "active",
    }),
    buildInitialTrainingPlan: vi.fn(async () => ({ days: [] })),
    createMissionsForPeriod: vi.fn(async () => undefined),
    ensureGoalStatsRow: vi.fn(async () => undefined),
    fetchResponseWithTimeout: vi.fn(async () => new Response(null, { status: 200 })),
    invalidateMissionListCache: vi.fn(() => undefined),
    missionCycleStartIso: vi.fn(() => new Date().toISOString()),
    normalizeConditioning: vi.fn(() => "iniciante"),
    normalizeTrainingFrequencyInput: vi.fn(() => 3),
    onGoalChanged: vi.fn(async () => undefined),
    onProfileCustomization: vi.fn(async () => undefined),
    repairActivatedProfileState: vi.fn(async () => ({
      user_id: TEST_USER.id,
      username: "teste",
      full_name: TEST_USER.name,
      initial_conditioning: "iniciante",
      injuries: "",
      equipment: "",
      main_goal: "saude_geral",
      age: null,
      gender: null,
      goals_json: "[\"saude_geral\"]",
    })),
    unlockAchievementIfNeeded: vi.fn(async () => undefined),
    upsertTrainingPlan: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("profile routes", () => {
  it("rebuilds the missing activated-account state when user onboarding rows are absent", async () => {
    const { db } = createMockD1Database([
      {
        match: "FROM user_profiles up",
        first: null,
      },
    ]);

    const env = createTestEnv(db);
    const deps = createProfileDeps();
    const app = new Hono<AppContext>();
    registerProfileRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/profile"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      user_id: TEST_USER.id,
      full_name: TEST_USER.name,
      main_goal: "saude_geral",
    });
    expect(deps.repairActivatedProfileState).toHaveBeenCalledWith({
      db,
      env,
      user: expect.objectContaining({ id: TEST_USER.id }),
    });
  });
});
