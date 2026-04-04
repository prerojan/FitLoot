import { describe, expect, it } from "vitest";

import type { Mission } from "../../shared/types";
import {
  arePersistentStepMissionProgressStatesEqual,
  buildStepMissionProgressSignature,
  createStepMissionSnapshot,
  reconcilePersistentStepMissionProgress,
} from "../../react-app/pages/dashboardUtils";

function buildMission(overrides?: Partial<Mission>): Mission {
  return {
    id: 1,
    user_id: "user-1",
    type: "monthly",
    title: "Passos do mes",
    description: "Acumule passos no ciclo atual",
    skill_id: null,
    target_reps: null,
    target_time: null,
    metric_type: "steps",
    metric_value: 100000,
    progress_value: 24000,
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
    body_area: "lower",
    attributes_benefited: [],
    duration_estimate_minutes: null,
    exercise_category: "cardio",
    mission_origin: "regular",
    goal: "Acumule passos no mes",
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
    created_at: "2026-04-04T00:00:00.000Z",
    updated_at: "2026-04-04T00:00:00.000Z",
    cycle_date: "2026-04-01",
    ...overrides,
  };
}

describe("dashboardUtils step mission helpers", () => {
  it("keeps the step-progress signature stable when the mission payload identity changes but progress does not", () => {
    const first = [buildMission()];
    const second = [buildMission({ title: "Passos do mes atualizado" })];

    expect(buildStepMissionProgressSignature(first)).toBe(
      buildStepMissionProgressSignature(second),
    );
  });

  it("captures only unfinished step missions in the live progress snapshot", () => {
    const missions = [
      buildMission({ id: 11, progress_value: 22000 }),
      buildMission({ id: 12, type: "weekly", progress_value: 8000 }),
      buildMission({ id: 13, metric_type: "repetitions", goal: "Forca", progress_value: 10 }),
      buildMission({ id: 14, is_completed: 1, progress_value: 99000 }),
    ];

    const signature = buildStepMissionProgressSignature(missions);
    const snapshot = createStepMissionSnapshot(missions, 7342, signature);

    expect(snapshot).toEqual({
      signature,
      stepsAtSnapshot: 7342,
      progressByMissionId: {
        11: 22000,
        12: 8000,
      },
    });
  });

  it("seeds persistent step mission progress by adding the current daily steps when the server has not updated today", () => {
    const nextState = reconcilePersistentStepMissionProgress({
      missions: [buildMission({ progress_value: 24000, updated_at: "2026-04-03T22:00:00.000Z" })],
      metricsDate: "2026-04-04",
      stepsValue: 7342,
      state: {},
    });

    expect(nextState).toEqual({
      1: {
        metricsDate: "2026-04-04",
        lastDailySteps: 7342,
        progressValue: 31342,
      },
    });
  });

  it("keeps accumulated mission progress across the daily metrics rollover and only adds the new day's steps", () => {
    const previousState = {
      1: {
        metricsDate: "2026-04-04",
        lastDailySteps: 7342,
        progressValue: 31342,
      },
    };

    const nextState = reconcilePersistentStepMissionProgress({
      missions: [buildMission({ progress_value: 24000, updated_at: "2026-04-03T22:00:00.000Z" })],
      metricsDate: "2026-04-05",
      stepsValue: 512,
      state: previousState,
    });

    expect(nextState).toEqual({
      1: {
        metricsDate: "2026-04-05",
        lastDailySteps: 512,
        progressValue: 31854,
      },
    });
    expect(
      arePersistentStepMissionProgressStatesEqual(previousState, nextState),
    ).toBe(false);
  });
});
