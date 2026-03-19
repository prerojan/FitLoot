import type { AchievementWithUnlock } from "@/shared/types";
import {
  repairKnownMojibake,
  repairKnownMojibakeString,
} from "@/shared/textEncoding";

type AchievementRarity = "COMUM" | "INCOMUM" | "RARO" | "MITICO" | "SECRETO";

const ACHIEVEMENT_RARITY_ACCENT: Record<AchievementRarity, string> = {
  COMUM: "#00ff7b",
  INCOMUM: "#22c55e",
  RARO: "#0070dd",
  MITICO: "#a335ee",
  SECRETO: "#ff8000",
};

type ShowcaseToken = {
  id: string | null;
  name: string | null;
};

function toTokenValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeToken(value: string): string {
  return repairKnownMojibakeString(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export function sanitizeAchievementForDisplay(
  achievement: AchievementWithUnlock,
): AchievementWithUnlock {
  return {
    ...achievement,
    name: repairKnownMojibakeString(achievement.name),
    description:
      typeof achievement.description === "string"
        ? repairKnownMojibakeString(achievement.description)
        : achievement.description,
    rarity: repairKnownMojibakeString(achievement.rarity),
    reference:
      typeof achievement.reference === "string"
        ? repairKnownMojibake(achievement.reference) ?? achievement.reference
        : achievement.reference,
  };
}

export function sanitizeAchievementsForDisplay(
  achievements: AchievementWithUnlock[],
): AchievementWithUnlock[] {
  return achievements.map((achievement) => sanitizeAchievementForDisplay(achievement));
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
              toTokenValue(record.id)
              ?? toTokenValue(record.achievement_id)
              ?? toTokenValue(record.achievementId)
              ?? toTokenValue(record.value);
            const nameValue =
              toTokenValue(record.name)
              ?? toTokenValue(record.achievement_name)
              ?? toTokenValue(record.achievementName)
              ?? toTokenValue(record.label);

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
        toTokenValue(record.id)
        ?? toTokenValue(record.achievement_id)
        ?? toTokenValue(record.achievementId)
        ?? toTokenValue(record.value);
      const nameValue =
        toTokenValue(record.name)
        ?? toTokenValue(record.achievement_name)
        ?? toTokenValue(record.achievementName)
        ?? toTokenValue(record.label);

      if (idValue || nameValue) {
        return [{ id: idValue, name: nameValue }];
      }
    }

    if (typeof parsed === "string" || typeof parsed === "number") {
      return [{ id: String(parsed), name: String(parsed) }];
    }
  } catch {
    const delimitedTokens = trimmedValue
      .split(/[|,;]/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (delimitedTokens.length > 1) {
      return delimitedTokens.map((token) => ({ id: token, name: token }));
    }

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

  return matchedAchievement ? sanitizeAchievementForDisplay(matchedAchievement) : null;
}

export function getAchievementShowcaseStyle(rarity: string | null | undefined) {
  const normalizedRarity = normalizeRarity(rarity);
  const accent = ACHIEVEMENT_RARITY_ACCENT[normalizedRarity];

  return {
    accent,
    rarity: normalizedRarity,
    borderColor: `color-mix(in srgb, ${accent} 58%, var(--fl-border-soft))`,
    backgroundColor: `color-mix(in srgb, ${accent} 10%, var(--fl-surface-strong))`,
    iconBackground: `color-mix(in srgb, ${accent} 22%, var(--fl-surface-strong))`,
    textColor: `color-mix(in srgb, ${accent} 72%, var(--fl-color-text))`,
    badgeShadow: `0 0 0 1px color-mix(in srgb, ${accent} 16%, transparent), 0 12px 28px color-mix(in srgb, ${accent} 12%, transparent)`,
  };
}
