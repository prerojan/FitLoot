import { macroSkillSeeds, variantSkillSeeds, type VariantSkillSeed } from "./coreSkillSeeds";

const exerciseSeedCatalog: VariantSkillSeed[] = [...variantSkillSeeds, ...macroSkillSeeds];

type SupplementalExerciseCatalogEntry = {
  slug: string;
  namePt: string;
  searchTerms: string[];
  aliases: string[];
  exerciseDbId?: string | undefined;
  muscles: string[];
  supportedForMission: boolean;
  replacementSlug?: string | undefined;
};

const supplementalExerciseCatalog: SupplementalExerciseCatalogEntry[] = [
  {
    slug: "push-up-traditional",
    namePt: "Flexão tradicional",
    searchTerms: ["push-up"],
    exerciseDbId: "I4hDWkc",
    aliases: ["push-up", "push up", "flexão", "flexao", "flexão tradicional"],
    muscles: ["upper", "chest", "push", "full body"],
    supportedForMission: true,
  },
  {
    slug: "diamond-push-up",
    namePt: "Flexão diamante",
    searchTerms: ["diamond push-up"],
    aliases: ["diamond push-up", "diamond push up", "flexão diamante", "flexao diamante"],
    muscles: ["upper", "chest", "triceps", "push"],
    supportedForMission: true,
  },
  {
    slug: "pike-push-up",
    namePt: "Flexão pike",
    searchTerms: ["pike push-up"],
    aliases: ["pike push-up", "pike push up", "flexão pike", "flexao pike"],
    muscles: ["upper", "shoulders", "push"],
    supportedForMission: true,
  },
  {
    slug: "triceps-dip",
    namePt: "Mergulho de tríceps",
    searchTerms: ["triceps dip"],
    aliases: ["triceps dip", "dip", "dips", "mergulho de tríceps", "mergulho de triceps"],
    muscles: ["upper", "triceps", "push"],
    supportedForMission: true,
  },
  {
    slug: "air-squat",
    namePt: "Agachamento livre",
    searchTerms: ["air squat", "bodyweight squat"],
    aliases: ["air squat", "bodyweight squat", "squat", "agachamento", "agachamento livre"],
    muscles: ["lower", "legs", "glutes", "quads", "full body"],
    supportedForMission: true,
  },
  {
    slug: "walking-lunge",
    namePt: "Avanço caminhando",
    searchTerms: ["walking lunge", "lunge"],
    exerciseDbId: "IZVHb27",
    aliases: ["walking lunge", "lunge", "avanço", "avanco", "avanço caminhando", "avanco caminhando"],
    muscles: ["lower", "legs", "glutes", "quads"],
    supportedForMission: true,
  },
  {
    slug: "glute-bridge",
    namePt: "Ponte de glúteos",
    searchTerms: ["glute bridge"],
    aliases: ["glute bridge", "ponte de glúteos", "ponte de gluteos", "elevação pélvica", "elevacao pelvica"],
    muscles: ["lower", "legs", "glutes", "core"],
    supportedForMission: true,
  },
  {
    slug: "wall-sit",
    namePt: "Cadeira isométrica",
    searchTerms: ["wall sit"],
    aliases: ["wall sit", "cadeira isométrica", "cadeira isometrica"],
    muscles: ["lower", "legs", "quads"],
    supportedForMission: true,
  },
  {
    slug: "calf-raise",
    namePt: "Elevação de panturrilha",
    searchTerms: ["calf raise"],
    aliases: ["calf raise", "elevação de panturrilha", "elevacao de panturrilha"],
    muscles: ["lower", "legs", "calves"],
    supportedForMission: true,
  },
  {
    slug: "plank-front",
    namePt: "Prancha frontal",
    searchTerms: ["front plank", "plank"],
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
    namePt: "Elevação de pernas",
    searchTerms: ["leg raise"],
    aliases: ["leg raise", "elevação de pernas", "elevacao de pernas"],
    muscles: ["core", "waist", "abs"],
    supportedForMission: true,
  },
  {
    slug: "dead-bug",
    namePt: "Dead Bug",
    searchTerms: ["dead bug"],
    exerciseDbId: "iny3m5y",
    aliases: ["dead bug"],
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
    namePt: "Extensão alternada em quatro apoios",
    searchTerms: ["bird dog"],
    aliases: ["bird dog", "extensão alternada em quatro apoios", "extensao alternada em quatro apoios"],
    muscles: ["core", "waist", "glutes"],
    supportedForMission: false,
    replacementSlug: "dead-bug",
  },
  {
    slug: "hollow-body-hold",
    namePt: "Isometria Hollow",
    searchTerms: ["hollow body hold", "hollow hold", "hollow body"],
    aliases: ["hollow body hold", "hollow hold", "hollow body", "isometria hollow"],
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
  const supplemental = resolveSupplementalExerciseCatalogEntry(value);
  const supportedSupplemental = resolveReplacementEntry(supplemental);
  if (supportedSupplemental && supportedSupplemental.searchTerms.length > 0) {
    return supportedSupplemental.searchTerms[0] ?? null;
  }

  const seed = resolveVariantSkillSeedByExerciseName(value);
  if (!seed) return null;
  return seed.exerciseDbTerms[0] ?? seed.slug.replace(/-/g, " ");
}

export function resolvePreferredExerciseDbId(value: string | null | undefined): string | null {
  const supplemental = resolveSupplementalExerciseCatalogEntry(value);
  const supportedSupplemental = resolveReplacementEntry(supplemental);
  if (supportedSupplemental?.exerciseDbId) {
    return supportedSupplemental.exerciseDbId;
  }
  return null;
}

export function listSupportedMissionExerciseNamesByMuscle(muscle: string | null | undefined): string[] {
  const normalizedMuscle = normalizeExerciseSeedLookup(String(muscle ?? ""));
  const targetGroup =
    normalizedMuscle.includes("core") || normalizedMuscle.includes("waist") || normalizedMuscle.includes("abs")
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

  const candidates = supplementalExerciseCatalog.filter((entry) =>
    entry.supportedForMission
    && (
      entry.muscles.includes(targetGroup)
      || entry.muscles.includes("full body")
      || (targetGroup === "cardio" && entry.muscles.includes("lower"))
    ),
  );

  return Array.from(new Set(candidates.flatMap((entry) => entry.searchTerms.slice(0, 1)).filter((term) => term.length > 0)));
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
