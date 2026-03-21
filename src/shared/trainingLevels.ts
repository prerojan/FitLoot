export type TrainingLevel = 'iniciante' | 'intermediario' | 'avancado';
export type ThresholdType = 'reps' | 'time';

export type UserTrainingProfile = {
  totalSessions: number;
  activeWeeks: number;
  longestStreak: number;
  unlockedSkills: number;
  unlockedSkillStages: number;
  benchmarkResults?: Partial<Record<BenchmarkKey, number>>;
};

export type CategoryKey =
  | 'flexoes'
  | 'agachamentos'
  | 'pranchas'
  | 'abdominais'
  | 'skills';

export type CategoryLevel = {
  category: CategoryKey;
  score: number;
  level: TrainingLevel;
};

export type BenchmarkKey =
  | 'pushUpMaxReps'
  | 'squatMaxReps'
  | 'plankMaxSeconds'
  | 'sitUpMaxReps'
  | 'skillStageScore';

export type BenchmarkBand = {
  beginnerMax: number;
  intermediateMax: number;
};

export const benchmarkBands: Record<BenchmarkKey, BenchmarkBand> = {
  pushUpMaxReps: {
    beginnerMax: 9,
    intermediateMax: 24,
  },
  squatMaxReps: {
    beginnerMax: 24,
    intermediateMax: 49,
  },
  plankMaxSeconds: {
    beginnerMax: 29,
    intermediateMax: 89,
  },
  sitUpMaxReps: {
    beginnerMax: 14,
    intermediateMax: 34,
  },
  skillStageScore: {
    beginnerMax: 2,
    intermediateMax: 6,
  },
};

export function getTrainingLevel(score: number): TrainingLevel {
  if (score >= 70) return 'avancado';
  if (score >= 40) return 'intermediario';
  return 'iniciante';
}

export function getBandLevel(
  value: number,
  band: BenchmarkBand,
): TrainingLevel {
  if (value > band.intermediateMax) return 'avancado';
  if (value > band.beginnerMax) return 'intermediario';
  return 'iniciante';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateExperienceScore(totalSessions: number): number {
  if (totalSessions >= 100) return 25;
  if (totalSessions >= 50) return 20;
  if (totalSessions >= 25) return 15;
  if (totalSessions >= 10) return 10;
  return totalSessions > 0 ? 5 : 0;
}

export function calculateConsistencyScore(activeWeeks: number, longestStreak = 0): number {
  const base =
    activeWeeks >= 12 ? 22 :
    activeWeeks >= 8 ? 18 :
    activeWeeks >= 4 ? 14 :
    activeWeeks >= 2 ? 8 :
    activeWeeks > 0 ? 4 : 0;

  const streakBonus =
    longestStreak >= 28 ? 3 :
    longestStreak >= 14 ? 2 :
    longestStreak >= 7 ? 1 : 0;

  return clamp(base + streakBonus, 0, 25);
}

export function calculateMasteryScore(input: {
  unlockedSkills: number;
  unlockedSkillStages: number;
}): number {
  const masteryRaw = input.unlockedSkills + input.unlockedSkillStages * 0.5;

  if (masteryRaw >= 15) return 20;
  if (masteryRaw >= 10) return 15;
  if (masteryRaw >= 5) return 10;
  return masteryRaw > 0 ? 5 : 0;
}

export function calculateBenchmarkScore(
  results: Partial<Record<BenchmarkKey, number>> = {},
): number {
  const pushUpScore =
    results.pushUpMaxReps == null ? 0 :
    results.pushUpMaxReps >= 25 ? 8 :
    results.pushUpMaxReps >= 10 ? 5 : 2;

  const squatScore =
    results.squatMaxReps == null ? 0 :
    results.squatMaxReps >= 50 ? 8 :
    results.squatMaxReps >= 25 ? 5 : 2;

  const plankScore =
    results.plankMaxSeconds == null ? 0 :
    results.plankMaxSeconds >= 90 ? 7 :
    results.plankMaxSeconds >= 30 ? 4 : 1;

  const sitUpScore =
    results.sitUpMaxReps == null ? 0 :
    results.sitUpMaxReps >= 35 ? 5 :
    results.sitUpMaxReps >= 15 ? 3 : 1;

  const skillScore =
    results.skillStageScore == null ? 0 :
    results.skillStageScore >= 7 ? 2 :
    results.skillStageScore >= 3 ? 1 : 0;

  return clamp(pushUpScore + squatScore + plankScore + sitUpScore + skillScore, 0, 30);
}

export function calculateGlobalTrainingScore(profile: UserTrainingProfile) {
  const experienceScore = calculateExperienceScore(profile.totalSessions);
  const consistencyScore = calculateConsistencyScore(
    profile.activeWeeks,
    profile.longestStreak,
  );
  const benchmarkScore = calculateBenchmarkScore(profile.benchmarkResults);
  const masteryScore = calculateMasteryScore({
    unlockedSkills: profile.unlockedSkills,
    unlockedSkillStages: profile.unlockedSkillStages,
  });

  const totalScore = clamp(
    experienceScore + consistencyScore + benchmarkScore + masteryScore,
    0,
    100,
  );

  return {
    experienceScore,
    consistencyScore,
    benchmarkScore,
    masteryScore,
    totalScore,
    level: getTrainingLevel(totalScore),
  };
}

export function calculateCategoryLevel(input: {
  category: CategoryKey;
  benchmarkValue?: number;
  sessionsInCategory?: number;
  unlockedSkillsInCategory?: number;
  unlockedStagesInCategory?: number;
}): CategoryLevel {
  const sessionsScore =
    (input.sessionsInCategory ?? 0) >= 40 ? 25 :
    (input.sessionsInCategory ?? 0) >= 20 ? 18 :
    (input.sessionsInCategory ?? 0) >= 8 ? 10 :
    (input.sessionsInCategory ?? 0) > 0 ? 5 : 0;

  const masteryRaw =
    (input.unlockedSkillsInCategory ?? 0) +
    (input.unlockedStagesInCategory ?? 0) * 0.5;

  const masteryScore =
    masteryRaw >= 8 ? 25 :
    masteryRaw >= 4 ? 15 :
    masteryRaw > 0 ? 8 : 0;

  let benchmarkScore = 0;

  if (input.benchmarkValue != null) {
    switch (input.category) {
      case 'flexoes':
        benchmarkScore =
          input.benchmarkValue >= 25 ? 50 :
          input.benchmarkValue >= 10 ? 30 : 15;
        break;
      case 'agachamentos':
        benchmarkScore =
          input.benchmarkValue >= 50 ? 50 :
          input.benchmarkValue >= 25 ? 30 : 15;
        break;
      case 'pranchas':
        benchmarkScore =
          input.benchmarkValue >= 90 ? 50 :
          input.benchmarkValue >= 30 ? 30 : 15;
        break;
      case 'abdominais':
        benchmarkScore =
          input.benchmarkValue >= 35 ? 50 :
          input.benchmarkValue >= 15 ? 30 : 15;
        break;
      case 'skills':
        benchmarkScore =
          input.benchmarkValue >= 7 ? 50 :
          input.benchmarkValue >= 3 ? 30 : 15;
        break;
    }
  }

  const score = clamp(
    Math.round(benchmarkScore * 0.5 + sessionsScore * 0.2 + masteryScore * 0.3),
    0,
    100,
  );

  return {
    category: input.category,
    score,
    level: getTrainingLevel(score),
  };
}

/**
 * Adaptador incremental:
 * use este helper para adicionar o novo rank sem remover o sistema atual.
 */
export function buildTrainingRankSnapshot(profile: UserTrainingProfile) {
  const global = calculateGlobalTrainingScore(profile);

  const categories: CategoryLevel[] = [
    calculateCategoryLevel({
      category: 'flexoes',
      benchmarkValue: profile.benchmarkResults?.pushUpMaxReps,
    }),
    calculateCategoryLevel({
      category: 'agachamentos',
      benchmarkValue: profile.benchmarkResults?.squatMaxReps,
    }),
    calculateCategoryLevel({
      category: 'pranchas',
      benchmarkValue: profile.benchmarkResults?.plankMaxSeconds,
    }),
    calculateCategoryLevel({
      category: 'abdominais',
      benchmarkValue: profile.benchmarkResults?.sitUpMaxReps,
    }),
    calculateCategoryLevel({
      category: 'skills',
      benchmarkValue: profile.benchmarkResults?.skillStageScore,
      unlockedSkillsInCategory: profile.unlockedSkills,
      unlockedStagesInCategory: profile.unlockedSkillStages,
    }),
  ];

  return {
    global,
    categories,
  };
}
