import type { MiddlewareHandler } from "hono";
import { vi } from "vitest";
import type { AppContext, AuthUser, Env } from "../../worker/core/types";

export const TEST_USER: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Teste",
  onboarding_completed: 1,
  plan_id: "pro",
  plan_status: "active",
  payment_method: "pix",
};

export function createAuthMiddleware(user: AuthUser = TEST_USER): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    c.set("user", user);
    await next();
  };
}

export function createExecutionContext() {
  const pending: Promise<unknown>[] = [];

  const executionCtx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(Promise.resolve(promise));
    },
    passThroughOnException() {
      return undefined;
    },
  } as ExecutionContext;

  return {
    executionCtx,
    async flush() {
      await Promise.allSettled(pending);
    },
  };
}

export function createTestEnv(
  fitlootDb: D1Database,
  overrides: Partial<Env> = {},
): Env {
  return {
    fitloot_db: fitlootDb,
    ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
    USDA_API_KEY: "usda-test-key",
    RAPID_API_KEY: "rapidapi-test-key",
    RAPID_API_HOST: "nutrition-by-api-ninjas.p.rapidapi.com",
    FRONTEND_ORIGIN: "https://fitloot.vercel.app",
    ...overrides,
  };
}

export function createJsonRequest(path: string, init?: RequestInit & { body?: unknown }) {
  const body = typeof init?.body === "undefined" ? undefined : JSON.stringify(init.body);

  return new Request(`http://localhost${path}`, {
    ...init,
    body,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}
