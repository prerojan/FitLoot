import { describe, expect, it } from "vitest";

import { createMissionPresentationService } from "../../worker/services/missionPresentation";

describe("missionPresentation", () => {
  it("keeps exercise_db_id in mission summary payload", () => {
    const service = createMissionPresentationService({
      extractExerciseName: (title) => title,
    });

    const summary = service.missionSummaryFromNormalized({
      id: 1,
      user_id: "user-1",
      type: "daily",
      title: "Agachamento livre",
      description: "Descricao",
      skill_id: null,
      target_reps: 10,
      target_time: null,
      metric_type: "repetitions",
      metric_value: 10,
      progress_value: 0,
      metric_unit: "reps",
      sets: 1,
      rest_seconds: 30,
      instructions: [],
      safety_tips: [],
      video_url: null,
      exercise_instructions_en: [],
      exercise_instructions_pt: [],
      image_url: null,
      exercise_db_id: "bJYHBIN",
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
      duration_estimate_minutes: 10,
      exercise_category: "forca",
      mission_origin: "regular",
      goal: null,
      is_ai_special: 0,
      circuit_tasks: [],
      difficulty_level: "iniciante",
      thumbnail_url: null,
      xp_reward: 50,
      points_reward: 10,
      deadline: null,
      is_completed: 0,
      completed_at: null,
      verified_by_sensor: 0,
      status: "pending",
      created_at: "2026-03-31T00:00:00.000Z",
      updated_at: "2026-03-31T00:00:00.000Z",
      attributes_benefited: [],
    } as never);

    expect(summary.exercise_db_id).toBe("bJYHBIN");
  });

  it("fills exercise_db_id from supported exercise name when legacy row is missing id", () => {
    const service = createMissionPresentationService({
      extractExerciseName: (title) => title,
    });

    const normalized = service.normalizeMissionRow({
      id: 2,
      user_id: "user-2",
      type: "daily",
      title: "Missao diaria: Agachamento livre",
      description: "Descricao",
      skill_id: null,
      target_reps: 12,
      target_time: null,
      metric_type: "sets_reps",
      metric_value: 12,
      metric_unit: "reps",
      sets: 3,
      rest_seconds: 45,
      instructions_json: "[]",
      exercise_instructions_en_json: "[]",
      exercise_instructions_pt_json: "[]",
      muscle_groups_json: "[]",
      exercise_secondary_muscles_json: "[]",
      attributes_benefited_json: "[]",
      safety_tips_json: "[]",
      circuit_tasks_json: "[]",
      exercise_name: "Agachamento livre",
      exercise_db_id: null,
      exercise_db_gif_url: null,
      exercise_db_image_url: null,
      image_url: null,
      video_url: null,
      thumbnail_url: null,
      exercise_equipment: null,
      exercise_body_part: null,
      exercise_target: null,
      exercise_type: "strength",
      body_area: "lower",
      duration_estimate_minutes: 10,
      exercise_category: "forca",
      difficulty_level: "iniciante",
      mission_origin: "regular",
      goal: null,
      is_ai_special: 0,
      progress_value: 0,
      xp_reward: 30,
      points_reward: 10,
      deadline: null,
      is_completed: 0,
      completed_at: null,
      verified_by_sensor: 0,
      status: "pending",
      created_at: "2026-03-31T00:00:00.000Z",
      updated_at: "2026-03-31T00:00:00.000Z",
    });

    expect(normalized.exercise_db_id).toBe("QChZi3x");
  });

  it("recomputes route mission duration and infers route tracking from walking missions", () => {
    const service = createMissionPresentationService({
      extractExerciseName: (title) => title,
    });

    const normalized = service.normalizeMissionRow({
      id: 3,
      user_id: "user-3",
      type: "daily",
      title: "Missao Diaria: Caminhada ativa",
      description: "Descricao",
      skill_id: null,
      target_reps: null,
      target_time: null,
      metric_type: "distance_meters",
      metric_value: 1476,
      metric_unit: "m",
      sets: null,
      rest_seconds: null,
      instructions_json: "[]",
      exercise_instructions_en_json: "[]",
      exercise_instructions_pt_json: "[]",
      muscle_groups_json: "[]",
      exercise_secondary_muscles_json: "[]",
      attributes_benefited_json: "[]",
      safety_tips_json: "[]",
      circuit_tasks_json: "[]",
      exercise_name: null,
      exercise_db_id: null,
      exercise_db_gif_url: null,
      exercise_db_image_url: null,
      image_url: null,
      video_url: null,
      thumbnail_url: null,
      exercise_equipment: null,
      exercise_body_part: null,
      exercise_target: null,
      exercise_type: "cardio",
      body_area: "lower",
      duration_estimate_minutes: 369,
      exercise_category: "cardio",
      difficulty_level: "iniciante",
      mission_origin: "regular",
      goal: "Acumule 1.5 km de caminhada no percurso.",
      is_ai_special: 0,
      progress_value: 0,
      xp_reward: 30,
      points_reward: 10,
      deadline: null,
      is_completed: 0,
      completed_at: null,
      verified_by_sensor: 0,
      status: "pending",
      created_at: "2026-04-08T03:17:02.330Z",
      updated_at: "2026-04-08T03:17:02.330Z",
    });

    expect(normalized.execution_mode).toBe("route_tracking");
    expect(normalized.activity_kind).toBe("walking");
    expect(normalized.duration_estimate_minutes).toBe(18);
  });
});
