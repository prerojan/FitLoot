import { describe, expect, it } from "vitest";

import type { Mission } from "../../shared/types";
import {
  resolveMissionFocusLabels,
  resolveMissionMediaUrl,
} from "../../react-app/components/mission-card/helpers";

function buildMission(overrides?: Partial<Mission>): Mission {
  return {
    id: 99,
    user_id: "user-1",
    type: "daily",
    title: "Missao diaria: Agachamento livre",
    description: "Descricao",
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
    exercise_name: "Agachamento livre",
    exercise_equipment: null,
    exercise_body_part: null,
    exercise_target: null,
    exercise_type: "strength",
    body_area: "lower",
    attributes_benefited: [],
    duration_estimate_minutes: 10,
    exercise_category: "forca",
    mission_origin: "regular",
    goal: null,
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
    created_at: "2026-03-31T00:00:00.000Z",
    updated_at: "2026-03-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("missionCard helpers - resolveMissionMediaUrl", () => {
  it("prioritizes fallback by exercise_db_id when explicit media is missing", () => {
    const mission = buildMission({
      exercise_db_id: "bJYHBIN",
      exercise_name: null,
      image_url: null,
      exercise_db_gif_url: null,
      exercise_db_image_url: null,
      thumbnail_url: null,
      video_url: null,
    });

    expect(resolveMissionMediaUrl(mission)).toBe("https://static.exercisedb.dev/media/bJYHBIN.gif");
  });

  it("does not invent media for daily missions without exercise_db_id", () => {
    const mission = buildMission({
      exercise_db_id: null,
      exercise_name: "Cadeira isometrica",
      image_url: null,
      exercise_db_gif_url: null,
      exercise_db_image_url: null,
      thumbnail_url: null,
      video_url: null,
    });

    expect(resolveMissionMediaUrl(mission)).toBeNull();
  });

  it("ignores generic daily images when a canonical ExerciseDB id exists", () => {
    const mission = buildMission({
      exercise_db_id: "sVQCCeG",
      exercise_name: "Cadeira isometrica",
      image_url: "https://cdn.example.com/generic-wall-sit.png",
      exercise_db_gif_url: null,
      exercise_db_image_url: null,
      thumbnail_url: null,
      video_url: null,
    });

    expect(resolveMissionMediaUrl(mission)).toBe("https://static.exercisedb.dev/media/sVQCCeG.gif");
  });

  it("returns null when no ExerciseDB-backed media source is available", () => {
    const mission = buildMission({
      exercise_db_id: null,
      exercise_name: "Treino desconhecido",
      title: "Missao diaria: Treino desconhecido",
      description: "Sem catalogo",
      image_url: null,
      exercise_db_gif_url: null,
      exercise_db_image_url: null,
      thumbnail_url: null,
      video_url: null,
    });

    expect(resolveMissionMediaUrl(mission)).toBeNull();
  });
});

describe("missionCard helpers - resolveMissionFocusLabels", () => {
  it("prefers canonical ExerciseDB target muscles over generic mission payload labels", () => {
    const mission = buildMission({
      exercise_db_id: "QChZi3x",
      exercise_name: "Agachamento livre",
      exercise_target: "Core",
      muscle_groups: ["Corpo inteiro"],
      exercise_secondary_muscles: ["Push"],
      exercise_body_part: "Lower",
    });

    expect(resolveMissionFocusLabels(mission)).toEqual(["Gl\u00fateos", "Quadr\u00edceps", "Pernas"]);
  });

  it("uses the ExerciseDB-backed target even when the stored mission target is misleading", () => {
    const mission = buildMission({
      exercise_db_id: "I4hDWkc",
      exercise_name: "Flexao tradicional",
      exercise_target: "Parte superior",
      muscle_groups: ["Push", "Corpo inteiro"],
      exercise_secondary_muscles: ["Triceps"],
      exercise_body_part: "Chest",
    });

    expect(resolveMissionFocusLabels(mission)).toEqual(["Peitoral"]);
  });
});
