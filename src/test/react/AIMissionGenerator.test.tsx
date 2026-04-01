import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AIMissionGenerator from "../../react-app/components/AIMissionGenerator";
import type { Mission } from "../../shared/types";

const apiMock = vi.fn();
const clearJsonCache = vi.fn();
const writeCachedJson = vi.fn();

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
  clearJsonCache: (...args: Parameters<typeof clearJsonCache>) => clearJsonCache(...args),
  writeCachedJson: (...args: Parameters<typeof writeCachedJson>) => writeCachedJson(...args),
}));

describe("AIMissionGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates the dashboard from the generation payload when active missions already exist", async () => {
    const user = userEvent.setup();
    const onMissionsGenerated = vi.fn();
    const generatedMissions: Mission[] = [
      {
        id: 101,
        user_id: "user-1",
        type: "daily",
        title: "Agachamento livre",
        description: "",
        skill_id: null,
        target_reps: 30,
        target_time: null,
        metric_type: "sets_reps",
        metric_value: 30,
        progress_value: 0,
        metric_unit: "repeticoes",
        sets: 3,
        rest_seconds: 60,
        instructions: [],
        safety_tips: [],
        video_url: null,
        exercise_instructions_en: [],
        exercise_instructions_pt: [],
        image_url: null,
        exercise_db_id: "QChZi3x",
        exercise_db_gif_url: null,
        exercise_db_image_url: null,
        muscle_groups: [],
        exercise_secondary_muscles: [],
        exercise_name: "Agachamento livre",
        exercise_equipment: null,
        exercise_body_part: null,
        exercise_target: null,
        exercise_type: "forca",
        body_area: "lower",
        duration_estimate_minutes: 8,
        exercise_category: "strength",
        mission_origin: "regular",
        goal: null,
        is_ai_special: 0,
        circuit_tasks: [],
        difficulty_level: "Iniciante",
        thumbnail_url: null,
        xp_reward: 80,
        points_reward: 20,
        deadline: "2026-04-02T00:00:00.000Z",
        is_completed: 0,
        completed_at: null,
        verified_by_sensor: 0,
        status: "pending",
        created_at: "2026-04-01 04:15:31",
        updated_at: "2026-04-01 04:15:31",
      },
    ];

    apiMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            generated: false,
            missions: generatedMissions,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    render(<AIMissionGenerator onMissionsGenerated={onMissionsGenerated} />);

    await user.click(screen.getByRole("button", { name: /Gerar Miss/i }));

    await waitFor(() => {
      expect(writeCachedJson).toHaveBeenCalledWith("/api/missions", generatedMissions);
    });

    expect(onMissionsGenerated).toHaveBeenCalledWith(generatedMissions);
    expect(clearJsonCache).not.toHaveBeenCalledWith("/api/missions");
    expect(
      screen.getByText(/dashboard foi sincronizado/i),
    ).toBeInTheDocument();
  });
});
