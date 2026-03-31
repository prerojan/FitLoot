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
  skillStageScore?: number;
};

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

        const { getOrCalculateRankSnapshot } = await import("@/shared/trainingLevels");

        const rankSnapshot = getOrCalculateRankSnapshot(
          userProgression
            ? {
                xp: userProgression.xp,
                level: userProgression.level,
                current_streak: userProgression.current_streak,
                best_streak: userProgression.best_streak,
                training_rank_snapshot: userProgression.training_rank_snapshot || null,
              }
            : {
                xp: 0,
                level: 1,
                current_streak: 0,
                best_streak: 0,
                training_rank_snapshot: null,
              },
          userSkills,
          benchmarkResults,
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
