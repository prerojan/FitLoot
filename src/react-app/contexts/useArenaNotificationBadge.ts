import { useMemo } from "react";

import { useRewardNotifications } from "@/react-app/contexts/useRewardNotifications";
import { useSocialChatNotifications } from "@/react-app/contexts/useSocialChatNotifications";

export function useArenaNotificationBadge() {
  const { pendingCount: rewardPendingCount } = useRewardNotifications();
  const { unreadCount: socialUnreadCount } = useSocialChatNotifications();

  return useMemo(() => {
    const totalCount = Math.max(0, rewardPendingCount) + Math.max(0, socialUnreadCount);
    return {
      totalCount,
      hasPending: totalCount > 0,
    };
  }, [rewardPendingCount, socialUnreadCount]);
}

export default useArenaNotificationBadge;
