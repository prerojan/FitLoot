import { createContext } from "react";

import type { RewardNotification } from "@/shared/types";

export type RewardNotificationsContextValue = {
  pushRewardNotifications: (
    notifications: RewardNotification[] | null | undefined,
  ) => void;
  refreshRewardNotifications: (options?: {
    force?: boolean;
  }) => Promise<void>;
};

export const RewardNotificationsContext =
  createContext<RewardNotificationsContextValue>({
    pushRewardNotifications: () => undefined,
    refreshRewardNotifications: async () => undefined,
  });
