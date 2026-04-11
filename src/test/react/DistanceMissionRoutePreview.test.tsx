import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Mission } from "../../shared/types";

const previewState = vi.hoisted(() => ({
  preview: {
    missionId: 22,
    targetDistanceMeters: 3200,
    routeDistanceMeters: 3400,
    minimumDurationSeconds: 1800,
    origin: [-46.6333, -23.5505] as [number, number],
    returnOrigin: [-46.6333, -23.5505] as [number, number],
    checkpoint: [-46.62, -23.56] as [number, number],
    coordinates: [
      [-46.6333, -23.5505],
      [-46.628, -23.555],
      [-46.62, -23.56],
      [-46.628, -23.555],
      [-46.6333, -23.5505],
    ] as [number, number][],
    center: [-46.626, -23.555] as [number, number],
    zoom: 14,
    staticMapUrl: null,
    locationPrecision: "precise" as const,
    generatedAt: "2026-04-05T12:00:00.000Z",
    usedFallbackRoute: false,
  },
  loading: false,
  error: null as string | null,
}));

vi.mock("../../react-app/hooks/useDistanceMissionRoutePreview", () => ({
  __esModule: true,
  default: () => ({
    preview: previewState.preview,
    loading: previewState.loading,
    error: previewState.error,
    loadPreview: vi.fn(),
    showPassivePlaceholder: false,
    locationPrecision: "precise",
  }),
}));

vi.mock("../../react-app/components/mission-card/RouteMissionLeafletMap", () => ({
  __esModule: true,
  default: ({ variant }: { variant: string }) => (
    <div data-testid="route-leaflet-map">{variant}</div>
  ),
}));

import DistanceMissionRoutePreview from "../../react-app/components/mission-card/DistanceMissionRoutePreview";

const routeMission: Mission = {
  id: 22,
  user_id: "user-1",
  type: "daily",
  title: "Corrida leve",
  description: "Mantenha o ritmo ate concluir a rota.",
  skill_id: null,
  target_reps: null,
  target_time: null,
  metric_type: "distance_meters",
  metric_value: 3200,
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
  exercise_name: "Corrida leve",
  exercise_equipment: null,
  exercise_body_part: null,
  exercise_target: null,
  exercise_type: "conditioning",
  body_area: "lower",
  attributes_benefited: [],
  duration_estimate_minutes: 30,
  exercise_category: "run",
  execution_mode: "route_tracking",
  activity_kind: "running",
  mission_origin: "regular",
  goal: "Percorra 3,2 km",
  is_ai_special: 0,
  circuit_tasks: [],
  safety_tips: [],
  difficulty_level: "intermediario",
  video_url: null,
  thumbnail_url: null,
  cycle_date: "2026-04-05",
  xp_reward: 50,
  points_reward: 10,
  deadline: null,
  is_completed: 0,
  completed_at: null,
  verified_by_sensor: 0,
  status: "pending",
  created_at: "2026-04-05T10:00:00.000Z",
  updated_at: "2026-04-05T10:00:00.000Z",
};

describe("DistanceMissionRoutePreview", () => {
  beforeEach(() => {
    previewState.loading = false;
    previewState.error = null;
  });

  it("uses the interactive map layer for detail variants", () => {
    render(
      <DistanceMissionRoutePreview
        mission={routeMission}
        variant="details"
      />,
    );

    expect(screen.getByTestId("route-leaflet-map")).toHaveTextContent("details");
  });

  it("keeps the cached preview visible while an execution override is still loading", () => {
    render(
      <DistanceMissionRoutePreview
        mission={routeMission}
        variant="execution"
        routeStateOverride={{
          preview: null,
          loading: true,
          error: null,
        }}
      />,
    );

    expect(screen.getByTestId("route-leaflet-map")).toHaveTextContent("execution");
    expect(screen.queryByText(/Carregando rota sugerida/i)).not.toBeInTheDocument();
  });

  it("keeps the lightweight preview path for the compact card variant", () => {
    render(
      <DistanceMissionRoutePreview
        mission={routeMission}
        variant="card"
      />,
    );

    expect(screen.queryByTestId("route-leaflet-map")).not.toBeInTheDocument();
    expect(screen.getByText(/Rota sugerida/i)).toBeInTheDocument();
  });
});
