import { describe, expect, it, vi } from "vitest";

import type { Mission } from "../../shared/types";
import {
  arePersistentCounterMissionProgressStatesEqual,
  buildCounterMissionProgressSignature,
  cachedMissionListNeedsCycleRefresh,
  createCounterMissionSnapshot,
  extractDateKey,
  formatDateKey,
  reconcilePersistentCounterMissionProgress,
  resolveExpiredMissionRefreshDelay,
} from "../../react-app/pages/dashboardUtils";

function buildMission(overrides?: Partial<Mission>): Mission {
  return {
    id: 1,
    user_id: "user-1",
    type: "monthly",
    title: "Passos do mes",
    description: "Acumule passos no ciclo atual",
    skill_id: null,
    target_reps: null,
    target_time: null,
    metric_type: "steps",
    metric_value: 100000,
    progress_value: 24000,
    metric_unit: "steps",
    sets: null,
    rest_seconds: null,
    instructions: [],
    exercise_instructions_en: [],
    exercise_instructions_pt: [],
    image_url: null,
    exercise_db_id: null,
    exercise_db_gif_url: null,
    exercise_db_image_url: null,
    muscle_groups: [],
    exercise_secondary_muscles: [],
    exercise_name: null,
    exercise_equipment: null,
    exercise_body_part: null,
    exercise_target: null,
    exercise_type: "cardio",
    body_area: "lower",
    attributes_benefited: [],
    duration_estimate_minutes: null,
    exercise_category: "cardio",
    mission_origin: "regular",
    goal: "Acumule passos no mes",
    is_ai_special: 0,
    circuit_tasks: [],
    safety_tips: [],
    difficulty_level: "iniciante",
    video_url: null,
    thumbnail_url: null,
    xp_reward: 30,
    points_reward: 10,
    deadline: null,
    is_completed: 0,
    completed_at: null,
    verified_by_sensor: 0,
    status: "pending",
    created_at: "2026-04-04T00:00:00.000Z",
    updated_at: "2026-04-04T00:00:00.000Z",
    cycle_date: "2026-04-01",
    ...overrides,
  };
}

describe("dashboardUtils counter mission helpers", () => {
  it("keeps the counter-progress signature stable when the mission payload identity changes but progress does not", () => {
    const first = [buildMission()];
    const second = [buildMission({ title: "Passos do mes atualizado" })];

    expect(buildCounterMissionProgressSignature(first)).toBe(
      buildCounterMissionProgressSignature(second),
    );
  });

  it("captures only unfinished periodic counter missions in the live progress snapshot", () => {
    const missions = [
      buildMission({ id: 11, progress_value: 22000 }),
      buildMission({ id: 12, type: "weekly", progress_value: 8000 }),
      buildMission({ id: 13, metric_type: "repetitions", goal: "Forca", progress_value: 10 }),
      buildMission({ id: 14, is_completed: 1, progress_value: 99000 }),
    ];

    const signature = buildCounterMissionProgressSignature(missions);
    const snapshot = createCounterMissionSnapshot(
      missions,
      { steps: 7342, distance_meters: 0 },
      signature,
    );

    expect(snapshot).toEqual({
      signature,
      metricsAtSnapshot: {
        steps: 7342,
        distance_meters: 0,
      },
      progressByMissionId: {
        11: 22000,
        12: 8000,
      },
    });
  });

  it("seeds persistent step mission progress by adding the current daily steps when the server has not updated today", () => {
    const nextState = reconcilePersistentCounterMissionProgress({
      missions: [buildMission({ progress_value: 24000, updated_at: "2026-04-03T22:00:00.000Z" })],
      metricsDate: "2026-04-04",
      stepsValue: 7342,
      distanceMetersValue: 0,
      state: {},
    });

    expect(nextState).toEqual({
      1: {
        metricsDate: "2026-04-04",
        metricType: "steps",
        lastMetricValue: 7342,
        progressValue: 31342,
      },
    });
  });

  it("keeps accumulated mission progress across the daily metrics rollover and only adds the new day's steps", () => {
    const previousState = {
      1: {
        metricsDate: "2026-04-04",
        metricType: "steps" as const,
        lastMetricValue: 7342,
        progressValue: 31342,
      },
    };

    const nextState = reconcilePersistentCounterMissionProgress({
      missions: [buildMission({ progress_value: 24000, updated_at: "2026-04-03T22:00:00.000Z" })],
      metricsDate: "2026-04-05",
      stepsValue: 512,
      distanceMetersValue: 0,
      state: previousState,
    });

    expect(nextState).toEqual({
      1: {
        metricsDate: "2026-04-05",
        metricType: "steps",
        lastMetricValue: 512,
        progressValue: 31854,
      },
    });
    expect(
      arePersistentCounterMissionProgressStatesEqual(previousState, nextState),
    ).toBe(false);
  });

  it("tracks distance missions with the same accumulated-progress contract", () => {
    const nextState = reconcilePersistentCounterMissionProgress({
      missions: [
        buildMission({
          id: 9,
          title: "Distancia do mes",
          metric_type: "distance_meters",
          metric_value: 12000,
          metric_unit: "m",
          goal: "Acumule distancia no mes",
          progress_value: 4000,
          updated_at: "2026-04-03T22:00:00.000Z",
        }),
      ],
      metricsDate: "2026-04-04",
      stepsValue: 0,
      distanceMetersValue: 1800,
      state: {},
    });

    expect(nextState).toEqual({
      9: {
        metricsDate: "2026-04-04",
        metricType: "distance_meters",
        lastMetricValue: 1800,
        progressValue: 5800,
      },
    });
  });

  it("schedules an immediate near-term refresh when expired missions are still visible past the dashboard cleanup window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T03:10:00.000Z"));

    const delay = resolveExpiredMissionRefreshDelay([
      buildMission({
        id: 33,
        type: "daily",
        status: "expired",
        updated_at: "2026-04-06T03:04:30.000Z",
      }),
    ]);

    expect(delay).toBe(0);

    vi.useRealTimers();
  });

  it("does not schedule the aggressive expired-mission refresh while the cleanup window has not elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T03:10:00.000Z"));

    const delay = resolveExpiredMissionRefreshDelay([
      buildMission({
        id: 34,
        type: "daily",
        status: "expired",
        updated_at: "2026-04-06T03:09:30.000Z",
      }),
    ]);

    expect(delay).toBe(270_000);

    vi.useRealTimers();
  });

  it("applies the same five-minute cleanup window to expired weekly missions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T03:40:00.000Z"));

    const delay = resolveExpiredMissionRefreshDelay([
      buildMission({
        id: 35,
        type: "weekly",
        status: "expired",
        updated_at: "2026-04-06T03:31:15.000Z",
      }),
    ]);

    expect(delay).toBe(0);
 
    vi.useRealTimers();
  });

  it("applies the same five-minute cleanup window to expired monthly missions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T03:40:00.000Z"));

    const delay = resolveExpiredMissionRefreshDelay([
      buildMission({
        id: 36,
        type: "monthly",
        status: "expired",
        updated_at: "2026-04-06T03:36:00.000Z",
      }),
    ]);

    expect(delay).toBe(60_000);

    vi.useRealTimers();
  });

  it("derives local date keys from timestamps instead of trusting the UTC date fragment", () => {
    const timestamp = "2026-04-09T00:01:55.309Z";

    expect(extractDateKey(timestamp)).toBe(formatDateKey(new Date(timestamp)));
  });

  it("forces a refresh when cached pending missions belong to the previous daily cycle", () => {
    const shouldRefresh = cachedMissionListNeedsCycleRefresh(
      [
        buildMission({
          id: 40,
          type: "daily",
          cycle_date: "2026-04-06",
          status: "pending",
        }),
        buildMission({
          id: 41,
          type: "weekly",
          cycle_date: "2026-04-06",
          status: "pending",
        }),
        buildMission({
          id: 42,
          type: "monthly",
          cycle_date: "2026-04-01",
          status: "pending",
        }),
      ],
      new Date("2026-04-07T06:00:00.000Z"),
    );

    expect(shouldRefresh).toBe(true);
  });

  it("keeps the cached missions when all pending mission cycles match the current local cycle", () => {
    const shouldRefresh = cachedMissionListNeedsCycleRefresh(
      [
        buildMission({
          id: 43,
          type: "daily",
          cycle_date: "2026-04-07",
          status: "pending",
        }),
        buildMission({
          id: 44,
          type: "weekly",
          cycle_date: "2026-04-06",
          status: "pending",
        }),
        buildMission({
          id: 45,
          type: "monthly",
          cycle_date: "2026-04-01",
          status: "pending",
        }),
      ],
      new Date("2026-04-07T06:00:00.000Z"),
    );

    expect(shouldRefresh).toBe(false);
  });
});
