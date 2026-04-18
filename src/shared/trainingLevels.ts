import {
  TRAINING_RANK_SNAPSHOT_VERSION,
  type TrainingRankProfile,
  type TrainingRank,
  type TrainingRankSnapshot,
} from './types';

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
    ...(profile.benchmarkResults?.pushUpMaxReps != null ? [{
      ...calculateCategoryLevel({
        category: 'flexoes',
        benchmarkValue: profile.benchmarkResults.pushUpMaxReps,
      }),
    }] : []),
    ...(profile.benchmarkResults?.squatMaxReps != null ? [{
      ...calculateCategoryLevel({
        category: 'agachamentos',
        benchmarkValue: profile.benchmarkResults.squatMaxReps,
      }),
    }] : []),
    ...(profile.benchmarkResults?.plankMaxSeconds != null ? [{
      ...calculateCategoryLevel({
        category: 'pranchas',
        benchmarkValue: profile.benchmarkResults.plankMaxSeconds,
      }),
    }] : []),
    ...(profile.benchmarkResults?.sitUpMaxReps != null ? [{
      ...calculateCategoryLevel({
        category: 'abdominais',
        benchmarkValue: profile.benchmarkResults.sitUpMaxReps,
      }),
    }] : []),
    ...(profile.benchmarkResults?.skillStageScore != null ? [{
      ...calculateCategoryLevel({
        category: 'skills',
        benchmarkValue: profile.benchmarkResults.skillStageScore,
        unlockedSkillsInCategory: profile.unlockedSkills,
        unlockedStagesInCategory: profile.unlockedSkillStages,
      }),
    }] : []),
  ];

  return {
    global,
    categories,
  };
}

// ===== NOVO SISTEMA DE RANK DERIVADO =====

export type TrainingRankTier = 'bronze' | 'ferro' | 'ouro' | 'diamante' | 'elite';

export type TrainingRankMeta = {
  rank: TrainingRank;
  label: string;
  tier: TrainingRankTier;
  minScore: number;
  maxScore: number;
  description: string;
  iconPath: string;
};

export const TRAINING_RANKS: readonly TrainingRankMeta[] = [
  {
    rank: 'bronze_1',
    label: 'Bronze I',
    tier: 'bronze',
    minScore: 0,
    maxScore: 99,
    description: 'Base da progressao de treino',
    iconPath: '/ranks/bronze-1.png',
  },
  {
    rank: 'bronze_2',
    label: 'Bronze II',
    tier: 'bronze',
    minScore: 100,
    maxScore: 199,
    description: 'Primeiros sinais de consistencia',
    iconPath: '/ranks/bronze-2.png',
  },
  {
    rank: 'bronze_3',
    label: 'Bronze III',
    tier: 'bronze',
    minScore: 200,
    maxScore: 299,
    description: 'Fundacao fisica em consolidacao',
    iconPath: '/ranks/bronze-3.png',
  },
  {
    rank: 'ferro_1',
    label: 'Ferro I',
    tier: 'ferro',
    minScore: 300,
    maxScore: 399,
    description: 'Resistencia e rotina ganhando forma',
    iconPath: '/ranks/ferro-1.png',
  },
  {
    rank: 'ferro_2',
    label: 'Ferro II',
    tier: 'ferro',
    minScore: 400,
    maxScore: 499,
    description: 'Maior carga, melhor controle',
    iconPath: '/ranks/ferro-2.png',
  },
  {
    rank: 'ferro_3',
    label: 'Ferro III',
    tier: 'ferro',
    minScore: 500,
    maxScore: 599,
    description: 'Performance estavel e confiavel',
    iconPath: '/ranks/ferro-3.png',
  },
  {
    rank: 'ouro_1',
    label: 'Ouro I',
    tier: 'ouro',
    minScore: 600,
    maxScore: 699,
    description: 'Treino acima da media da base',
    iconPath: '/ranks/ouro-1.png',
  },
  {
    rank: 'ouro_2',
    label: 'Ouro II',
    tier: 'ouro',
    minScore: 700,
    maxScore: 799,
    description: 'Boa combinacao entre volume e execucao',
    iconPath: '/ranks/ouro-2.png',
  },
  {
    rank: 'ouro_3',
    label: 'Ouro III',
    tier: 'ouro',
    minScore: 800,
    maxScore: 899,
    description: 'Atleta forte e consistente',
    iconPath: '/ranks/ouro-3.png',
  },
  {
    rank: 'diamante_1',
    label: 'Diamante I',
    tier: 'diamante',
    minScore: 900,
    maxScore: 999,
    description: 'Alta capacidade fisica e tecnica',
    iconPath: '/ranks/diamante-1.png',
  },
  {
    rank: 'diamante_2',
    label: 'Diamante II',
    tier: 'diamante',
    minScore: 1000,
    maxScore: 1099,
    description: 'Dominio avancado dos pilares do treino',
    iconPath: '/ranks/diamante-2.png',
  },
  {
    rank: 'diamante_3',
    label: 'Diamante III',
    tier: 'diamante',
    minScore: 1100,
    maxScore: 1199,
    description: 'Elite competitiva da progressao',
    iconPath: '/ranks/diamante-3.png',
  },
  {
    rank: 'elite',
    label: 'Elite',
    tier: 'elite',
    minScore: 1200,
    maxScore: 1300,
    description: 'Topo absoluto do rank de treinamento',
    iconPath: '/ranks/elite.png',
  },
] as const;

const TRAINING_RANK_META_BY_KEY = Object.fromEntries(
  TRAINING_RANKS.map((meta) => [meta.rank, meta]),
) as Record<TrainingRank, TrainingRankMeta>;

export function isTrainingRank(value: unknown): value is TrainingRank {
  return typeof value === 'string' && value in TRAINING_RANK_META_BY_KEY;
}

export function getLowestTrainingRank(): TrainingRank {
  return TRAINING_RANKS[0]?.rank ?? 'bronze_1';
}

export function getTrainingRankMeta(rank: TrainingRank): TrainingRankMeta {
  return TRAINING_RANK_META_BY_KEY[rank];
}

export function formatTrainingRankLabel(rank: TrainingRank): string {
  return getTrainingRankMeta(rank).label;
}

export function getNextTrainingRankMeta(rank: TrainingRank): TrainingRankMeta | null {
  const currentIndex = TRAINING_RANKS.findIndex((meta) => meta.rank === rank);
  if (currentIndex < 0 || currentIndex >= TRAINING_RANKS.length - 1) {
    return null;
  }
  return TRAINING_RANKS[currentIndex + 1] ?? null;
}

type PiecewisePoint = readonly [number, number];
const TRAINING_RANK_SCORE_CAP = TRAINING_RANKS[TRAINING_RANKS.length - 1]?.maxScore ?? 1300;

function roundScore(value: number): number {
  return Math.round(value);
}

function interpolatePiecewise(value: number, points: readonly PiecewisePoint[]): number {
  if (points.length === 0) return 0;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return 0;

  const numericValue = Number.isFinite(value) ? value : 0;
  if (numericValue <= firstPoint[0]) {
    return firstPoint[1];
  }

  for (let index = 1; index < points.length; index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[index - 1];
    if (!currentPoint || !previousPoint) continue;
    const [endThreshold, endScore] = currentPoint;
    const [startThreshold, startScore] = previousPoint;

    if (numericValue <= endThreshold) {
      const range = endThreshold - startThreshold;
      if (range <= 0) return endScore;
      const progress = (numericValue - startThreshold) / range;
      return startScore + (endScore - startScore) * progress;
    }
  }

  return lastPoint[1];
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysSince(value?: string | null): number | null {
  const parsed = parseDate(value);
  if (!parsed) return null;
  const diffMs = Date.now() - parsed.getTime();
  if (!Number.isFinite(diffMs)) return null;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

function calculateFreshnessScore(
  value: string | null | undefined,
  maxAgeDays: number,
  points: readonly PiecewisePoint[],
): number {
  const ageDays = daysSince(value);
  if (ageDays == null) return 0;
  const freshnessWindow = clamp(maxAgeDays - ageDays, 0, maxAgeDays);
  return roundScore(interpolatePiecewise(freshnessWindow, points));
}

function calculateEstimatedBenchmarkProxyScore(profile: TrainingRankProfile): number {
  const levelScore = interpolatePiecewise(profile.level, [
    [1, 0],
    [5, 18],
    [10, 42],
    [20, 72],
    [30, 96],
    [40, 110],
  ]);
  const sessionScore = interpolatePiecewise(profile.totalSessions, [
    [0, 0],
    [10, 10],
    [30, 24],
    [60, 34],
    [100, 40],
  ]);
  const skillScore = interpolatePiecewise(profile.unlockedSkillStages, [
    [0, 0],
    [2, 8],
    [5, 16],
    [10, 24],
    [15, 30],
  ]);

  return clamp(roundScore(levelScore + sessionScore + skillScore), 0, 180);
}

/**
 * Converte score 0-1300 para rank de treinamento
 */
export function scoreToTrainingRank(score: number): TrainingRank {
  const normalizedScore = clamp(Math.round(score), 0, TRAINING_RANK_SCORE_CAP);

  return (
    TRAINING_RANKS.find(
      ({ minScore, maxScore }) =>
        normalizedScore >= minScore && normalizedScore <= maxScore,
    )?.rank ?? getLowestTrainingRank()
  );
}

/**
 * Calcula score de volume baseado em sessões totais
 */
export function calculateVolumeScore(totalSessions: number): number {
  const score = interpolatePiecewise(Math.max(0, totalSessions), [
    [0, 0],
    [8, 35],
    [20, 75],
    [40, 130],
    [80, 190],
    [140, 235],
    [220, 260],
  ]);

  return clamp(roundScore(score), 0, 260);
}

/**
 * Calcula score de consistência baseado em semanas ativas e streak (NOVO SISTEMA)
 */
export function calculateRankConsistencyScore(activeWeeks: number, longestStreak = 0): number {
  const activeWeeksScore = interpolatePiecewise(Math.max(0, activeWeeks), [
    [0, 0],
    [4, 25],
    [8, 55],
    [16, 105],
    [32, 150],
    [52, 160],
  ]);
  const longestStreakScore = interpolatePiecewise(Math.max(0, longestStreak), [
    [0, 0],
    [7, 15],
    [14, 32],
    [30, 52],
    [60, 72],
    [90, 80],
  ]);

  return clamp(roundScore(activeWeeksScore + longestStreakScore), 0, 240);
}

/**
 * Calcula score de domínio de skills
 */
export function calculateSkillMasteryScore(input: {
  unlockedSkills: number;
  unlockedSkillStages: number;
  totalSkillReps: number;
}): number {
  const unlockedSkillsScore = interpolatePiecewise(Math.max(0, input.unlockedSkills), [
    [0, 0],
    [3, 20],
    [6, 45],
    [10, 72],
    [15, 102],
    [20, 120],
  ]);
  const unlockedStagesScore = interpolatePiecewise(Math.max(0, input.unlockedSkillStages), [
    [0, 0],
    [2, 10],
    [5, 24],
    [10, 45],
    [15, 64],
    [20, 80],
  ]);
  const totalSkillRepsScore = interpolatePiecewise(Math.max(0, input.totalSkillReps), [
    [0, 0],
    [300, 5],
    [1000, 10],
    [2500, 14],
    [5000, 18],
    [9000, 20],
  ]);

  return clamp(roundScore(
    unlockedSkillsScore + unlockedStagesScore + totalSkillRepsScore,
  ), 0, 220);
}

/**
 * Calcula score de benchmarks com fallback seguro (NOVO SISTEMA)
 */
export function calculateRankBenchmarkScore(profile: TrainingRankProfile): number {
  const results = profile.benchmarkResults;
  if (!results) {
    return calculateEstimatedBenchmarkProxyScore(profile);
  }

  const pushUpScore =
    results.pushUpMaxReps == null
      ? 0
      : interpolatePiecewise(Math.max(0, results.pushUpMaxReps), [
          [0, 0],
          [10, 15],
          [20, 32],
          [35, 48],
          [50, 60],
          [70, 70],
        ]);
  const squatScore =
    results.squatMaxReps == null
      ? 0
      : interpolatePiecewise(Math.max(0, results.squatMaxReps), [
          [0, 0],
          [20, 15],
          [40, 32],
          [60, 48],
          [80, 60],
          [120, 70],
        ]);
  const sitUpScore =
    results.sitUpMaxReps == null
      ? 0
      : interpolatePiecewise(Math.max(0, results.sitUpMaxReps), [
          [0, 0],
          [15, 10],
          [30, 22],
          [45, 34],
          [60, 44],
          [80, 50],
        ]);
  const plankScore =
    results.plankMaxSeconds == null
      ? 0
      : interpolatePiecewise(Math.max(0, results.plankMaxSeconds), [
          [0, 0],
          [30, 12],
          [60, 28],
          [90, 42],
          [150, 58],
          [240, 70],
        ]);
  const pullUpScore =
    results.pullUpMaxReps == null
      ? 0
      : interpolatePiecewise(Math.max(0, results.pullUpMaxReps), [
          [0, 0],
          [3, 10],
          [8, 24],
          [12, 36],
          [20, 50],
          [30, 60],
        ]);

  const runDistanceScore =
    results.runDistanceKm == null
      ? 0
      : interpolatePiecewise(Math.max(0, results.runDistanceKm), [
          [0, 0],
          [1, 10],
          [3, 22],
          [5, 32],
          [8, 40],
          [10, 45],
        ]);

  const paceSecondsPerKm =
    results.runDistanceKm != null &&
    results.runDistanceKm > 0 &&
    results.runTimeSeconds != null &&
    results.runTimeSeconds > 0
      ? results.runTimeSeconds / results.runDistanceKm
      : null;
  const paceEfficiencyScore =
    paceSecondsPerKm == null
      ? 0
      : interpolatePiecewise(Math.max(0, 420 - paceSecondsPerKm), [
          [0, 0],
          [60, 15],
          [90, 30],
          [120, 40],
          [150, 48],
          [180, 55],
        ]);

  const knownBenchmarks = [
    results.pushUpMaxReps,
    results.squatMaxReps,
    results.sitUpMaxReps,
    results.plankMaxSeconds,
    results.pullUpMaxReps,
    results.runDistanceKm,
    paceSecondsPerKm,
  ].filter((value) => value != null);

  if (knownBenchmarks.length === 0) {
    return calculateEstimatedBenchmarkProxyScore(profile);
  }

  return clamp(roundScore(
    pushUpScore +
    squatScore +
    sitUpScore +
    plankScore +
    pullUpScore +
    runDistanceScore +
    paceEfficiencyScore,
  ), 0, 420);
}

export function calculateMomentumScore(profile: Pick<
  TrainingRankProfile,
  'currentStreak' | 'lastActivityDate' | 'latestBenchmarkDate'
>): number {
  const currentStreakScore = interpolatePiecewise(Math.max(0, profile.currentStreak), [
    [0, 0],
    [3, 10],
    [7, 25],
    [14, 45],
    [30, 65],
    [60, 80],
  ]);
  const activityFreshnessScore = calculateFreshnessScore(
    profile.lastActivityDate,
    14,
    [
      [0, 0],
      [3, 10],
      [7, 22],
      [10, 36],
      [14, 50],
    ],
  );
  const benchmarkFreshnessScore = calculateFreshnessScore(
    profile.latestBenchmarkDate,
    90,
    [
      [0, 0],
      [15, 8],
      [30, 15],
      [60, 24],
      [90, 30],
    ],
  );

  return clamp(roundScore(
    currentStreakScore + activityFreshnessScore + benchmarkFreshnessScore,
  ), 0, 160);
}

/**
 * Calcula rank global e snapshot completo
 * Função principal que orquestra o cálculo do novo sistema de rank
 */
export function calculateTrainingRankSnapshot(profile: TrainingRankProfile): TrainingRankSnapshot {
  const volumeScore = calculateVolumeScore(profile.totalSessions);
  const consistencyScore = calculateRankConsistencyScore(profile.activeWeeks, profile.longestStreak);
  const benchmarkScore = calculateRankBenchmarkScore(profile);
  const skillMasteryScore = calculateSkillMasteryScore({
    unlockedSkills: profile.unlockedSkills,
    unlockedSkillStages: profile.unlockedSkillStages,
    totalSkillReps: profile.totalSkillReps,
  });
  const momentumScore = calculateMomentumScore(profile);

  const totalScore = clamp(
    volumeScore + consistencyScore + benchmarkScore + skillMasteryScore + momentumScore,
    0,
    TRAINING_RANK_SCORE_CAP,
  );

  const hasBenchmarkData = !!profile.benchmarkResults && (
    profile.benchmarkResults.pushUpMaxReps != null ||
    profile.benchmarkResults.squatMaxReps != null ||
    profile.benchmarkResults.plankMaxSeconds != null ||
    profile.benchmarkResults.sitUpMaxReps != null ||
    profile.benchmarkResults.pullUpMaxReps != null ||
    profile.benchmarkResults.runDistanceKm != null ||
    profile.benchmarkResults.runTimeSeconds != null
  );
  const hasSkillData =
    profile.unlockedSkills > 0 ||
    profile.unlockedSkillStages > 0 ||
    profile.totalSkillReps > 0;
  const fallbackUsed = !hasBenchmarkData;

  const snapshot: TrainingRankSnapshot = {
    schemaVersion: TRAINING_RANK_SNAPSHOT_VERSION,
    globalRank: scoreToTrainingRank(totalScore),
    globalScore: totalScore,
    lastCalculatedAt: new Date().toISOString(),
    factors: {
      volumeScore,
      consistencyScore,
      benchmarkScore,
      skillMasteryScore,
      momentumScore,
    },
    hasBenchmarkData,
    hasSkillData,
    fallbackUsed,
  };

  return snapshot;
}

/**
 * Função de adaptação: converte dados existentes do sistema para o novo perfil
 * Permite migração incremental sem quebrar dados existentes
 */
export function adaptExistingDataToRankProfile(
  userProgression: {
    xp: number;
    level: number;
    current_streak: number;
    best_streak: number;
    last_activity_date?: string | null;
  },
  userSkills: Array<{ skill_id: number; total_reps: number; best_reps: number }>,
  benchmarkResults?: {
    pushUpMaxReps?: number;
    squatMaxReps?: number;
    plankMaxSeconds?: number;
    sitUpMaxReps?: number;
    pullUpMaxReps?: number;
    runDistanceKm?: number;
    runTimeSeconds?: number;
  }
): TrainingRankProfile {
  const totalSessions = Math.floor(userProgression.xp / 50);
  const activeWeeks = Math.min(Math.floor(totalSessions / 3), 52);
  const totalSkillReps = userSkills.reduce(
    (total, skill) => total + Math.max(0, Number(skill.total_reps) || 0),
    0,
  );

  return {
    xp: userProgression.xp,
    level: userProgression.level,
    totalSessions,
    activeWeeks,
    currentStreak: userProgression.current_streak,
    longestStreak: userProgression.best_streak,
    lastActivityDate: userProgression.last_activity_date ?? null,
    unlockedSkills: userSkills.length,
    unlockedSkillStages: userSkills.filter(skill => skill.total_reps >= 100).length,
    totalSkillReps,
    ...(benchmarkResults ? { benchmarkResults } : {}),
  };
}

// ===== FUNÇÕES DE INTEGRAÇÃO COM BANCO DE DADOS =====

/**
 * Serializa TrainingRankSnapshot para JSON string (armazenamento)
 */
export function serializeRankSnapshot(snapshot: TrainingRankSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Desserializa JSON string para TrainingRankSnapshot (leitura)
 */
export function deserializeRankSnapshot(jsonString: string | null): TrainingRankSnapshot | null {
  if (!jsonString) return null;

  try {
    const parsed = JSON.parse(jsonString) as Partial<TrainingRankSnapshot> & {
      factors?: Partial<TrainingRankSnapshot['factors']>;
    };

    if (
      parsed.schemaVersion !== TRAINING_RANK_SNAPSHOT_VERSION ||
      !isTrainingRank(parsed.globalRank) ||
      !Number.isFinite(parsed.globalScore) ||
      typeof parsed.lastCalculatedAt !== 'string' ||
      typeof parsed.hasBenchmarkData !== 'boolean' ||
      typeof parsed.hasSkillData !== 'boolean' ||
      typeof parsed.fallbackUsed !== 'boolean' ||
      !parsed.factors ||
      !Number.isFinite(parsed.factors.volumeScore) ||
      !Number.isFinite(parsed.factors.consistencyScore) ||
      !Number.isFinite(parsed.factors.benchmarkScore) ||
      !Number.isFinite(parsed.factors.skillMasteryScore) ||
      !Number.isFinite(parsed.factors.momentumScore)
    ) {
      return null;
    }

    const globalScore = Number(parsed.globalScore);
    const volumeScore = Number(parsed.factors.volumeScore);
    const consistencyScore = Number(parsed.factors.consistencyScore);
    const benchmarkScore = Number(parsed.factors.benchmarkScore);
    const skillMasteryScore = Number(parsed.factors.skillMasteryScore);
    const momentumScore = Number(parsed.factors.momentumScore);

    return {
      schemaVersion: parsed.schemaVersion,
      globalRank: parsed.globalRank,
      globalScore,
      lastCalculatedAt: parsed.lastCalculatedAt,
      factors: {
        volumeScore,
        consistencyScore,
        benchmarkScore,
        skillMasteryScore,
        momentumScore,
      },
      hasBenchmarkData: parsed.hasBenchmarkData,
      hasSkillData: parsed.hasSkillData,
      fallbackUsed: parsed.fallbackUsed,
    };
  } catch (error) {
    console.warn('Failed to deserialize rank snapshot:', error);
    return null;
  }
}

/**
 * Obtém ou calcula o rank snapshot com fallback seguro
 * Função principal para uso na UI e APIs
 */
export function getOrCalculateRankSnapshot(
  userProgression: { 
    xp: number; 
    level: number; 
    current_streak: number; 
    best_streak: number;
    last_activity_date?: string | null;
    training_rank_snapshot?: string | null;
  },
  userSkills: Array<{ skill_id: number; total_reps: number; best_reps: number }>,
  benchmarkResults?: {
    pushUpMaxReps?: number;
    squatMaxReps?: number;
    plankMaxSeconds?: number;
    sitUpMaxReps?: number;
    pullUpMaxReps?: number;
    runDistanceKm?: number;
    runTimeSeconds?: number;
  },
  forceRecalculate = false
): TrainingRankSnapshot {
  // Tenta usar snapshot existente se não for forçado recálculo
  if (!forceRecalculate && userProgression.training_rank_snapshot) {
    const existing = deserializeRankSnapshot(userProgression.training_rank_snapshot);
    if (existing) {
      return existing;
    }
  }

  // Calcula novo snapshot
  const profile = adaptExistingDataToRankProfile(userProgression, userSkills, benchmarkResults);
  const newSnapshot = calculateTrainingRankSnapshot(profile);
  
  return newSnapshot;
}

/**
 * Verifica se o rank precisa ser recalculado baseado na idade do snapshot
 */
export function shouldRecalculateRank(
  progression: { training_rank_snapshot?: string | null; updated_at?: string },
  maxAgeHours = 24
): boolean {
  if (!progression.training_rank_snapshot) return true;
  
  const snapshot = deserializeRankSnapshot(progression.training_rank_snapshot);
  if (!snapshot) return true;
  
  const snapshotAge = Date.now() - new Date(snapshot.lastCalculatedAt).getTime();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  
  return snapshotAge > maxAgeMs;
}
