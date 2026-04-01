import type { CircuitTask, MissionMetricType } from "../../shared/types";
import {
  resolveExerciseDisplayNamePt,
  resolvePreferredExerciseDbId,
} from "../../shared/exerciseCatalog";
import {
  buildMissionDisplayGoalFromTasks,
  localizeMissionText,
  localizeMissionTextArray,
  normalizeMissionMediaUrl,
} from "../../shared/missionLocalization";
import {
  metricUnitByType,
  shouldShowMissionDuration,
} from "../../constants/missionMetrics";

export type NormalizedMissionComputedFields = {
  metric_type: MissionMetricType;
  metric_value: number;
  metric_unit: string;
  sets: number | null;
  rest_seconds: number | null;
  instructions: string[];
  exercise_instructions_en: string[];
  exercise_instructions_pt: string[];
  muscle_groups: string[];
  exercise_secondary_muscles: string[];
  attributes_benefited: string[];
  safety_tips: string[];
  circuit_tasks: CircuitTask[];
  exercise_type: string;
  body_area: string;
  exercise_name: string | null;
  exercise_db_id: string | null;
  exercise_equipment: string | null;
  exercise_body_part: string | null;
  exercise_target: string | null;
  exercise_db_gif_url: string | null;
  exercise_db_image_url: string | null;
  duration_estimate_minutes: number | undefined;
  exercise_category: string;
  difficulty_level: string | undefined;
  video_url: string | null;
  thumbnail_url: string | null;
  mission_origin: "regular" | "ai";
  goal: string | null;
  is_ai_special: number;
  progress_value: number | undefined;
};

export type NormalizedMissionRow = Record<string, unknown> & NormalizedMissionComputedFields;

type MissionPresentationDeps = {
  extractExerciseName: (title: string) => string;
};

const MISSION_TITLE_PREFIX_PATTERN = /^(?:miss(?:\u00e3o|ao)\s+(?:di[a\u00e1]ria|semanal|mensal)|daily mission|weekly mission|monthly mission|meta\s+(?:di[a\u00e1]ria|semanal|mensal)|daily goal|weekly goal|monthly goal)\s*:\s*/i;

// Uniformiza texto para comparacoes flexiveis entre catalogo, UI e dados legados.
export function normalizeMatchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Resolve o tipo metrico final mesmo quando o schema legado nao traz a coluna pronta.
export function normalizeMissionMetricType(
  rawType: unknown,
  rawTargetTime: unknown,
): MissionMetricType {
  if (
    rawType === "repetitions" ||
    rawType === "duration_seconds" ||
    rawType === "sets_reps" ||
    rawType === "steps" ||
    rawType === "distance_meters" ||
    rawType === "duration_minutes" ||
    rawType === "circuit_tasks"
  ) {
    return rawType;
  }

  const targetTime = Number(rawTargetTime ?? 0);
  if (targetTime > 0) return "duration_seconds";
  return "repetitions";
}

// Remove prefixos redundantes para a UI exibir nomes de missao limpos.
export function stripMissionDisplayTitlePrefix(value: string): string {
  const stripped = value.replace(MISSION_TITLE_PREFIX_PATTERN, "").trim();
  const canonicalTitle = resolveExerciseDisplayNamePt(stripped) ?? stripped;
  if (canonicalTitle.length > 0) {
    return canonicalTitle;
  }
  const fallback = value.trim();
  return fallback.length > 0 ? fallback : "Miss\u00e3o";
}

function localizeDifficultyLabel(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const normalized = normalizeMatchText(value);
  if (normalized.includes("avanc")) return "Avan\u00e7ado";
  if (normalized.includes("inter")) return "Intermedi\u00e1rio";
  if (normalized.includes("sedent")) return "Sedent\u00e1rio";
  if (normalized.includes("inic")) return "Iniciante";
  return localizeMissionText(value) ?? value;
}

export function parseMissionArrayField(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((item): item is string => typeof item === "string");
  }

  if (typeof rawValue !== "string") return [];
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function parseCircuitTaskField(rawValue: unknown): CircuitTask[] {
  const parseValue = (value: unknown): CircuitTask[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((task): CircuitTask | null => {
        if (typeof task !== "object" || task === null) return null;
        const record = task as Record<string, unknown>;
        if (
          typeof record.id !== "string" ||
          typeof record.label !== "string" ||
          typeof record.mission_type !== "string"
        ) {
          return null;
        }

        const requiredCount = Number(record.required_count ?? 0);
        const currentCount = Number(record.current_count ?? 0);
        return {
          id: record.id,
          label: record.label,
          mission_type: record.mission_type,
          required_count: requiredCount > 0 ? requiredCount : 1,
          current_count: currentCount >= 0 ? currentCount : 0,
          completed: Boolean(record.completed),
        };
      })
      .filter((task): task is CircuitTask => task !== null);
  };

  if (Array.isArray(rawValue)) {
    return parseValue(rawValue);
  }
  if (typeof rawValue !== "string") return [];
  try {
    return parseValue(JSON.parse(rawValue) as unknown);
  } catch {
    return [];
  }
}

function localizeCircuitTasksForDisplay(tasks: CircuitTask[]): CircuitTask[] {
  return tasks.map((task) => ({
    ...task,
    label: localizeMissionText(task.label) ?? task.label,
  }));
}

function resolveMissionDisplayImage(rawMission: Record<string, unknown>): string | null {
  const imageCandidates = [
    rawMission.image_url,
    rawMission.exercise_db_gif_url,
    rawMission.thumbnail_url,
    rawMission.exercise_db_image_url,
  ];
  for (const candidate of imageCandidates) {
    const normalized = normalizeMissionMediaUrl(typeof candidate === "string" ? candidate : null);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function formatIntegerPtBr(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("pt-BR");
}

export function createMissionPresentationService({
  extractExerciseName,
}: MissionPresentationDeps) {
  function resolveExplicitMonthlyDisplayGoal(rawMission: Record<string, unknown>): string | null {
    if (rawMission.type !== "monthly") return null;

    const rawTitle = typeof rawMission.title === "string" ? rawMission.title : "";
    const title = stripMissionDisplayTitlePrefix(rawTitle);
    if (title.length === 0) return null;

    const normalizedTitle = normalizeMatchText(title);
    const metricType = normalizeMissionMetricType(rawMission.metric_type, rawMission.target_time);
    const targetBase = metricType === "duration_seconds"
      ? Number(rawMission.target_time ?? rawMission.metric_value ?? 0)
      : Number(rawMission.metric_value ?? rawMission.target_reps ?? rawMission.target_time ?? 0);
    const target = Math.max(1, Math.round(targetBase));
    const rawExerciseName =
      typeof rawMission.exercise_name === "string" && rawMission.exercise_name.trim().length > 0
        ? rawMission.exercise_name
        : extractExerciseName(title);
    const exerciseName = stripMissionDisplayTitlePrefix(rawExerciseName).trim();
    const namedSuffix =
      exerciseName.length > 0 && normalizeMatchText(exerciseName) !== normalizedTitle
        ? ` de ${exerciseName}`
        : "";

    if (normalizedTitle.includes("consistencia mensal")) {
      return `${formatIntegerPtBr(target)} miss\u00f5es conclu\u00eddas`;
    }

    if (normalizedTitle.includes("passos do mes")) {
      return `${formatIntegerPtBr(target)} passos acumulados`;
    }

    if (normalizedTitle.includes("distancia mensal")) {
      if (metricType === "distance_meters") {
        const kilometers = target / 1000;
        return `${kilometers.toLocaleString("pt-BR", {
          minimumFractionDigits: kilometers % 1 === 0 ? 0 : 1,
          maximumFractionDigits: 1,
        })} km acumulados`;
      }
      return `${formatIntegerPtBr(target)} passos acumulados`;
    }

    if (
      normalizedTitle.includes("dias ativos") ||
      normalizedTitle.includes("streak mensal") ||
      normalizedTitle.includes("pratica ativa")
    ) {
      return `${formatIntegerPtBr(target)} dias ativos no m\u00eas`;
    }

    if (normalizedTitle.includes("circuitos semanais")) {
      return `${formatIntegerPtBr(target)} circuitos semanais conclu\u00eddos`;
    }

    if (normalizedTitle.includes("volume mensal") || normalizedTitle.includes("ritmo mensal")) {
      return `${formatIntegerPtBr(target)} miss\u00f5es conclu\u00eddas`;
    }

    if (normalizedTitle.includes("desafio cardio")) {
      if (metricType === "distance_meters") {
        const kilometers = target / 1000;
        return `${kilometers.toLocaleString("pt-BR", {
          minimumFractionDigits: kilometers % 1 === 0 ? 0 : 1,
          maximumFractionDigits: 1,
        })} km acumulados`;
      }
      return `${formatIntegerPtBr(target)} passos acumulados`;
    }

    if (metricType === "steps") {
      return `${formatIntegerPtBr(target)} passos${namedSuffix}`;
    }

    if (metricType === "distance_meters") {
      const kilometers = target / 1000;
      const formattedDistance = kilometers.toLocaleString("pt-BR", {
        minimumFractionDigits: kilometers % 1 === 0 ? 0 : 1,
        maximumFractionDigits: 1,
      });
      return `${formattedDistance} km${namedSuffix}`;
    }

    if (metricType === "duration_minutes") {
      return `${formatIntegerPtBr(target)} minutos${namedSuffix}`;
    }

    if (metricType === "duration_seconds") {
      const minutes = Math.max(1, Math.round(target / 60));
      return `${formatIntegerPtBr(minutes)} minutos${namedSuffix}`;
    }

    if (metricType === "sets_reps" || metricType === "repetitions") {
      return `${formatIntegerPtBr(target)} repeti\u00e7\u00f5es${namedSuffix}`;
    }

    return null;
  }

  function resolveMissionDisplayGoal(
    rawMission: Record<string, unknown>,
    circuitTasks: CircuitTask[],
  ): string | null {
    const rawGoal = rawMission.goal;
    const missionType = rawMission.type;
    if (missionType === "monthly" && circuitTasks.length === 0) {
      const explicitMonthlyGoal = resolveExplicitMonthlyDisplayGoal(rawMission);
      if (explicitMonthlyGoal) {
        return explicitMonthlyGoal;
      }
    }
    if (typeof rawGoal === "string" && rawGoal.trim().length > 0) {
      return localizeMissionText(rawGoal) ?? rawGoal;
    }
    if ((missionType !== "weekly" && missionType !== "monthly") || circuitTasks.length === 0) {
      return null;
    }
    return buildMissionDisplayGoalFromTasks(
      circuitTasks.map((task) => task.label),
      missionType,
    );
  }

  function normalizeMissionRow(
    rawMission: Record<string, unknown>,
  ): Record<string, unknown> & NormalizedMissionComputedFields {
    const metricType = normalizeMissionMetricType(rawMission.metric_type, rawMission.target_time);
    const targetReps = Number(rawMission.target_reps ?? 0);
    const targetTime = Number(rawMission.target_time ?? 0);
    const metricValue = Number(
      rawMission.metric_value ?? (metricType === "duration_seconds" ? targetTime : targetReps),
    );
    const durationEstimate = shouldShowMissionDuration(
      typeof rawMission.type === "string" ? rawMission.type : undefined,
    )
      ? Number(rawMission.duration_estimate_minutes ?? 0)
      : 0;
    const metricUnit =
      typeof rawMission.metric_unit === "string" && rawMission.metric_unit.length > 0
        ? rawMission.metric_unit
        : metricUnitByType(metricType);
    const circuitTasks = localizeCircuitTasksForDisplay(
      parseCircuitTaskField(rawMission.circuit_tasks_json),
    );
    const rawTitle = typeof rawMission.title === "string" ? rawMission.title : "Miss\u00e3o";
    const displayTitle =
      typeof rawMission.title === "string"
        ? stripMissionDisplayTitlePrefix(rawTitle)
        : "Miss\u00e3o";
    const displayDescription =
      typeof rawMission.description === "string"
        ? (localizeMissionText(rawMission.description) ?? rawMission.description)
        : rawMission.description;
    const localizedGoal = resolveMissionDisplayGoal(rawMission, circuitTasks);
    const normalizedExerciseNameSource =
      typeof rawMission.exercise_name === "string" &&
      rawMission.exercise_name.trim().length > 0
        ? rawMission.exercise_name
        : displayTitle;
    const canonicalExerciseDbId = resolvePreferredExerciseDbId(
      normalizedExerciseNameSource,
    );
    const explicitExerciseDbId =
      typeof rawMission.exercise_db_id === "string" &&
      rawMission.exercise_db_id.trim().length > 0
        ? rawMission.exercise_db_id.trim()
        : null;
    const progressValue =
      rawMission.progress_value === null || rawMission.progress_value === undefined
        ? (circuitTasks.length > 0
            ? circuitTasks.filter((task) => task.completed).length
            : undefined)
        : Number(rawMission.progress_value);
    const displayImageUrl = resolveMissionDisplayImage(rawMission);

    return {
      ...rawMission,
      title: displayTitle,
      description: displayDescription,
      metric_type: metricType,
      metric_value: metricValue > 0 ? metricValue : 1,
      metric_unit: metricUnit,
      sets:
        rawMission.sets === null || rawMission.sets === undefined
          ? null
          : Number(rawMission.sets),
      rest_seconds:
        rawMission.rest_seconds === null || rawMission.rest_seconds === undefined
          ? null
          : Number(rawMission.rest_seconds),
      instructions: localizeMissionTextArray(parseMissionArrayField(rawMission.instructions_json)),
      exercise_instructions_en: localizeMissionTextArray(
        parseMissionArrayField(rawMission.exercise_instructions_en_json),
      ),
      exercise_instructions_pt: localizeMissionTextArray(
        parseMissionArrayField(rawMission.exercise_instructions_pt_json),
      ),
      muscle_groups: localizeMissionTextArray(parseMissionArrayField(rawMission.muscle_groups_json)),
      exercise_secondary_muscles: localizeMissionTextArray(
        parseMissionArrayField(rawMission.exercise_secondary_muscles_json),
      ),
      attributes_benefited: localizeMissionTextArray(
        parseMissionArrayField(rawMission.attributes_benefited_json),
      ),
      safety_tips: localizeMissionTextArray(parseMissionArrayField(rawMission.safety_tips_json)),
      circuit_tasks: circuitTasks,
      exercise_type:
        typeof rawMission.exercise_type === "string" ? rawMission.exercise_type : "forca",
      body_area:
        rawMission.body_area === "upper" ||
        rawMission.body_area === "lower" ||
        rawMission.body_area === "core" ||
        rawMission.body_area === "full_body"
          ? rawMission.body_area
          : "full_body",
      exercise_name:
        typeof rawMission.exercise_name === "string"
          ? (
              resolveExerciseDisplayNamePt(rawMission.exercise_name) ??
              localizeMissionText(rawMission.exercise_name) ??
              rawMission.exercise_name
            )
          : null,
      exercise_db_id:
        rawMission.type === "daily"
          ? canonicalExerciseDbId ?? null
          : explicitExerciseDbId ?? canonicalExerciseDbId ?? null,
      exercise_equipment:
        typeof rawMission.exercise_equipment === "string"
          ? (localizeMissionText(rawMission.exercise_equipment) ?? rawMission.exercise_equipment)
          : null,
      exercise_body_part:
        typeof rawMission.exercise_body_part === "string"
          ? (localizeMissionText(rawMission.exercise_body_part) ?? rawMission.exercise_body_part)
          : null,
      exercise_target:
        typeof rawMission.exercise_target === "string"
          ? (localizeMissionText(rawMission.exercise_target) ?? rawMission.exercise_target)
          : null,
      image_url: normalizeMissionMediaUrl(displayImageUrl) ?? displayImageUrl,
      exercise_db_gif_url: normalizeMissionMediaUrl(
        typeof rawMission.exercise_db_gif_url === "string"
          ? rawMission.exercise_db_gif_url
          : null,
      ),
      exercise_db_image_url: normalizeMissionMediaUrl(
        typeof rawMission.exercise_db_image_url === "string"
          ? rawMission.exercise_db_image_url
          : null,
      ),
      duration_estimate_minutes: durationEstimate > 0 ? durationEstimate : undefined,
      exercise_category:
        typeof rawMission.exercise_category === "string"
          ? rawMission.exercise_category
          : "default",
      difficulty_level: localizeDifficultyLabel(
        typeof rawMission.difficulty_level === "string"
          ? rawMission.difficulty_level
          : undefined,
      ),
      video_url: normalizeMissionMediaUrl(
        typeof rawMission.video_url === "string" ? rawMission.video_url : null,
      ),
      thumbnail_url: normalizeMissionMediaUrl(
        typeof rawMission.thumbnail_url === "string" ? rawMission.thumbnail_url : null,
      ),
      mission_origin: rawMission.mission_origin === "ai" ? "ai" : "regular",
      goal: localizedGoal,
      is_ai_special: Number(rawMission.is_ai_special ?? 0) === 1 ? 1 : 0,
      progress_value: progressValue,
    };
  }

  function missionSummaryFromNormalized(
    mission: NormalizedMissionRow,
  ): Record<string, unknown> {
    return {
      id: mission.id,
      user_id: mission.user_id,
      type: mission.type,
      title: mission.title,
      description: mission.description,
      skill_id: mission.skill_id,
      target_reps: mission.target_reps,
      target_time: mission.target_time,
      metric_type: mission.metric_type,
      metric_value: mission.metric_value,
      progress_value: mission.progress_value,
      metric_unit: mission.metric_unit,
      sets: mission.sets,
      rest_seconds: mission.rest_seconds,
      instructions: mission.instructions,
      safety_tips: mission.safety_tips,
      video_url: mission.video_url,
      exercise_instructions_en: mission.exercise_instructions_en,
      exercise_instructions_pt: mission.exercise_instructions_pt,
      image_url: mission.image_url,
      exercise_db_id: mission.exercise_db_id,
      exercise_db_gif_url: mission.exercise_db_gif_url,
      exercise_db_image_url: mission.exercise_db_image_url,
      muscle_groups: mission.muscle_groups,
      exercise_secondary_muscles: mission.exercise_secondary_muscles,
      exercise_name: mission.exercise_name,
      exercise_equipment: mission.exercise_equipment,
      exercise_body_part: mission.exercise_body_part,
      exercise_target: mission.exercise_target,
      exercise_type: mission.exercise_type,
      body_area: mission.body_area,
      duration_estimate_minutes: mission.duration_estimate_minutes,
      exercise_category: mission.exercise_category,
      mission_origin: mission.mission_origin,
      goal: mission.goal,
      is_ai_special: mission.is_ai_special,
      circuit_tasks: mission.circuit_tasks,
      difficulty_level: mission.difficulty_level,
      thumbnail_url: mission.thumbnail_url,
      xp_reward: mission.xp_reward,
      points_reward: mission.points_reward,
      deadline: mission.deadline,
      is_completed: mission.is_completed,
      completed_at: mission.completed_at,
      verified_by_sensor: mission.verified_by_sensor,
      status: mission.status,
      created_at: mission.created_at,
      updated_at: mission.updated_at,
    };
  }

  return {
    missionSummaryFromNormalized,
    normalizeMissionRow,
    resolveExplicitMonthlyDisplayGoal,
  };
}
