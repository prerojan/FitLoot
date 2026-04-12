import { useMemo } from "react";

import { useRewardNotifications } from "@/react-app/contexts/useRewardNotifications";
import { useSocialChatNotifications } from "@/react-app/contexts/useSocialChatNotifications";

export function useArenaNotificationBadge() {
  const { pendingCount: rewardPendingCount } = useRewardNotifications();
  const { pendingCount: socialPendingCount } = useSocialChatNotifications();

  return useMemo(() => {
    const totalCount = Math.max(0, rewardPendingCount) + Math.max(0, socialPendingCount);
    return {
      totalCount,
      hasPending: totalCount > 0,
    };
  }, [rewardPendingCount, socialPendingCount]);
}

export default useArenaNotificationBadge;
