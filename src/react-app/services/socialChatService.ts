import {
  api,
  fetchJson,
  isApiTimeoutError,
  isExpectedApiCancellation,
} from "@/react-app/utils/api";
import type {
  ConsumeSocialChatNotificationsRequest,
  SocialChatNotification,
  SocialConversationKind,
  SocialConversationMessage,
  SocialConversationMessageMedia,
  SocialConversationMessageRequest,
  SocialConversationMessageUpdateRequest,
  SocialConversationMessageMutationResponse,
  SocialConversationMessagesResponse,
  SocialConversationMuteRequest,
  SocialConversationPreview,
  SocialConversationReadRequest,
  SocialDirectConversationRequest,
  SocialGroupConversationRequest,
  SocialHubBundle,
  SocialHubFriendItem,
  SocialHubFriendRequest,
  SocialUnreadSummary,
  SocialUserPreferences,
  SocialUserPreferencesUpdateRequest,
} from "@/shared/types";

const SOCIAL_CONVERSATIONS_CACHE_TTL_MS = 10_000;
const SOCIAL_HUB_CACHE_TTL_MS = 10_000;

type SocialChatApiErrorCode = "UNAUTHORIZED" | "REQUEST_FAILED";

type ConversationCacheEntry = {
  cachedAt: number;
  data: SocialConversationPreview[];
};

type HubCacheEntry = {
  cachedAt: number;
  data: SocialHubBundle;
};

export class SocialChatApiError extends Error {
  readonly code: SocialChatApiErrorCode;
  readonly status: number;

  constructor(code: SocialChatApiErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const conversationsCache = new Map<string, ConversationCacheEntry>();
const inflightConversationRequests = new Map<string, Promise<SocialConversationPreview[]>>();
let socialHubCache: HubCacheEntry | null = null;
let inflightSocialHubRequest: Promise<SocialHubBundle> | null = null;
let inflightSocialUnreadSummaryRequest: Promise<SocialUnreadSummary> | null = null;

function isUnauthorized(status: number): boolean {
  return status === 401 || status === 403;
}

function toTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function normalizeMedia(media: SocialConversationMessageMedia): SocialConversationMessageMedia {
  return {
    ...media,
    id: toNonNegativeNumber(media.id),
    public_url: media.public_url,
  };
}

function normalizeMessage(message: SocialConversationMessage): SocialConversationMessage {
  return {
    ...message,
    id: toNonNegativeNumber(message.id),
    conversation_id: toNonNegativeNumber(message.conversation_id),
    sender_avatar_url: toTrimmedString(message.sender_avatar_url) ?? null,
    message_text: typeof message.message_text === "string" ? message.message_text : "",
    message_kind: message.message_kind === "image" ? "image" : "text",
    edited_at: toTrimmedString(message.edited_at) ?? null,
    media: message.media ? normalizeMedia(message.media) : null,
    is_own_message: message.is_own_message === true,
  };
}

function normalizeConversation(conversation: SocialConversationPreview): SocialConversationPreview {
  return {
    ...conversation,
    id: toNonNegativeNumber(conversation.id),
    avatar_url: toTrimmedString(conversation.avatar_url) ?? null,
    title: toTrimmedString(conversation.title) ?? null,
    member_count: toNonNegativeNumber(conversation.member_count),
    unread_count: toNonNegativeNumber(conversation.unread_count),
    last_message_id: toNullablePositiveNumber(conversation.last_message_id),
    last_message_preview: toTrimmedString(conversation.last_message_preview) ?? null,
    last_message_at: toTrimmedString(conversation.last_message_at) ?? null,
    notifications_muted: conversation.notifications_muted === true,
    participants: Array.isArray(conversation.participants)
      ? conversation.participants.map((participant) => ({
          ...participant,
          avatar_url: toTrimmedString(participant.avatar_url) ?? null,
          is_online: participant.is_online === true,
        }))
      : [],
  };
}

function normalizeHubFriendItem(friend: SocialHubFriendItem): SocialHubFriendItem {
  return {
    ...friend,
    id: toNonNegativeNumber(friend.id),
    friend_avatar_url: toTrimmedString(friend.friend_avatar_url) ?? null,
    last_heartbeat_at: toTrimmedString(friend.last_heartbeat_at) ?? null,
    direct_conversation_id: toNullablePositiveNumber(friend.direct_conversation_id),
    unread_count: toNonNegativeNumber(friend.unread_count),
    last_message_preview: toTrimmedString(friend.last_message_preview) ?? null,
    last_message_at: toTrimmedString(friend.last_message_at) ?? null,
    notifications_muted: friend.notifications_muted === true,
    is_online: friend.is_online === true,
  };
}

function normalizeHubFriendRequest(request: SocialHubFriendRequest): SocialHubFriendRequest {
  return {
    ...request,
    id: toNonNegativeNumber(request.id),
    friend_avatar_url: toTrimmedString(request.friend_avatar_url) ?? null,
  };
}

function normalizeSocialUserPreferences(
  preferences: SocialUserPreferences | null | undefined,
): SocialUserPreferences {
  return {
    show_online_status: preferences?.show_online_status !== false,
    allow_friend_requests: preferences?.allow_friend_requests !== false,
    allow_group_invites: preferences?.allow_group_invites !== false,
  };
}

function normalizeSocialHubBundle(bundle: SocialHubBundle): SocialHubBundle {
  return {
    friends: Array.isArray(bundle.friends) ? bundle.friends.map(normalizeHubFriendItem) : [],
    pending_requests: Array.isArray(bundle.pending_requests)
      ? bundle.pending_requests.map(normalizeHubFriendRequest)
      : [],
    groups: Array.isArray(bundle.groups) ? bundle.groups.map(normalizeConversation) : [],
    preferences: normalizeSocialUserPreferences(bundle.preferences),
  };
}

function normalizeNotification(notification: SocialChatNotification): SocialChatNotification {
  return {
    ...notification,
    conversation_id: toNonNegativeNumber(notification.conversation_id),
    message_id: toNonNegativeNumber(notification.message_id),
    sender_avatar_url: toTrimmedString(notification.sender_avatar_url) ?? null,
    message_text: typeof notification.message_text === "string" ? notification.message_text : "",
  };
}

function normalizeUnreadSummary(summary: SocialUnreadSummary): SocialUnreadSummary {
  const conversations = Array.isArray(summary.conversations)
    ? summary.conversations
        .map((conversation) => ({
          conversation_id: toNonNegativeNumber(conversation.conversation_id),
          unread_count: toNonNegativeNumber(conversation.unread_count),
          direct_peer_user_id: toTrimmedString(conversation.direct_peer_user_id) ?? null,
        }))
        .filter((conversation) => conversation.conversation_id > 0 && conversation.unread_count > 0)
    : [];

  const totalUnreadCount = conversations.reduce(
    (total, conversation) => total + conversation.unread_count,
    0,
  );

  return {
    total_unread_count: totalUnreadCount,
    conversations,
  };
}

async function readApiErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string | undefined }
    | null;
  return payload?.error?.trim() || fallbackMessage;
}

function parseSocialChatApiError(error: unknown): never {
  if (isExpectedApiCancellation(error)) {
    throw error;
  }

  if (isApiTimeoutError(error)) {
    throw new SocialChatApiError("REQUEST_FAILED", 504, error.message || "Tempo limite no Social Hub.");
  }

  if (error instanceof Error && "status" in error) {
    const status = Number((error as { status?: number }).status ?? 0);
    if (isUnauthorized(status)) {
      throw new SocialChatApiError("UNAUTHORIZED", status, "Sessao expirada.");
    }
    throw new SocialChatApiError("REQUEST_FAILED", status, error.message || "Falha no Social Hub.");
  }

  throw new SocialChatApiError("REQUEST_FAILED", 500, "Falha no Social Hub.");
}

async function parseJsonBody<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (isUnauthorized(response.status)) {
    throw new SocialChatApiError("UNAUTHORIZED", response.status, "Sessao expirada.");
  }

  if (!response.ok) {
    throw new SocialChatApiError(
      "REQUEST_FAILED",
      response.status,
      await readApiErrorMessage(response, fallbackMessage),
    );
  }

  const payload = (await response.json().catch(() => null)) as T | null;
  if (payload === null) {
    throw new SocialChatApiError("REQUEST_FAILED", 502, fallbackMessage);
  }

  return payload;
}

function cloneSocialHubBundle(bundle: SocialHubBundle): SocialHubBundle {
  return {
    friends: [...bundle.friends],
    pending_requests: [...bundle.pending_requests],
    groups: [...bundle.groups],
    preferences: { ...bundle.preferences },
  };
}

export function clearSocialChatCache(): void {
  conversationsCache.clear();
  socialHubCache = null;
}

export async function fetchSocialHubBundle(
  options: { forceRefresh?: boolean } = {},
): Promise<SocialHubBundle> {
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && socialHubCache) {
    const age = Date.now() - socialHubCache.cachedAt;
    if (age < SOCIAL_HUB_CACHE_TTL_MS) {
      return cloneSocialHubBundle(socialHubCache.data);
    }
  }

  if (inflightSocialHubRequest) {
    return inflightSocialHubRequest;
  }

  inflightSocialHubRequest = fetchJson<SocialHubBundle>("/api/social/hub", {
    orchestrationKey: "social-chat:hub",
    orchestrationPolicy: "join",
    requestClass: "background",
  })
    .then((payload) => {
      const normalized = normalizeSocialHubBundle(payload);
      socialHubCache = {
        cachedAt: Date.now(),
        data: normalized,
      };
      return cloneSocialHubBundle(normalized);
    })
    .catch((error) => parseSocialChatApiError(error))
    .finally(() => {
      inflightSocialHubRequest = null;
    });

  return inflightSocialHubRequest;
}

export async function listSocialConversations(
  options: {
    forceRefresh?: boolean;
    kind?: SocialConversationKind | "all";
  } = {},
): Promise<SocialConversationPreview[]> {
  const kind = options.kind && options.kind !== "all" ? options.kind : "all";
  const cacheKey = `kind:${kind}`;
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh) {
    const cached = conversationsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SOCIAL_CONVERSATIONS_CACHE_TTL_MS) {
      return [...cached.data];
    }
  }

  const inflight = inflightConversationRequests.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const search = kind === "all" ? "" : `?kind=${encodeURIComponent(kind)}`;
  const request = fetchJson<SocialConversationPreview[]>(
    `/api/social/conversations${search}`,
    {
      orchestrationKey: `social-chat:conversations:${kind}`,
      orchestrationPolicy: "join",
      requestClass: "background",
    },
  )
    .then((payload) => {
      const normalized = Array.isArray(payload) ? payload.map(normalizeConversation) : [];
      conversationsCache.set(cacheKey, {
        cachedAt: Date.now(),
        data: normalized,
      });
      return [...normalized];
    })
    .catch((error) => parseSocialChatApiError(error))
    .finally(() => {
      inflightConversationRequests.delete(cacheKey);
    });

  inflightConversationRequests.set(cacheKey, request);
  return request;
}

export async function fetchSocialConversationMessages(
  conversationId: number,
  options: {
    beforeMessageId?: number | undefined;
    limit?: number | undefined;
  } = {},
): Promise<SocialConversationMessagesResponse> {
  const search = new URLSearchParams();
  if (typeof options.beforeMessageId === "number" && options.beforeMessageId > 0) {
    search.set("before_id", String(options.beforeMessageId));
  }
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    search.set("limit", String(options.limit));
  }

  try {
    const payload = await fetchJson<SocialConversationMessagesResponse>(
      `/api/social/conversations/${conversationId}/messages${search.size > 0 ? `?${search}` : ""}`,
      {
        orchestrationKey: `social-chat:messages:${conversationId}`,
        orchestrationPolicy: "join",
        requestClass: "background",
      },
    );

    return {
      conversation: normalizeConversation(payload.conversation),
      messages: Array.isArray(payload.messages)
        ? payload.messages.map(normalizeMessage)
        : [],
    };
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function listSocialConversationMedia(
  conversationId: number,
  options: { limit?: number | undefined } = {},
): Promise<SocialConversationMessageMedia[]> {
  const search = new URLSearchParams();
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    search.set("limit", String(options.limit));
  }

  try {
    const payload = await fetchJson<SocialConversationMessageMedia[]>(
      `/api/social/conversations/${conversationId}/media${search.size > 0 ? `?${search}` : ""}`,
      {
        orchestrationKey: `social-chat:media:${conversationId}`,
        orchestrationPolicy: "join",
        requestClass: "background",
      },
    );
    return Array.isArray(payload) ? payload.map(normalizeMedia) : [];
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function startDirectSocialConversation(
  request: SocialDirectConversationRequest,
): Promise<SocialConversationPreview> {
  try {
    const payload = await fetchJson<SocialConversationPreview>(
      "/api/social/conversations/direct",
      {
        method: "POST",
        body: JSON.stringify(request),
        orchestrationKey: `social-chat:direct:${request.friend_user_id.trim()}`,
        orchestrationPolicy: "join",
      },
    );
    clearSocialChatCache();
    return normalizeConversation(payload);
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function createSocialGroupConversation(
  request: SocialGroupConversationRequest,
): Promise<SocialConversationPreview> {
  try {
    const payload = await fetchJson<SocialConversationPreview>("/api/social/groups", {
      method: "POST",
      body: JSON.stringify(request),
    });
    clearSocialChatCache();
    return normalizeConversation(payload);
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function sendSocialConversationMessage(
  conversationId: number,
  request: SocialConversationMessageRequest,
): Promise<{
  conversation: SocialConversationPreview | null;
  message: SocialConversationMessage;
}> {
  try {
    const payload = await fetchJson<{
      conversation: SocialConversationPreview | null;
      message: SocialConversationMessage;
    }>(`/api/social/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(request),
      requestClass: "foreground",
    });

    clearSocialChatCache();
    return {
      conversation: payload.conversation ? normalizeConversation(payload.conversation) : null,
      message: normalizeMessage(payload.message),
    };
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function updateSocialConversationMessage(
  conversationId: number,
  messageId: number,
  request: SocialConversationMessageUpdateRequest,
): Promise<{
  conversation: SocialConversationPreview | null;
  message: SocialConversationMessage;
}> {
  try {
    const payload = await fetchJson<SocialConversationMessageMutationResponse>(
      `/api/social/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "PATCH",
        body: JSON.stringify(request),
        requestClass: "foreground",
      },
    );

    clearSocialChatCache();
    if (!payload.message) {
      throw new SocialChatApiError("REQUEST_FAILED", 502, "Resposta invalida ao editar mensagem.");
    }

    return {
      conversation: payload.conversation ? normalizeConversation(payload.conversation) : null,
      message: normalizeMessage(payload.message),
    };
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function deleteSocialConversationMessage(
  conversationId: number,
  messageId: number,
): Promise<{
  conversation: SocialConversationPreview | null;
  deletedMessageId: number;
}> {
  try {
    const payload = await fetchJson<SocialConversationMessageMutationResponse>(
      `/api/social/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "DELETE",
        requestClass: "foreground",
      },
    );

    clearSocialChatCache();
    return {
      conversation: payload.conversation ? normalizeConversation(payload.conversation) : null,
      deletedMessageId: toNonNegativeNumber(payload.deleted_message_id),
    };
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function uploadSocialConversationMedia(
  conversationId: number,
  input: {
    file: File;
    caption?: string | null | undefined;
  },
): Promise<{
  conversation: SocialConversationPreview | null;
  message: SocialConversationMessage;
}> {
  const formData = new FormData();
  formData.set("file", input.file);
  if (typeof input.caption === "string" && input.caption.trim().length > 0) {
    formData.set("caption", input.caption.trim());
  }

  try {
    const response = await api(`/api/social/conversations/${conversationId}/media`, {
      method: "POST",
      body: formData,
      timeoutMs: 45_000,
      orchestrationKey: `social-chat:upload:${conversationId}`,
      orchestrationPolicy: "replace",
      requestClass: "foreground",
    });

    const payload = await parseJsonBody<{
      conversation: SocialConversationPreview | null;
      message: SocialConversationMessage;
    }>(response, "Falha ao enviar a midia.");

    clearSocialChatCache();
    return {
      conversation: payload.conversation ? normalizeConversation(payload.conversation) : null,
      message: normalizeMessage(payload.message),
    };
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function muteSocialConversation(
  conversationId: number,
  request: SocialConversationMuteRequest,
): Promise<{ muted: boolean }> {
  try {
    const payload = await fetchJson<{ success: boolean; muted: boolean }>(
      `/api/social/conversations/${conversationId}/mute`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
    clearSocialChatCache();
    return {
      muted: payload.muted === true,
    };
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function updateSocialPreferences(
  request: SocialUserPreferencesUpdateRequest,
): Promise<SocialUserPreferences> {
  try {
    const payload = await fetchJson<SocialUserPreferences>("/api/social/preferences", {
      method: "POST",
      body: JSON.stringify(request),
    });
    const normalized = normalizeSocialUserPreferences(payload);
    if (socialHubCache) {
      socialHubCache = {
        ...socialHubCache,
        data: {
          ...socialHubCache.data,
          preferences: normalized,
        },
      };
    }
    return normalized;
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function blockSocialUser(userId: string): Promise<void> {
  try {
    await fetchJson<{ success: boolean }>(`/api/social/users/${encodeURIComponent(userId)}/block`, {
      method: "POST",
      orchestrationKey: `social-chat:block:${userId}`,
      orchestrationPolicy: "join",
    });
    clearSocialChatCache();
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function markSocialConversationRead(
  conversationId: number,
  request: SocialConversationReadRequest = {},
): Promise<void> {
  try {
    await fetchJson<{ success: boolean }>(
      `/api/social/conversations/${conversationId}/read`,
      {
        method: "POST",
        body: JSON.stringify(request),
        orchestrationKey: `social-chat:read:${conversationId}`,
        orchestrationPolicy: "replace",
        requestClass: "background",
      },
    );
    clearSocialChatCache();
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function fetchPendingSocialChatNotifications(
  limit = 10,
): Promise<SocialChatNotification[]> {
  try {
    const payload = await fetchJson<SocialChatNotification[]>(
      `/api/social/notifications/pending?limit=${encodeURIComponent(String(limit))}`,
      {
        orchestrationKey: "social-chat:notifications",
        orchestrationPolicy: "join",
        requestClass: "background",
      },
    );

    return Array.isArray(payload) ? payload.map(normalizeNotification) : [];
  } catch (error) {
    parseSocialChatApiError(error);
  }
}

export async function fetchSocialUnreadSummary(): Promise<SocialUnreadSummary> {
  if (inflightSocialUnreadSummaryRequest) {
    return inflightSocialUnreadSummaryRequest;
  }

  inflightSocialUnreadSummaryRequest = fetchJson<SocialUnreadSummary>("/api/social/unread-summary", {
    orchestrationKey: "social-chat:unread-summary",
    orchestrationPolicy: "join",
    requestClass: "background",
  })
    .then((payload) => normalizeUnreadSummary(payload))
    .catch((error) => parseSocialChatApiError(error))
    .finally(() => {
      inflightSocialUnreadSummaryRequest = null;
    });

  return inflightSocialUnreadSummaryRequest;
}

export async function consumePendingSocialChatNotifications(
  request: ConsumeSocialChatNotificationsRequest,
): Promise<void> {
  try {
    await fetchJson<{ success: boolean }>("/api/social/notifications/consume", {
      method: "POST",
      body: JSON.stringify(request),
      requestClass: "background",
    });
  } catch (error) {
    parseSocialChatApiError(error);
  }
}
