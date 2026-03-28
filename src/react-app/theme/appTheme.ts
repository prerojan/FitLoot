// Canonical app-level light/dark theme persistence for the shell.
export type AppThemeMode = "light" | "dark";

export const APP_THEME_STORAGE_KEY = "fitloot_app_theme";
export const DEFAULT_APP_THEME_MODE: AppThemeMode = "light";

function isThemeMode(value: string | null): value is AppThemeMode {
  return value === "light" || value === "dark";
}

function getThemeTargets(): HTMLElement[] {
  const targets: HTMLElement[] = [document.documentElement];
  const appRoot = document.getElementById("root");

  if (appRoot instanceof HTMLElement) {
    targets.push(appRoot);
  }

  return targets;
}

export function getStoredAppThemeMode(): AppThemeMode {
  try {
    const storedMode = localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isThemeMode(storedMode) ? storedMode : DEFAULT_APP_THEME_MODE;
  } catch {
    return DEFAULT_APP_THEME_MODE;
  }
}

export function persistAppThemeMode(mode: AppThemeMode): void {
  localStorage.setItem(APP_THEME_STORAGE_KEY, mode);
}

export function applyAppThemeMode(mode: AppThemeMode): void {
  const targets = getThemeTargets();

  for (const target of targets) {
    target.setAttribute("data-theme", mode);
  }

  document.documentElement.style.colorScheme = mode;
}

export function initializeAppThemeMode(): AppThemeMode {
  const mode = getStoredAppThemeMode();
  applyAppThemeMode(mode);
  return mode;
}
