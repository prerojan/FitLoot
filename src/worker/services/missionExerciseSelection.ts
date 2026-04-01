import {
  listAllStrictSupportedMissionExerciseNames,
  listSupportedMissionExerciseNamesByMuscle,
  resolveSupportedMissionExerciseName,
} from "../../shared/exerciseCatalog";

type ResolveMissionExerciseForGenerationParams = {
  requestedName: string | null | undefined;
  muscles?: readonly string[] | null | undefined;
  focus?: string | null | undefined;
};

type SanitizeMissionExerciseNamesParams = {
  requestedNames?: readonly string[] | null | undefined;
  muscles?: readonly string[] | null | undefined;
  focus?: string | null | undefined;
  limit?: number | undefined;
  fillStrategy?: "always" | "if_empty" | undefined;
  fallbackOrder?: readonly ("muscles" | "focus" | "catalog")[] | undefined;
};

const FOCUS_FALLBACKS: Record<string, readonly string[]> = {
  push: ["push-up", "diamond push-up", "triceps dip"],
  pull: ["triceps dip", "push-up", "front plank"],
  legs: ["air squat", "walking lunge", "glute bridge", "wall sit", "calf raise"],
  core: ["front plank", "3/4 sit-up", "crunch floor", "dead bug", "mountain climber"],
  conditioning: ["burpee", "mountain climber", "air squat", "walking lunge"],
  active_recovery: ["glute bridge", "dead bug", "wall sit", "calf raise"],
  mobility: ["glute bridge", "dead bug", "wall sit", "calf raise"],
  rest: ["glute bridge", "dead bug", "wall sit", "calf raise"],
  skill: ["front plank", "dead bug", "push-up", "air squat"],
  default: ["push-up", "air squat", "front plank", "dead bug", "burpee"],
};

function normalizeMissionExerciseSelectionText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function resolveFocusBuckets(focus: string | null | undefined): string[] {
  const normalizedFocus = normalizeMissionExerciseSelectionText(focus);
  if (!normalizedFocus) return ["default"];

  const buckets = new Set<string>();
  if (normalizedFocus.includes("push") || normalizedFocus.includes("upper")) {
    buckets.add("push");
  }
  if (normalizedFocus.includes("pull") || normalizedFocus.includes("back")) {
    buckets.add("pull");
  }
  if (
    normalizedFocus.includes("leg")
    || normalizedFocus.includes("lower")
    || normalizedFocus.includes("glute")
  ) {
    buckets.add("legs");
  }
  if (
    normalizedFocus.includes("core")
    || normalizedFocus.includes("abs")
    || normalizedFocus.includes("plank")
  ) {
    buckets.add("core");
  }
  if (
    normalizedFocus.includes("condition")
    || normalizedFocus.includes("cardio")
    || normalizedFocus.includes("hiit")
  ) {
    buckets.add("conditioning");
  }
  if (
    normalizedFocus.includes("recover")
    || normalizedFocus.includes("rest")
    || normalizedFocus.includes("stretch")
  ) {
    buckets.add("active_recovery");
  }
  if (
    normalizedFocus.includes("mobility")
    || normalizedFocus.includes("yoga")
  ) {
    buckets.add("mobility");
  }
  if (normalizedFocus.includes("skill")) {
    buckets.add("skill");
  }
  if (buckets.size === 0) {
    buckets.add("default");
  }
  return Array.from(buckets);
}

function pushSupportedExerciseName(
  collector: string[],
  seen: Set<string>,
  rawName: string | null | undefined,
  limit: number,
): void {
  if (collector.length >= limit) return;
  const resolved = resolveSupportedMissionExerciseName(rawName);
  if (!resolved) return;
  const key = normalizeMissionExerciseSelectionText(resolved);
  if (!key || seen.has(key)) return;
  seen.add(key);
  collector.push(resolved);
}

export function sanitizeMissionExerciseNames({
  requestedNames,
  muscles,
  focus,
  limit = 5,
  fillStrategy = "always",
  fallbackOrder = ["muscles", "focus", "catalog"],
}: SanitizeMissionExerciseNamesParams): string[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const requestedName of requestedNames ?? []) {
    pushSupportedExerciseName(selected, seen, requestedName, safeLimit);
  }

  if (fillStrategy === "if_empty" && selected.length > 0) {
    return selected;
  }

  for (const step of fallbackOrder) {
    if (step === "muscles") {
      for (const muscle of muscles ?? []) {
        for (const candidate of listSupportedMissionExerciseNamesByMuscle(muscle)) {
          pushSupportedExerciseName(selected, seen, candidate, safeLimit);
          if (selected.length >= safeLimit) {
            return selected;
          }
        }
      }
      continue;
    }

    if (step === "focus") {
      for (const bucket of resolveFocusBuckets(focus)) {
        for (const candidate of FOCUS_FALLBACKS[bucket] ?? []) {
          pushSupportedExerciseName(selected, seen, candidate, safeLimit);
          if (selected.length >= safeLimit) {
            return selected;
          }
        }
      }
      continue;
    }

    if (step === "catalog") {
      for (const candidate of listAllStrictSupportedMissionExerciseNames()) {
        pushSupportedExerciseName(selected, seen, candidate, safeLimit);
        if (selected.length >= safeLimit) {
          return selected;
        }
      }
    }
  }

  return selected;
}

export function resolveMissionExerciseForGeneration({
  requestedName,
  muscles,
  focus,
}: ResolveMissionExerciseForGenerationParams): string | null {
  return sanitizeMissionExerciseNames({
    requestedNames: requestedName ? [requestedName] : [],
    muscles,
    focus,
    limit: 1,
  })[0] ?? null;
}

export function isStrictSupportedMissionExercise(
  value: string | null | undefined,
): boolean {
  return resolveSupportedMissionExerciseName(value) !== null;
}
