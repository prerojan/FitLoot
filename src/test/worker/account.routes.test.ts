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

const supabaseAvatarMocks = vi.hoisted(() => ({
  extractManagedAvatarPathFromUrl: vi.fn((value: string | null | undefined) => {
    if (typeof value !== "string") return null;
    const marker = "/storage/v1/object/public/fitloot-avatars/";
    const markerIndex = value.indexOf(marker);
    if (markerIndex < 0) return null;
    return value.slice(markerIndex + marker.length);
  }),
  isSupabaseAvatarStorageConfigured: vi.fn(() => true),
  removeStoredAvatar: vi.fn(async () => undefined),
  storeUserAvatar: vi.fn(async () => ({
    path: "users/user-1/avatar-storage-test.jpg",
    publicUrl:
      "https://bjsqqofrneuncnerjoqh.supabase.co/storage/v1/object/public/fitloot-avatars/users/user-1/avatar-storage-test.jpg",
  })),
}));

vi.mock("../../worker/services/userAvatar", () => supabaseAvatarMocks);

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
    invalidateRankingCache: vi.fn(() => undefined),
    logUserEvent: vi.fn(async () => undefined),
    onAppOpen: vi.fn(async () => undefined),
    onProfileCustomization: vi.fn(async () => undefined),
    shouldPurgeUserOnLogout: vi.fn(() => false),
    unlockAchievementIfNeeded: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("account routes", () => {
  it("retries transient bootstrap reads and returns warmed profile data", async () => {
    let profileReads = 0;
    let progressionReads = 0;
    let attributeReads = 0;

    const { db } = createMockD1Database([
      {
        match: (sql) =>
          sql.includes("FROM user_profiles up") &&
          sql.includes("u.avatar_url") &&
          sql.includes("WHERE up.user_id = ?"),
        first: () => {
          profileReads += 1;
          if (profileReads === 1) {
            throw new Error("query read timeout");
          }
          return {
            user_id: TEST_USER.id,
            full_name: "Teste",
            username: "teste",
            custom_primary_color: "#00ff7b",
            avatar_url:
              "https://bjsqqofrneuncnerjoqh.supabase.co/storage/v1/object/public/fitloot-avatars/users/user-1/avatar-bootstrap.jpg",
          };
        },
      },
      {
        match: (sql) =>
          sql.includes("SELECT *") &&
          sql.includes("FROM user_progression") &&
          sql.includes("WHERE user_id = ?"),
        first: () => {
          progressionReads += 1;
          if (progressionReads === 1) {
            throw new Error("connection terminated");
          }
          return {
            user_id: TEST_USER.id,
            xp: 120,
            level: 2,
          };
        },
      },
      {
        match: (sql) =>
          sql.includes("SELECT *") &&
          sql.includes("FROM user_attributes") &&
          sql.includes("WHERE user_id = ?"),
        first: () => {
          attributeReads += 1;
          if (attributeReads === 1) {
            throw new Error("socket hang up");
          }
          return {
            user_id: TEST_USER.id,
            strength: 4,
            constitution: 5,
          };
        },
      },
    ]);

    const env = createTestEnv(db);
    const deps = createAccountDeps();
    const app = new Hono<AppContext>();
    registerAccountRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/app/bootstrap"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      user: expect.objectContaining({ id: TEST_USER.id }),
      profile: expect.objectContaining({
        full_name: "Teste",
        avatar_url:
          "https://bjsqqofrneuncnerjoqh.supabase.co/storage/v1/object/public/fitloot-avatars/users/user-1/avatar-bootstrap.jpg",
      }),
      progression: expect.objectContaining({ level: 2 }),
      attributes: expect.objectContaining({ strength: 4 }),
      app_open_degraded: false,
    });
    expect(profileReads).toBe(2);
    expect(progressionReads).toBe(2);
    expect(attributeReads).toBe(2);
  });

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

  it("stores avatars in Supabase Storage and returns the updated user snapshot", async () => {
    let persistedAvatarUrl: string | null = null;

    const { db, calls } = createMockD1Database([
      {
        match: "SELECT avatar_url FROM users WHERE id = ?",
        first: () => ({ avatar_url: null }),
      },
      {
        match: "UPDATE users SET avatar_url = ? WHERE id = ?",
        run: (params) => {
          persistedAvatarUrl = String(params[0] ?? "");
          return { success: true, meta: { changes: 1 } };
        },
      },
    ]);

    const env = createTestEnv(db);
    const deps = createAccountDeps({
      getUserAuthRecordById: vi.fn(async () => ({
        ...TEST_USER,
        avatar_url: persistedAvatarUrl,
      })),
    });
    const app = new Hono<AppContext>();
    registerAccountRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/users/me/avatar", {
        method: "POST",
        body: {
          image_base64: Buffer.from("avatar-image").toString("base64"),
          image_mime_type: "image/jpeg",
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(supabaseAvatarMocks.storeUserAvatar).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({
      id: TEST_USER.id,
      avatar_url:
        "https://bjsqqofrneuncnerjoqh.supabase.co/storage/v1/object/public/fitloot-avatars/users/user-1/avatar-storage-test.jpg",
    });
    expect(persistedAvatarUrl).toBe(payload.avatar_url);
    expect(deps.invalidateRankingCache).toHaveBeenCalledTimes(1);
    expect(deps.onProfileCustomization).toHaveBeenCalledWith(
      db,
      TEST_USER.id,
      expect.objectContaining({
        photo_changed: true,
        avatar_storage: "supabase",
      }),
    );
    expect(
      calls.some((call) => call.sql.includes("UPDATE users SET avatar_url = ? WHERE id = ?")),
    ).toBe(true);
  });
});
