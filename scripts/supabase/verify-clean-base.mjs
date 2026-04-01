#!/usr/bin/env node
import { closePool, listAllRows } from "./_common.mjs";

const TARGETS = [
  { schema: "core", table: "users", select: "id" },
  { schema: "core", table: "sessions", select: "id" },
  { schema: "core", table: "user_sessions", select: "id" },
  { schema: "core", table: "magic_link_tokens", select: "token" },
  { schema: "core", table: "user_profiles", select: "user_id" },
  { schema: "core", table: "user_attributes", select: "user_id" },
  { schema: "core", table: "user_progression", select: "user_id" },
  { schema: "core", table: "user_training_plans", select: "user_id" },
  { schema: "missions", table: "missions", select: "id" },
  { schema: "missions", table: "mission_subtasks", select: "id" },
  { schema: "missions", table: "mission_generation_jobs", select: "id" },
  { schema: "gameplay", table: "user_achievements", select: "id" },
  { schema: "gameplay", table: "user_titles", select: "id" },
  { schema: "gameplay", table: "user_skills", select: "id" },
  { schema: "gameplay", table: "mini_games", select: "id" },
  { schema: "gameplay", table: "coupon_orders", select: "id" },
  { schema: "billing", table: "subscriptions", select: "id" },
  { schema: "billing", table: "promo_code_usages", select: "id" },
  { schema: "billing", table: "cakto_webhook_events", select: "id" },
  { schema: "social", table: "friend_requests", select: "id" },
  { schema: "social", table: "friendships", select: "id" },
  { schema: "social", table: "user_presence", select: "user_id" },
  { schema: "telemetry", table: "daily_metrics", select: "id" },
  { schema: "telemetry", table: "progress_snapshots", select: "id" },
  { schema: "telemetry", table: "physical_benchmarks", select: "id" },
  { schema: "telemetry", table: "food_diary", select: "id" },
  { schema: "telemetry", table: "app_state", select: "key" },
];

async function run() {
  let failed = false;
  for (const target of TARGETS) {
    const rows = await listAllRows({
      schema: target.schema,
      table: target.table,
      select: target.select,
      order: `${target.select}.asc`,
    });
    const count = rows.length;
    if (count > 0) {
      failed = true;
    }
    console.log(
      `[supabase][verify-clean-base] ${target.schema}.${target.table}=${count}`,
    );
  }

  if (failed) {
    throw new Error("Clean-base verification failed. One or more user-bound tables contain rows.");
  }

  console.log("[supabase][verify-clean-base] all user-bound tables are empty.");
}

run().catch((error) => {
  console.error("[supabase][verify-clean-base][failed]", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}).finally(async () => {
  await closePool();
});
