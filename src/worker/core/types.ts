import type { PromoCodeEffect } from "../../shared/types";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | undefined;
  onboarding_completed: number;
  plan_id: PlanId;
  plan_status: PlanStatus;
  payment_method: UserPaymentMethod;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    user: AuthUser;
  };
};

export type PublicPlanId = "basic" | "pro" | "annual";
export type PlanId = PublicPlanId | "vip";
export type PlanStatus = "pending" | "active" | "cancelled" | "failed" | "expired";
export type CheckoutPaymentMethod = "card" | "pix";
export type UserPaymentMethod = CheckoutPaymentMethod | "none";

export type PhysicalBenchmarkRow = {
  id: number;
  user_id: string;
  pushups_max: number | null;
  squats_max: number | null;
  situps_max: number | null;
  plank_seconds: number | null;
  pullups_max: number | null;
  run_distance_km: number | null;
  run_time_seconds: number | null;
  notes: string | null;
  test_date: string;
  created_at: string;
  updated_at: string;
};

export type PhysicalBenchmarkDelta = {
  pushups_delta: number;
  squats_delta: number;
  situps_delta: number;
  plank_delta: number;
  pullups_delta: number;
  run_distance_delta: number;
  run_time_delta: number;
};

export type PhysicalBenchmarkWithDelta = PhysicalBenchmarkRow & {
  delta: PhysicalBenchmarkDelta | null;
};

export type UserAuthRecord = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  onboarding_completed: number;
  plan_id: PlanId;
  plan_status: PlanStatus;
  payment_method: UserPaymentMethod;
};

export type SubscriptionRecord = {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  payment_method: string;
  amount: number;
  external_order_id: string | null;
  external_subscription_id: string | null;
  customer_email: string | null;
  checkout_url: string | null;
  product_id: string | null;
  started_at: string | null;
  expires_at: string | null;
  metadata_json: string | null;
  webhook_event_log: string | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionEventLogEntry = {
  type: string;
  received_at: string;
  source: "checkout" | "webhook";
  status: PlanStatus;
};

export type SubscriptionMetadata = {
  customer_name?: string | undefined;
  external_status?: string | undefined;
  failure_reason?: string | undefined;
  last_event_id?: string | undefined;
  last_event_type?: string | undefined;
  checkout_tracking_id?: string | undefined;
  checkout_tracking_user_id?: string | undefined;
  checkout_tracking_plan_id?: PublicPlanId | undefined;
  promo_code?: string | undefined;
  promo_description?: string | undefined;
  promo_effect?: PromoCodeEffect | undefined;
  promo_effect_value?: string | undefined;
};

export type PromoCodeRecord = {
  id: number;
  code: string;
  description: string;
  effect: string;
  effect_value: string | null;
  max_uses: number | null;
  uses_count: number;
  active: number;
  expires_at: string | null;
  created_at: string;
};

export type PromoCodeUsageRecord = {
  id: number;
  promo_code_id: number;
  user_id: string;
  subscription_id: string | null;
  applied_effect: string;
  applied_value: string | null;
  created_at: string;
  updated_at: string;
};

export type PromoValidationSuccess = {
  promoCodeId: number;
  code: string;
  description: string;
  effect: PromoCodeEffect;
  effectValue: string | null;
};

export type PromoApplyResult = {
  applied: boolean;
  already_used: boolean;
  promo_code_id: number;
  code: string;
  description: string;
  effect: PromoCodeEffect;
  effect_value: string | null;
  vip_activated: boolean;
  message: string;
  subscription_id?: string | undefined;
  plan_id?: PlanId | undefined;
  plan_status?: PlanStatus | undefined;
  payment_method?: UserPaymentMethod | undefined;
};

export type CaktoWebhookEventStatus = "received" | "processing" | "processed" | "ignored" | "failed";

export type CheckoutStartResult = {
  checkout_status: "pending" | "vip_active";
  plan_id: PlanId;
  plan_status: PlanStatus;
  payment_method: UserPaymentMethod;
  amount: number;
  checkout_url: string | null;
  product_id: string | null;
  subscription_id: string;
  message: string;
};

export interface Env {
  fitloot_db: D1Database;
  fitloot_runtime_db?: D1Database | undefined;
  ASSETS: Fetcher;
  SUPABASE_HYPERDRIVE?: {
    connectionString?: string | undefined;
  } | undefined;
  SUPABASE_WRITE_HYPERDRIVE?: {
    connectionString?: string | undefined;
  } | undefined;
  SUPABASE_READ_HYPERDRIVE?: {
    connectionString?: string | undefined;
  } | undefined;
  DB_BACKEND?: "d1" | "supabase" | undefined;
  DB_TOPOLOGY?: "single" | "hybrid" | undefined;
  SUPABASE_URL?: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
  SUPABASE_DB_URL?: string | undefined;
  SUPABASE_WRITE_DB_URL?: string | undefined;
  SUPABASE_READ_DB_URL?: string | undefined;
  SUPABASE_POOL_MAX?: string | undefined;
  SUPABASE_CONNECT_TIMEOUT_MS?: string | undefined;
  SUPABASE_QUERY_TIMEOUT_MS?: string | undefined;
  SUPABASE_STATEMENT_TIMEOUT_MS?: string | undefined;
  SUPABASE_IDLE_TIMEOUT_MS?: string | undefined;
  SUPABASE_READ_MAX_ATTEMPTS?: string | undefined;
  SUPABASE_READ_RETRY_BASE_DELAY_MS?: string | undefined;
  SUPABASE_READ_RETRY_MAX_DELAY_MS?: string | undefined;
  REQUEST_DEDUPE_WINDOW_MS?: string | undefined;
  HOT_GET_CACHE_TTL_MS?: string | undefined;
  HOT_GET_STALE_TTL_MS?: string | undefined;
  HF_TOKEN?: string | undefined;
  HF_CHAT_MODEL?: string | undefined;
  HUGGING_FACE_API_KEY?: string | undefined;
  HUGGING_FACE_CHAT_MODEL?: string | undefined;
  USDA_API_KEY: string;
  RAPID_API_KEY?: string | undefined;
  RAPID_API_HOST?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  ANTHROPIC_CHAT_MODEL?: string | undefined;
  API_NINJAS_KEY?: string | undefined;
  GYMFIT_API_KEY?: string | undefined;
  FRONTEND_ORIGIN?: string | undefined;
  FRONTEND_ORIGINS?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  FEEDBACK_FROM_EMAIL?: string | undefined;
  VIP_ACTIVATION_CODE?: string | undefined;
  WEBHOOK_SECRET?: string | undefined;
  CAKTO_CLIENT_ID?: string | undefined;
  CAKTO_CLIENT_SECRET?: string | undefined;
  CAKTO_WEBHOOK_SECRET?: string | undefined;
  HUGGING_FACE_VISION_MODEL?: string | undefined;
}

export type SkillSeed = {
  name: string;
  category: string;
  difficulty: string;
  tier: "iniciante" | "intermediario" | "avancado" | "calistenico";
  requiredLevel: number;
  description: string;
  unlockMessage: string;
  prerequisites?: string[] | undefined;
  attributeRequirements?: Record<string, number>;
};

export type SkillStageSeed = {
  skillName: string;
  stageNumber: number;
  name: string;
  description: string;
  levelRequired: number;
  exerciseReference: string;
};
