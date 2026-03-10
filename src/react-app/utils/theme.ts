import type { UserProfileTheme } from "@/react-app/types/profile";

const CLASS_PREFIXES = ["font-title-"];
const DEFAULT_PRIMARY_COLOR = "#10b981";
const DEFAULT_SECONDARY_COLOR = "#14b8a6";
const DEFAULT_BG_COLOR = "#f8fafc";
const THEME_STORAGE_KEY = "fitloot_profile_theme";
const FONT_QUERY_BY_KEY: Record<string, string> = {
  rajdhani: "family=Rajdhani:wght@400;500;600;700",
  orbitron: "family=Orbitron:wght@400;500;700;800;900",
  exo2: "family=Exo+2:wght@400;500;600;700;800",
  "bebas-neue": "family=Bebas+Neue:wght@400",
  teko: "family=Teko:wght@400;500;600;700",
  "russo-one": "family=Russo+One:wght@400",
  audiowide: "family=Audiowide:wght@400",
  "press-start-2p": "family=Press+Start+2P:wght@400",
  cinzel: "family=Cinzel:wght@400;500;600;700",
  bangers: "family=Bangers:wght@400",
};
const loadedFonts = new Set<string>();

function clearThemeClasses(root: HTMLElement): void {
  const removable = Array.from(root.classList).filter((className) =>
    CLASS_PREFIXES.some((prefix) => className.startsWith(prefix)),
  );

  if (removable.length > 0) {
    root.classList.remove(...removable);
  }
}

function ensureThemeFontLoaded(fontKey: string): void {
  if (loadedFonts.has(fontKey)) return;
  const query = FONT_QUERY_BY_KEY[fontKey];
  if (!query) return;

  const existingTag = document.querySelector(`link[data-fitloot-font="${fontKey}"]`);
  if (existingTag) {
    loadedFonts.add(fontKey);
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  link.setAttribute("data-fitloot-font", fontKey);
  document.head.appendChild(link);
  loadedFonts.add(fontKey);
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
    const fontKey = String(theme.custom_font);
    ensureThemeFontLoaded(fontKey);
    root.classList.add(`font-title-${fontKey}`);
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
