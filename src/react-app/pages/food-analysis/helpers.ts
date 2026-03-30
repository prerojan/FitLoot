import type { NormalizedCameraImage } from "@/react-app/services/native/cameraService";
import { safeGet } from "@/utils/typeHelpers";
import type {
  ClassificationCandidate,
  IdentifiedItem,
  MediaPipeVisionModule,
  PreviewSource,
  SavedFoodEntry,
} from "./types";

const STRICT_CLASSIFICATION_SCORE = 0.12;
const RELAXED_CLASSIFICATION_SCORE = 0.04;
const MAX_IDENTIFIED_ITEMS = 3;
const MAX_DESCRIPTION_LABELS = 6;

// Carrega o runtime do classificador local apenas quando a tela realmente precisa dele.
export async function loadVisionModule(): Promise<MediaPipeVisionModule> {
  const moduleUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";
  return (await import(/* @vite-ignore */ moduleUrl)) as MediaPipeVisionModule;
}

// Converte a resposta crua do classificador em itens compatíveis com a API atual.
export function toIdentifiedItems(result: { classifications?: Array<{ categories?: Array<{ categoryName?: string | undefined; score?: number | undefined }> }> }): IdentifiedItem[] {
  const categories = safeGet(result.classifications ?? [], 0)?.categories ?? [];
  return categories
    .filter((category) => Number(category.score ?? 0) >= 0.2)
    .slice(0, 3)
    .map((category) => ({
      food_name: String(category.categoryName || "alimento"),
      portion_description: "porção média",
      portion_multiplier: 1,
    }));
}

export function normalizeCategoryLabel(rawLabel?: string | undefined): string {
  return String(rawLabel || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function extractClassificationCandidates(
  result: { classifications?: Array<{ categories?: Array<{ categoryName?: string | undefined; score?: number | undefined }> }> },
): ClassificationCandidate[] {
  const seen = new Set<string>();

  return (result.classifications ?? [])
    .flatMap((classification) => classification.categories ?? [])
    .map((category) => ({
      label: normalizeCategoryLabel(category.categoryName),
      score: Number(category.score ?? 0),
    }))
    .filter((category) => category.label.length > 0 && Number.isFinite(category.score) && category.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter((category) => {
      const key = category.label.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export function toIdentifiedItemsFromCandidates(candidates: ClassificationCandidate[]): IdentifiedItem[] {
  return candidates
    .filter((candidate) => candidate.score >= STRICT_CLASSIFICATION_SCORE)
    .slice(0, MAX_IDENTIFIED_ITEMS)
    .map((candidate) => ({
      food_name: candidate.label,
      portion_description: "porcao media",
      portion_multiplier: 1,
    }));
}

export function toFoodDescription(candidates: ClassificationCandidate[]): string | undefined {
  const preferredLabels = candidates
    .filter((candidate) => candidate.score >= RELAXED_CLASSIFICATION_SCORE)
    .slice(0, MAX_DESCRIPTION_LABELS)
    .map((candidate) => candidate.label);

  const fallbackLabels = preferredLabels.length > 0
    ? preferredLabels
    : candidates.slice(0, Math.min(3, candidates.length)).map((candidate) => candidate.label);

  return fallbackLabels.length > 0 ? fallbackLabels.join(", ") : undefined;
}

export function toPreviewSource(source: NormalizedCameraImage["source"]): PreviewSource {
  return source === "android-gallery" || source === "web-file" ? "gallery" : "camera";
}

export function formatMealType(mealType?: string | null): string {
  const normalizedMealType = String(mealType || "lanche").trim().toLowerCase();
  const mealTypeMap: Record<string, string> = {
    cafe_da_manha: "Cafe da manha",
    cafe: "Cafe",
    almoco: "Almoco",
    almoço: "Almoco",
    lanche: "Lanche",
    jantar: "Jantar",
    ceia: "Ceia",
  };

  return mealTypeMap[normalizedMealType] ?? normalizedMealType.replace(/[_-]+/g, " ");
}

export function formatSavedFoodTime(entry: SavedFoodEntry): string {
  const timestamp = entry.scanned_at ?? entry.created_at;
  if (!timestamp) return "agora";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "agora";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
