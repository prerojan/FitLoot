import { resolveExerciseSearchTerms, resolvePreferredExerciseDbId } from "../../shared/exerciseCatalog";
import { normalizeMissionMediaUrl } from "../../shared/missionLocalization";

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
  videoUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  secondaryMuscles?: string[] | undefined;
  instructions?: string[] | undefined;
};

type PublicExerciseDbExercise = {
  exerciseId?: string | undefined;
  name?: string | undefined;
  gifUrl?: string | undefined;
  imageUrl?: string | undefined;
  videoUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  targetMuscles?: string[] | undefined;
  bodyParts?: string[] | undefined;
  equipments?: string[] | undefined;
  secondaryMuscles?: string[] | undefined;
  instructions?: string[] | undefined;
};

type PublicExerciseDbApiEnvelope<T> = {
  success?: boolean | undefined;
  data?: T | undefined;
};

type PublicExerciseDbListResponse = PublicExerciseDbApiEnvelope<PublicExerciseDbExercise[]>;

type PublicExerciseDbSingleResponse = PublicExerciseDbApiEnvelope<PublicExerciseDbExercise>;

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

export type EnrichExerciseOptions = {
  exerciseDbId?: string | null | undefined;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

// Resolves exercise catalog, media, and search fallbacks without changing mission semantics for consumers.
const RAPID_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX_ENTRIES = 250;
const EXERCISE_DB_PUBLIC_API_BASE = "https://www.exercisedb.dev/api/v1";
const EXERCISE_SEARCH_ALIASES = new Map<string, readonly string[]>([
  ["flexao", ["push-up", "pushup"]],
  ["push up", ["push-up", "pushup"]],
  ["push-up", ["push-up", "pushup"]],
  ["flexao diamante", ["diamond push-up"]],
  ["flexao inclinada", ["incline push-up"]],
  ["flexao declinada", ["decline push-up"]],
  ["flexao aberta", ["wide-grip push-up"]],
  ["agachamento", ["air squat", "bodyweight squat", "squat"]],
  ["agachamento livre", ["air squat", "bodyweight squat", "squat"]],
  ["air squat", ["air squat", "bodyweight squat", "squat"]],
  ["agachamento bulgaro", ["bulgarian split squat"]],
  ["agachamento sumo", ["sumo squat"]],
  ["prancha", ["front plank", "plank"]],
  ["plank", ["front plank", "plank"]],
  ["prancha lateral", ["side plank"]],
  ["abdominal", ["crunch", "sit-up"]],
  ["abdominais", ["crunch", "sit-up"]],
  ["flexao abdominal", ["crunch", "sit-up"]],
  ["abdominal supra", ["crunch"]],
  ["abdominal infra", ["leg raise"]],
  ["abdominal bicicleta", ["bicycle crunch"]],
  ["avanco", ["walking lunge", "lunge"]],
  ["lunge", ["walking lunge", "lunge"]],
  ["afundo", ["lunge"]],
  ["ponte de gluteos", ["glute bridge"]],
  ["elevacao pelvica", ["glute bridge", "hip thrust"]],
  ["barra fixa", ["pull-up"]],
  ["barra supinada", ["chin-up"]],
  ["suspensao na barra", ["dead hang"]],
  ["cadeira isometrica", ["wall sit"]],
  ["caminhada", ["walking", "walk"]],
  ["corrida", ["running", "run"]],
  ["alongamento", ["stretching"]],
  ["mobilidade", ["mobility flow", "mobility"]],
  ["yoga", ["yoga flow", "yoga"]],
  ["burpee", ["burpee"]],
  ["hollow body", ["hollow body hold", "hollow body"]],
  ["hollow body hold", ["hollow body hold", "hollow body"]],
  ["hollow hold", ["hollow body hold", "hollow body"]],
  ["isometria hollow", ["hollow body hold", "hollow body"]],
  ["bird dog", ["bird dog"]],
  ["extensao alternada em quatro apoios", ["bird dog"]],
  ["dead bug", ["dead bug"]],
  ["polichinelo", ["jumping jack"]],
  ["mountain climber", ["mountain climber"]],]);

type ExerciseSearchHint = {
  exactNames: readonly string[];
  preferredTargets: readonly string[];
  preferredBodyParts: readonly string[];
  preferredEquipments: readonly string[];
  penalizedNameTokens: readonly string[];
  allowStartsWithExactName?: boolean | undefined;
};

const EXERCISE_SEARCH_HINTS = new Map<string, ExerciseSearchHint>([
  ["push-up", {
    exactNames: ["push-up"],
    preferredTargets: ["pectorals", "chest", "triceps"],
    preferredBodyParts: ["chest", "upper arms"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["sit up", "crunch", "twist", "weighted", "suspended"],
  }],
  ["air squat", {
    exactNames: ["air squat", "bodyweight squat", "squat"],
    preferredTargets: ["quads", "glutes", "hamstrings"],
    preferredBodyParts: ["upper legs"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["jerk", "weighted", "smith", "barbell"],
  }],
  ["squat", {
    exactNames: ["air squat", "bodyweight squat", "squat"],
    preferredTargets: ["quads", "glutes", "hamstrings"],
    preferredBodyParts: ["upper legs"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["jerk", "weighted", "smith", "barbell"],
  }],
  ["front plank", {
    exactNames: ["front plank", "plank"],
    preferredTargets: ["abs", "core"],
    preferredBodyParts: ["waist"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["weighted", "power point", "twist"],
    allowStartsWithExactName: false,
  }],
  ["plank", {
    exactNames: ["front plank", "plank"],
    preferredTargets: ["abs", "core"],
    preferredBodyParts: ["waist"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["weighted", "power point", "twist"],
    allowStartsWithExactName: false,
  }],
  ["walking lunge", {
    exactNames: ["walking lunge", "lunge"],
    preferredTargets: ["glutes", "quads", "hamstrings"],
    preferredBodyParts: ["upper legs"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["twist", "barbell", "dumbbell", "weighted"],
  }],
  ["lunge", {
    exactNames: ["walking lunge", "lunge"],
    preferredTargets: ["glutes", "quads", "hamstrings"],
    preferredBodyParts: ["upper legs"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["twist", "barbell", "dumbbell", "weighted"],
  }],
  ["crunch", {
    exactNames: ["crunch", "sit-up"],
    preferredTargets: ["abs", "core"],
    preferredBodyParts: ["waist"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["leg", "twist", "machine", "weighted", "push-up", "flexao de braco"],
  }],
  ["sit-up", {
    exactNames: ["sit-up", "crunch"],
    preferredTargets: ["abs", "core"],
    preferredBodyParts: ["waist"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["leg", "twist", "machine", "weighted", "push-up", "flexao de braco"],
  }],
  ["glute bridge", {
    exactNames: ["glute bridge", "hip bridge"],
    preferredTargets: ["glutes"],
    preferredBodyParts: ["upper legs", "waist"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["barbell", "weighted", "single leg"],
  }],
  ["jumping jack", {
    exactNames: ["jumping jack"],
    preferredTargets: ["cardio", "full body"],
    preferredBodyParts: ["cardiovascular system"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["weighted", "band"],
  }],
  ["mountain climber", {
    exactNames: ["mountain climber"],
    preferredTargets: ["abs", "core", "cardio"],
    preferredBodyParts: ["waist"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["weighted", "slider"],
  }],
  ["diamond push-up", {
    exactNames: ["diamond push-up", "close-grip push-up"],
    preferredTargets: ["triceps", "pectorals"],
    preferredBodyParts: ["upper arms", "chest"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["weighted", "wide"],
  }],
  ["bird dog", {
    exactNames: ["bird dog"],
    preferredTargets: ["abs", "core", "glutes"],
    preferredBodyParts: ["waist", "upper legs"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["weighted", "machine"],
    allowStartsWithExactName: false,
  }],
  ["hollow body hold", {
    exactNames: ["hollow body hold", "hollow body"],
    preferredTargets: ["abs", "core"],
    preferredBodyParts: ["waist"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["weighted", "machine"],
    allowStartsWithExactName: false,
  }],
  ["dead bug", {
    exactNames: ["dead bug"],
    preferredTargets: ["abs", "core"],
    preferredBodyParts: ["waist"],
    preferredEquipments: ["body weight"],
    penalizedNameTokens: ["weighted", "machine"],
    allowStartsWithExactName: false,
  }],]);

let exerciseCatalogCache: CacheEntry<ExerciseDbExercise[]> | null = null;
const searchCache = new Map<string, CacheEntry<ExerciseDbExercise[]>>();
const mediaCache = new Map<string, CacheEntry<AscendExercise | null>>();
const videoCache = new Map<string, CacheEntry<AscendVideoExercise | null>>();

// Cache and transport helpers keep third-party lookups bounded and reusable during enrichment bursts.
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
  const apiKey = typeof env.RAPID_API_KEY === "string" ? env.RAPID_API_KEY.trim() : "";
  return apiKey.length > 0 ? apiKey : null;
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

async function publicExerciseDbGet<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(`${EXERCISE_DB_PUBLIC_API_BASE}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  }, RAPID_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`exercisedb-public-request-failed:${response.status}`);
  }

  return (await response.json()) as T;
}

function normalizeExerciseDbExercise(raw: PublicExerciseDbExercise | ExerciseDbExercise | null | undefined): ExerciseDbExercise | null {
  if (!raw) return null;

  const id = ("id" in raw && typeof raw.id === "string")
    ? raw.id
    : ("exerciseId" in raw && typeof raw.exerciseId === "string")
      ? raw.exerciseId
      : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;

  const bodyParts = ("bodyParts" in raw && Array.isArray(raw.bodyParts)) ? raw.bodyParts : [];
  const targetMuscles = ("targetMuscles" in raw && Array.isArray(raw.targetMuscles)) ? raw.targetMuscles : [];
  const equipments = ("equipments" in raw && Array.isArray(raw.equipments)) ? raw.equipments : [];

  return {
    id,
    name,
    bodyPart: ("bodyPart" in raw && typeof raw.bodyPart === "string") ? raw.bodyPart : (typeof bodyParts[0] === "string" ? bodyParts[0] : undefined),
    target: ("target" in raw && typeof raw.target === "string") ? raw.target : (typeof targetMuscles[0] === "string" ? targetMuscles[0] : undefined),
    equipment: ("equipment" in raw && typeof raw.equipment === "string") ? raw.equipment : (typeof equipments[0] === "string" ? equipments[0] : undefined),
    gifUrl: normalizeMissionMediaUrl(raw.gifUrl) ?? undefined,
    imageUrl: normalizeMissionMediaUrl(raw.imageUrl ?? ("thumbnailUrl" in raw ? raw.thumbnailUrl : undefined)) ?? undefined,
    videoUrl: normalizeMissionMediaUrl(raw.videoUrl) ?? undefined,
    thumbnailUrl: normalizeMissionMediaUrl(("thumbnailUrl" in raw ? raw.thumbnailUrl : undefined) ?? raw.imageUrl) ?? undefined,
    secondaryMuscles: Array.isArray(raw.secondaryMuscles) ? raw.secondaryMuscles : undefined,
    instructions: Array.isArray(raw.instructions) ? raw.instructions : undefined,
  };
}

function normalizeExerciseDbCollection(payload: unknown): ExerciseDbExercise[] {
  const items = Array.isArray(payload)
    ? payload
    : (typeof payload === "object" && payload !== null && Array.isArray((payload as PublicExerciseDbListResponse).data))
      ? (payload as PublicExerciseDbListResponse).data ?? []
      : [];

  return items
    .map((item) => normalizeExerciseDbExercise(item as PublicExerciseDbExercise | ExerciseDbExercise))
    .filter((item): item is ExerciseDbExercise => item !== null);
}

function mergeExerciseDbExercise(
  primary: ExerciseDbExercise,
  secondary: ExerciseDbExercise | null | undefined,
): ExerciseDbExercise {
  if (!secondary) return primary;

  return {
    ...primary,
    bodyPart: primary.bodyPart ?? secondary.bodyPart,
    target: primary.target ?? secondary.target,
    equipment: primary.equipment ?? secondary.equipment,
    gifUrl: primary.gifUrl ?? secondary.gifUrl,
    imageUrl: primary.imageUrl ?? secondary.imageUrl,
    videoUrl: primary.videoUrl ?? secondary.videoUrl,
    thumbnailUrl: primary.thumbnailUrl ?? secondary.thumbnailUrl,
    secondaryMuscles: primary.secondaryMuscles ?? secondary.secondaryMuscles,
    instructions: primary.instructions ?? secondary.instructions,
  };
}

function mergeExerciseResults(
  query: string,
  ...collections: ReadonlyArray<ExerciseDbExercise[]>
): ExerciseDbExercise[] {
  const byId = new Map<string, ExerciseDbExercise>();

  for (const collection of collections) {
    for (const exercise of collection) {
      const existing = byId.get(exercise.id);
      byId.set(exercise.id, existing ? mergeExerciseDbExercise(existing, exercise) : exercise);
    }
  }

  return rankExercisesByName(Array.from(byId.values()), query);
}

async function fetchPublicExerciseDetail(exerciseId: string): Promise<ExerciseDbExercise | null> {
  if (!exerciseId.trim()) return null;

  try {
    const payload = await publicExerciseDbGet<PublicExerciseDbSingleResponse>(
      `/exercises/${encodeURIComponent(exerciseId)}`,
    );
    return normalizeExerciseDbExercise(payload.data);
  } catch {
    return null;
  }
}

async function fetchRapidExerciseDetail(exerciseId: string, env: RapidApiEnv): Promise<ExerciseDbExercise | null> {
  if (!exerciseId.trim() || resolveRapidApiKey(env) === null) return null;

  const detailUrls = [
    `https://exercisedb.p.rapidapi.com/exercises/exercise/${encodeURIComponent(exerciseId)}`,
    `https://exercisedb.p.rapidapi.com/exercises/${encodeURIComponent(exerciseId)}`,
  ];

  for (const url of detailUrls) {
    try {
      const payload = await rapidGet<unknown>(url, "exercisedb.p.rapidapi.com", env);
      const normalized = normalizeExerciseDbExercise(
        Array.isArray(payload)
          ? (payload[0] as PublicExerciseDbExercise | ExerciseDbExercise | undefined)
          : (payload as PublicExerciseDbExercise | ExerciseDbExercise | null | undefined),
      );
      if (normalized) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return null;
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

  const normalized = normalizeExerciseDbCollection(payload);
  exerciseCatalogCache = {
    value: normalized,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return normalized;
}

// Query-building helpers normalize mission titles so search remains stable across aliases and localized names.
function normalizeExerciseNameToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExerciseTextList(values: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizeExerciseNameToken(value))
    .filter((value) => value.length > 0);
}

function resolveExerciseSearchHint(query: string): ExerciseSearchHint | null {
  const normalizedQuery = normalizeExerciseNameToken(query);
  if (!normalizedQuery) return null;
  return EXERCISE_SEARCH_HINTS.get(normalizedQuery) ?? null;
}

function stripExerciseNameSuffix(normalizedValue: string): string {
  return normalizedValue
    .replace(/\s*\((?:male|female)\)\s*$/iu, "")
    .trim();
}

function hasExactExerciseNameMatch(
  normalizedName: string,
  exactNames: readonly string[],
  allowStartsWithExactName: boolean,
): boolean {
  const strippedName = stripExerciseNameSuffix(normalizedName);
  return exactNames.some((candidate) => {
    if (strippedName === candidate) {
      return true;
    }

    return allowStartsWithExactName && strippedName.startsWith(`${candidate} `);
  });
}

function isSafeExerciseNameForQuery(exercise: ExerciseDbExercise, query: string): boolean {
  const hint = resolveExerciseSearchHint(query);
  if (!hint) return true;

  const normalizedName = normalizeExerciseNameToken(exercise.name);
  if (!normalizedName) return false;

  const exactNames = normalizeExerciseTextList(hint.exactNames);
  const penalizedTokens = normalizeExerciseTextList(hint.penalizedNameTokens);
  const hasExactNameMatch = hasExactExerciseNameMatch(
    normalizedName,
    exactNames,
    hint.allowStartsWithExactName !== false,
  );

  if (exactNames.length > 0) {
    return hasExactNameMatch;
  }

  return !penalizedTokens.some((token) => token.length > 0 && normalizedName.includes(token));
}

function stripMissionPrefix(value: string): string {
  const normalized = value.trim();
  const lower = normalizeExerciseNameToken(normalized);
  const prefixes = [
    "missao diaria:",
    "missao semanal:",
    "missao mensal:",
  ];

  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return normalized.slice(prefix.length).trim();
    }
  }

  return normalized;
}

function stripParentheticalSegments(value: string): string {
  let depth = 0;
  let output = "";
  for (const character of value) {
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      output += character;
    }
  }
  return output;
}

function buildExerciseSearchQueries(exerciseName: string): string[] {
  const normalizedBase = normalizeExerciseNameToken(stripMissionPrefix(exerciseName));
  if (!normalizedBase) return [];

  const queries: string[] = [];
  const seen = new Set<string>();
  const pushQuery = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    queries.push(value);
  };

  for (const seedTerm of resolveExerciseSearchTerms(exerciseName)) {
    const normalizedSeedTerm = normalizeExerciseNameToken(seedTerm);
    if (normalizedSeedTerm) {
      pushQuery(normalizedSeedTerm);
    }
  }

  const aliases = EXERCISE_SEARCH_ALIASES.get(normalizedBase) ?? [];
  for (const alias of aliases) {
    const normalizedAlias = normalizeExerciseNameToken(alias);
    if (normalizedAlias) {
      pushQuery(normalizedAlias);
    }
  }
  pushQuery(normalizedBase);
  const descriptorWords = new Set([
    "iniciante",
    "intermediario",
    "avancado",
    "sedentario",
    "leve",
    "moderado",
    "moderada",
    "intenso",
    "intensa",
  ]);
  const withoutTail = normalizedBase.split(" - ")[0] ?? normalizedBase;
  const withoutParenthetical = stripParentheticalSegments(withoutTail);
  const withoutDescriptors = withoutParenthetical
    .split(" ")
    .filter((token) => token.length > 0 && !descriptorWords.has(token))
    .join(" ")
    .trim();
  if (withoutDescriptors && withoutDescriptors !== normalizedBase) {
    pushQuery(withoutDescriptors);
  }

  return queries;
}

function rankExercisesByName(exercises: ExerciseDbExercise[], query: string): ExerciseDbExercise[] {
  const normalizedQuery = normalizeExerciseNameToken(query);
  if (!normalizedQuery) return exercises.slice(0, 8);

  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length > 0);
  const hint = resolveExerciseSearchHint(query);
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

  const scoreExercise = (exercise: ExerciseDbExercise): number => {
    const normalizedName = normalizeExerciseNameToken(exercise.name);
    const target = normalizeExerciseNameToken(exercise.target ?? "");
    const bodyPart = normalizeExerciseNameToken(exercise.bodyPart ?? "");
    const equipment = normalizeExerciseNameToken(exercise.equipment ?? "");
    let score = scoreByName(exercise.name);

    if (hint) {
      const exactNames = normalizeExerciseTextList(hint.exactNames);
      const preferredTargets = normalizeExerciseTextList(hint.preferredTargets);
      const preferredBodyParts = normalizeExerciseTextList(hint.preferredBodyParts);
      const preferredEquipments = normalizeExerciseTextList(hint.preferredEquipments);
      const penalizedTokens = normalizeExerciseTextList(hint.penalizedNameTokens);

      if (exactNames.some((candidate) => normalizedName === candidate)) {
        score += 180;
      } else if (exactNames.some((candidate) => normalizedName.startsWith(candidate))) {
        score += 80;
      }

      if (preferredTargets.includes(target)) {
        score += 45;
      }
      if (preferredBodyParts.includes(bodyPart)) {
        score += 35;
      }
      if (preferredEquipments.includes(equipment)) {
        score += 40;
      }
      if (penalizedTokens.some((token) => normalizedName.includes(token))) {
        score -= 120;
      }
    }

    if (exercise.videoUrl) score += 55;
    if (exercise.thumbnailUrl) score += 18;
    if (exercise.imageUrl) score += 15;
    if (exercise.gifUrl) score += 25;
    if (Array.isArray(exercise.instructions) && exercise.instructions.length > 0) {
      score += 10;
    }

    return score;
  };

  return exercises
    .slice()
    .sort((a, b) => scoreExercise(b) - scoreExercise(a))
    .slice(0, 8);
}

export async function searchExerciseDB(exerciseName: string, env: RapidApiEnv): Promise<ExerciseDbExercise[]> {
  const queryCandidates = buildExerciseSearchQueries(exerciseName);
  const normalizedQuery = queryCandidates[0] ?? "";
  if (!normalizedQuery) return [];

  const cached = getCachedValue(searchCache, normalizedQuery);
  if (cached) {
    return cached;
  }

  const hasRapidApiKey = resolveRapidApiKey(env) !== null;
  const runRapidSearch = async (query: string): Promise<ExerciseDbExercise[]> => {
    try {
      const directByName = await rapidGet<ExerciseDbExercise[]>(
        `https://exercisedb.p.rapidapi.com/exercises/name/${encodeURIComponent(query)}?offset=0&limit=24`,
        "exercisedb.p.rapidapi.com",
        env,
      );
      const normalizedResults = normalizeExerciseDbCollection(directByName);
      return normalizedResults.length > 0
        ? rankExercisesByName(normalizedResults, query)
        : [];
    } catch {
      return [];
    }
  };
  const runPublicSearch = async (query: string): Promise<ExerciseDbExercise[]> => {
    try {
      const directByName = await publicExerciseDbGet<PublicExerciseDbListResponse>(
        `/exercises/search?q=${encodeURIComponent(query)}&offset=0&limit=12&threshold=0.25`,
      );
      const normalizedResults = normalizeExerciseDbCollection(directByName);
      return normalizedResults.length > 0
        ? rankExercisesByName(normalizedResults, query)
        : [];
    } catch {
      return [];
    }
  };

  for (const query of queryCandidates) {
    const queryCache = getCachedValue(searchCache, query);
    if (queryCache && queryCache.length > 0) {
      setCachedValue(searchCache, normalizedQuery, queryCache);
      return queryCache;
    }

    const publicResults = await runPublicSearch(query);
    const rapidResults = hasRapidApiKey
      ? await runRapidSearch(query)
      : [];
    let results = mergeExerciseResults(query, publicResults, rapidResults);
    const safeResults = results.filter((exercise) => isSafeExerciseNameForQuery(exercise, query));
    if (safeResults.length > 0) {
      results = safeResults;
    } else if (resolveExerciseSearchHint(query)) {
      results = [];
    }

    if (results.length === 0 && hasRapidApiKey) {
      try {
        const payload = await getExerciseCatalog(env);
        const fallbackMatches = payload.filter((exercise) =>
          normalizeExerciseNameToken(exercise.name).includes(query),
        );
        results = rankExercisesByName(fallbackMatches, query);
        const safeFallbackResults = results.filter((exercise) => isSafeExerciseNameForQuery(exercise, query));
        if (safeFallbackResults.length > 0) {
          results = safeFallbackResults;
        } else if (resolveExerciseSearchHint(query)) {
          results = [];
        }
      } catch {
        results = [];
      }
    }

    setCachedValue(searchCache, query, results);
    if (results.length > 0) {
      setCachedValue(searchCache, normalizedQuery, results);
      return results;
    }
  }

  setCachedValue(searchCache, normalizedQuery, []);
  return [];
}

// Media fetchers isolate the Ascend lookups used to complement catalog metadata.
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

// Final enrichment merges catalog, media, and instruction sources into the payload expected by mission consumers.
async function resolveEnrichedExerciseCandidate(
  baseExercise: ExerciseDbExercise,
  env: RapidApiEnv,
): Promise<{ score: number; value: EnrichedExercise }> {
  const [publicDetail, rapidDetail, media, video] = await Promise.all([
    fetchPublicExerciseDetail(baseExercise.id),
    fetchRapidExerciseDetail(baseExercise.id, env),
    fetchExerciseMedia(baseExercise.id, env),
    fetchExerciseVideo(baseExercise.id, env),
  ]);

  const exercise = mergeExerciseDbExercise(
    mergeExerciseDbExercise(baseExercise, publicDetail),
    rapidDetail,
  );
  const ascendGifUrl = normalizeMissionMediaUrl(media?.gifUrl) ?? null;
  const ascendImageUrl = normalizeMissionMediaUrl(media?.imageUrl) ?? null;
  const exerciseDbGifUrl = normalizeMissionMediaUrl(exercise.gifUrl) ?? null;
  const exerciseDbImageUrl =
    normalizeMissionMediaUrl(exercise.imageUrl)
    ?? normalizeMissionMediaUrl(exercise.thumbnailUrl)
    ?? exerciseDbGifUrl;
  const exerciseDbVideoUrl = normalizeMissionMediaUrl(exercise.videoUrl) ?? null;
  const exerciseDbThumbnailUrl =
    normalizeMissionMediaUrl(exercise.thumbnailUrl)
    ?? exerciseDbImageUrl;
  const exerciseInstructions =
    Array.isArray(exercise.instructions) && exercise.instructions.length > 0
      ? exercise.instructions
      : Array.isArray(media?.instructions)
        ? media.instructions
        : [];
  const resolvedVideoUrl =
    exerciseDbVideoUrl
    ?? normalizeMissionMediaUrl(video?.videoUrl);
  const resolvedImageUrl =
    ascendGifUrl
    ?? exerciseDbGifUrl
    ?? ascendImageUrl
    ?? normalizeMissionMediaUrl(video?.thumbnailUrl)
    ?? exerciseDbThumbnailUrl
    ?? exerciseDbImageUrl;
  const resolvedThumbnailUrl =
    normalizeMissionMediaUrl(video?.thumbnailUrl)
    ?? ascendImageUrl
    ?? exerciseDbThumbnailUrl
    ?? exerciseDbImageUrl;

  const score =
    (ascendGifUrl ? 80 : 0)
    + (exerciseDbGifUrl ? 60 : 0)
    + (resolvedVideoUrl ? 55 : 0)
    + (resolvedThumbnailUrl ? 18 : 0)
    + (resolvedImageUrl ? 24 : 0)
    + (exerciseInstructions.length > 0 ? 16 : 0);

  return {
    score,
    value: {
      id: exercise.id,
      name: exercise.name,
      bodyPart: exercise.bodyPart ?? "",
      target: exercise.target ?? "",
      equipment: exercise.equipment ?? "",
      secondaryMuscles: Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : [],
      instructions: exerciseInstructions,
      gifUrl: ascendGifUrl ?? exerciseDbGifUrl,
      ascendImageUrl,
      exerciseDbGifUrl,
      exerciseDbImageUrl,
      imageUrl: resolvedImageUrl,
      videoUrl: resolvedVideoUrl,
      thumbnailUrl: resolvedThumbnailUrl,
    },
  };
}

async function enrichExerciseById(exerciseDbId: string, env: RapidApiEnv): Promise<EnrichedExercise | null> {
  const normalizedId = exerciseDbId.trim();
  if (!normalizedId) return null;

  const [publicDetail, rapidDetail] = await Promise.all([
    fetchPublicExerciseDetail(normalizedId),
    fetchRapidExerciseDetail(normalizedId, env),
  ]);
  const baseExercise = rapidDetail ?? publicDetail;
  if (!baseExercise) return null;

  const resolved = await resolveEnrichedExerciseCandidate(baseExercise, env);
  return resolved.value;
}

export async function enrichExercise(
  exerciseName: string,
  env: RapidApiEnv,
  options?: EnrichExerciseOptions,
): Promise<EnrichedExercise | null> {
  const preferredExerciseDbId = resolvePreferredExerciseDbId(exerciseName)
    ?? (typeof options?.exerciseDbId === "string" ? options.exerciseDbId.trim() : "");
  if (preferredExerciseDbId) {
    const enrichedById = await enrichExerciseById(preferredExerciseDbId, env).catch(() => null);
    if (enrichedById) {
      return enrichedById;
    }
  }

  let exercises: ExerciseDbExercise[] = [];
  try {
    exercises = await searchExerciseDB(exerciseName, env);
  } catch {
    exercises = [];
  }
  if (exercises.length === 0) {
    return null;
  }

  const candidates = exercises.slice(0, 3);
  const resolvedCandidates = await Promise.all(
    candidates.map((baseExercise) => resolveEnrichedExerciseCandidate(baseExercise, env)),
  );

  const bestCandidate = resolvedCandidates
    .filter((candidate) =>
      isSafeExerciseNameForQuery(
        {
          id: candidate.value.id,
          name: candidate.value.name,
        },
        exerciseName,
      ),
    )
    .slice()
    .sort((left, right) => right.score - left.score)[0];

  return bestCandidate?.value ?? null;
}
