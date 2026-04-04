import type {
  CircuitTask,
  MissionMetricType,
} from "../../shared/types";
import { getMissionMetricType } from "../../constants/missionMetrics";
import type { EnrichedExercise } from "./exerciseEnrichment";
import {
  buildMissionInstructions,
  inferBodyArea,
  type MissionBodyArea,
  type MissionExerciseCategory,
  type MissionExerciseType,
  type MissionPeriod,
  wrapMissionInstructionsWithStretching,
} from "./missionComposition";

export type MissionPayload = {
  title: string;
  description: string;
  goal?: string | null;
  cycle_date?: string | null;
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

export type MissionPromptContext = {
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

export type ExerciseInstructionPayload = {
  instructions: string[];
  musclesAffected: string[];
  attributesBenefited: string[];
  safetyTips: string[];
  difficultyLevel: string;
  metricType: MissionMetricType;
  metricValue: number;
};

type FallbackMissionPayloadBuilder = (params: {
  period: MissionPeriod;
  titlePrefix: string;
  exerciseName: string;
  muscle: string;
  xp: number;
  points: number;
  forceCategory?: MissionExerciseCategory | undefined;
}) => MissionPayload;

const METRIC_TYPE_MAP: Record<MissionExerciseCategory, MissionMetricType> = {
  plank: "duration_seconds",
  isometric: "duration_seconds",
  walk: "distance_meters",
  run: "distance_meters",
  yoga: "duration_minutes",
  stretching: "duration_minutes",
  mobility: "duration_minutes",
  strength: "sets_reps",
  abdominal: "sets_reps",
  cardio_circuit: "circuit_tasks",
  default: "sets_reps",
};

const INSTRUCTION_STEP_PREFIX_REGEX = new RegExp(
  String.raw`^\s*(?:step|passo)\s*\d+\s*(?::|\.|\)|-)?\s*`,
  "iu",
);
const INSTRUCTION_NUMERIC_PREFIX_REGEX = new RegExp(
  String.raw`^\s*\d+\s*(?::|\.|\)|-)\s*`,
  "u",
);

function sanitizeMissionInstructionText(value: string): string {
  return value
    .replace(INSTRUCTION_STEP_PREFIX_REGEX, "")
    .replace(INSTRUCTION_NUMERIC_PREFIX_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsInstructionText(value: string): boolean {
  return /\p{L}/u.test(value);
}

function stripModelJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  return trimmed;
}

function extractFirstJsonObject(raw: string): string | null {
  const source = stripModelJsonFence(raw).trim();
  const start = source.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function resolveMetricTypeForCategory(
  category: MissionExerciseCategory,
  exerciseName: string,
): MissionMetricType {
  return METRIC_TYPE_MAP[category] ?? getMissionMetricType(exerciseName);
}

export function ensureInstructionSteps(
  instructions: string[],
  exerciseName: string,
  metricType: MissionMetricType,
  sets: number | null,
  restSeconds: number | null,
): string[] {
  const compact = instructions
    .map((item) => sanitizeMissionInstructionText(item))
    .filter((item) => item.length > 0 && containsInstructionText(item));
  const fallback = buildMissionInstructions(
    exerciseName,
    metricType,
    sets,
    restSeconds,
  );
  const merged = [...compact];
  for (const step of fallback) {
    if (merged.length >= 6) break;
    if (!merged.includes(step)) merged.push(step);
  }
  return wrapMissionInstructionsWithStretching(merged.slice(0, 6), exerciseName);
}

export function normalizeInstructionList(
  value: unknown,
  limit = 8,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeMissionInstructionText(String(item)))
    .filter((item) => item.length > 0 && containsInstructionText(item))
    .slice(0, limit);
}

export function mergeUniqueStrings(values: string[], limit: number): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
    if (merged.length >= limit) break;
  }
  return merged;
}

export function parseJsonObjectFromModelContent<T extends Record<string, unknown>>(
  rawContent: string,
): T | null {
  const trimmed = stripModelJsonFence(rawContent).trim();
  const candidates = [trimmed, extractFirstJsonObject(trimmed)].filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }

  return null;
}

export function resolveExerciseApiMuscleGroups(
  exercise: Pick<EnrichedExercise, "target" | "secondaryMuscles"> | null | undefined,
): string[] {
  return mergeUniqueStrings(
    [
      typeof exercise?.target === "string" ? exercise.target : "",
      ...(Array.isArray(exercise?.secondaryMuscles)
        ? exercise.secondaryMuscles
        : []),
    ],
    6,
  );
}

export function resolveExerciseApiBodyArea(
  exercise: Pick<EnrichedExercise, "bodyPart" | "target"> | null | undefined,
  fallbackMuscle: string,
): MissionBodyArea {
  return inferBodyArea(exercise?.bodyPart || exercise?.target || fallbackMuscle);
}

export function fallbackMissionsForPeriod(
  period: MissionPeriod,
  titlePrefix: string,
  xp: number,
  points: number,
  buildMissionPayload: FallbackMissionPayloadBuilder,
): MissionPayload[] {
  if (period !== "daily") return [];

  return [
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Prancha Isometrica",
      muscle: "core",
      xp,
      points,
      forceCategory: "plank",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Caminhada Ativa",
      muscle: "legs",
      xp,
      points,
      forceCategory: "walk",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Agachamento Livre",
      muscle: "legs",
      xp,
      points,
      forceCategory: "strength",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Corrida Leve",
      muscle: "legs",
      xp,
      points,
      forceCategory: "run",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Glute Bridge",
      muscle: "glutes",
      xp,
      points,
      forceCategory: "strength",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Abdominal Controlado",
      muscle: "core",
      xp,
      points,
      forceCategory: "strength",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Flexao de Braco",
      muscle: "chest",
      xp,
      points,
      forceCategory: "strength",
    }),
  ];
}

export async function mapWithConcurrency<TInput, TResult>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) return [];

  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results: TResult[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () =>
      worker(),
    ),
  );

  return results;
}
