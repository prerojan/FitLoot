import type { UserProfileTheme } from "@/react-app/types/profile";

const CLASS_PREFIXES = ["font-title-"];
const DEFAULT_PRIMARY_COLOR = "#10b981";
const DEFAULT_SECONDARY_COLOR = "#14b8a6";
const DEFAULT_BG_COLOR = "#f8fafc";
const THEME_STORAGE_KEY = "fitloot_profile_theme";

function clearThemeClasses(root: HTMLElement): void {
  const removable = Array.from(root.classList).filter((className) =>
    CLASS_PREFIXES.some((prefix) => className.startsWith(prefix)),
  );

  if (removable.length > 0) {
    root.classList.remove(...removable);
  }
}

function persistProfileTheme(theme: UserProfileTheme): void {
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
}

export function getStoredProfileTheme(): UserProfileTheme | null {
  try {
    const rawTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (!rawTheme) return null;
    return JSON.parse(rawTheme) as UserProfileTheme;
  } catch {
    return null;
  }
}

export function clearStoredProfileTheme(): void {
  localStorage.removeItem(THEME_STORAGE_KEY);
}

export function applyProfileTheme(profile: UserProfileTheme | null): void {
  const root = document.documentElement;
  clearThemeClasses(root);

  const theme = profile ?? {
    custom_primary_color: DEFAULT_PRIMARY_COLOR,
    custom_secondary_color: DEFAULT_SECONDARY_COLOR,
    custom_font: null,
    custom_background_type: "color",
    custom_background_value: DEFAULT_BG_COLOR,
  };

  root.style.setProperty("--app-primary-color", theme.custom_primary_color ?? DEFAULT_PRIMARY_COLOR);
  root.style.setProperty("--app-secondary-color", theme.custom_secondary_color ?? DEFAULT_SECONDARY_COLOR);

  if (theme.custom_font) {
    root.classList.add(`font-title-${String(theme.custom_font)}`);
  }

  if (theme.custom_background_type === "image" && theme.custom_background_value) {
    root.style.setProperty("--app-bg-image", `url(${String(theme.custom_background_value)})`);
    root.style.setProperty("--app-bg-color", "transparent");
  } else if (theme.custom_background_type === "color" && theme.custom_background_value) {
    root.style.setProperty("--app-bg-color", String(theme.custom_background_value));
    root.style.setProperty("--app-bg-image", "none");
  } else {
    root.style.setProperty("--app-bg-color", DEFAULT_BG_COLOR);
    root.style.setProperty("--app-bg-image", "none");
  }

  if (profile) {
    persistProfileTheme(theme);
  } else {
    clearStoredProfileTheme();
  }
}
