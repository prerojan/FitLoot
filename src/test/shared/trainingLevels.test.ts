import { describe, expect, it } from "vitest";
import { TRAINING_RANK_SNAPSHOT_VERSION } from "../../shared/types";
import {
  deserializeRankSnapshot,
  formatTrainingRankLabel,
  getOrCalculateRankSnapshot,
  scoreToTrainingRank,
} from "../../shared/trainingLevels";

describe("trainingLevels", () => {
  it.each([
    [0, "bronze_1"],
    [15, "bronze_2"],
    [23, "bronze_3"],
    [24, "ferro_1"],
    [47, "ferro_3"],
    [48, "ouro_1"],
    [71, "ouro_3"],
    [72, "diamante_1"],
    [95, "diamante_3"],
    [96, "elite"],
    [100, "elite"],
  ] as const)("maps score %s to %s", (score, expectedRank) => {
    expect(scoreToTrainingRank(score)).toBe(expectedRank);
  });

  it("rejects legacy snapshots and recalculates them with the new schema", () => {
    const legacySnapshot = JSON.stringify({
      globalRank: "avancado",
      globalScore: 82,
      lastCalculatedAt: "2026-01-01T00:00:00.000Z",
      factors: {
        volumeScore: 20,
        consistencyScore: 24,
        benchmarkScore: 28,
        skillMasteryScore: 10,
      },
      hasBenchmarkData: true,
      hasSkillData: true,
      fallbackUsed: false,
    });

    expect(deserializeRankSnapshot(legacySnapshot)).toBeNull();

    const recalculated = getOrCalculateRankSnapshot(
      {
        xp: 2500,
        level: 15,
        current_streak: 14,
        best_streak: 21,
        training_rank_snapshot: legacySnapshot,
      },
      [{ skill_id: 1, total_reps: 120, best_reps: 24 }],
    );

    expect(recalculated.schemaVersion).toBe(TRAINING_RANK_SNAPSHOT_VERSION);
    expect(recalculated.globalRank).toBe("diamante_1");
  });

  it("keeps valid snapshots from the current schema", () => {
    const currentSnapshotJson = JSON.stringify({
      schemaVersion: TRAINING_RANK_SNAPSHOT_VERSION,
      globalRank: "ouro_2",
      globalScore: 61,
      lastCalculatedAt: "2026-04-12T12:00:00.000Z",
      factors: {
        volumeScore: 15,
        consistencyScore: 18,
        benchmarkScore: 18,
        skillMasteryScore: 10,
      },
      hasBenchmarkData: true,
      hasSkillData: true,
      fallbackUsed: false,
    });

    const snapshot = deserializeRankSnapshot(currentSnapshotJson);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.globalRank).toBe("ouro_2");
    expect(formatTrainingRankLabel(snapshot?.globalRank ?? "bronze_1")).toBe("Ouro II");
  });
});
