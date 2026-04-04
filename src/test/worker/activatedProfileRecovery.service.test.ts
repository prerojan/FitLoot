import { describe, expect, it, vi } from "vitest";

vi.mock("../../worker/core/database", () => ({
  hasTableColumn: vi.fn(async (_db: D1Database, table: string, column: string) => {
    if (table !== "user_profiles") return false;
    return column === "age" || column === "gender" || column === "goals_json";
  }),
}));

import { createActivatedProfileRecoveryService } from "../../worker/services/activatedProfileRecovery";
import { createMockD1Database } from "./mockD1";
import { createTestEnv, TEST_USER } from "./testUtils";

describe("activatedProfileRecovery", () => {
  it("rebuilds the missing activated-account state from training plan data", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT main_goal, conditioning, training_frequency, equipment, injuries",
        first: null,
      },
      {
        match: "SELECT user_id FROM user_profiles WHERE username = ? LIMIT 1",
        first: null,
      },
      {
        match: "INSERT OR IGNORE INTO user_profiles",
        run: { success: true, meta: {} },
      },
      {
        match: "SELECT user_id FROM user_attributes WHERE user_id = ?",
        first: null,
      },
      {
        match: "INSERT INTO user_attributes",
        run: { success: true, meta: {} },
      },
      {
        match: "SELECT user_id FROM user_progression WHERE user_id = ?",
        first: null,
      },
      {
        match: "INSERT INTO user_progression",
        run: { success: true, meta: {} },
      },
      {
        match: "SELECT user_id FROM user_training_plans WHERE user_id = ?",
        first: null,
      },
      {
        match: "SELECT * FROM user_profiles WHERE user_id = ?",
        first: {
          user_id: TEST_USER.id,
          username: "teste",
          full_name: TEST_USER.name,
          initial_conditioning: "iniciante",
          injuries: "",
          equipment: "",
          main_goal: "saude_geral",
          age: null,
          gender: null,
          goals_json: "[\"saude_geral\"]",
        },
      },
    ]);
    const env = createTestEnv(db);
    const deps = {
      buildInitialTrainingPlan: vi.fn(async () => ({ days: [] })),
      ensureGoalStatsRow: vi.fn(async () => undefined),
      normalizeConditioning: vi.fn(() => "iniciante"),
      normalizeTrainingFrequencyInput: vi.fn(() => 3),
      upsertTrainingPlan: vi.fn(async () => undefined),
    };
    const service = createActivatedProfileRecoveryService(deps);

    const recoveredProfile = await service.repairActivatedProfileState({
      db,
      env,
      user: {
        ...TEST_USER,
        onboarding_completed: 1,
        plan_id: "vip",
        plan_status: "active",
      },
    });

    expect(recoveredProfile).toMatchObject({
      user_id: TEST_USER.id,
      full_name: TEST_USER.name,
      main_goal: "saude_geral",
    });
    expect(deps.buildInitialTrainingPlan).toHaveBeenCalled();
    expect(deps.upsertTrainingPlan).toHaveBeenCalled();
    expect(deps.ensureGoalStatsRow).toHaveBeenCalledWith(db, TEST_USER.id, "saude_geral");
  });
});
