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
  buildDistanceMissionSessionRoutePreview,
  calculateDistanceToRouteMeters,
} = vi.hoisted(() => ({
  runtimeListeners: new Set<(state: MockRuntimeState) => void>(),
  startForegroundLocationTracking: vi.fn(async () => undefined),
  stopForegroundLocationTracking: vi.fn(() => undefined),
  getCurrentLocation: vi.fn(async () => ({
    latitude: -23.5505,
    longitude: -46.6333,
    accuracyMeters: 8,
    precision: "precise" as const,
    timestamp: new Date().toISOString(),
    source: "android-native" as const,
  })),
  buildDistanceMissionSessionRoutePreview: vi.fn(async (_mission: Mission, options: {
    origin: MockRuntimeLocation;
    returnOrigin?: [number, number];
    targetDistanceMeters?: number;
  }) => ({
    missionId: 11,
    targetDistanceMeters: options.targetDistanceMeters ?? 900,
    routeDistanceMeters: options.targetDistanceMeters ?? 900,
    minimumDurationSeconds: 600,
    origin: [options.origin.longitude, options.origin.latitude] as [number, number],
    returnOrigin: options.returnOrigin ?? [options.origin.longitude, options.origin.latitude] as [number, number],
    checkpoint: [-46.632, -23.548] as [number, number],
    coordinates: [
      [options.origin.longitude, options.origin.latitude],
      [-46.632, -23.548],
      options.returnOrigin ?? [options.origin.longitude, options.origin.latitude],
    ] as [number, number][],
    center: [-46.6325, -23.549] as [number, number],
    zoom: 15,
    staticMapUrl: null,
    locationPrecision: options.origin.precision,
    generatedAt: new Date().toISOString(),
    usedFallbackRoute: false,
    profile: "foot-walking" as const,
    routeMode: "round_trip" as const,
  })),
  calculateDistanceToRouteMeters: vi.fn(() => 0),
}));

let mockHealthHookReturn = {
  healthData: {
    steps: 0,
    calories: 0,
    distance: 0,
    activeMinutes: 0,
    lastUpdated: new Date().toISOString(),
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
    timestamp: new Date().toISOString(),
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

vi.mock("../../react-app/services/distanceMissionRoute", async () => {
  const actual = await vi.importActual<typeof import("../../react-app/services/distanceMissionRoute")>(
    "../../react-app/services/distanceMissionRoute",
  );

  return {
    ...actual,
    buildDistanceMissionSessionRoutePreview,
    calculateDistanceToRouteMeters,
    validateDistanceMissionStartLocation: () => null,
  };
});

import useWalkingMission from "../../react-app/hooks/useWalkingMission";

const distanceMission: Mission = {
  id: 11,
  user_id: "user-1",
  type: "daily",
  title: "Caminhada monitorada",
  description: "Teste",
  skill_id: null,
  target_reps: null,
  target_time: null,
  metric_type: "distance_meters",
  metric_value: 900,
  progress_value: 0,
  metric_unit: "m",
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
  goal: "Percorra 900 m",
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
  execution_mode: "route_tracking",
  activity_kind: "walking",
};

describe("useWalkingMission reroute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeListeners.clear();
    runtimeState = {
      location: {
        latitude: -23.5505,
        longitude: -46.6333,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: new Date().toISOString(),
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
        lastUpdated: new Date().toISOString(),
        source: "health_connect",
        confidence: "official",
        caloriesSource: "device",
      },
      isAuthenticated: true,
    };
    calculateDistanceToRouteMeters.mockReturnValue(0);
  });

  it("reroutes only after two off-route samples and respects cooldown", async () => {
    const onComplete = vi.fn(async () => undefined);
    const { result } = renderHook(() => useWalkingMission({
      mission: distanceMission,
      onComplete,
      autoRefresh: false,
    }));

    await act(async () => {
      await result.current.startExecution();
    });

    await waitFor(() => {
      expect(buildDistanceMissionSessionRoutePreview).toHaveBeenCalledTimes(1);
    });

    calculateDistanceToRouteMeters.mockReturnValue(220);

    act(() => {
      emitRuntimeLocation({
        latitude: -23.5502,
        longitude: -46.633,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: new Date().toISOString(),
        source: "android-native",
      });
    });

    await waitFor(() => {
      expect(buildDistanceMissionSessionRoutePreview).toHaveBeenCalledTimes(1);
    });

    act(() => {
      emitRuntimeLocation({
        latitude: -23.5499,
        longitude: -46.6327,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: new Date().toISOString(),
        source: "android-native",
      });
    });

    await waitFor(() => {
      expect(buildDistanceMissionSessionRoutePreview).toHaveBeenCalledTimes(2);
    });

    act(() => {
      emitRuntimeLocation({
        latitude: -23.5496,
        longitude: -46.6324,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: new Date().toISOString(),
        source: "android-native",
      });
    });

    await waitFor(() => {
      expect(buildDistanceMissionSessionRoutePreview).toHaveBeenCalledTimes(2);
    });
  });
});
