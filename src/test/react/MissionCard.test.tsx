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

const { resolveDistanceMissionMinimumDurationSecondsMock } = vi.hoisted(() => ({
  resolveDistanceMissionMinimumDurationSecondsMock: vi.fn(() => 0),
}));

vi.mock("../../react-app/utils/api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../react-app/utils/api")>();
  return {
    ...actual,
    api: apiMock,
  };
});

vi.mock("../../react-app/contexts/appChrome", () => ({
  useAppChrome: () => chromeState,
}));

vi.mock(
  "../../react-app/components/mission-card/DistanceMissionRoutePreview",
  () => ({
    default: ({
      mission,
      children,
    }: {
      mission: Mission;
      children?: React.ReactNode;
    }) => (
      <div data-testid="distance-route-preview">
        Rota {mission.id}
        {children}
      </div>
    ),
  }),
);

vi.mock(
  "../../react-app/components/mission-card/MissionExecutionModal",
  () => ({
    MissionExecutionModal: () => null,
  }),
);

vi.mock("../../react-app/services/distanceMissionRoute", () => ({
  formatDistanceMissionAmount: (value: number) => `${value} m`,
  formatDistanceMissionDuration: (value: number) => `${value} s`,
  isDistanceRouteMission: (candidate: Mission) =>
    candidate.metric_type === "distance_meters",
  resolveDistanceMissionActivityLabel: () => "Caminhada",
  resolveDistanceMissionMinimumDurationSeconds:
    resolveDistanceMissionMinimumDurationSecondsMock,
  resolveDistanceMissionTargetMeters: (candidate: Mission) =>
    Number(candidate.metric_value ?? 0),
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
    resolveDistanceMissionMinimumDurationSecondsMock.mockReturnValue(0);
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

  it("keeps the highest live progress for periodic step missions when the detail payload is stale", async () => {
    const user = userEvent.setup();
    const monthlyMission = {
      ...mission,
      id: 31,
      type: "monthly",
      title: "Passos do mes",
      metric_type: "steps" as const,
      metric_value: 100000,
      metric_unit: "steps",
      goal: "100.000 passos acumulados",
      progress_value: 31342,
    };

    apiMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...monthlyMission,
        progress_value: 24000,
        instructions: ["Continue acumulando passos ao longo do mes"],
        exercise_instructions_pt: [
          "Continue acumulando passos ao longo do mes",
        ],
        muscle_groups: ["pernas"],
        safety_tips: ["Mantenha hidratacao regular"],
      }),
    });

    render(
      <MissionCard
        mission={monthlyMission}
        onComplete={vi.fn(async () => undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Ver detalhes/i }));

    await waitFor(() => {
      expect(screen.getByText(/Detalhes da Miss/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText("31.342/100.000 passos")).toHaveLength(2);
    expect(screen.queryByText("24.000/100.000 passos")).not.toBeInTheDocument();
  });

  it("keeps periodic step missions without duplicated goal copy and shows visible low progress", async () => {
    const user = userEvent.setup();
    const lowProgressMission = {
      ...mission,
      id: 41,
      type: "monthly",
      title: "Passos do ciclo",
      metric_type: "steps" as const,
      metric_value: 120000,
      metric_unit: "steps",
      goal: "120.000 passos acumulados",
      progress_value: 556,
    };

    apiMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...lowProgressMission,
        description: null,
        progress_value: 556,
        instructions: [],
        exercise_instructions_pt: [],
        muscle_groups: [],
        safety_tips: ["Mantenha hidratacao regular"],
      }),
    });

    render(
      <MissionCard
        mission={lowProgressMission}
        onComplete={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.queryByText(/passos acumulados/i)).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/Progresso atual <1%/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Ver detalhes/i }));

    await waitFor(() => {
      expect(screen.getByText(/Detalhes da Miss/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/passos acumulados/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dificuldade/i)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/Progresso atual <1%/i).length).toBe(2);
    expect(screen.getAllByText("556/120.000 passos")).toHaveLength(2);
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

    expect(screen.getByTestId("distance-route-preview")).toHaveTextContent(
      "Rota 22",
    );
  });

  it("opens the route mission details modal before execution", async () => {
    const user = userEvent.setup();

    render(
      <MissionCard
        mission={{
          ...mission,
          id: 24,
          title: "Corrida leve",
          description: "Mantenha o ritmo e conclua o percurso.",
          metric_type: "distance_meters",
          metric_value: 3200,
          metric_unit: "m",
          goal: "Percorra 3,2 km",
          exercise_name: "Corrida leve",
          exercise_category: "run",
          execution_mode: "route_tracking",
          activity_kind: "running",
        }}
        onComplete={vi.fn(async () => undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Ver detalhes/i }));

    await waitFor(() => {
      expect(screen.getByText(/Resumo da missao/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText(/^Diaria$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Recompensas/i)).toBeInTheDocument();
    expect(screen.queryByText(/Dificuldade/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Missao ativa/i)).not.toBeInTheDocument();
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

    expect(
      screen.queryByTestId("distance-route-preview"),
    ).not.toBeInTheDocument();
  });

  it("uses the route duration resolver instead of the stale stored duration for walking missions", async () => {
    const user = userEvent.setup();
    const walkingMission = {
      ...mission,
      id: 51,
      title: "Missao Diaria: Caminhada monitorada",
      metric_type: "distance_meters" as const,
      metric_value: 1500,
      metric_unit: "m",
      duration_estimate_minutes: 369,
      execution_mode: "route_tracking" as const,
      activity_kind: "walking" as const,
      body_area: "full_body" as const,
      exercise_type: "cardio",
      exercise_category: "walk",
    };

    resolveDistanceMissionMinimumDurationSecondsMock.mockReturnValue(1080);
    apiMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...walkingMission,
        duration_estimate_minutes: 18,
        instructions: [],
        exercise_instructions_pt: [],
        muscle_groups: [],
        safety_tips: ["Mantenha hidratacao regular"],
      }),
    });

    render(
      <MissionCard
        mission={walkingMission}
        onComplete={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getAllByText("1080 s").length).toBeGreaterThan(0);
    expect(screen.queryByText("369 min")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Ver detalhes/i }));

    await waitFor(() => {
      expect(screen.getByText(/Detalhes da Miss/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText("1080 s").length).toBeGreaterThan(0);
    expect(screen.queryByText("18 min")).not.toBeInTheDocument();
  });
});
