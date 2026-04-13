import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { BellRing, MessageCircle, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { ROUTE_PATHS } from "@/react-app/auth/constants";
import { useAuth } from "@/react-app/auth/context";
import { Avatar } from "@/react-app/components/ui/avatar";
import { isAndroidHost } from "@/react-app/services/runtime/hostRuntime";
import {
  consumePendingSocialChatNotifications,
  fetchPendingSocialChatNotifications,
  fetchSocialUnreadSummary,
  SocialChatApiError,
} from "@/react-app/services/socialChatService";
import { navigateProtectedRoute } from "@/react-app/services/appNavigation";
import { isExpectedApiCancellation } from "@/react-app/utils/api";
import type { SocialChatNotification, SocialUnreadSummary } from "@/shared/types";
import { SocialChatNotificationsContext } from "@/react-app/contexts/socialChatNotificationsContext";

const TOAST_DURATION_MS = 5_000;
const INITIAL_REFRESH_DELAY_MS = 350;
const MIN_REFRESH_INTERVAL_MS = 2_500;
const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_INTERVAL_MS = 16_000;
const MAX_PENDING_NOTIFICATIONS = 10;
const EMPTY_UNREAD_SUMMARY: SocialUnreadSummary = {
  total_unread_count: 0,
  conversations: [],
};

function buildNotificationKey(notification: Pick<SocialChatNotification, "conversation_id" | "message_id">): string {
  return `${notification.conversation_id}:${notification.message_id}`;
}

function countVisibleUnreadMessages(
  summary: SocialUnreadSummary,
  activeConversationId: number | null,
): number {
  if (activeConversationId === null) {
    return summary.total_unread_count;
  }

  return summary.conversations.reduce(
    (count, conversation) => (
      conversation.conversation_id === activeConversationId
        ? count
        : count + conversation.unread_count
    ),
    0,
  );
}

function buildVisibleUnreadConversationMap(
  summary: SocialUnreadSummary,
  activeConversationId: number | null,
): Record<number, number> {
  const conversationMap: Record<number, number> = {};

  for (const conversation of summary.conversations) {
    if (activeConversationId !== null && conversation.conversation_id === activeConversationId) {
      continue;
    }
    conversationMap[conversation.conversation_id] = Math.max(0, conversation.unread_count);
  }

  return conversationMap;
}

function buildVisibleUnreadDirectPeerMap(
  summary: SocialUnreadSummary,
  activeConversationId: number | null,
): Record<string, number> {
  const peerMap: Record<string, number> = {};

  for (const conversation of summary.conversations) {
    if (activeConversationId !== null && conversation.conversation_id === activeConversationId) {
      continue;
    }

    const peerUserId =
      typeof conversation.direct_peer_user_id === "string" && conversation.direct_peer_user_id.trim().length > 0
        ? conversation.direct_peer_user_id.trim()
        : null;
    if (!peerUserId) {
      continue;
    }

    peerMap[peerUserId] = Math.max(0, conversation.unread_count);
  }

  return peerMap;
}

function clearConversationUnreadFromSummary(
  summary: SocialUnreadSummary,
  conversationId: number,
): SocialUnreadSummary {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return summary;
  }

  let totalUnreadCount = summary.total_unread_count;
  let changed = false;
  const conversations = summary.conversations.flatMap((conversation) => {
    if (conversation.conversation_id !== conversationId) {
      return [conversation];
    }
    if (conversation.unread_count <= 0) {
      return [conversation];
    }

    totalUnreadCount = Math.max(0, totalUnreadCount - conversation.unread_count);
    changed = true;
    return [];
  });

  if (!changed) {
    return summary;
  }

  return {
    total_unread_count: totalUnreadCount,
    conversations,
  };
}

function resolveActiveConversationId(pathname: string, search: string): number | null {
  if (pathname !== ROUTE_PATHS.friends) return null;

  const value = new URLSearchParams(search).get("conversationId");
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function formatToastTimestamp(value: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export function SocialChatNotificationsProvider({
  children,
}: PropsWithChildren) {
  const { user } = useAuth();
  const androidHost = isAndroidHost();
  const navigate = useNavigate();
  const location = useLocation();
  const [queue, setQueue] = useState<SocialChatNotification[]>([]);
  const [unreadSummary, setUnreadSummary] = useState<SocialUnreadSummary | null>(null);
  const [pollIntervalMs, setPollIntervalMs] = useState(POLL_INTERVAL_MS);
  const processedKeysRef = useRef<Set<string>>(new Set());
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastRefreshAtRef = useRef(0);
  const activeConversationId = resolveActiveConversationId(location.pathname, location.search);
  const isSocialHubRoute = location.pathname === ROUTE_PATHS.friends;
  const previousIsSocialHubRouteRef = useRef(isSocialHubRoute);
  const unreadCount = useMemo(
    () => countVisibleUnreadMessages(unreadSummary ?? EMPTY_UNREAD_SUMMARY, activeConversationId),
    [activeConversationId, unreadSummary],
  );
  const unreadByConversationId = useMemo(
    () => buildVisibleUnreadConversationMap(unreadSummary ?? EMPTY_UNREAD_SUMMARY, activeConversationId),
    [activeConversationId, unreadSummary],
  );
  const unreadByDirectPeerUserId = useMemo(
    () => buildVisibleUnreadDirectPeerMap(unreadSummary ?? EMPTY_UNREAD_SUMMARY, activeConversationId),
    [activeConversationId, unreadSummary],
  );
  const hasLoadedUnreadState = unreadSummary !== null;

  const consumeNotifications = useCallback(async (notifications: readonly SocialChatNotification[]) => {
    if (notifications.length === 0) return;

    try {
      await consumePendingSocialChatNotifications({
        items: notifications.map((notification) => ({
          conversation_id: notification.conversation_id,
          message_id: notification.message_id,
        })),
      });
    } catch (error) {
      if (isExpectedApiCancellation(error)) {
        return;
      }
      if (error instanceof SocialChatApiError && error.code === "UNAUTHORIZED") {
        return;
      }
      console.error("Error consuming social chat notifications:", error);
    }
  }, []);

  const pushSocialChatNotifications = useCallback(
    (notifications: SocialChatNotification[] | null | undefined) => {
      const incoming = Array.isArray(notifications) ? notifications : [];
      const activeItems: SocialChatNotification[] = [];
      const freshQueue: SocialChatNotification[] = [];

      for (const notification of incoming) {
        const key = buildNotificationKey(notification);
        if (processedKeysRef.current.has(key)) {
          continue;
        }

        processedKeysRef.current.add(key);
        if (activeConversationId !== null && notification.conversation_id === activeConversationId) {
          activeItems.push(notification);
          continue;
        }

        freshQueue.push(notification);
      }

      if (activeItems.length > 0) {
        void consumeNotifications(activeItems);
      }

      if (freshQueue.length === 0 || isSocialHubRoute) return;
      if (!androidHost) {
        setQueue((current) => [...current, ...freshQueue]);
      }
    },
    [activeConversationId, androidHost, consumeNotifications, isSocialHubRoute],
  );

  const refreshSocialChatNotifications = useCallback(async (options?: { force?: boolean }) => {
    if (!user) return;
    const forceRefresh = options?.force === true;
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const now = Date.now();
    if (!forceRefresh && now - lastRefreshAtRef.current < MIN_REFRESH_INTERVAL_MS) {
      return;
    }

    const refreshTask = (async () => {
      try {
        const nextUnreadSummary = await fetchSocialUnreadSummary();
        lastRefreshAtRef.current = Date.now();
        setUnreadSummary(nextUnreadSummary);
        setPollIntervalMs(POLL_INTERVAL_MS);

        if (!androidHost && !isSocialHubRoute) {
          try {
            const notifications = await fetchPendingSocialChatNotifications(MAX_PENDING_NOTIFICATIONS);
            pushSocialChatNotifications(notifications);
          } catch (error) {
            if (isExpectedApiCancellation(error)) {
              return;
            }
            if (error instanceof SocialChatApiError && error.code === "UNAUTHORIZED") {
              return;
            }
            console.error("Error loading social chat notifications:", error);
          }
        }
      } catch (error) {
        if (isExpectedApiCancellation(error)) {
          return;
        }
        if (error instanceof SocialChatApiError && error.code === "UNAUTHORIZED") {
          setQueue([]);
          setUnreadSummary(EMPTY_UNREAD_SUMMARY);
          setPollIntervalMs(POLL_INTERVAL_MS);
          return;
        }
        setPollIntervalMs((current) => Math.min(current * 2, MAX_POLL_INTERVAL_MS));
        console.error("Error loading social unread summary:", error);
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = refreshTask;
    await refreshTask;
  }, [androidHost, isSocialHubRoute, pushSocialChatNotifications, user]);

  const clearConversationUnread = useCallback((conversationId: number) => {
    setUnreadSummary((current) => (
      current ? clearConversationUnreadFromSummary(current, conversationId) : current
    ));
  }, []);

  useEffect(() => {
    if (!user) {
      setQueue([]);
      setUnreadSummary(null);
      setPollIntervalMs(POLL_INTERVAL_MS);
      processedKeysRef.current = new Set();
      refreshInFlightRef.current = null;
      lastRefreshAtRef.current = 0;
      return;
    }
    if (isSocialHubRoute) {
      setQueue([]);
    }

    const timeoutId = window.setTimeout(() => {
      void refreshSocialChatNotifications();
    }, INITIAL_REFRESH_DELAY_MS);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshSocialChatNotifications();
    }, pollIntervalMs);

    const handleVisibilityRefresh = () => {
      if (document.visibilityState !== "visible") return;
      void refreshSocialChatNotifications({ force: true });
    };

    window.addEventListener("focus", handleVisibilityRefresh);
    document.addEventListener("visibilitychange", handleVisibilityRefresh);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
    };
  }, [isSocialHubRoute, pollIntervalMs, refreshSocialChatNotifications, user]);

  useEffect(() => {
    if (!user) return;
    const wasSocialHubRoute = previousIsSocialHubRouteRef.current;
    previousIsSocialHubRouteRef.current = isSocialHubRoute;

    if (!wasSocialHubRoute || isSocialHubRoute) return;
    void refreshSocialChatNotifications({ force: true });
  }, [isSocialHubRoute, refreshSocialChatNotifications, user]);

  useEffect(() => {
    if (activeConversationId === null || !user) return;
    void refreshSocialChatNotifications({ force: true });
  }, [activeConversationId, refreshSocialChatNotifications, user]);

  const dismissCurrent = useCallback(() => {
    setQueue((current) => current.slice(1));
  }, []);

  const currentNotification = queue[0] ?? null;

  useEffect(() => {
    if (!currentNotification) return;

    const timeoutId = window.setTimeout(() => {
      dismissCurrent();
    }, TOAST_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentNotification, dismissCurrent]);

  const openConversationFromToast = useCallback(async () => {
    if (!currentNotification) return;

    await consumeNotifications([currentNotification]);
    dismissCurrent();
    await navigateProtectedRoute(
      navigate,
      `${ROUTE_PATHS.friends}?conversationId=${currentNotification.conversation_id}`,
    );
    void refreshSocialChatNotifications({ force: true });
  }, [consumeNotifications, currentNotification, dismissCurrent, navigate, refreshSocialChatNotifications]);

  const contextValue = useMemo(
    () => ({
      unreadCount,
      unreadByConversationId,
      unreadByDirectPeerUserId,
      hasLoadedUnreadState,
      pushSocialChatNotifications,
      clearConversationUnread,
      refreshSocialChatNotifications,
    }),
    [
      clearConversationUnread,
      hasLoadedUnreadState,
      pushSocialChatNotifications,
      refreshSocialChatNotifications,
      unreadByConversationId,
      unreadByDirectPeerUserId,
      unreadCount,
    ],
  );

  return (
    <SocialChatNotificationsContext.Provider value={contextValue}>
      {children}

      {currentNotification ? (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[80] flex justify-center px-4">
          <div
            className="pointer-events-auto flex w-full max-w-[28rem] items-start gap-3 rounded-[1.75rem] border p-3 shadow-2xl backdrop-blur-xl sm:p-4"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-gradient-top) 94%, transparent), color-mix(in srgb, var(--fl-surface-gradient-bottom) 96%, transparent))",
              borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, var(--fl-border-soft))",
              boxShadow: "0 24px 64px color-mix(in srgb, var(--app-primary-color) 14%, transparent)",
            }}
          >
            <button
              type="button"
              onClick={() => {
                void openConversationFromToast();
              }}
              className="flex min-w-0 flex-1 items-start gap-3 text-left"
            >
              <div className="relative shrink-0">
                <Avatar
                  src={currentNotification.sender_avatar_url ?? null}
                  name={currentNotification.sender_username}
                  className="h-12 w-12 border"
                />
                <div
                  className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: "var(--app-primary-color)",
                    color: "var(--fl-nav-item-active-text)",
                  }}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex min-w-0 items-center gap-2">
                  <BellRing
                    className="h-4 w-4 shrink-0"
                    style={{ color: "var(--app-primary-color)" }}
                  />
                  <p
                    className="truncate text-[10px] font-black uppercase tracking-[0.22em]"
                    style={{ color: "var(--app-primary-color)" }}
                  >
                    Social Hub
                  </p>
                  <span
                    className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-[0.16em]"
                    style={{ color: "var(--fl-color-text-muted)" }}
                  >
                    {formatToastTimestamp(currentNotification.created_at)}
                  </span>
                </div>
                <p
                  className="truncate text-sm font-bold sm:text-base"
                  style={{ color: "var(--fl-color-text)" }}
                >
                  {currentNotification.sender_full_name || currentNotification.sender_username}
                </p>
                <p
                  className="truncate text-[11px] font-bold uppercase tracking-[0.16em]"
                  style={{ color: "var(--fl-color-text-muted)" }}
                >
                  {currentNotification.conversation_title}
                </p>
                <p
                  className="mt-2 line-clamp-2 text-sm leading-relaxed"
                  style={{ color: "var(--fl-color-text)" }}
                >
                  {currentNotification.message_text}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={dismissCurrent}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
              style={{ color: "var(--fl-color-text-muted)" }}
              aria-label="Dispensar notificacao"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </SocialChatNotificationsContext.Provider>
  );
}
