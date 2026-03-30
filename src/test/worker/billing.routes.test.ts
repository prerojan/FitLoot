import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerBillingRoutes } from "../../worker/routes/billing";
import type { AppContext, PublicPlanId } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import { createAuthMiddleware, createExecutionContext, createJsonRequest, createTestEnv, TEST_USER } from "./testUtils";

function createBillingDeps(overrides: Record<string, unknown> = {}) {
  return {
    authMiddleware: createAuthMiddleware(),
    applyPromoCodeForUser: vi.fn(async () => null),
    getLatestSubscriptionByUser: vi.fn(async () => null),
    getUserAuthRecordById: vi.fn(async () => ({
      ...TEST_USER,
      avatar_url: null,
    })),
    hasPlanAccess: vi.fn(() => true),
    matchesVipActivationCode: vi.fn(() => true),
    normalizePlanStatus: vi.fn((value: string | null | undefined) => value ?? "pending"),
    normalizePromoCodeValue: vi.fn((value: string | null | undefined) => String(value ?? "")),
    normalizePublicPlanIdFromValue: vi.fn((value: string | null | undefined) => {
      if (value === "basic" || value === "pro" || value === "annual") {
        return value as PublicPlanId;
      }
      return null;
    }),
    normalizeUserPaymentMethod: vi.fn((value: string | null | undefined) => value ?? "none"),
    processCaktoWebhook: vi.fn(async () => undefined),
    resolveCheckoutAmount: vi.fn(() => 1990),
    resolveCheckoutProductId: vi.fn(() => "product-pro"),
    resolveCheckoutUrl: vi.fn(() => "https://checkout.example/pro"),
    startCheckoutForUser: vi.fn(async () => ({
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
    validatePromoCodeRecord: vi.fn(async () => null),
    withTransaction: vi.fn(async (_db: D1Database, action: () => Promise<unknown>) => await action()),
    ...overrides,
  };
}

describe("billing routes", () => {
  it("starts checkout and returns the refreshed user payload", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const deps = createBillingDeps();
    const app = new Hono<AppContext>();
    registerBillingRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/checkout/start", {
        method: "POST",
        body: {
          plan_id: "pro",
          payment_method: "pix",
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      checkout_status: "pending",
      subscription_id: "sub_123",
      user: {
        id: TEST_USER.id,
        plan_id: TEST_USER.plan_id,
      },
    });
    expect(deps.startCheckoutForUser).toHaveBeenCalledWith(
      db,
      env,
      expect.objectContaining({
        userId: TEST_USER.id,
        planId: "pro",
        paymentMethod: "pix",
      }),
    );
  });

  it("falls back to the user plan data when there is no stored subscription", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const deps = createBillingDeps({
      getLatestSubscriptionByUser: vi.fn(async () => null),
      getUserAuthRecordById: vi.fn(async () => ({
        ...TEST_USER,
        avatar_url: null,
        onboarding_completed: 1,
        plan_id: "pro",
        plan_status: "active",
        payment_method: "pix",
      })),
      resolveCheckoutAmount: vi.fn((planId: PublicPlanId) => (planId === "pro" ? 2490 : 0)),
      resolveCheckoutUrl: vi.fn((planId: PublicPlanId) => `https://checkout.example/${planId}`),
      resolveCheckoutProductId: vi.fn((planId: PublicPlanId) => `product-${planId}`),
    });
    const app = new Hono<AppContext>();
    registerBillingRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/subscription/status"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      plan_id: "pro",
      plan_status: "active",
      payment_method: "pix",
      has_access: true,
      amount: 2490,
      checkout_url: "https://checkout.example/pro",
      product_id: "product-pro",
      subscription: null,
    });
  });
});
