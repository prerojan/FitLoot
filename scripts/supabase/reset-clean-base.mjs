#!/usr/bin/env node
import { closePool, deleteRows } from "./_common.mjs";

const CLEAN_RESET_TARGETS = [
  { schema: "missions", table: "mission_subtasks", filter: { id: "gt.0" } },
  { schema: "missions", table: "missions", filter: { id: "gt.0" } },
  { schema: "missions", table: "mission_generation_jobs", filter: { id: "not.is.null" } },

  { schema: "gameplay", table: "user_achievements", filter: { id: "gt.0" } },
  { schema: "gameplay", table: "user_titles", filter: { id: "gt.0" } },
  { schema: "gameplay", table: "user_skills", filter: { id: "gt.0" } },
  { schema: "gameplay", table: "user_goal_stats", filter: { user_id: "not.is.null" } },
  { schema: "gameplay", table: "user_event_counters", filter: { user_id: "not.is.null" } },
  { schema: "gameplay", table: "user_event_log", filter: { id: "gt.0" } },
  { schema: "gameplay", table: "user_monthly_counters", filter: { user_id: "not.is.null" } },
  { schema: "gameplay", table: "user_reward_notifications", filter: { id: "gt.0" } },
  { schema: "gameplay", table: "mini_games", filter: { id: "gt.0" } },
  { schema: "gameplay", table: "coupon_orders", filter: { id: "gt.0" } },

  { schema: "social", table: "friend_requests", filter: { id: "gt.0" } },
  { schema: "social", table: "friendships", filter: { id: "gt.0" } },
  { schema: "social", table: "friend_activity_events", filter: { id: "gt.0" } },
  { schema: "social", table: "user_presence", filter: { user_id: "not.is.null" } },

  { schema: "billing", table: "promo_code_usages", filter: { id: "gt.0" } },
  { schema: "billing", table: "subscriptions", filter: { id: "not.is.null" } },
  { schema: "billing", table: "cakto_webhook_events", filter: { id: "not.is.null" } },

  { schema: "telemetry", table: "daily_metrics", filter: { id: "gt.0" } },
  { schema: "telemetry", table: "progress_snapshots", filter: { id: "gt.0" } },
  { schema: "telemetry", table: "physical_benchmarks", filter: { id: "gt.0" } },
  { schema: "telemetry", table: "food_diary", filter: { id: "gt.0" } },
  { schema: "telemetry", table: "app_state", filter: { key: "not.is.null" } },

  { schema: "core", table: "user_sessions", filter: { id: "not.is.null" } },
  { schema: "core", table: "sessions", filter: { id: "not.is.null" } },
  { schema: "core", table: "magic_link_tokens", filter: { token: "not.is.null" } },
  { schema: "core", table: "user_training_plans", filter: { user_id: "not.is.null" } },
  { schema: "core", table: "user_progression", filter: { user_id: "not.is.null" } },
  { schema: "core", table: "user_profiles", filter: { user_id: "not.is.null" } },
  { schema: "core", table: "user_attributes", filter: { user_id: "not.is.null" } },
  { schema: "core", table: "users", filter: { id: "not.is.null" } },
];

async function run() {
  console.log(
    `[supabase][reset-clean-base] deleting rows from ${CLEAN_RESET_TARGETS.length} tables...`,
  );

  for (const target of CLEAN_RESET_TARGETS) {
    await deleteRows(target);
  }

  console.log("[supabase][reset-clean-base] done.");
}

run().catch((error) => {
  console.error("[supabase][reset-clean-base][failed]", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}).finally(async () => {
  await closePool();
});
