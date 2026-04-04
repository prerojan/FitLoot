import { macroSkillSeeds, variantSkillSeeds, type VariantSkillSeed } from "./coreSkillSeeds";

const exerciseSeedCatalog: VariantSkillSeed[] = [...variantSkillSeeds, ...macroSkillSeeds];

type SupplementalExerciseCatalogEntry = {
  slug: string;
  namePt: string;
  searchTerms: string[];
  aliases: string[];
  exerciseDbId?: string | undefined;
  visualFallbackExerciseDbId?: string | undefined;
  muscles: string[];
  supportedForMission: boolean;
  replacementSlug?: string | undefined;
};

const supplementalExerciseCatalog: SupplementalExerciseCatalogEntry[] = [
  {
    slug: "push-up-traditional",
    namePt: "Flexao tradicional",
    searchTerms: ["push-up"],
    exerciseDbId: "I4hDWkc",
    aliases: ["push-up", "push up", "flexao", "flexao tradicional", "flexão", "flexão tradicional"],
    muscles: ["upper", "chest", "push", "full body"],
    supportedForMission: true,
  },
  {
    slug: "diamond-push-up",
    namePt: "Flexao diamante",
    searchTerms: ["diamond push-up"],
    exerciseDbId: "soIB2rj",
    aliases: ["diamond push-up", "diamond push up", "flexao diamante", "flexão diamante"],
    muscles: ["upper", "chest", "triceps", "push"],
    supportedForMission: true,
  },
  {
    slug: "pike-push-up",
    namePt: "Flexao pike",
    searchTerms: ["pike push-up"],
    aliases: ["pike push-up", "pike push up", "flexao pike", "flexão pike"],
    muscles: ["upper", "shoulders", "push"],
    supportedForMission: false,
    replacementSlug: "push-up-traditional",
  },
  {
    slug: "triceps-dip",
    namePt: "Mergulho de triceps",
    searchTerms: ["triceps dip"],
    exerciseDbId: "X6C6i5Y",
    aliases: ["triceps dip", "dip", "dips", "bench dip", "bench dips", "mergulho de triceps", "mergulho de tríceps"],
    muscles: ["upper", "triceps", "push"],
    supportedForMission: true,
  },
  {
    slug: "air-squat",
    namePt: "Agachamento livre",
    searchTerms: ["air squat", "bodyweight squat"],
    exerciseDbId: "QChZi3x",
    aliases: ["air squat", "bodyweight squat", "squat", "agachamento", "agachamento livre"],
    muscles: ["lower", "legs", "glutes", "quads", "full body"],
    supportedForMission: true,
  },
  {
    slug: "walking-lunge",
    namePt: "Avanco caminhando",
    searchTerms: ["walking lunge", "lunge"],
    exerciseDbId: "IZVHb27",
    aliases: ["walking lunge", "lunge", "reverse lunge", "lunges", "avanco", "avanço", "avanco caminhando", "avanço caminhando"],
    muscles: ["lower", "legs", "glutes", "quads"],
    supportedForMission: true,
  },
  {
    slug: "glute-bridge",
    namePt: "Ponte de gluteos",
    searchTerms: ["glute bridge"],
    exerciseDbId: "u0cNiij",
    aliases: ["glute bridge", "ponte de gluteos", "ponte de glúteos", "elevacao pelvica", "elevação pélvica"],
    muscles: ["lower", "legs", "glutes", "core"],
    supportedForMission: true,
  },
  {
    slug: "wall-sit",
    namePt: "Cadeira isometrica",
    searchTerms: ["wall sit"],
    exerciseDbId: "sVQCCeG",
    aliases: ["wall sit", "cadeira isometrica", "cadeira isométrica"],
    muscles: ["lower", "legs", "quads"],
    supportedForMission: true,
  },
  {
    slug: "calf-raise",
    namePt: "Elevacao de panturrilha",
    searchTerms: ["calf raise"],
    exerciseDbId: "bJYHBIN",
    aliases: ["calf raise", "elevacao de panturrilha", "elevação de panturrilha"],
    muscles: ["lower", "legs", "calves"],
    supportedForMission: true,
  },
  {
    slug: "plank-front",
    namePt: "Prancha frontal",
    searchTerms: ["front plank", "plank"],
    exerciseDbId: "VBAWRPG",
    aliases: ["plank", "high plank", "front plank", "prancha", "prancha frontal", "prancha isometrica"],
    muscles: ["core", "waist"],
    supportedForMission: true,
  },
  {
    slug: "sit-up-traditional",
    namePt: "Abdominal tradicional",
    searchTerms: ["3/4 sit-up", "quarter sit-up", "sit-up"],
    exerciseDbId: "2gPfomN",
    aliases: ["3/4 sit-up", "sit-up", "sit up", "abdominal", "abdominal tradicional", "abdominal controlado"],
    muscles: ["core", "waist", "abs"],
    supportedForMission: true,
  },
  {
    slug: "crunch-floor",
    namePt: "Abdominal crunch",
    searchTerms: ["crunch floor", "crunch"],
    exerciseDbId: "TFqbd8t",
    aliases: ["crunch floor", "crunch", "abdominal crunch"],
    muscles: ["core", "waist", "abs"],
    supportedForMission: true,
  },
  {
    slug: "leg-raise",
    namePt: "Elevacao de pernas",
    searchTerms: ["leg raise"],
    aliases: ["leg raise", "elevacao de pernas", "elevação de pernas"],
    muscles: ["core", "waist", "abs"],
    supportedForMission: false,
    replacementSlug: "sit-up-traditional",
  },
  {
    slug: "dead-bug",
    namePt: "Abdominal alternado",
    searchTerms: ["dead bug"],
    exerciseDbId: "iny3m5y",
    aliases: ["dead bug", "abdominal alternado"],
    muscles: ["core", "waist", "abs"],
    supportedForMission: true,
  },
  {
    slug: "mountain-climber",
    namePt: "Escalador",
    searchTerms: ["mountain climber"],
    exerciseDbId: "RJgzwny",
    aliases: ["mountain climber", "escalador"],
    muscles: ["core", "waist", "cardio", "full body"],
    supportedForMission: true,
  },
  {
    slug: "burpee",
    namePt: "Burpee",
    searchTerms: ["burpee"],
    exerciseDbId: "dK9394r",
    aliases: ["burpee"],
    muscles: ["full body", "cardio", "legs", "upper"],
    supportedForMission: true,
  },
  {
    slug: "walking-active",
    namePt: "Caminhada ativa",
    searchTerms: ["walking"],
    aliases: ["walking", "walk", "caminhada", "caminhada ativa"],
    muscles: ["lower", "legs", "cardio", "full body"],
    supportedForMission: true,
  },
  {
    slug: "running-light",
    namePt: "Corrida leve",
    searchTerms: ["running"],
    aliases: ["running", "run", "corrida", "corrida leve"],
    muscles: ["lower", "legs", "cardio", "full body"],
    supportedForMission: true,
  },
  {
    slug: "stretching-guided",
    namePt: "Alongamento guiado",
    searchTerms: ["stretching"],
    aliases: ["stretching", "alongamento", "alongamento guiado"],
    muscles: ["mobility", "flexibility", "full body"],
    supportedForMission: true,
  },
  {
    slug: "mobility-flow",
    namePt: "Fluxo de mobilidade",
    searchTerms: ["mobility flow", "mobility"],
    aliases: ["mobility flow", "mobility", "mobilidade", "fluxo de mobilidade"],
    muscles: ["mobility", "flexibility", "full body"],
    supportedForMission: true,
  },
  {
    slug: "yoga-flow",
    namePt: "Fluxo de yoga",
    searchTerms: ["yoga flow", "yoga"],
    aliases: ["yoga flow", "yoga", "fluxo de yoga"],
    muscles: ["mobility", "flexibility", "full body"],
    supportedForMission: true,
  },
  {
    slug: "bird-dog",
    namePt: "Extensao alternada em quatro apoios",
    searchTerms: ["bird dog"],
    aliases: ["bird dog", "extensao alternada em quatro apoios", "extensão alternada em quatro apoios"],
    muscles: ["core", "waist", "glutes"],
    supportedForMission: false,
    replacementSlug: "dead-bug",
  },
  {
    slug: "hollow-body-hold",
    namePt: "Isometria concava",
    searchTerms: ["hollow body hold", "hollow hold", "hollow body"],
    aliases: ["hollow body hold", "hollow hold", "hollow body", "isometria hollow", "isometria concava"],
    muscles: ["core", "waist", "abs"],
    supportedForMission: false,
    replacementSlug: "plank-front",
  },
  {
    slug: "front-plank-with-twist",
    namePt: "Prancha frontal com giro",
    searchTerms: ["front plank with twist"],
    aliases: ["front plank with twist"],
    muscles: ["core", "waist"],
    supportedForMission: false,
    replacementSlug: "plank-front",
  },
];

const supplementalExerciseCatalogBySlug = new Map(
  supplementalExerciseCatalog.map((entry) => [entry.slug, entry] as const),
);

const REGULAR_ROUTE_MISSION_SLUGS = new Set([
  "walking-active",
  "running-light",
]);

function stripExerciseSeedDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeExerciseSeedLookup(value: string): string {
  return stripExerciseSeedDiacritics(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSupplementalCatalogTerms(entry: SupplementalExerciseCatalogEntry): string[] {
  return [entry.namePt, entry.slug, entry.slug.replace(/-/g, " "), ...entry.searchTerms, ...entry.aliases];
}

function scoreSupplementalCatalogMatch(entry: SupplementalExerciseCatalogEntry, normalizedValue: string): number {
  let bestScore = 0;

  for (const term of getSupplementalCatalogTerms(entry)) {
    const normalizedTerm = normalizeExerciseSeedLookup(term);
    if (!normalizedTerm) continue;

    if (normalizedTerm === normalizedValue) {
      bestScore = Math.max(bestScore, 130);
      continue;
    }

    if (normalizedTerm.length >= 4 && normalizedValue.includes(normalizedTerm)) {
      bestScore = Math.max(bestScore, 85);
      continue;
    }

    if (normalizedValue.length >= 4 && normalizedTerm.includes(normalizedValue)) {
      bestScore = Math.max(bestScore, 65);
    }
  }

  return bestScore;
}

function getExerciseSeedTerms(seed: VariantSkillSeed): string[] {
  return [
    seed.namePt,
    seed.slug,
    seed.slug.replace(/-/g, " "),
    ...seed.exerciseDbTerms,
    ...(seed.aliases ?? []),
  ];
}

function getExerciseSeedTermVariants(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return [];

  return Array.from(new Set([trimmed, stripExerciseSeedDiacritics(trimmed)]));
}

function scoreExerciseSeedMatch(seed: VariantSkillSeed, normalizedValue: string): number {
  let bestScore = 0;

  for (const term of getExerciseSeedTerms(seed)) {
    const normalizedTerm = normalizeExerciseSeedLookup(term);
    if (!normalizedTerm) continue;

    if (normalizedTerm === normalizedValue) {
      bestScore = Math.max(bestScore, 100);
      continue;
    }

    if (normalizedTerm.length >= 4 && normalizedValue.includes(normalizedTerm)) {
      bestScore = Math.max(bestScore, 70);
      continue;
    }

    if (normalizedValue.length >= 4 && normalizedTerm.includes(normalizedValue)) {
      bestScore = Math.max(bestScore, 55);
    }
  }

  return bestScore;
}

function resolveSupplementalExerciseCatalogEntry(
  value: string | null | undefined,
): SupplementalExerciseCatalogEntry | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;

  const normalizedValue = normalizeExerciseSeedLookup(value);
  if (!normalizedValue) return null;

  let bestEntry: SupplementalExerciseCatalogEntry | null = null;
  let bestScore = 0;

  for (const entry of supplementalExerciseCatalog) {
    const score = scoreSupplementalCatalogMatch(entry, normalizedValue);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestScore > 0 ? bestEntry : null;
}

function resolveReplacementEntry(
  entry: SupplementalExerciseCatalogEntry | null,
): SupplementalExerciseCatalogEntry | null {
  if (!entry) return null;
  if (entry.supportedForMission) return entry;
  if (!entry.replacementSlug) return null;
  return supplementalExerciseCatalogBySlug.get(entry.replacementSlug) ?? null;
}

function resolveSupportedRouteMissionExerciseEntry(
  value: string | null | undefined,
): SupplementalExerciseCatalogEntry | null {
  const entry = resolveReplacementEntry(resolveSupplementalExerciseCatalogEntry(value));
  if (!entry) return null;
  return REGULAR_ROUTE_MISSION_SLUGS.has(entry.slug) ? entry : null;
}

type StrictSupportedMissionExerciseEntry = SupplementalExerciseCatalogEntry & {
  exerciseDbId: string;
};

const GENERIC_EXERCISE_TARGET_KEYS = new Set([
  "upper",
  "lower",
  "core",
  "full body",
  "push",
  "pull",
  "cardio",
  "mobility",
  "flexibility",
]);

const CANONICAL_EXERCISE_TARGET_PRIORITY = new Map<string, number>([
  ["chest", 10],
  ["back", 11],
  ["shoulders", 12],
  ["triceps", 13],
  ["biceps", 14],
  ["glutes", 20],
  ["quads", 21],
  ["hamstrings", 22],
  ["calves", 23],
  ["waist", 30],
  ["abs", 31],
  ["hips", 32],
  ["legs", 40],
]);

const UPPER_BODY_TARGET_KEYS = new Set([
  "upper",
  "chest",
  "back",
  "shoulders",
  "triceps",
  "biceps",
]);

const LOWER_BODY_TARGET_KEYS = new Set([
  "lower",
  "legs",
  "glutes",
  "quads",
  "hamstrings",
  "calves",
  "hips",
]);

function normalizeExerciseMuscleKey(value: string): string {
  return normalizeExerciseSeedLookup(value);
}

function mapExerciseMuscleKeyToPt(value: string): string | null {
  switch (normalizeExerciseMuscleKey(value)) {
    case "chest":
      return "Peitoral";
    case "back":
      return "Costas";
    case "shoulders":
      return "Ombros";
    case "triceps":
      return "Tr\u00edceps";
    case "biceps":
      return "B\u00edceps";
    case "glutes":
      return "Gl\u00fateos";
    case "quads":
      return "Quadr\u00edceps";
    case "hamstrings":
      return "Posteriores";
    case "calves":
      return "Panturrilhas";
    case "waist":
    case "abs":
      return "Abd\u00f4men";
    case "hips":
      return "Quadril";
    case "legs":
      return "Pernas";
    default:
      return null;
  }
}

function resolveCanonicalExerciseTargetMuscleLabels(
  entry: SupplementalExerciseCatalogEntry | null,
): string[] {
  if (!entry) return [];

  const normalizedKeys = entry.muscles.map((muscle) => normalizeExerciseMuscleKey(muscle));
  const hasFullBody = normalizedKeys.includes("full body");
  const hasCardio = normalizedKeys.includes("cardio");
  const hasUpperBodyWork = normalizedKeys.some((key) => UPPER_BODY_TARGET_KEYS.has(key));
  const hasLowerBodyWork = normalizedKeys.some((key) => LOWER_BODY_TARGET_KEYS.has(key));

  if (hasFullBody && hasCardio && hasUpperBodyWork && hasLowerBodyWork) {
    return ["Corpo inteiro"];
  }

  const localized = entry.muscles
    .map((muscle, index) => ({
      key: normalizeExerciseMuscleKey(muscle),
      label: mapExerciseMuscleKeyToPt(muscle),
      index,
    }))
    .filter((item): item is { key: string; label: string; index: number } =>
      Boolean(item.label) && !GENERIC_EXERCISE_TARGET_KEYS.has(item.key),
    )
    .sort((left, right) => {
      const leftPriority = CANONICAL_EXERCISE_TARGET_PRIORITY.get(left.key) ?? 999;
      const rightPriority = CANONICAL_EXERCISE_TARGET_PRIORITY.get(right.key) ?? 999;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.index - right.index;
    });

  const deduped = new Set<string>();
  const labels: string[] = [];
  for (const item of localized) {
    const normalizedLabel = normalizeExerciseSeedLookup(item.label);
    if (deduped.has(normalizedLabel)) continue;
    deduped.add(normalizedLabel);
    labels.push(item.label);
  }

  return labels;
}

function isStrictSupportedMissionExerciseEntry(
  entry: SupplementalExerciseCatalogEntry | null,
): entry is StrictSupportedMissionExerciseEntry {
  return Boolean(
    entry
    && entry.supportedForMission
    && typeof entry.exerciseDbId === "string"
    && entry.exerciseDbId.trim().length > 0,
  );
}

function resolveStrictSupportedMissionExerciseEntry(
  value: string | null | undefined,
): StrictSupportedMissionExerciseEntry | null {
  const supplemental = resolveSupplementalExerciseCatalogEntry(value);
  const supportedSupplemental = resolveReplacementEntry(supplemental);
  return isStrictSupportedMissionExerciseEntry(supportedSupplemental)
    ? supportedSupplemental
    : null;
}

function resolveMissionTargetGroup(muscle: string | null | undefined): string {
  const normalizedMuscle = normalizeExerciseSeedLookup(String(muscle ?? ""));
  return normalizedMuscle.includes("core") || normalizedMuscle.includes("waist") || normalizedMuscle.includes("abs")
    ? "core"
    : normalizedMuscle.includes("glute") || normalizedMuscle.includes("leg") || normalizedMuscle.includes("quad") || normalizedMuscle.includes("ham")
      ? "lower"
      : normalizedMuscle.includes("mobility") || normalizedMuscle.includes("flex") || normalizedMuscle.includes("stretch") || normalizedMuscle.includes("recover")
        ? "mobility"
        : normalizedMuscle.includes("chest") || normalizedMuscle.includes("shoulder") || normalizedMuscle.includes("tricep") || normalizedMuscle.includes("bicep") || normalizedMuscle.includes("arm") || normalizedMuscle.includes("back")
          ? "upper"
          : normalizedMuscle.includes("cardio") || normalizedMuscle.includes("walk") || normalizedMuscle.includes("run")
            ? "cardio"
            : "full body";
}

function listStrictSupportedMissionExerciseEntriesByMuscle(
  muscle: string | null | undefined,
): StrictSupportedMissionExerciseEntry[] {
  const targetGroup = resolveMissionTargetGroup(muscle);
  return supplementalExerciseCatalog
    .map((entry) => resolveReplacementEntry(entry))
    .filter((entry): entry is StrictSupportedMissionExerciseEntry =>
      isStrictSupportedMissionExerciseEntry(entry)
      && (
        entry.muscles.includes(targetGroup)
        || entry.muscles.includes("full body")
        || (targetGroup === "cardio" && entry.muscles.includes("lower"))
      ),
    );
}

const exerciseCatalogReplacements = (() => {
  const seenKeys = new Set<string>();
  const replacements: Array<{ pattern: RegExp; replacement: string }> = [];

  const registerReplacementEntry = (replacement: string, terms: string[]) => {
    const normalizedReplacement = normalizeExerciseSeedLookup(replacement);

    for (const term of terms) {
      for (const variant of getExerciseSeedTermVariants(term)) {
        const normalizedVariant = normalizeExerciseSeedLookup(variant);
        if (!normalizedVariant || normalizedVariant === normalizedReplacement) {
          continue;
        }

        const dedupeKey = `${normalizedVariant}=>${normalizedReplacement}`;
        if (seenKeys.has(dedupeKey)) {
          continue;
        }
        seenKeys.add(dedupeKey);

        replacements.push({
          pattern: new RegExp(
            `(?<![\\p{L}\\p{N}])${escapeRegExp(variant).replace(/\\ /g, "\\s+")}(?![\\p{L}\\p{N}])`,
            "giu",
          ),
          replacement,
        });
      }
    }
  };

  for (const entry of supplementalExerciseCatalog) {
    registerReplacementEntry(entry.namePt, getSupplementalCatalogTerms(entry));
  }

  for (const seed of exerciseSeedCatalog) {
    registerReplacementEntry(seed.namePt, getExerciseSeedTerms(seed));
  }

  return replacements.sort((left, right) => right.pattern.source.length - left.pattern.source.length);
})();

export function resolveVariantSkillSeedByExerciseName(value: string | null | undefined): VariantSkillSeed | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;

  const normalizedValue = normalizeExerciseSeedLookup(value);
  if (!normalizedValue) return null;

  let bestSeed: VariantSkillSeed | null = null;
  let bestScore = 0;

  for (const seed of exerciseSeedCatalog) {
    const score = scoreExerciseSeedMatch(seed, normalizedValue);
    if (score > bestScore) {
      bestScore = score;
      bestSeed = seed;
    }
  }

  return bestScore > 0 ? bestSeed : null;
}

export function resolveExerciseDisplayNamePt(value: string | null | undefined): string | null {
  const supplemental = resolveSupplementalExerciseCatalogEntry(value);
  if (supplemental) return supplemental.namePt;
  const seed = resolveVariantSkillSeedByExerciseName(value);
  return seed ? seed.namePt : null;
}

export function resolveSupportedMissionExerciseName(value: string | null | undefined): string | null {
  const supportedSupplemental = resolveStrictSupportedMissionExerciseEntry(value);
  return supportedSupplemental?.searchTerms[0] ?? null;
}

export function resolveSupportedRouteMissionExerciseName(
  value: string | null | undefined,
): string | null {
  return resolveSupportedRouteMissionExerciseEntry(value)?.searchTerms[0] ?? null;
}

export function isSupportedRouteMissionExercise(
  value: string | null | undefined,
): boolean {
  return resolveSupportedRouteMissionExerciseEntry(value) !== null;
}

export function resolveStrictSupportedMissionExerciseDbId(value: string | null | undefined): string | null {
  return resolveStrictSupportedMissionExerciseEntry(value)?.exerciseDbId ?? null;
}

export function resolveStrictSupportedMissionExerciseDisplayNamePt(value: string | null | undefined): string | null {
  return resolveStrictSupportedMissionExerciseEntry(value)?.namePt ?? null;
}

export function resolvePreferredExerciseDbId(value: string | null | undefined): string | null {
  return resolveStrictSupportedMissionExerciseDbId(value);
}

function resolveCatalogEntryByExerciseDbId(
  exerciseDbId: string | null | undefined,
): SupplementalExerciseCatalogEntry | null {
  if (typeof exerciseDbId !== "string" || exerciseDbId.trim().length === 0) {
    return null;
  }

  const normalizedExerciseDbId = exerciseDbId.trim();
  const matchingEntry = supplementalExerciseCatalog.find((entry) =>
    entry.exerciseDbId === normalizedExerciseDbId
    || entry.visualFallbackExerciseDbId === normalizedExerciseDbId,
  );

  return matchingEntry ?? null;
}

export function resolveExerciseTargetMuscleLabelsById(
  exerciseDbId: string | null | undefined,
): string[] {
  const catalogEntry = resolveCatalogEntryByExerciseDbId(exerciseDbId);
  const supportedEntry = resolveReplacementEntry(catalogEntry);
  return resolveCanonicalExerciseTargetMuscleLabels(supportedEntry ?? catalogEntry);
}

export function resolveExerciseTargetMuscleLabels(
  value: string | null | undefined,
): string[] {
  const supportedEntry =
    resolveStrictSupportedMissionExerciseEntry(value)
    ?? resolveSupportedRouteMissionExerciseEntry(value);
  return resolveCanonicalExerciseTargetMuscleLabels(supportedEntry);
}

export function resolveExerciseMediaFallbackUrlById(exerciseDbId: string | null | undefined): string | null {
  if (typeof exerciseDbId !== "string" || exerciseDbId.trim().length === 0) {
    return null;
  }

  const normalizedExerciseDbId = exerciseDbId.trim();
  const catalogEntry = resolveCatalogEntryByExerciseDbId(normalizedExerciseDbId);
  const supportedEntry = resolveReplacementEntry(catalogEntry);
  const resolvedExerciseDbId = isStrictSupportedMissionExerciseEntry(supportedEntry)
    ? supportedEntry.exerciseDbId
    : normalizedExerciseDbId;
  return `https://static.exercisedb.dev/media/${resolvedExerciseDbId}.gif`;
}

export function resolveExerciseMediaFallbackUrl(value: string | null | undefined): string | null {
  const exerciseDbId = resolveStrictSupportedMissionExerciseDbId(value);
  return resolveExerciseMediaFallbackUrlById(exerciseDbId);
}

export function listSupportedMissionExerciseNamesByMuscle(muscle: string | null | undefined): string[] {
  return Array.from(
    new Set(
      listStrictSupportedMissionExerciseEntriesByMuscle(muscle)
        .flatMap((entry) => entry.searchTerms.slice(0, 1))
        .filter((term) => term.length > 0),
    ),
  );
}

export function listAllStrictSupportedMissionExerciseNames(): string[] {
  return Array.from(
    new Set(
      supplementalExerciseCatalog
        .map((entry) => resolveReplacementEntry(entry))
        .filter((entry): entry is StrictSupportedMissionExerciseEntry =>
          isStrictSupportedMissionExerciseEntry(entry),
        )
        .flatMap((entry) => entry.searchTerms.slice(0, 1))
        .filter((term) => term.length > 0),
    ),
  );
}

export function localizeExerciseCatalogText(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return value;
  }

  const exactMatch = resolveExerciseDisplayNamePt(value);
  let localized = exactMatch ?? value;

  for (const { pattern, replacement } of exerciseCatalogReplacements) {
    localized = localized.replace(pattern, replacement);
  }

  return localized;
}

export function resolveExerciseSearchTerms(value: string | null | undefined): string[] {
  const supplemental = resolveSupplementalExerciseCatalogEntry(value);
  const supportedSupplemental = resolveReplacementEntry(supplemental);
  if (supportedSupplemental) {
    return Array.from(
      new Set(
        supportedSupplemental.searchTerms
          .map((term) => term.trim())
          .filter((term) => term.length > 0),
      ),
    );
  }

  const seed = resolveVariantSkillSeedByExerciseName(value);
  if (!seed) return [];

  return Array.from(
    new Set(
      seed.exerciseDbTerms
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  );
}

