import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../react-app/utils/api", () => ({
  api: vi.fn(),
  fetchAndCacheJson: vi.fn(),
  readCachedJson: vi.fn(() => null),
}));

vi.mock("../../react-app/services/native/androidBridge", () => ({
  debugNativeOnce: vi.fn(),
  getAndroidBridge: vi.fn(() => null),
}));

vi.mock("../../react-app/services/runtime/offlineSyncService", () => ({
  offlineSyncService: {
    hydrateMetricsBaseline: vi.fn(),
    publishMetricsSnapshot: vi.fn(),
  },
}));

vi.mock("../../react-app/services/native/stepsService", () => ({
  stepsService: {
    startTracking: vi.fn(),
    getCurrentSteps: vi.fn(),
    subscribeToSteps: vi.fn(),
  },
}));

import { buildConsolidatedMetrics, metricsService } from "../../react-app/services/native/metricsService";
import type { DailyMetrics } from "../../shared/types";
import type { StepSnapshot } from "../../react-app/services/native/stepsService";
import { offlineSyncService } from "../../react-app/services/runtime/offlineSyncService";
import { getAndroidBridge } from "../../react-app/services/native/androidBridge";
import { api, fetchAndCacheJson } from "../../react-app/utils/api";
import { stepsService } from "../../react-app/services/native/stepsService";

function createDailyMetrics(steps: number): DailyMetrics {
  return {
    id: 1,
    user_id: "user-1",
    date: "2026-04-03",
    steps,
    calories_burned: 320,
    created_at: "2026-04-03T08:00:00.000Z",
    updated_at: "2026-04-03T09:00:00.000Z",
  };
}

function createStepSnapshot(overrides: Partial<StepSnapshot>): StepSnapshot {
  return {
    steps: 0,
    calories: 0,
    distance: 0,
    activeMinutes: 0,
    lastUpdated: "2026-04-03T10:00:00.000Z",
    source: "android-sensor",
    confidence: "derived",
    caloriesSource: "unavailable",
    sessionSteps: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Reflect.set(metricsService as object, "apiMetrics", null);
  Reflect.set(metricsService as object, "lastSyncedPayloadKey", null);
  Reflect.set(metricsService as object, "refreshInFlight", null);
  Reflect.set(metricsService as object, "unsubscribeSteps", null);
  Reflect.set(metricsService as object, "started", false);
  Reflect.set(metricsService as object, "requestedNativeHealthPermissions", false);
  Reflect.set(metricsService as object, "state", { metrics: null, loading: false, error: null });
});

describe("buildConsolidatedMetrics", () => {
  it("preserves the server daily total when the Android sensor snapshot is lower after reload", () => {
    const consolidated = buildConsolidatedMetrics(
      createDailyMetrics(4820),
      createStepSnapshot({
        steps: 0,
        sessionSteps: 0,
      }),
    );

    expect(consolidated.steps).toBe(4820);
    expect(consolidated.dailyMetrics.steps).toBe(4820);
  });

  it("allows realtime sensor growth without dropping the current total", () => {
    const consolidated = buildConsolidatedMetrics(
      createDailyMetrics(4820),
      createStepSnapshot({
        steps: 4955,
        sessionSteps: 4955,
      }),
    );

    expect(consolidated.steps).toBe(4955);
    expect(consolidated.dailyMetrics.steps).toBe(4955);
  });

  it("still trusts official daily sources over cached server values", () => {
    const consolidated = buildConsolidatedMetrics(
      createDailyMetrics(4820),
      createStepSnapshot({
        steps: 3010,
        source: "android-health-connect",
        confidence: "official",
        calories: 410,
        caloriesSource: "official",
      }),
    );

    expect(consolidated.steps).toBe(3010);
    expect(consolidated.dailyMetrics.steps).toBe(3010);
    expect(consolidated.caloriesBurned).toBe(410);
  });

  it("does not carry the previous day server total into the new day snapshot", () => {
    const consolidated = buildConsolidatedMetrics(
      createDailyMetrics(656),
      createStepSnapshot({
        steps: 178,
        sessionSteps: 178,
        lastUpdated: "2026-04-08T10:00:00.000Z",
      }),
    );

    expect(consolidated.dailyMetrics.date).toBe("2026-04-08");
    expect(consolidated.steps).toBe(178);
    expect(consolidated.dailyMetrics.steps).toBe(178);
  });

  it("publishes official Health Connect snapshots to the backend sync flow", async () => {
    const fetchAndCacheJsonMock = vi.mocked(fetchAndCacheJson);
    const directApiMock = vi.mocked(api);
    const getCurrentStepsMock = vi.mocked(stepsService.getCurrentSteps);

    fetchAndCacheJsonMock.mockResolvedValue(
      createDailyMetrics(656),
    );
    directApiMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as Response);
    getCurrentStepsMock.mockResolvedValue(
      createStepSnapshot({
        steps: 1044,
        calories: 120,
        source: "health-connect",
        confidence: "official",
        caloriesSource: "official",
        lastUpdated: "2026-04-08T10:00:00.000Z",
      }),
    );

    await metricsService.refresh({ forceApi: true, syncRemote: true });

    expect(directApiMock).toHaveBeenCalledWith(
      "/api/metrics/update",
      expect.objectContaining({
        method: "POST",
        requestClass: "background",
      }),
    );
    expect(vi.mocked(offlineSyncService.publishMetricsSnapshot)).not.toHaveBeenCalled();
  });

  it("falls back to the offline metrics queue when direct metrics sync fails", async () => {
    const fetchAndCacheJsonMock = vi.mocked(fetchAndCacheJson);
    const directApiMock = vi.mocked(api);
    const publishMetricsSnapshotMock = vi.mocked(offlineSyncService.publishMetricsSnapshot);
    const getCurrentStepsMock = vi.mocked(stepsService.getCurrentSteps);

    fetchAndCacheJsonMock.mockResolvedValue(
      createDailyMetrics(656),
    );
    directApiMock.mockRejectedValue(new Error("network"));
    publishMetricsSnapshotMock.mockResolvedValue(undefined);
    getCurrentStepsMock.mockResolvedValue(
      createStepSnapshot({
        steps: 932,
        calories: 120,
        source: "health-connect",
        confidence: "official",
        caloriesSource: "official",
        lastUpdated: "2026-04-08T10:00:00.000Z",
      }),
    );

    await metricsService.refresh({ forceApi: true, syncRemote: true });

    expect(publishMetricsSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-04-08",
        steps: 932,
        confidence: "official",
      }),
    );
  });

  it("requests native permissions once when Android reports missing Health Connect permissions", async () => {
    const fetchAndCacheJsonMock = vi.mocked(fetchAndCacheJson);
    const getCurrentStepsMock = vi.mocked(stepsService.getCurrentSteps);
    const bridgeRequestPermissions = vi.fn();

    vi.mocked(getAndroidBridge).mockReturnValue({
      requestPermissions: bridgeRequestPermissions,
    });
    fetchAndCacheJsonMock.mockResolvedValue(createDailyMetrics(656));
    getCurrentStepsMock.mockResolvedValue(
      createStepSnapshot({
        steps: 120,
        source: "android-sensor",
        confidence: "derived",
        error: "missing_health_permissions",
        lastUpdated: "2026-04-08T10:00:00.000Z",
      }),
    );

    await metricsService.refresh({ forceApi: true, syncRemote: false });
    await metricsService.refresh({ forceApi: true, syncRemote: false });

    expect(bridgeRequestPermissions).toHaveBeenCalledTimes(1);
  });
});
