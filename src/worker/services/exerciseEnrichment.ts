type RapidApiEnv = {
  RAPID_API_KEY?: string | undefined;
};

type ExerciseDbExercise = {
  id: string;
  name: string;
  bodyPart?: string | undefined;
  target?: string | undefined;
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
  secondaryMuscles: string[];
  instructions: string[];
  gifUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const RAPID_TIMEOUT_MS = 8_000;
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
  if (!env.RAPID_API_KEY) {
    throw new Error("rapidapi-key-missing");
  }

  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "X-RapidAPI-Key": env.RAPID_API_KEY,
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

export async function searchExerciseDB(exerciseName: string, env: RapidApiEnv): Promise<ExerciseDbExercise[]> {
  const normalizedQuery = exerciseName.toLowerCase();
  const cached = getCachedValue(searchCache, normalizedQuery);
  if (cached) {
    return cached;
  }

  const payload = await getExerciseCatalog(env);
  const results = payload
    .filter((exercise) => exercise.name.toLowerCase().includes(normalizedQuery))
    .slice(0, 8);
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
  const exercises = await searchExerciseDB(exerciseName, env);
  if (exercises.length === 0) return null;

  const exercise = exercises[0];
  const media = await fetchExerciseMedia(exercise.id, env);
  const video = !media?.gifUrl ? await fetchExerciseVideo(exercise.id, env) : null;

  return {
    id: exercise.id,
    name: exercise.name,
    bodyPart: exercise.bodyPart ?? "full body",
    target: exercise.target ?? "full body",
    secondaryMuscles: Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : [],
    instructions: Array.isArray(exercise.instructions) ? exercise.instructions : [],
    gifUrl: media?.gifUrl ?? null,
    imageUrl: media?.imageUrl ?? null,
    videoUrl: video?.videoUrl ?? null,
    thumbnailUrl: video?.thumbnailUrl ?? null,
  };
}
