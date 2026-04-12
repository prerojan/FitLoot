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

  it("prefers the fresher runtime auth snapshot over stale in-memory cache after activation", async () => {
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
    ]);
    (db as D1Database & { __backend?: string }).__backend = "supabase";

    const { db: runtimeDb, calls: runtimeCalls } = createMockD1Database([
      {
        match:
          "CREATE TABLE IF NOT EXISTS runtime_user_auth_cache",
        run: { success: true, meta: {} },
      },
      {
        match: "PRAGMA table_info('runtime_user_auth_cache')",
        all: [{ name: "user_id" }, { name: "email" }, { name: "username" }],
      },
      {
        match:
          "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_updated_at ON runtime_user_auth_cache(updated_at)",
        run: { success: true, meta: {} },
      },
      {
        match:
          "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_email_lower ON runtime_user_auth_cache(lower(email))",
        run: { success: true, meta: {} },
      },
      {
        match:
          "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_username_lower ON runtime_user_auth_cache(lower(username))",
        run: { success: true, meta: {} },
      },
      {
        match: /FROM runtime_user_auth_cache\s+WHERE user_id = \?/i,
        first: {
          user_id: TEST_USER.id,
          email: TEST_USER.email,
          username: "teste",
          name: TEST_USER.name,
          avatar_url: null,
          onboarding_completed: 1,
          plan_id: "vip",
          plan_status: "active",
          payment_method: "card",
          updated_at: new Date().toISOString(),
        },
      },
    ]);

    const env = createTestEnv(db, {
      fitloot_runtime_db: runtimeDb,
    });
    const getUserAuthRecordById = vi.fn(async () => ({
      ...TEST_USER,
      avatar_url: null,
      onboarding_completed: 0 as const,
      plan_id: "basic" as const,
      plan_status: "pending" as const,
      payment_method: "none" as const,
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
      repairActivatedProfileState: vi.fn(async () => null),
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
    expect(bootstrapResponse.status).toBe(200);
    expect(getUserAuthRecordById).toHaveBeenCalledTimes(1);

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
        plan_id: "vip",
        plan_status: "active",
        payment_method: "card",
      },
    });
    expect(getUserAuthRecordById).toHaveBeenCalledTimes(1);
    expect(
      runtimeCalls.some(
        (call) =>
          call.method === "first" &&
          call.sql.includes("FROM runtime_user_auth_cache"),
      ),
    ).toBe(true);

    await flush();
  });

  it("reuses cached session and user auth across bursty requests inside the auth TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"));

    try {
      const { db, calls } = createMockD1Database([
        {
          match:
            "SELECT id, user_id, expires_at FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP",
          first: {
            id: "session-1",
            user_id: TEST_USER.id,
            expires_at: "2099-01-01T00:00:00.000Z",
          },
        },
      ]);
      (db as D1Database & { __backend?: string }).__backend = "supabase";

      const env = createTestEnv(db);
      const getUserAuthRecordById = vi.fn(async () => ({
        ...TEST_USER,
        avatar_url: null,
        onboarding_completed: 1 as const,
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
        repairActivatedProfileState: vi.fn(async () => null),
        resolvePlanRedirectPath: vi.fn(() => "/checkout"),
        shouldBypassPlanGuard: vi.fn(() => false),
        tryUnlockSkillsFromPerformance: vi.fn(async () => undefined),
      });

      const app = new Hono<AppContext>();
      app.get("/api/protected", authMiddleware, async (c) =>
        c.json({ ok: true, user: c.get("user") }),
      );

      const { executionCtx, flush } = createExecutionContext();
      const request = () =>
        app.fetch(
          new Request("http://localhost/api/protected", {
            headers: {
              Cookie: "session_id=session-1",
            },
          }),
          env,
          executionCtx,
        );

      const firstResponse = await request();
      expect(firstResponse.status).toBe(200);

      vi.setSystemTime(new Date("2026-04-12T12:00:20.000Z"));

      const secondResponse = await request();
      expect(secondResponse.status).toBe(200);

      const sessionQueryCalls = calls.filter(
        (call) =>
          call.method === "first" &&
          call.sql.includes("SELECT id, user_id, expires_at FROM sessions"),
      );

      expect(sessionQueryCalls).toHaveLength(1);
      expect(getUserAuthRecordById).toHaveBeenCalledTimes(1);

      await flush();
    } finally {
      vi.useRealTimers();
    }
  });
});
