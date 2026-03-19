import { Trophy } from "lucide-react";
import type { AchievementWithUnlock } from "@/shared/types";
import { getAchievementShowcaseStyle } from "@/react-app/utils/achievementShowcase";
import { cn } from "@/react-app/utils";

type AchievementShowcaseBadgeProps = {
  achievement: AchievementWithUnlock;
  variant?: "dashboard" | "profile";
  className?: string | undefined;
};

export default function AchievementShowcaseBadge({
  achievement,
  variant = "profile",
  className,
}: AchievementShowcaseBadgeProps) {
  const style = getAchievementShowcaseStyle(achievement.rarity);
  const isDashboard = variant === "dashboard";

  return (
    <div
      className={cn(
        "max-w-full min-w-0 items-center rounded-full border",
        isDashboard
          ? "flex w-full gap-2 px-3 py-2 sm:inline-flex sm:w-auto sm:px-4"
          : "mx-auto flex w-fit gap-2 px-3 py-2 sm:px-4",
        className,
      )}
      style={{
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
      }}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          isDashboard ? "h-8 w-8" : "h-6 w-6",
        )}
        style={{
          backgroundColor: style.iconBackground,
          color: style.textColor,
        }}
      >
        <Trophy className={isDashboard ? "h-4 w-4" : "h-3.5 w-3.5"} />
      </span>

      {isDashboard ? (
        <div className="min-w-0">
          <p
            className="text-[0.58rem] font-black uppercase tracking-[0.18em] sm:text-[0.62rem]"
            style={{ color: style.textColor }}
          >
            Conquista honrada
          </p>
          <p className="truncate text-sm font-bold sm:text-base" style={{ color: "var(--fl-color-text)" }}>
            {achievement.name}
          </p>
        </div>
      ) : (
        <span
          className="truncate text-[9px] font-bold uppercase tracking-widest sm:text-[10px]"
          style={{ color: style.textColor }}
        >
          {achievement.name}
        </span>
      )}
    </div>
  );
}
