import { describe, expect, it, vi } from "vitest";

import { createBackgroundProcessingService } from "../../worker/services/backgroundProcessing";
import type { Env } from "../../worker/core/types";
import {
  CRON_DAILY_MISSION_RESET,
  CRON_WEEKLY_MISSION_RESET,
} from "../../worker/constants/scheduler";
import { createMockD1Database } from "./mockD1";

function createEnvWithDailyResetMocks() {
  const { db, calls } = createMockD1Database([
    {
      match: "SELECT value FROM app_state WHERE key = ?",
      first: { value: null },
    },
    {
      match: /SELECT user_id FROM user_profiles[\s\S]*ORDER BY user_id[\s\S]*LIMIT \? OFFSET \?/,
      all: { results: [] },
    },
    {
      match: "INSERT INTO app_state (key, value, updated_at)",
      run: { success: true, meta: {} },
    },
    {
      match: /SELECT user_id FROM user_profiles[\s\S]*WHERE user_id IN \(/,
      all: { results: [] },
    },
  ]);

  const env = {
    fitloot_db: db,
  } as Env;

  return { env, calls };
}

describe("backgroundProcessing.runScheduledWithGuard", () => {
  it("executa recalculo semanal apenas no cron semanal", async () => {
    const deps = {
      cleanupSettledMissionsWithGuard: vi.fn(async () => undefined),
      ensurePeriodicMissions: vi.fn(async () => undefined),
      ensureUserCounterRow: vi.fn(async () => undefined),
      expirePendingMissionsAndUpdateStreak: vi.fn(async () => undefined),
    };
    const service = createBackgroundProcessingService(deps);

    const weekly = createEnvWithDailyResetMocks();
    await service.runScheduledWithGuard(
      {
        cron: CRON_WEEKLY_MISSION_RESET,
        scheduledTime: Date.now(),
      } as ScheduledEvent,
      weekly.env,
    );

    const weeklyRecalcCalls = weekly.calls.filter((call) =>
      call.sql.includes("WHERE user_id IN ("),
    );
    expect(weeklyRecalcCalls.length).toBeGreaterThan(0);

    const daily = createEnvWithDailyResetMocks();
    await service.runScheduledWithGuard(
      {
        cron: CRON_DAILY_MISSION_RESET,
        scheduledTime: Date.now(),
      } as ScheduledEvent,
      daily.env,
    );

    const dailyRecalcCalls = daily.calls.filter((call) =>
      call.sql.includes("WHERE user_id IN ("),
    );
    expect(dailyRecalcCalls).toHaveLength(0);
  });
});

