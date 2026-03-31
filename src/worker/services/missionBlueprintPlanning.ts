import type { MissionMetricType } from "../../shared/types";
import { localizeMissionText } from "../../shared/missionLocalization";
import { getMissionMetricType, metricUnitByType } from "../../constants/missionMetrics";
import { getHuggingFaceApiKey } from "../core/providerConfig";
import type { Env } from "../core/types";
import {
  ApiIntegrationError,
  requestHuggingFaceStructuredContent,
} from "./aiTransport";
import type { StructuredGenerationOptions } from "./missionGeneration";

type MissionPeriod = "daily" | "weekly" | "monthly";

type WeeklyPlanDayLike = {
  focus: string;
  muscles: string[];
  exercises: string[];
};

type MissionHistorySummaryRowLike = {
  title?: string | null | undefined;
  type?: string | null | undefined;
  status?: string | null | undefined;
  is_completed?: number | null | undefined;
};

type MissionGenerationProfileLike = {
  mainGoal: string;
  goals: string[];
  conditioning: string;
  injuries: string;
  equipment: string;
  trainingFrequency: number;
  volumeMultiplier: number;
  weeklyPlan: Record<string, WeeklyPlanDayLike | undefined>;
  recentHistory: MissionHistorySummaryRowLike[];
  completionRate: number;
  capacitySummary: string;
  initialCapacities: {
    pushups: number;
    situps: number;
    squats: number;
  };
  chatPlanPreferences: unknown;
};

export type StructuredDailyMissionDraft = {
  name?: string | undefined;
  description?: string | undefined;
  exercise_type?: string | undefined;
  muscle_group?: string | undefined;
  metric_type?: string | undefined;
  sets?: number | undefined;
  reps_or_value?: number | undefined;
  unit?: string | undefined;
  difficulty?: string | undefined;
  xp_reward?: number | undefined;
  fitcoins_reward?: number | undefined;
  estimated_minutes?: number | undefined;
};

export type StructuredPeriodicMissionDraft = {
  name?: string | undefined;
  description?: string | undefined;
  goal?: string | undefined;
  xp_reward?: number | undefined;
  fitcoins_reward?: number | undefined;
  subtasks?: string[] | undefined;
};

export type StructuredMissionPlanDraft = {
  weekly_plan?: {
    daily_missions?: StructuredDailyMissionDraft[] | undefined;
    weekly_missions?: StructuredPeriodicMissionDraft[] | undefined;
    monthly_missions?: StructuredPeriodicMissionDraft[] | undefined;
  } | undefined;
};

export type ResolvedMissionSubtask = {
  title: string;
  compatibilityKey: string;
  compatibilityTerms: string[];
  requiredCount: number;
};

export type MissionBlueprint = {
  period: MissionPeriod;
  name: string;
  description: string;
  goal: string | null;
  exerciseName: string;
  muscle: string;
  metricType: MissionMetricType;
  metricValue: number;
  xpReward: number;
  pointsReward: number;
  difficultyLevel: string;
  missionOrigin: "regular" | "ai";
  isAiSpecial: boolean;
  compatibilityKey: string;
  compatibilityTerms: string[];
  subtasks: ResolvedMissionSubtask[];
};

type MonthlyCounterSource =
  | "missions_completed"
  | "steps"
  | "distance_meters"
  | "streak_days"
  | "weekly_circuits_completed";

type MissionConfigLike = {
  xp: number;
  points: number;
};

type MissionBlueprintPlanningDeps = {
  buildMissionDescription: (
    exerciseName: string,
    metricType: MissionMetricType,
    metricValue: number,
    sets: number | null,
  ) => string;
  buildMissionDescriptionFromInstructions: (
    instructions: string[],
    fallback: string,
  ) => string;
  buildMissionInstructions: (
    exerciseName: string,
    metricType: MissionMetricType,
    sets: number | null,
    restSeconds: number | null,
  ) => string[];
  clampXpRewardByPeriod: (
    period: MissionPeriod,
    rawValue: unknown,
  ) => number;
  conditionedMetricValue: (
    metricType: MissionMetricType,
    period: MissionPeriod,
    conditioning: string,
    volumeMultiplier: number,
  ) => number;
  derivePointsRewardByPeriod: (
    period: MissionPeriod,
    rawValue: unknown,
    xpReward: number,
  ) => number;
  estimateMissionDuration: (
    metricType: MissionMetricType,
    metricValue: number,
  ) => number | null;
  extractExerciseName: (title: string) => string;
  fallbackExercisesByFocus: (focus: string, muscles: string[]) => string[];
  formatIntegerPtBr: (value: number) => string;
  getCurrentWeekday: () => string;
  inferExerciseType: (category: string) => string;
  inferRestSeconds: (metricType: MissionMetricType) => number | null;
  inferSets: (
    metricType: MissionMetricType,
    period: MissionPeriod,
  ) => number | null;
  mergeUniqueStrings: (values: string[], limit: number) => string[];
  missionConfigByPeriod: (period: MissionPeriod) => MissionConfigLike;
  getMissionMetricRulesPrompt: () => string;
  normalizeExerciseCategory: (exerciseName: string, muscle: string) => string;
  normalizeMatchText: (value: string) => string;
  parseJsonObjectFromModelContent: <T extends Record<string, unknown>>(
    content: string,
  ) => T | null;
  summarizeTrainingPlanChatPreferences: (preferences: unknown) => string;
  uniqueExercises: (
    entries: Array<{ name: string; muscle: string }>,
  ) => Array<{ name: string; muscle: string }>;
};

const LEGACY_WEEKLY_CIRCUIT_NAMES = [
  "Full Body Calisthenics Circuit",
  "Upper Body Strength & Core",
  "Lower Body Power",
  "Core Control Circuit",
  "Mobility & Recovery Circuit",
] as const;

const MISSION_GENERATION_AI_TIMEOUT_MS = 8_000;

// Numeric helpers keep monthly target generation stable across conditioning and completion-rate adjustments.
function roundToNearest(value: number, step: number): number {
  if (step <= 1) return Math.round(value);
  return Math.round(value / step) * step;
}

function clampMonthlyTarget(
  value: number,
  min: number,
  max: number,
  step = 1,
): number {
  return Math.max(min, Math.min(max, roundToNearest(value, step)));
}

function summarizeRecentMissionHistory(
  history: MissionHistorySummaryRowLike[],
): string {
  if (history.length === 0) return "Sem historico recente";
  return history
    .slice(0, 12)
    .map((entry) => {
      const title = entry.title ?? "Missao";
      const status =
        entry.status ?? (Number(entry.is_completed ?? 0) === 1 ? "completed" : "pending");
      const type = entry.type ?? "daily";
      return `${title} (${type}, ${status})`;
    })
    .join("; ");
}

export function createMissionBlueprintPlanningService(
  deps: MissionBlueprintPlanningDeps,
) {
  // Monthly counter helpers translate profile context into long-cycle progress targets.
  function normalizeGoalKeyword(value: string): string {
    return deps.normalizeMatchText(value);
  }

  function monthlyMissionCompletionTarget(
    profile: MissionGenerationProfileLike,
  ): number {
    const conditioningBonus =
      profile.conditioning === "avancado"
        ? 8
        : profile.conditioning === "intermediario"
          ? 4
          : 0;
    const estimated =
      profile.trainingFrequency * 6 +
      Math.round(profile.completionRate * 10) +
      conditioningBonus;
    return clampMonthlyTarget(estimated, 20, 45, 5);
  }

  function monthlyStepsEquivalentTarget(
    profile: MissionGenerationProfileLike,
    boost = 0,
  ): number {
    const goal = normalizeGoalKeyword(profile.mainGoal);
    let estimated =
      80_000 + Math.max(0, profile.trainingFrequency - 3) * 10_000 + boost;
    if (
      goal.includes("perda") ||
      goal.includes("emagrec") ||
      goal.includes("condicion") ||
      goal.includes("resist") ||
      goal.includes("corrid") ||
      goal.includes("caminha") ||
      goal.includes("cardio")
    ) {
      estimated += 20_000;
    }
    if (profile.conditioning === "intermediario") estimated += 10_000;
    if (profile.conditioning === "avancado") estimated += 20_000;
    return clampMonthlyTarget(estimated, 80_000, 180_000, 5_000);
  }

  function monthlyDistanceMetersTarget(
    profile: MissionGenerationProfileLike,
    boost = 0,
  ): number {
    const goal = normalizeGoalKeyword(profile.mainGoal);
    let estimated =
      18_000 + Math.max(0, profile.trainingFrequency - 3) * 3_500 + boost;
    if (
      goal.includes("perda") ||
      goal.includes("emagrec") ||
      goal.includes("condicion") ||
      goal.includes("resist") ||
      goal.includes("corrid") ||
      goal.includes("caminha") ||
      goal.includes("cardio")
    ) {
      estimated += 8_000;
    }
    if (profile.conditioning === "intermediario") estimated += 4_000;
    if (profile.conditioning === "avancado") estimated += 8_000;
    return clampMonthlyTarget(estimated, 18_000, 60_000, 1_000);
  }

  function monthlyActiveDaysTarget(
    profile: MissionGenerationProfileLike,
    boost = 0,
  ): number {
    const conditioningBonus =
      profile.conditioning === "avancado"
        ? 2
        : profile.conditioning === "intermediario"
          ? 1
          : 0;
    const estimated =
      profile.trainingFrequency * 4 +
      Math.round(profile.completionRate * 4) +
      conditioningBonus +
      boost;
    return clampMonthlyTarget(estimated, 12, 24);
  }

  function monthlyWeeklyCircuitTarget(
    profile: MissionGenerationProfileLike,
  ): number {
    const estimated = Math.round(profile.trainingFrequency / 2) + 1;
    return clampMonthlyTarget(estimated, 2, 4);
  }

  function buildMonthlyCounterGoal(
    source: MonthlyCounterSource,
    metricValue: number,
  ): string {
    if (source === "steps") {
      return `${deps.formatIntegerPtBr(metricValue)} passos acumulados`;
    }
    if (source === "distance_meters") {
      const kilometers = metricValue / 1000;
      return `${kilometers.toLocaleString("pt-BR", {
        minimumFractionDigits: kilometers % 1 === 0 ? 0 : 1,
        maximumFractionDigits: 1,
      })} km acumulados`;
    }
    if (source === "streak_days") {
      return `${deps.formatIntegerPtBr(metricValue)} dias ativos no mês`;
    }
    if (source === "weekly_circuits_completed") {
      return `${deps.formatIntegerPtBr(metricValue)} circuitos semanais concluídos`;
    }
    return `${deps.formatIntegerPtBr(metricValue)} missões concluídas`;
  }

  function buildMonthlyCounterMissionBlueprints(
    profile: MissionGenerationProfileLike,
    targetCount: number,
    options?: {
      missionOrigin?: "regular" | "ai" | undefined;
      isAiSpecial?: boolean | undefined;
    },
  ): MissionBlueprint[] {
    if (targetCount <= 0) return [];

    const missionTarget = monthlyMissionCompletionTarget(profile);
    const stepsTarget = monthlyStepsEquivalentTarget(profile);
    const distanceTarget = monthlyDistanceMetersTarget(profile);
    const activeDaysTarget = monthlyActiveDaysTarget(profile);
    const mainGoal = normalizeGoalKeyword(profile.mainGoal);

    const goalBasedChallenge =
      mainGoal.includes("flex") ||
      mainGoal.includes("mobil") ||
      mainGoal.includes("along") ||
      mainGoal.includes("yoga")
        ? {
            name: "Prática Ativa do Mês",
            source: "streak_days" as MonthlyCounterSource,
            metricType: "repetitions" as MissionMetricType,
            metricValue: monthlyActiveDaysTarget(profile, 2),
            muscle: "full body",
          }
        : mainGoal.includes("massa") ||
            mainGoal.includes("forca") ||
            mainGoal.includes("hipertrof")
          ? {
              name: "Volume Mensal de Treinos",
              source: "missions_completed" as MonthlyCounterSource,
              metricType: "repetitions" as MissionMetricType,
              metricValue: clampMonthlyTarget(missionTarget + 5, 25, 50, 5),
              muscle: "full body",
            }
          : mainGoal.includes("cardio") ||
              mainGoal.includes("condicion") ||
              mainGoal.includes("perda") ||
              mainGoal.includes("corrid") ||
              mainGoal.includes("caminha")
            ? {
                name: "Desafio Cardio do Mês",
                source: "distance_meters" as MonthlyCounterSource,
                metricType: "distance_meters" as MissionMetricType,
                metricValue: monthlyDistanceMetersTarget(profile, 8_000),
                muscle: "legs",
              }
            : {
                name: "Circuitos Semanais Concluídos",
                source: "weekly_circuits_completed" as MonthlyCounterSource,
                metricType: "repetitions" as MissionMetricType,
                metricValue: monthlyWeeklyCircuitTarget(profile),
                muscle: "full body",
              };

    const definitions = [
      {
        name: "Consistência Mensal de Missões",
        source: "missions_completed" as MonthlyCounterSource,
        metricType: "repetitions" as MissionMetricType,
        metricValue: missionTarget,
        muscle: "full body",
      },
      {
        name: "Passos do Mês",
        source: "steps" as MonthlyCounterSource,
        metricType: "steps" as MissionMetricType,
        metricValue: stepsTarget,
        muscle: "legs",
      },
      {
        name: "Distância Mensal Acumulada",
        source: "distance_meters" as MonthlyCounterSource,
        metricType: "distance_meters" as MissionMetricType,
        metricValue: distanceTarget,
        muscle: "legs",
      },
      {
        name: "Dias Ativos no Mês",
        source: "streak_days" as MonthlyCounterSource,
        metricType: "repetitions" as MissionMetricType,
        metricValue: activeDaysTarget,
        muscle: "full body",
      },
      goalBasedChallenge,
    ].slice(0, targetCount);

    return definitions.map((definition, index) => {
      const goal = buildMonthlyCounterGoal(definition.source, definition.metricValue);
      const xpReward = deps.clampXpRewardByPeriod("monthly", 620 + index * 25);
      return {
        period: "monthly",
        name: definition.name,
        description: "",
        goal,
        exerciseName: definition.name,
        muscle: definition.muscle,
        metricType: definition.metricType,
        metricValue: definition.metricValue,
        xpReward,
        pointsReward: deps.derivePointsRewardByPeriod(
          "monthly",
          140 + index * 8,
          xpReward,
        ),
        difficultyLevel: profile.conditioning,
        missionOrigin: options?.missionOrigin ?? "regular",
        isAiSpecial: options?.isAiSpecial ?? false,
        compatibilityKey: deps.normalizeMatchText(definition.name),
        compatibilityTerms: [definition.name, goal],
        subtasks: [],
      } satisfies MissionBlueprint;
    });
  }

  // Compatibility terms are the bridge between generated plans and later auto-progress matching.
  function buildMissionCompatibilityTerms(
    name: string,
    muscle: string,
    metricType: MissionMetricType,
  ): string[] {
    const exerciseName = deps.extractExerciseName(name);
    const category = deps.normalizeExerciseCategory(exerciseName, muscle);
    const localizedName = localizeMissionText(name);
    const localizedExerciseName = localizeMissionText(exerciseName);
    const localizedMuscle = localizeMissionText(muscle);
    const localizedCategory = localizeMissionText(category);
    return deps.mergeUniqueStrings(
      [
        exerciseName,
        name,
        localizedExerciseName ?? "",
        localizedName ?? "",
        muscle,
        localizedMuscle ?? "",
        category,
        localizedCategory ?? "",
        metricType,
      ],
      12,
    );
  }

  // The structured prompt preserves game rules while exposing enough profile context for the model to draft safely.
  function buildStructuredPlanPrompt(
    profile: MissionGenerationProfileLike,
    options: StructuredGenerationOptions,
    retryReason?: string,
  ): string {
    const fallbackDay =
      profile.weeklyPlan.segunda ??
      Object.values(profile.weeklyPlan).find(
        (day): day is WeeklyPlanDayLike => Boolean(day),
      ) ?? {
        focus: "full body",
        muscles: ["full body"],
        exercises: [],
      };
    const currentDay =
      profile.weeklyPlan[deps.getCurrentWeekday()] ?? fallbackDay;
    const specialRule = options.isAiSpecial
      ? "Gere apenas missoes especiais em daily_missions. weekly_missions e monthly_missions devem ser arrays vazios."
      : "Gere um plano completo com daily_missions, weekly_missions e monthly_missions respeitando os limites informados.";
    const activeChatPreferenceSummary =
      deps.summarizeTrainingPlanChatPreferences(profile.chatPlanPreferences);

    return [
      "Voce esta gerando um plano de missoes fitness para o app FitLoot.",
      "Responda APENAS JSON valido, sem markdown, sem comentarios e sem texto extra.",
      specialRule,
      `Limites: daily_missions=${options.dailyTarget}, weekly_missions=${options.weeklyTarget}, monthly_missions=${options.monthlyTarget}.`,
      "Sua funcao aqui e somente montar o plano adaptado ao usuario: escolha exercicios, volume, metas e recompensas. Alvo muscular, equipamento, instrucoes tecnicas detalhadas, GIFs e videos serao preenchidos pelas APIs de exercicio depois.",
      "Em daily_missions.name, use o nome canonico do exercicio em ingles, como aparece em catalogos de exercicios (ex.: Push-up, Air Squat, Plank, Crunch, Lunge, Glute Bridge, Walking, Running, Yoga Flow). Nao invente nomes criativos para o exercicio.",
      "Use SOMENTE metric_type: reps, seconds, distance, steps, minutes.",
      "Prancha nunca usa repeticoes.",
      "Circuito completo ou sessao longa nunca pode ser daily_mission.",
      "Weekly e monthly nao podem ter tempo estimado.",
      "Weekly devem ter goal e subtasks compostas por nomes de daily_missions compativeis.",
      "Monthly_missions podem vir vazias, porque as metas mensais regulares sao geradas pelo sistema com objetivos acumulados do mes.",
      "Em daily_missions.description, escreva 3 a 5 passos curtos de execucao em portugues brasileiro.",
      "O primeiro passo da description deve incluir alongamento ou aquecimento leve antes do treino.",
      "O ultimo passo da description deve incluir alongamento final para evitar dores musculares intensas.",
      "Para indicar quantidade em weekly_missions.subtasks, repita o nome da mesma daily_mission no array.",
      'Exemplo de circuito: "Forca de Membros Superiores e Core" => subtasks repetidas de "flexao", "abdominal" e "prancha" ate representar 5 missoes de cada.',
      "Weekly devem concentrar os detalhes em goal e subtasks. Nao liste as subtasks dentro de description.",
      `Objetivo principal: ${profile.mainGoal}`,
      `Objetivos adicionais: ${profile.goals.join(", ")}`,
      `Condicionamento: ${profile.conditioning}`,
      `Treinos por semana: ${profile.trainingFrequency}`,
      activeChatPreferenceSummary.length > 0
        ? `Preferencia ativa do usuario vinda do chat: ${activeChatPreferenceSummary}. Essa preferencia substitui qualquer foco anterior conflitante e deve orientar as proximas geracoes.`
        : "",
      `Capacidade declarada: flexao ${profile.initialCapacities.pushups}, abdominal ${profile.initialCapacities.situps}, agachamento ${profile.initialCapacities.squats}`,
      `Resumo de capacidade/historico: ${profile.capacitySummary}`,
      `Lesoes/restricoes: ${profile.injuries || "nenhuma"}`,
      `Equipamentos disponiveis: ${profile.equipment || "nenhum"}`,
      `Taxa de conclusao dos ultimos 7 dias: ${(profile.completionRate * 100).toFixed(1)}%`,
      `Resumo das missoes recentes: ${summarizeRecentMissionHistory(profile.recentHistory)}`,
      `Dia atual do plano semanal: foco=${currentDay.focus}; musculos=${currentDay.muscles.join(", ")}; exercicios=${currentDay.exercises.join(", ")}`,
      `Ajuste obrigatorio de volume: ${Math.round(profile.volumeMultiplier * 100)}% do baseline, variando no maximo 10%.`,
      deps.getMissionMetricRulesPrompt(),
      retryReason ? `ERROS A CORRIGIR: ${retryReason}` : "",
      '{ "weekly_plan": { "daily_missions": [], "weekly_missions": [], "monthly_missions": [] } }',
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  async function requestStructuredMissionPlanFromAI(
    env: Env,
    prompt: string,
  ): Promise<StructuredMissionPlanDraft> {
    const apiKey = getHuggingFaceApiKey(env);
    if (!apiKey) {
      throw new ApiIntegrationError(
        "SERVICE_NOT_CONFIGURED",
        503,
        "Hugging Face nao configurada.",
      );
    }

    const content = await requestHuggingFaceStructuredContent(
      apiKey,
      [{ role: "user", content: prompt }],
      2200,
      "requestStructuredMissionPlanFromAI",
      MISSION_GENERATION_AI_TIMEOUT_MS,
    );
    const parsed =
      deps.parseJsonObjectFromModelContent<StructuredMissionPlanDraft>(content);
    if (!parsed) {
      throw new ApiIntegrationError(
        "INVALID_RESPONSE",
        502,
        "Plano estruturado invalido retornado pela IA.",
      );
    }
    return parsed;
  }

  // Fallback drafting guarantees a valid mission plan when AI output is missing, invalid, or times out.
  function buildFallbackStructuredPlan(
    profile: MissionGenerationProfileLike,
    options: StructuredGenerationOptions,
  ): StructuredMissionPlanDraft {
    const fallbackDay =
      profile.weeklyPlan.segunda ??
      Object.values(profile.weeklyPlan).find(
        (day): day is WeeklyPlanDayLike => Boolean(day),
      ) ?? {
        focus: "full body",
        muscles: ["full body"],
        exercises: [],
      };
    const dayPlan =
      profile.weeklyPlan[deps.getCurrentWeekday()] ?? fallbackDay;
    const primaryMuscle = dayPlan.muscles[0] ?? "full body";
    const candidateEntries = deps.uniqueExercises([
      ...dayPlan.exercises.map((name) => ({ name, muscle: primaryMuscle })),
      ...deps
        .fallbackExercisesByFocus(dayPlan.focus, dayPlan.muscles)
        .map((name) => ({ name, muscle: primaryMuscle })),
    ]);

    const dailyMissions = candidateEntries
      .slice(0, options.dailyTarget)
      .map((entry, index) => {
        const metricType = getMissionMetricType(`${entry.name} ${entry.muscle}`);
        const resolvedMetricType =
          metricType === "circuit_tasks" ? "sets_reps" : metricType;
        const metricValue = deps.conditionedMetricValue(
          resolvedMetricType,
          "daily",
          profile.conditioning,
          profile.volumeMultiplier,
        );
        return {
          name: entry.name,
          description: deps.buildMissionDescriptionFromInstructions(
            deps.buildMissionInstructions(
              entry.name,
              resolvedMetricType,
              deps.inferSets(resolvedMetricType, "daily"),
              deps.inferRestSeconds(resolvedMetricType),
            ),
            deps.buildMissionDescription(
              entry.name,
              resolvedMetricType,
              metricValue,
              deps.inferSets(resolvedMetricType, "daily"),
            ),
          ),
          exercise_type: deps.inferExerciseType(
            deps.normalizeExerciseCategory(entry.name, entry.muscle),
          ),
          muscle_group: entry.muscle,
          metric_type:
            resolvedMetricType === "duration_seconds"
              ? "seconds"
              : resolvedMetricType === "distance_meters"
                ? "distance"
                : resolvedMetricType === "steps"
                  ? "steps"
                  : resolvedMetricType === "duration_minutes"
                    ? "minutes"
                    : "reps",
          sets: deps.inferSets(resolvedMetricType, "daily") ?? undefined,
          reps_or_value: metricValue,
          unit: metricUnitByType(resolvedMetricType),
          difficulty: profile.conditioning,
          xp_reward: deps.clampXpRewardByPeriod(
            "daily",
            deps.missionConfigByPeriod("daily").xp + index * 6,
          ),
          fitcoins_reward: deps.derivePointsRewardByPeriod(
            "daily",
            deps.missionConfigByPeriod("daily").points + index * 2,
            deps.missionConfigByPeriod("daily").xp,
          ),
          estimated_minutes:
            deps.estimateMissionDuration(
              resolvedMetricType,
              metricValue,
            ) ?? undefined,
        } satisfies StructuredDailyMissionDraft;
      });

    const weeklyMissions = LEGACY_WEEKLY_CIRCUIT_NAMES.slice(
      0,
      options.weeklyTarget,
    ).map((missionName, index) => ({
      name: missionName,
      description: "",
      goal: `Conclua as missões diárias compatíveis do circuito ${missionName} nesta semana.`,
      xp_reward: deps.clampXpRewardByPeriod("weekly", 260 + index * 15),
      fitcoins_reward: deps.derivePointsRewardByPeriod(
        "weekly",
        55 + index * 3,
        260 + index * 15,
      ),
      subtasks: [],
    }));

    return {
      weekly_plan: {
        daily_missions: dailyMissions,
        weekly_missions: options.isAiSpecial ? [] : weeklyMissions,
        monthly_missions: [],
      },
    };
  }

  return {
    buildFallbackStructuredPlan,
    buildMissionCompatibilityTerms,
    buildMonthlyCounterMissionBlueprints,
    buildStructuredPlanPrompt,
    requestStructuredMissionPlanFromAI,
  };
}
