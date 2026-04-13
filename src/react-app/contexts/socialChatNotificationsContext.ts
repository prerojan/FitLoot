import { createContext } from "react";

import type { SocialChatNotification } from "@/shared/types";

export type SocialChatNotificationsContextValue = {
  unreadCount: number;
  unreadByConversationId: Record<number, number>;
  unreadByDirectPeerUserId: Record<string, number>;
  hasLoadedUnreadState: boolean;
  pushSocialChatNotifications: (
    notifications: SocialChatNotification[] | null | undefined,
  ) => void;
  clearConversationUnread: (conversationId: number) => void;
  refreshSocialChatNotifications: (options?: {
    force?: boolean;
  }) => Promise<void>;
};

export const SocialChatNotificationsContext =
  createContext<SocialChatNotificationsContextValue>({
    unreadCount: 0,
    unreadByConversationId: {},
    unreadByDirectPeerUserId: {},
    hasLoadedUnreadState: false,
    pushSocialChatNotifications: () => undefined,
    clearConversationUnread: () => undefined,
    refreshSocialChatNotifications: async () => undefined,
  });
