import type { UserProfileTheme } from "@/react-app/types/profile";

const CLASS_PREFIXES = ["font-title-"];
const DEFAULT_PRIMARY_COLOR = "#10b981";
const DEFAULT_SECONDARY_COLOR = "#14b8a6";
const DEFAULT_PRIMARY_RGB = "16 185 129";
const DEFAULT_SECONDARY_RGB = "20 184 166";
const DEFAULT_BG_COLOR = "var(--fl-body-bg)";
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

function normalizeHexColor(color: string): string | null {
  const value = color.trim();
  if (!value.startsWith("#")) return null;

  const hex = value.slice(1);
  if (hex.length === 3) {
    return hex
      .split("")
      .map((char) => char.repeat(2))
      .join("");
  }

  if (hex.length === 6) {
    return hex;
  }

  return null;
}

function resolveRgbTriplet(color: string | null | undefined, fallback: string): string {
  if (!color) return fallback;

  const normalizedHex = normalizeHexColor(color);
  if (normalizedHex) {
    const channels = normalizedHex.match(/.{1,2}/g);
    if (!channels || channels.length !== 3) return fallback;
    return channels.map((channel) => Number.parseInt(channel, 16)).join(" ");
  }

  const rgbMatch = color.match(/rgba?\(([^)]+)\)/i);
  if (!rgbMatch) return fallback;
  const rgbChannels = rgbMatch[1];
  if (!rgbChannels) return fallback;

  const channels = rgbChannels
    .split(",")
    .slice(0, 3)
    .map((channel) => Number.parseFloat(channel.trim()))
    .filter((channel) => Number.isFinite(channel))
    .map((channel) => Math.min(255, Math.max(0, Math.round(channel))));

  if (channels.length !== 3) {
    return fallback;
  }

  return channels.join(" ");
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
  root.style.setProperty(
    "--app-primary-color-rgb",
    resolveRgbTriplet(theme.custom_primary_color ?? DEFAULT_PRIMARY_COLOR, DEFAULT_PRIMARY_RGB),
  );
  root.style.setProperty(
    "--app-secondary-color-rgb",
    resolveRgbTriplet(theme.custom_secondary_color ?? DEFAULT_SECONDARY_COLOR, DEFAULT_SECONDARY_RGB),
  );

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
