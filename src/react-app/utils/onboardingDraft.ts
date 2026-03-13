const ONBOARDING_DRAFT_STORAGE_KEY = "fitloot_onboarding_draft";

export type OnboardingDraft = {
  username: string;
  full_name: string;
  weight: string;
  height: string;
  initial_conditioning: "sedentario" | "iniciante" | "intermediario" | "avancado";
  initial_pushups: string;
  initial_situps: string;
  initial_squats: string;
  injuries: string;
  equipment: string;
  main_goal: "perder_peso" | "ganhar_massa" | "resistencia" | "calistenia" | "saude_geral";
  gender: "homem" | "mulher" | "outro";
  age: string;
  weeklyFrequency: number;
  selectedEquipment: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  sessionStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function loadOnboardingDraft(): OnboardingDraft | null {
  const rawDraft = sessionStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
  if (!rawDraft) return null;

  try {
    const parsed = JSON.parse(rawDraft) as Partial<OnboardingDraft> | null;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (
      typeof parsed.username !== "string" ||
      typeof parsed.full_name !== "string" ||
      typeof parsed.weight !== "string" ||
      typeof parsed.height !== "string" ||
      typeof parsed.initial_conditioning !== "string" ||
      typeof parsed.initial_pushups !== "string" ||
      typeof parsed.initial_situps !== "string" ||
      typeof parsed.initial_squats !== "string" ||
      typeof parsed.injuries !== "string" ||
      typeof parsed.equipment !== "string" ||
      typeof parsed.main_goal !== "string" ||
      typeof parsed.gender !== "string" ||
      typeof parsed.age !== "string" ||
      typeof parsed.weeklyFrequency !== "number" ||
      !Number.isFinite(parsed.weeklyFrequency) ||
      !isStringArray(parsed.selectedEquipment)
    ) {
      return null;
    }

    return parsed as OnboardingDraft;
  } catch {
    return null;
  }
}

export function clearOnboardingDraft(): void {
  sessionStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
}
