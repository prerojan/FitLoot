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
    [99, "bronze_1"],
    [100, "bronze_2"],
    [299, "bronze_3"],
    [300, "ferro_1"],
    [599, "ferro_3"],
    [600, "ouro_1"],
    [899, "ouro_3"],
    [900, "diamante_1"],
    [1199, "diamante_3"],
    [1200, "elite"],
    [1300, "elite"],
  ] as const)("maps score %s to %s", (score, expectedRank) => {
    expect(scoreToTrainingRank(score)).toBe(expectedRank);
  });

  it("rejects legacy snapshots and recalculates them with the new schema", () => {
    const legacySnapshot = JSON.stringify({
      globalRank: "avancado",
      globalScore: 82,
      lastCalculatedAt: "2026-01-01T00:00:00.000Z",
      factors: {
        volumeScore: 145,
        consistencyScore: 146,
        benchmarkScore: 92,
        skillMasteryScore: 14,
        momentumScore: 45,
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
        last_activity_date: null,
        training_rank_snapshot: legacySnapshot,
      },
      [{ skill_id: 1, total_reps: 120, best_reps: 24 }],
    );

    expect(recalculated.schemaVersion).toBe(TRAINING_RANK_SNAPSHOT_VERSION);
    expect(recalculated.globalRank).toBe("ferro_2");
  });

  it("keeps valid snapshots from the current schema", () => {
    const currentSnapshotJson = JSON.stringify({
      schemaVersion: TRAINING_RANK_SNAPSHOT_VERSION,
      globalRank: "ouro_2",
      globalScore: 742,
      lastCalculatedAt: "2026-04-12T12:00:00.000Z",
      factors: {
        volumeScore: 168,
        consistencyScore: 152,
        benchmarkScore: 250,
        skillMasteryScore: 112,
        momentumScore: 60,
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
