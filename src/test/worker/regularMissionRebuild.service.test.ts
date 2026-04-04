import { describe, expect, it, vi } from "vitest";

import { createRegularMissionRebuildService } from "../../worker/services/regularMissionRebuild";
import type { Env } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";

describe("regularMissionRebuild.runRegularMissionRebuildBatch", () => {
  it("uses the migrated maintenance_jobs schema and rebuilds a user batch", async () => {
    const { db, calls } = createMockD1Database([
      {
        match: /CREATE TABLE IF NOT EXISTS maintenance_jobs/,
        run: { success: true, meta: {} },
      },
      {
        match: /PRAGMA table_info\('maintenance_jobs'\)/,
        all: {
          results: [
            { name: "job_key" },
            { name: "status" },
            { name: "cursor" },
            { name: "payload_json" },
            { name: "started_at" },
            { name: "completed_at" },
            { name: "updated_at" },
          ],
        },
      },
      {
        match: /INSERT INTO maintenance_jobs\s+\(\s*job_key,\s*status,\s*cursor,\s*payload_json,\s*updated_at/s,
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: /SELECT cursor as cursor_value, payload_json, status, started_at\s+FROM maintenance_jobs/s,
        first: {
          cursor_value: null,
          payload_json: "{}",
          status: "pending",
          started_at: null,
        },
      },
      {
        match: /UPDATE maintenance_jobs\s+SET status = 'running'[\s\S]*completed_at = NULL[\s\S]*payload_json = \?/,
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: /SELECT user_id\s+FROM user_profiles[\s\S]*WHERE user_id > \?[\s\S]*ORDER BY user_id[\s\S]*LIMIT \?/,
        all: { results: [{ user_id: "user-1" }] },
      },
      {
        match: /DELETE FROM mission_subtasks/,
        run: { success: true, meta: {} },
      },
      {
        match: /DELETE FROM missions/,
        run: { success: true, meta: {} },
      },
      {
        match: /UPDATE maintenance_jobs\s+SET cursor = \?/,
        run: { success: true, meta: { changes: 1 } },
      },
    ]);

    const generateStructuredMissionPlanForUser = vi.fn(async () => ({
      missions: [{ id: 1 }],
    }));
    const invalidateMissionListCache = vi.fn();
    const service = createRegularMissionRebuildService({
      generateStructuredMissionPlanForUser,
      getErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
      invalidateMissionListCache,
    });

    const executed = await service.runRegularMissionRebuildBatch(
      { fitloot_db: db } as Env,
      db,
    );

    expect(executed).toBe(true);
    expect(generateStructuredMissionPlanForUser).toHaveBeenCalledWith(
      expect.any(Object),
      db,
      "user-1",
      expect.objectContaining({
        isAiSpecial: false,
      }),
    );
    expect(invalidateMissionListCache).toHaveBeenCalledWith("user-1");
    expect(calls.some((call) => call.sql.includes("cursor_user_id"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("processed_count"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("payload_json"))).toBe(true);
  });

  it("checkpointa o cursor e devolve o job para pending quando o budget da execucao acaba", async () => {
    const { db, calls } = createMockD1Database([
      {
        match: /CREATE TABLE IF NOT EXISTS maintenance_jobs/,
        run: { success: true, meta: {} },
      },
      {
        match: /PRAGMA table_info\('maintenance_jobs'\)/,
        all: {
          results: [
            { name: "job_key" },
            { name: "status" },
            { name: "cursor" },
            { name: "payload_json" },
            { name: "started_at" },
            { name: "completed_at" },
            { name: "updated_at" },
          ],
        },
      },
      {
        match: /INSERT INTO maintenance_jobs\s+\(\s*job_key,\s*status,\s*cursor,\s*payload_json,\s*updated_at/s,
        run: { success: true, meta: { changes: 0 } },
      },
      {
        match: /SELECT cursor as cursor_value, payload_json, status, started_at\s+FROM maintenance_jobs/s,
        first: {
          cursor_value: null,
          payload_json: "{}",
          status: "pending",
          started_at: null,
        },
      },
      {
        match: /UPDATE maintenance_jobs\s+SET status = 'running'[\s\S]*completed_at = NULL[\s\S]*payload_json = \?/,
        run: { success: true, meta: { changes: 1 } },
      },
      {
        match: /SELECT user_id\s+FROM user_profiles[\s\S]*WHERE user_id > \?[\s\S]*ORDER BY user_id[\s\S]*LIMIT \?/,
        all: { results: [{ user_id: "user-1" }, { user_id: "user-2" }] },
      },
      {
        match: /DELETE FROM mission_subtasks/,
        run: { success: true, meta: {} },
      },
      {
        match: /DELETE FROM missions/,
        run: { success: true, meta: {} },
      },
      {
        match: /UPDATE maintenance_jobs\s+SET cursor = \?/,
        run: { success: true, meta: { changes: 1 } },
      },
    ]);

    let nowCallCount = 0;
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockImplementation(() => {
        nowCallCount += 1;
        return nowCallCount >= 3 ? 20_001 : 0;
      });

    const generateStructuredMissionPlanForUser = vi.fn(async () => ({
      missions: [{ id: 1 }],
    }));
    const service = createRegularMissionRebuildService({
      generateStructuredMissionPlanForUser,
      getErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
      invalidateMissionListCache: vi.fn(),
    });

    await service.runRegularMissionRebuildBatch(
      { fitloot_db: db } as Env,
      db,
    );

    const checkpointUpdate = calls.find((call) =>
      call.method === "run"
      && call.sql.includes("UPDATE maintenance_jobs")
      && call.sql.includes("SET cursor = ?"),
    );

    expect(generateStructuredMissionPlanForUser).toHaveBeenCalledTimes(1);
    expect(checkpointUpdate?.params[0]).toBe("user-1");
    expect(checkpointUpdate?.params[2]).toBe("pending");

    dateNowSpy.mockRestore();
  });
});
