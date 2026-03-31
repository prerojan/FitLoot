const ONBOARDING_DRAFT_STORAGE_KEY = "fitloot_onboarding_draft";
const ONBOARDING_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

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

type StoredOnboardingDraft = {
  version: 1;
  savedAt: number;
  draft: OnboardingDraft;
};

function isStringArray(value: unknown): value is string[] {
  // Valida o unico campo composto persistido no draft.
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined";
}

function readStorageValue(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignora falhas de quota/acesso e segue sem persistencia local.
  }
}

function removeStorageValue(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignora falhas de acesso e segue com a limpeza oportunista.
  }
}

function isValidOnboardingDraft(value: unknown): value is OnboardingDraft {
  const parsed = value as Partial<OnboardingDraft> | null;
  if (!parsed || typeof parsed !== "object") {
    return false;
  }

  return (
    typeof parsed.username === "string" &&
    typeof parsed.full_name === "string" &&
    typeof parsed.weight === "string" &&
    typeof parsed.height === "string" &&
    typeof parsed.initial_conditioning === "string" &&
    typeof parsed.initial_pushups === "string" &&
    typeof parsed.initial_situps === "string" &&
    typeof parsed.initial_squats === "string" &&
    typeof parsed.injuries === "string" &&
    typeof parsed.equipment === "string" &&
    typeof parsed.main_goal === "string" &&
    typeof parsed.gender === "string" &&
    typeof parsed.age === "string" &&
    typeof parsed.weeklyFrequency === "number" &&
    Number.isFinite(parsed.weeklyFrequency) &&
    isStringArray(parsed.selectedEquipment)
  );
}

function normalizeStoredDraft(rawDraft: string | null): OnboardingDraft | null {
  if (!rawDraft) return null;

  try {
    const parsed = JSON.parse(rawDraft) as StoredOnboardingDraft | OnboardingDraft | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if ("draft" in parsed) {
      const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
      if (!savedAt || Date.now() - savedAt > ONBOARDING_DRAFT_TTL_MS) {
        return null;
      }

      return isValidOnboardingDraft(parsed.draft) ? parsed.draft : null;
    }

    return isValidOnboardingDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  // Persiste o estado final do onboarding para reuso no checkout.
  if (!isBrowserStorageAvailable()) return;

  const payload: StoredOnboardingDraft = {
    version: 1,
    savedAt: Date.now(),
    draft,
  };

  writeStorageValue(
    window.localStorage,
    ONBOARDING_DRAFT_STORAGE_KEY,
    JSON.stringify(payload),
  );
  removeStorageValue(window.sessionStorage, ONBOARDING_DRAFT_STORAGE_KEY);
}

export function loadOnboardingDraft(): OnboardingDraft | null {
  // Reidrata o draft apenas se todos os campos esperados estiverem validos.
  if (!isBrowserStorageAvailable()) return null;

  const localRawDraft = readStorageValue(
    window.localStorage,
    ONBOARDING_DRAFT_STORAGE_KEY,
  );
  const localDraft = normalizeStoredDraft(localRawDraft);

  if (localDraft) {
    return localDraft;
  }

  if (localRawDraft) {
    removeStorageValue(window.localStorage, ONBOARDING_DRAFT_STORAGE_KEY);
  }

  const legacySessionDraft = normalizeStoredDraft(
    readStorageValue(window.sessionStorage, ONBOARDING_DRAFT_STORAGE_KEY),
  );
  if (!legacySessionDraft) {
    removeStorageValue(window.sessionStorage, ONBOARDING_DRAFT_STORAGE_KEY);
    return null;
  }

  saveOnboardingDraft(legacySessionDraft);
  return legacySessionDraft;
}

export function clearOnboardingDraft(): void {
  // Limpa o draft quando o fluxo nao precisa mais ser reaproveitado.
  if (!isBrowserStorageAvailable()) return;
  removeStorageValue(window.localStorage, ONBOARDING_DRAFT_STORAGE_KEY);
  removeStorageValue(window.sessionStorage, ONBOARDING_DRAFT_STORAGE_KEY);
}
