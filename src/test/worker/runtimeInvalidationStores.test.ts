import { describe, expect, it } from "vitest";

import { deleteRuntimeHttpCacheBySessionPaths } from "@/worker/core/runtimeHttpCacheStore";
import { deleteRuntimeUserProjectionScopes } from "@/worker/core/runtimeUserProjectionStore";

import { createMockD1Database } from "./mockD1";

describe("runtime invalidation stores", () => {
  it("deletes only selected hot-cache paths for a session", async () => {
    const { db, calls } = createMockD1Database([
      {
        match: "CREATE TABLE IF NOT EXISTS runtime_http_cache",
        run: { success: true, meta: {} },
      },
      {
        match: "CREATE INDEX IF NOT EXISTS idx_runtime_http_cache_session",
        run: { success: true, meta: {} },
      },
      {
        match: "CREATE INDEX IF NOT EXISTS idx_runtime_http_cache_expiry",
        run: { success: true, meta: {} },
      },
      {
        match: "DELETE FROM runtime_http_cache",
        run: { success: true, meta: {} },
      },
    ]);

    await deleteRuntimeHttpCacheBySessionPaths(db, "session-123", [
      "/api/metrics/today",
      "/api/reward-notifications/pending",
    ]);

    const deleteCall = calls.find(
      (call) =>
        call.method === "run" &&
        call.sql.includes("DELETE FROM runtime_http_cache") &&
        call.params[0] === "session-123",
    );

    expect(deleteCall).toBeDefined();
    expect(deleteCall?.params).toEqual([
      "session-123",
      "/api/metrics/today",
      "/api/reward-notifications/pending",
    ]);
  });

  it("deletes only the requested projection scopes", async () => {
    const { db, calls } = createMockD1Database([
      {
        match: "CREATE TABLE IF NOT EXISTS runtime_profile_projection",
        run: { success: true, meta: {} },
      },
      {
        match: "CREATE TABLE IF NOT EXISTS runtime_bootstrap_projection",
        run: { success: true, meta: {} },
      },
      {
        match: "CREATE TABLE IF NOT EXISTS runtime_dashboard_projection",
        run: { success: true, meta: {} },
      },
      {
        match: "CREATE INDEX IF NOT EXISTS idx_runtime_dashboard_projection_user_updated",
        run: { success: true, meta: {} },
      },
      {
        match: "DELETE FROM runtime_profile_projection WHERE updated_at < ?",
        run: { success: true, meta: {} },
      },
      {
        match: "DELETE FROM runtime_bootstrap_projection WHERE updated_at < ?",
        run: { success: true, meta: {} },
      },
      {
        match: "DELETE FROM runtime_dashboard_projection WHERE updated_at < ?",
        run: { success: true, meta: {} },
      },
      {
        match: "DELETE FROM runtime_profile_projection WHERE user_id = ?",
        run: { success: true, meta: {} },
      },
      {
        match: "DELETE FROM runtime_bootstrap_projection WHERE user_id = ?",
        run: { success: true, meta: {} },
      },
      {
        match: "DELETE FROM runtime_dashboard_projection",
        run: { success: true, meta: {} },
      },
    ]);

    await deleteRuntimeUserProjectionScopes(db, "user-1", [
      "bootstrap",
      "dashboard:progression",
      "dashboard:attributes",
    ]);

    const bootstrapDelete = calls.find(
      (call) =>
        call.method === "run" &&
        call.sql.includes("DELETE FROM runtime_bootstrap_projection WHERE user_id = ?"),
    );
    expect(bootstrapDelete?.params).toEqual(["user-1"]);

    const profileDelete = calls.find(
      (call) =>
        call.method === "run" &&
        call.sql.includes("DELETE FROM runtime_profile_projection WHERE user_id = ?"),
    );
    expect(profileDelete).toBeUndefined();

    const dashboardDelete = calls.find(
      (call) =>
        call.method === "run" &&
        call.sql.includes("DELETE FROM runtime_dashboard_projection") &&
        call.params[0] === "user-1",
    );
    expect(dashboardDelete?.params).toEqual([
      "user-1",
      "progression",
      "attributes",
    ]);
  });
});
