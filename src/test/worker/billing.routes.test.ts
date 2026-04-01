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
    reconcilePendingSubscriptionForUser: vi.fn(async () => undefined),
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

function createCompleteOnboardingStateHandlers() {
  return [
    {
      match: "SELECT user_id FROM user_profiles WHERE user_id = ? LIMIT 1",
      first: { user_id: TEST_USER.id },
    },
    {
      match: "SELECT user_id FROM user_attributes WHERE user_id = ? LIMIT 1",
      first: { user_id: TEST_USER.id },
    },
    {
      match: "SELECT user_id FROM user_progression WHERE user_id = ? LIMIT 1",
      first: { user_id: TEST_USER.id },
    },
    {
      match: "SELECT user_id FROM user_training_plans WHERE user_id = ? LIMIT 1",
      first: { user_id: TEST_USER.id },
    },
  ];
}

describe("billing routes", () => {
  it("starts checkout and returns the refreshed user payload", async () => {
    const { db } = createMockD1Database(createCompleteOnboardingStateHandlers());
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

  it("rejects checkout start when onboarding persistence is incomplete", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT user_id FROM user_profiles WHERE user_id = ? LIMIT 1",
        first: null,
      },
      {
        match: "SELECT user_id FROM user_attributes WHERE user_id = ? LIMIT 1",
        first: { user_id: TEST_USER.id },
      },
      {
        match: "SELECT user_id FROM user_progression WHERE user_id = ? LIMIT 1",
        first: { user_id: TEST_USER.id },
      },
      {
        match: "SELECT user_id FROM user_training_plans WHERE user_id = ? LIMIT 1",
        first: { user_id: TEST_USER.id },
      },
    ]);
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

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      code: "ONBOARDING_STATE_INCOMPLETE",
    });
    expect(deps.startCheckoutForUser).not.toHaveBeenCalled();
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

  it("reconciles pending checkout against Cakto when status polling runs", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const pendingSubscription = {
      id: "sub_pending",
      user_id: TEST_USER.id,
      plan_id: "pro",
      status: "pending",
      payment_method: "pix",
      amount: 1990,
      external_order_id: "cakto_ord_1",
      external_subscription_id: null,
      customer_email: TEST_USER.email,
      checkout_url: "https://checkout.example/pro",
      product_id: "product-pro",
      started_at: null,
      expires_at: null,
      metadata_json: null,
      webhook_event_log: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const activeSubscription = {
      ...pendingSubscription,
      status: "active",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const reconcilePendingSubscriptionForUser = vi.fn(async () => undefined);
    const getLatestSubscriptionByUser = vi
      .fn()
      .mockResolvedValueOnce(pendingSubscription)
      .mockResolvedValueOnce(activeSubscription);
    const getUserAuthRecordById = vi
      .fn()
      .mockResolvedValueOnce({
        ...TEST_USER,
        avatar_url: null,
        onboarding_completed: 1,
        plan_status: "pending",
      })
      .mockResolvedValueOnce({
        ...TEST_USER,
        avatar_url: null,
        onboarding_completed: 1,
        plan_status: "active",
      });
    const deps = createBillingDeps({
      getLatestSubscriptionByUser,
      getUserAuthRecordById,
      hasPlanAccess: vi.fn((planId: string, planStatus: string) => planId === "vip" || planStatus === "active"),
      reconcilePendingSubscriptionForUser,
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
    expect(reconcilePendingSubscriptionForUser).toHaveBeenCalledWith(
      db,
      env,
      expect.objectContaining({
        userId: TEST_USER.id,
        customerEmail: TEST_USER.email,
      }),
    );
    expect(payload).toMatchObject({
      plan_id: "pro",
      plan_status: "active",
      has_access: true,
      checkout_url: "https://checkout.example/pro",
    });
  });
});
