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
        if (existingSnapshot) {
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
