import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerMetricsRoutes } from "../../worker/routes/metrics";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import { createAuthMiddleware, createExecutionContext, createJsonRequest, createTestEnv, TEST_USER } from "./testUtils";

function createMetricsDeps() {
  return {
    authMiddleware: createAuthMiddleware(),
    invalidateMissionListCache: vi.fn(() => undefined),
    schedulePeriodicProgressRecomputeWithGuard: vi.fn(() => undefined),
  } satisfies Parameters<typeof registerMetricsRoutes>[1];
}

describe("metrics routes", () => {
  it("invalidates mission caches and schedules periodic recompute after offline step sync", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT response_payload",
        first: null,
      },
      {
        match: "INSERT INTO daily_metrics",
        run: { success: true, meta: {} },
      },
      {
        match: "SELECT date, steps, calories_burned",
        first: {
          date: "2026-04-04",
          steps: 4200,
          calories_burned: 180,
        },
      },
      {
        match: "INSERT INTO offline_sync_operations",
        run: { success: true, meta: {} },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMetricsDeps();
    const app = new Hono<AppContext>();
    registerMetricsRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/offline/sync", {
        method: "POST",
        body: {
          operations: [
            {
              operation_id: "step-op-1",
              type: "step_delta_recorded",
              user_id: TEST_USER.id,
              occurred_at: "2026-04-04T12:00:00.000Z",
              source: "android-native",
              confidence: "official",
              payload: {
                delta: 250,
                total_after_delta: 4200,
                date: "2026-04-04",
              },
            },
          ],
        },
      }),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(deps.invalidateMissionListCache).toHaveBeenCalledWith(TEST_USER.id);
    expect(deps.schedulePeriodicProgressRecomputeWithGuard).toHaveBeenCalledWith(
      TEST_USER.id,
      db,
      executionCtx,
    );
  });

  it("invalidates mission caches and schedules periodic recompute after direct metrics update", async () => {
    const { db } = createMockD1Database([
      {
        match: "INSERT INTO daily_metrics",
        run: { success: true, meta: {} },
      },
    ]);
    const env = createTestEnv(db);
    const deps = createMetricsDeps();
    const app = new Hono<AppContext>();
    registerMetricsRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/metrics/update", {
        method: "POST",
        body: {
          steps: 5400,
          calories_burned: 320,
        },
      }),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(deps.invalidateMissionListCache).toHaveBeenCalledWith(TEST_USER.id);
    expect(deps.schedulePeriodicProgressRecomputeWithGuard).toHaveBeenCalledWith(
      TEST_USER.id,
      db,
      executionCtx,
    );
  });
});
