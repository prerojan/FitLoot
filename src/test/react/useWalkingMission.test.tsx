import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mission } from "../../shared/types";

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

const addMarker = vi.fn();
const clearMarkers = vi.fn();
const getCurrentLocation = vi.fn(async () => [-46.6333, -23.5505] as [number, number]);
const getDirections = vi.fn(async () => ({
  distance: 3500,
  duration: 2100,
  coordinates: [[-46.6333, -23.5505], [-46.65, -23.58]] as [number, number][],
}));

vi.mock("../../react-app/hooks/useHealthData", () => ({
  useHealthData: () => mockHealthHookReturn,
}));

vi.mock("../../react-app/hooks/useMapService", () => ({
  useMapService: () => ({
    getCurrentLocation,
    getDirections,
    addMarker,
    clearMarkers,
    userLocation: [-46.6333, -23.5505] as [number, number],
  }),
}));

import useWalkingMission from "../../react-app/hooks/useWalkingMission";

const mission: Mission = {
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

describe("useWalkingMission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("starts the walking mission, creates markers, and completes when the target is reached", async () => {
    const onComplete = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(
      (props: { mission: Mission; onComplete: typeof onComplete }) =>
        useWalkingMission({ ...props, autoRefresh: false }),
      {
        initialProps: { mission, onComplete },
      },
    );

    await act(async () => {
      await result.current.startExecution();
    });

    expect(result.current.state.isRunning).toBe(true);
    expect(addMarker).toHaveBeenCalledTimes(2);
    expect(getDirections).toHaveBeenCalledTimes(1);

    mockHealthHookReturn = {
      ...mockHealthHookReturn,
      healthData: {
        ...mockHealthHookReturn.healthData,
        steps: 5200,
        distance: 3.7,
        lastUpdated: "2026-03-30T12:05:00.000Z",
      },
    };

    rerender({ mission, onComplete });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(7, 5200, true);
    });

    expect(result.current.state.isCompleted).toBe(true);
  });
});
