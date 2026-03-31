import { describe, expect, it } from "vitest";

import {
  ensurePortugueseExerciseLabel,
  ensurePortugueseInstructionList,
} from "../../worker/services/instructionLocalization";

describe("instructionLocalization", () => {
  it("removes english residue from mixed instruction lines", () => {
    const localized = ensurePortugueseInstructionList([
      "Keep your core engaged and return to starting position",
      "Mantenha o tronco estável durante o movimento",
    ]);

    expect(localized.length).toBeGreaterThan(0);
    expect(
      localized.some((line) =>
        /\b(?:keep|return|starting|position|core)\b/i.test(line),
      ),
    ).toBe(false);
  });

  it("localizes english exercise labels without english residue", () => {
    const label = ensurePortugueseExerciseLabel("Single-leg Romanian deadlift");

    expect(label).toBe("Levantamento Terra Romeno Unilateral");
    expect(/\b(?:single|leg|romanian|deadlift)\b/i.test(label)).toBe(false);
  });

  it("falls back to a portuguese generic exercise label when no safe localization is available", () => {
    const label = ensurePortugueseExerciseLabel("Box jump over hurdle");

    expect(label).toBe("exercício guiado");
  });

  it("preserves portuguese exercise labels", () => {
    const label = ensurePortugueseExerciseLabel("Agachamento livre");

    expect(label).toBe("Agachamento livre");
  });
});
