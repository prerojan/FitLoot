// Canonical app-level light/dark theme persistence for the shell.
export type AppThemeMode = "light" | "dark";

export const APP_THEME_STORAGE_KEY = "fitloot_app_theme";
export const DEFAULT_APP_THEME_MODE: AppThemeMode = "light";

function isThemeMode(value: string | null): value is AppThemeMode {
  // Restringe o valor lido do storage ao contrato aceito pela app.
  return value === "light" || value === "dark";
}

function getThemeTargets(): HTMLElement[] {
  // Aplica o tema no documento e tambem no root para suportar cascas diferentes.
  const targets: HTMLElement[] = [document.documentElement];
  const appRoot = document.getElementById("root");

  if (appRoot instanceof HTMLElement) {
    targets.push(appRoot);
  }

  return targets;
}

export function getStoredAppThemeMode(): AppThemeMode {
  // Resolve o tema persistido, caindo para o padrao em caso de falha.
  try {
    const storedMode = localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isThemeMode(storedMode) ? storedMode : DEFAULT_APP_THEME_MODE;
  } catch {
    return DEFAULT_APP_THEME_MODE;
  }
}

export function persistAppThemeMode(mode: AppThemeMode): void {
  // Persiste a preferencia global de tema da shell.
  localStorage.setItem(APP_THEME_STORAGE_KEY, mode);
}

export function applyAppThemeMode(mode: AppThemeMode): void {
  // Propaga o tema atual para todos os alvos conhecidos da interface.
  const targets = getThemeTargets();

  for (const target of targets) {
    target.setAttribute("data-theme", mode);
  }

  document.documentElement.style.colorScheme = mode;
}

export function initializeAppThemeMode(): AppThemeMode {
  // Inicializa o tema antes da renderizacao principal do app.
  const mode = getStoredAppThemeMode();
  applyAppThemeMode(mode);
  return mode;
}
