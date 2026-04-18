/**
 * Hook de calculo local do rank de treino a partir de progressao, skills e benchmarks.
 */

import { useEffect, useState } from "react";
import type { TrainingRankSnapshot, UserProgression, UserSkill } from "@/shared/types";

type BenchmarkResults = {
  pushUpMaxReps?: number;
  squatMaxReps?: number;
  plankMaxSeconds?: number;
  sitUpMaxReps?: number;
  pullUpMaxReps?: number;
  runDistanceKm?: number;
  runTimeSeconds?: number;
};

function hasCurrentTrainingEvidence(
  userProgression: UserProgression | null,
  userSkills: UserSkill[],
  benchmarkResults?: BenchmarkResults,
): boolean {
  const hasProgressionEvidence =
    (Number(userProgression?.xp ?? 0) > 0) ||
    (Number(userProgression?.current_streak ?? 0) > 0) ||
    (Number(userProgression?.best_streak ?? 0) > 0);

  const hasSkillEvidence = userSkills.some((skill) =>
    Number(skill.total_reps ?? 0) > 0 ||
    Number(skill.total_time ?? 0) > 0 ||
    Number(skill.best_reps ?? 0) > 0,
  );

  const hasBenchmarkEvidence = Boolean(
    benchmarkResults &&
    Object.values(benchmarkResults).some((value) => typeof value === "number"),
  );

  return hasProgressionEvidence || hasSkillEvidence || hasBenchmarkEvidence;
}

function isEmptyFallbackSnapshot(snapshot: TrainingRankSnapshot): boolean {
  return (
    snapshot.fallbackUsed &&
    !snapshot.hasBenchmarkData &&
    !snapshot.hasSkillData &&
    snapshot.globalScore === 0 &&
    snapshot.factors.volumeScore === 0 &&
    snapshot.factors.consistencyScore === 0 &&
    snapshot.factors.benchmarkScore === 0 &&
    snapshot.factors.skillMasteryScore === 0 &&
    snapshot.factors.momentumScore === 0
  );
}

export function useTrainingRank(
  userProgression: UserProgression | null,
  userSkills: UserSkill[],
  benchmarkResults?: BenchmarkResults,
) {
  // Calcula o rank localmente sempre que progressao, skills ou benchmarks mudam.
  const [snapshot, setSnapshot] = useState<TrainingRankSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const calculateRank = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { deserializeRankSnapshot, getOrCalculateRankSnapshot } = await import("@/shared/trainingLevels");

        const existingSnapshot = deserializeRankSnapshot(
          userProgression?.training_rank_snapshot || null,
        );
        const shouldIgnoreExistingSnapshot =
          existingSnapshot != null &&
          isEmptyFallbackSnapshot(existingSnapshot) &&
          hasCurrentTrainingEvidence(userProgression, userSkills, benchmarkResults);

        if (existingSnapshot && !shouldIgnoreExistingSnapshot) {
          setSnapshot(existingSnapshot);
          return;
        }

        const rankSnapshot = getOrCalculateRankSnapshot(
          userProgression
            ? {
                xp: userProgression.xp,
                level: userProgression.level,
                current_streak: userProgression.current_streak,
                best_streak: userProgression.best_streak,
                last_activity_date: userProgression.last_activity_date,
                training_rank_snapshot: userProgression.training_rank_snapshot || null,
              }
            : {
                xp: 0,
                level: 1,
                current_streak: 0,
                best_streak: 0,
                last_activity_date: null,
                training_rank_snapshot: null,
          },
          userSkills,
          benchmarkResults,
          shouldIgnoreExistingSnapshot,
        );

        setSnapshot(rankSnapshot);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        setIsLoading(false);
      }
    };

    if (userProgression && userSkills) {
      void calculateRank();
    } else {
      setIsLoading(false);
    }
  }, [benchmarkResults, userProgression, userSkills]);

  return { snapshot, isLoading, error };
}
