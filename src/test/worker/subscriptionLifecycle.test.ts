import type { Context } from "hono";
import { describe, expect, it } from "vitest";

import { processCaktoWebhook } from "../../worker/services/subscriptionLifecycle";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import { createTestEnv } from "./testUtils";

describe("subscription lifecycle", () => {
  it("syncs the runtime auth cache after a webhook activates the user's plan", async () => {
    let userActivated = false;
    let storedSubscription:
      | {
          id: string;
          user_id: string;
          plan_id: string;
          status: string;
          payment_method: string;
          amount: number;
          external_order_id: string;
          external_subscription_id: string | null;
          customer_email: string;
          checkout_url: string;
          product_id: string | null;
          started_at: string | null;
          expires_at: string | null;
          metadata_json: string | null;
          webhook_event_log: string | null;
          created_at: string;
          updated_at: string;
        }
      | null = null;

    const { db } = createMockD1Database([
      {
        match: "SELECT id FROM cakto_webhook_events WHERE id = ? LIMIT 1",
        first: null,
      },
      {
        match: "INSERT INTO cakto_webhook_events",
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: "UPDATE cakto_webhook_events",
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: "COALESCE(onboarding_completed, 0) as onboarding_completed",
        first: () => ({
          id: "user-1",
          email: "felps@gmail.com",
          name: "Felipe Braganttine",
          avatar_url: null,
          onboarding_completed: userActivated ? 1 : 0,
          plan_id: userActivated ? "pro" : "basic",
          plan_status: userActivated ? "active" : "pending",
          payment_method: userActivated ? "pix" : "none",
        }),
      },
      {
        match: "SELECT\n  id,\n  user_id,\n  plan_id,\n  status,\n  payment_method,\n  amount,\n  external_order_id",
        first: (params, sql) => {
          if (sql.includes("WHERE external_order_id = ?")) {
            return storedSubscription;
          }
          if (sql.includes("WHERE id = ?")) {
            return storedSubscription;
          }
          if (sql.includes("WHERE user_id = ? ORDER BY datetime(updated_at) DESC LIMIT 1")) {
            return {
              id: "checkout-1",
              user_id: "user-1",
              plan_id: "pro",
              status: "pending",
              payment_method: "pix",
              amount: 1990,
              external_order_id: "ord_1",
              external_subscription_id: null,
              customer_email: "felps@gmail.com",
              checkout_url:
                "https://checkout.example/pro?fitloot_checkout_id=checkout-1&fitloot_user_id=user-1&fitloot_plan_id=pro",
              product_id: "product-pro",
              started_at: null,
              expires_at: null,
              metadata_json: null,
              webhook_event_log: null,
              created_at: "2026-04-11T04:42:00.000Z",
              updated_at: "2026-04-11T04:42:00.000Z",
            };
          }
          return null;
        },
      },
      {
        match: "INSERT INTO subscriptions",
        run: (params) => {
          storedSubscription = {
            id: String(params[0]),
            user_id: String(params[1]),
            plan_id: String(params[2]),
            status: String(params[3]),
            payment_method: String(params[4]),
            amount: Number(params[5]),
            external_order_id: String(params[6]),
            external_subscription_id:
              typeof params[7] === "string" ? params[7] : null,
            customer_email: String(params[8]),
            checkout_url: String(params[9]),
            product_id: typeof params[10] === "string" ? params[10] : null,
            started_at: typeof params[11] === "string" ? params[11] : null,
            expires_at: typeof params[12] === "string" ? params[12] : null,
            metadata_json: typeof params[13] === "string" ? params[13] : null,
            webhook_event_log:
              typeof params[14] === "string" ? params[14] : null,
            created_at: "2026-04-11T04:45:00.000Z",
            updated_at: "2026-04-11T04:45:00.000Z",
          };
          return { success: true, meta: { changes: 1 } };
        },
      },
      {
        match: "UPDATE users SET plan_id = ?, plan_status = ?, payment_method = ?, onboarding_completed = 1 WHERE id = ?",
        run: () => {
          userActivated = true;
          return { success: true, meta: { changes: 1 } };
        },
      },
      {
        match: "SELECT username FROM user_profiles WHERE user_id = ? LIMIT 1",
        first: { username: "felps" },
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
        match: "INSERT INTO runtime_user_auth_cache",
        run: { success: true, meta: { changes: 1 } },
      },
    ]);

    const env = createTestEnv(db, { fitloot_runtime_db: runtimeDb });
    const c = { env } as unknown as Context<AppContext>;
    const payload = {
      event: "purchase_approved",
      event_id: "evt_1",
      data: {
        id: "ord_1",
        checkout_url:
          "https://checkout.example/pro?fitloot_checkout_id=checkout-1&fitloot_user_id=user-1&fitloot_plan_id=pro",
        customer_email: "felps@gmail.com",
        customer_name: "Felipe Braganttine",
        payment_method: "pix",
        plan_id: "pro",
        amount: 1990,
        status: "approved",
      },
    } satisfies Record<string, unknown>;

    await processCaktoWebhook(c, JSON.stringify(payload), payload);

    const runtimeUpsertCall = runtimeCalls.find((call) =>
      call.sql.includes("INSERT INTO runtime_user_auth_cache"),
    );

    expect(runtimeUpsertCall?.params).toEqual([
      "user-1",
      "felps@gmail.com",
      "felps",
      "Felipe Braganttine",
      null,
      1,
      "pro",
      "active",
      "pix",
    ]);
  });
});
