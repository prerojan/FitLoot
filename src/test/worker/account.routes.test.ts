import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerAccountRoutes } from "../../worker/routes/account";
import type { AppContext, UserAuthRecord } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import {
  createAuthMiddleware,
  createExecutionContext,
  createJsonRequest,
  createTestEnv,
  TEST_USER,
} from "./testUtils";

function createAccountDeps(overrides: Record<string, unknown> = {}) {
  const userRecord: UserAuthRecord = {
    ...TEST_USER,
    avatar_url: null,
  };

  return {
    authMiddleware: createAuthMiddleware(),
    generateExpiredSessionCookie: vi.fn(() => "session_id=; Path=/; HttpOnly"),
    getSessionIdFromCookieHeader: vi.fn(() => null),
    getUserAuthRecordById: vi.fn(async () => userRecord),
    logUserEvent: vi.fn(async () => undefined),
    onAppOpen: vi.fn(async () => undefined),
    onProfileCustomization: vi.fn(async () => undefined),
    shouldPurgeUserOnLogout: vi.fn(() => false),
    unlockAchievementIfNeeded: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("account routes", () => {
  it("keeps profile patch successful when telemetry hook fails", async () => {
    const { db } = createMockD1Database([
      {
        match: "UPDATE users SET name = ? WHERE id = ?",
        run: { success: true, meta: { changes: 1 } },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createAccountDeps({
      onProfileCustomization: vi.fn(async () => {
        throw new Error("hook failed");
      }),
    });
    const app = new Hono<AppContext>();
    registerAccountRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/users/me", {
        method: "PATCH",
        body: { name: "Novo Nome" },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: TEST_USER.id,
      email: TEST_USER.email,
    });
    expect(deps.onProfileCustomization).toHaveBeenCalledWith(
      db,
      TEST_USER.id,
      expect.objectContaining({ name_changed: true, photo_changed: false }),
    );
  });
});
