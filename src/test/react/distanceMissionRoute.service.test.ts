import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mission } from "../../shared/types";

const {
  initialize,
  getDirections,
  calculateDistance,
  getCurrentLocation,
  getRuntimeState,
  getStaticImage,
} = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  getDirections: vi.fn(async (start: [number, number], end: [number, number]) => ({
    distance: 600,
    duration: 420,
    geometry: [start, end] as [number, number][],
    provider: "openrouteservice" as const,
    usedFallbackRoute: false,
  })),
  calculateDistance: vi.fn((start: [number, number], end: [number, number]) => {
    const deltaLongitude = Math.abs(end[0] - start[0]);
    const deltaLatitude = Math.abs(end[1] - start[1]);
    return Math.round((deltaLongitude + deltaLatitude) * 100_000);
  }),
  getCurrentLocation: vi.fn(async () => ({
    latitude: -23.5505,
    longitude: -46.6333,
    accuracyMeters: 8,
    precision: "precise" as const,
    timestamp: new Date().toISOString(),
    source: "android-native" as const,
  })),
  getRuntimeState: vi.fn(() => ({
    location: null,
  })),
  getStaticImage: vi.fn(async () => "data:image/svg+xml;base64,preview"),
}));

vi.mock("../../react-app/services/openStreetMapService", () => ({
  openStreetMapService: {
    initialize,
    getDirections,
    calculateDistance,
    getStaticImage,
  },
}));

vi.mock("../../react-app/services/runtime/locationRuntimeService", () => ({
  locationRuntimeService: {
    getCurrentLocation,
    getState: getRuntimeState,
  },
}));

import {
  buildDistanceMissionSessionRoutePreview,
  calculateDistanceToRouteMeters,
  clearDistanceMissionRoutePreviewCache,
  getDistanceMissionRoutePreview,
} from "../../react-app/services/distanceMissionRoute";

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
  metric_value: 1200,
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
  goal: "Percorra 1200 m",
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

describe("distanceMissionRoute service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDistanceMissionRoutePreviewCache();
    getRuntimeState.mockReturnValue({
      location: null,
    });
  });

  it("builds a real two-leg round trip that returns to the session origin", async () => {
    const preview = await buildDistanceMissionSessionRoutePreview(distanceMission, {
      origin: {
        latitude: -23.5505,
        longitude: -46.6333,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: new Date().toISOString(),
        source: "android-native",
      },
      returnOrigin: [-46.6333, -23.5505],
      targetDistanceMeters: 1200,
    });

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(getDirections).toHaveBeenCalledTimes(2);
    expect(preview.origin).toEqual([-46.6333, -23.5505]);
    expect(preview.returnOrigin).toEqual([-46.6333, -23.5505]);
    expect(preview.coordinates[0]).toEqual([-46.6333, -23.5505]);
    expect(preview.coordinates[preview.coordinates.length - 1]).toEqual([-46.6333, -23.5505]);
    expect(preview.routeMode).toBe("round_trip");
    expect(preview.staticMapUrl).toBe("data:image/svg+xml;base64,preview");
  });

  it("switches to direct return mode when the remaining distance is close to the way home", async () => {
    const preview = await buildDistanceMissionSessionRoutePreview(distanceMission, {
      origin: {
        latitude: -23.5465,
        longitude: -46.6293,
        accuracyMeters: 8,
        precision: "precise",
        timestamp: new Date().toISOString(),
        source: "android-native",
      },
      returnOrigin: [-46.6333, -23.5505],
      targetDistanceMeters: 820,
    });

    expect(getDirections).toHaveBeenCalledTimes(1);
    expect(preview.routeMode).toBe("return_to_origin");
    expect(preview.coordinates[preview.coordinates.length - 1]).toEqual([-46.6333, -23.5505]);
  });

  it("computes the distance from a live point to the current route polyline", () => {
    const distance = calculateDistanceToRouteMeters(
      [-46.6328, -23.5499],
      [
        [-46.6333, -23.5505],
        [-46.6323, -23.5495],
        [-46.6318, -23.549],
      ],
    );

    expect(distance).toBeGreaterThanOrEqual(0);
    expect(distance).toBeLessThan(120);
  });

  it("reuses a fresh runtime location for preview generation before requesting a new GPS fix", async () => {
    getRuntimeState.mockReturnValue({
      location: {
        latitude: -23.5505,
        longitude: -46.6333,
        accuracyMeters: 12,
        precision: "precise" as const,
        timestamp: new Date().toISOString(),
        source: "android-native" as const,
      },
    });

    const preview = await getDistanceMissionRoutePreview(distanceMission);

    expect(preview.origin).toEqual([-46.6333, -23.5505]);
    expect(getCurrentLocation).not.toHaveBeenCalled();
    expect(getDirections).toHaveBeenCalledTimes(2);
    expect(getStaticImage).toHaveBeenCalledTimes(1);
  });
});
