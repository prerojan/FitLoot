import type { ConditioningLevel, MissionMetricType } from "../../shared/types";

// Parses array-shaped JSON payloads that are stored as text in older mission rows.
export function parseJsonStringArray(rawValue: unknown): string[] {
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

// Keeps mission JSON array parsing stable for persisted instructions and metadata.
export function parseMissionArrayField(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((item): item is string => typeof item === "string");
  }
  if (typeof rawValue !== "string") return [];
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

// Accepts direct JSON or fenced markdown blocks returned by model providers.
export function stripModelJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  return trimmed;
}

// Finds the first complete JSON object in mixed model output without trusting extra prose.
export function extractFirstJsonObject(raw: string): string | null {
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

// Tries the fenced body first and then a recovered object to keep AI parsing resilient.
export function parseJsonObjectFromModelContent<T>(
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

// Preserves the legacy mission metric fallback contract used across hydration and repairs.
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

// Normalizes free-form difficulty labels to the existing conditioning vocabulary.
export function normalizeDifficultyLabel(
  value: unknown,
  fallback: ConditioningLevel,
  normalizeMatchText: (value: string) => string,
): string {
  const raw = typeof value === "string" ? normalizeMatchText(value) : "";
  if (raw.includes("avanc")) return "avancado";
  if (raw.includes("inter")) return "intermediario";
  if (raw.includes("sedent")) return "sedentario";
  if (raw.includes("inic")) return "iniciante";
  return fallback;
}
