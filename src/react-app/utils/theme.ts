import type { UserProfileTheme } from "@/react-app/types/profile";

const CLASS_PREFIXES = ["theme-primary-", "theme-secondary-", "font-title-"];

export function applyProfileTheme(profile: UserProfileTheme | null): void {
  if (!profile) return;

  const root = document.documentElement;
  const removable = Array.from(root.classList).filter((className) =>
    CLASS_PREFIXES.some((prefix) => className.startsWith(prefix)),
  );

  if (removable.length > 0) {
    root.classList.remove(...removable);
  }

  if (profile.custom_primary_color) root.classList.add(`theme-primary-${String(profile.custom_primary_color)}`);
  if (profile.custom_secondary_color) root.classList.add(`theme-secondary-${String(profile.custom_secondary_color)}`);
  if (profile.custom_font) root.classList.add(`font-title-${String(profile.custom_font)}`);

  if (profile.custom_background_type === "image" && profile.custom_background_value) {
    root.style.setProperty("--app-bg-image", `url(${String(profile.custom_background_value)})`);
  } else if (profile.custom_background_type === "color" && profile.custom_background_value) {
    root.style.setProperty("--app-bg-color", String(profile.custom_background_value));
    root.style.setProperty("--app-bg-image", "none");
  }
}
