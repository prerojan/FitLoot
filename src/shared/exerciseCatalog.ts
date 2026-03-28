import { macroSkillSeeds, variantSkillSeeds, type VariantSkillSeed } from "./coreSkillSeeds";

const exerciseSeedCatalog: VariantSkillSeed[] = [...variantSkillSeeds, ...macroSkillSeeds];

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

const exerciseCatalogReplacements = (() => {
  const seenKeys = new Set<string>();
  const replacements: Array<{ pattern: RegExp; replacement: string }> = [];

  for (const seed of exerciseSeedCatalog) {
    const normalizedReplacement = normalizeExerciseSeedLookup(seed.namePt);

    for (const term of getExerciseSeedTerms(seed)) {
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
          replacement: seed.namePt,
        });
      }
    }
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
  const seed = resolveVariantSkillSeedByExerciseName(value);
  return seed ? seed.namePt : null;
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
  const seed = resolveVariantSkillSeedByExerciseName(value);
  if (!seed) return [];

  return Array.from(
    new Set(
      getExerciseSeedTerms(seed)
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  );
}
