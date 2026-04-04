import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mission } from "../../shared/types";

type MockRuntimeLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  precision: "precise" | "approximate";
  timestamp: string;
  source: "android-native" | "browser";
};

type MockRuntimeState = {
  location: MockRuntimeLocation | null;
  permission: {
    permission: "granted" | "denied" | "prompt";
    precision: "precise" | "approximate" | "unavailable";
    granted: boolean;
  };
  tracking: boolean;
  error: string | null;
};

const {
  runtimeListeners,
  startForegroundLocationTracking,
  stopForegroundLocationTracking,
  getCurrentLocation,
} = vi.hoisted(() => ({
  runtimeListeners: new Set<(state: MockRuntimeState) => void>(),
  startForegroundLocationTracking: vi.fn(async () => undefined),
  stopForegroundLocationTracking: vi.fn(() => undefined),
  getCurrentLocation: vi.fn(async () => ({
    latitude: -23.5505,
    longitude: -46.6333,
    accuracyMeters: 8,
    precision: "precise" as const,
    timestamp: "2026-03-30T12:00:00.000Z",
    source: "android-native" as const,
  })),
}));

let mockHealthHookReturn = {
  healthData: {
    steps: 0,
    calories: 0,
    distance: 0,
    activeMinutes: 0,
    lastUpdated: "2026-03-30T12:00:00.000Z",
    source: "health_connect",
    confidence: "official",
    caloriesSource: "device",
  },
  isAuthenticated: true,
};

let runtimeState: MockRuntimeState = {
  location: {
    latitude: -23.5505,
    longitude: -46.6333,
    accuracyMeters: 8,
    precision: "precise",
    timestamp: "2026-03-30T12:00:00.000Z",
    source: "android-native",
  },
  permission: {
    permission: "granted",
    precision: "precise",
    granted: true,
  },
  tracking: false,
  error: null,
};

function emitRuntimeLocation(location: MockRuntimeLocation) {
  runtimeState = {
    ...runtimeState,
    location,
  };
  runtimeListeners.forEach((listener) => listener(runtimeState));
}

vi.mock("../../react-app/hooks/useHealthData", () => ({
  useHealthData: () => mockHealthHookReturn,
}));

vi.mock("../../react-app/services/runtime/locationRuntimeService", () => ({
  locationRuntimeService: {
    getState: () => runtimeState,
    subscribe: (listener: (state: MockRuntimeState) => void) => {
      runtimeListeners.add(listener);
      listener(runtimeState);
      return () => runtimeListeners.delete(listener);
    },
    getCurrentLocation,
    startForegroundLocationTracking,
    stopForegroundLocationTracking,
  },
}));

import useWalkingMission from "../../react-app/hooks/useWalkingMission";

const stepMission: Mission = {
  id: 7,
  user_id: "user-1",
  type: "daily",
  title: "Caminhada diaria",
  description: "Teste",
  skill_id: null,
  target_reps: null,
  target_time: null,
  metric_type: "steps",
  metric_value: 5000,
  progress_value: 0,
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
  body_area: "full_body",
  attributes_benefited: [],
  duration_estimate_minutes: 30,
  exercise_category: "cardio",
  mission_origin: "regular",
  goal: "andar",
  is_ai_special: 0,
  circuit_tasks: [],
  safety_tips: [],
  difficulty_level: "iniciante",
  video_url: null,
  thumbnail_url: null,
  xp_reward: 50,
  points_reward: 10,
  deadline: null,
  is_completed: 0,
  completed_at: null,
  verified_by_sensor: 0,
  status: "pending",
  created_at: "2026-03-30T12:00:00.000Z",
  updated_at: "2026-03-30T12:00:00.000Z",
};

const distanceMission: Mission = {
  ...stepMission,
  id: 11,
  title: "Corrida curta",
  metric_type: "distance_meters",
  metric_value: 600,
  metric_unit: "m",
  goal: "Percorra 600 m",
};

describe("useWalkingMission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeListeners.clear();
    runtimeState = {
      location: {
        latitude: -23.5505,
        longitude: -46.6333,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: "2026-03-30T12:00:00.000Z",
        source: "android-native",
      },
      permission: {
        permission: "granted",
        precision: "precise",
        granted: true,
      },
      tracking: false,
      error: null,
    };
    mockHealthHookReturn = {
      healthData: {
        steps: 0,
        calories: 0,
        distance: 0,
        activeMinutes: 0,
        lastUpdated: "2026-03-30T12:00:00.000Z",
        source: "health_connect",
        confidence: "official",
        caloriesSource: "device",
      },
      isAuthenticated: true,
    };
  });

  it("starts the step mission and completes when the target is reached", async () => {
    const onComplete = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(
      (props: { mission: Mission; onComplete: typeof onComplete }) =>
        useWalkingMission({ ...props, autoRefresh: false }),
      {
        initialProps: { mission: stepMission, onComplete },
      },
    );

    await act(async () => {
      await result.current.startExecution();
    });

    expect(result.current.state.isRunning).toBe(true);
    expect(startForegroundLocationTracking).toHaveBeenCalledTimes(1);

    mockHealthHookReturn = {
      ...mockHealthHookReturn,
      healthData: {
        ...mockHealthHookReturn.healthData,
        steps: 5200,
        calories: 140,
        distance: 3.7,
        lastUpdated: "2026-03-30T12:05:00.000Z",
      },
    };

    rerender({ mission: stepMission, onComplete });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(7, 5200, true);
    });

    expect(stopForegroundLocationTracking).toHaveBeenCalled();
  });

  it("tracks only the distance accumulated after the session starts", async () => {
    const onComplete = vi.fn(async () => undefined);
    mockHealthHookReturn = {
      ...mockHealthHookReturn,
      healthData: {
        ...mockHealthHookReturn.healthData,
        steps: 2000,
        calories: 180,
        distance: 1.4,
      },
    };

    const { result, rerender } = renderHook(
      (props: { mission: Mission; onComplete: typeof onComplete }) =>
        useWalkingMission({ ...props, autoRefresh: false }),
      {
        initialProps: { mission: distanceMission, onComplete },
      },
    );

    await act(async () => {
      await result.current.startExecution();
    });

    expect(result.current.state.currentDistance).toBe(0);
    expect(result.current.state.currentSteps).toBe(0);
    expect(result.current.state.currentCalories).toBe(0);

    mockHealthHookReturn = {
      ...mockHealthHookReturn,
      healthData: {
        ...mockHealthHookReturn.healthData,
        steps: 2450,
        calories: 225,
        distance: 2.2,
      },
    };

    rerender({ mission: distanceMission, onComplete });

    await waitFor(() => {
      expect(result.current.state.currentSteps).toBe(450);
      expect(result.current.state.currentCalories).toBe(45);
      expect(result.current.state.currentDistance).toBe(0);
    });

    act(() => {
      emitRuntimeLocation({
        latitude: -23.5486,
        longitude: -46.6333,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: "2026-03-30T12:01:00.000Z",
        source: "android-native",
      });
      emitRuntimeLocation({
        latitude: -23.5467,
        longitude: -46.6333,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: "2026-03-30T12:02:00.000Z",
        source: "android-native",
      });
      emitRuntimeLocation({
        latitude: -23.5448,
        longitude: -46.6333,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: "2026-03-30T12:03:00.000Z",
        source: "android-native",
      });
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    const completionValue = onComplete.mock.calls[0]?.[1];
    expect(completionValue).toBeGreaterThanOrEqual(600);
    expect(completionValue).toBeLessThan(900);
  });
});
