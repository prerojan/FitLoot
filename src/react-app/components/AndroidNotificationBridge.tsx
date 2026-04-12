import { useEffect } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/react-app/auth/context";
import { useRewardNotifications } from "@/react-app/contexts/useRewardNotifications";
import { useSocialChatNotifications } from "@/react-app/contexts/useSocialChatNotifications";
import notificationService from "@/react-app/services/native/notificationService";
import { isAndroidHost } from "@/react-app/services/runtime/hostRuntime";
import { navigateProtectedRoute } from "@/react-app/services/appNavigation";

export default function AndroidNotificationBridge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { clearPendingCount, refreshRewardNotifications } = useRewardNotifications();
  const { refreshSocialChatNotifications } = useSocialChatNotifications();

  useEffect(() => {
    if (!user?.id || !isAndroidHost()) return;

    const permissionStatus = notificationService.readPermissionStatus();
    if (permissionStatus.permission === "granted") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      notificationService.requestPermission();
    }, 1_600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !isAndroidHost()) return;

    return notificationService.subscribeToNotificationOpen((detail) => {
      const route =
        typeof detail.route === "string" && detail.route.trim().length > 0
          ? detail.route.trim()
          : typeof detail.conversation_id === "number" && detail.conversation_id > 0
            ? `/friends?conversationId=${detail.conversation_id}`
            : "/dashboard";

      if (detail.notification_type === "reward") {
        clearPendingCount();
      }

      void navigateProtectedRoute(navigate, route);
      void refreshRewardNotifications({ force: true });
      void refreshSocialChatNotifications({ force: true });
    });
  }, [
    clearPendingCount,
    navigate,
    refreshRewardNotifications,
    refreshSocialChatNotifications,
    user?.id,
  ]);

  return null;
}
