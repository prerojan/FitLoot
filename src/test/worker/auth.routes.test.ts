import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerAuthRoutes } from "../../worker/routes/auth";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import { createExecutionContext, createJsonRequest, createTestEnv } from "./testUtils";

function createAuthDeps() {
  return {
    generateCookie: vi.fn(() => "session=cookie"),
    hashPassword: vi.fn(async () => "hash-value"),
  };
}

function createUsersPragmaColumns() {
  return {
    results: [
      { name: "id" },
      { name: "email" },
      { name: "name" },
      { name: "avatar_url" },
      { name: "password_hash" },
      { name: "password_salt" },
      { name: "onboarding_completed" },
      { name: "plan_id" },
      { name: "plan_status" },
      { name: "payment_method" },
    ],
  };
}

function createUserRow(options: {
  onboardingCompleted: number;
  planId: string;
  planStatus: string;
  paymentMethod: string;
}) {
  return {
    id: "old-user",
    email: "legacy@example.com",
    name: "Legacy",
    avatar_url: null,
    onboarding_completed: options.onboardingCompleted,
    plan_id: options.planId,
    plan_status: options.planStatus,
    payment_method: options.paymentMethod,
  };
}

describe("auth routes", () => {
  it("reuses email from incomplete account and registers a fresh user", async () => {
    let insertAttempts = 0;
    const { db, calls } = createMockD1Database([
      {
        match: "SELECT COUNT(*) as count FROM sqlite_master",
        first: { count: 2 },
      },
      {
        match: "INSERT INTO users (id, email, name, password_hash, password_salt)",
        run: () => {
          insertAttempts += 1;
          if (insertAttempts === 1) {
            throw new Error("duplicate key value violates unique constraint users_email_key");
          }
          return { success: true, meta: { changes: 1 } };
        },
      },
      {
        match: "SELECT id FROM users WHERE lower(email) = ?",
        first: { id: "old-user" },
      },
      {
        match: "COALESCE(onboarding_completed, 0)",
        first: createUserRow({
          onboardingCompleted: 0,
          planId: "basic",
          planStatus: "failed",
          paymentMethod: "none",
        }),
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('users')"),
        all: createUsersPragmaColumns(),
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('"),
        all: { results: [] },
      },
      {
        match: "DELETE FROM users WHERE id = ?",
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: "UPDATE users SET",
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
        run: { success: true, meta: { changes: 1 } },
      },
    ]);

    const env = createTestEnv(db);
    const deps = createAuthDeps();
    const app = new Hono<AppContext>();
    registerAuthRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/auth/register", {
        method: "POST",
        body: {
          name: "Novo Usuario",
          email: "Legacy@Example.com",
          password: "senha-segura-123",
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();
    const insertCall = calls.find((call) =>
      call.sql.includes("INSERT INTO users (id, email, name, password_hash, password_salt)"),
    );

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({ success: true });
    expect(calls.some((call) => call.sql.includes("DELETE FROM users WHERE id = ?"))).toBe(true);
    expect(insertCall?.params[1]).toBe("legacy@example.com");
  });

  it("keeps blocking email already tied to active account", async () => {
    let insertAttempts = 0;
    const { db, calls } = createMockD1Database([
      {
        match: "SELECT COUNT(*) as count FROM sqlite_master",
        first: { count: 2 },
      },
      {
        match: "INSERT INTO users (id, email, name, password_hash, password_salt)",
        run: () => {
          insertAttempts += 1;
          if (insertAttempts === 1) {
            throw new Error("duplicate key value violates unique constraint users_email_key");
          }
          return { success: true, meta: { changes: 1 } };
        },
      },
      {
        match: "SELECT id FROM users WHERE lower(email) = ?",
        first: { id: "old-user" },
      },
      {
        match: "COALESCE(onboarding_completed, 0)",
        first: createUserRow({
          onboardingCompleted: 1,
          planId: "pro",
          planStatus: "active",
          paymentMethod: "card",
        }),
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('users')"),
        all: createUsersPragmaColumns(),
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('"),
        all: { results: [] },
      },
    ]);

    const env = createTestEnv(db);
    const deps = createAuthDeps();
    const app = new Hono<AppContext>();
    registerAuthRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/auth/register", {
        method: "POST",
        body: {
          name: "Teste",
          email: "legacy@example.com",
          password: "senha-segura-123",
        },
      }),
      env,
      executionCtx,
    );

    expect(response.status).toBe(409);
    expect(
      calls.filter((call) =>
        call.sql.includes("INSERT INTO users (id, email, name, password_hash, password_salt)") &&
        call.method === "run",
      ).length,
    ).toBe(1);
  });

  it("reports reclaimable email as available in check-availability", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT\n            (SELECT id FROM users WHERE lower(email) = ? LIMIT 1) AS email_user_id",
        first: { email_user_id: "old-user", username_user_id: null },
      },
      {
        match: "COALESCE(onboarding_completed, 0)",
        first: createUserRow({
          onboardingCompleted: 0,
          planId: "basic",
          planStatus: "failed",
          paymentMethod: "none",
        }),
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('users')"),
        all: createUsersPragmaColumns(),
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('"),
        all: { results: [] },
      },
    ]);

    const env = createTestEnv(db);
    const deps = createAuthDeps();
    const app = new Hono<AppContext>();
    registerAuthRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/auth/check-availability?email=legacy%40example.com"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      emailAvailable: true,
      usernameAvailable: null,
    });
  });

  it("serves runtime auth availability directly without primary backfill scans", async () => {
    let primaryAvailabilityReads = 0;
    const runtimeRows = [
      {
        user_id: "active-user",
        email: "runner@example.com",
        username: "runnerone",
        name: "Runner One",
        avatar_url: null,
        onboarding_completed: 1,
        plan_id: "pro",
        plan_status: "active",
        payment_method: "pix",
        updated_at: "2026-04-04T00:00:00.000Z",
      },
    ];

    const { db, calls } = createMockD1Database([
      {
        match: "SELECT\n            (SELECT id FROM users WHERE lower(email) = ? LIMIT 1) AS email_user_id",
        first: () => {
          primaryAvailabilityReads += 1;
          return { email_user_id: null, username_user_id: null };
        },
      },
      {
        match: "COALESCE(onboarding_completed, 0)",
        first: createUserRow({
          onboardingCompleted: 1,
          planId: "pro",
          planStatus: "active",
          paymentMethod: "pix",
        }),
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('users')"),
        all: createUsersPragmaColumns(),
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('"),
        all: { results: [] },
      },
    ]);

    const { db: runtimeDb, calls: runtimeCalls } = createMockD1Database([
      {
        match: "CREATE TABLE IF NOT EXISTS runtime_user_auth_cache",
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: "PRAGMA table_info('runtime_user_auth_cache')",
        all: {
          results: [
            { name: "user_id" },
            { name: "email" },
            { name: "username" },
            { name: "name" },
            { name: "avatar_url" },
            { name: "onboarding_completed" },
            { name: "plan_id" },
            { name: "plan_status" },
            { name: "payment_method" },
            { name: "updated_at" },
          ],
        },
      },
      {
        match: "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_updated_at",
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_email_lower",
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_username_lower",
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: (sql) =>
          sql.includes("FROM runtime_user_auth_cache") &&
          sql.includes("lower(username) = ?"),
        all: () => ({ results: [...runtimeRows] }),
      },
    ]);

    const env = createTestEnv(db, { fitloot_runtime_db: runtimeDb });
    const deps = createAuthDeps();
    const app = new Hono<AppContext>();
    registerAuthRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/auth/check-availability?username=runnerone",
      ),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      emailAvailable: null,
      usernameAvailable: false,
    });
    expect(primaryAvailabilityReads).toBe(0);
    expect(calls.some((call) => call.method === "first" && call.sql.includes("SELECT\n            (SELECT id FROM users WHERE lower(email) = ? LIMIT 1) AS email_user_id"))).toBe(false);
    expect(runtimeCalls.some((call) => call.sql.includes("FROM runtime_user_auth_cache"))).toBe(
      true,
    );
  });

  it("falls back to the primary database when runtime auth cache misses", async () => {
    const { db, calls } = createMockD1Database([
      {
        match: "SELECT\n            (SELECT id FROM users WHERE lower(email) = ? LIMIT 1) AS email_user_id",
        first: { email_user_id: null, username_user_id: "runner-user" },
      },
      {
        match: "COALESCE(onboarding_completed, 0)",
        first: createUserRow({
          onboardingCompleted: 1,
          planId: "pro",
          planStatus: "active",
          paymentMethod: "pix",
        }),
      },
      {
        match: "SELECT username FROM user_profiles WHERE user_id = ? LIMIT 1",
        first: { username: "runnerone" },
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('users')"),
        all: createUsersPragmaColumns(),
      },
      {
        match: (sql) => sql.includes("PRAGMA table_info('"),
        all: { results: [] },
      },
    ]);

    const { db: runtimeDb, calls: runtimeCalls } = createMockD1Database([
      {
        match: "CREATE TABLE IF NOT EXISTS runtime_user_auth_cache",
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: "PRAGMA table_info('runtime_user_auth_cache')",
        all: {
          results: [
            { name: "user_id" },
            { name: "email" },
            { name: "username" },
            { name: "name" },
            { name: "avatar_url" },
            { name: "onboarding_completed" },
            { name: "plan_id" },
            { name: "plan_status" },
            { name: "payment_method" },
            { name: "updated_at" },
          ],
        },
      },
      {
        match: "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_updated_at",
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_email_lower",
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: "CREATE INDEX IF NOT EXISTS idx_runtime_user_auth_username_lower",
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: (sql) =>
          sql.includes("FROM runtime_user_auth_cache") &&
          sql.includes("lower(username) = ?"),
        all: { results: [] },
      },
      {
        match: "INSERT INTO runtime_user_auth_cache",
        run: { success: true, meta: { changes: 1 } },
      },
    ]);

    const env = createTestEnv(db, { fitloot_runtime_db: runtimeDb });
    const deps = createAuthDeps();
    const app = new Hono<AppContext>();
    registerAuthRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request(
        "http://localhost/api/auth/check-availability?username=runnerone",
      ),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      emailAvailable: null,
      usernameAvailable: false,
    });
    expect(
      calls.some((call) =>
        call.sql.includes("SELECT\n            (SELECT id FROM users WHERE lower(email) = ? LIMIT 1) AS email_user_id"),
      ),
    ).toBe(true);
    expect(
      runtimeCalls.some((call) => call.sql.includes("INSERT INTO runtime_user_auth_cache")),
    ).toBe(true);
  });

  it("accepts login with mixed-case email and trims spaces", async () => {
    const { db, calls } = createMockD1Database([
      {
        match: "SELECT COUNT(*) as count FROM sqlite_master",
        first: { count: 2 },
      },
      {
        match: "SELECT id, password_hash, password_salt FROM users WHERE lower(email) = ?",
        first: {
          id: "user-123",
          password_hash: "hash-value",
          password_salt: "salt-1",
        },
      },
      {
        match: "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
        run: { success: true, meta: { changes: 1 } },
      },
    ]);

    const env = createTestEnv(db);
    const deps = createAuthDeps();
    const app = new Hono<AppContext>();
    registerAuthRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/auth/login", {
        method: "POST",
        body: {
          email: "  LeGaCy@Example.com  ",
          password: "senha-segura-123",
        },
      }),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(
      calls.some(
        (call) =>
          call.sql.includes("SELECT id, password_hash, password_salt FROM users WHERE lower(email) = ?") &&
          call.params[0] === "legacy@example.com",
      ),
    ).toBe(true);
    expect(response.headers.get("Set-Cookie")).toBe("session=cookie");
  });
});
