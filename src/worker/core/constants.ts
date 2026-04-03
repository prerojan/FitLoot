import type { CaktoPlanCatalog } from "../services/cakto";
import type { PublicPlanId } from "./types";

export const CHECKOUT_PLAN_CATALOG: Record<
  PublicPlanId,
  {
    name: "basic" | "premium" | "elite";
    amount: number;
    checkout_url: string;
    product_id: string;
  }
> = {
  basic: {
    name: "basic",
    amount: 4900,
    checkout_url: "https://pay.cakto.com.br/gwr6dcu",
    product_id: "800215",
  },
  pro: {
    name: "premium",
    amount: 9900,
    checkout_url: "https://pay.cakto.com.br/m955o3f",
    product_id: "800252",
  },
  annual: {
    name: "elite",
    amount: 14900,
    checkout_url: "https://pay.cakto.com.br/k9c5935",
    product_id: "800255",
  },
};

export const CAKTO_PLAN_CATALOG: CaktoPlanCatalog = {
  basic: {
    productId: CHECKOUT_PLAN_CATALOG.basic.product_id,
    checkoutUrl: CHECKOUT_PLAN_CATALOG.basic.checkout_url,
  },
  pro: {
    productId: CHECKOUT_PLAN_CATALOG.pro.product_id,
    checkoutUrl: CHECKOUT_PLAN_CATALOG.pro.checkout_url,
  },
  annual: {
    productId: CHECKOUT_PLAN_CATALOG.annual.product_id,
    checkoutUrl: CHECKOUT_PLAN_CATALOG.annual.checkout_url,
  },
};

export const USER_PURGE_TARGETS: ReadonlyArray<{ table: string; columns: ReadonlyArray<string> }> = [
  { table: "sessions", columns: ["user_id"] },
  { table: "subscriptions", columns: ["user_id"] },
  { table: "cakto_webhook_events", columns: ["identified_user_id"] },
  { table: "user_profiles", columns: ["user_id"] },
  { table: "user_attributes", columns: ["user_id"] },
  { table: "user_progression", columns: ["user_id"] },
  { table: "user_skills", columns: ["user_id"] },
  { table: "missions", columns: ["user_id"] },
  { table: "user_achievements", columns: ["user_id"] },
  { table: "user_titles", columns: ["user_id"] },
  { table: "friendships", columns: ["user_id", "friend_user_id", "friend_id"] },
  { table: "friend_requests", columns: ["from_user_id", "to_user_id"] },
  { table: "coupon_orders", columns: ["user_id"] },
  { table: "food_diary", columns: ["user_id"] },
  { table: "daily_metrics", columns: ["user_id"] },
  { table: "mini_games", columns: ["challenger_user_id", "challenged_user_id", "winner_user_id"] },
  { table: "user_training_plans", columns: ["user_id"] },
  { table: "user_event_counters", columns: ["user_id"] },
  { table: "user_event_log", columns: ["user_id"] },
  { table: "user_goal_stats", columns: ["user_id"] },
  { table: "user_monthly_counters", columns: ["user_id"] },
  { table: "users", columns: ["id"] },
];

export const INCOMPLETE_ONBOARDING_PURGE_TARGETS = USER_PURGE_TARGETS.filter(
  (target) =>
    target.table !== "sessions" &&
    target.table !== "subscriptions" &&
    target.table !== "cakto_webhook_events" &&
    target.table !== "users",
);

export const PLAN_GUARD_EXEMPT_PATHS = new Set<string>([
  "/api/users/me",
  "/api/app/bootstrap",
  "/api/app/open",
  "/api/presence/heartbeat",
  "/api/presence/offline",
  "/api/events/route-not-found",
  "/api/onboarding",
  "/api/onboarding/profile",
  "/api/checkout/start",
  "/api/promo/apply",
  "/api/subscription/status",
]);

export const WEBHOOK_SUPPORTED_EVENTS = new Set<string>([
  "purchase_approved",
  "purchase_refused",
  "subscription_created",
  "subscription_renewed",
  "subscription_canceled",
  "checkout_abandonment",
]);

export const DEFAULT_HUGGING_FACE_CHAT_MODEL = "openai/gpt-oss-120b";
export const HUGGING_FACE_CHAT_MODEL = DEFAULT_HUGGING_FACE_CHAT_MODEL;
export const DEFAULT_HUGGING_FACE_VISION_MODEL = "Qwen/Qwen3.5-9B:together";
export const DEFAULT_ANTHROPIC_CHAT_MODEL = "claude-sonnet-4-20250514";
