import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { useSearchParams } from "react-router";
import {
  Bell,
  Check,
  ChevronLeft,
  CirclePlus,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MoreVertical,
  Search,
  SendHorizontal,
  ShieldBan,
  UserMinus,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { Avatar } from "@/react-app/components/ui/avatar";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import { useSocialChatNotifications } from "@/react-app/contexts/useSocialChatNotifications";
import {
  clearFriendsCache,
  FriendsApiError,
  removeFriend as removeFriendApi,
  respondFriendRequest as respondFriendRequestApi,
  searchUsersByUsername,
  sendFriendRequest as sendFriendRequestApi,
  type FriendSearchResult,
} from "@/react-app/services/friendsService";
import {
  blockSocialUser,
  clearSocialChatCache,
  fetchSocialConversationMessages,
  fetchSocialHubBundle,
  listSocialConversationMedia,
  markSocialConversationRead,
  muteSocialConversation,
  sendSocialConversationMessage,
  SocialChatApiError,
  startDirectSocialConversation,
  uploadSocialConversationMedia,
} from "@/react-app/services/socialChatService";
import { cn } from "@/react-app/utils";
import { isExpectedApiCancellation } from "@/react-app/utils/api";
import type {
  SocialConversationMessage,
  SocialConversationMessageMedia,
  SocialConversationPreview,
  SocialHubBundle,
  SocialHubFriendItem,
  SocialHubFriendRequest,
} from "@/shared/types";

const HUB_REFRESH_INTERVAL_MS = 20_000;
const ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS = 10_000;
const SEARCH_DEBOUNCE_MS = 280;
const EMPTY_HUB_BUNDLE: SocialHubBundle = {
  friends: [],
  pending_requests: [],
};

type HeaderIconButtonProps = {
  icon: typeof Bell;
  label: string;
  onClick: () => void;
  badge?: number;
  disabled?: boolean;
};

type FriendRowProps = {
  friend: SocialHubFriendItem;
  active: boolean;
  busy: boolean;
  onClick: () => void;
};

type ConversationBubbleProps = {
  message: SocialConversationMessage;
};

type PendingRequestRowProps = {
  request: SocialHubFriendRequest;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
};

type SearchResultRowProps = {
  result: FriendSearchResult;
  busy: boolean;
  sent: boolean;
  onSend: () => void;
};

type ActionsMenuAnchor = "list" | "thread";

function getFriendDisplayName(friend: Pick<SocialHubFriendItem, "friend_full_name" | "friend_username">): string {
  return friend.friend_full_name.trim() || friend.friend_username;
}

function parseConversationId(value: string | null): number | null {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function formatConversationListTime(value: string | null | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  if (sameDay) {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.max(1, Math.floor(diffDays / 7))}w`;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatBubbleTimestamp(value: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function describeMessagePreview(message: Pick<SocialConversationMessage, "message_kind" | "message_text">): string {
  if (message.message_kind === "image") {
    return message.message_text.trim() || "Imagem";
  }
  return message.message_text.trim();
}

function matchesFriendQuery(friend: SocialHubFriendItem, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  const haystack = [
    friend.friend_full_name,
    friend.friend_username,
    friend.last_message_preview ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}

function sortHubFriends(friends: readonly SocialHubFriendItem[]): SocialHubFriendItem[] {
  return [...friends].sort((left, right) => {
    const rightActivity = Date.parse(right.last_message_at ?? "");
    const leftActivity = Date.parse(left.last_message_at ?? "");

    const rightHasActivity = Number.isFinite(rightActivity);
    const leftHasActivity = Number.isFinite(leftActivity);
    if (rightHasActivity && leftHasActivity && rightActivity !== leftActivity) {
      return rightActivity - leftActivity;
    }
    if (rightHasActivity !== leftHasActivity) {
      return rightHasActivity ? 1 : -1;
    }

    if (left.unread_count !== right.unread_count) {
      return right.unread_count - left.unread_count;
    }
    if (left.is_online !== right.is_online) {
      return left.is_online ? -1 : 1;
    }

    return getFriendDisplayName(left).localeCompare(getFriendDisplayName(right), "pt-BR", {
      sensitivity: "base",
    });
  });
}

function updateHubFriend(
  bundle: SocialHubBundle,
  friendUserId: string,
  updater: (friend: SocialHubFriendItem) => SocialHubFriendItem,
): SocialHubBundle {
  return {
    ...bundle,
    friends: bundle.friends.map((friend) =>
      friend.friend_user_id === friendUserId ? updater(friend) : friend,
    ),
  };
}

function removeHubFriend(bundle: SocialHubBundle, friendUserId: string): SocialHubBundle {
  return {
    ...bundle,
    friends: bundle.friends.filter((friend) => friend.friend_user_id !== friendUserId),
  };
}

function applyConversationPreviewToFriend(
  bundle: SocialHubBundle,
  friendUserId: string,
  conversation: SocialConversationPreview | null,
  message?: SocialConversationMessage | null,
): SocialHubBundle {
  return updateHubFriend(bundle, friendUserId, (friend) => ({
    ...friend,
    direct_conversation_id: conversation?.id ?? friend.direct_conversation_id ?? null,
    unread_count: Math.max(0, Number(conversation?.unread_count ?? 0)),
    last_message_preview:
      conversation?.last_message_preview ??
      (message ? describeMessagePreview(message) : friend.last_message_preview),
    last_message_at: conversation?.last_message_at ?? message?.created_at ?? friend.last_message_at,
    notifications_muted: conversation?.notifications_muted ?? friend.notifications_muted,
  }));
}

function upsertConversationMessage(
  messages: readonly SocialConversationMessage[],
  incoming: SocialConversationMessage,
): SocialConversationMessage[] {
  const existing = messages.find((message) => message.id === incoming.id);
  if (existing) {
    return messages.map((message) => (message.id === incoming.id ? incoming : message));
  }

  return [...messages, incoming].sort((left, right) => left.id - right.id);
}

function HeaderIconButton({ icon: Icon, label, onClick, badge = 0, disabled = false }: HeaderIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="fl-social-hub-icon-button relative flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-45"
      aria-label={label}
      title={label}
    >
      <Icon className="h-4.5 w-4.5" />
      {badge > 0 ? (
        <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--fl-color-text)] px-1 text-[10px] font-black text-[color:var(--app-bg-color)]">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}

function FriendPresenceAvatar({
  src,
  name,
  isOnline,
  className,
}: {
  src: string | null | undefined;
  name: string;
  isOnline: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <Avatar src={src ?? null} name={name} className="h-14 w-14 border border-[color:var(--fl-social-hub-muted-border)]" />
      <span
        className={cn(
          "absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[color:var(--fl-social-hub-card-bg)]",
          isOnline ? "bg-[#1ec96b]" : "bg-[#c7c7c7]",
        )}
        aria-hidden="true"
      />
    </div>
  );
}

function FriendRow({ friend, active, busy, onClick }: FriendRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "flex w-full items-center gap-3 border-b border-[color:var(--fl-social-hub-muted-border)] px-1 py-4 text-left transition-colors",
        active ? "rounded-[1.6rem] bg-black/[0.06] px-3" : "hover:bg-black/[0.03]",
        busy ? "cursor-wait opacity-70" : "",
      )}
    >
      <FriendPresenceAvatar
        src={friend.friend_avatar_url}
        name={getFriendDisplayName(friend)}
        isOnline={friend.is_online}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[1rem] font-semibold text-[color:var(--fl-color-text)]">
              {getFriendDisplayName(friend)}
            </p>
            <p className="truncate text-[0.84rem] text-[color:var(--fl-color-text-muted)]">
              {friend.last_message_preview?.trim() || `@${friend.friend_username}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="text-[0.68rem] font-medium text-[color:var(--fl-color-text-muted)]">
              {formatConversationListTime(friend.last_message_at)}
            </span>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-[color:var(--fl-color-text-muted)]" />
            ) : friend.unread_count > 0 ? (
              <span className="flex min-h-6 min-w-6 items-center justify-center rounded-full bg-[color:var(--fl-color-text)] px-1 text-[0.7rem] font-black text-[color:var(--app-bg-color)]">
                {friend.unread_count > 9 ? "9+" : friend.unread_count}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function PendingRequestRow({ request, busy, onAccept, onReject }: PendingRequestRowProps) {
  return (
    <div className="fl-social-hub-soft-card flex items-center gap-3 rounded-[1.6rem] px-4 py-3">
      <Avatar
        src={request.friend_avatar_url}
        name={request.friend_full_name || request.friend_username}
        className="h-12 w-12 border border-[color:var(--fl-social-hub-muted-border)]"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[color:var(--fl-color-text)]">
          {request.friend_full_name || request.friend_username}
        </p>
        <p className="truncate text-[0.8rem] text-[color:var(--fl-color-text-muted)]">@{request.friend_username}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="fl-social-hub-icon-button flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-[1.02] disabled:opacity-50"
          aria-label={`Recusar solicitacao de ${request.friend_username}`}
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--fl-color-text)] text-[color:var(--app-bg-color)] transition-transform hover:scale-[1.02] disabled:opacity-50"
          aria-label={`Aceitar solicitacao de ${request.friend_username}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function SearchResultRow({ result, busy, sent, onSend }: SearchResultRowProps) {
  return (
    <div className="fl-social-hub-soft-card flex items-center gap-3 rounded-[1.6rem] px-4 py-3">
      <Avatar
        src={result.avatar_url}
        name={result.full_name || result.username}
        className="h-12 w-12 border border-[color:var(--fl-social-hub-muted-border)]"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[color:var(--fl-color-text)]">
          {result.full_name || result.username}
        </p>
        <p className="truncate text-[0.8rem] text-[color:var(--fl-color-text-muted)]">@{result.username}</p>
      </div>
      <button
        type="button"
        onClick={onSend}
        disabled={busy || sent}
        className="rounded-full bg-[color:var(--fl-color-text)] px-4 py-2 text-[0.72rem] font-black uppercase tracking-[0.16em] text-[color:var(--app-bg-color)] transition-transform hover:scale-[1.02] disabled:cursor-default disabled:opacity-40"
      >
        {busy ? "..." : sent ? "Enviado" : "Adicionar"}
      </button>
    </div>
  );
}

function ConversationActionsMenu({
  activeFriend,
  onOpenMediaLibrary,
  onToggleMute,
  onRemoveFriend,
  onBlockFriend,
}: {
  activeFriend: SocialHubFriendItem;
  onOpenMediaLibrary: () => void;
  onToggleMute: () => void;
  onRemoveFriend: () => void;
  onBlockFriend: () => void;
}) {
  return (
    <div className="fl-social-hub-menu absolute right-0 top-[calc(100%+0.65rem)] z-20 w-[16rem] rounded-[1.6rem] p-2.5">
      <button
        type="button"
        onClick={onOpenMediaLibrary}
        className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium text-[color:var(--fl-color-text)] transition-colors hover:bg-black/[0.04]"
      >
        <ImageIcon className="h-4 w-4" />
        Midia
      </button>
      <button
        type="button"
        onClick={onToggleMute}
        className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium text-[color:var(--fl-color-text)] transition-colors hover:bg-black/[0.04]"
      >
        {activeFriend.notifications_muted ? (
          <Volume2 className="h-4 w-4" />
        ) : (
          <VolumeX className="h-4 w-4" />
        )}
        {activeFriend.notifications_muted ? "Ativar notificacoes" : "Silenciar notificacoes"}
      </button>
      <button
        type="button"
        onClick={onRemoveFriend}
        className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium text-[color:var(--fl-color-text)] transition-colors hover:bg-black/[0.04]"
      >
        <UserMinus className="h-4 w-4" />
        Desfazer amizade
      </button>
      <button
        type="button"
        onClick={onBlockFriend}
        className="fl-social-hub-danger-action flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium transition-colors"
      >
        <ShieldBan className="h-4 w-4" />
        Bloquear usuario
      </button>
    </div>
  );
}

function ConversationBubble({ message }: ConversationBubbleProps) {
  return (
    <div className={cn("flex w-full", message.is_own_message ? "justify-end" : "justify-start")}>
      <div className="max-w-[82%]">
        {message.media?.public_url ? (
          <div
            className={cn(
              "overflow-hidden rounded-[1.8rem] border",
              message.is_own_message
                ? "border-transparent fl-social-hub-bubble-own"
                : "border-[color:var(--fl-social-hub-muted-border)] fl-social-hub-bubble-other",
            )}
          >
            <img
              src={message.media.public_url}
              alt="Midia compartilhada"
              className="max-h-[18rem] w-full object-cover"
              loading="lazy"
            />
            {message.message_text.trim() ? (
              <p className="px-4 pb-4 pt-3 text-sm leading-relaxed">{message.message_text}</p>
            ) : null}
          </div>
        ) : (
          <div
            className={cn(
              "rounded-[1.6rem] px-4 py-3 text-[0.95rem] leading-relaxed",
              message.is_own_message
                ? "fl-social-hub-bubble-own"
                : "fl-social-hub-bubble-other",
            )}
          >
            {message.message_text}
          </div>
        )}
        <div
          className={cn(
            "mt-1 px-1 text-[0.68rem] font-medium",
            message.is_own_message
              ? "text-right text-[color:var(--fl-color-text-muted)]"
              : "text-left text-[color:var(--fl-color-text-muted)]",
          )}
        >
          {formatBubbleTimestamp(message.created_at)}
        </div>
      </div>
    </div>
  );
}

export default function Friends() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { refreshSocialChatNotifications } = useSocialChatNotifications();
  const requestedConversationId = parseConversationId(searchParams.get("conversationId"));

  const [hub, setHub] = useState<SocialHubBundle>(EMPTY_HUB_BUNDLE);
  const [loadingHub, setLoadingHub] = useState(true);
  const [hubError, setHubError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const [remoteResults, setRemoteResults] = useState<FriendSearchResult[]>([]);
  const [remoteSearchLoading, setRemoteSearchLoading] = useState(false);
  const [selectedFriendUserId, setSelectedFriendUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SocialConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [openingConversationUserId, setOpeningConversationUserId] = useState<string | null>(null);
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);
  const [actionsMenuAnchor, setActionsMenuAnchor] = useState<ActionsMenuAnchor | null>(null);
  const [mediaModalOpen, setMediaModalOpen] = useState(false);
  const [mediaItems, setMediaItems] = useState<SocialConversationMessageMedia[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [requestActionUserId, setRequestActionUserId] = useState<string | null>(null);
  const [sendingRequestUserId, setSendingRequestUserId] = useState<string | null>(null);
  const [sentRequestUserIds, setSentRequestUserIds] = useState<Set<string>>(() => new Set());
  const [threadConversationId, setThreadConversationId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const lastReadMarkerRef = useRef<string>("");

  const sortedFriends = useMemo(() => sortHubFriends(hub.friends), [hub.friends]);
  const filteredFriends = useMemo(
    () => sortedFriends.filter((friend) => matchesFriendQuery(friend, deferredSearchQuery.toLowerCase())),
    [deferredSearchQuery, sortedFriends],
  );

  const activeFriend = useMemo(
    () => hub.friends.find((friend) => friend.friend_user_id === selectedFriendUserId) ?? null,
    [hub.friends, selectedFriendUserId],
  );
  const activeConversationId = activeFriend?.direct_conversation_id ?? null;
  const activeFriendDisplayName = activeFriend ? getFriendDisplayName(activeFriend) : "";
  const isConversationOpen = activeFriend !== null;

  const friendUserIds = useMemo(
    () => new Set(hub.friends.map((friend) => friend.friend_user_id)),
    [hub.friends],
  );
  const pendingRequestUserIds = useMemo(
    () => new Set(hub.pending_requests.map((request) => request.friend_user_id)),
    [hub.pending_requests],
  );

  const visibleRemoteResults = useMemo(
    () =>
      remoteResults.filter((result) =>
        !friendUserIds.has(result.user_id) &&
        !pendingRequestUserIds.has(result.user_id),
      ),
    [friendUserIds, pendingRequestUserIds, remoteResults],
  );

  const setConversationParam = useCallback((conversationId: number | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (conversationId && conversationId > 0) {
      nextParams.set("conversationId", String(conversationId));
    } else {
      nextParams.delete("conversationId");
    }
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const toggleActionsMenu = useCallback((anchor: ActionsMenuAnchor) => {
    setActionsMenuAnchor((current) => (current === anchor ? null : anchor));
  }, []);

  const handleServiceError = useCallback((error: unknown, fallbackMessage: string): string | null => {
    if (isExpectedApiCancellation(error)) {
      return null;
    }
    if (error instanceof FriendsApiError || error instanceof SocialChatApiError) {
      return error.message || fallbackMessage;
    }
    return fallbackMessage;
  }, []);

  const applyServiceError = useCallback((
    setErrorState: Dispatch<SetStateAction<string | null>>,
    error: unknown,
    fallbackMessage: string,
  ) => {
    const message = handleServiceError(error, fallbackMessage);
    if (message) {
      setErrorState(message);
    }
  }, [handleServiceError]);

  const loadHub = useCallback(async (forceRefresh = false) => {
    try {
      setHubError(null);
      const payload = await fetchSocialHubBundle({ forceRefresh });
      setHub(payload);
    } catch (error) {
      applyServiceError(setHubError, error, "Nao foi possivel carregar o Social Hub agora.");
    } finally {
      setLoadingHub(false);
    }
  }, [applyServiceError]);

  const refreshActiveConversation = useCallback(async (options?: { quiet?: boolean }) => {
    if (!activeConversationId || !activeFriend) {
      setMessages([]);
      setThreadConversationId(null);
      return;
    }

    if (!options?.quiet) {
      setMessagesLoading(true);
    }

    try {
      setThreadError(null);
      const payload = await fetchSocialConversationMessages(activeConversationId, { limit: 60 });
      setMessages(payload.messages);
      setThreadConversationId(activeConversationId);
      setHub((current) =>
        applyConversationPreviewToFriend(
          current,
          activeFriend.friend_user_id,
          payload.conversation,
          payload.messages[payload.messages.length - 1] ?? null,
        ),
      );

      const lastMessage = payload.messages[payload.messages.length - 1] ?? null;
      if (lastMessage && !lastMessage.is_own_message) {
        const marker = `${activeConversationId}:${lastMessage.id}`;
        if (lastReadMarkerRef.current !== marker) {
          lastReadMarkerRef.current = marker;
          void markSocialConversationRead(activeConversationId, {
            last_read_message_id: lastMessage.id,
          })
            .then(() => {
              setHub((current) =>
                updateHubFriend(current, activeFriend.friend_user_id, (friend) => ({
                  ...friend,
                  unread_count: 0,
                })),
              );
              void refreshSocialChatNotifications({ force: true });
            })
            .catch(() => {
              lastReadMarkerRef.current = "";
            });
        }
      }
    } catch (error) {
      applyServiceError(setThreadError, error, "Nao foi possivel carregar esta conversa agora.");
    } finally {
      setMessagesLoading(false);
    }
  }, [activeConversationId, activeFriend, applyServiceError, refreshSocialChatNotifications]);

  const openFriendConversation = useCallback(async (friend: SocialHubFriendItem) => {
    if (friend.direct_conversation_id) {
      startTransition(() => {
        setSelectedFriendUserId(friend.friend_user_id);
      });
      setConversationParam(friend.direct_conversation_id);
      setActionsMenuAnchor(null);
      return;
    }

    setOpeningConversationUserId(friend.friend_user_id);
    setHubError(null);

    try {
      const conversation = await startDirectSocialConversation({
        friend_user_id: friend.friend_user_id,
      });

      setHub((current) =>
        applyConversationPreviewToFriend(current, friend.friend_user_id, conversation),
      );

      startTransition(() => {
        setSelectedFriendUserId(friend.friend_user_id);
      });
      setConversationParam(conversation.id);
    } catch (error) {
      applyServiceError(setHubError, error, "Nao foi possivel abrir a conversa agora.");
    } finally {
      setOpeningConversationUserId((current) =>
        current === friend.friend_user_id ? null : current,
      );
    }
  }, [applyServiceError, setConversationParam]);

  const loadConversationMedia = useCallback(async () => {
    if (!activeConversationId) return;

    setMediaLoading(true);
    setMediaError(null);

    try {
      const payload = await listSocialConversationMedia(activeConversationId, { limit: 120 });
      setMediaItems(payload);
    } catch (error) {
      applyServiceError(setMediaError, error, "Nao foi possivel carregar a midia desta conversa.");
    } finally {
      setMediaLoading(false);
    }
  }, [activeConversationId, applyServiceError]);

  useEffect(() => {
    void loadHub(true);
  }, [loadHub]);

  useEffect(() => {
    const refreshVisibleHub = () => {
      if (document.visibilityState !== "visible") return;
      if (activeConversationId) return;
      void loadHub(true);
    };

    const intervalId = window.setInterval(() => {
      refreshVisibleHub();
    }, HUB_REFRESH_INTERVAL_MS);

    window.addEventListener("focus", refreshVisibleHub);
    document.addEventListener("visibilitychange", refreshVisibleHub);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshVisibleHub);
      document.removeEventListener("visibilitychange", refreshVisibleHub);
    };
  }, [activeConversationId, loadHub]);

  useEffect(() => {
    if (requestedConversationId === null) {
      return;
    }

    const requestedFriend = hub.friends.find(
      (friend) => friend.direct_conversation_id === requestedConversationId,
    );

    if (requestedFriend) {
      if (selectedFriendUserId !== requestedFriend.friend_user_id) {
        startTransition(() => {
          setSelectedFriendUserId(requestedFriend.friend_user_id);
        });
      }
      return;
    }

    if (!loadingHub) {
      setConversationParam(null);
    }
  }, [hub.friends, loadingHub, requestedConversationId, selectedFriendUserId, setConversationParam]);

  useEffect(() => {
    if (!selectedFriendUserId) return;
    const stillExists = hub.friends.some((friend) => friend.friend_user_id === selectedFriendUserId);
    if (stillExists) return;

    setSelectedFriendUserId(null);
    setMessages([]);
    setThreadConversationId(null);
    setActionsMenuAnchor(null);
    setMediaModalOpen(false);
    setConversationParam(null);
  }, [hub.friends, selectedFriendUserId, setConversationParam]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setThreadConversationId(null);
      return;
    }

    lastReadMarkerRef.current = "";
    void refreshActiveConversation();
  }, [activeConversationId, refreshActiveConversation]);

  useEffect(() => {
    if (!activeConversationId) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshActiveConversation({ quiet: true });
    }, ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeConversationId, refreshActiveConversation]);

  useEffect(() => {
    if (!mediaModalOpen) return;
    void loadConversationMedia();
  }, [loadConversationMedia, mediaModalOpen]);

  useEffect(() => {
    if (!threadEndRef.current || threadConversationId !== activeConversationId) return;
    threadEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeConversationId, messages, threadConversationId]);

  useEffect(() => {
    const normalizedQuery = deferredSearchQuery;
    const hasExactFriendMatch = filteredFriends.some((friend) => {
      const username = friend.friend_username.trim().toLowerCase();
      const fullName = friend.friend_full_name.trim().toLowerCase();
      const normalized = normalizedQuery.toLowerCase();
      return username === normalized || fullName === normalized;
    });

    if (normalizedQuery.length < 3 || hasExactFriendMatch) {
      setRemoteResults([]);
      setRemoteSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setRemoteSearchLoading(true);
      searchUsersByUsername(normalizedQuery)
        .then((payload) => {
          if (cancelled) return;
          setRemoteResults(payload);
        })
        .catch(() => {
          if (cancelled) return;
          setRemoteResults([]);
        })
        .finally(() => {
          if (cancelled) return;
          setRemoteSearchLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deferredSearchQuery, filteredFriends]);

  useEffect(() => {
    setMessageInput("");
    setThreadError(null);
  }, [activeConversationId]);

  useEffect(() => {
    if (!actionsMenuAnchor) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setActionsMenuAnchor(null);
        return;
      }

      if (target.closest("[data-social-hub-actions-root]")) {
        return;
      }

      setActionsMenuAnchor(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [actionsMenuAnchor]);

  const handleSendFriendRequest = useCallback(async (result: FriendSearchResult) => {
    setSendingRequestUserId(result.user_id);
    setHubError(null);

    try {
      await sendFriendRequestApi(result.user_id);
      setSentRequestUserIds((current) => {
        const next = new Set(current);
        next.add(result.user_id);
        return next;
      });
    } catch (error) {
      applyServiceError(setHubError, error, "Nao foi possivel enviar a solicitacao.");
    } finally {
      setSendingRequestUserId((current) => (current === result.user_id ? null : current));
    }
  }, [applyServiceError]);

  const handleRespondRequest = useCallback(async (request: SocialHubFriendRequest, accept: boolean) => {
    setRequestActionUserId(request.friend_user_id);
    setHubError(null);

    try {
      await respondFriendRequestApi(request.id, accept);
      clearSocialChatCache();
      clearFriendsCache();
      await loadHub(true);
    } catch (error) {
      applyServiceError(setHubError, error, "Nao foi possivel responder a solicitacao.");
    } finally {
      setRequestActionUserId((current) => (current === request.friend_user_id ? null : current));
    }
  }, [applyServiceError, loadHub]);

  const handleSubmitMessage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeConversationId || !activeFriend) return;

    const normalized = messageInput.trim();
    if (!normalized) return;

    setSendingMessage(true);
    setThreadError(null);

    try {
      const payload = await sendSocialConversationMessage(activeConversationId, {
        message_text: normalized,
      });
      setMessageInput("");
      setMessages((current) => upsertConversationMessage(current, payload.message));
      setHub((current) =>
        applyConversationPreviewToFriend(
          current,
          activeFriend.friend_user_id,
          payload.conversation,
          payload.message,
        ),
      );
      void refreshSocialChatNotifications({ force: true });
    } catch (error) {
      applyServiceError(setThreadError, error, "Nao foi possivel enviar a mensagem.");
    } finally {
      setSendingMessage(false);
    }
  }, [
    activeConversationId,
    activeFriend,
    applyServiceError,
    messageInput,
    refreshSocialChatNotifications,
  ]);

  const handleFileSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file || !activeConversationId || !activeFriend) return;

    setUploadingMedia(true);
    setThreadError(null);

    try {
      const payload = await uploadSocialConversationMedia(activeConversationId, {
        file,
      });
      setMessages((current) => upsertConversationMessage(current, payload.message));
      setHub((current) =>
        applyConversationPreviewToFriend(
          current,
          activeFriend.friend_user_id,
          payload.conversation,
          payload.message,
        ),
      );
      void refreshSocialChatNotifications({ force: true });
    } catch (error) {
      applyServiceError(setThreadError, error, "Nao foi possivel enviar a imagem.");
    } finally {
      setUploadingMedia(false);
    }
  }, [activeConversationId, activeFriend, applyServiceError, refreshSocialChatNotifications]);

  const handleToggleMute = useCallback(async () => {
    if (!activeConversationId || !activeFriend) return;

    setActionsMenuAnchor(null);
    setThreadError(null);

    try {
      const payload = await muteSocialConversation(activeConversationId, {
        muted: !activeFriend.notifications_muted,
      });

      setHub((current) =>
        updateHubFriend(current, activeFriend.friend_user_id, (friend) => ({
          ...friend,
          notifications_muted: payload.muted,
        })),
      );
    } catch (error) {
      applyServiceError(setThreadError, error, "Nao foi possivel atualizar o silencio desta conversa.");
    }
  }, [activeConversationId, activeFriend, applyServiceError]);

  const handleRemoveFriend = useCallback(async () => {
    if (!activeFriend) return;

    const confirmed = window.confirm(
      `Desfazer amizade com ${getFriendDisplayName(activeFriend)}? O chat ficara somente como historico.`,
    );
    if (!confirmed) return;

    setActionsMenuAnchor(null);
    setHubError(null);

    try {
      await removeFriendApi(activeFriend.friend_user_id);
      clearSocialChatCache();
      setHub((current) => removeHubFriend(current, activeFriend.friend_user_id));
      setSelectedFriendUserId(null);
      setMessages([]);
      setConversationParam(null);
    } catch (error) {
      applyServiceError(setHubError, error, "Nao foi possivel desfazer esta amizade.");
    }
  }, [activeFriend, applyServiceError, setConversationParam]);

  const handleBlockFriend = useCallback(async () => {
    if (!activeFriend) return;

    const confirmed = window.confirm(
      `Bloquear ${getFriendDisplayName(activeFriend)}? Isso desfaz a amizade e impede novas mensagens.`,
    );
    if (!confirmed) return;

    setActionsMenuAnchor(null);
    setHubError(null);

    try {
      await blockSocialUser(activeFriend.friend_user_id);
      clearFriendsCache();
      setHub((current) => removeHubFriend(current, activeFriend.friend_user_id));
      setSelectedFriendUserId(null);
      setMessages([]);
      setConversationParam(null);
      void refreshSocialChatNotifications({ force: true });
    } catch (error) {
      applyServiceError(setHubError, error, "Nao foi possivel bloquear este usuario.");
    }
  }, [activeFriend, applyServiceError, refreshSocialChatNotifications, setConversationParam]);

  const handleOpenMediaLibrary = useCallback(() => {
    if (!activeConversationId) return;
    setActionsMenuAnchor(null);
    setMediaModalOpen(true);
  }, [activeConversationId]);

  if (loadingHub) {
    return (
      <AppPageShell bottomNavActive="arena" className="fl-theme-page fl-social-hub-page">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <LoadingBall size="md" />
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell
      bottomNavActive="arena"
      className="fl-theme-page fl-social-hub-page"
      hideNavigation={isConversationOpen}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          isConversationOpen ? "overflow-hidden" : "p-4 pb-[98px] md:px-8 md:pb-8",
        )}
      >
        <div
          className={cn(
            "flex min-h-0 w-full flex-1",
            isConversationOpen ? "" : "mx-auto max-w-[78rem] gap-4 md:gap-6",
          )}
        >
          <section
            className={cn(
              "fl-social-hub-panel min-h-0 w-full shrink-0 px-5 pb-5 pt-4 md:max-w-[24rem] md:px-6 md:pb-6",
              isConversationOpen ? "hidden" : "flex rounded-[2.25rem]",
              "flex-col",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-[1.7rem] font-semibold tracking-[-0.04em] text-[color:var(--fl-color-text)]">
                  Messages
                </h1>
                <p className="mt-1 text-[0.8rem] text-[color:var(--fl-color-text-muted)]">Social Hub</p>
              </div>
              <div className="flex items-center gap-2">
                <HeaderIconButton
                  icon={Bell}
                  label="Abrir solicitacoes recebidas"
                  onClick={() => {
                    setNotificationModalOpen(true);
                    setActionsMenuAnchor(null);
                  }}
                  badge={hub.pending_requests.length}
                />
                <div className="relative" data-social-hub-actions-root>
                  <HeaderIconButton
                    icon={MoreVertical}
                    label="Abrir acoes da conversa"
                    onClick={() => {
                      if (!activeFriend) return;
                      toggleActionsMenu("list");
                      setNotificationModalOpen(false);
                    }}
                    disabled={!activeFriend}
                  />
                  {actionsMenuAnchor === "list" && activeFriend ? (
                    <ConversationActionsMenu
                      activeFriend={activeFriend}
                      onOpenMediaLibrary={handleOpenMediaLibrary}
                      onToggleMute={handleToggleMute}
                      onRemoveFriend={handleRemoveFriend}
                      onBlockFriend={handleBlockFriend}
                    />
                  ) : null}
                </div>
              </div>
            </div>

            <div className="relative mt-5">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--fl-color-text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                }}
                placeholder="Search chats"
                className="fl-social-hub-search h-12 w-full rounded-full pl-11 pr-4 text-sm outline-none transition-colors"
              />
            </div>

            {hubError ? (
              <div className="mt-4 rounded-[1.4rem] border border-[#ef4444]/20 bg-[#ef4444]/[0.08] px-4 py-3 text-sm text-[#b42318]">
                {hubError}
              </div>
            ) : null}

            <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
              {filteredFriends.length > 0 ? (
                <div>
                  {filteredFriends.map((friend) => (
                    <FriendRow
                      key={friend.friend_user_id}
                      friend={friend}
                      active={friend.friend_user_id === activeFriend?.friend_user_id}
                      busy={openingConversationUserId === friend.friend_user_id}
                      onClick={() => {
                        void openFriendConversation(friend);
                      }}
                    />
                  ))}
                </div>
              ) : hub.friends.length > 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                  <p className="text-base font-semibold text-[color:var(--fl-color-text)]">Nada por aqui</p>
                  <p className="mt-2 max-w-[15rem] text-sm leading-relaxed text-[color:var(--fl-color-text-muted)]">
                    Ajuste a busca para encontrar um amigo ou procurar alguem novo.
                  </p>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                  <MessageCircle className="h-10 w-10 text-[color:var(--fl-color-text-muted)] opacity-40" />
                  <p className="mt-4 text-base font-semibold text-[color:var(--fl-color-text)]">Seu chat comeca aqui</p>
                  <p className="mt-2 max-w-[15rem] text-sm leading-relaxed text-[color:var(--fl-color-text-muted)]">
                    Busque por um username para mandar a primeira solicitacao e iniciar uma conversa.
                  </p>
                </div>
              )}

              {(visibleRemoteResults.length > 0 || remoteSearchLoading) && deferredSearchQuery.length >= 3 ? (
                <div className="mt-6 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[0.72rem] font-black uppercase tracking-[0.18em] text-[color:var(--fl-color-text-muted)]">
                      Encontrar pessoas
                    </p>
                    {remoteSearchLoading ? <Loader2 className="h-4 w-4 animate-spin text-[color:var(--fl-color-text-muted)]" /> : null}
                  </div>
                  {visibleRemoteResults.map((result) => (
                    <SearchResultRow
                      key={result.user_id}
                      result={result}
                      busy={sendingRequestUserId === result.user_id}
                      sent={sentRequestUserIds.has(result.user_id)}
                      onSend={() => {
                        void handleSendFriendRequest(result);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section
            className={cn(
              "fl-social-hub-thread-panel min-h-0 flex-1 overflow-hidden",
              isConversationOpen ? "flex rounded-none border-0 shadow-none" : "hidden rounded-[2.25rem] md:flex",
              "flex-col overflow-hidden",
            )}
          >
            {activeFriend ? (
              <>
                <header
                  className={cn(
                    "fl-social-hub-thread-header flex items-center gap-3 border-b px-4 py-4",
                    isConversationOpen ? "md:px-8" : "md:px-6",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFriendUserId(null);
                      setMessages([]);
                      setThreadConversationId(null);
                      setActionsMenuAnchor(null);
                      setConversationParam(null);
                    }}
                    className="fl-social-hub-icon-button flex h-10 w-10 items-center justify-center rounded-full"
                    aria-label="Voltar para a lista"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <FriendPresenceAvatar
                    src={activeFriend.friend_avatar_url}
                    name={activeFriendDisplayName}
                    isOnline={activeFriend.is_online}
                    className="shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[color:var(--fl-color-text)] md:text-base">
                      {activeFriendDisplayName}
                    </p>
                    <p className="truncate text-[0.78rem] text-[color:var(--fl-color-text-muted)]">
                      @{activeFriend.friend_username}
                    </p>
                  </div>

                  <div className="relative" data-social-hub-actions-root>
                    <HeaderIconButton
                      icon={MoreVertical}
                      label="Abrir acoes da conversa"
                      onClick={() => {
                        toggleActionsMenu("thread");
                        setNotificationModalOpen(false);
                      }}
                    />
                    {actionsMenuAnchor === "thread" && activeFriend ? (
                      <ConversationActionsMenu
                        activeFriend={activeFriend}
                        onOpenMediaLibrary={handleOpenMediaLibrary}
                        onToggleMute={handleToggleMute}
                        onRemoveFriend={handleRemoveFriend}
                        onBlockFriend={handleBlockFriend}
                      />
                    ) : null}
                  </div>
                </header>

                <div
                  className={cn(
                    "min-h-0 flex-1 overflow-y-auto px-4 py-5",
                    isConversationOpen ? "md:px-8 md:py-7" : "md:px-6 md:py-6",
                  )}
                >
                  {threadError ? (
                    <div className="mb-4 rounded-[1.4rem] border border-[#ef4444]/20 bg-[#ef4444]/[0.08] px-4 py-3 text-sm text-[#b42318]">
                      {threadError}
                    </div>
                  ) : null}

                  {messagesLoading && threadConversationId !== activeConversationId ? (
                    <div className="flex h-full items-center justify-center">
                      <LoadingBall size="sm" />
                    </div>
                  ) : messages.length > 0 ? (
                    <div className="space-y-4">
                      {messages.map((message) => (
                        <ConversationBubble key={message.id} message={message} />
                      ))}
                      <div ref={threadEndRef} />
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                      <MessageCircle className="h-10 w-10 text-[color:var(--fl-color-text-muted)] opacity-40" />
                      <p className="mt-4 text-base font-semibold text-[color:var(--fl-color-text)]">Conversa pronta</p>
                      <p className="mt-2 max-w-[19rem] text-sm leading-relaxed text-[color:var(--fl-color-text-muted)]">
                        Escreva a primeira mensagem para abrir esse chat com {activeFriendDisplayName}.
                      </p>
                    </div>
                  )}
                </div>

                <div
                  className={cn(
                    "fl-social-hub-composer-shell border-t px-4 py-4",
                    isConversationOpen ? "md:px-8" : "md:px-6",
                  )}
                >
                  <form onSubmit={handleSubmitMessage} className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        fileInputRef.current?.click();
                      }}
                      disabled={!activeConversationId || uploadingMedia}
                      className="fl-social-hub-icon-button flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-[1.02] disabled:opacity-45"
                      aria-label="Enviar imagem"
                    >
                      {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <CirclePlus className="h-5 w-5" />}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={handleFileSelection}
                    />

                    <div className="flex min-w-0 flex-1 items-center rounded-full border border-[color:var(--fl-social-hub-input-border)] bg-[color:var(--fl-social-hub-input-bg)] px-4">
                      <input
                        type="text"
                        value={messageInput}
                        onChange={(event) => {
                          setMessageInput(event.target.value);
                        }}
                        placeholder="Message"
                        className="fl-social-hub-composer-input h-12 min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={!activeConversationId || sendingMessage || messageInput.trim().length === 0}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:var(--fl-color-text)] text-[color:var(--app-bg-color)] transition-transform hover:scale-[1.02] disabled:opacity-45"
                      aria-label="Enviar mensagem"
                    >
                      {sendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <MessageCircle className="h-12 w-12 text-[color:var(--fl-color-text-muted)] opacity-35" />
                <p className="mt-5 text-lg font-semibold text-[color:var(--fl-color-text)]">Selecione um amigo</p>
                <p className="mt-2 max-w-[24rem] text-sm leading-relaxed text-[color:var(--fl-color-text-muted)]">
                  Escolha um contato da lista para abrir o chat. Os pedidos recebidos ficam no sino e o menu de acoes aparece ao lado dele.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      {notificationModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[color:var(--fl-social-hub-overlay)] p-4 md:items-center">
          <button
            type="button"
            onClick={() => {
              setNotificationModalOpen(false);
            }}
            className="absolute inset-0"
            aria-label="Fechar solicitacoes"
          />
          <div className="fl-social-hub-modal relative z-10 w-full max-w-[28rem] rounded-[2rem] p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-[color:var(--fl-color-text)]">Solicitacoes recebidas</p>
                <p className="mt-1 text-sm text-[color:var(--fl-color-text-muted)]">
                  Aceite ou recuse os pedidos diretamente daqui.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setNotificationModalOpen(false);
                }}
                className="fl-social-hub-icon-button flex h-10 w-10 items-center justify-center rounded-full"
                aria-label="Fechar solicitacoes"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
              {hub.pending_requests.length > 0 ? (
                hub.pending_requests.map((request) => (
                  <PendingRequestRow
                    key={request.id}
                    request={request}
                    busy={requestActionUserId === request.friend_user_id}
                    onAccept={() => {
                      void handleRespondRequest(request, true);
                    }}
                    onReject={() => {
                      void handleRespondRequest(request, false);
                    }}
                  />
                ))
              ) : (
                <div className="fl-social-hub-soft-card rounded-[1.6rem] px-4 py-5 text-center text-sm text-[color:var(--fl-color-text-muted)]">
                  Nenhum pedido novo por enquanto.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {mediaModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[color:var(--fl-social-hub-overlay)] p-4 md:items-center">
          <button
            type="button"
            onClick={() => {
              setMediaModalOpen(false);
            }}
            className="absolute inset-0"
            aria-label="Fechar galeria"
          />
          <div className="fl-social-hub-modal relative z-10 w-full max-w-[42rem] rounded-[2rem] p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-[color:var(--fl-color-text)]">Midia da conversa</p>
                <p className="mt-1 text-sm text-[color:var(--fl-color-text-muted)]">
                  Arquivos compartilhados com {activeFriendDisplayName || "este amigo"}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMediaModalOpen(false);
                }}
                className="fl-social-hub-icon-button flex h-10 w-10 items-center justify-center rounded-full"
                aria-label="Fechar galeria"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 max-h-[28rem] overflow-y-auto pr-1">
              {mediaError ? (
                <div className="rounded-[1.4rem] border border-[#ef4444]/20 bg-[#ef4444]/[0.08] px-4 py-3 text-sm text-[#b42318]">
                  {mediaError}
                </div>
              ) : mediaLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <LoadingBall size="sm" />
                </div>
              ) : mediaItems.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {mediaItems.map((item) => (
                    <a
                      key={item.id}
                      href={item.public_url}
                      target="_blank"
                      rel="noreferrer"
                      className="fl-social-hub-soft-card group overflow-hidden rounded-[1.4rem]"
                    >
                      <img
                        src={item.public_url}
                        alt="Midia da conversa"
                        className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="fl-social-hub-soft-card rounded-[1.6rem] px-4 py-10 text-center text-sm text-[color:var(--fl-color-text-muted)]">
                  Nenhuma midia foi enviada nesta conversa ainda.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </AppPageShell>
  );
}
