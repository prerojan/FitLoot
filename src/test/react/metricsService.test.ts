import { describe, expect, it, vi } from "vitest";

vi.mock("../../react-app/utils/api", () => ({
  fetchAndCacheJson: vi.fn(),
  readCachedJson: vi.fn(() => null),
}));

vi.mock("../../react-app/services/native/androidBridge", () => ({
  debugNativeOnce: vi.fn(),
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

import { buildConsolidatedMetrics } from "../../react-app/services/native/metricsService";
import type { DailyMetrics } from "../../shared/types";
import type { StepSnapshot } from "../../react-app/services/native/stepsService";

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
});
