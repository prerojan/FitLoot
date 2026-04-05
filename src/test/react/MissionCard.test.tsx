import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mission } from "../../shared/types";

const { apiMock, chromeState } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  chromeState: {
    setMissionDetailsOpen: vi.fn(),
    setMissionExecutionOpen: vi.fn(),
  },
}));

vi.mock("../../react-app/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../react-app/utils/api")>();
  return {
    ...actual,
    api: apiMock,
  };
});

vi.mock("../../react-app/contexts/appChrome", () => ({
  useAppChrome: () => chromeState,
}));

vi.mock("../../react-app/components/mission-card/DistanceMissionRoutePreview", () => ({
  default: ({ mission }: { mission: Mission }) => (
    <div data-testid="distance-route-preview">Rota {mission.id}</div>
  ),
}));

import MissionCard from "../../react-app/components/MissionCard";

const mission: Mission = {
  id: 10,
  user_id: "user-1",
  type: "daily",
  title: "Flexoes do dia",
  description: "Complete sua serie",
  skill_id: null,
  target_reps: 20,
  target_time: null,
  metric_type: "repetitions",
  metric_value: 20,
  progress_value: 0,
  metric_unit: "reps",
  sets: 1,
  rest_seconds: 30,
  instructions: [],
  exercise_instructions_en: [],
  exercise_instructions_pt: [],
  image_url: null,
  exercise_db_id: null,
  exercise_db_gif_url: null,
  exercise_db_image_url: null,
  muscle_groups: [],
  exercise_secondary_muscles: [],
  exercise_name: "Flexao",
  exercise_equipment: null,
  exercise_body_part: null,
  exercise_target: null,
  exercise_type: "strength",
  body_area: "upper",
  attributes_benefited: [],
  duration_estimate_minutes: 10,
  exercise_category: "forca",
  execution_mode: "standard",
  activity_kind: null,
  mission_origin: "regular",
  goal: "Forca",
  is_ai_special: 0,
  circuit_tasks: [],
  safety_tips: [],
  difficulty_level: "iniciante",
  video_url: null,
  thumbnail_url: null,
  xp_reward: 40,
  points_reward: 10,
  deadline: null,
  is_completed: 0,
  completed_at: null,
  verified_by_sensor: 0,
  status: "pending",
  created_at: "2026-03-30T12:00:00.000Z",
  updated_at: "2026-03-30T12:00:00.000Z",
};

describe("MissionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mission,
        instructions: ["Desca controlando o movimento"],
        exercise_instructions_pt: ["Mantenha o tronco firme"],
        muscle_groups: ["peito"],
        safety_tips: ["Nao arqueie a lombar"],
      }),
    });
  });

  it("opens the details modal from the default card CTA", async () => {
    const user = userEvent.setup();

    render(
      <MissionCard
        mission={mission}
        onComplete={vi.fn(async () => undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Ver detalhes/i }));

    await waitFor(() => {
      expect(screen.getByText(/Detalhes da Miss/i)).toBeInTheDocument();
    });

    expect(apiMock).toHaveBeenCalledWith("/api/missions/10");
    expect(chromeState.setMissionDetailsOpen).toHaveBeenCalledWith(true);
  });

  it("renders the distance route preview instead of regular media for distance missions", () => {
    render(
      <MissionCard
        mission={{
          ...mission,
          id: 22,
          title: "Corrida leve",
          metric_type: "distance_meters",
          metric_value: 3200,
          metric_unit: "m",
          goal: "Percorra 3,2 km",
          exercise_category: "run",
          execution_mode: "route_tracking",
          activity_kind: "running",
        }}
        onComplete={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByTestId("distance-route-preview")).toHaveTextContent("Rota 22");
  });

  it("keeps walking lunge as a standard mission without route preview", () => {
    render(
      <MissionCard
        mission={{
          ...mission,
          id: 23,
          title: "Walking Lunge",
          exercise_name: "Walking Lunge",
          metric_type: "sets_reps",
          metric_value: 24,
          exercise_category: "strength",
          execution_mode: "standard",
          activity_kind: null,
        }}
        onComplete={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.queryByTestId("distance-route-preview")).not.toBeInTheDocument();
  });
});
