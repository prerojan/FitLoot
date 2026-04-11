import type {
  CircuitTask,
  MissionMetricType,
} from "../../shared/types";
import {
  isSupportedRouteMissionExercise,
  resolveExerciseDisplayNamePt,
  resolveExerciseMediaFallbackUrlById,
  resolvePreferredExerciseDbId,
  resolveSupportedMissionExerciseName,
} from "../../shared/exerciseCatalog";
import {
  localizeMissionText,
  localizeMissionTextArray,
  normalizeMissionMediaUrl,
} from "../../shared/missionLocalization";
import { hasTableColumn } from "../core/database";
import { getOpenRouterApiKey } from "../core/providerConfig";
import type { Env } from "../core/types";
import {
  enrichExercise,
  type EnrichedExercise,
} from "./exerciseEnrichment";
import { resolveMissionExerciseForGeneration } from "./missionExerciseSelection";

type MissionRepairPayload = {
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
  exercise_type: string;
  body_area: string;
  attributes_benefited: string[];
  xp_reward: number;
  points_reward: number;
  duration_estimate_minutes: number | null;
  exercise_category: string;
  mission_origin: "regular" | "ai";
  is_ai_special: number;
  circuit_tasks: CircuitTask[];
  safety_tips: string[];
  difficulty_level: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  target_reps: number | null;
  target_time: number | null;
};

type LegacyMissionRepairDeps = {
  applyMissionMetricContext: (
    payload: MissionRepairPayload,
    period: "daily",
    exerciseName: string,
    metricType: MissionMetricType,
    metricValue: number,
  ) => MissionRepairPayload;
  createMissionsForPeriod: (
    env: Env,
    db: D1Database,
    userId: string,
    period: "daily",
    limit?: number,
  ) => Promise<void>;
  ensureInstructionSteps: (
    steps: string[],
    exerciseName: string,
    metricType: MissionMetricType,
    sets: number | null,
    restSeconds: number | null,
  ) => string[];
  extractExerciseName: (title: string) => string;
  getMissionMetricType: (exerciseName: string) => MissionMetricType;
  inferAttributes: (category: string) => string[];
  inferExerciseType: (category: string) => string;
  invalidateMissionListCache: (userId: string) => void;
  metricUnitByType: (metricType: MissionMetricType) => string;
  metricValueByPeriod: (
    metricType: MissionMetricType,
    period: "daily",
  ) => number;
  normalizeExerciseCategory: (
    exerciseName: string,
    muscle: string,
  ) => string;
  normalizeInstructionList: (value: unknown, limit?: number) => string[];
  normalizeMatchText: (value: string) => string;
  normalizeMissionMetricType: (
    rawType: unknown,
    rawTargetTime: unknown,
  ) => MissionMetricType;
  parseMissionArrayField: (rawValue: unknown) => string[];
  resolveExerciseApiBodyArea: (
    exercise: Pick<EnrichedExercise, "bodyPart" | "target"> | null | undefined,
    fallbackMuscle: string,
  ) => string;
  resolveExerciseApiMuscleGroups: (
    exercise: Pick<EnrichedExercise, "target" | "secondaryMuscles"> | null | undefined,
  ) => string[];
  stripMissionDisplayTitlePrefix: (value: string) => string;
  translateExerciseInstructionsToPt: (
    instructionsEn: string[],
    exerciseName: string,
    env: Env,
  ) => Promise<string[]>;
};

const ENGLISH_INSTRUCTION_TOKEN_REGEX =
  /\b(with|your|feet|foot|hands?|arms?|body|core|floor|ground|starting|start|position|pause|moment|above|push|pull|straighten|repeat|desired|number|repetitions?|seconds?|hold|keep|slightly|together|bend|bending|lower|raise|return|towards?|while|shoulders?|chest|elbows?|back)\b/i;

function instructionStillLooksEnglish(
  deps: LegacyMissionRepairDeps,
  referenceEn: string,
  candidatePt: string,
): boolean {
  const normalizedReference = deps.normalizeMatchText(referenceEn);
  const normalizedCandidate = deps.normalizeMatchText(candidatePt);
  if (!normalizedCandidate) return true;
  if (normalizedCandidate === normalizedReference) return true;
  return ENGLISH_INSTRUCTION_TOKEN_REGEX.test(candidatePt);
}

function exerciseInstructionPtNeedsAiTranslation(
  deps: LegacyMissionRepairDeps,
  en: string[],
  pt: string[],
): boolean {
  const normEn = deps.normalizeInstructionList(en, 8);
  const normPt = deps.normalizeInstructionList(pt, 8);
  if (normEn.length === 0) return false;
  if (normPt.length === 0) return true;
  if (normEn.length !== normPt.length) return true;
  for (let i = 0; i < normEn.length; i += 1) {
    if (instructionStillLooksEnglish(deps, normEn[i] ?? "", normPt[i] ?? "")) {
      return true;
    }
  }
  return false;
}

function localizeInstructionListFallback(
  deps: LegacyMissionRepairDeps,
  instructionsEn: string[],
): string[] {
  return deps.normalizeInstructionList(
    instructionsEn.map((line) => localizeMissionText(line) ?? line),
    8,
  );
}

function missionMetadataLooksMismatched(
  deps: LegacyMissionRepairDeps,
  exerciseName: string,
  row: Record<string, unknown>,
): boolean {
  const normalizedExerciseName = deps.normalizeMatchText(exerciseName);
  const normalizedResolvedName = deps.normalizeMatchText(String(row.exercise_name ?? ""));
  const normalizedTarget = deps.normalizeMatchText(String(row.exercise_target ?? ""));
  const normalizedBodyPart = deps.normalizeMatchText(String(row.exercise_body_part ?? ""));

  if (normalizedExerciseName.includes("push") || normalizedExerciseName.includes("flexao")) {
    return !normalizedResolvedName.includes("push")
      || normalizedTarget.includes("abs")
      || normalizedBodyPart.includes("waist");
  }

  if (normalizedExerciseName.includes("plank") || normalizedExerciseName.includes("prancha")) {
    return !normalizedResolvedName.includes("plank")
      || normalizedResolvedName.includes("twist")
      || normalizedResolvedName.includes("weighted")
      || normalizedResolvedName.includes("power point")
      || (normalizedTarget.length > 0 && !normalizedTarget.includes("abs"))
      || (normalizedBodyPart.length > 0 && !normalizedBodyPart.includes("waist"));
  }

  if (
    normalizedExerciseName.includes("crunch")
    || normalizedExerciseName.includes("abdominal")
    || normalizedExerciseName.includes("sit up")
    || normalizedExerciseName.includes("situp")
  ) {
    const resolvedLooksAbdominal =
      normalizedResolvedName.includes("crunch")
      || normalizedResolvedName.includes("sit up")
      || normalizedResolvedName.includes("situp");
    const targetLooksAbdominal =
      normalizedTarget.includes("abs")
      || normalizedTarget.includes("waist");
    const bodyPartLooksAbdominal =
      normalizedBodyPart.includes("waist")
      || normalizedBodyPart.includes("abs");
    const resolvedLooksWrongVariant =
      normalizedResolvedName.includes("weighted")
      || normalizedResolvedName.includes("oblique")
      || normalizedResolvedName.includes("groin")
      || normalizedResolvedName.includes("reverse");
    return !resolvedLooksAbdominal
      || !targetLooksAbdominal
      || !bodyPartLooksAbdominal
      || resolvedLooksWrongVariant;
  }

  if (normalizedExerciseName.includes("lunge") || normalizedExerciseName.includes("avanco")) {
    return !normalizedResolvedName.includes("lunge")
      || normalizedTarget.includes("abs")
      || normalizedBodyPart.includes("waist");
  }

  if (normalizedExerciseName.includes("squat") || normalizedExerciseName.includes("agach")) {
    return !normalizedResolvedName.includes("squat")
      || normalizedTarget.includes("abs")
      || normalizedBodyPart.includes("waist");
  }

  if (normalizedExerciseName.includes("dead bug")) {
    return !normalizedResolvedName.includes("dead bug")
      || (normalizedTarget.length > 0 && !normalizedTarget.includes("abs"))
      || (normalizedBodyPart.length > 0 && !normalizedBodyPart.includes("waist"));
  }

  if (normalizedExerciseName.includes("bird dog")) {
    return !normalizedResolvedName.includes("bird dog")
      || normalizedResolvedName.includes("weighted")
      || normalizedResolvedName.includes("machine");
  }

  if (normalizedExerciseName.includes("hollow")) {
    return !normalizedResolvedName.includes("hollow")
      || normalizedResolvedName.includes("weighted")
      || normalizedResolvedName.includes("machine");
  }

  return false;
}

function resolveLegacyDailyRepairIdentity(
  deps: LegacyMissionRepairDeps,
  row: Record<string, unknown>,
): {
  sourceExerciseName: string;
  supportedExerciseName: string | null;
} {
  const storedExerciseName =
    typeof row.exercise_name === "string"
      ? deps.stripMissionDisplayTitlePrefix(row.exercise_name).trim()
      : "";
  const titleExerciseName =
    typeof row.title === "string" ? deps.extractExerciseName(row.title).trim() : "";
  const localizedStoredExerciseName =
    typeof localizeMissionText(storedExerciseName) === "string"
      ? String(localizeMissionText(storedExerciseName)).trim()
      : "";
  const localizedTitleExerciseName =
    typeof localizeMissionText(titleExerciseName) === "string"
      ? String(localizeMissionText(titleExerciseName)).trim()
      : "";

  const storedSupportedExerciseName =
    resolveMissionExerciseForGeneration({
      requestedName: storedExerciseName,
      muscles: [],
      focus: null,
    })
    ?? resolveSupportedMissionExerciseName(storedExerciseName)
    ?? resolveSupportedMissionExerciseName(localizedStoredExerciseName);
  const titleSupportedExerciseName =
    resolveMissionExerciseForGeneration({
      requestedName: titleExerciseName,
      muscles: [],
      focus: null,
    })
    ?? resolveSupportedMissionExerciseName(titleExerciseName)
    ?? resolveSupportedMissionExerciseName(localizedTitleExerciseName);

  let supportedExerciseName = storedSupportedExerciseName ?? titleSupportedExerciseName ?? null;
  if (
    storedSupportedExerciseName
    && titleSupportedExerciseName
    && missionMetadataLooksMismatched(deps, storedSupportedExerciseName, row)
  ) {
    supportedExerciseName = titleSupportedExerciseName;
  }

  const sourceExerciseName =
    supportedExerciseName
    || storedExerciseName
    || localizedStoredExerciseName
    || titleExerciseName
    || localizedTitleExerciseName
    || "";

  return {
    sourceExerciseName: sourceExerciseName.trim(),
    supportedExerciseName,
  };
}

function legacyDailyMetricNeedsRepair(
  deps: LegacyMissionRepairDeps,
  exerciseName: string,
  metricType: MissionMetricType,
  metricValue: number,
): boolean {
  const expectedMetricType = deps.getMissionMetricType(exerciseName);
  if (metricType !== expectedMetricType) {
    return true;
  }

  if (expectedMetricType === "steps") return metricValue < 2_000;
  if (expectedMetricType === "distance_meters") return metricValue < 800;
  if (expectedMetricType === "duration_minutes") return metricValue < 5;
  if (expectedMetricType === "duration_seconds") return metricValue < 30;
  return false;
}

export function createLegacyMissionRepairService(deps: LegacyMissionRepairDeps) {
  async function repairLegacyDailyMissionMetadata(
    env: Env,
    db: D1Database,
    userId: string,
    options?: { limit?: number | undefined },
  ): Promise<void> {
    const hasExerciseDbIdColumn = await hasTableColumn(
      db,
      "missions",
      "exercise_db_id",
    );
    const rows = await db.prepare(
      `SELECT *
        FROM missions
        WHERE user_id = ?
          AND type = 'daily'
          AND is_completed = 0
          AND (deadline IS NULL OR deadline > datetime('now'))
        ORDER BY datetime(created_at) DESC, id DESC`,
    ).bind(userId).all<Record<string, unknown>>();
    const maxRepairs = Math.max(
      1,
      Number(options?.limit ?? Number.POSITIVE_INFINITY),
    );
    let repairedCount = 0;
    const missionIdsToRegenerate: number[] = [];

    for (const row of Array.isArray(rows.results) ? rows.results : []) {
      if (repairedCount >= maxRepairs) {
        break;
      }

      const hasMedia = [
        row.exercise_db_gif_url,
        row.exercise_db_image_url,
        row.image_url,
        row.video_url,
        row.thumbnail_url,
      ].some(
        (value) =>
          typeof value === "string" && normalizeMissionMediaUrl(value) !== null,
      );
      const hasExerciseMetadata = [
        row.exercise_equipment,
        row.exercise_body_part,
        row.exercise_target,
      ].some(
        (value) =>
          typeof value === "string"
          && value.trim().length > 0
          && deps.normalizeMatchText(value) !== "full body",
      );

      const repairIdentity = resolveLegacyDailyRepairIdentity(deps, row);
      const exerciseName = (
        repairIdentity.supportedExerciseName ?? repairIdentity.sourceExerciseName
      ).trim();
      if (exerciseName.length === 0) {
        continue;
      }

      const currentMetricType = deps.normalizeMissionMetricType(
        row.metric_type,
        row.target_time,
      );
      const currentMetricValue = Math.max(
        1,
        Number(row.metric_value ?? row.target_reps ?? row.target_time ?? 1),
      );
      const requiresMetricRepair = legacyDailyMetricNeedsRepair(
        deps,
        exerciseName,
        currentMetricType,
        currentMetricValue,
      );
      const currentInstructionsEn = deps.parseMissionArrayField(
        row.exercise_instructions_en_json,
      );
      const currentInstructionsPt = deps.parseMissionArrayField(
        row.exercise_instructions_pt_json,
      );
      const requiresInstructionTranslationRepair =
        Boolean(getOpenRouterApiKey(env))
        && exerciseInstructionPtNeedsAiTranslation(
          deps,
          currentInstructionsEn,
          currentInstructionsPt,
        );
      const hasSupportedExercise =
        repairIdentity.supportedExerciseName !== null;

      if (!hasSupportedExercise) {
        const missionId = Number(row.id ?? 0);
        if (missionId > 0) {
          missionIdsToRegenerate.push(missionId);
          repairedCount += 1;
        }
        continue;
      }

      if (isSupportedRouteMissionExercise(exerciseName)) {
        continue;
      }

      if (
        hasMedia
        && hasExerciseMetadata
        && !missionMetadataLooksMismatched(deps, exerciseName, row)
        && !requiresMetricRepair
        && !requiresInstructionTranslationRepair
      ) {
        continue;
      }

      const preferredExerciseDbId = resolvePreferredExerciseDbId(exerciseName);
      const enriched = await enrichExercise(exerciseName, env, {
        exerciseDbId:
          preferredExerciseDbId
          ?? (typeof row.exercise_db_id === "string" ? row.exercise_db_id : null),
      }).catch(() => null);
      const apiInstructionsEn = deps.normalizeInstructionList(
        enriched?.instructions,
        8,
      );
      const resolvedExerciseName = enriched?.name || exerciseName;
      const resolvedExerciseDisplayName =
        resolveExerciseDisplayNamePt(resolvedExerciseName)
        ?? resolvedExerciseName;
      const sourceInstructionsEn =
        apiInstructionsEn.length > 0 ? apiInstructionsEn : currentInstructionsEn;
      const apiInstructionsPt = sourceInstructionsEn.length > 0
        ? await deps.translateExerciseInstructionsToPt(
          sourceInstructionsEn,
          resolvedExerciseDisplayName,
          env,
        )
        : currentInstructionsPt;
      const localizedApiInstructionsPt =
        localizeMissionTextArray(apiInstructionsPt);
      const currentSets =
        row.sets === null || row.sets === undefined ? null : Number(row.sets);
      const currentRestSeconds =
        row.rest_seconds === null || row.rest_seconds === undefined
          ? null
          : Number(row.rest_seconds);
      const mergedSteps = sourceInstructionsEn.length > 0
        ? (
          localizedApiInstructionsPt.length > 0
            ? localizedApiInstructionsPt
            : localizeInstructionListFallback(deps, sourceInstructionsEn)
        )
        : deps.parseMissionArrayField(row.instructions_json);
      const persistedInstructions = deps.ensureInstructionSteps(
        deps.normalizeInstructionList(mergedSteps, 6),
        resolvedExerciseDisplayName,
        currentMetricType,
        currentSets,
        currentRestSeconds,
      );

      if (requiresMetricRepair) {
        const resolvedTarget = enriched?.target || "";
        const resolvedCategory = deps.normalizeExerciseCategory(
          resolvedExerciseDisplayName,
          resolvedTarget,
        );
        const repairedMetricPayload = deps.applyMissionMetricContext(
          {
            title:
              typeof row.title === "string" && row.title.trim().length > 0
                ? row.title
                : `Missao Diaria: ${resolvedExerciseDisplayName}`,
            description:
              typeof row.description === "string" ? row.description : "",
            goal: typeof row.goal === "string" ? row.goal : null,
            metric_type: currentMetricType,
            metric_value: currentMetricValue,
            metric_unit:
              typeof row.metric_unit === "string" && row.metric_unit.trim().length > 0
                ? row.metric_unit
                : deps.metricUnitByType(currentMetricType),
            sets: currentSets,
            rest_seconds: currentRestSeconds,
            instructions: persistedInstructions,
            exercise_instructions_en: apiInstructionsEn,
            exercise_instructions_pt: localizedApiInstructionsPt,
            image_url: enriched?.imageUrl ?? null,
            exercise_db_gif_url: enriched?.exerciseDbGifUrl ?? null,
            exercise_db_image_url: enriched?.exerciseDbImageUrl ?? null,
            muscle_groups: deps.resolveExerciseApiMuscleGroups(enriched),
            exercise_secondary_muscles: Array.isArray(
              enriched?.secondaryMuscles,
            )
              ? enriched.secondaryMuscles
              : [],
            exercise_name: resolvedExerciseDisplayName,
            exercise_db_id: enriched?.id ?? preferredExerciseDbId ?? null,
            exercise_equipment: enriched?.equipment || null,
            exercise_body_part: enriched?.bodyPart || null,
            exercise_target: enriched?.target || null,
            exercise_type: deps.inferExerciseType(resolvedCategory),
            body_area: deps.resolveExerciseApiBodyArea(enriched, exerciseName),
            attributes_benefited: deps.inferAttributes(resolvedCategory),
            xp_reward: 0,
            points_reward: 0,
            duration_estimate_minutes:
              row.duration_estimate_minutes === null
              || row.duration_estimate_minutes === undefined
                ? null
                : Number(row.duration_estimate_minutes),
            exercise_category: resolvedCategory,
            mission_origin: "regular",
            is_ai_special: 0,
            circuit_tasks: [],
            safety_tips: [],
            difficulty_level: null,
            video_url: enriched?.videoUrl ?? null,
            thumbnail_url: enriched?.thumbnailUrl ?? null,
            target_reps:
              row.target_reps === null || row.target_reps === undefined
                ? null
                : Number(row.target_reps),
            target_time:
              row.target_time === null || row.target_time === undefined
                ? null
                : Number(row.target_time),
          },
          "daily",
          resolvedExerciseDisplayName,
          deps.getMissionMetricType(resolvedExerciseDisplayName),
          deps.metricValueByPeriod(
            deps.getMissionMetricType(resolvedExerciseDisplayName),
            "daily",
          ),
        );

        const repairedTitle = `Missao Diaria: ${resolvedExerciseDisplayName}`;
        const metricRepairSql = hasExerciseDbIdColumn
          ? `UPDATE missions
           SET title = ?,
               description = ?,
               metric_type = ?,
               metric_value = ?,
               metric_unit = ?,
               target_reps = ?,
               target_time = ?,
               sets = ?,
               rest_seconds = ?,
               duration_estimate_minutes = ?,
               exercise_category = ?,
               exercise_type = ?,
               exercise_name = ?,
               exercise_db_id = ?,
               exercise_equipment = ?,
               exercise_body_part = ?,
               exercise_target = ?,
               exercise_secondary_muscles_json = ?,
               exercise_db_gif_url = ?,
               exercise_db_image_url = ?,
               image_url = ?,
               video_url = ?,
               thumbnail_url = ?,
               muscle_groups_json = ?,
               body_area = ?,
               exercise_instructions_en_json = ?,
               exercise_instructions_pt_json = ?,
               instructions_json = ?,
               updated_at = datetime('now')
          WHERE id = ?`
          : `UPDATE missions
           SET title = ?,
               description = ?,
               metric_type = ?,
               metric_value = ?,
               metric_unit = ?,
               target_reps = ?,
               target_time = ?,
               sets = ?,
               rest_seconds = ?,
               duration_estimate_minutes = ?,
               exercise_category = ?,
               exercise_type = ?,
               exercise_name = ?,
               exercise_equipment = ?,
               exercise_body_part = ?,
               exercise_target = ?,
               exercise_secondary_muscles_json = ?,
               exercise_db_gif_url = ?,
               exercise_db_image_url = ?,
               image_url = ?,
               video_url = ?,
               thumbnail_url = ?,
               muscle_groups_json = ?,
               body_area = ?,
               exercise_instructions_en_json = ?,
               exercise_instructions_pt_json = ?,
               instructions_json = ?,
               updated_at = datetime('now')
         WHERE id = ?`;

        const metricRepairValues: unknown[] = [
          repairedTitle,
          repairedMetricPayload.description,
          repairedMetricPayload.metric_type,
          repairedMetricPayload.metric_value,
          repairedMetricPayload.metric_unit,
          repairedMetricPayload.target_reps,
          repairedMetricPayload.target_time,
          repairedMetricPayload.sets,
          repairedMetricPayload.rest_seconds,
          repairedMetricPayload.duration_estimate_minutes,
          repairedMetricPayload.exercise_category,
          repairedMetricPayload.exercise_type,
          resolveExerciseDisplayNamePt(repairedMetricPayload.exercise_name)
            ?? repairedMetricPayload.exercise_name,
        ];

        if (hasExerciseDbIdColumn) {
          metricRepairValues.push(repairedMetricPayload.exercise_db_id);
        }

        metricRepairValues.push(
          repairedMetricPayload.exercise_equipment,
          repairedMetricPayload.exercise_body_part,
          repairedMetricPayload.exercise_target,
          JSON.stringify(repairedMetricPayload.exercise_secondary_muscles),
          repairedMetricPayload.exercise_db_gif_url,
          repairedMetricPayload.exercise_db_image_url,
          repairedMetricPayload.image_url,
          repairedMetricPayload.video_url,
          repairedMetricPayload.thumbnail_url,
          JSON.stringify(repairedMetricPayload.muscle_groups),
          repairedMetricPayload.body_area,
          JSON.stringify(repairedMetricPayload.exercise_instructions_en),
          JSON.stringify(repairedMetricPayload.exercise_instructions_pt),
          JSON.stringify(repairedMetricPayload.instructions),
          row.id,
        );

        await db.prepare(metricRepairSql).bind(...metricRepairValues).run();
        repairedCount += 1;
        continue;
      }

      const preserveExistingMedia = !missionMetadataLooksMismatched(
        deps,
        exerciseName,
        row,
      );
      const resolvedExerciseDbIdForStorage =
        enriched?.id ?? preferredExerciseDbId ?? null;
      const resolvedExerciseDbGifUrl = enriched?.exerciseDbGifUrl
        ?? resolveExerciseMediaFallbackUrlById(resolvedExerciseDbIdForStorage)
        ?? (
          preserveExistingMedia
            ? normalizeMissionMediaUrl(
              typeof row.exercise_db_gif_url === "string"
                ? row.exercise_db_gif_url
                : null,
            )
            : null
        );
      const resolvedExerciseDbImageUrl = enriched?.exerciseDbImageUrl
        ?? resolveExerciseMediaFallbackUrlById(resolvedExerciseDbIdForStorage)
        ?? (
          preserveExistingMedia
            ? normalizeMissionMediaUrl(
              typeof row.exercise_db_image_url === "string"
                ? row.exercise_db_image_url
                : null,
            )
            : null
        );
      const resolvedImageUrl = enriched?.imageUrl
        ?? resolveExerciseMediaFallbackUrlById(resolvedExerciseDbIdForStorage)
        ?? (
          preserveExistingMedia
            ? normalizeMissionMediaUrl(
              typeof row.image_url === "string" ? row.image_url : null,
            )
            : null
        );
      const resolvedVideoUrl = enriched?.videoUrl
        ?? (
          preserveExistingMedia
            ? normalizeMissionMediaUrl(
              typeof row.video_url === "string" ? row.video_url : null,
            )
            : null
        );
      const resolvedThumbnailUrl = enriched?.thumbnailUrl
        ?? (
          preserveExistingMedia
            ? normalizeMissionMediaUrl(
              typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
            )
            : null
        );
      const repairedTitle = `Missao Diaria: ${resolvedExerciseDisplayName}`;
      const metadataRepairSql = hasExerciseDbIdColumn
        ? `UPDATE missions
           SET title = ?,
               exercise_name = ?,
               exercise_db_id = ?,
               exercise_equipment = ?,
               exercise_body_part = ?,
               exercise_target = ?,
               exercise_secondary_muscles_json = ?,
               exercise_db_gif_url = ?,
               exercise_db_image_url = ?,
               image_url = ?,
               video_url = ?,
               thumbnail_url = ?,
               muscle_groups_json = ?,
               body_area = ?,
               exercise_instructions_en_json = ?,
               exercise_instructions_pt_json = ?,
               instructions_json = ?,
               updated_at = datetime('now')
          WHERE id = ?`
        : `UPDATE missions
           SET title = ?,
               exercise_name = ?,
               exercise_equipment = ?,
               exercise_body_part = ?,
               exercise_target = ?,
               exercise_secondary_muscles_json = ?,
               exercise_db_gif_url = ?,
               exercise_db_image_url = ?,
               image_url = ?,
               video_url = ?,
               thumbnail_url = ?,
               muscle_groups_json = ?,
               body_area = ?,
               exercise_instructions_en_json = ?,
               exercise_instructions_pt_json = ?,
               instructions_json = ?,
               updated_at = datetime('now')
         WHERE id = ?`;

      const metadataRepairValues: unknown[] = [
        repairedTitle,
        resolvedExerciseDisplayName,
      ];

      if (hasExerciseDbIdColumn) {
        metadataRepairValues.push(resolvedExerciseDbIdForStorage);
      }

      metadataRepairValues.push(
        enriched?.equipment || null,
        enriched?.bodyPart || null,
        enriched?.target || null,
        JSON.stringify(
          Array.isArray(enriched?.secondaryMuscles)
            ? enriched.secondaryMuscles
            : [],
        ),
        resolvedExerciseDbGifUrl,
        resolvedExerciseDbImageUrl,
        resolvedImageUrl,
        resolvedVideoUrl,
        resolvedThumbnailUrl,
        JSON.stringify(deps.resolveExerciseApiMuscleGroups(enriched)),
        deps.resolveExerciseApiBodyArea(enriched, exerciseName),
        JSON.stringify(apiInstructionsEn),
        JSON.stringify(localizedApiInstructionsPt),
        JSON.stringify(persistedInstructions),
        row.id,
      );

      await db.prepare(metadataRepairSql).bind(...metadataRepairValues).run();
      repairedCount += 1;
    }

    if (missionIdsToRegenerate.length > 0) {
      const placeholders = missionIdsToRegenerate.map(() => "?").join(", ");
      await db.prepare(
        `DELETE FROM missions
         WHERE user_id = ?
           AND type = 'daily'
           AND id IN (${placeholders})`,
      ).bind(userId, ...missionIdsToRegenerate).run();
      await deps.createMissionsForPeriod(
        env,
        db,
        userId,
        "daily",
        missionIdsToRegenerate.length,
      );
      deps.invalidateMissionListCache(userId);
    }
  }

  return {
    repairLegacyDailyMissionMetadata,
  };
}
