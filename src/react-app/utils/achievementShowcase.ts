import type { AchievementWithUnlock } from "@/shared/types";

type AchievementRarity = "COMUM" | "INCOMUM" | "RARO" | "MITICO" | "SECRETO";

const ACHIEVEMENT_RARITY_ACCENT: Record<AchievementRarity, string> = {
  COMUM: "#22c55e",
  INCOMUM: "#14b8a6",
  RARO: "#2563eb",
  MITICO: "#a855f7",
  SECRETO: "#f97316",
};

type ShowcaseToken = {
  id: string | null;
  name: string | null;
};

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function normalizeRarity(value: string | null | undefined): AchievementRarity {
  const normalized = normalizeToken(String(value ?? "")).toUpperCase();

  if (
    normalized === "COMUM" ||
    normalized === "INCOMUM" ||
    normalized === "RARO" ||
    normalized === "MITICO" ||
    normalized === "SECRETO"
  ) {
    return normalized;
  }

  return "COMUM";
}

function toShowcaseTokens(rawValue: string | null | undefined): ShowcaseToken[] {
  if (!rawValue) return [];

  const trimmedValue = rawValue.trim();
  if (!trimmedValue) return [];

  try {
    const parsed = JSON.parse(trimmedValue) as unknown;

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (typeof item === "string" || typeof item === "number") {
            return { id: String(item), name: String(item) };
          }

          if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            const idValue =
              typeof record.id === "string" || typeof record.id === "number"
                ? String(record.id)
                : null;
            const nameValue = typeof record.name === "string" ? record.name : null;

            if (idValue || nameValue) {
              return { id: idValue, name: nameValue };
            }
          }

          return null;
        })
        .filter((token): token is ShowcaseToken => token !== null);
    }

    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const idValue =
        typeof record.id === "string" || typeof record.id === "number"
          ? String(record.id)
          : null;
      const nameValue = typeof record.name === "string" ? record.name : null;

      if (idValue || nameValue) {
        return [{ id: idValue, name: nameValue }];
      }
    }

    if (typeof parsed === "string" || typeof parsed === "number") {
      return [{ id: String(parsed), name: String(parsed) }];
    }
  } catch {
    return [{ id: trimmedValue, name: trimmedValue }];
  }

  return [];
}

export function resolveShowcasedAchievement(
  showcasedValue: string | null | undefined,
  achievements: AchievementWithUnlock[],
): AchievementWithUnlock | null {
  const showcaseTokens = toShowcaseTokens(showcasedValue);
  if (showcaseTokens.length === 0) return null;

  const matchedAchievement = achievements.find((achievement) => {
    const achievementId = String(achievement.id);
    const normalizedName = normalizeToken(achievement.name);

    return showcaseTokens.some((token) => {
      const tokenId = token.id?.trim();
      const tokenName = token.name ? normalizeToken(token.name) : null;

      return tokenId === achievementId || tokenName === normalizedName;
    });
  });

  return matchedAchievement ?? null;
}

export function getAchievementShowcaseStyle(rarity: string | null | undefined) {
  const normalizedRarity = normalizeRarity(rarity);
  const accent = ACHIEVEMENT_RARITY_ACCENT[normalizedRarity];

  return {
    accent,
    rarity: normalizedRarity,
    borderColor: `color-mix(in srgb, ${accent} 42%, var(--fl-border-soft))`,
    backgroundColor: `color-mix(in srgb, ${accent} 12%, var(--fl-surface-strong))`,
    iconBackground: `color-mix(in srgb, ${accent} 18%, transparent)`,
    textColor: accent,
  };
}
