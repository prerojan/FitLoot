import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { Award, Crown, Sparkles, X, Zap } from "lucide-react";
import { useAuth } from "@/react-app/auth/context";
import LevelUpModal from "@/react-app/components/LevelUpModal";
import { api, clearJsonCache } from "@/react-app/utils/api";
import type { RewardNotification } from "@/shared/types";

type RewardNotificationsContextValue = {
  pushRewardNotifications: (
    notifications: RewardNotification[] | null | undefined,
  ) => void;
  refreshRewardNotifications: () => Promise<void>;
};

const RewardNotificationsContext =
  createContext<RewardNotificationsContextValue>({
    pushRewardNotifications: () => undefined,
    refreshRewardNotifications: async () => undefined,
  });

const POLL_INTERVAL_MS = 20_000;
const TOAST_DURATION_MS = 4_500;

function sortIncomingNotifications(
  notifications: readonly RewardNotification[],
): RewardNotification[] {
  const priorityByType: Record<RewardNotification["type"], number> = {
    level_up: 0,
    achievement_unlocked: 1,
    title_unlocked: 2,
  };

  return [...notifications].sort((left, right) => {
    const priorityDelta =
      priorityByType[left.type] - priorityByType[right.type];
    if (priorityDelta !== 0) return priorityDelta;
    return Number(left.id) - Number(right.id);
  });
}

function resolveNotificationHeading(notification: RewardNotification): string {
  if (notification.type === "achievement_unlocked") return "Nova conquista";
  if (notification.type === "title_unlocked") return "Novo título";
  return "Level up";
}

function resolveNotificationMeta(notification: RewardNotification): string {
  const rewards: string[] = [];
  const xpReward = Math.max(0, Number(notification.xp_reward ?? 0));
  const pointsReward = Math.max(0, Number(notification.points_reward ?? 0));

  if (xpReward > 0) rewards.push(`+${xpReward} XP`);
  if (pointsReward > 0) rewards.push(`+${pointsReward} Loot`);

  if (rewards.length > 0) return rewards.join(" • ");
  if (notification.type === "title_unlocked") return "Disponível para equipar";
  return "Recompensa desbloqueada";
}

function resolveNotificationIcon(notification: RewardNotification) {
  if (notification.type === "achievement_unlocked") return Award;
  if (notification.type === "title_unlocked") return Crown;
  return Sparkles;
}

export function RewardNotificationsProvider({
  children,
}: PropsWithChildren) {
  const { user } = useAuth();
  const [queue, setQueue] = useState<RewardNotification[]>([]);
  const processedIdsRef = useRef<Set<number>>(new Set());

  const acknowledgeNotifications = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;

    try {
      await api("/api/reward-notifications/consume", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
    } catch (error) {
      console.error("Error acknowledging reward notifications:", error);
    }
  }, []);

  const pushRewardNotifications = useCallback(
    (notifications: RewardNotification[] | null | undefined) => {
      const incoming = Array.isArray(notifications) ? notifications : [];
      if (incoming.length === 0) return;

      const freshNotifications = sortIncomingNotifications(
        incoming.filter((notification) => {
          const id = Number(notification.id ?? 0);
          if (!Number.isInteger(id) || id <= 0) return false;
          if (processedIdsRef.current.has(id)) return false;
          processedIdsRef.current.add(id);
          return true;
        }),
      );

      if (freshNotifications.length === 0) return;

      clearJsonCache("/api/progression");
      clearJsonCache("/api/achievements");
      clearJsonCache("/api/titles");
      clearJsonCache("/api/skills");

      setQueue((current) => [...current, ...freshNotifications]);
      void acknowledgeNotifications(
        freshNotifications.map((notification) => Number(notification.id)),
      );
    },
    [acknowledgeNotifications],
  );

  const refreshRewardNotifications = useCallback(async () => {
    if (!user) return;

    try {
      const response = await api("/api/reward-notifications/pending");

      if (response.status === 401 || response.status === 403) {
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to load reward notifications");
      }

      const payload = (await response.json()) as RewardNotification[];
      pushRewardNotifications(payload);
    } catch (error) {
      console.error("Error loading reward notifications:", error);
    }
  }, [pushRewardNotifications, user]);

  useEffect(() => {
    if (!user) {
      setQueue([]);
      processedIdsRef.current = new Set();
      return;
    }

    void refreshRewardNotifications();
    const intervalId = window.setInterval(() => {
      void refreshRewardNotifications();
    }, POLL_INTERVAL_MS);

    const handleRefreshRequest = () => {
      void refreshRewardNotifications();
    };

    window.addEventListener("fitloot:refresh-rewards", handleRefreshRequest);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(
        "fitloot:refresh-rewards",
        handleRefreshRequest,
      );
    };
  }, [refreshRewardNotifications, user]);

  const dismissCurrent = useCallback(() => {
    setQueue((current) => current.slice(1));
  }, []);

  const currentNotification = queue[0] ?? null;

  useEffect(() => {
    if (!currentNotification || currentNotification.type === "level_up") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      dismissCurrent();
    }, TOAST_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentNotification, dismissCurrent]);

  const contextValue = useMemo(
    () => ({
      pushRewardNotifications,
      refreshRewardNotifications,
    }),
    [pushRewardNotifications, refreshRewardNotifications],
  );

  const CurrentIcon = currentNotification
    ? resolveNotificationIcon(currentNotification)
    : null;

  return (
    <RewardNotificationsContext.Provider value={contextValue}>
      {children}

      {currentNotification?.type === "level_up" ? (
        <LevelUpModal
          level={Math.max(1, Number(currentNotification.level ?? 1))}
          onClose={dismissCurrent}
        />
      ) : null}

      {currentNotification && currentNotification.type !== "level_up" && CurrentIcon ? (
        <div className="fl-z-toast fixed inset-x-0 top-4 flex justify-center px-4 sm:justify-end sm:px-6">
          <div
            className="w-full max-w-sm overflow-hidden rounded-[1.75rem] border px-5 py-4 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-xl"
            style={{
              borderColor:
                currentNotification.type === "achievement_unlocked"
                  ? "color-mix(in srgb, var(--app-primary-color) 30%, transparent)"
                  : "color-mix(in srgb, var(--app-secondary-color) 30%, transparent)",
              background:
                "color-mix(in srgb, var(--fl-surface-strong) 92%, transparent)",
            }}
          >
            <div className="flex items-start gap-4">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                style={{
                  background:
                    currentNotification.type === "achievement_unlocked"
                      ? "color-mix(in srgb, var(--app-primary-color) 18%, transparent)"
                      : "color-mix(in srgb, var(--app-secondary-color) 18%, transparent)",
                  color:
                    currentNotification.type === "achievement_unlocked"
                      ? "var(--app-primary-color)"
                      : "var(--app-secondary-color)",
                }}
              >
                <CurrentIcon className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className="text-[10px] font-black uppercase tracking-[0.22em]"
                  style={{ color: "var(--app-primary-color)" }}
                >
                  {resolveNotificationHeading(currentNotification)}
                </p>
                <h3
                  className="mt-1 truncate text-base font-black"
                  style={{ color: "var(--fl-color-text)" }}
                >
                  {currentNotification.name ?? "Recompensa liberada"}
                </h3>
                <div
                  className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
                  style={{
                    background:
                      "color-mix(in srgb, var(--fl-surface-muted) 74%, transparent)",
                    color: "var(--fl-color-text-muted)",
                  }}
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span>{resolveNotificationMeta(currentNotification)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={dismissCurrent}
                className="rounded-full p-1.5 transition-opacity hover:opacity-80"
                aria-label="Fechar notificacao"
                style={{ color: "var(--fl-color-text-muted)" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </RewardNotificationsContext.Provider>
  );
}

export function useRewardNotifications(): RewardNotificationsContextValue {
  return useContext(RewardNotificationsContext);
}
