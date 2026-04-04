import { describe, expect, it } from "vitest";
import { resolveMissionExerciseForGeneration, sanitizeMissionExerciseNames } from "../../worker/services/missionExerciseSelection";

describe("missionExerciseSelection", () => {
  it("accepts the explicit route-based cardio mission allowlist", () => {
    expect(
      resolveMissionExerciseForGeneration({
        requestedName: "running",
        muscles: ["legs"],
        focus: "cardio",
      }),
    ).toBe("running");

    expect(
      resolveMissionExerciseForGeneration({
        requestedName: "caminhada",
        muscles: ["legs"],
        focus: "recuperacao ativa",
      }),
    ).toBe("walking");
  });

  it("keeps guided and generic unsupported inputs out of the regular daily selection", () => {
    const resolvedGuided = resolveMissionExerciseForGeneration({
      requestedName: "guided lower-body flow",
      muscles: ["glutes", "legs"],
      focus: "lower body",
    });

    expect(resolvedGuided).not.toBeNull();
    expect(resolvedGuided).not.toContain("guided");
    expect(resolvedGuided).not.toContain("stretch");

    expect(
      sanitizeMissionExerciseNames({
        requestedNames: ["guided stretching flow"],
        muscles: ["mobility"],
        focus: "mobilidade",
        limit: 3,
      }),
    ).not.toContain("stretching");
  });
});
