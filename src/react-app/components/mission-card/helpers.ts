import type { CSSProperties } from "react";
import { formatMissionGoal } from "@/constants/missionMetrics";
import {
  resolveExerciseTargetMuscleLabels,
  resolveExerciseTargetMuscleLabelsById,
  resolveExerciseMediaFallbackUrlById,
} from "@/shared/exerciseCatalog";
import {
  localizeMissionText,
  normalizeMissionMediaUrl,
} from "@/shared/missionLocalization";
import type { CircuitTask, Mission, MissionMetricType } from "@/shared/types";

// Normalizes mission metrics and goals before any card or modal rendering happens.
export function normalizeMetricType(mission: Mission): MissionMetricType {
  if (
    mission.metric_type === "repetitions" ||
    mission.metric_type === "duration_seconds" ||
    mission.metric_type === "sets_reps" ||
    mission.metric_type === "steps" ||
    mission.metric_type === "distance_meters" ||
    mission.metric_type === "duration_minutes" ||
    mission.metric_type === "circuit_tasks"
  ) {
    return mission.metric_type;
  }
  if ((mission.target_time ?? 0) > 0) return "duration_seconds";
  return "sets_reps";
}

export function resolveCircuitTasks(mission: Mission): CircuitTask[] {
  if (!Array.isArray(mission.circuit_tasks)) return [];
  return mission.circuit_tasks.filter((task) =>
    typeof task.id === "string" &&
    typeof task.label === "string" &&
    typeof task.mission_type === "string" &&
    typeof task.required_count === "number" &&
    typeof task.current_count === "number" &&
    typeof task.completed === "boolean"
  );
}

export function missionTotalGoal(mission: Mission, metricType: MissionMetricType): number {
  if (metricType === "circuit_tasks") {
    const tasks = resolveCircuitTasks(mission);
    return tasks.length > 0
      ? tasks.length
      : Math.max(1, Number(mission.metric_value ?? 1));
  }
  if (typeof mission.metric_value === "number" && mission.metric_value > 0) {
    return mission.metric_value;
  }
  if (metricType === "duration_seconds" || metricType === "duration_minutes") {
    return Math.max(1, Number(mission.target_time ?? 0));
  }
  return Math.max(1, Number(mission.target_reps ?? 1));
}

export function formatGoal(mission: Mission, metricType: MissionMetricType): string {
  const goal = missionTotalGoal(mission, metricType);
  const sets = mission.sets ?? undefined;

  if (metricType === "duration_seconds" && sets && sets > 0) {
    const secondsPerSet = Math.max(1, Math.floor(goal / sets));
    return formatMissionGoal(metricType, secondsPerSet, sets);
  }

  if (metricType === "sets_reps" && sets && sets > 0) {
    const repsPerSet = Math.max(1, Math.floor(goal / sets));
    return formatMissionGoal(metricType, repsPerSet, sets);
  }

  if (metricType === "circuit_tasks") {
    const tasks = resolveCircuitTasks(mission);
    const completedCount = tasks.filter((task) => task.completed).length;
    return formatMissionGoal(metricType, completedCount);
  }

  return formatMissionGoal(metricType, goal, sets);
}

export function bodyAreaLabel(bodyArea: Mission["body_area"]): string {
  if (bodyArea === "upper") return "Parte superior";
  if (bodyArea === "lower") return "Parte inferior";
  if (bodyArea === "core") return "Core";
  return "Corpo inteiro";
}

function isGifUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.gif(?:$|\?)/i.test(url) || /format=gif/i.test(url);
}

function isPixelOrLineArtUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /(pixel|lineart|sprite|icon|outline|vector)/i.test(url);
}

function isExerciseDbMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /static\.exercisedb\.dev\/media\/[A-Za-z0-9_-]+\.(?:gif|png|jpe?g|webp)(?:$|\?)/i.test(url);
}

export function normalizeLookupText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function formatDistanceAmount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toLocaleString("pt-BR", {
      minimumFractionDigits: value % 1000 === 0 ? 0 : 1,
      maximumFractionDigits: 1,
    })} km`;
  }
  return `${Math.round(value).toLocaleString("pt-BR")} m`;
}

function extractGoalCounterValue(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  const rawValue = match?.[1];
  if (!rawValue) return null;
  const numeric = Number.parseFloat(rawValue);
  return Number.isFinite(numeric) ? numeric : null;
}

export function resolveProgressTarget(mission: Mission, metricType: MissionMetricType): number {
  const metricTarget = Math.max(1, missionTotalGoal(mission, metricType));
  const normalizedGoal = normalizeLookupText(mission.goal);
  const explicitGoalValue = extractGoalCounterValue(mission.goal);

  if (explicitGoalValue === null || explicitGoalValue <= 0) {
    return metricTarget;
  }

  if (metricType === "steps" || normalizedGoal.includes("passos")) {
    return Math.max(1, Math.round(explicitGoalValue));
  }

  if (
    metricType === "distance_meters"
    || normalizedGoal.includes(" km")
    || normalizedGoal.endsWith("km")
    || normalizedGoal.includes("metros")
  ) {
    const rawGoal = String(mission.goal ?? "").toLowerCase();
    const asMeters = rawGoal.includes("km")
      ? explicitGoalValue * 1000
      : explicitGoalValue;
    return Math.max(1, Math.round(asMeters));
  }

  if (
    normalizedGoal.includes("missoes concluidas")
    || normalizedGoal.includes("dias ativos")
    || normalizedGoal.includes("circuitos semanais")
  ) {
    return Math.max(1, Math.round(explicitGoalValue));
  }

  return metricTarget;
}

export function resolveProgressCounterParts(
  mission: Mission,
  metricType: MissionMetricType,
  current: number,
  target: number,
): { current: string; target: string; unitLabel: string | null } {
  const title = normalizeLookupText(mission.title);
  const goal = normalizeLookupText(mission.goal);

  if (title.includes("consistencia mensal") || title.includes("volume mensal") || goal.includes("missoes concluidas")) {
    return {
      current: Math.round(current).toLocaleString("pt-BR"),
      target: Math.round(target).toLocaleString("pt-BR"),
      unitLabel: "missões",
    };
  }

  if (title.includes("dias ativos") || title.includes("pratica ativa") || goal.includes("dias ativos")) {
    return {
      current: Math.round(current).toLocaleString("pt-BR"),
      target: Math.round(target).toLocaleString("pt-BR"),
      unitLabel: "dias",
    };
  }

  if (title.includes("circuitos semanais") || goal.includes("circuitos semanais")) {
    return {
      current: Math.round(current).toLocaleString("pt-BR"),
      target: Math.round(target).toLocaleString("pt-BR"),
      unitLabel: "circuitos",
    };
  }

  if (metricType === "steps" || goal.includes("passos") || title.includes("passos")) {
    return {
      current: Math.round(current).toLocaleString("pt-BR"),
      target: Math.round(target).toLocaleString("pt-BR"),
      unitLabel: "passos",
    };
  }

  if (metricType === "distance_meters") {
    return {
      current: formatDistanceAmount(current),
      target: formatDistanceAmount(target),
      unitLabel: null,
    };
  }

  return {
    current: Math.round(current).toLocaleString("pt-BR"),
    target: Math.round(target).toLocaleString("pt-BR"),
    unitLabel: null,
  };
}

export function formatProgressAmount(
  mission: Mission,
  metricType: MissionMetricType,
  current: number,
  target: number,
): string {
  const parts = resolveProgressCounterParts(mission, metricType, current, target);
  if (parts.unitLabel) {
    return `${parts.current}/${parts.target} ${parts.unitLabel}`;
  }
  return `${parts.current}/${parts.target}`;
}

export function resolveMissionGoalText(mission: Mission, metricType: MissionMetricType): string {
  if (typeof mission.goal === "string" && mission.goal.trim().length > 0) {
    return (localizeMissionText(mission.goal) ?? mission.goal).trim();
  }
  return localizeMissionText(formatGoal(mission, metricType)) ?? formatGoal(mission, metricType);
}

const MISSION_TITLE_PREFIX_PATTERN = /^(?:miss(?:\u00e3o|ao)\s+(?:di[a\u00e1]ria|semanal|mensal)|daily mission|weekly mission|monthly mission|meta\s+(?:di[a\u00e1]ria|semanal|mensal)|daily goal|weekly goal|monthly goal)\s*:\s*/i;

// Cleans display copy and media choices so each card surfaces the best localized presentation.
export function resolveMissionDisplayTitle(value: string | null | undefined): string {
  const raw = typeof value === "string" ? value : "";
  const stripped = raw.replace(MISSION_TITLE_PREFIX_PATTERN, "").trim();
  if (stripped.length > 0) {
    return stripped;
  }
  const fallback = raw.trim();
  return fallback.length > 0 ? fallback : "Miss\u00e3o";
}

export function formatDifficultyLabel(value: string | null | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Iniciante";
  }
  const localized = (localizeMissionText(value) ?? value).trim();
  const normalized = localized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.includes("advanced") || normalized.includes("avancado") || normalized.includes("avan")) return "Avançado";
  if (normalized.includes("intermediate") || normalized.includes("intermedio") || normalized.includes("intermediar")) return "Intermediário";
  return localized.charAt(0).toUpperCase() + localized.slice(1);
}

function summarizeCircuitTaskLabel(label: string): string {
  const localized = localizeMissionText(label) ?? label;
  return localized
    .replace(/^Conclua\s+/i, "")
    .replace(/^Complete\s+/i, "")
    .replace(/^\d+\s+miss(?:\u00f5es|oes)\s+di[a\u00e1]rias\s+de\s+/i, "")
    .replace(/^\d+\s+miss(?:\u00f5es|oes)\s+de\s+/i, "")
    .trim();
}

function uniqueMissionLabels(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const localized = (localizeMissionText(value) ?? value).trim();
    if (localized.length === 0) continue;
    const key = localized.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(localized);
  }
  return labels;
}

function uniqueLiteralLabels(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(trimmed);
  }
  return labels;
}

function localizeLiteralMuscleLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const normalized = trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  switch (normalized) {
    case "pectorals":
    case "pectoral":
    case "chest":
      return "Peitoral";
    case "back":
    case "lats":
      return "Costas";
    case "shoulders":
    case "shoulder":
    case "delts":
    case "deltoids":
      return "Ombros";
    case "triceps":
    case "tricep":
      return "Tr\u00edceps";
    case "biceps":
    case "bicep":
      return "B\u00edceps";
    case "forearms":
    case "forearm":
      return "Antebra\u00e7os";
    case "glutes":
    case "glute":
      return "Gl\u00fateos";
    case "quadriceps":
    case "quadriceps femoris":
    case "quads":
      return "Quadr\u00edceps";
    case "hamstrings":
    case "hamstring":
      return "Posteriores";
    case "calves":
    case "calf":
      return "Panturrilhas";
    case "abs":
    case "abdominals":
    case "abdominal":
    case "waist":
      return "Abd\u00f4men";
    case "hips":
    case "hip":
      return "Quadril";
    case "upper arms":
    case "lower arms":
    case "arms":
      return "Bra\u00e7os";
    case "upper legs":
    case "lower legs":
    case "legs":
    case "leg":
      return "Pernas";
    case "full body":
    case "corpo inteiro":
      return "Corpo inteiro";
    case "upper":
    case "parte superior":
      return "Parte superior";
    case "lower":
    case "parte inferior":
      return "Parte inferior";
    case "core":
      return "Core";
    case "cardiovascular system":
      return "Sistema cardiovascular";
    default:
      return trimmed;
  }
}

const STRICT_MUSCLE_LABEL_KEYS = new Set([
  "pectorals",
  "pectoral",
  "chest",
  "peitoral",
  "back",
  "costas",
  "lats",
  "shoulders",
  "shoulder",
  "delts",
  "deltoids",
  "ombros",
  "triceps",
  "tricep",
  "triceps",
  "biceps",
  "bicep",
  "biceps",
  "forearms",
  "forearm",
  "antebracos",
  "antebraços",
  "glutes",
  "glute",
  "gluteos",
  "glúteos",
  "quadriceps",
  "quadriceps femoris",
  "quads",
  "quadriceps",
  "quadríceps",
  "hamstrings",
  "hamstring",
  "posteriores",
  "calves",
  "calf",
  "panturrilhas",
  "abs",
  "abdominals",
  "abdominal",
  "waist",
  "abdomen",
  "abdômen",
  "hips",
  "hip",
  "quadril",
  "upper arms",
  "lower arms",
  "arms",
  "bracos",
  "braços",
  "upper legs",
  "lower legs",
  "legs",
  "leg",
  "pernas",
  "full body",
  "corpo inteiro",
  "upper",
  "parte superior",
  "lower",
  "parte inferior",
  "core",
  "cardiovascular system",
  "sistema cardiovascular",
]);

function resolveStrictMuscleLabel(value: string | null | undefined): string | null {
  const localized = localizeLiteralMuscleLabel(value);
  if (!localized) {
    return null;
  }

  const normalizedSource = normalizeLookupText(value);
  const normalizedLocalized = normalizeLookupText(localized);
  if (
    STRICT_MUSCLE_LABEL_KEYS.has(normalizedSource)
    || STRICT_MUSCLE_LABEL_KEYS.has(normalizedLocalized)
  ) {
    return localized;
  }

  return null;
}

function uniqueMuscleLabels(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values) {
    const localized = localizeLiteralMuscleLabel(value);
    if (!localized) continue;
    const key = localized.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(localized);
  }
  return labels;
}

function uniqueStrictMuscleLabels(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values) {
    const localized = resolveStrictMuscleLabel(value);
    if (!localized) continue;
    const key = localized.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(localized);
  }
  return labels;
}

function isGenericMissionFocusLabel(value: string): boolean {
  const normalized = (localizeMissionText(value) ?? value)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized === "full body"
    || normalized === "corpo inteiro"
    || normalized === "superior"
    || normalized === "parte superior"
    || normalized === "inferior"
    || normalized === "parte inferior"
    || normalized === "core"
    || normalized === "push"
    || normalized === "pull"
    || normalized === "cardio"
    || normalized === "mobilidade"
    || normalized === "mobility"
    || normalized === "flexibility"
    || normalized === "flexibilidade";
}

function isTechnicalMissionFocusLabel(value: string): boolean {
  const normalized = (localizeMissionText(value) ?? value)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized === "cardiovascular system"
    || normalized === "sistema cardiovascular"
    || normalized === "cardio training";
}

export function resolveMissionFocusLabels(mission: Mission): string[] {
  const catalogPrimaryLabels = uniqueLiteralLabels([
    ...resolveExerciseTargetMuscleLabelsById(mission.exercise_db_id),
    ...(
      typeof mission.exercise_db_id === "string" && mission.exercise_db_id.trim().length > 0
        ? []
        : resolveExerciseTargetMuscleLabels(mission.exercise_name)
    ),
  ]);
  if (catalogPrimaryLabels.includes("Corpo inteiro")) {
    return ["Corpo inteiro"];
  }

  const exerciseDbPrimaryLabels = uniqueStrictMuscleLabels([mission.exercise_target]).filter(
    (label) => !isGenericMissionFocusLabel(label) && !isTechnicalMissionFocusLabel(label),
  );
  const exerciseDbSecondaryLabels = uniqueStrictMuscleLabels(
    Array.isArray(mission.exercise_secondary_muscles)
      ? mission.exercise_secondary_muscles.slice(0, 2)
      : [],
  ).filter(
    (label) => !isGenericMissionFocusLabel(label) && !isTechnicalMissionFocusLabel(label),
  );
  if (exerciseDbPrimaryLabels.length > 0) {
    return uniqueMuscleLabels([
      ...exerciseDbPrimaryLabels,
      ...exerciseDbSecondaryLabels,
    ]).slice(0, 6);
  }

  if (catalogPrimaryLabels.length > 0) {
    return catalogPrimaryLabels.slice(0, 6);
  }

  if (exerciseDbSecondaryLabels.length > 0) {
    return exerciseDbSecondaryLabels.slice(0, 6);
  }

  const primaryLabels = uniqueStrictMuscleLabels([
    ...(Array.isArray(mission.muscle_groups) ? mission.muscle_groups : []),
  ]);
  const secondaryLabels = exerciseDbSecondaryLabels;
  const bodyPartLabels = uniqueStrictMuscleLabels([mission.exercise_body_part]).filter(
    (label) => !isGenericMissionFocusLabel(label) || primaryLabels.length === 0,
  );
  const labels = uniqueMuscleLabels([
    ...primaryLabels,
    ...secondaryLabels,
    ...bodyPartLabels,
  ]);
  if (labels.length > 0) return labels.slice(0, 6);
  if (
    (typeof mission.exercise_db_id === "string" && mission.exercise_db_id.trim().length > 0)
    || (typeof mission.exercise_name === "string" && mission.exercise_name.trim().length > 0)
  ) {
    return [];
  }
  return [bodyAreaLabel(mission.body_area)];
}

const UNILATERAL_EXECUTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:split squat|bulgarian split squat|agachamento bulgaro|agachamento dividido|agachamento unilateral)\b/,
  /\b(?:single leg|single-leg|single arm|single-arm|one leg|one-leg|one arm|one-arm|unilateral)\b/,
  /\b(?:step up|step-up|subida no banco|afundo alternado|avanco alternado|passada alternada)\b/,
  /\b(?:cada lado|cada perna|cada braco|troque de lado|troque de perna|alterne os lados|alterne as pernas)\b/,
];

// Detects execution-specific mission behavior and chooses the most suitable media asset.
export function isUnilateralExecutionMission(mission: Mission): boolean {
  const sourceTexts = [
    mission.title,
    mission.description,
    mission.goal,
    ...(Array.isArray(mission.instructions) ? mission.instructions.slice(0, 6) : []),
    ...(Array.isArray(mission.exercise_instructions_pt) ? mission.exercise_instructions_pt.slice(0, 6) : []),
    ...(Array.isArray(mission.exercise_instructions_en) ? mission.exercise_instructions_en.slice(0, 6) : []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeLookupText(value));

  if (sourceTexts.length === 0) return false;

  const combined = sourceTexts.join(" | ");
  return UNILATERAL_EXECUTION_PATTERNS.some((pattern) => pattern.test(combined));
}

export function summarizeAutoProgressLabel(tasks: readonly CircuitTask[]): string {
  const taskLabels = uniqueMissionLabels(tasks.map((task) => summarizeCircuitTaskLabel(task.label)));
  if (taskLabels.length === 0) return "Missões diárias compatíveis";
  if (taskLabels.length === 1) return taskLabels[0] ?? "Missões diárias compatíveis";
  if (taskLabels.length === 2) return `${taskLabels[0]} e ${taskLabels[1]}`;
  return `${taskLabels[0]}, ${taskLabels[1]} e mais ${taskLabels.length - 2}`;
}

export function resolveMissionMediaUrl(mission: Mission): string | null {
  const isExerciseDbBackedDailyMission =
    mission.type !== "daily"
    || (typeof mission.exercise_db_id === "string" && mission.exercise_db_id.trim().length > 0);
  if (!isExerciseDbBackedDailyMission) {
    return null;
  }

  const primaryImage = normalizeMissionMediaUrl(mission.image_url);
  const ascendGif = isGifUrl(primaryImage) ? primaryImage : null;
  const exerciseDbPrimary = isExerciseDbMediaUrl(primaryImage) ? primaryImage : null;
  const exerciseDbGif = normalizeMissionMediaUrl(mission.exercise_db_gif_url);
  const exerciseDbImage = normalizeMissionMediaUrl(mission.exercise_db_image_url);
  const videoUrl = normalizeMissionMediaUrl(mission.video_url);
  const thumbnail = normalizeMissionMediaUrl(mission.thumbnail_url);
  const fallbackByExerciseId = normalizeMissionMediaUrl(
    resolveExerciseMediaFallbackUrlById(mission.exercise_db_id ?? null),
  );

  if (mission.type === "daily") {
    return exerciseDbGif
      ?? exerciseDbImage
      ?? exerciseDbPrimary
      ?? fallbackByExerciseId
      ?? null;
  }

  return ascendGif
    ?? exerciseDbGif
    ?? (videoUrl ? (thumbnail ?? null) : null)
    ?? exerciseDbImage
    ?? primaryImage
    ?? thumbnail
    ?? fallbackByExerciseId
    ?? null;
}

export function resolveMissionVideoUrl(mission: Mission): string | null {
  return normalizeMissionMediaUrl(mission.video_url);
}

export function resolveMissionMediaStyle(url: string | null | undefined): CSSProperties {
  const pixelOrLineArt = isPixelOrLineArtUrl(url);

  return {
    imageRendering: pixelOrLineArt ? "crisp-edges" : "auto",
    filter: pixelOrLineArt
      ? "contrast(1.06) saturate(1.06) brightness(1.01)"
      : "contrast(1.02) saturate(1.03) brightness(1.01)",
  };
}
