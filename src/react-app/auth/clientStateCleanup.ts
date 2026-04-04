import {
  ACTIVATION_NOTICE_STORAGE_KEY,
  AI_CHAT_STORAGE_PREFIX,
  OFFLINE_METRICS_CURSOR_STORAGE_KEY,
  OFFLINE_QUEUE_STORAGE_KEY,
  ONBOARDING_DRAFT_STORAGE_KEY,
  ONBOARDING_EMAIL_STORAGE_KEY,
  STEP_MISSION_PROGRESS_STORAGE_PREFIX,
} from "@/react-app/constants/storage";
import { AUTHENTICATED_HINT_KEY, PENDING_404_ACHIEVEMENT_KEY } from "@/react-app/auth/constants";
import { offlineSyncService } from "@/react-app/services/runtime/offlineSyncService";
import { applyProfileTheme } from "@/react-app/theme/profileTheme";
import { clearJsonCache } from "@/react-app/utils/api";

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined";
}

function removeStorageKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Best-effort cleanup only.
  }
}

function removeStorageKeysByPrefix(storage: Storage, prefix: string): void {
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      storage.removeItem(key);
    });
  } catch {
    // Best-effort cleanup only.
  }
}

export function clearPersistedAuthenticatedUserState(): void {
  clearJsonCache();
  applyProfileTheme(null);

  if (!canUseBrowserStorage()) {
    offlineSyncService.clearPersistedState();
    return;
  }

  removeStorageKey(window.localStorage, AUTHENTICATED_HINT_KEY);
  removeStorageKey(window.localStorage, PENDING_404_ACHIEVEMENT_KEY);
  removeStorageKey(window.localStorage, ONBOARDING_DRAFT_STORAGE_KEY);
  removeStorageKey(window.localStorage, OFFLINE_QUEUE_STORAGE_KEY);
  removeStorageKey(window.localStorage, OFFLINE_METRICS_CURSOR_STORAGE_KEY);
  removeStorageKeysByPrefix(window.localStorage, AI_CHAT_STORAGE_PREFIX);
  removeStorageKeysByPrefix(
    window.localStorage,
    `${STEP_MISSION_PROGRESS_STORAGE_PREFIX}:`,
  );

  removeStorageKey(window.sessionStorage, ACTIVATION_NOTICE_STORAGE_KEY);
  removeStorageKey(window.sessionStorage, ONBOARDING_DRAFT_STORAGE_KEY);
  removeStorageKey(window.sessionStorage, ONBOARDING_EMAIL_STORAGE_KEY);

  offlineSyncService.clearPersistedState();
}
