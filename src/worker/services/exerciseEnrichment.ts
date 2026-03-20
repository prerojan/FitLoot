import {
  buildMissionFallbackMediaDataUrl,
  inferMissionVisualTarget,
} from "../../shared/missionLocalization";

type RapidApiEnv = {
  RAPID_API_KEY?: string | undefined;
  EXERCISE_DB_KEY?: string | undefined;
};

type ExerciseDbExercise = {
  id: string;
  name: string;
  bodyPart?: string | undefined;
  target?: string | undefined;
  equipment?: string | undefined;
  gifUrl?: string | undefined;
  imageUrl?: string | undefined;
  secondaryMuscles?: string[] | undefined;
  instructions?: string[] | undefined;
};

type AscendExercise = {
  id?: string | undefined;
  gifUrl?: string | undefined;
  imageUrl?: string | undefined;
  instructions?: string[] | undefined;
  targetMuscles?: string[] | undefined;
  bodyParts?: string[] | undefined;
};

type AscendVideoExercise = {
  id?: string | undefined;
  videoUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  instructions?: string[] | undefined;
  muscles?: string[] | undefined;
};

export type EnrichedExercise = {
  id: string;
  name: string;
  bodyPart: string;
  target: string;
  equipment: string;
  secondaryMuscles: string[];
  instructions: string[];
  gifUrl: string | null;
  ascendImageUrl: string | null;
  exerciseDbGifUrl: string | null;
  exerciseDbImageUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const RAPID_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX_ENTRIES = 250;

let exerciseCatalogCache: CacheEntry<ExerciseDbExercise[]> | null = null;
const searchCache = new Map<string, CacheEntry<ExerciseDbExercise[]>>();
const mediaCache = new Map<string, CacheEntry<AscendExercise | null>>();
const videoCache = new Map<string, CacheEntry<AscendVideoExercise | null>>();

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const current = cache.get(key);
  if (!current) return null;
  if (current.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return current.value;
}

function hasFreshCacheEntry<T>(cache: Map<string, CacheEntry<T>>, key: string): boolean {
  const current = cache.get(key);
  if (!current) return false;
  if (current.expiresAt <= Date.now()) {
    cache.delete(key);
    return false;
  }
  return true;
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size <= CACHE_MAX_ENTRIES) return;

  const firstKey = cache.keys().next().value;
  if (typeof firstKey === "string") {
    cache.delete(firstKey);
  }
}

function resolveRapidApiKey(env: RapidApiEnv): string | null {
  const candidates = [env.RAPID_API_KEY, env.EXERCISE_DB_KEY]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return candidates[0] ?? null;
}

function targetLabelFromExerciseName(exerciseName: string): string {
  const visualTarget = inferMissionVisualTarget(exerciseName);
  if (visualTarget === "upper body") return "upper body";
  if (visualTarget === "legs") return "legs";
  if (visualTarget === "mobility") return "mobility";
  if (visualTarget === "core") return "core";
  return "full body";
}

function buildFallbackExercise(exerciseName: string): EnrichedExercise {
  const normalizedName = normalizeExerciseNameToken(exerciseName);
  const target = targetLabelFromExerciseName(exerciseName);
  const fallbackImageUrl = buildMissionFallbackMediaDataUrl(exerciseName);

  return {
    id: normalizedName.length > 0 ? `fallback-${normalizedName.replace(/\s+/g, "-")}` : `fallback-${crypto.randomUUID()}`,
    name: exerciseName,
    bodyPart: target,
    target,
    equipment: "body weight",
    secondaryMuscles: [],
    instructions: [],
    gifUrl: null,
    ascendImageUrl: null,
    exerciseDbGifUrl: null,
    exerciseDbImageUrl: fallbackImageUrl,
    imageUrl: fallbackImageUrl,
    videoUrl: null,
    thumbnailUrl: fallbackImageUrl,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("rapidapi-timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function rapidGet<T>(url: string, host: string, env: RapidApiEnv): Promise<T> {
  const apiKey = resolveRapidApiKey(env);
  if (!apiKey) {
    throw new Error("rapidapi-key-missing");
  }

  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": host,
    },
  }, RAPID_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`rapidapi-request-failed:${host}:${response.status}`);
  }

  return (await response.json()) as T;
}

async function getExerciseCatalog(env: RapidApiEnv): Promise<ExerciseDbExercise[]> {
  const cached = exerciseCatalogCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const payload = await rapidGet<ExerciseDbExercise[]>(
    "https://exercisedb.p.rapidapi.com/exercises?limit=300",
    "exercisedb.p.rapidapi.com",
    env
  );

  const normalized = Array.isArray(payload) ? payload : [];
  exerciseCatalogCache = {
    value: normalized,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return normalized;
}

function normalizeExerciseNameToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function rankExercisesByName(exercises: ExerciseDbExercise[], query: string): ExerciseDbExercise[] {
  const normalizedQuery = normalizeExerciseNameToken(query);
  if (!normalizedQuery) return exercises.slice(0, 8);

  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length > 0);
  const scoreByName = (exerciseName: string): number => {
    const normalizedName = normalizeExerciseNameToken(exerciseName);
    if (!normalizedName) return 0;

    let score = 0;
    if (normalizedName === normalizedQuery) score += 100;
    if (normalizedName.startsWith(normalizedQuery)) score += 60;
    if (normalizedName.includes(normalizedQuery)) score += 35;

    for (const token of queryTokens) {
      if (normalizedName === token) {
        score += 16;
      } else if (normalizedName.startsWith(token)) {
        score += 12;
      } else if (normalizedName.includes(token)) {
        score += 8;
      }
    }

    return score;
  };

  return exercises
    .slice()
    .sort((a, b) => scoreByName(b.name) - scoreByName(a.name))
    .slice(0, 8);
}

export async function searchExerciseDB(exerciseName: string, env: RapidApiEnv): Promise<ExerciseDbExercise[]> {
  const normalizedQuery = normalizeExerciseNameToken(exerciseName);
  if (!normalizedQuery) return [];

  const cached = getCachedValue(searchCache, normalizedQuery);
  if (cached) {
    return cached;
  }

  let results: ExerciseDbExercise[] = [];
  try {
    const directByName = await rapidGet<ExerciseDbExercise[]>(
      `https://exercisedb.p.rapidapi.com/exercises/name/${encodeURIComponent(normalizedQuery)}?offset=0&limit=24`,
      "exercisedb.p.rapidapi.com",
      env,
    );
    if (Array.isArray(directByName) && directByName.length > 0) {
      results = rankExercisesByName(directByName, normalizedQuery);
    }
  } catch {
    results = [];
  }

  if (results.length === 0) {
    try {
      const payload = await getExerciseCatalog(env);
      const fallbackMatches = payload.filter((exercise) =>
        normalizeExerciseNameToken(exercise.name).includes(normalizedQuery),
      );
      results = rankExercisesByName(fallbackMatches, normalizedQuery);
    } catch {
      results = [];
    }
  }

  setCachedValue(searchCache, normalizedQuery, results);
  return results;
}

export async function fetchExerciseMedia(exerciseId: string, env: RapidApiEnv): Promise<AscendExercise | null> {
  if (hasFreshCacheEntry(mediaCache, exerciseId)) {
    return getCachedValue(mediaCache, exerciseId);
  }

  try {
    const media = await rapidGet<AscendExercise>(
      `https://ascendapi.p.rapidapi.com/exercises/${encodeURIComponent(exerciseId)}`,
      "ascendapi.p.rapidapi.com",
      env
    );
    setCachedValue(mediaCache, exerciseId, media ?? null);
    return media ?? null;
  } catch {
    setCachedValue(mediaCache, exerciseId, null);
    return null;
  }
}

export async function fetchExerciseVideo(exerciseId: string, env: RapidApiEnv): Promise<AscendVideoExercise | null> {
  if (hasFreshCacheEntry(videoCache, exerciseId)) {
    return getCachedValue(videoCache, exerciseId);
  }

  try {
    const video = await rapidGet<AscendVideoExercise>(
      `https://ascendapi-videos.p.rapidapi.com/exercises/${encodeURIComponent(exerciseId)}`,
      "ascendapi-videos.p.rapidapi.com",
      env
    );
    setCachedValue(videoCache, exerciseId, video ?? null);
    return video ?? null;
  } catch {
    setCachedValue(videoCache, exerciseId, null);
    return null;
  }
}

export async function enrichExercise(exerciseName: string, env: RapidApiEnv): Promise<EnrichedExercise | null> {
  let exercises: ExerciseDbExercise[] = [];
  try {
    exercises = await searchExerciseDB(exerciseName, env);
  } catch {
    exercises = [];
  }
  if (exercises.length === 0) {
    return buildFallbackExercise(exerciseName);
  }

  const exercise = exercises[0];
  const media = await fetchExerciseMedia(exercise.id, env);
  const exerciseDbGifUrl = typeof exercise.gifUrl === "string" ? exercise.gifUrl : null;
  const video = !media?.gifUrl && !exerciseDbGifUrl ? await fetchExerciseVideo(exercise.id, env) : null;
  const exerciseDbImageUrl =
    typeof exercise.imageUrl === "string"
      ? exercise.imageUrl
      : exerciseDbGifUrl;
  const exerciseInstructions =
    Array.isArray(exercise.instructions) && exercise.instructions.length > 0
      ? exercise.instructions
      : Array.isArray(media?.instructions)
        ? media.instructions
        : [];
  const target = exercise.target ?? "full body";
  const fallbackIconUrl = buildMissionFallbackMediaDataUrl(exercise.name || exerciseName);
  const resolvedImageUrl =
    media?.gifUrl
    ?? exerciseDbGifUrl
    ?? media?.imageUrl
    ?? video?.thumbnailUrl
    ?? exerciseDbImageUrl
    ?? fallbackIconUrl;
  const resolvedThumbnailUrl =
    video?.thumbnailUrl
    ?? media?.imageUrl
    ?? exerciseDbImageUrl
    ?? fallbackIconUrl;

  return {
    id: exercise.id,
    name: exercise.name,
    bodyPart: exercise.bodyPart ?? "full body",
    target,
    equipment: exercise.equipment ?? "body weight",
    secondaryMuscles: Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : [],
    instructions: exerciseInstructions,
    gifUrl: media?.gifUrl ?? null,
    ascendImageUrl: media?.imageUrl ?? null,
    exerciseDbGifUrl,
    exerciseDbImageUrl,
    imageUrl: resolvedImageUrl,
    videoUrl: video?.videoUrl ?? null,
    thumbnailUrl: resolvedThumbnailUrl,
  };
}
