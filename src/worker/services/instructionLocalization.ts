import {
  localizeExerciseCatalogText,
  resolveExerciseDisplayNamePt,
} from "../../shared/exerciseCatalog";
import { localizeMissionText } from "../../shared/missionLocalization";

const ENGLISH_RESIDUE_REGEX =
  /\b(?:the|and|with|your|for|to|from|keep|hold|return|repeat|step|start|starting|position|core|body|left|right|leg|arm|back|ground|floor|knee|knees|chest|shoulder|hips|feet|hands|slowly|movement|breathe|inhale|exhale|pause|seconds?|minutes?|reps?|sets?|push-?up|pull-?up|deadlift|curl|press|raise|row|fly|kick|swing|snatch|clean|jerk|thruster|dip|bridge|mountain|climber|bird|dog|bug|walk|run|sprint|jump|burpee|lunges?|squat|lunge|plank)\b/iu;

const PORTUGUESE_FALLBACK_STEPS: readonly string[] = [
  "Posicione o corpo com alinhamento estável e prepare a execução com controle.",
  "Inicie o movimento mantendo postura firme e estabilidade articular.",
  "Mantenha respiração contínua e ritmo constante durante a execução.",
  "Respeite a amplitude confortável sem compensações no movimento.",
  "Retorne à posição inicial com controle total do corpo.",
  "Repita conforme a meta da missão, priorizando técnica e segurança.",
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasEnglishResidue(value: string): boolean {
  return ENGLISH_RESIDUE_REGEX.test(value);
}

function fallbackStepByIndex(index: number): string {
  return PORTUGUESE_FALLBACK_STEPS[index % PORTUGUESE_FALLBACK_STEPS.length]!;
}

function sanitizeInstructionLine(line: string, index: number): string {
  const localized = normalizeWhitespace(localizeMissionText(line) ?? line);
  if (localized.length === 0) {
    return fallbackStepByIndex(index);
  }

  if (hasEnglishResidue(localized)) {
    return fallbackStepByIndex(index);
  }

  return localized;
}

export function ensurePortugueseInstructionList(
  values: readonly string[],
  limit = 8,
): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return PORTUGUESE_FALLBACK_STEPS.slice(0, Math.min(4, limit));
  }

  const sanitized = values
    .slice(0, limit)
    .map((value, index) => sanitizeInstructionLine(String(value), index))
    .map((value) => normalizeWhitespace(value))
    .filter((value) => value.length > 0)
    .map((value, index) =>
      hasEnglishResidue(value) ? fallbackStepByIndex(index) : value,
    );

  if (sanitized.length === 0) {
    return PORTUGUESE_FALLBACK_STEPS.slice(0, Math.min(4, limit));
  }

  return sanitized.slice(0, limit);
}

export function ensurePortugueseExerciseLabel(
  value: string | null | undefined,
): string {
  const rawValue = typeof value === "string" ? value : "";
  const candidateLabels = [
    resolveExerciseDisplayNamePt(rawValue),
    localizeExerciseCatalogText(rawValue),
    localizeMissionText(rawValue),
  ];

  for (const candidate of candidateLabels) {
    const localized = normalizeWhitespace(String(candidate ?? ""));
    if (localized.length === 0) {
      continue;
    }
    if (!hasEnglishResidue(localized)) {
      return localized;
    }
  }

  return "exerc\u00edcio guiado";
}
