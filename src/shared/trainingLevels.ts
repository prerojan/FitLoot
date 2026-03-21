import type { TrainingRankProfile, TrainingRank, TrainingRankSnapshot } from './types';

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

/**
 * Converte score 0-100 para rank de treinamento
 */
export function scoreToTrainingRank(score: number): TrainingRank {
  if (score >= 70) return 'avancado';
  if (score >= 40) return 'intermediario';
  return 'iniciante';
}

/**
 * Calcula score de volume baseado em sessões totais
 */
export function calculateVolumeScore(totalSessions: number): number {
  if (totalSessions >= 100) return 25;
  if (totalSessions >= 50) return 20;
  if (totalSessions >= 25) return 15;
  if (totalSessions >= 10) return 10;
  return totalSessions > 0 ? 5 : 0;
}

/**
 * Calcula score de consistência baseado em semanas ativas e streak (NOVO SISTEMA)
 */
export function calculateRankConsistencyScore(activeWeeks: number, longestStreak = 0): number {
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

/**
 * Calcula score de domínio de skills
 */
export function calculateSkillMasteryScore(input: {
  unlockedSkills: number;
  unlockedSkillStages: number;
}): number {
  const masteryRaw = input.unlockedSkills + input.unlockedSkillStages * 0.5;

  if (masteryRaw >= 15) return 20;
  if (masteryRaw >= 10) return 15;
  if (masteryRaw >= 5) return 10;
  return masteryRaw > 0 ? 5 : 0;
}

/**
 * Calcula score de benchmarks com fallback seguro (NOVO SISTEMA)
 */
export function calculateRankBenchmarkScore(
  results?: {
    pushUpMaxReps?: number;
    squatMaxReps?: number;
    plankMaxSeconds?: number;
    sitUpMaxReps?: number;
    skillStageScore?: number;
  }
): number {
  if (!results) return 0;

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

/**
 * Calcula rank global e snapshot completo
 * Função principal que orquestra o cálculo do novo sistema de rank
 */
export function calculateTrainingRankSnapshot(profile: TrainingRankProfile): TrainingRankSnapshot {
  const volumeScore = calculateVolumeScore(profile.totalSessions);
  const consistencyScore = calculateRankConsistencyScore(profile.activeWeeks, profile.longestStreak);
  const benchmarkScore = calculateRankBenchmarkScore(profile.benchmarkResults);
  const skillMasteryScore = calculateSkillMasteryScore({
    unlockedSkills: profile.unlockedSkills,
    unlockedSkillStages: profile.unlockedSkillStages,
  });

  const totalScore = clamp(
    volumeScore + consistencyScore + benchmarkScore + skillMasteryScore,
    0,
    100,
  );

  const hasBenchmarkData = !!profile.benchmarkResults && (
    profile.benchmarkResults.pushUpMaxReps != null ||
    profile.benchmarkResults.squatMaxReps != null ||
    profile.benchmarkResults.plankMaxSeconds != null ||
    profile.benchmarkResults.sitUpMaxReps != null ||
    profile.benchmarkResults.skillStageScore != null
  );
  const hasSkillData = profile.unlockedSkills > 0 || profile.unlockedSkillStages > 0;
  const fallbackUsed = !hasSkillData; // Remove verificação de benchmarks pois agora sempre temos estimativas

  const snapshot: TrainingRankSnapshot = {
    globalRank: scoreToTrainingRank(totalScore),
    globalScore: totalScore,
    lastCalculatedAt: new Date().toISOString(),
    factors: {
      volumeScore,
      consistencyScore,
      benchmarkScore,
      skillMasteryScore,
    },
    hasBenchmarkData,
    hasSkillData,
    fallbackUsed,
  };

  // Calcula ranks por categoria se houver dados de benchmarks
  if (profile.benchmarkResults) {
    snapshot.categoryRanks = {
      flexoes: scoreToTrainingRank(
        profile.benchmarkResults.pushUpMaxReps ? 
          (profile.benchmarkResults.pushUpMaxReps >= 25 ? 80 : 
           profile.benchmarkResults.pushUpMaxReps >= 10 ? 50 : 20) : 0
      ),
      agachamentos: scoreToTrainingRank(
        profile.benchmarkResults.squatMaxReps ? 
          (profile.benchmarkResults.squatMaxReps >= 50 ? 80 : 
           profile.benchmarkResults.squatMaxReps >= 25 ? 50 : 20) : 0
      ),
      pranchas: scoreToTrainingRank(
        profile.benchmarkResults.plankMaxSeconds ? 
          (profile.benchmarkResults.plankMaxSeconds >= 90 ? 80 : 
           profile.benchmarkResults.plankMaxSeconds >= 30 ? 50 : 20) : 0
      ),
      abdominais: scoreToTrainingRank(
        profile.benchmarkResults.sitUpMaxReps ? 
          (profile.benchmarkResults.sitUpMaxReps >= 35 ? 80 : 
           profile.benchmarkResults.sitUpMaxReps >= 15 ? 50 : 20) : 0
      ),
      skills: scoreToTrainingRank(
        profile.benchmarkResults.skillStageScore ? 
          (profile.benchmarkResults.skillStageScore >= 7 ? 80 : 
           profile.benchmarkResults.skillStageScore >= 3 ? 50 : 20) : 0
      ),
    };
  }

  return snapshot;
}

/**
 * Função de adaptação: converte dados existentes do sistema para o novo perfil
 * Permite migração incremental sem quebrar dados existentes
 */
export function adaptExistingDataToRankProfile(
  userProgression: { xp: number; level: number; current_streak: number; best_streak: number },
  userSkills: Array<{ skill_id: number; total_reps: number; best_reps: number }>,
  benchmarkResults?: {
    pushUpMaxReps?: number;
    squatMaxReps?: number;
    plankMaxSeconds?: number;
    sitUpMaxReps?: number;
    skillStageScore?: number;
  }
): TrainingRankProfile {
  // Estimativas baseadas nos dados existentes
  const totalSessions = Math.floor(userProgression.xp / 50); // Estimativa: ~50 XP por sessão
  const activeWeeks = Math.min(Math.floor(totalSessions / 3), 52); // Estimativa: 3 sessões por semana
  
  // Estima benchmarks baseados na progressão do usuário se não existirem
  const estimatedBenchmarks = !benchmarkResults ? {
    // Baseado em level e XP: estima capacidade física
    pushUpMaxReps: Math.min(Math.max(Math.floor(userProgression.level * 2.5), 5), 50),
    squatMaxReps: Math.min(Math.max(Math.floor(userProgression.level * 4), 8), 80),
    plankMaxSeconds: Math.min(Math.max(Math.floor(userProgression.level * 15), 20), 180),
    sitUpMaxReps: Math.min(Math.max(Math.floor(userProgression.level * 3), 6), 60),
    skillStageScore: userSkills.reduce((score, skill) => {
      if (skill.total_reps >= 100) score += 2;
      else if (skill.total_reps >= 50) score += 1;
      else if (skill.total_reps >= 10) score += 0.5;
      return score;
    }, 0)
  } : benchmarkResults;
  
  return {
    totalSessions,
    activeWeeks,
    longestStreak: userProgression.best_streak,
    unlockedSkills: userSkills.length,
    unlockedSkillStages: userSkills.filter(skill => skill.total_reps >= 100).length, // Estimativa de estágios
    benchmarkResults: estimatedBenchmarks,
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
    return JSON.parse(jsonString) as TrainingRankSnapshot;
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
    training_rank_snapshot?: string | null;
  },
  userSkills: Array<{ skill_id: number; total_reps: number; best_reps: number }>,
  benchmarkResults?: {
    pushUpMaxReps?: number;
    squatMaxReps?: number;
    plankMaxSeconds?: number;
    sitUpMaxReps?: number;
    skillStageScore?: number;
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
