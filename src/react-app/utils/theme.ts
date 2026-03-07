import type { UserProfileTheme } from "@/react-app/types/profile";

const CLASS_PREFIXES = ["font-title-"];
const DEFAULT_PRIMARY_COLOR = "#10b981";
const DEFAULT_SECONDARY_COLOR = "#14b8a6";

export function applyProfileTheme(profile: UserProfileTheme | null): void {
  if (!profile) return;

  const root = document.documentElement;
  const removable = Array.from(root.classList).filter((className) =>
    CLASS_PREFIXES.some((prefix) => className.startsWith(prefix)),
  );

  if (removable.length > 0) {
    root.classList.remove(...removable);
  }

  root.style.setProperty("--app-primary-color", profile.custom_primary_color ?? DEFAULT_PRIMARY_COLOR);
  root.style.setProperty("--app-secondary-color", profile.custom_secondary_color ?? DEFAULT_SECONDARY_COLOR);

  if (profile.custom_font) root.classList.add(`font-title-${String(profile.custom_font)}`);

  if (profile.custom_background_type === "image" && profile.custom_background_value) {
    root.style.setProperty("--app-bg-image", `url(${String(profile.custom_background_value)})`);
    root.style.setProperty("--app-bg-color", "transparent");
  } else if (profile.custom_background_type === "color" && profile.custom_background_value) {
    root.style.setProperty("--app-bg-color", String(profile.custom_background_value));
    root.style.setProperty("--app-bg-image", "none");
  } else {
    root.style.setProperty("--app-bg-color", "#f8fafc");
    root.style.setProperty("--app-bg-image", "none");
  }
}
