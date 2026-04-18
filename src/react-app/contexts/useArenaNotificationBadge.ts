import { useMemo } from "react";

import { useSocialChatNotifications } from "@/react-app/contexts/useSocialChatNotifications";

export function useArenaNotificationBadge() {
  const { unreadCount: socialUnreadCount } = useSocialChatNotifications();

  return useMemo(() => {
    const totalCount = Math.max(0, socialUnreadCount);
    return {
      totalCount,
      hasPending: totalCount > 0,
    };
  }, [socialUnreadCount]);
}

export default useArenaNotificationBadge;
