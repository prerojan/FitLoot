import { createContext } from "react";

import type { SocialChatNotification } from "@/shared/types";

export type SocialChatNotificationsContextValue = {
  pendingCount: number;
  pushSocialChatNotifications: (
    notifications: SocialChatNotification[] | null | undefined,
  ) => void;
  refreshSocialChatNotifications: (options?: {
    force?: boolean;
  }) => Promise<void>;
};

export const SocialChatNotificationsContext =
  createContext<SocialChatNotificationsContextValue>({
    pendingCount: 0,
    pushSocialChatNotifications: () => undefined,
    refreshSocialChatNotifications: async () => undefined,
  });
