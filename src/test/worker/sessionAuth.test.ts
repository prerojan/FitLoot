import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createAuthMiddleware } from "../../worker/core/sessionAuth";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import {
  createExecutionContext,
  createTestEnv,
  TEST_USER,
} from "./testUtils";

describe("sessionAuth", () => {
  it("repairs activated accounts on bootstrap before enforcing the plan guard", async () => {
    let repaired = false;
    const { db } = createMockD1Database([
      {
        match:
          "SELECT id, user_id, expires_at FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP",
        first: {
          id: "session-1",
          user_id: TEST_USER.id,
          expires_at: "2099-01-01T00:00:00.000Z",
        },
      },
      {
        match: "SELECT user_id FROM user_profiles WHERE user_id = ? LIMIT 1",
        first: () => (repaired ? { user_id: TEST_USER.id } : null),
      },
      {
        match: "SELECT user_id FROM user_attributes WHERE user_id = ? LIMIT 1",
        first: () => (repaired ? { user_id: TEST_USER.id } : null),
      },
      {
        match: "SELECT user_id FROM user_progression WHERE user_id = ? LIMIT 1",
        first: () => (repaired ? { user_id: TEST_USER.id } : null),
      },
      {
        match: "SELECT user_id FROM user_training_plans WHERE user_id = ? LIMIT 1",
        first: { user_id: TEST_USER.id },
      },
      {
        match: "UPDATE users SET onboarding_completed = 1 WHERE id = ?",
        run: { success: true, meta: { changes: 1 } },
      },
    ]);
    (db as D1Database & { __backend?: string }).__backend = "supabase";

    const env = createTestEnv(db);
    const repairActivatedProfileState = vi.fn(async () => {
      repaired = true;
      return { user_id: TEST_USER.id };
    });
    const getUserAuthRecordById = vi.fn(async () => ({
      ...TEST_USER,
      avatar_url: null,
      onboarding_completed: 0 as const,
      plan_id: "pro" as const,
      plan_status: "active" as const,
      payment_method: "pix" as const,
    }));

    const authMiddleware = createAuthMiddleware({
      cleanupSettledMissionsWithGuard: vi.fn(async () => undefined),
      ensureCaminhadaLeveUserSkill: vi.fn(async () => undefined),
      ensureCatalogReady: vi.fn(async () => undefined),
      getUserAuthRecordById,
      hasPlanAccess: vi.fn(
        (planId: string, planStatus: string) =>
          planId === "vip" || planStatus === "active",
      ),
      refreshMissionExpiryWithGuard: vi.fn(async () => undefined),
      repairActivatedProfileState,
      resolvePlanRedirectPath: vi.fn((onboardingCompleted: number, planStatus: string) =>
        onboardingCompleted === 1 && planStatus === "pending"
          ? "/payment/pending"
          : "/checkout",
      ),
      shouldBypassPlanGuard: vi.fn(
        (path: string) =>
          path === "/api/app/bootstrap" || path === "/api/users/me",
      ),
      tryUnlockSkillsFromPerformance: vi.fn(async () => undefined),
    });

    const app = new Hono<AppContext>();
    app.get("/api/app/bootstrap", authMiddleware, async (c) =>
      c.json({ user: c.get("user") }),
    );
    app.get("/api/protected", authMiddleware, async (c) =>
      c.json({ ok: true, user: c.get("user") }),
    );

    const { executionCtx, flush } = createExecutionContext();
    const cookieHeader = {
      Cookie: "session_id=session-1",
    };

    const bootstrapResponse = await app.fetch(
      new Request("http://localhost/api/app/bootstrap", {
        headers: cookieHeader,
      }),
      env,
      executionCtx,
    );
    const bootstrapPayload = await bootstrapResponse.json();

    expect(bootstrapResponse.status).toBe(200);
    expect(repairActivatedProfileState).toHaveBeenCalledTimes(1);
    expect(bootstrapPayload).toMatchObject({
      user: {
        id: TEST_USER.id,
        onboarding_completed: 1,
        plan_status: "active",
      },
    });

    const protectedResponse = await app.fetch(
      new Request("http://localhost/api/protected", {
        headers: cookieHeader,
      }),
      env,
      executionCtx,
    );
    const protectedPayload = await protectedResponse.json();

    expect(protectedResponse.status).toBe(200);
    expect(protectedPayload).toMatchObject({
      ok: true,
      user: {
        id: TEST_USER.id,
        onboarding_completed: 1,
      },
    });

    await flush();
  });
});
