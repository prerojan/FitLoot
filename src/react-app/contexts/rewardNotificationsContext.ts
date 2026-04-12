import { createContext } from "react";

import type { RewardNotification } from "@/shared/types";

export type RewardNotificationsContextValue = {
  pendingCount: number;
  clearPendingCount: () => void;
  pushRewardNotifications: (
    notifications: RewardNotification[] | null | undefined,
  ) => void;
  refreshRewardNotifications: (options?: {
    force?: boolean;
  }) => Promise<void>;
};

export const RewardNotificationsContext =
  createContext<RewardNotificationsContextValue>({
    pendingCount: 0,
    clearPendingCount: () => undefined,
    pushRewardNotifications: () => undefined,
    refreshRewardNotifications: async () => undefined,
  });
