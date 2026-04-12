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
  LockKeyhole,
  MessageCircle,
  MoreVertical,
  Search,
  SendHorizontal,
  ShieldBan,
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
  fetchSocialConversationMessages,
  fetchSocialHubBundle,
  listSocialConversationMedia,
  markSocialConversationRead,
  muteSocialConversation,
  sendSocialConversationMessage,
  SocialChatApiError,
  startDirectSocialConversation,
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
const ACTIVE_CONVERSATION_REFRESH_INTERVAL_MS = 10_000;
const SEARCH_DEBOUNCE_MS = 280;
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

type ConversationBubbleProps = {
  message: SocialConversationMessage;
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
    direct_conversation_id: conversation?.id ?? friend.direct_conversation_id ?? null,
    unread_count: Math.max(0, Number(conversation?.unread_count ?? 0)),
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
    unread_count: Math.max(0, Number(conversation?.unread_count ?? currentConversation.unread_count)),
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

function useKeyboardInset(enabled: boolean): number {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setKeyboardInset(0);
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      setKeyboardInset(0);
      return;
    }

    let frameId = 0;
    const updateInset = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        const viewportBottom = viewport.height + viewport.offsetTop;
        const inset = Math.max(0, Math.round(window.innerHeight - viewportBottom));
        setKeyboardInset(inset > 12 ? inset : 0);
      });
    };

    updateInset();
    viewport.addEventListener("resize", updateInset);
    viewport.addEventListener("scroll", updateInset);
    window.addEventListener("orientationchange", updateInset);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      viewport.removeEventListener("resize", updateInset);
      viewport.removeEventListener("scroll", updateInset);
      window.removeEventListener("orientationchange", updateInset);
    };
  }, [enabled]);

  return keyboardInset;
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
  const [selectedFriendUserId, setSelectedFriendUserId] = useState<string | null>(null);
  const [selectedGroupConversationId, setSelectedGroupConversationId] = useState<number | null>(null);
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
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMemberUserIds, setGroupMemberUserIds] = useState<string[]>([]);
  const [groupActionLoading, setGroupActionLoading] = useState(false);
  const [groupActionError, setGroupActionError] = useState<string | null>(null);
  const [privacyActionLoadingKey, setPrivacyActionLoadingKey] = useState<keyof SocialUserPreferences | null>(null);
  const [privacyActionError, setPrivacyActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const lastReadMarkerRef = useRef<string>("");
  const pendingScrollBehaviorRef = useRef<ScrollBehavior | null>(null);

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
  const activeConversationId = activeGroup?.id ?? activeFriend?.direct_conversation_id ?? null;
  const activeConversationMuted =
    activeGroup?.notifications_muted === true || activeFriend?.notifications_muted === true;
  const activeFriendDisplayName = activeFriend ? getFriendDisplayName(activeFriend) : "";
  const activeGroupDisplayName = activeGroup ? getGroupDisplayName(activeGroup) : "";
  const isConversationOpen = activeFriend !== null || activeGroup !== null;
  const keyboardInset = useKeyboardInset(androidHost && isConversationOpen);

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

  const conversationEntries = useMemo<ConversationListEntry[]>(() => {
    const directEntries: ConversationListEntry[] = filteredFriends.map((friend) => ({
      kind: "direct",
      key: `direct:${friend.friend_user_id}`,
      title: getFriendDisplayName(friend),
      subtitle: friend.last_message_preview?.trim() || `@${friend.friend_username}`,
      timestamp: friend.last_message_at,
      unreadCount: friend.unread_count,
      active: friend.friend_user_id === activeFriend?.friend_user_id,
      busy: openingConversationUserId === friend.friend_user_id,
      avatarSrc: friend.friend_avatar_url,
      avatarName: getFriendDisplayName(friend),
      showPresence: true,
      isOnline: friend.is_online === true,
      friend,
    }));

    const groupEntries: ConversationListEntry[] = filteredGroups.map((conversation) => ({
      kind: "group",
      key: `group:${conversation.id}`,
      title: getGroupDisplayName(conversation),
      subtitle: conversation.last_message_preview?.trim() || `${conversation.member_count} membros`,
      timestamp: conversation.last_message_at,
      unreadCount: conversation.unread_count,
      active: conversation.id === activeGroup?.id,
      busy: false,
      avatarSrc: conversation.avatar_url,
      avatarName: getGroupDisplayName(conversation),
      showPresence: false,
      isOnline: false,
      conversation,
    }));

    return [...directEntries, ...groupEntries].sort((left, right) => {
      const activityDelta = getConversationSortTimestamp(right.timestamp) - getConversationSortTimestamp(left.timestamp);
      if (activityDelta !== 0) return activityDelta;
      if (left.unreadCount !== right.unreadCount) return right.unreadCount - left.unreadCount;
      return left.title.localeCompare(right.title, "pt-BR", { sensitivity: "base" });
    });
  }, [activeFriend, activeGroup, filteredFriends, filteredGroups, openingConversationUserId]);

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
    setSelectedFriendUserId(null);
    setSelectedGroupConversationId(null);
    setMessages([]);
    setThreadConversationId(null);
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

  const refreshActiveConversation = useCallback(async (options?: { quiet?: boolean }) => {
    if (!activeConversationId || (!activeFriend && !activeGroup)) {
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
      setMessages((current) => (areMessagesEquivalent(current, payload.messages) ? current : payload.messages));
      setThreadConversationId(activeConversationId);
      setHub((current) => {
        if (activeFriend) {
          return applyConversationPreviewToFriend(
            current,
            activeFriend.friend_user_id,
            payload.conversation,
            payload.messages[payload.messages.length - 1] ?? null,
          );
        }
        if (activeGroup) {
          return applyConversationPreviewToGroup(
            current,
            activeGroup.id,
            payload.conversation,
            payload.messages[payload.messages.length - 1] ?? null,
          );
        }
        return current;
      });

      const lastMessage = payload.messages[payload.messages.length - 1] ?? null;
      if (lastMessage && !lastMessage.is_own_message) {
        const marker = `${activeConversationId}:${lastMessage.id}`;
        if (lastReadMarkerRef.current !== marker) {
          lastReadMarkerRef.current = marker;
          void markSocialConversationRead(activeConversationId, {
            last_read_message_id: lastMessage.id,
          })
            .then(() => {
              setHub((current) => {
                if (activeFriend) {
                  return updateHubFriend(current, activeFriend.friend_user_id, (friend) => ({
                    ...friend,
                    unread_count: 0,
                  }));
                }
                if (activeGroup) {
                  return updateHubGroup(current, activeGroup.id, (conversation) => ({
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
      applyServiceError(setThreadError, error, "Nao foi possivel carregar esta conversa agora.");
    } finally {
      setMessagesLoading(false);
    }
  }, [activeConversationId, activeFriend, activeGroup, applyServiceError, refreshSocialChatNotifications]);

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
      setThreadConversationId(null);
      return;
    }

    lastReadMarkerRef.current = "";
    void refreshActiveConversation();
    scrollMessagesToBottom();
  }, [activeConversationId, refreshActiveConversation, scrollMessagesToBottom]);

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

  const handleSubmitMessage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeConversationId || (!activeFriend && !activeGroup)) return;

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
      scrollMessagesToBottom("smooth");
      void refreshSocialChatNotifications({ force: true });
    } catch (error) {
      applyServiceError(setThreadError, error, "Nao foi possivel enviar a mensagem.");
    } finally {
      setSendingMessage(false);
    }
  }, [
    activeConversationId,
    activeFriend,
    activeGroup,
    applyServiceError,
    messageInput,
    refreshSocialChatNotifications,
    scrollMessagesToBottom,
  ]);

  const handleFileSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file || !activeConversationId || (!activeFriend && !activeGroup)) return;

    setUploadingMedia(true);
    setThreadError(null);

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
      scrollMessagesToBottom("smooth");
      void refreshSocialChatNotifications({ force: true });
    } catch (error) {
      applyServiceError(setThreadError, error, "Nao foi possivel enviar a imagem.");
    } finally {
      setUploadingMedia(false);
    }
  }, [activeConversationId, activeFriend, activeGroup, applyServiceError, refreshSocialChatNotifications, scrollMessagesToBottom]);

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
            {activeFriend || activeGroup ? (
              <>
                <header
                  className={cn(
                    "fl-social-hub-thread-header flex shrink-0 items-center gap-3 border-b px-4 py-4",
                    isConversationOpen ? "md:px-8" : "md:px-6",
                  )}
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
                        : `${Math.max(0, Number(activeGroup?.member_count ?? 0))} membros`}
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

                <div className="min-h-0 flex-1 overflow-hidden">
                  <div
                    ref={messagesViewportRef}
                    className={cn(
                      "h-full overflow-y-auto px-4 py-5 overscroll-contain",
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
                      </div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                        <MessageCircle className="h-10 w-10 text-[color:var(--fl-color-text-muted)] opacity-40" />
                        <p className="mt-4 text-base font-semibold text-[color:var(--fl-color-text)]">Conversa pronta</p>
                        <p className="mt-2 max-w-[19rem] text-sm leading-relaxed text-[color:var(--fl-color-text-muted)]">
                          Escreva a primeira mensagem para abrir esse chat com {activeFriend ? activeFriendDisplayName : activeGroupDisplayName}.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className={cn(
                    "fl-social-hub-composer-shell shrink-0 border-t px-4 py-4",
                    isConversationOpen ? "md:px-8" : "md:px-6",
                  )}
                  style={{
                    paddingBottom:
                      keyboardInset > 0
                        ? `calc(${Math.max(16, keyboardInset)}px + env(safe-area-inset-bottom, 0px))`
                        : undefined,
                  }}
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
                        onFocus={() => {
                          window.setTimeout(() => {
                            scrollMessagesToBottom();
                          }, 180);
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
    </AppPageShell>
  );
}
