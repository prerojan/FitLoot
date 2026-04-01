import { describe, expect, it, vi } from "vitest";

import { MISSION_LIMITS } from "../../constants/missionMetrics";
import { createMissionGenerationService } from "../../worker/services/missionGeneration";
import type { Env } from "../../worker/core/types";

type MissionPeriod = "daily" | "weekly" | "monthly";

type RecordingDb = {
  db: D1Database;
  runCalls: Array<{ sql: string; params: unknown[] }>;
};

function createRecordingDb(countByPeriod: Record<MissionPeriod, number>): RecordingDb {
  const runCalls: Array<{ sql: string; params: unknown[] }> = [];

  const db = {
    prepare(sql: string) {
      let params: unknown[] = [];

      return {
        bind(...boundParams: unknown[]) {
          params = boundParams;
          return this;
        },
        async first<T = unknown>() {
          if (sql.includes("SELECT COUNT(*) as count")) {
            const period = String(params[1] ?? "") as MissionPeriod;
            return {
              count: countByPeriod[period] ?? 0,
            } as T;
          }
          return null as T | null;
        },
        async all<T = unknown>() {
          return { results: [] as T[] };
        },
        async run() {
          runCalls.push({ sql, params });
          return { success: true, meta: {} } as D1Result;
        },
      };
    },
  } as unknown as D1Database;

  return { db, runCalls };
}

function createService(params: {
  hasMissionStatusColumn: boolean;
  countByPeriod: Record<MissionPeriod, number>;
}) {
  const createMissionsForPeriod = vi.fn(async () => undefined);
  const ensureStructuredPeriodicMissionsFromExistingDailyBlueprints = vi.fn(
    async () => undefined,
  );
  const { db, runCalls } = createRecordingDb(params.countByPeriod);

  const service = createMissionGenerationService({
    buildFallbackStructuredPlan: () => ({}) as Record<string, unknown>,
    buildStructuredPlanPrompt: () => "",
    createMissionsForPeriod,
    ensureStructuredPeriodicMissionsFromExistingDailyBlueprints,
    getActiveCycleMissionCounts: vi.fn(async () => ({
      daily: 1,
      weekly: 1,
      monthly: 1,
    })),
    hasTableColumn: vi.fn(
      async (_db: D1Database, tableName: string, columnName: string) =>
        tableName === "missions" &&
        columnName === "status" &&
        params.hasMissionStatusColumn,
    ),
    listCurrentCycleMissions: vi.fn(async () => []),
    loadMissionGenerationProfile: vi.fn(async () => null),
    missionCycleStartIso: vi.fn((period: MissionPeriod) => {
      if (period === "daily") return "2026-03-31T00:00:00.000Z";
      if (period === "weekly") return "2026-03-30T00:00:00.000Z";
      return "2026-03-01T00:00:00.000Z";
    }),
    persistGeneratedMissionPlan: vi.fn(async () => []),
    repairLegacyPeriodicMissions: vi.fn(async () => undefined),
    requestStructuredMissionPlanFromAI: vi.fn(async () => ({})),
    validateStructuredMissionPlan: vi.fn(() => ({
      blueprints: [],
      invalidCount: 0,
      totalCount: 0,
    })),
  });

  return {
    service,
    db,
    runCalls,
    createMissionsForPeriod,
    ensureStructuredPeriodicMissionsFromExistingDailyBlueprints,
  };
}

describe("missionGeneration.ensurePeriodicMissions", () => {
  it("expira pendentes por status quando a coluna status existe e reabastece alvos ausentes", async () => {
    const setup = createService({
      hasMissionStatusColumn: true,
      countByPeriod: {
        daily: 0,
        weekly: 0,
        monthly: 0,
      },
    });

    const env = {} as Env;
    await setup.service.ensurePeriodicMissions(
      env,
      setup.db,
      "user-1",
    );

    const statusExpiryUpdates = setup.runCalls.filter((call) =>
      call.sql.includes("SET status = 'expired'"),
    );
    expect(statusExpiryUpdates).toHaveLength(3);
    expect(setup.createMissionsForPeriod).toHaveBeenCalledWith(
      env,
      setup.db,
      "user-1",
      "daily",
      MISSION_LIMITS.daily,
    );
    expect(
      setup.ensureStructuredPeriodicMissionsFromExistingDailyBlueprints,
    ).toHaveBeenCalledWith(
      env,
      setup.db,
      "user-1",
      {
        weeklyTarget: MISSION_LIMITS.weekly,
        monthlyTarget: MISSION_LIMITS.monthly,
      },
    );
  });

  it("usa fallback por deadline quando a coluna status nao existe", async () => {
    const setup = createService({
      hasMissionStatusColumn: false,
      countByPeriod: {
        daily: MISSION_LIMITS.daily,
        weekly: MISSION_LIMITS.weekly,
        monthly: MISSION_LIMITS.monthly,
      },
    });

    const env = {} as Env;
    await setup.service.ensurePeriodicMissions(
      env,
      setup.db,
      "user-legacy",
    );

    const deadlineExpiryUpdates = setup.runCalls.filter((call) =>
      call.sql.includes("SET deadline = datetime('now', '-1 second')"),
    );
    expect(deadlineExpiryUpdates).toHaveLength(3);
    expect(setup.createMissionsForPeriod).not.toHaveBeenCalled();
    expect(
      setup.ensureStructuredPeriodicMissionsFromExistingDailyBlueprints,
    ).not.toHaveBeenCalled();
  });
});

describe("missionGeneration.generateStructuredMissionPlanForUser", () => {
  it("returns the current-cycle mission snapshot after persistence so the UI can render immediately", async () => {
    const persistedMissions = [
      { id: 10, type: "daily", title: "Persistida sem normalizacao" },
    ];
    const displayReadyMissions = [
      { id: 10, type: "daily", title: "Agachamento livre" },
      { id: 11, type: "weekly", title: "Fluxo semanal" },
    ];
    const listCurrentCycleMissions = vi
      .fn()
      .mockResolvedValueOnce(displayReadyMissions);
    const persistGeneratedMissionPlan = vi
      .fn()
      .mockResolvedValue(persistedMissions);

    const service = createMissionGenerationService({
      buildFallbackStructuredPlan: () => ({ source: "fallback" }),
      buildStructuredPlanPrompt: () => "",
      createMissionsForPeriod: vi.fn(async () => undefined),
      ensureStructuredPeriodicMissionsFromExistingDailyBlueprints: vi.fn(async () => undefined),
      getActiveCycleMissionCounts: vi.fn(async () => ({
        daily: 0,
        weekly: 0,
        monthly: 0,
      })),
      hasTableColumn: vi.fn(async () => true),
      listCurrentCycleMissions,
      loadMissionGenerationProfile: vi.fn(async () => ({ userId: "user-1" })),
      missionCycleStartIso: vi.fn(() => "2026-03-31T00:00:00.000Z"),
      persistGeneratedMissionPlan,
      repairLegacyPeriodicMissions: vi.fn(async () => undefined),
      requestStructuredMissionPlanFromAI: vi.fn(async () => ({ source: "ai" })),
      validateStructuredMissionPlan: vi.fn(() => ({
        blueprints: [],
        invalidCount: 0,
        totalCount: 0,
      })),
    });

    const result = await service.generateStructuredMissionPlanForUser(
      {} as Env,
      {} as D1Database,
      "user-1",
      {
        isAiSpecial: false,
        dailyTarget: MISSION_LIMITS.daily,
        weeklyTarget: MISSION_LIMITS.weekly,
        monthlyTarget: MISSION_LIMITS.monthly,
      },
    );

    expect(persistGeneratedMissionPlan).toHaveBeenCalledTimes(1);
    expect(listCurrentCycleMissions).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "regular",
    );
    expect(result.missions).toEqual(displayReadyMissions);
  });
});
