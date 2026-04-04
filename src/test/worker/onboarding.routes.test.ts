import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppContext, CheckoutStartResult, Env } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import {
  createAuthMiddleware,
  createExecutionContext,
  createJsonRequest,
  createTestEnv,
  TEST_USER,
} from "./testUtils";

vi.mock("../../worker/core/database", () => ({
  hasTableColumn: vi.fn(async () => false),
}));

import { registerOnboardingRoutes } from "../../worker/routes/onboarding";

function createOnboardingDeps(overrides: Record<string, unknown> = {}) {
  return {
    authMiddleware: createAuthMiddleware({
      ...TEST_USER,
      onboarding_completed: 0,
      plan_id: "basic",
      plan_status: "cancelled",
      payment_method: "none",
    }),
    buildInitialTrainingPlan: vi.fn(async () => ({ days: [] })),
    conditioningOrder: vi.fn(() => 1),
    ensureGamificationCatalog: vi.fn(async () => undefined),
    ensureGoalStatsRow: vi.fn(async () => undefined),
    ensurePeriodicMissions: vi.fn(async () => undefined),
    ensureUserCounterRow: vi.fn(async () => undefined),
    evaluateLevelTitles: vi.fn(async () => undefined),
    invalidateMissionListCache: vi.fn(() => undefined),
    logUserEvent: vi.fn(async () => undefined),
    normalizeTrainingFrequencyInput: vi.fn((value: unknown) => Number(value ?? 3)),
    startCheckoutForUser: vi.fn(async (): Promise<CheckoutStartResult> => ({
      checkout_status: "pending",
      plan_id: "pro",
      plan_status: "pending",
      payment_method: "pix",
      amount: 1990,
      checkout_url: "https://checkout.example/pro",
      product_id: "product-pro",
      subscription_id: "sub_123",
      message: "Checkout iniciado",
    })),
    skillTierOrder: vi.fn(() => 1),
    upsertTrainingPlan: vi.fn(async () => undefined),
    withTransaction: vi.fn(async (_db: D1Database, action: () => Promise<unknown>) => await action()),
    ...overrides,
  };
}

describe("onboarding routes", () => {
  it("persists onboarding profile state without starting checkout on /api/onboarding/profile", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT user_id FROM user_profiles WHERE lower(username) = ? LIMIT 1",
        first: null,
      },
      {
        match: "INSERT INTO user_profiles",
        run: { success: true, meta: {} },
      },
      {
        match: "INSERT INTO user_attributes",
        run: { success: true, meta: {} },
      },
      {
        match: "INSERT OR IGNORE INTO user_progression",
        run: { success: true, meta: {} },
      },
      {
        match: "SELECT id, tier, level_required FROM skills",
        all: {
          results: [
            { id: 1, tier: "iniciante", level_required: 1 },
            { id: 2, tier: "avancado", level_required: 2 },
          ],
        },
      },
      {
        match: "INSERT INTO user_skills",
        run: { success: true, meta: {} },
      },
    ]);
    const env = createTestEnv(db) as Env;
    const deps = createOnboardingDeps();
    const app = new Hono<AppContext>();
    registerOnboardingRoutes(app, deps);
    const { executionCtx, flush } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/onboarding/profile", {
        method: "POST",
        body: {
          username: "testeuser",
          full_name: "Teste User",
          weight: 72,
          height: 176,
          age: 29,
          gender: "homem",
          initial_conditioning: "iniciante",
          initial_pushups: 12,
          initial_situps: 15,
          initial_squats: 20,
          injuries: "",
          equipment: "halteres",
          main_goal: "ganhar_massa",
          goals: ["ganhar_massa"],
          training_frequency: 4,
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();
    await flush();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      onboarding_ready: true,
    });
    expect(deps.buildInitialTrainingPlan).toHaveBeenCalled();
    expect(deps.upsertTrainingPlan).toHaveBeenCalled();
    expect(deps.startCheckoutForUser).not.toHaveBeenCalled();
    expect(deps.ensurePeriodicMissions).toHaveBeenCalledWith(env, db, TEST_USER.id);
    expect(deps.invalidateMissionListCache).toHaveBeenCalledWith(TEST_USER.id);
  });
});
