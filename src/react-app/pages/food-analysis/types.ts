export type AnalysisItem = {
  food_name: string;
  portion_description: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  energy_kj: number | null;
  source: "usda" | "rapidapi" | "estimate" | "ocr_label";
  warning?: string | undefined;
};

export type AnalysisResult = {
  success: boolean;
  items: AnalysisItem[];
  totals: {
    calories: number;
    energy_kj: number;
    protein: number;
    carbs: number;
    fats: number;
    macro_percentages: { protein: number; carbs: number; fats: number };
  };
  has_estimates?: boolean | undefined;
  estimation_warning?: string | undefined;
};

export type IdentifiedItem = {
  food_name: string;
  portion_description: string;
  portion_multiplier: number;
};

export type MediaPipeClassifier = {
  classify: (image: HTMLImageElement) => {
    classifications?: Array<{
      categories?: Array<{ categoryName?: string | undefined; score?: number | undefined }>;
    }>;
  };
  close: () => void;
};

export type MediaPipeVisionModule = {
  FilesetResolver: {
    forVisionTasks: (wasmRootPath: string) => Promise<unknown>;
  };
  ImageClassifier: {
    createFromOptions: (vision: unknown, options: Record<string, unknown>) => Promise<MediaPipeClassifier>;
  };
};

export type ClassificationCandidate = {
  label: string;
  score: number;
};

export type FoodClassificationResult = {
  identifiedItems: IdentifiedItem[];
  foodDescription?: string | undefined;
};

export type PreviewSource = "camera" | "gallery";

export type WebCameraStartResult = "started" | "unsupported" | "blocked" | "fallback-native";

export type SavedFoodEntry = {
  id: number;
  food_name: string;
  calories: number | null;
  meal_type?: string | null;
  scanned_at?: string | null;
  created_at?: string | null;
};
