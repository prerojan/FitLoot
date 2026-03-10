type RapidApiEnv = {
  RAPID_API_KEY?: string | undefined;
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
  description?: string | undefined;
  difficulty?: string | undefined;
  category?: string | undefined;
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

const RAPID_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX_ENTRIES = 250;
const EXERCISE_DB_HOST = "exercisedb.p.rapidapi.com";
const EXERCISE_DB_NAME_LIMIT = 10;
const EXERCISE_DB_MAX_RESOLUTION = 180;

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

function normalizeExerciseNameToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStringList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      return item.trim();
    }
  }
  return null;
}

function normalizeExerciseMediaUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim().length === 0) return null;
  const trimmed = url.trim();

  try {
    const parsed = new URL(trimmed);
    const resolutionRaw = parsed.searchParams.get("resolution");
    const isImageServiceRoute =
      parsed.hostname.toLowerCase().includes(EXERCISE_DB_HOST) &&
      parsed.pathname.toLowerCase() === "/image";

    if (resolutionRaw) {
      const resolutionValue = Number(resolutionRaw);
      if (!Number.isFinite(resolutionValue) || resolutionValue !== EXERCISE_DB_MAX_RESOLUTION) {
        parsed.searchParams.set("resolution", String(EXERCISE_DB_MAX_RESOLUTION));
      }
    } else if (isImageServiceRoute) {
      parsed.searchParams.set("resolution", String(EXERCISE_DB_MAX_RESOLUTION));
    }

    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function splitDescriptionIntoInstructions(description: string | undefined): string[] {
  if (typeof description !== "string" || description.trim().length === 0) return [];
  return description
    .split(/[\n.;]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 6);
}

function uniqueExercisesById(exercises: ExerciseDbExercise[]): ExerciseDbExercise[] {
  const seenIds = new Set<string>();
  const unique: ExerciseDbExercise[] = [];

  for (const exercise of exercises) {
    const id = String(exercise.id ?? "").trim();
    if (id.length === 0 || seenIds.has(id)) continue;
    seenIds.add(id);
    unique.push(exercise);
  }

  return unique;
}

function buildExerciseNameSearchTerms(normalizedQuery: string): string[] {
  const terms = [normalizedQuery];
  const tokens = normalizedQuery.split(" ").filter((token) => token.length > 0);

  if (tokens.length >= 2) {
    terms.push(tokens.slice(0, 2).join(" "));
  }
  if (tokens.length >= 1) {
    terms.push(tokens[0], tokens[tokens.length - 1]);
  }

  const aliasRules: Array<{ match: RegExp; alias: string }> = [
    { match: /\bflexao\b|\bpush[\s-]?up\b/, alias: "push-up" },
    { match: /\bagachamento\b|\bsquat\b/, alias: "squat" },
    { match: /\babdominal\b|\bcrunch\b|\bsit[\s-]?up\b/, alias: "sit-up" },
    { match: /\bprancha\b|\bplank\b/, alias: "plank" },
    { match: /\bcorrida\b|\brun\b|\btrote\b/, alias: "run" },
    { match: /\bcaminhada\b|\bwalk\b/, alias: "walk" },
    { match: /\balongamento\b|\bstretch\b/, alias: "stretching" },
    { match: /\bbarra\b|\bpull[\s-]?up\b/, alias: "pull-up" },
    { match: /\bavanco\b|\blunge\b/, alias: "lunge" },
    { match: /\bburpee\b/, alias: "burpee" },
  ];

  for (const rule of aliasRules) {
    if (rule.match.test(normalizedQuery)) {
      terms.push(rule.alias);
    }
  }

  const unique = new Set<string>();
  const finalTerms: string[] = [];
  for (const term of terms) {
    const normalizedTerm = normalizeExerciseNameToken(term);
    if (!normalizedTerm || unique.has(normalizedTerm)) continue;
    unique.add(normalizedTerm);
    finalTerms.push(normalizedTerm);
  }

  return finalTerms.slice(0, 6);
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

  const searchTerms = buildExerciseNameSearchTerms(normalizedQuery);
  const collected: ExerciseDbExercise[] = [];

  for (const searchTerm of searchTerms) {
    try {
      const directByName = await rapidGet<ExerciseDbExercise[]>(
        `https://${EXERCISE_DB_HOST}/exercises/name/${encodeURIComponent(searchTerm)}?offset=0&limit=${EXERCISE_DB_NAME_LIMIT}&sortMethod=name&sortOrder=ascending`,
        EXERCISE_DB_HOST,
        env,
      );

      if (Array.isArray(directByName) && directByName.length > 0) {
        collected.push(...directByName);
      }
    } catch {
      // Name lookup can fail for translated aliases; keep trying other variants.
    }
  }

  const results = rankExercisesByName(uniqueExercisesById(collected), normalizedQuery);
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
  const exerciseDbGifUrl = normalizeExerciseMediaUrl(
    typeof exercise.gifUrl === "string" ? exercise.gifUrl : null
  );
  const exerciseDbImageUrl = normalizeExerciseMediaUrl(
    typeof exercise.imageUrl === "string" ? exercise.imageUrl : null
  );

  const directInstructions = normalizeStringList(exercise.instructions, 8);
  const descriptionInstructions = splitDescriptionIntoInstructions(exercise.description);
  const mediaInstructions = normalizeStringList(media?.instructions, 8);
  const exerciseInstructions = directInstructions.length > 0
    ? directInstructions
    : descriptionInstructions.length > 0
      ? descriptionInstructions
      : mediaInstructions;

  const bodyPart =
    typeof exercise.bodyPart === "string" && exercise.bodyPart.trim().length > 0
      ? exercise.bodyPart
      : (firstString(media?.bodyParts) ?? "full body");

  const target =
    typeof exercise.target === "string" && exercise.target.trim().length > 0
      ? exercise.target
      : (firstString(media?.targetMuscles) ?? "full body");

  const secondaryMusclesFromExercise = normalizeStringList(exercise.secondaryMuscles, 8);
  const secondaryMusclesFromMedia = normalizeStringList(
    Array.isArray(media?.targetMuscles)
      ? media.targetMuscles.filter((muscle) => normalizeExerciseNameToken(muscle) !== normalizeExerciseNameToken(target))
      : [],
    8,
  );
  const secondaryMuscles = secondaryMusclesFromExercise.length > 0
    ? secondaryMusclesFromExercise
    : secondaryMusclesFromMedia;

  return {
    id: exercise.id,
    name: exercise.name,
    bodyPart,
    target,
    equipment: exercise.equipment ?? "body weight",
    secondaryMuscles,
    instructions: exerciseInstructions,
    gifUrl: normalizeExerciseMediaUrl(media?.gifUrl ?? null),
    ascendImageUrl: normalizeExerciseMediaUrl(media?.imageUrl ?? null),
    exerciseDbGifUrl,
    exerciseDbImageUrl,
    imageUrl: exerciseDbImageUrl,
    videoUrl: video?.videoUrl ?? null,
    thumbnailUrl: normalizeExerciseMediaUrl(video?.thumbnailUrl ?? null),
  };
}
