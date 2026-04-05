import { describe, expect, it } from "vitest";

import { getMissionMetricType } from "@/constants/missionMetrics";
import { normalizeExerciseCategory } from "@/worker/services/missionComposition";

describe("mission metric and category classification", () => {
  it("keeps walking lunge and step-up as standard strength missions", () => {
    expect(getMissionMetricType("Walking Lunge")).toBe("sets_reps");
    expect(getMissionMetricType("Step-up")).toBe("sets_reps");
    expect(normalizeExerciseCategory("Walking Lunge", "glutes")).toBe("strength");
    expect(normalizeExerciseCategory("Step-up", "legs")).toBe("strength");
  });

  it("classifies explicit route activities as distance missions", () => {
    expect(getMissionMetricType("Walking")).toBe("distance_meters");
    expect(getMissionMetricType("Running")).toBe("distance_meters");
    expect(normalizeExerciseCategory("Walking", "legs")).toBe("walk");
    expect(normalizeExerciseCategory("Running", "legs")).toBe("run");
  });
});
