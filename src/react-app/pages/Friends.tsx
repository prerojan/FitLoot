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
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { useSearchParams } from "react-router";
import {
  Bell,
  Check,
  ChevronLeft,
  CirclePlus,
  Copy,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  MessageCircle,
  MoreVertical,
  PencilLine,
  Search,
  SendHorizontal,
  ShieldBan,
  Trash2,
  UserPlus,
  UserMinus,
  Users,
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
  createSocialGroupConversation,
  deleteSocialConversationMessage,
  fetchSocialConversationMessages,
  fetchSocialHubBundle,
  listSocialConversationMedia,
  markSocialConversationRead,
  muteSocialConversation,
  sendSocialConversationMessage,
  SocialChatApiError,
  startDirectSocialConversation,
  updateSocialConversationMessage,
  updateSocialPreferences,
  uploadSocialConversationMedia,
} from "@/react-app/services/socialChatService";
import { isAndroidHost } from "@/react-app/services/runtime/hostRuntime";
import { cn } from "@/react-app/utils";
import { isExpectedApiCancellation } from "@/react-app/utils/api";
import type {
  SocialConversationMessage,
  SocialConversationMessageMedia,
  SocialConversationPreview,
  SocialHubBundle,
  SocialHubFriendItem,
  SocialHubFriendRequest,
  SocialUserPreferences,
} from "@/shared/types";

const HUB_REFRESH_INTERVAL_MS = 20_000;
const ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS = 2_500;
const MAX_ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS = 15_000;
const SEARCH_DEBOUNCE_MS = 280;
const MESSAGE_GROUP_WINDOW_MS = 120_000;
const MESSAGE_LONG_PRESS_DURATION_MS = 420;
const EMPTY_HUB_BUNDLE: SocialHubBundle = {
  friends: [],
  pending_requests: [],
  groups: [],
  preferences: {
    show_online_status: true,
    allow_friend_requests: true,
    allow_group_invites: true,
  },
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

type GroupConversationRowProps = {
  conversation: SocialConversationPreview;
  active: boolean;
  onClick: () => void;
};

type ConversationListItemProps = {
  avatarSrc: string | null | undefined;
  avatarName: string;
  title: string;
  subtitle: string;
  timestamp: string | null | undefined;
  unreadCount: number;
  active: boolean;
  busy?: boolean;
  showPresence?: boolean;
  isOnline?: boolean;
  onClick: () => void;
};

type MessageActionsTarget = {
  message: SocialConversationMessage;
  anchorX: number;
  anchorY: number;
  align: "start" | "end";
};

type ConversationBubbleProps = {
  layout: ConversationBubbleLayout;
  onOpenActions: (target: MessageActionsTarget) => void;
};

type ConversationListEntry =
  | {
      kind: "direct";
      key: string;
      title: string;
      subtitle: string;
      timestamp: string | null | undefined;
      unreadCount: number;
      active: boolean;
      busy: boolean;
      avatarSrc: string | null | undefined;
      avatarName: string;
      showPresence: true;
      isOnline: boolean;
      friend: SocialHubFriendItem;
    }
  | {
      kind: "group";
      key: string;
      title: string;
      subtitle: string;
      timestamp: string | null | undefined;
      unreadCount: number;
      active: boolean;
      busy: boolean;
      avatarSrc: string | null | undefined;
      avatarName: string;
      showPresence: false;
      isOnline: false;
      conversation: SocialConversationPreview;
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

type PrivacyPreferenceRowProps = {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

type ActionsMenuAnchor = "list" | "thread";

type ActiveConversationContext = {
  conversationId: number | null;
  friendUserId: string | null;
  groupConversationId: number | null;
};

type ConversationBubbleLayout = {
  message: SocialConversationMessage;
  groupedWithPrevious: boolean;
  groupedWithNext: boolean;
  showTimestamp: boolean;
};

function getFriendDisplayName(friend: Pick<SocialHubFriendItem, "friend_full_name" | "friend_username">): string {
  return friend.friend_full_name.trim() || friend.friend_username;
}

function getGroupDisplayName(conversation: Pick<SocialConversationPreview, "display_title" | "title">): string {
  return conversation.display_title.trim() || conversation.title?.trim() || "Grupo";
}

function parseConversationId(value: string | null): number | null {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function toNonNegativeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function toNullablePositiveNumber(value: unknown): number | null {
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

function formatBubbleMeta(message: SocialConversationMessage): string {
  const timestamp = formatBubbleTimestamp(message.created_at);
  if (!timestamp) {
    return message.edited_at ? "Editada" : "";
  }
  return message.edited_at ? `${timestamp} • editada` : timestamp;
}

function describeMessagePreview(message: Pick<SocialConversationMessage, "message_kind" | "message_text">): string {
  if (message.message_kind === "image") {
    return message.message_text.trim() || "Imagem";
  }
  return message.message_text.trim();
}

function getMessageTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldGroupConversationMessages(
  previous: SocialConversationMessage | null,
  current: SocialConversationMessage,
): boolean {
  if (!previous) return false;
  if (previous.is_own_message !== current.is_own_message) return false;
  if (previous.sender_user_id !== current.sender_user_id) return false;

  const previousTime = getMessageTime(previous.created_at);
  const currentTime = getMessageTime(current.created_at);
  if (previousTime === 0 || currentTime === 0) return false;

  const delta = currentTime - previousTime;
  return delta >= 0 && delta <= MESSAGE_GROUP_WINDOW_MS;
}

function buildConversationBubbleLayouts(
  messages: readonly SocialConversationMessage[],
): ConversationBubbleLayout[] {
  return messages.map((message, index) => {
    const previous = index > 0 ? messages[index - 1] ?? null : null;
    const next = index < messages.length - 1 ? messages[index + 1] ?? null : null;
    const groupedWithPrevious = shouldGroupConversationMessages(previous, message);
    const groupedWithNext = next ? shouldGroupConversationMessages(message, next) : false;

    return {
      message,
      groupedWithPrevious,
      groupedWithNext,
      showTimestamp: !groupedWithNext,
    };
  });
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

function matchesGroupQuery(conversation: SocialConversationPreview, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  const haystack = [
    getGroupDisplayName(conversation),
    conversation.last_message_preview ?? "",
    conversation.participants.map((participant) => participant.full_name || participant.username).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}

function getConversationSortTimestamp(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function sortSocialConversations<T extends { unread_count: number; last_message_at?: string | null | undefined }>(
  items: readonly T[],
  getLabel: (item: T) => string,
): T[] {
  return [...items].sort((left, right) => {
    const rightActivity = getConversationSortTimestamp(right.last_message_at);
    const leftActivity = getConversationSortTimestamp(left.last_message_at);
    if (rightActivity !== leftActivity) {
      return rightActivity - leftActivity;
    }
    if (left.unread_count !== right.unread_count) {
      return right.unread_count - left.unread_count;
    }
    return getLabel(left).localeCompare(getLabel(right), "pt-BR", {
      sensitivity: "base",
    });
  });
}

function sortHubFriends(friends: readonly SocialHubFriendItem[]): SocialHubFriendItem[] {
  return sortSocialConversations(friends, getFriendDisplayName).sort((left, right) => {
    if (left.is_online !== right.is_online) {
      return left.is_online ? -1 : 1;
    }
    return 0;
  });
}

function sortHubGroups(groups: readonly SocialConversationPreview[]): SocialConversationPreview[] {
  return sortSocialConversations(groups, getGroupDisplayName);
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

function updateHubGroup(
  bundle: SocialHubBundle,
  conversationId: number,
  updater: (conversation: SocialConversationPreview) => SocialConversationPreview,
): SocialHubBundle {
  return {
    ...bundle,
    groups: bundle.groups.map((conversation) =>
      conversation.id === conversationId ? updater(conversation) : conversation,
    ),
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
    direct_conversation_id:
      toNullablePositiveNumber(conversation?.id) ?? friend.direct_conversation_id ?? null,
    unread_count: toNonNegativeNumber(conversation?.unread_count),
    last_message_preview:
      conversation?.last_message_preview ??
      (message ? describeMessagePreview(message) : friend.last_message_preview),
    last_message_at: conversation?.last_message_at ?? message?.created_at ?? friend.last_message_at,
    notifications_muted: conversation?.notifications_muted ?? friend.notifications_muted,
  }));
}

function applyConversationPreviewToGroup(
  bundle: SocialHubBundle,
  conversationId: number,
  conversation: SocialConversationPreview | null,
  message?: SocialConversationMessage | null,
): SocialHubBundle {
  return updateHubGroup(bundle, conversationId, (currentConversation) => ({
    ...currentConversation,
    ...(conversation ?? {}),
    unread_count: toNonNegativeNumber(conversation?.unread_count ?? currentConversation.unread_count),
    last_message_preview:
      conversation?.last_message_preview ??
      (message ? describeMessagePreview(message) : currentConversation.last_message_preview),
    last_message_at:
      conversation?.last_message_at ?? message?.created_at ?? currentConversation.last_message_at,
    notifications_muted: conversation?.notifications_muted ?? currentConversation.notifications_muted,
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

function areMessagesEquivalent(
  left: readonly SocialConversationMessage[],
  right: readonly SocialConversationMessage[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (!current || !next) {
      return false;
    }
    if (
      current.id !== next.id ||
      current.message_text !== next.message_text ||
      current.edited_at !== next.edited_at ||
      current.created_at !== next.created_at ||
      current.message_kind !== next.message_kind ||
      current.media?.public_url !== next.media?.public_url
    ) {
      return false;
    }
  }

  return true;
}

type VisualViewportFrame = {
  height: number;
  offsetTop: number;
};

function useVisualViewportFrame(enabled: boolean): VisualViewportFrame | null {
  const [frame, setFrame] = useState<VisualViewportFrame | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setFrame(null);
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      setFrame(null);
      return;
    }

    let frameId = 0;
    const handleOrientationChange = () => {
      updateFrame();
    };
    const updateFrame = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        const height = Math.max(0, Math.round(viewport.height));
        const offsetTop = Math.max(0, Math.round(viewport.offsetTop));
        setFrame(height > 0 ? { height, offsetTop } : null);
      });
    };

    updateFrame();
    viewport.addEventListener("resize", updateFrame);
    viewport.addEventListener("scroll", updateFrame);
    window.addEventListener("orientationchange", handleOrientationChange);
    window.addEventListener("resize", updateFrame);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      viewport.removeEventListener("resize", updateFrame);
      viewport.removeEventListener("scroll", updateFrame);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("resize", updateFrame);
    };
  }, [enabled]);

  return frame;
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

function ConversationListItem({
  avatarSrc,
  avatarName,
  title,
  subtitle,
  timestamp,
  unreadCount,
  active,
  busy = false,
  showPresence = false,
  isOnline = false,
  onClick,
}: ConversationListItemProps) {
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
      {showPresence ? (
        <FriendPresenceAvatar src={avatarSrc} name={avatarName} isOnline={isOnline} />
      ) : (
        <Avatar
          src={avatarSrc ?? null}
          name={avatarName}
          className="h-14 w-14 border border-[color:var(--fl-social-hub-muted-border)]"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[1rem] font-semibold text-[color:var(--fl-color-text)]">
              {title}
            </p>
            <p className="truncate text-[0.84rem] text-[color:var(--fl-color-text-muted)]">
              {subtitle}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="text-[0.68rem] font-medium text-[color:var(--fl-color-text-muted)]">
              {formatConversationListTime(timestamp)}
            </span>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-[color:var(--fl-color-text-muted)]" />
            ) : unreadCount > 0 ? (
              <span className="flex min-h-6 min-w-6 items-center justify-center rounded-full bg-[color:var(--fl-color-text)] px-1 text-[0.7rem] font-black text-[color:var(--app-bg-color)]">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function FriendRow({ friend, active, busy, onClick }: FriendRowProps) {
  return (
    <ConversationListItem
      avatarSrc={friend.friend_avatar_url}
      avatarName={getFriendDisplayName(friend)}
      title={getFriendDisplayName(friend)}
      subtitle={friend.last_message_preview?.trim() || `@${friend.friend_username}`}
      timestamp={friend.last_message_at}
      unreadCount={friend.unread_count}
      active={active}
      busy={busy}
      showPresence
      isOnline={friend.is_online === true}
      onClick={onClick}
    />
  );
}

function GroupConversationRow({ conversation, active, onClick }: GroupConversationRowProps) {
  return (
    <ConversationListItem
      avatarSrc={conversation.avatar_url}
      avatarName={getGroupDisplayName(conversation)}
      title={getGroupDisplayName(conversation)}
      subtitle={conversation.last_message_preview?.trim() || `${conversation.member_count} membros`}
      timestamp={conversation.last_message_at}
      unreadCount={conversation.unread_count}
      active={active}
      onClick={onClick}
    />
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
  activeGroup,
  onAddFriend,
  onCreateGroup,
  onOpenPrivacy,
  onOpenMediaLibrary,
  onToggleMute,
  onRemoveFriend,
  onBlockFriend,
}: {
  activeFriend: SocialHubFriendItem | null;
  activeGroup: SocialConversationPreview | null;
  onAddFriend: () => void;
  onCreateGroup: () => void;
  onOpenPrivacy: () => void;
  onOpenMediaLibrary: () => void;
  onToggleMute: () => void;
  onRemoveFriend: () => void;
  onBlockFriend: () => void;
}) {
  const hasConversationContext = activeFriend !== null || activeGroup !== null;
  const notificationsMuted =
    activeFriend?.notifications_muted === true || activeGroup?.notifications_muted === true;

  return (
    <div className="fl-social-hub-menu absolute right-0 top-[calc(100%+0.65rem)] z-20 w-[16rem] rounded-[1.6rem] p-2.5">
      <button
        type="button"
        onClick={onAddFriend}
        className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium text-[color:var(--fl-color-text)] transition-colors hover:bg-black/[0.04]"
      >
        <UserPlus className="h-4 w-4" />
        Adicionar amigo
      </button>
      <button
        type="button"
        onClick={onCreateGroup}
        className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium text-[color:var(--fl-color-text)] transition-colors hover:bg-black/[0.04]"
      >
        <Users className="h-4 w-4" />
        Criar grupo
      </button>
      <button
        type="button"
        onClick={onOpenPrivacy}
        className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium text-[color:var(--fl-color-text)] transition-colors hover:bg-black/[0.04]"
      >
        <LockKeyhole className="h-4 w-4" />
        Privacidade
      </button>
      {hasConversationContext ? (
        <>
          <div className="my-2 h-px bg-[color:var(--fl-social-hub-muted-border)]" />
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
            {notificationsMuted ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            {notificationsMuted ? "Ativar notificacoes" : "Silenciar notificacoes"}
          </button>
        </>
      ) : null}
      {activeFriend ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}

function PrivacyPreferenceRow({
  title,
  description,
  checked,
  disabled = false,
  onToggle,
}: PrivacyPreferenceRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className="fl-social-hub-soft-card flex w-full items-center gap-4 rounded-[1.6rem] px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[color:var(--fl-color-text)]">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-[color:var(--fl-color-text-muted)]">{description}</p>
      </div>
      <span
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors",
          checked ? "bg-[color:var(--app-primary-color)]" : "bg-[color:var(--fl-social-hub-input-border)]",
        )}
        aria-hidden="true"
      >
        <span
          className={cn(
            "absolute top-1 h-5 w-5 rounded-full bg-white transition-transform",
            checked ? "left-6" : "left-1",
          )}
        />
      </span>
    </button>
  );
}

function MessageActionsMenu({
  target,
  busy,
  onClose,
  onCopy,
  onEdit,
  onDelete,
}: {
  target: MessageActionsTarget | null;
  busy: boolean;
  onClose: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!target) return null;

  const { message } = target;

  const canCopy = message.message_text.trim().length > 0;
  const canEdit = message.is_own_message && message.message_kind === "text";
  const canDelete = message.is_own_message;
  const actionCount = [canCopy, canEdit, canDelete].filter(Boolean).length;
  const viewportWidth = typeof window === "undefined" ? 360 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 640 : window.innerHeight;
  const horizontalMargin = 12;
  const verticalMargin = 12;
  const menuWidth = Math.min(248, Math.max(196, viewportWidth - horizontalMargin * 2));
  const estimatedHeight = 34 + actionCount * 52;
  const left =
    target.align === "end"
      ? Math.max(horizontalMargin, Math.min(target.anchorX - menuWidth, viewportWidth - menuWidth - horizontalMargin))
      : Math.max(horizontalMargin, Math.min(target.anchorX, viewportWidth - menuWidth - horizontalMargin));
  const spaceBelow = viewportHeight - target.anchorY - verticalMargin;
  const top =
    spaceBelow >= estimatedHeight
      ? Math.max(verticalMargin, target.anchorY + 8)
      : Math.max(verticalMargin, target.anchorY - estimatedHeight - 8);

  return (
    <div className="fixed inset-0 z-[95] bg-black/22">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Fechar acoes da mensagem"
        onClick={onClose}
      />
      <div
        className="fl-social-hub-menu absolute z-[96] rounded-[1.6rem] p-2.5 shadow-[0_24px_80px_rgba(0,0,0,0.24)]"
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${menuWidth}px`,
        }}
        data-social-hub-message-actions-root
      >
        <p className="truncate px-3 pb-2 pt-1 text-sm font-medium text-[color:var(--fl-color-text-muted)]">
          @{message.sender_username}
        </p>
        <div className="h-px bg-[color:var(--fl-social-hub-muted-border)]" />
        <div className="mt-2 space-y-1">
          {canCopy ? (
            <button
              type="button"
              onClick={onCopy}
              disabled={busy}
              className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium text-[color:var(--fl-color-text)] transition-colors hover:bg-black/[0.04] disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              Copiar
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={onEdit}
              disabled={busy}
              className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium text-[color:var(--fl-color-text)] transition-colors hover:bg-black/[0.04] disabled:opacity-50"
            >
              <PencilLine className="h-4 w-4" />
              Editar
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium text-[#b42318] transition-colors hover:bg-[#b42318]/[0.06] disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Excluir
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ConversationBubble({ layout, onOpenActions }: ConversationBubbleProps) {
  const { message, groupedWithNext, groupedWithPrevious, showTimestamp } = layout;
  const longPressTimerRef = useRef<number | null>(null);
  const bubbleButtonRef = useRef<HTMLButtonElement | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearLongPress, [clearLongPress]);

  const handleOpenActions = useCallback(() => {
    clearLongPress();
    const rect = bubbleButtonRef.current?.getBoundingClientRect();
    const viewportWidth = typeof window === "undefined" ? 360 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 640 : window.innerHeight;
    onOpenActions({
      message,
      anchorX: rect
        ? (message.is_own_message ? rect.right : rect.left)
        : (message.is_own_message ? viewportWidth - 24 : 24),
      anchorY: rect ? rect.bottom : viewportHeight / 2,
      align: message.is_own_message ? "end" : "start",
    });
  }, [clearLongPress, message, onOpenActions]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      handleOpenActions();
    }, MESSAGE_LONG_PRESS_DURATION_MS);
  }, [clearLongPress, handleOpenActions]);

  const bubbleRadiusClassName = message.is_own_message
    ? cn(
        groupedWithPrevious ? "rounded-tr-[0.65rem]" : "rounded-tr-[1.6rem]",
        groupedWithNext ? "rounded-br-[0.65rem]" : "rounded-br-[1.6rem]",
        "rounded-tl-[1.6rem] rounded-bl-[1.6rem]",
      )
    : cn(
        groupedWithPrevious ? "rounded-tl-[0.65rem]" : "rounded-tl-[1.6rem]",
        groupedWithNext ? "rounded-bl-[0.65rem]" : "rounded-bl-[1.6rem]",
        "rounded-tr-[1.6rem] rounded-br-[1.6rem]",
      );

  return (
    <div
      className={cn(
        "flex w-full",
        message.is_own_message ? "justify-end" : "justify-start",
        groupedWithPrevious ? "mt-1" : "mt-4 first:mt-0",
      )}
    >
      <div className="max-w-[82%]">
        <button
          ref={bubbleButtonRef}
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerLeave={clearLongPress}
          onContextMenu={(event) => {
            event.preventDefault();
            handleOpenActions();
          }}
          className="block w-full cursor-default text-left"
          aria-label="Abrir acoes da mensagem"
        >
          {message.media?.public_url ? (
            <div
              className={cn(
                "overflow-hidden border",
                bubbleRadiusClassName,
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
                "px-4 py-3 text-[0.95rem] leading-relaxed",
                bubbleRadiusClassName,
                message.is_own_message
                  ? "fl-social-hub-bubble-own"
                  : "fl-social-hub-bubble-other",
              )}
            >
              {message.message_text}
            </div>
          )}
        </button>
        {showTimestamp ? (
          <div
            className={cn(
              "mt-1 px-1 text-[0.68rem] font-medium",
              message.is_own_message
                ? "text-right text-[color:var(--fl-color-text-muted)]"
                : "text-left text-[color:var(--fl-color-text-muted)]",
            )}
          >
            {formatBubbleMeta(message)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function Friends() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pendingByConversationId, refreshSocialChatNotifications } = useSocialChatNotifications();
  const androidHost = isAndroidHost();
  const requestedConversationId = parseConversationId(searchParams.get("conversationId"));

  const [hub, setHub] = useState<SocialHubBundle>(EMPTY_HUB_BUNDLE);
  const [loadingHub, setLoadingHub] = useState(true);
  const [hubError, setHubError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const [remoteResults, setRemoteResults] = useState<FriendSearchResult[]>([]);
  const [remoteSearchLoading, setRemoteSearchLoading] = useState(false);
  const [remoteSearchSettled, setRemoteSearchSettled] = useState(false);
  const [selectedFriendUserId, setSelectedFriendUserId] = useState<string | null>(null);
  const [selectedGroupConversationId, setSelectedGroupConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<SocialConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
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
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMemberUserIds, setGroupMemberUserIds] = useState<string[]>([]);
  const [groupActionLoading, setGroupActionLoading] = useState(false);
  const [groupActionError, setGroupActionError] = useState<string | null>(null);
  const [privacyActionLoadingKey, setPrivacyActionLoadingKey] = useState<keyof SocialUserPreferences | null>(null);
  const [privacyActionError, setPrivacyActionError] = useState<string | null>(null);
  const [messageActionsTarget, setMessageActionsTarget] = useState<MessageActionsTarget | null>(null);
  const [conversationRefreshIntervalMs, setConversationRefreshIntervalMs] = useState(
    ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const lastReadMarkerRef = useRef<string>("");
  const pendingScrollBehaviorRef = useRef<ScrollBehavior | null>(null);
  const activeConversationContextRef = useRef<ActiveConversationContext>({
    conversationId: null,
    friendUserId: null,
    groupConversationId: null,
  });
  const conversationRefreshInFlightRef = useRef<Map<number, Promise<void>>>(new Map());
  const pendingConversationSignatureRef = useRef("");

  const sortedFriends = useMemo(() => sortHubFriends(hub.friends), [hub.friends]);
  const sortedGroups = useMemo(() => sortHubGroups(hub.groups), [hub.groups]);
  const filteredFriends = useMemo(
    () => sortedFriends.filter((friend) => matchesFriendQuery(friend, deferredSearchQuery.toLowerCase())),
    [deferredSearchQuery, sortedFriends],
  );
  const filteredGroups = useMemo(
    () => sortedGroups.filter((conversation) => matchesGroupQuery(conversation, deferredSearchQuery.toLowerCase())),
    [deferredSearchQuery, sortedGroups],
  );

  const activeFriend = useMemo(
    () => hub.friends.find((friend) => friend.friend_user_id === selectedFriendUserId) ?? null,
    [hub.friends, selectedFriendUserId],
  );
  const activeGroup = useMemo(
    () => hub.groups.find((conversation) => conversation.id === selectedGroupConversationId) ?? null,
    [hub.groups, selectedGroupConversationId],
  );
  const activeFriendUserId = activeFriend?.friend_user_id ?? null;
  const activeGroupConversationId = activeGroup?.id ?? null;
  const activeConversationId = activeGroup?.id ?? activeFriend?.direct_conversation_id ?? null;
  const activeConversationMuted =
    activeGroup?.notifications_muted === true || activeFriend?.notifications_muted === true;
  const activeFriendDisplayName = activeFriend ? getFriendDisplayName(activeFriend) : "";
  const activeGroupDisplayName = activeGroup ? getGroupDisplayName(activeGroup) : "";
  const isConversationOpen = activeFriend !== null || activeGroup !== null;
  const conversationViewportFrame = useVisualViewportFrame(androidHost && isConversationOpen);

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
  const hasExactFriendMatch = useMemo(() => {
    if (!deferredSearchQuery) return false;
    const normalizedQuery = deferredSearchQuery.toLowerCase();
    return filteredFriends.some((friend) => {
      const username = friend.friend_username.trim().toLowerCase();
      const fullName = friend.friend_full_name.trim().toLowerCase();
      return username === normalizedQuery || fullName === normalizedQuery;
    });
  }, [deferredSearchQuery, filteredFriends]);
  const shouldSearchRemoteUsers = deferredSearchQuery.length >= 3 && !hasExactFriendMatch;
  const showRemoteSearchPanel =
    shouldSearchRemoteUsers &&
    (visibleRemoteResults.length > 0 || remoteSearchLoading || remoteSearchSettled);

  const conversationEntries = useMemo<ConversationListEntry[]>(() => {
    const directEntries: ConversationListEntry[] = filteredFriends.map((friend) => {
      const pendingUnreadCount =
        typeof friend.direct_conversation_id === "number"
          ? Math.max(0, pendingByConversationId[friend.direct_conversation_id] ?? 0)
          : 0;

      return {
        kind: "direct",
        key: `direct:${friend.friend_user_id}`,
        title: getFriendDisplayName(friend),
        subtitle: friend.last_message_preview?.trim() || `@${friend.friend_username}`,
        timestamp: friend.last_message_at,
        unreadCount: Math.max(friend.unread_count, pendingUnreadCount),
        active: friend.friend_user_id === activeFriend?.friend_user_id,
        busy: openingConversationUserId === friend.friend_user_id,
        avatarSrc: friend.friend_avatar_url,
        avatarName: getFriendDisplayName(friend),
        showPresence: true,
        isOnline: friend.is_online === true,
        friend,
      };
    });

    const groupEntries: ConversationListEntry[] = filteredGroups.map((conversation) => {
      const pendingUnreadCount = Math.max(0, pendingByConversationId[conversation.id] ?? 0);

      return {
        kind: "group",
        key: `group:${conversation.id}`,
        title: getGroupDisplayName(conversation),
        subtitle: conversation.last_message_preview?.trim() || `${conversation.member_count} membros`,
        timestamp: conversation.last_message_at,
        unreadCount: Math.max(conversation.unread_count, pendingUnreadCount),
        active: conversation.id === activeGroup?.id,
        busy: false,
        avatarSrc: conversation.avatar_url,
        avatarName: getGroupDisplayName(conversation),
        showPresence: false,
        isOnline: false,
        conversation,
      };
    });

    return [...directEntries, ...groupEntries].sort((left, right) => {
      const activityDelta = getConversationSortTimestamp(right.timestamp) - getConversationSortTimestamp(left.timestamp);
      if (activityDelta !== 0) return activityDelta;
      if (left.unreadCount !== right.unreadCount) return right.unreadCount - left.unreadCount;
      return left.title.localeCompare(right.title, "pt-BR", { sensitivity: "base" });
    });
  }, [activeFriend, activeGroup, filteredFriends, filteredGroups, openingConversationUserId, pendingByConversationId]);
  const messageBubbleLayouts = useMemo(
    () => buildConversationBubbleLayouts(messages),
    [messages],
  );
  const pendingConversationSignature = useMemo(
    () =>
      Object.entries(pendingByConversationId)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([conversationId, count]) => `${conversationId}:${count}`)
        .join("|"),
    [pendingByConversationId],
  );
  const editingMessage = useMemo(
    () => messages.find((message) => message.id === editingMessageId) ?? null,
    [editingMessageId, messages],
  );
  const lastVisibleMessageId = messages[messages.length - 1]?.id ?? null;

  const setConversationParam = useCallback((conversationId: number | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (conversationId && conversationId > 0) {
      nextParams.set("conversationId", String(conversationId));
    } else {
      nextParams.delete("conversationId");
    }
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    pendingScrollBehaviorRef.current = behavior;
    window.requestAnimationFrame(() => {
      const currentViewport = messagesViewportRef.current;
      if (!currentViewport) return;
      currentViewport.scrollTo({
        top: currentViewport.scrollHeight,
        behavior: pendingScrollBehaviorRef.current ?? behavior,
      });
      pendingScrollBehaviorRef.current = null;
    });
  }, []);

  const closeConversation = useCallback(() => {
    activeConversationContextRef.current = {
      conversationId: null,
      friendUserId: null,
      groupConversationId: null,
    };
    setEditingMessageId(null);
    setMessageActionsTarget(null);
    setMessageInput("");
    setSelectedFriendUserId(null);
    setSelectedGroupConversationId(null);
    setMessages([]);
    setMessagesLoading(false);
    setThreadConversationId(null);
    setThreadError(null);
    setActionsMenuAnchor(null);
    setMediaModalOpen(false);
    setConversationParam(null);
  }, [setConversationParam]);

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

  const recoverUnavailableConversation = useCallback((message: string) => {
    setThreadError(null);
    closeConversation();
    clearSocialChatCache();
    setHubError(message);
    void loadHub(true);
    void refreshSocialChatNotifications({ force: true });
  }, [closeConversation, loadHub, refreshSocialChatNotifications]);

  const isCurrentConversationContext = useCallback((context: ActiveConversationContext): boolean => {
    const current = activeConversationContextRef.current;
    return (
      current.conversationId === context.conversationId &&
      current.friendUserId === context.friendUserId &&
      current.groupConversationId === context.groupConversationId
    );
  }, []);

  const refreshActiveConversation = useCallback(async (
    context: ActiveConversationContext & { quiet?: boolean },
  ) => {
    const { conversationId, friendUserId, groupConversationId } = context;
    if (!conversationId || (!friendUserId && !groupConversationId)) {
      setMessages([]);
      setThreadConversationId(null);
      return;
    }

    const quietRefresh = context.quiet === true;
    const existingRequest = conversationRefreshInFlightRef.current.get(conversationId);
    if (existingRequest) {
      if (!quietRefresh && isCurrentConversationContext(context)) {
        setMessagesLoading(true);
        setThreadError(null);
      }
      try {
        await existingRequest;
      } finally {
        if (!quietRefresh && activeConversationContextRef.current.conversationId === conversationId) {
          setMessagesLoading(false);
        }
      }
      return;
    }

    if (!quietRefresh) {
      setMessagesLoading(true);
      setThreadError(null);
    }

    let trackedRequest: Promise<void> | null = null;
    const refreshTask = (async () => {
      try {
        const payload = await fetchSocialConversationMessages(conversationId, { limit: 60 });
        if (!isCurrentConversationContext(context)) {
          return;
        }

        setThreadError(null);
        setConversationRefreshIntervalMs(ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS);
        setMessages((current) => (areMessagesEquivalent(current, payload.messages) ? current : payload.messages));
        setThreadConversationId(conversationId);
        setHub((current) => {
          if (friendUserId) {
            return applyConversationPreviewToFriend(
              current,
              friendUserId,
              payload.conversation,
              payload.messages[payload.messages.length - 1] ?? null,
            );
          }
          if (groupConversationId) {
            return applyConversationPreviewToGroup(
              current,
              groupConversationId,
              payload.conversation,
              payload.messages[payload.messages.length - 1] ?? null,
            );
          }
          return current;
        });

        const lastMessage = payload.messages[payload.messages.length - 1] ?? null;
        if (lastMessage && !lastMessage.is_own_message) {
          const marker = `${conversationId}:${lastMessage.id}`;
          if (lastReadMarkerRef.current !== marker) {
            lastReadMarkerRef.current = marker;
            void markSocialConversationRead(conversationId, {
              last_read_message_id: lastMessage.id,
            })
              .then(() => {
                if (!isCurrentConversationContext(context)) {
                  return;
                }

                setHub((current) => {
                  if (friendUserId) {
                    return updateHubFriend(current, friendUserId, (friend) => ({
                      ...friend,
                      unread_count: 0,
                    }));
                  }
                  if (groupConversationId) {
                    return updateHubGroup(current, groupConversationId, (conversation) => ({
                      ...conversation,
                      unread_count: 0,
                    }));
                  }
                  return current;
                });
                void refreshSocialChatNotifications({ force: true });
              })
              .catch(() => {
                lastReadMarkerRef.current = "";
              });
          }
        }
      } catch (error) {
        if (!isCurrentConversationContext(context)) {
          return;
        }

        if (error instanceof SocialChatApiError && (error.status === 403 || error.status === 404)) {
          const message = handleServiceError(error, "Esta conversa nao esta mais disponivel.");
          if (message) {
            recoverUnavailableConversation(message);
          }
          return;
        }

        if (quietRefresh) {
          const message = handleServiceError(error, "Nao foi possivel sincronizar esta conversa agora.");
          if (message) {
            console.warn("[social-hub][conversation-refresh]", {
              conversationId,
              message,
            });
            setConversationRefreshIntervalMs((current) =>
              Math.min(current * 2, MAX_ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS),
            );
          }
        } else {
          applyServiceError(setThreadError, error, "Nao foi possivel carregar esta conversa agora.");
        }
      } finally {
        const currentRequest = conversationRefreshInFlightRef.current.get(conversationId);
        if (currentRequest === trackedRequest) {
          conversationRefreshInFlightRef.current.delete(conversationId);
        }
        if (!quietRefresh && activeConversationContextRef.current.conversationId === conversationId) {
          setMessagesLoading(false);
        }
      }
    })();

    trackedRequest = refreshTask;
    conversationRefreshInFlightRef.current.set(conversationId, refreshTask);
    await refreshTask;
  }, [
    applyServiceError,
    handleServiceError,
    isCurrentConversationContext,
    refreshSocialChatNotifications,
    recoverUnavailableConversation,
  ]);

  const openFriendConversation = useCallback(async (friend: SocialHubFriendItem) => {
    if (friend.direct_conversation_id) {
      startTransition(() => {
        setSelectedFriendUserId(friend.friend_user_id);
        setSelectedGroupConversationId(null);
      });
      setConversationParam(friend.direct_conversation_id);
      setActionsMenuAnchor(null);
      scrollMessagesToBottom();
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
        setSelectedGroupConversationId(null);
      });
      setConversationParam(conversation.id);
      scrollMessagesToBottom();
    } catch (error) {
      applyServiceError(setHubError, error, "Nao foi possivel abrir a conversa agora.");
    } finally {
      setOpeningConversationUserId((current) =>
        current === friend.friend_user_id ? null : current,
      );
    }
  }, [applyServiceError, scrollMessagesToBottom, setConversationParam]);

  const openGroupConversation = useCallback((conversation: SocialConversationPreview) => {
    startTransition(() => {
      setSelectedFriendUserId(null);
      setSelectedGroupConversationId(conversation.id);
    });
    setConversationParam(conversation.id);
    setActionsMenuAnchor(null);
    scrollMessagesToBottom();
  }, [scrollMessagesToBottom, setConversationParam]);

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
    if (activeConversationId) {
      pendingConversationSignatureRef.current = pendingConversationSignature;
      return;
    }

    const previousSignature = pendingConversationSignatureRef.current;
    pendingConversationSignatureRef.current = pendingConversationSignature;

    if (previousSignature === pendingConversationSignature) return;
    if (document.visibilityState !== "visible") return;

    void loadHub(true);
  }, [activeConversationId, loadHub, pendingConversationSignature]);

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
          setSelectedGroupConversationId(null);
        });
      }
      return;
    }

    const requestedGroup = hub.groups.find((conversation) => conversation.id === requestedConversationId);
    if (requestedGroup) {
      if (selectedGroupConversationId !== requestedGroup.id) {
        startTransition(() => {
          setSelectedGroupConversationId(requestedGroup.id);
          setSelectedFriendUserId(null);
        });
      }
      return;
    }

    if (!loadingHub) {
      setConversationParam(null);
    }
  }, [
    hub.friends,
    hub.groups,
    loadingHub,
    requestedConversationId,
    selectedFriendUserId,
    selectedGroupConversationId,
    setConversationParam,
  ]);

  useEffect(() => {
    activeConversationContextRef.current = {
      conversationId: activeConversationId,
      friendUserId: activeFriendUserId,
      groupConversationId: activeGroupConversationId,
    };
  }, [activeConversationId, activeFriendUserId, activeGroupConversationId]);

  useEffect(() => {
    if (!selectedFriendUserId) return;
    const stillExists = hub.friends.some((friend) => friend.friend_user_id === selectedFriendUserId);
    if (stillExists) return;

    closeConversation();
  }, [closeConversation, hub.friends, selectedFriendUserId]);

  useEffect(() => {
    if (!selectedGroupConversationId) return;
    const stillExists = hub.groups.some((conversation) => conversation.id === selectedGroupConversationId);
    if (stillExists) return;

    closeConversation();
  }, [closeConversation, hub.groups, selectedGroupConversationId]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setMessagesLoading(false);
      setThreadConversationId(null);
      setConversationRefreshIntervalMs(ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS);
      return;
    }

    const context = {
      conversationId: activeConversationId,
      friendUserId: activeFriendUserId,
      groupConversationId: activeGroupConversationId,
    };
    lastReadMarkerRef.current = "";
    setConversationRefreshIntervalMs(ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS);
    void refreshActiveConversation(context);
    scrollMessagesToBottom();
  }, [
    activeConversationId,
    activeFriendUserId,
    activeGroupConversationId,
    refreshActiveConversation,
    scrollMessagesToBottom,
  ]);

  useEffect(() => {
    if (!activeConversationId || threadConversationId !== activeConversationId) return;
    if (!lastVisibleMessageId) return;
    scrollMessagesToBottom();
  }, [activeConversationId, lastVisibleMessageId, scrollMessagesToBottom, threadConversationId]);

  useEffect(() => {
    if (!activeConversationId) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (sendingMessage || uploadingMedia) return;
      void refreshActiveConversation({
        conversationId: activeConversationId,
        friendUserId: activeFriendUserId,
        groupConversationId: activeGroupConversationId,
        quiet: true,
      });
    }, conversationRefreshIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    activeConversationId,
    activeFriendUserId,
    activeGroupConversationId,
    conversationRefreshIntervalMs,
    refreshActiveConversation,
    sendingMessage,
    uploadingMedia,
  ]);

  useEffect(() => {
    if (!mediaModalOpen) return;
    void loadConversationMedia();
  }, [loadConversationMedia, mediaModalOpen]);

  useEffect(() => {
    if (!shouldSearchRemoteUsers) {
      setRemoteResults([]);
      setRemoteSearchLoading(false);
      setRemoteSearchSettled(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setRemoteSearchLoading(true);
      setRemoteSearchSettled(false);
      searchUsersByUsername(deferredSearchQuery)
        .then((payload) => {
          if (cancelled) return;
          setRemoteResults(payload);
          setRemoteSearchSettled(true);
        })
        .catch(() => {
          if (cancelled) return;
          setRemoteResults([]);
          setRemoteSearchSettled(true);
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
  }, [deferredSearchQuery, shouldSearchRemoteUsers]);

  useEffect(() => {
    setMessageInput("");
    setEditingMessageId(null);
    setMessageActionsTarget(null);
    setThreadError(null);
  }, [activeConversationId]);

  useEffect(() => {
    if (!editingMessageId) return;
    if (editingMessage) return;
    setEditingMessageId(null);
  }, [editingMessage, editingMessageId]);

  useEffect(() => {
    if (!messageActionsTarget) return;
    const stillExists = messages.some((message) => message.id === messageActionsTarget.message.id);
    if (stillExists) return;
    setMessageActionsTarget(null);
  }, [messageActionsTarget, messages]);

  useEffect(() => {
    if (groupModalOpen) return;
    setGroupTitle("");
    setGroupMemberUserIds([]);
    setGroupActionError(null);
    setGroupActionLoading(false);
  }, [groupModalOpen]);

  useEffect(() => {
    if (privacyModalOpen) return;
    setPrivacyActionError(null);
    setPrivacyActionLoadingKey(null);
  }, [privacyModalOpen]);

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

  const handleOpenMessageActions = useCallback((target: MessageActionsTarget) => {
    setActionsMenuAnchor(null);
    setMessageActionsTarget(target);
  }, []);

  const handleCloseMessageActions = useCallback(() => {
    setMessageActionsTarget(null);
  }, []);

  const handleCopyMessage = useCallback(async () => {
    const message = messageActionsTarget?.message;
    if (!message) return;

    const text = message.message_text.trim();
    if (!text) {
      setThreadError("Nao ha texto para copiar nesta mensagem.");
      setMessageActionsTarget(null);
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("CLIPBOARD_UNAVAILABLE");
      }
      await navigator.clipboard.writeText(text);
      setMessageActionsTarget(null);
    } catch (error) {
      applyServiceError(setThreadError, error, "Nao foi possivel copiar esta mensagem.");
    }
  }, [applyServiceError, messageActionsTarget]);

  const handleStartEditingMessage = useCallback(() => {
    const message = messageActionsTarget?.message;
    if (!message || !message.is_own_message || message.message_kind !== "text") {
      return;
    }

    setEditingMessageId(message.id);
    setMessageInput(message.message_text);
    setMessageActionsTarget(null);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(
        message.message_text.length,
        message.message_text.length,
      );
      scrollMessagesToBottom();
    });
  }, [messageActionsTarget, scrollMessagesToBottom]);

  const handleCancelEditingMessage = useCallback(() => {
    setEditingMessageId(null);
    setMessageInput("");
  }, []);

  const handleDeleteMessage = useCallback(async () => {
    const message = messageActionsTarget?.message;
    if (!message || !message.is_own_message || !activeConversationId) {
      return;
    }

    setSendingMessage(true);
    setThreadError(null);

    try {
      const payload = await deleteSocialConversationMessage(activeConversationId, message.id);
      setMessages((current) => current.filter((message) => message.id !== payload.deletedMessageId));
      if (editingMessageId === payload.deletedMessageId) {
        setEditingMessageId(null);
        setMessageInput("");
      }
      setHub((current) => {
        if (activeFriend) {
          return applyConversationPreviewToFriend(
            current,
            activeFriend.friend_user_id,
            payload.conversation,
          );
        }
        if (activeGroup) {
          return applyConversationPreviewToGroup(
            current,
            activeGroup.id,
            payload.conversation,
          );
        }
        return current;
      });
      setMessageActionsTarget(null);
      void refreshSocialChatNotifications({ force: true });
    } catch (error) {
      if (error instanceof SocialChatApiError && (error.status === 403 || error.status === 404)) {
        const message = handleServiceError(error, "Esta conversa nao esta mais disponivel.");
        if (message) {
          recoverUnavailableConversation(message);
        }
        return;
      }
      applyServiceError(setThreadError, error, "Nao foi possivel excluir esta mensagem.");
    } finally {
      setSendingMessage(false);
    }
  }, [
    activeConversationId,
    activeFriend,
    activeGroup,
    applyServiceError,
    editingMessageId,
    handleServiceError,
    messageActionsTarget,
    recoverUnavailableConversation,
    refreshSocialChatNotifications,
  ]);

  const handleSubmitMessage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeConversationId || (!activeFriend && !activeGroup)) return;

    const normalized = messageInput.trim();
    if (!normalized) return;

    setSendingMessage(true);
    setThreadError(null);

    try {
      if (editingMessage) {
        if (normalized === editingMessage.message_text.trim()) {
          setEditingMessageId(null);
          setMessageInput("");
          return;
        }

        const payload = await updateSocialConversationMessage(activeConversationId, editingMessage.id, {
          message_text: normalized,
        });
        setEditingMessageId(null);
        setMessageInput("");
        setMessages((current) => upsertConversationMessage(current, payload.message));
        setHub((current) => {
          if (activeFriend) {
            return applyConversationPreviewToFriend(
              current,
              activeFriend.friend_user_id,
              payload.conversation,
              payload.message,
            );
          }
          if (activeGroup) {
            return applyConversationPreviewToGroup(
              current,
              activeGroup.id,
              payload.conversation,
              payload.message,
            );
          }
          return current;
        });
      } else {
        const payload = await sendSocialConversationMessage(activeConversationId, {
          message_text: normalized,
        });
        setMessageInput("");
        setMessages((current) => upsertConversationMessage(current, payload.message));
        setHub((current) => {
          if (activeFriend) {
            return applyConversationPreviewToFriend(
              current,
              activeFriend.friend_user_id,
              payload.conversation,
              payload.message,
            );
          }
          if (activeGroup) {
            return applyConversationPreviewToGroup(
              current,
              activeGroup.id,
              payload.conversation,
              payload.message,
            );
          }
          return current;
        });
        void refreshSocialChatNotifications({ force: true });
      }

      setConversationRefreshIntervalMs(ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS);
      setMessageActionsTarget(null);
      scrollMessagesToBottom("smooth");
    } catch (error) {
      if (error instanceof SocialChatApiError && (error.status === 403 || error.status === 404)) {
        const message = handleServiceError(error, "Esta conversa nao esta mais disponivel.");
        if (message) {
          recoverUnavailableConversation(message);
        }
        return;
      }
      applyServiceError(
        setThreadError,
        error,
        editingMessage ? "Nao foi possivel editar a mensagem." : "Nao foi possivel enviar a mensagem.",
      );
    } finally {
      setSendingMessage(false);
    }
  }, [
    activeConversationId,
    activeFriend,
    activeGroup,
    applyServiceError,
    editingMessage,
    handleServiceError,
    messageInput,
    recoverUnavailableConversation,
    refreshSocialChatNotifications,
    scrollMessagesToBottom,
  ]);

  const handleFileSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file || !activeConversationId || (!activeFriend && !activeGroup)) return;

    setUploadingMedia(true);
    setThreadError(null);
    setEditingMessageId(null);

    try {
      const payload = await uploadSocialConversationMedia(activeConversationId, {
        file,
      });
      setMessages((current) => upsertConversationMessage(current, payload.message));
      setHub((current) => {
        if (activeFriend) {
          return applyConversationPreviewToFriend(
            current,
            activeFriend.friend_user_id,
            payload.conversation,
            payload.message,
          );
        }
        if (activeGroup) {
          return applyConversationPreviewToGroup(
            current,
            activeGroup.id,
            payload.conversation,
            payload.message,
          );
        }
        return current;
      });
      setConversationRefreshIntervalMs(ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS);
      scrollMessagesToBottom("smooth");
      void refreshSocialChatNotifications({ force: true });
    } catch (error) {
      if (error instanceof SocialChatApiError && (error.status === 403 || error.status === 404)) {
        const message = handleServiceError(error, "Esta conversa nao esta mais disponivel.");
        if (message) {
          recoverUnavailableConversation(message);
        }
        return;
      }
      applyServiceError(setThreadError, error, "Nao foi possivel enviar a imagem.");
    } finally {
      setUploadingMedia(false);
    }
  }, [
    activeConversationId,
    activeFriend,
    activeGroup,
    applyServiceError,
    handleServiceError,
    recoverUnavailableConversation,
    refreshSocialChatNotifications,
    scrollMessagesToBottom,
  ]);

  const handleToggleMute = useCallback(async () => {
    if (!activeConversationId || (!activeFriend && !activeGroup)) return;

    setActionsMenuAnchor(null);
    setThreadError(null);

    try {
      const payload = await muteSocialConversation(activeConversationId, {
        muted: !activeConversationMuted,
      });

      setHub((current) => {
        if (activeFriend) {
          return updateHubFriend(current, activeFriend.friend_user_id, (friend) => ({
            ...friend,
            notifications_muted: payload.muted,
          }));
        }
        if (activeGroup) {
          return updateHubGroup(current, activeGroup.id, (conversation) => ({
            ...conversation,
            notifications_muted: payload.muted,
          }));
        }
        return current;
      });
    } catch (error) {
      applyServiceError(setThreadError, error, "Nao foi possivel atualizar o silencio desta conversa.");
    }
  }, [activeConversationId, activeConversationMuted, activeFriend, activeGroup, applyServiceError]);

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
      closeConversation();
    } catch (error) {
      applyServiceError(setHubError, error, "Nao foi possivel desfazer esta amizade.");
    }
  }, [activeFriend, applyServiceError, closeConversation]);

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
      closeConversation();
      void refreshSocialChatNotifications({ force: true });
    } catch (error) {
      applyServiceError(setHubError, error, "Nao foi possivel bloquear este usuario.");
    }
  }, [activeFriend, applyServiceError, closeConversation, refreshSocialChatNotifications]);

  const handleOpenMediaLibrary = useCallback(() => {
    if (!activeConversationId) return;
    setActionsMenuAnchor(null);
    setMediaModalOpen(true);
  }, [activeConversationId]);

  const handleFocusAddFriend = useCallback(() => {
    setActionsMenuAnchor(null);
    closeConversation();
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [closeConversation]);

  const handleOpenCreateGroup = useCallback(() => {
    setActionsMenuAnchor(null);
    setGroupActionError(null);
    setGroupModalOpen(true);
  }, []);

  const handleOpenPrivacy = useCallback(() => {
    setActionsMenuAnchor(null);
    setPrivacyActionError(null);
    setPrivacyModalOpen(true);
  }, []);

  const handleToggleGroupMember = useCallback((friendUserId: string) => {
    setGroupMemberUserIds((current) =>
      current.includes(friendUserId)
        ? current.filter((value) => value !== friendUserId)
        : [...current, friendUserId].slice(0, 20),
    );
  }, []);

  const handleCreateGroupConversation = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedTitle = groupTitle.trim();
    if (normalizedTitle.length < 2) {
      setGroupActionError("Dê um nome curto para o grupo.");
      return;
    }
    if (groupMemberUserIds.length < 2) {
      setGroupActionError("Selecione pelo menos dois amigos para montar o grupo.");
      return;
    }

    setGroupActionLoading(true);
    setGroupActionError(null);

    try {
      const conversation = await createSocialGroupConversation({
        title: normalizedTitle,
        member_user_ids: groupMemberUserIds,
      });
      setHub((current) => ({
        ...current,
        groups: [conversation, ...current.groups.filter((item) => item.id !== conversation.id)],
      }));
      setGroupModalOpen(false);
      setGroupTitle("");
      setGroupMemberUserIds([]);
      startTransition(() => {
        setSelectedFriendUserId(null);
        setSelectedGroupConversationId(conversation.id);
      });
      setConversationParam(conversation.id);
      scrollMessagesToBottom();
    } catch (error) {
      applyServiceError(setGroupActionError, error, "Nao foi possivel criar o grupo agora.");
    } finally {
      setGroupActionLoading(false);
    }
  }, [applyServiceError, groupMemberUserIds, groupTitle, scrollMessagesToBottom, setConversationParam]);

  const handleTogglePreference = useCallback(async (key: keyof SocialUserPreferences) => {
    const previousPreferences = hub.preferences;
    const nextPreferences: SocialUserPreferences = {
      ...previousPreferences,
      [key]: !previousPreferences[key],
    };

    setPrivacyActionLoadingKey(key);
    setPrivacyActionError(null);
    setHub((current) => ({
      ...current,
      preferences: nextPreferences,
    }));

    try {
      const savedPreferences = await updateSocialPreferences(nextPreferences);
      setHub((current) => ({
        ...current,
        preferences: savedPreferences,
      }));
    } catch (error) {
      setHub((current) => ({
        ...current,
        preferences: previousPreferences,
      }));
      applyServiceError(setPrivacyActionError, error, "Nao foi possivel atualizar sua privacidade.");
    } finally {
      setPrivacyActionLoadingKey((current) => (current === key ? null : current));
    }
  }, [applyServiceError, hub.preferences]);

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
      contentClassName={isConversationOpen ? "h-[100dvh] max-h-[100dvh] overflow-hidden" : undefined}
      hideNavigation={isConversationOpen}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          isConversationOpen
            ? "h-[100dvh] max-h-[100dvh] overflow-hidden"
            : "p-4 pb-[98px] md:px-8 md:pb-8",
        )}
      >
        <div
          className={cn(
            "flex min-h-0 w-full flex-1",
            isConversationOpen ? "h-full" : "mx-auto max-w-[78rem] gap-4 md:gap-6",
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
                  Mensagens
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
                    label="Abrir acoes do Social Hub"
                    onClick={() => {
                      toggleActionsMenu("list");
                      setNotificationModalOpen(false);
                    }}
                  />
                  {actionsMenuAnchor === "list" ? (
                    <ConversationActionsMenu
                      activeFriend={activeFriend}
                      activeGroup={activeGroup}
                      onAddFriend={handleFocusAddFriend}
                      onCreateGroup={handleOpenCreateGroup}
                      onOpenPrivacy={handleOpenPrivacy}
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
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                }}
                placeholder="Buscar conversas ou pessoas"
                className="fl-social-hub-search h-12 w-full rounded-full pl-11 pr-4 text-sm outline-none transition-colors"
              />

              {showRemoteSearchPanel ? (
                <div className="absolute inset-x-0 top-[calc(100%+0.85rem)] z-20 overflow-hidden rounded-[1.9rem] border border-[color:var(--fl-social-hub-muted-border)] bg-[color:var(--fl-social-hub-card-bg)] shadow-[0_22px_64px_rgba(15,23,42,0.16)]">
                  <div className="flex items-center justify-between gap-3 border-b border-[color:var(--fl-social-hub-muted-border)] px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[0.72rem] font-black uppercase tracking-[0.18em] text-[color:var(--fl-color-text-muted)]">
                        Encontrar pessoas
                      </p>
                      <p className="mt-1 truncate text-sm text-[color:var(--fl-color-text-muted)]">
                        Envie o pedido de amizade direto daqui.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {remoteSearchLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[color:var(--fl-color-text-muted)]" />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery("");
                        }}
                        className="fl-social-hub-icon-button flex h-9 w-9 items-center justify-center rounded-full"
                        aria-label="Fechar busca"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[18.5rem] space-y-3 overflow-y-auto px-4 py-4">
                    {visibleRemoteResults.length > 0 ? (
                      visibleRemoteResults.map((result) => (
                        <SearchResultRow
                          key={result.user_id}
                          result={result}
                          busy={sendingRequestUserId === result.user_id}
                          sent={sentRequestUserIds.has(result.user_id)}
                          onSend={() => {
                            void handleSendFriendRequest(result);
                          }}
                        />
                      ))
                    ) : remoteSearchLoading ? (
                      <div className="flex h-24 items-center justify-center">
                        <LoadingBall size="sm" />
                      </div>
                    ) : (
                      <div className="fl-social-hub-soft-card rounded-[1.6rem] px-4 py-4 text-sm text-[color:var(--fl-color-text-muted)]">
                        Nenhum usuario visivel encontrado para essa busca.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {hubError ? (
              <div className="mt-4 rounded-[1.4rem] border border-[#ef4444]/20 bg-[#ef4444]/[0.08] px-4 py-3 text-sm text-[#b42318]">
                {hubError}
              </div>
            ) : null}

            <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
              {conversationEntries.length > 0 ? (
                <div>
                  {conversationEntries.map((entry) => (
                    entry.kind === "direct" ? (
                      <FriendRow
                        key={entry.key}
                        friend={entry.friend}
                        active={entry.active}
                        busy={entry.busy}
                        onClick={() => {
                          void openFriendConversation(entry.friend);
                        }}
                      />
                    ) : (
                      <GroupConversationRow
                        key={entry.key}
                        conversation={entry.conversation}
                        active={entry.active}
                        onClick={() => {
                          openGroupConversation(entry.conversation);
                        }}
                      />
                    )
                  ))}
                </div>
              ) : hub.friends.length > 0 || hub.groups.length > 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                  <p className="text-base font-semibold text-[color:var(--fl-color-text)]">Nada por aqui</p>
                  <p className="mt-2 max-w-[15rem] text-sm leading-relaxed text-[color:var(--fl-color-text-muted)]">
                    Ajuste a busca para encontrar uma conversa, um grupo ou procurar alguem novo.
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

            </div>
          </section>

          <section
            className={cn(
              "fl-social-hub-thread-panel min-h-0 flex-1 overflow-hidden",
              isConversationOpen
                ? "fixed inset-x-0 top-0 z-[80] flex h-[100dvh] w-full rounded-none border-0 shadow-none"
                : "hidden rounded-[2.25rem] md:flex",
              "flex-col overflow-hidden",
            )}
            style={
              isConversationOpen && conversationViewportFrame
                ? {
                    top: `${conversationViewportFrame.offsetTop}px`,
                    height: `${conversationViewportFrame.height}px`,
                  }
                : undefined
            }
          >
            {activeFriend || activeGroup ? (
              <>
                <header
                  className={cn(
                    "fl-social-hub-thread-header flex shrink-0 items-center gap-3 border-b px-4 py-4",
                    isConversationOpen ? "md:px-8" : "md:px-6",
                  )}
                  style={
                    isConversationOpen
                      ? { paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)" }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      closeConversation();
                    }}
                    className="fl-social-hub-icon-button flex h-10 w-10 items-center justify-center rounded-full"
                    aria-label="Voltar para a lista"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  {activeFriend ? (
                    <FriendPresenceAvatar
                      src={activeFriend.friend_avatar_url}
                      name={activeFriendDisplayName}
                      isOnline={activeFriend.is_online}
                      className="shrink-0"
                    />
                  ) : (
                    <Avatar
                      src={activeGroup?.avatar_url ?? null}
                      name={activeGroupDisplayName}
                      className="h-14 w-14 border border-[color:var(--fl-social-hub-muted-border)]"
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[color:var(--fl-color-text)] md:text-base">
                      {activeFriend ? activeFriendDisplayName : activeGroupDisplayName}
                    </p>
                    <p className="truncate text-[0.78rem] text-[color:var(--fl-color-text-muted)]">
                      {activeFriend
                        ? `@${activeFriend.friend_username}`
                        : `${toNonNegativeNumber(activeGroup?.member_count)} membros`}
                    </p>
                  </div>

                  <div className="relative" data-social-hub-actions-root>
                    <HeaderIconButton
                      icon={MoreVertical}
                      label="Abrir acoes do chat"
                      onClick={() => {
                        toggleActionsMenu("thread");
                        setNotificationModalOpen(false);
                      }}
                    />
                    {actionsMenuAnchor === "thread" ? (
                      <ConversationActionsMenu
                        activeFriend={activeFriend}
                        activeGroup={activeGroup}
                        onAddFriend={handleFocusAddFriend}
                        onCreateGroup={handleOpenCreateGroup}
                        onOpenPrivacy={handleOpenPrivacy}
                        onOpenMediaLibrary={handleOpenMediaLibrary}
                        onToggleMute={handleToggleMute}
                        onRemoveFriend={handleRemoveFriend}
                        onBlockFriend={handleBlockFriend}
                      />
                    ) : null}
                  </div>
                </header>

                <div
                  ref={messagesViewportRef}
                  className={cn(
                    "min-h-0 flex-1 overflow-y-auto px-4 py-5 overscroll-contain",
                    isConversationOpen ? "md:px-8 md:py-7" : "md:px-6 md:py-6",
                  )}
                  style={{ scrollPaddingBottom: "6rem" }}
                >
                  {threadError ? (
                    <div className="mb-4 rounded-[1.4rem] border border-[#ef4444]/20 bg-[#ef4444]/[0.08] px-4 py-3 text-sm text-[#b42318]">
                      {threadError}
                    </div>
                  ) : null}

                  {messagesLoading && threadConversationId !== activeConversationId ? (
                    <div className="flex min-h-full items-center justify-center">
                      <LoadingBall size="sm" />
                    </div>
                  ) : messages.length > 0 ? (
                    <div className="flex flex-col">
                      {messageBubbleLayouts.map((layout) => (
                        <ConversationBubble
                          key={layout.message.id}
                          layout={layout}
                          onOpenActions={handleOpenMessageActions}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
                      <MessageCircle className="h-10 w-10 text-[color:var(--fl-color-text-muted)] opacity-40" />
                      <p className="mt-4 text-base font-semibold text-[color:var(--fl-color-text)]">Conversa pronta</p>
                      <p className="mt-2 max-w-[19rem] text-sm leading-relaxed text-[color:var(--fl-color-text-muted)]">
                        Escreva a primeira mensagem para abrir esse chat com {activeFriend ? activeFriendDisplayName : activeGroupDisplayName}.
                      </p>
                    </div>
                  )}
                </div>

                <div
                  className={cn(
                    "fl-social-hub-composer-shell shrink-0 border-t px-4 py-4",
                    isConversationOpen ? "md:px-8" : "md:px-6",
                  )}
                  style={{
                    paddingBottom:
                      isConversationOpen
                        ? "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)"
                        : undefined,
                  }}
                >
                  {editingMessage ? (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-[1.2rem] border border-[color:var(--fl-social-hub-muted-border)] bg-black/[0.03] px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[0.72rem] font-black uppercase tracking-[0.16em] text-[color:var(--fl-color-text-muted)]">
                          Editando mensagem
                        </p>
                        <p className="truncate text-sm text-[color:var(--fl-color-text)]">
                          {editingMessage.message_text}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCancelEditingMessage}
                        className="fl-social-hub-icon-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                        aria-label="Cancelar edicao"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
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
                        ref={messageInputRef}
                        type="text"
                        value={messageInput}
                        onChange={(event) => {
                          setMessageInput(event.target.value);
                        }}
                        onFocus={() => {
                          window.requestAnimationFrame(() => {
                            scrollMessagesToBottom();
                          });
                        }}
                        placeholder="Mensagem"
                        className="fl-social-hub-composer-input h-12 min-w-0 flex-1 border-none bg-transparent text-sm outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={!activeConversationId || sendingMessage || messageInput.trim().length === 0}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:var(--fl-color-text)] text-[color:var(--app-bg-color)] transition-transform hover:scale-[1.02] disabled:opacity-45"
                      aria-label={editingMessage ? "Salvar edicao da mensagem" : "Enviar mensagem"}
                    >
                      {sendingMessage ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : editingMessage ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <SendHorizontal className="h-4 w-4" />
                      )}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <MessageCircle className="h-12 w-12 text-[color:var(--fl-color-text-muted)] opacity-35" />
                <p className="mt-5 text-lg font-semibold text-[color:var(--fl-color-text)]">Selecione uma conversa</p>
                <p className="mt-2 max-w-[24rem] text-sm leading-relaxed text-[color:var(--fl-color-text-muted)]">
                  Escolha um contato ou grupo da lista para abrir o chat. Os pedidos recebidos ficam no sino e o menu de acoes aparece ao lado dele.
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
                  Arquivos compartilhados em {activeFriend ? activeFriendDisplayName : activeGroupDisplayName || "esta conversa"}.
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

      {groupModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[color:var(--fl-social-hub-overlay)] p-4 md:items-center">
          <button
            type="button"
            onClick={() => {
              if (groupActionLoading) return;
              setGroupModalOpen(false);
            }}
            className="absolute inset-0"
            aria-label="Fechar criacao de grupo"
          />
          <div className="fl-social-hub-modal relative z-10 w-full max-w-[32rem] rounded-[2rem] p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-[color:var(--fl-color-text)]">Criar grupo</p>
                <p className="mt-1 text-sm text-[color:var(--fl-color-text-muted)]">
                  Escolha pelo menos dois amigos e defina um nome curto para o grupo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (groupActionLoading) return;
                  setGroupModalOpen(false);
                }}
                className="fl-social-hub-icon-button flex h-10 w-10 items-center justify-center rounded-full"
                aria-label="Fechar criacao de grupo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGroupConversation} className="mt-5 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-[0.18em] text-[color:var(--fl-color-text-muted)]">
                  Nome do grupo
                </label>
                <input
                  type="text"
                  value={groupTitle}
                  onChange={(event) => {
                    setGroupTitle(event.target.value);
                  }}
                  placeholder="Ex.: Arena dos monstros"
                  className="fl-social-hub-search h-12 w-full rounded-[1.3rem] px-4 text-sm outline-none"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-[color:var(--fl-color-text-muted)]">
                    Amigos
                  </label>
                  <span className="text-xs text-[color:var(--fl-color-text-muted)]">
                    {groupMemberUserIds.length} selecionado(s)
                  </span>
                </div>
                <div className="max-h-[18rem] space-y-3 overflow-y-auto pr-1">
                  {sortedFriends.length > 0 ? (
                    sortedFriends.map((friend) => {
                      const selected = groupMemberUserIds.includes(friend.friend_user_id);
                      return (
                        <button
                          key={friend.friend_user_id}
                          type="button"
                          onClick={() => {
                            handleToggleGroupMember(friend.friend_user_id);
                          }}
                          className={cn(
                            "fl-social-hub-soft-card flex w-full items-center gap-3 rounded-[1.4rem] px-4 py-3 text-left transition-colors",
                            selected ? "ring-2 ring-[color:var(--app-primary-color)]" : "",
                          )}
                        >
                          <FriendPresenceAvatar
                            src={friend.friend_avatar_url}
                            name={getFriendDisplayName(friend)}
                            isOnline={friend.is_online}
                            className="scale-[0.92]"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-[color:var(--fl-color-text)]">
                              {getFriendDisplayName(friend)}
                            </p>
                            <p className="truncate text-xs text-[color:var(--fl-color-text-muted)]">
                              @{friend.friend_username}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-black transition-colors",
                              selected
                                ? "border-[color:var(--app-primary-color)] bg-[color:var(--app-primary-color)] text-[color:var(--fl-nav-item-active-text)]"
                                : "border-[color:var(--fl-social-hub-muted-border)] text-[color:var(--fl-color-text-muted)]",
                            )}
                          >
                            {selected ? <Check className="h-3.5 w-3.5" /> : "+"}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="fl-social-hub-soft-card rounded-[1.6rem] px-4 py-8 text-center text-sm text-[color:var(--fl-color-text-muted)]">
                      Adicione amigos primeiro para criar o seu grupo.
                    </div>
                  )}
                </div>
              </div>

              {groupActionError ? (
                <div className="rounded-[1.4rem] border border-[#ef4444]/20 bg-[#ef4444]/[0.08] px-4 py-3 text-sm text-[#b42318]">
                  {groupActionError}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (groupActionLoading) return;
                    setGroupModalOpen(false);
                  }}
                  className="fl-social-hub-soft-card rounded-full px-4 py-2 text-sm font-semibold text-[color:var(--fl-color-text)]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={groupActionLoading || sortedFriends.length < 2}
                  className="rounded-full bg-[color:var(--fl-color-text)] px-5 py-2.5 text-sm font-black uppercase tracking-[0.14em] text-[color:var(--app-bg-color)] disabled:opacity-45"
                >
                  {groupActionLoading ? "Criando..." : "Criar grupo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {privacyModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[color:var(--fl-social-hub-overlay)] p-4 md:items-center">
          <button
            type="button"
            onClick={() => {
              if (privacyActionLoadingKey) return;
              setPrivacyModalOpen(false);
            }}
            className="absolute inset-0"
            aria-label="Fechar configuracoes de privacidade"
          />
          <div className="fl-social-hub-modal relative z-10 w-full max-w-[30rem] rounded-[2rem] p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-[color:var(--fl-color-text)]">Privacidade</p>
                <p className="mt-1 text-sm text-[color:var(--fl-color-text-muted)]">
                  Controle como voce aparece no Social Hub e quem pode iniciar novas conexoes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (privacyActionLoadingKey) return;
                  setPrivacyModalOpen(false);
                }}
                className="fl-social-hub-icon-button flex h-10 w-10 items-center justify-center rounded-full"
                aria-label="Fechar privacidade"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <PrivacyPreferenceRow
                title="Mostrar status online"
                description="Exibe a bolinha de online para seus amigos quando voce estiver ativo."
                checked={hub.preferences.show_online_status}
                disabled={privacyActionLoadingKey !== null}
                onToggle={() => {
                  void handleTogglePreference("show_online_status");
                }}
              />
              <PrivacyPreferenceRow
                title="Receber pedidos de amizade"
                description="Permite que outras pessoas encontrem seu perfil e enviem novas solicitacoes."
                checked={hub.preferences.allow_friend_requests}
                disabled={privacyActionLoadingKey !== null}
                onToggle={() => {
                  void handleTogglePreference("allow_friend_requests");
                }}
              />
              <PrivacyPreferenceRow
                title="Permitir convites para grupos"
                description="Autoriza seus amigos a incluir voce em novos grupos do Social Hub."
                checked={hub.preferences.allow_group_invites}
                disabled={privacyActionLoadingKey !== null}
                onToggle={() => {
                  void handleTogglePreference("allow_group_invites");
                }}
              />
            </div>

            {privacyActionError ? (
              <div className="mt-4 rounded-[1.4rem] border border-[#ef4444]/20 bg-[#ef4444]/[0.08] px-4 py-3 text-sm text-[#b42318]">
                {privacyActionError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <MessageActionsMenu
        target={messageActionsTarget}
        busy={sendingMessage}
        onClose={handleCloseMessageActions}
        onCopy={() => {
          void handleCopyMessage();
        }}
        onEdit={handleStartEditingMessage}
        onDelete={() => {
          void handleDeleteMessage();
        }}
      />
    </AppPageShell>
  );
}
