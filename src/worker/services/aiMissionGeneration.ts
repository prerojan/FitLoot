import type {
  CircuitTask,
  ConditioningLevel,
  MissionMetricType,
} from "../../shared/types";
import {
  resolveExerciseMediaFallbackUrlById,
  resolveStrictSupportedMissionExerciseDbId,
} from "../../shared/exerciseCatalog";
import type { EnrichedExercise } from "./exerciseEnrichment";
import type { Env } from "../core/types";
import { resolveMissionExerciseForGeneration } from "./missionExerciseSelection";

type MissionPeriod = "daily" | "weekly" | "monthly";

export type AiMissionGenerationResult = {
  missions: Array<MissionPayloadLike & { type: MissionPeriod }>;
  fallback: boolean;
  error: string | null;
};

type MissionDraft = {
  title?: string | undefined;
  description?: string | undefined;
  skill_name?: string | undefined;
  muscle?: string | undefined;
  exercise_category?: string | undefined;
  metric_value?: number | undefined;
  sets?: number | undefined;
  rest_seconds?: number | undefined;
  instructions?: string[] | undefined;
  image_url?: string | undefined;
  xp_reward?: number | undefined;
  points_reward?: number | undefined;
};

type ExerciseInstructionPayloadLike = {
  instructions: string[];
  musclesAffected: string[];
  attributesBenefited: string[];
  safetyTips: string[];
  difficultyLevel: string;
  metricType: MissionMetricType;
  metricValue: number;
};

type MissionPayloadLike = Record<string, unknown> & {
  title: string;
  description: string;
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
  xp_reward: number;
  points_reward: number;
  duration_estimate_minutes: number | null;
  mission_origin: "regular" | "ai";
  circuit_tasks: CircuitTask[];
  safety_tips: string[];
  difficulty_level: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  target_reps: number | null;
  target_time: number | null;
  attributes_benefited: string[];
  body_area?: string | null | undefined;
};

type AiMissionGenerationDeps = {
  applyMissionMetricContext: (
    mission: MissionPayloadLike,
    period: MissionPeriod,
    exerciseName: string,
    metricType: MissionMetricType,
    metricValue: number,
  ) => MissionPayloadLike;
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
  buildMissionPayload: (params: {
    period: MissionPeriod;
    titlePrefix: string;
    exerciseName: string;
    muscle: string;
    imageUrl?: string | undefined;
    missionOrigin: "regular" | "ai";
    xp: number;
    points: number;
    forceCategory?: string | undefined;
  }) => MissionPayloadLike;
  classifyMission: (
    title: string,
    durationEstimateMinutes?: number | undefined,
  ) => "daily" | "weekly" | "monthly";
  enrichExercise: (
    exerciseName: string,
    env: Env,
    options?: { exerciseDbId?: string | null | undefined },
  ) => Promise<EnrichedExercise | null>;
  ensureInstructionSteps: (
    steps: string[],
    exerciseName: string,
    metricType: MissionMetricType,
    sets: number | null,
    restSeconds: number | null,
  ) => string[];
  extractExerciseName: (title: string) => string;
  fallbackMissionsForPeriod: (
    period: MissionPeriod,
    titlePrefix: string,
    xp: number,
    points: number,
  ) => MissionPayloadLike[];
  futureIsoForPeriod: (period: MissionPeriod) => string;
  getExerciseInstructionsFromAI: (
    exerciseName: string,
    metricType: MissionMetricType,
    conditioningLevel: string,
    env: Env,
    period?: MissionPeriod,
  ) => Promise<ExerciseInstructionPayloadLike>;
  getHuggingFaceApiKey: (env: Env) => string | null | undefined;
  insertMission: (
    db: D1Database,
    userId: string,
    period: MissionPeriod,
    deadline: string,
    mission: MissionPayloadLike,
    skillId: number | null,
  ) => Promise<number | null>;
  invalidateMissionListCache: (userId: string) => void;
  localizeMissionTextArray: (values: readonly string[] | null | undefined) => string[];
  mapWithConcurrency: <TInput, TResult>(
    items: readonly TInput[],
    concurrency: number,
    mapper: (item: TInput, index: number) => Promise<TResult>,
  ) => Promise<TResult[]>;
  mergeUniqueStrings: (values: string[], maxLength: number) => string[];
  missionMetricRulesPrompt: string;
  normalizeConditioning: (value: unknown) => ConditioningLevel;
  normalizeInstructionList: (value: unknown, limit?: number) => string[];
  parseJsonObjectFromModelContent: <T extends Record<string, unknown>>(
    content: string,
  ) => T | null;
  pointsByConditioning: (conditioning: ConditioningLevel) => number;
  requestStructuredContent: (
    apiKey: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
    routeTag: string,
    timeoutMs: number,
  ) => Promise<string>;
  resolveExerciseApiBodyArea: (
    exercise: Pick<EnrichedExercise, "bodyPart" | "target"> | null | undefined,
    fallbackMuscle: string,
  ) => string;
  resolveExerciseApiMuscleGroups: (
    exercise: Pick<EnrichedExercise, "target" | "secondaryMuscles"> | null | undefined,
  ) => string[];
  resolveExerciseDisplayNamePt: (
    exerciseName: string,
  ) => string | null | undefined;
  resolveSkillIdForExerciseMission: (
    db: D1Database,
    userId: string,
    exerciseName: string | null | undefined,
  ) => Promise<number | null>;
  resolveSupportedMissionExerciseName: (
    exerciseName: string,
  ) => string | null | undefined;
  timeoutMsHuggingFace: number;
  toPositiveInt: (value: unknown, fallback: number) => number;
  toSafeString: (value: unknown, fallback: string) => string;
  translateExerciseInstructionsToPt: (
    instructionsEn: string[],
    exerciseName: string,
    env: Env,
  ) => Promise<string[]>;
  xpByConditioning: (conditioning: ConditioningLevel) => number;
};

const MISSION_JOB_SCHEMA_TTL_MS = 60_000;
let missionJobSchemaCheckedAt = 0;

export function createAiMissionGenerationService(
  deps: AiMissionGenerationDeps,
) {
  function sanitizeMissionDraft(
    raw: MissionDraft,
    conditioning: ConditioningLevel,
    index: number,
  ): MissionPayloadLike {
    const baseTitle = `Missao Diaria ${index + 1}`;
    const rawExerciseName = deps.toSafeString(raw.skill_name ?? raw.title, baseTitle);
    const muscle = deps.toSafeString(raw.muscle, "full body");
    const exerciseName =
      resolveMissionExerciseForGeneration({
        requestedName: rawExerciseName,
        muscles: [muscle],
        focus: raw.exercise_category ?? raw.title ?? raw.skill_name ?? null,
      })
      ?? deps.resolveSupportedMissionExerciseName(rawExerciseName)
      ?? rawExerciseName;
    const forcedCategory = raw.exercise_category ?? null;

    const payload = deps.buildMissionPayload({
      period: "daily",
      titlePrefix: "Missao Diaria",
      exerciseName,
      muscle,
      imageUrl: raw.image_url,
      missionOrigin: "ai",
      xp: deps.toPositiveInt(raw.xp_reward, deps.xpByConditioning(conditioning)),
      points: deps.toPositiveInt(
        raw.points_reward,
        deps.pointsByConditioning(conditioning),
      ),
      forceCategory: forcedCategory ?? undefined,
    });

    const safeMetricValue =
      payload.metric_type === "duration_minutes"
        ? Math.min(
            deps.toPositiveInt(raw.metric_value, payload.metric_value),
            25,
          )
        : deps.toPositiveInt(raw.metric_value, payload.metric_value);
    const safeSets = raw.sets ? Math.max(1, raw.sets) : payload.sets;
    const safeRest = raw.rest_seconds
      ? Math.max(15, raw.rest_seconds)
      : payload.rest_seconds;

    return {
      ...payload,
      title: deps.toSafeString(
        raw.title,
        `Missao Diaria: ${deps.resolveExerciseDisplayNamePt(exerciseName) ?? exerciseName}`,
      ),
      description: deps.toSafeString(
        raw.description,
        deps.buildMissionDescriptionFromInstructions(
          payload.instructions,
          deps.buildMissionDescription(
            exerciseName,
            payload.metric_type,
            safeMetricValue,
            safeSets,
          ),
        ),
      ),
      metric_value: safeMetricValue,
      sets: safeSets,
      rest_seconds: safeRest,
      target_reps:
        payload.metric_type === "duration_seconds" ||
        payload.metric_type === "duration_minutes"
          ? null
          : safeMetricValue,
      target_time:
        payload.metric_type === "duration_seconds"
          ? safeMetricValue
          : payload.metric_type === "duration_minutes"
            ? safeMetricValue * 60
            : null,
      instructions:
        Array.isArray(raw.instructions) && raw.instructions.length > 0
          ? raw.instructions
              .map((item) => deps.toSafeString(item, ""))
              .filter((item) => item.length > 0)
              .slice(0, 5)
          : payload.instructions,
    };
  }

  async function generateFallbackMissions(
    conditioning: ConditioningLevel = "iniciante",
    skills: Array<{ name: string; category?: string | undefined }> = [],
  ): Promise<MissionPayloadLike[]> {
    if (skills.length === 0) {
      return deps
        .fallbackMissionsForPeriod(
          "daily",
          "Missao Diaria",
          deps.xpByConditioning(conditioning),
          deps.pointsByConditioning(conditioning),
        )
        .map((mission) => ({ ...mission, mission_origin: "ai" as const }));
    }

    return skills.slice(0, 3).map((skill, index) =>
      sanitizeMissionDraft(
        {
          title: `Missao Diaria: ${skill.name}`,
          skill_name: skill.name,
          muscle: skill.category ?? "full body",
        },
        conditioning,
        index,
      ),
    );
  }

  async function ensureMissionJobSchema(db: D1Database): Promise<void> {
    const now = Date.now();
    if (now - missionJobSchemaCheckedAt < MISSION_JOB_SCHEMA_TTL_MS) return;
    await db
      .prepare(
        "SELECT id FROM mission_generation_jobs LIMIT 1",
      )
      .first<{ id: string }>();
    missionJobSchemaCheckedAt = now;
  }

  async function generateAiMissionsForUser(
    env: Env,
    db: D1Database,
    userId: string,
    conditioningInput?: unknown,
  ): Promise<AiMissionGenerationResult> {
    const [profile, skills] = await Promise.all([
      db
        .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
        .bind(userId)
        .first<Record<string, unknown>>(),
      db
        .prepare(
          "SELECT s.* FROM skills s\n        INNER JOIN user_skills us ON s.id = us.skill_id\n        WHERE us.user_id = ?",
        )
        .bind(userId)
        .all<{ id: number; name: string; category?: string | undefined }>(),
    ]);

    const conditioning = deps.normalizeConditioning(
      conditioningInput ?? profile?.initial_conditioning,
    );
    const skillRows = skills.results as Array<{
      id: number;
      name: string;
      category?: string | undefined;
    }>;
    const baseMissions = await generateFallbackMissions(conditioning, skillRows);

    let aiMissions: MissionPayloadLike[] = [];
    let fallback = false;
    let error: string | null = null;

    const aiPrompt = [
      "Gere duas missoes fitness especificas para hoje e responda JSON com a chave missions (array).",
      "Cada missao deve conter: title, description, skill_name, muscle, exercise_category, metric_type, metric_value, sets, rest_seconds.",
      "Use SOMENTE exercicios deste catalogo suportado: Push-up, Diamond Push-up, Triceps Dip, Air Squat, Walking Lunge, Glute Bridge, Wall Sit, Calf Raise, Front Plank, 3/4 Sit-up, Crunch Floor, Dead Bug, Mountain Climber, Burpee.",
      "Nao invente exercicios, nao use walking, running, yoga, stretching, mobility flow, torso twist ou nomes genÃ©ricos.",
      `Condicionamento: ${conditioning}`,
      `Objetivo: ${String(profile?.main_goal ?? "saude_geral")}`,
      `Lesoes: ${String(profile?.injuries ?? "nenhuma")}`,
      `Equipamentos: ${String(profile?.equipment ?? "nenhum")}`,
      deps.missionMetricRulesPrompt,
    ].join("\n");

    const apiKey = deps.getHuggingFaceApiKey(env);
    if (apiKey) {
      try {
        const content = await deps.requestStructuredContent(
          apiKey,
          [{ role: "user", content: aiPrompt }],
          800,
          "legacyDailyMissionGenerator",
          deps.timeoutMsHuggingFace,
        );
        const parsed =
          deps.parseJsonObjectFromModelContent<{ missions?: MissionDraft[] }>(
            content,
          ) ?? {};
        const parsedMissions = Array.isArray(parsed.missions)
          ? parsed.missions
          : [];
        aiMissions = parsedMissions.slice(0, 2).map((mission, index) =>
          sanitizeMissionDraft(mission, conditioning, index + 3),
        );
      } catch {
        error = "Falha na IA";
        fallback = true;
      }
    } else {
      fallback = true;
      error = "IA indisponivel";
    }

    const totalMissions = [...baseMissions.slice(0, 3), ...aiMissions.slice(0, 2)].slice(
      0,
      5,
    );
    const aiMissionEntries = await deps.mapWithConcurrency(
      totalMissions,
      2,
      async (mission) => {
        const missionPeriod: MissionPeriod =
          mission.metric_type === "circuit_tasks" ||
          deps.classifyMission(
            mission.title,
            mission.duration_estimate_minutes ?? undefined,
          ) === "weekly"
            ? "weekly"
            : "daily";

        const rawExerciseName = deps.extractExerciseName(mission.title);
        const missionFocus =
          typeof mission.exercise_target === "string"
            ? mission.exercise_target
            : typeof mission.exercise_type === "string"
              ? mission.exercise_type
              : null;
        const exerciseName =
          resolveMissionExerciseForGeneration({
            requestedName: rawExerciseName,
            muscles: mission.muscle_groups,
            focus: missionFocus,
          })
          ?? deps.resolveSupportedMissionExerciseName(rawExerciseName) ??
          rawExerciseName;
        const strictExerciseDbId = resolveStrictSupportedMissionExerciseDbId(
          exerciseName,
        );
        const strictExerciseGifUrl = strictExerciseDbId
          ? resolveExerciseMediaFallbackUrlById(strictExerciseDbId)
          : null;
        const shouldEnrichWithExerciseApi = missionPeriod === "daily";
        const [enrichedMedia, aiContext] = await Promise.all([
          shouldEnrichWithExerciseApi
            ? deps.enrichExercise(exerciseName, env, {
                exerciseDbId: mission.exercise_db_id ?? strictExerciseDbId ?? null,
              }).catch(() => null)
            : Promise.resolve(null),
          deps.getExerciseInstructionsFromAI(
            exerciseName,
            mission.metric_type,
            conditioning,
            env,
            missionPeriod,
          ),
        ]);
        const apiInstructionsEn = deps.normalizeInstructionList(
          enrichedMedia?.instructions,
          8,
        );
        const apiInstructionsPt = await deps.translateExerciseInstructionsToPt(
          apiInstructionsEn,
          exerciseName,
          env,
        );
        const localizedApiInstructionsPt = deps.localizeMissionTextArray(
          apiInstructionsPt,
        );
        const missionMediaUrl =
          enrichedMedia?.gifUrl ??
          enrichedMedia?.exerciseDbGifUrl ??
          (enrichedMedia?.videoUrl ? enrichedMedia?.thumbnailUrl ?? null : null) ??
          enrichedMedia?.imageUrl ??
          strictExerciseGifUrl ??
          null;

        const withMetric = deps.applyMissionMetricContext(
          {
            ...mission,
            image_url: missionMediaUrl,
            exercise_db_id: mission.exercise_db_id ?? enrichedMedia?.id ?? strictExerciseDbId ?? null,
            exercise_db_gif_url:
              mission.exercise_db_gif_url ??
              enrichedMedia?.exerciseDbGifUrl ??
              strictExerciseGifUrl ??
              null,
            exercise_db_image_url:
              mission.exercise_db_image_url ??
              enrichedMedia?.exerciseDbImageUrl ??
              strictExerciseGifUrl ??
              null,
            exercise_name: mission.exercise_name ?? enrichedMedia?.name ?? exerciseName,
            exercise_equipment:
              mission.exercise_equipment ?? enrichedMedia?.equipment ?? null,
            exercise_body_part:
              mission.exercise_body_part ?? enrichedMedia?.bodyPart ?? null,
            exercise_target:
              mission.exercise_target ?? enrichedMedia?.target ?? null,
            exercise_secondary_muscles:
              mission.exercise_secondary_muscles.length > 0
                ? mission.exercise_secondary_muscles
                : deps.mergeUniqueStrings(
                    Array.isArray(enrichedMedia?.secondaryMuscles)
                      ? enrichedMedia.secondaryMuscles
                      : [],
                    8,
                  ),
            exercise_instructions_en:
              mission.exercise_instructions_en.length > 0
                ? mission.exercise_instructions_en
                : apiInstructionsEn,
            exercise_instructions_pt:
              mission.exercise_instructions_pt.length > 0
                ? mission.exercise_instructions_pt
                : localizedApiInstructionsPt,
            video_url: mission.video_url ?? enrichedMedia?.videoUrl ?? null,
            thumbnail_url:
              mission.thumbnail_url ?? enrichedMedia?.thumbnailUrl ?? null,
          },
          missionPeriod,
          exerciseName,
          aiContext.metricType,
          aiContext.metricValue,
        );

        const aiInstructionSource = deps.normalizeInstructionList(
          aiContext.instructions,
          6,
        );
        let mergedInstructionSource = localizedApiInstructionsPt.slice(0, 6);
        if (mergedInstructionSource.length < 4) {
          mergedInstructionSource = deps.mergeUniqueStrings(
            [...mergedInstructionSource, ...aiInstructionSource],
            6,
          );
        }
        if (mergedInstructionSource.length === 0) {
          mergedInstructionSource = aiInstructionSource;
        }

        const combinedMuscles =
          deps.resolveExerciseApiMuscleGroups(enrichedMedia);
        const displayExerciseName =
          deps.resolveExerciseDisplayNamePt(enrichedMedia?.name || exerciseName) ??
          deps.resolveExerciseDisplayNamePt(rawExerciseName) ??
          rawExerciseName;

        const withDetails: MissionPayloadLike = {
          ...withMetric,
          mission_origin: "ai",
          title:
            missionPeriod === "daily"
              ? `Missao Diaria: ${displayExerciseName}`
              : mission.title,
          instructions: deps.ensureInstructionSteps(
            mergedInstructionSource.length > 0
              ? mergedInstructionSource
              : withMetric.instructions,
            exerciseName,
            withMetric.metric_type,
            withMetric.sets,
            withMetric.rest_seconds,
          ),
          exercise_instructions_en: apiInstructionsEn,
          exercise_instructions_pt: localizedApiInstructionsPt,
          safety_tips:
            aiContext.safetyTips.length > 0
              ? aiContext.safetyTips.slice(0, 4)
              : withMetric.safety_tips,
          difficulty_level: aiContext.difficultyLevel,
          muscle_groups: combinedMuscles,
          exercise_secondary_muscles: deps.mergeUniqueStrings(
            Array.isArray(enrichedMedia?.secondaryMuscles)
              ? enrichedMedia.secondaryMuscles
              : [],
            8,
          ),
          exercise_name:
            deps.resolveExerciseDisplayNamePt(
              enrichedMedia?.name || (withMetric.exercise_name ?? exerciseName),
            ) ??
            enrichedMedia?.name ??
            withMetric.exercise_name ??
            exerciseName,
          exercise_db_id: enrichedMedia?.id ?? withMetric.exercise_db_id,
          exercise_equipment: enrichedMedia?.equipment ?? null,
          exercise_body_part: enrichedMedia?.bodyPart ?? null,
          exercise_target: enrichedMedia?.target ?? null,
          exercise_db_gif_url:
            enrichedMedia?.exerciseDbGifUrl ?? strictExerciseGifUrl ?? withMetric.exercise_db_gif_url,
          exercise_db_image_url:
            enrichedMedia?.exerciseDbImageUrl ??
            strictExerciseGifUrl ??
            withMetric.exercise_db_image_url,
          attributes_benefited:
            aiContext.attributesBenefited.length > 0
              ? aiContext.attributesBenefited.slice(0, 6)
              : withMetric.attributes_benefited,
        };
        withDetails.body_area = deps.resolveExerciseApiBodyArea(
          enrichedMedia,
          mission.exercise_target ??
            mission.muscle_groups[0] ??
            exerciseName,
        );
        withDetails.description =
          withDetails.metric_type === "circuit_tasks"
            ? ""
            : deps.buildMissionDescriptionFromInstructions(
                withDetails.instructions,
                deps.buildMissionDescription(
                  exerciseName,
                  withDetails.metric_type,
                  withDetails.metric_value,
                  withDetails.sets,
                ),
              );
        if (withDetails.metric_type === "circuit_tasks") {
          withDetails.image_url = null;
          withDetails.exercise_db_gif_url = null;
          withDetails.exercise_db_image_url = null;
          withDetails.video_url = null;
          withDetails.thumbnail_url = null;
          withDetails.exercise_name = null;
          withDetails.exercise_db_id = null;
          withDetails.exercise_equipment = null;
          withDetails.exercise_body_part = null;
          withDetails.exercise_target = null;
          withDetails.exercise_secondary_muscles = [];
          withDetails.muscle_groups = deps.mergeUniqueStrings(
            withDetails.circuit_tasks.map((task) => task.label),
            6,
          );
        }

        return {
          period: missionPeriod,
          deadline: deps.futureIsoForPeriod(missionPeriod),
          mission: withDetails,
        };
      },
    );

    for (const entry of aiMissionEntries) {
      const mission = entry.mission;
      const exerciseLabel =
        typeof mission.exercise_name === "string" &&
        mission.exercise_name.trim().length > 0
          ? mission.exercise_name.trim()
          : deps.extractExerciseName(deps.toSafeString(mission.title, ""));
      const skillId = await deps.resolveSkillIdForExerciseMission(
        db,
        userId,
        exerciseLabel,
      );

      await deps.insertMission(
        db,
        userId,
        entry.period,
        entry.deadline,
        entry.mission,
        skillId,
      );
    }

    deps.invalidateMissionListCache(userId);

    return {
      missions: aiMissionEntries.map((entry) => ({
        ...entry.mission,
        type: entry.period,
      })),
      fallback,
      error,
    };
  }

  return {
    ensureMissionJobSchema,
    generateAiMissionsForUser,
  };
}
