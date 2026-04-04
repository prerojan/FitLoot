import type {
  CircuitTask,
  ConditioningLevel,
  MissionMetricType,
} from "../../shared/types";
import { repairKnownMojibakeString } from "../../shared/textEncoding";
import {
  resolveExerciseMediaFallbackUrlById,
  resolveStrictSupportedMissionExerciseDbId,
} from "../../shared/exerciseCatalog";
import {
  type VariantSkillSeed,
  variantSkillSeeds,
} from "../../shared/coreSkillSeeds";
import { safeGet } from "../../utils/typeHelpers";
import { getErrorMessage } from "../core/errors";
import { getHuggingFaceApiKey } from "../core/providerConfig";
import type { Env } from "../core/types";
import {
  ApiIntegrationError,
  requestHuggingFaceStructuredContent,
  timeoutMsByService,
} from "./aiTransport";
import {
  enrichExercise,
  type EnrichedExercise,
} from "./exerciseEnrichment";
import {
  ensurePortugueseExerciseLabel,
  ensurePortugueseInstructionList,
} from "./instructionLocalization";
import { sanitizeMissionExerciseNames } from "./missionExerciseSelection";

type MissionPeriod = "daily" | "weekly" | "monthly";

type MissionExerciseCategory = string;
type MissionExerciseType = string;
type MissionBodyArea = string;

type MissionPayload = {
  title: string;
  description: string;
  goal?: string | null;
  metric_type: MissionMetricType;
  metric_value: number;
  metric_unit: string;
  sets: number | null;
  rest_seconds: number | null;
  instructions: string[];
  exercise_instructions_en: string[];
  exercise_instructions_pt: string[];
  image_url: string | null;
  exercise_db_gif_url: string | null;
  exercise_db_image_url: string | null;
  muscle_groups: string[];
  exercise_secondary_muscles: string[];
  exercise_name: string | null;
  exercise_db_id: string | null;
  exercise_equipment: string | null;
  exercise_body_part: string | null;
  exercise_target: string | null;
  exercise_type: MissionExerciseType;
  body_area: MissionBodyArea;
  attributes_benefited: string[];
  xp_reward: number;
  points_reward: number;
  duration_estimate_minutes: number | null;
  exercise_category: MissionExerciseCategory;
  mission_origin: "regular" | "ai";
  is_ai_special?: number;
  circuit_tasks: CircuitTask[];
  safety_tips: string[];
  difficulty_level: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  target_reps: number | null;
  target_time: number | null;
};

type MissionPromptContext = {
  mainGoal: string;
  injuries: string;
  equipment: string;
  level: number;
  completionRate: number;
  capacitySummary: string;
  attributes: {
    strength: number;
    constitution: number;
    vitality: number;
    dexterity: number;
    focus: number;
  };
};

type ResolvedMissionSubtask = {
  title: string;
  compatibilityKey: string;
  compatibilityTerms: string[];
  requiredCount: number;
};

type MissionBlueprint = {
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

type MissionGenerationProfileSnapshot = {
  mainGoal: string;
  conditioning: ConditioningLevel;
  injuries: string;
  equipment: string;
  volumeMultiplier: number;
  level: number;
  completionRate: number;
  capacitySummary: string;
  attributes: {
    strength: number;
    constitution: number;
    vitality: number;
    dexterity: number;
    focus: number;
  };
};

type ExerciseInstructionPayload = {
  instructions: string[];
  musclesAffected: string[];
  attributesBenefited: string[];
  safetyTips: string[];
  difficultyLevel: string;
  metricType: MissionMetricType;
  metricValue: number;
};

type MissionPromptConfig = {
  titlePrefix: string;
};

type MissionMaterializationDeps = {
  applyMissionMetricContext: (
    mission: MissionPayload,
    period: MissionPeriod,
    exerciseName: string,
    metricType: MissionMetricType,
    metricValue: number,
    context: { conditioning: ConditioningLevel; volumeMultiplier: number },
  ) => MissionPayload;
  buildCircuitTasks: (exerciseName: string, period: MissionPeriod) => CircuitTask[];
  buildMissionDescription: (
    exerciseName: string,
    metricType: MissionMetricType,
    metricValue: number,
    sets: number | null,
  ) => string;
  buildMissionDescriptionFromInstructions: (instructions: string[], fallback: string) => string;
  buildMissionInstructions: (
    exerciseName: string,
    metricType: MissionMetricType,
    sets: number | null,
    restSeconds: number | null,
    instruction?: string | undefined,
  ) => string[];
  ensureInstructionSteps: (
    steps: string[],
    exerciseName: string,
    metricType: MissionMetricType,
    sets: number | null,
    restSeconds: number | null,
  ) => string[];
  estimateMissionDuration: (metricType: MissionMetricType, metricValue: number) => number | null;
  getMissionMetricType: (exerciseName: string) => MissionMetricType;
  inferAttributes: (category: MissionExerciseCategory) => string[];
  inferBodyArea: (muscle: string) => MissionBodyArea;
  inferExerciseType: (category: MissionExerciseCategory) => MissionExerciseType;
  inferRestSeconds: (metricType: MissionMetricType) => number | null;
  inferSets: (metricType: MissionMetricType, period: MissionPeriod) => number | null;
  isMissionMetricType: (value: unknown) => value is MissionMetricType;
  mergeUniqueStrings: (values: string[], limit: number) => string[];
  metricUnitByType: (metricType: MissionMetricType) => string;
  metricValueByPeriod: (metricType: MissionMetricType, period: MissionPeriod) => number;
  missionConfigByPeriod: (period: MissionPeriod) => MissionPromptConfig;
  normalizeExerciseCategory: (exerciseName: string, muscle: string) => MissionExerciseCategory;
  normalizeInstructionList: (value: unknown, limit?: number) => string[];
  normalizeMatchText: (value: string) => string;
  parseJsonObjectFromModelContent: <T extends Record<string, unknown>>(content: string) => T | null;
  resolveMetricTypeForCategory: (
    category: MissionExerciseCategory,
    exerciseName: string,
  ) => MissionMetricType;
  resolveExerciseApiBodyArea: (
    exercise: Pick<EnrichedExercise, "bodyPart" | "target"> | null | undefined,
    fallbackMuscle: string,
  ) => MissionBodyArea;
  resolveExerciseApiMuscleGroups: (
    exercise: Pick<EnrichedExercise, "target" | "secondaryMuscles"> | null | undefined,
  ) => string[];
  resolveExerciseDisplayNamePt: (exerciseName: string) => string | null | undefined;
  resolveSupportedMissionExerciseName: (exerciseName: string) => string | null | undefined;
  shouldShowMissionDuration: (period: MissionPeriod) => boolean;
  toPositiveInt: (value: unknown, fallback: number) => number;
  toSafeString: (value: unknown, fallback: string) => string;
};

const VARIANT_SEED_BY_NAME = new Map<string, VariantSkillSeed>(
  variantSkillSeeds.map((variantSeed) => [variantSeed.namePt, variantSeed]),
);

function exerciseMatchesUnlockedSkill(
  deps: MissionMaterializationDeps,
  exerciseNorm: string,
  skillNorm: string,
  variantSeed?: VariantSkillSeed | null,
): boolean {
  if (variantSeed) {
    const terms = [...variantSeed.exerciseDbTerms, ...(variantSeed.aliases ?? [])];
    for (const term of terms) {
      const normalizedTerm = deps.normalizeMatchText(repairKnownMojibakeString(term));
      if (normalizedTerm.length >= 3 && (exerciseNorm.includes(normalizedTerm) || normalizedTerm.includes(exerciseNorm))) {
        return true;
      }
    }
  }

  if (skillNorm.length >= 4 && exerciseNorm.includes(skillNorm)) return true;
  if (exerciseNorm.length >= 4 && skillNorm.includes(exerciseNorm)) return true;
  if (skillNorm.includes("flex")) return /(push|flex|diamond|close[\s-]?grip|pec|peitoral|bench)/.test(exerciseNorm);
  if (skillNorm.includes("agach")) return /(squat|agach|pistol|leg[\s-]?press|wall[\s-]?sit)/.test(exerciseNorm);
  if (skillNorm.includes("pranch") || skillNorm === "plank") return /(plank|pranch|hollow)/.test(exerciseNorm) && !/(push|flex)/.test(exerciseNorm);
  if (skillNorm.includes("abdom")) return /(crunch|sit[\s-]?up|abdom|leg[\s-]?raise|toe[\s-]?touch)/.test(exerciseNorm);
  if (skillNorm.includes("caminh") || skillNorm.includes("walk")) return /(walk|caminh|marcha|marching)/.test(exerciseNorm);
  if (skillNorm.includes("barra") && skillNorm.includes("fix")) return /(pull|chin|lat|remada|row|dead[\s-]?hang)/.test(exerciseNorm);
  if (skillNorm.includes("dip")) return /(\bdips?\b|parallel)/.test(exerciseNorm);
  return false;
}

export function createMissionMaterializationService(deps: MissionMaterializationDeps) {
  function resolveDailyExerciseForMaterialization(
    blueprint: MissionBlueprint,
  ): {
    exerciseName: string;
    strictExerciseDbId: string | null;
  } {
    const strictSupportedExerciseName =
      sanitizeMissionExerciseNames({
        requestedNames: [blueprint.exerciseName],
        muscles: [blueprint.muscle],
        focus: [blueprint.name, blueprint.description, blueprint.muscle].join(" "),
        limit: 1,
        fallbackOrder: ["focus", "muscles", "catalog"],
      })[0]
      ?? deps.resolveSupportedMissionExerciseName(blueprint.exerciseName)
      ?? null;

    if (blueprint.missionOrigin === "regular" && !strictSupportedExerciseName) {
      throw new Error(
        `REGULAR_DAILY_MISSION_UNSUPPORTED_EXERCISE:${blueprint.exerciseName}`,
      );
    }

    const exerciseName = strictSupportedExerciseName ?? blueprint.exerciseName;
    const strictExerciseDbId = resolveStrictSupportedMissionExerciseDbId(
      exerciseName,
    );

    if (blueprint.missionOrigin === "regular" && !strictExerciseDbId) {
      throw new Error(
        `REGULAR_DAILY_MISSION_REQUIRES_EXERCISE_DB_ID:${exerciseName}`,
      );
    }

    return {
      exerciseName,
      strictExerciseDbId,
    };
  }

  function extractExerciseName(title: string): string {
    const normalized = title.trim();
    if (!normalized.includes(":")) return normalized;
    const pieces = normalized.split(":");
    const suffix = pieces.slice(1).join(":").trim();
    return suffix.length > 0 ? suffix : normalized;
  }

  function buildMissionPayload(params: {
    period: MissionPeriod;
    titlePrefix: string;
    exerciseName: string;
    exerciseDbId?: string | undefined;
    muscle: string;
    imageUrl?: string | undefined;
    exerciseDbGifUrl?: string | undefined;
    exerciseDbImageUrl?: string | undefined;
    exerciseEquipment?: string | undefined;
    exerciseBodyPart?: string | undefined;
    exerciseTarget?: string | undefined;
    exerciseSecondaryMuscles?: string[] | undefined;
    exerciseInstructionsEn?: string[] | undefined;
    exerciseInstructionsPt?: string[] | undefined;
    videoUrl?: string | undefined;
    thumbnailUrl?: string | undefined;
    instruction?: string | undefined;
    safetyTips?: string[] | undefined;
    difficultyLevel?: string | undefined;
    missionOrigin?: "regular" | "ai" | undefined;
    xp: number;
    points: number;
    forceCategory?: MissionExerciseCategory | undefined;
  }): MissionPayload {
    const canonicalExerciseName = deps.resolveExerciseDisplayNamePt(params.exerciseName) ?? params.exerciseName;
    let category = params.forceCategory ?? deps.normalizeExerciseCategory(params.exerciseName, params.muscle);
    let metricType = deps.resolveMetricTypeForCategory(
      category,
      params.exerciseName,
    );
    if (params.period !== "weekly" && metricType === "circuit_tasks") {
      metricType = "sets_reps";
      category = "strength";
    }

    const metricValue = deps.metricValueByPeriod(metricType, params.period);
    const metricUnit = deps.metricUnitByType(metricType);
    const sets = metricType === "circuit_tasks" ? null : deps.inferSets(metricType, params.period);
    const restSeconds = metricType === "circuit_tasks" ? null : deps.inferRestSeconds(metricType);
    const bodyArea = deps.inferBodyArea(params.muscle);
    const exerciseType = deps.inferExerciseType(category);
    const attributes = deps.inferAttributes(category);
    const instructions = deps.buildMissionInstructions(canonicalExerciseName, metricType, sets, restSeconds, params.instruction);
    const circuitTasks = metricType === "circuit_tasks" ? deps.buildCircuitTasks(canonicalExerciseName, params.period) : [];
    const targetReps = metricType === "duration_seconds" || metricType === "duration_minutes" || metricType === "circuit_tasks" ? null : metricValue;
    const targetTime = metricType === "duration_seconds" ? metricValue : metricType === "duration_minutes" ? metricValue * 60 : null;

    return {
      title: `${params.titlePrefix}: ${canonicalExerciseName}`,
      description: metricType === "circuit_tasks" ? "" : deps.buildMissionDescriptionFromInstructions(instructions, deps.buildMissionDescription(canonicalExerciseName, metricType, metricValue, sets)),
      goal: null,
      metric_type: metricType,
      metric_value: metricValue,
      metric_unit: metricUnit,
      sets,
      rest_seconds: restSeconds,
      instructions,
      exercise_instructions_en: Array.isArray(params.exerciseInstructionsEn) ? params.exerciseInstructionsEn.slice(0, 8) : [],
      exercise_instructions_pt: Array.isArray(params.exerciseInstructionsPt) ? params.exerciseInstructionsPt.slice(0, 8) : [],
      image_url: params.imageUrl ?? null,
      exercise_db_gif_url: params.exerciseDbGifUrl ?? null,
      exercise_db_image_url: params.exerciseDbImageUrl ?? null,
      muscle_groups: [params.muscle],
      exercise_secondary_muscles: Array.isArray(params.exerciseSecondaryMuscles) ? params.exerciseSecondaryMuscles.slice(0, 8) : [],
      exercise_name: canonicalExerciseName,
      exercise_db_id: params.exerciseDbId ?? null,
      exercise_equipment: params.exerciseEquipment ?? null,
      exercise_body_part: params.exerciseBodyPart ?? null,
      exercise_target: params.exerciseTarget ?? null,
      exercise_type: exerciseType,
      body_area: bodyArea,
      attributes_benefited: attributes,
      xp_reward: params.xp,
      points_reward: params.points,
      duration_estimate_minutes: deps.shouldShowMissionDuration(params.period) ? deps.estimateMissionDuration(metricType, metricValue) : null,
      exercise_category: category,
      mission_origin: params.missionOrigin ?? "regular",
      is_ai_special: params.missionOrigin === "ai" ? 1 : 0,
      circuit_tasks: circuitTasks,
      safety_tips: Array.isArray(params.safetyTips) ? params.safetyTips : ["Mantenha postura segura e interrompa em caso de dor aguda."],
      difficulty_level: params.difficultyLevel ?? null,
      video_url: params.videoUrl ?? null,
      thumbnail_url: params.thumbnailUrl ?? null,
      target_reps: targetReps,
      target_time: targetTime,
    };
  }

  async function resolveSkillIdForExerciseMission(db: D1Database, userId: string, exerciseName: string | null | undefined): Promise<number | null> {
    if (typeof exerciseName !== "string" || exerciseName.trim().length === 0) return null;
    const rows = await db.prepare(`SELECT s.id, s.name FROM skills s INNER JOIN user_skills us ON us.skill_id = s.id AND us.user_id = ?`).bind(userId).all<{ id: number; name: string }>();
    const exerciseNorm = deps.normalizeMatchText(repairKnownMojibakeString(exerciseName));
    const list = Array.isArray(rows.results) ? rows.results : [];
    list.sort((a, b) => repairKnownMojibakeString(b.name).length - repairKnownMojibakeString(a.name).length);
    for (const row of list) {
      const skillNorm = deps.normalizeMatchText(repairKnownMojibakeString(row.name));
      const variantSeed = VARIANT_SEED_BY_NAME.get(row.name) ?? null;
      if (exerciseMatchesUnlockedSkill(deps, exerciseNorm, skillNorm, variantSeed)) return row.id;
    }
    return null;
  }

  async function translateExerciseInstructionsToPt(instructionsEn: string[], exerciseName: string, env: Env): Promise<string[]> {
    const normalizedInstructions = deps.normalizeInstructionList(instructionsEn, 8);
    if (normalizedInstructions.length === 0) return [];
    const fallbackInstructions = deps.normalizeInstructionList(
      ensurePortugueseInstructionList(normalizedInstructions, 8),
      8,
    );
    const apiKey = getHuggingFaceApiKey(env);
    if (!apiKey) return fallbackInstructions;

    const prompt = [
      "Voce traduz passos de execucao de exercicios (ingles) para portugues brasileiro (PT-BR).",
      "Mantenha exatamente o mesmo numero de itens no array, na mesma ordem.",
      "Nao deixe nenhuma palavra em ingles no resultado final.",
      "Preserve numeros, unidades (s, min, kg, repeticoes) e nomes proprios de exercicios quando fizer sentido.",
      "Tom: instrucoes curtas e claras para um app de fitness; sem introducao nem comentarios fora do JSON.",
      `Exercicio: ${exerciseName}`,
      "Responda APENAS JSON valido:",
      '{ "instructions_pt": ["passo 1", "passo 2"] }',
      "",
      `instructions_en: ${JSON.stringify(normalizedInstructions)}`,
    ].join("\n");

    try {
      const rawContent = await requestHuggingFaceStructuredContent(apiKey, [{ role: "user", content: prompt }], 900, "translateExerciseInstructionsToPt", timeoutMsByService.huggingface);
      const parsed = deps.parseJsonObjectFromModelContent<{ instructions_pt?: unknown }>(rawContent);
      const translated = deps.normalizeInstructionList(parsed?.instructions_pt ?? [], 8);
      if (translated.length > 0) {
        const localizedTranslated = deps.normalizeInstructionList(
          ensurePortugueseInstructionList(translated, 8),
          8,
        );
        return localizedTranslated.length > 0 ? localizedTranslated : translated;
      }
    } catch (error) {
      console.warn("[translateExerciseInstructionsToPt] model call failed", {
        exerciseName,
        message: getErrorMessage(error),
        details: error instanceof ApiIntegrationError ? error.details : undefined,
      });
    }
    return fallbackInstructions;
  }

  async function getExerciseInstructionsFromAI(
    exerciseName: string,
    metricType: MissionMetricType,
    conditioningLevel: string,
    env: Env,
    period: MissionPeriod = "daily",
    promptContext?: MissionPromptContext | undefined,
  ): Promise<ExerciseInstructionPayload> {
    const fallbackSets = deps.inferSets(metricType, period);
    const fallbackRestSeconds = deps.inferRestSeconds(metricType);
    const exerciseLabelPt = ensurePortugueseExerciseLabel(exerciseName);
    const normalizedMetricType = metricType === "circuit_tasks" && period !== "weekly" ? "sets_reps" : metricType;
    const fallback: ExerciseInstructionPayload = {
      instructions: deps.ensureInstructionSteps([
        `Prepare-se para executar ${exerciseLabelPt} com postura segura.`,
        "Mantenha ritmo constante e respiracao controlada durante toda a execucao.",
        "Respeite a tecnica e interrompa em caso de dor aguda.",
      ], exerciseLabelPt, normalizedMetricType, fallbackSets, fallbackRestSeconds),
      musclesAffected: [],
      attributesBenefited: [],
      safetyTips: ["Mantenha alinhamento corporal e evite compensacoes."],
      difficultyLevel: "iniciante",
      metricType: normalizedMetricType,
      metricValue: deps.metricValueByPeriod(normalizedMetricType, period),
    };

    const apiKey = getHuggingFaceApiKey(env);
    if (!apiKey) return fallback;

    const promptLines = [
      `Exercicio: ${exerciseName}`,
      `Nivel do usuario: ${conditioningLevel}`,
      `Tipo de metrica: ${metricType}`,
      `Periodo da missao: ${period}`,
    ];
    if (promptContext) {
      promptLines.push(
        `Objetivo principal: ${promptContext.mainGoal}`,
        `Lesoes/restricoes: ${promptContext.injuries || "nenhuma"}`,
        `Equipamentos disponiveis: ${promptContext.equipment || "nenhum"}`,
        `Nivel do personagem: ${promptContext.level}`,
        `Taxa de conclusao recente: ${(promptContext.completionRate * 100).toFixed(1)}%`,
        `Capacidade por exercicio base: ${promptContext.capacitySummary}`,
        `Atributos do personagem: forca ${promptContext.attributes.strength}, constituicao ${promptContext.attributes.constitution}, vitalidade ${promptContext.attributes.vitality}, destreza ${promptContext.attributes.dexterity}, foco ${promptContext.attributes.focus}`,
      );
    }

    const prompt = [
      ...promptLines,
      "",
      "Retorne 4 a 6 passos curtos em portugues brasileiro para a execucao do treino.",
      "O primeiro passo deve incluir aquecimento ou alongamento leve antes da execucao.",
      "O ultimo passo deve incluir alongamento final para evitar dores musculares intensas.",
      "Responda APENAS em JSON valido:",
      "{",
      '  "instructions": ["passo 1", "passo 2", "passo 3", "passo 4"],',
      '  "musclesAffected": ["musculo"],',
      '  "attributesBenefited": ["forca"],',
      '  "safetyTips": ["dica"],',
      '  "difficultyLevel": "iniciante|intermediario|avancado",',
      '  "metricType": "repetitions|duration_seconds|sets_reps|steps|distance_meters|duration_minutes|circuit_tasks",',
      '  "metricValue": 1',
      "}",
    ].join("\n");

    try {
      const rawContent = await requestHuggingFaceStructuredContent(apiKey, [{ role: "user", content: prompt }], 500, "getExerciseInstructionsFromAI", timeoutMsByService.huggingface);
      const parsed = deps.parseJsonObjectFromModelContent<Partial<ExerciseInstructionPayload>>(rawContent) ?? {};
      const parsedMetricType = deps.isMissionMetricType(parsed.metricType) ? parsed.metricType : fallback.metricType;
      const parsedMetricValue = deps.toPositiveInt(parsed.metricValue, fallback.metricValue);
      const parsedSets = deps.inferSets(parsedMetricType, period);
      const parsedRestSeconds = deps.inferRestSeconds(parsedMetricType);
      return {
        instructions: deps.ensureInstructionSteps(
          Array.isArray(parsed.instructions) && parsed.instructions.length > 0
            ? parsed.instructions.map((item) => String(item)).slice(0, 6)
            : fallback.instructions,
          exerciseLabelPt,
          parsedMetricType,
          parsedSets,
          parsedRestSeconds,
        ),
        musclesAffected: Array.isArray(parsed.musclesAffected) ? parsed.musclesAffected.map((item) => String(item)).slice(0, 6) : fallback.musclesAffected,
        attributesBenefited: Array.isArray(parsed.attributesBenefited) ? parsed.attributesBenefited.map((item) => String(item)).slice(0, 6) : fallback.attributesBenefited,
        safetyTips: Array.isArray(parsed.safetyTips) && parsed.safetyTips.length > 0 ? parsed.safetyTips.map((item) => String(item)).slice(0, 4) : fallback.safetyTips,
        difficultyLevel: typeof parsed.difficultyLevel === "string" && parsed.difficultyLevel.length > 0 ? parsed.difficultyLevel : fallback.difficultyLevel,
        metricType: parsedMetricType,
        metricValue: parsedMetricValue,
      };
    } catch (error) {
      console.warn("[getExerciseInstructionsFromAI] using fallback", {
        exerciseName,
        period,
        message: getErrorMessage(error),
        details: error instanceof ApiIntegrationError ? error.details : undefined,
      });
      return fallback;
    }
  }

  async function materializeMissionBlueprint(env: Env, profile: MissionGenerationProfileSnapshot, blueprint: MissionBlueprint): Promise<MissionPayload> {
    const config = deps.missionConfigByPeriod(blueprint.period);
    const shouldEnrichWithExerciseApi = blueprint.period === "daily";
    const dailyExerciseResolution = shouldEnrichWithExerciseApi
      ? resolveDailyExerciseForMaterialization(blueprint)
      : null;
    const supportedExerciseName = dailyExerciseResolution?.exerciseName ?? blueprint.exerciseName;
    const strictExerciseDbId = dailyExerciseResolution?.strictExerciseDbId ?? null;
    const strictExerciseGifUrl = strictExerciseDbId
      ? resolveExerciseMediaFallbackUrlById(strictExerciseDbId)
      : null;
    const [enriched, aiContext] = await Promise.all([
      shouldEnrichWithExerciseApi ? enrichExercise(supportedExerciseName, env).catch(() => null) : Promise.resolve(null),
      getExerciseInstructionsFromAI(
        supportedExerciseName,
        blueprint.period === "daily" ? blueprint.metricType : "circuit_tasks",
        profile.conditioning,
        env,
        blueprint.period,
        {
          mainGoal: profile.mainGoal,
          injuries: profile.injuries,
          equipment: profile.equipment,
          level: profile.level,
          completionRate: profile.completionRate,
          capacitySummary: profile.capacitySummary,
          attributes: profile.attributes,
        },
      ).catch(() => null),
    ]);

    const apiInstructionsEn = deps.normalizeInstructionList(enriched?.instructions, 8);
    const apiInstructionsPt = await translateExerciseInstructionsToPt(apiInstructionsEn, supportedExerciseName, env);
    const resolvedName = shouldEnrichWithExerciseApi ? (enriched?.name || supportedExerciseName) : supportedExerciseName;
    const baseMission = buildMissionPayload({
      period: blueprint.period,
      titlePrefix: config.titlePrefix,
      exerciseName: resolvedName,
      exerciseDbId: enriched?.id ?? strictExerciseDbId ?? undefined,
      muscle: shouldEnrichWithExerciseApi ? (enriched?.target || blueprint.muscle) : blueprint.muscle,
      imageUrl: shouldEnrichWithExerciseApi ? (enriched?.imageUrl ?? strictExerciseGifUrl ?? undefined) : undefined,
      exerciseDbGifUrl: shouldEnrichWithExerciseApi ? (enriched?.exerciseDbGifUrl ?? strictExerciseGifUrl ?? undefined) : undefined,
      exerciseDbImageUrl: shouldEnrichWithExerciseApi ? (enriched?.exerciseDbImageUrl ?? strictExerciseGifUrl ?? undefined) : undefined,
      exerciseEquipment: shouldEnrichWithExerciseApi ? (enriched?.equipment || undefined) : undefined,
      exerciseBodyPart: shouldEnrichWithExerciseApi ? (enriched?.bodyPart || undefined) : undefined,
      exerciseTarget: shouldEnrichWithExerciseApi ? (enriched?.target || blueprint.muscle) : undefined,
      exerciseSecondaryMuscles: enriched?.secondaryMuscles ?? [],
      exerciseInstructionsEn: apiInstructionsEn,
      exerciseInstructionsPt: apiInstructionsPt,
      videoUrl: shouldEnrichWithExerciseApi ? (enriched?.videoUrl ?? undefined) : undefined,
      thumbnailUrl: shouldEnrichWithExerciseApi ? (enriched?.thumbnailUrl ?? undefined) : undefined,
      instruction: safeGet(apiInstructionsPt.length > 0 ? apiInstructionsPt : apiInstructionsEn, 0),
      safetyTips: aiContext?.safetyTips,
      difficultyLevel: blueprint.difficultyLevel,
      missionOrigin: blueprint.missionOrigin,
      xp: blueprint.xpReward,
      points: blueprint.pointsReward,
      forceCategory: blueprint.period === "daily" ? deps.normalizeExerciseCategory(resolvedName, blueprint.muscle) : "cardio_circuit",
    });

    if (blueprint.period === "daily") {
      const withMetric = deps.applyMissionMetricContext(baseMission, "daily", resolvedName, blueprint.metricType, blueprint.metricValue, { conditioning: profile.conditioning, volumeMultiplier: profile.volumeMultiplier });
      withMetric.mission_origin = blueprint.missionOrigin;
      withMetric.is_ai_special = blueprint.isAiSpecial ? 1 : 0;
      const resolvedExerciseDisplayName = ensurePortugueseExerciseLabel(
        deps.resolveExerciseDisplayNamePt(enriched?.name ?? resolvedName) ?? resolvedName,
      );
      withMetric.title = `${config.titlePrefix}: ${resolvedExerciseDisplayName}`;
      withMetric.instructions = deps.ensureInstructionSteps(
        apiInstructionsPt.length > 0 ? apiInstructionsPt : withMetric.instructions,
        resolvedExerciseDisplayName,
        withMetric.metric_type,
        withMetric.sets,
        withMetric.rest_seconds,
      );
      withMetric.description = deps.buildMissionDescriptionFromInstructions(
        withMetric.instructions,
        deps.toSafeString(
          blueprint.description,
          deps.buildMissionDescription(
            resolvedExerciseDisplayName,
            withMetric.metric_type,
            withMetric.metric_value,
            withMetric.sets,
          ),
        ),
      );
      withMetric.exercise_instructions_en = apiInstructionsEn;
      withMetric.exercise_instructions_pt = apiInstructionsPt;
      withMetric.safety_tips = aiContext?.safetyTips?.length ? aiContext.safetyTips.slice(0, 4) : withMetric.safety_tips;
      withMetric.difficulty_level = blueprint.difficultyLevel;
      withMetric.exercise_name = resolvedExerciseDisplayName;
      withMetric.exercise_db_id = enriched?.id ?? strictExerciseDbId ?? withMetric.exercise_db_id;
      withMetric.exercise_equipment = enriched?.equipment ?? null;
      withMetric.exercise_body_part = enriched?.bodyPart ?? null;
      withMetric.exercise_target = enriched?.target ?? null;
      withMetric.exercise_secondary_muscles = deps.mergeUniqueStrings(Array.isArray(enriched?.secondaryMuscles) ? enriched.secondaryMuscles : [], 8);
      withMetric.muscle_groups = deps.resolveExerciseApiMuscleGroups(enriched);
      withMetric.body_area = deps.resolveExerciseApiBodyArea(enriched, blueprint.muscle);
      withMetric.exercise_db_gif_url = enriched?.exerciseDbGifUrl ?? strictExerciseGifUrl ?? withMetric.exercise_db_gif_url;
      withMetric.exercise_db_image_url = enriched?.exerciseDbImageUrl ?? strictExerciseGifUrl ?? withMetric.exercise_db_image_url;
      withMetric.image_url = enriched?.imageUrl ?? strictExerciseGifUrl ?? withMetric.image_url;
      return withMetric;
    }

    if (blueprint.period === "monthly" && blueprint.subtasks.length === 0 && blueprint.metricType !== "circuit_tasks") {
      const targetMetricValue = Math.max(1, Math.round(blueprint.metricValue));
      return {
        ...baseMission,
        title: `${config.titlePrefix}: ${blueprint.name}`,
        description: "",
        goal: blueprint.goal,
        metric_type: blueprint.metricType,
        metric_value: targetMetricValue,
        metric_unit: deps.metricUnitByType(blueprint.metricType),
        sets: null,
        rest_seconds: null,
        instructions: [],
        exercise_instructions_en: [],
        exercise_instructions_pt: [],
        image_url: null,
        exercise_db_gif_url: null,
        exercise_db_image_url: null,
        muscle_groups: [],
        exercise_secondary_muscles: [],
        exercise_name: null,
        exercise_db_id: null,
        exercise_equipment: null,
        exercise_body_part: null,
        exercise_target: null,
        exercise_type: blueprint.metricType === "steps" || blueprint.metricType === "distance_meters" ? "cardio" : "forca",
        body_area: blueprint.metricType === "steps" || blueprint.metricType === "distance_meters" ? "lower" : "full_body",
        attributes_benefited: [],
        duration_estimate_minutes: null,
        exercise_category: blueprint.metricType === "steps" || blueprint.metricType === "distance_meters" ? "walk" : "default",
        mission_origin: blueprint.missionOrigin,
        is_ai_special: blueprint.isAiSpecial ? 1 : 0,
        circuit_tasks: [],
        safety_tips: [],
        difficulty_level: blueprint.difficultyLevel,
        video_url: null,
        thumbnail_url: null,
        target_reps: null,
        target_time: null,
      };
    }

    const circuitTasks = blueprint.subtasks.map((subtask) => ({
      id: crypto.randomUUID(),
      label: subtask.title,
      mission_type: subtask.compatibilityKey,
      required_count: subtask.requiredCount,
      current_count: 0,
      completed: false,
    }));

    return {
      ...baseMission,
      title: `${config.titlePrefix}: ${blueprint.name}`,
      description: "",
      goal: blueprint.goal,
      metric_type: "circuit_tasks",
      metric_value: Math.max(1, blueprint.subtasks.reduce((total, subtask) => total + subtask.requiredCount, 0)),
      metric_unit: deps.metricUnitByType("circuit_tasks"),
      sets: null,
      rest_seconds: null,
      duration_estimate_minutes: null,
      circuit_tasks: circuitTasks,
      target_reps: null,
      target_time: null,
      exercise_category: "cardio_circuit",
      mission_origin: blueprint.missionOrigin,
      is_ai_special: blueprint.isAiSpecial ? 1 : 0,
      instructions: deps.ensureInstructionSteps(apiInstructionsPt.length > 0 ? apiInstructionsPt : baseMission.instructions, resolvedName, "circuit_tasks", null, null),
      exercise_instructions_en: apiInstructionsEn,
      exercise_instructions_pt: apiInstructionsPt,
      safety_tips: aiContext?.safetyTips?.length ? aiContext.safetyTips.slice(0, 4) : baseMission.safety_tips,
      difficulty_level: blueprint.difficultyLevel,
      image_url: null,
      exercise_db_gif_url: null,
      exercise_db_image_url: null,
      video_url: null,
      thumbnail_url: null,
      exercise_name: null,
      exercise_equipment: null,
      exercise_body_part: null,
      exercise_target: null,
      exercise_secondary_muscles: [],
      muscle_groups: deps.mergeUniqueStrings(blueprint.subtasks.map((subtask) => subtask.title), 6),
    };
  }

  return {
    buildMissionPayload,
    extractExerciseName,
    getExerciseInstructionsFromAI,
    materializeMissionBlueprint,
    resolveSkillIdForExerciseMission,
    translateExerciseInstructionsToPt,
  };
}
