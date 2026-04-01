import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConditioningLevel } from "../../shared/types";
import { buildInitialTrainingPlan } from "../../worker/services/trainingPlan";

describe("buildInitialTrainingPlan", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses RapidAPI workout planner when the provider responds with a plan", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            total_weeks: 6,
            exercises: [
              {
                day: "Monday",
                exercises: [
                  { name: "Dumbbell Bench Press" },
                  { name: "Shoulder Press" },
                ],
              },
              {
                day: "Tuesday",
                exercises: [
                  { name: "Goblet Squat" },
                  { name: "Walking Lunge" },
                ],
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const plan = await buildInitialTrainingPlan(
      { RAPID_API_KEY: "rapid-key" },
      "ganhar_massa",
      "iniciante" satisfies ConditioningLevel,
      "halteres",
      "",
      3,
    );

    expect(plan.source_provider).toBe("ai-workout-planner");
    expect(plan.source_total_weeks).toBe(6);
    expect(plan.weekly.segunda.exercises).toEqual([
      "push-up",
      "diamond push-up",
      "triceps dip",
    ]);
    expect(plan.weekly.terca.exercises).toEqual([
      "air squat",
      "walking lunge",
      "glute bridge",
    ]);
    expect(plan.weekly.quarta.rest_day).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://ai-workout-planner-exercise-fitness-nutrition-guide.p.rapidapi.com/generateWorkoutPlan",
    );
  });

  it("falls back to the internal static plan when RapidAPI is unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network-failure"));

    const plan = await buildInitialTrainingPlan(
      { RAPID_API_KEY: "rapid-key" },
      "saude_geral",
      "iniciante" satisfies ConditioningLevel,
      "",
      "",
      3,
    );

    expect(plan.source_provider).toBe("fitloot-static");
    expect(plan.weekly.segunda.exercises).toEqual([
      "push-up",
      "triceps dip",
      "diamond push-up",
    ]);
  });
});
