import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";

import {
  ConsumeSocialChatNotificationsRequestSchema,
  SocialConversationMuteRequestSchema,
  SocialConversationMessageRequestSchema,
  SocialConversationMessageUpdateRequestSchema,
  SocialConversationReadRequestSchema,
  SocialDirectConversationRequestSchema,
  SocialGroupConversationRequestSchema,
  SocialUserPreferencesUpdateRequestSchema,
  type SocialChatNotification,
  type SocialHubBundle,
  type SocialHubFriendItem,
  type SocialConversationKind,
  type SocialConversationMessage,
  type SocialConversationMessageMedia,
  type SocialConversationParticipant,
  type SocialConversationPreview,
  type SocialUserPreferences,
} from "../../shared/types";
import {
  getErrorMessage,
  internalErrorResponse,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import type { AppContext } from "../core/types";
import {
  isSocialChatMediaStorageConfigured,
  removeStoredSocialChatMedia,
  storeSocialChatImage,
} from "../services/socialChatMedia";
import {
  areUsersBlocked,
  FRIEND_ONLINE_WINDOW_MS,
  isPresenceRelationError as isSocialPresenceLookupError,
  listAcceptedFriendsWithPresence,
  listPendingFriendRequests,
  readSocialUserPreferences,
} from "../services/socialGraph";
import type { WithTransaction } from "./contracts";

type SocialChatRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  withTransaction: WithTransaction;
};

type ConversationListRow = {
  id: number;
  conversation_kind: string;
  title: string | null;
  last_message_id: number | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
  unread_count: number;
  notifications_muted: boolean | number | string | null;
};

type ConversationParticipantRow = {
  conversation_id: number;
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  is_online?: boolean | number | string | null;
};

type ConversationMessageRow = {
  id: number;
  conversation_id: number;
  sender_user_id: string;
  sender_username: string;
  sender_full_name: string;
  sender_avatar_url: string | null;
  message_text: string | null;
  message_kind: string | null;
  created_at: string;
  edited_at: string | null;
};

type ConversationMessageMediaRow = {
  id: number;
  message_id: number;
  media_kind: string;
  public_url: string;
  created_at: string;
};

type ConversationMessageMutationRow = {
  id: number;
  conversation_id: number;
  sender_user_id: string;
  message_text: string | null;
  message_kind: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

type ConversationMessageStorageRow = {
  storage_path: string | null;
};

type ConversationLatestMessageRow = {
  id: number | null;
  message_text: string | null;
  message_kind: string | null;
  created_at: string | null;
};

type DirectConversationPeerRow = {
  user_id: string;
};

type ConversationNotificationRow = {
  conversation_id: number;
  conversation_kind: string;
  title: string | null;
  message_id: number;
  message_text: string | null;
  message_kind: string | null;
  sender_user_id: string;
  sender_username: string;
  sender_full_name: string;
  sender_avatar_url: string | null;
  created_at: string;
};

const DEFAULT_LIST_LIMIT = 60;
const DEFAULT_MESSAGE_LIMIT = 40;
const MAX_LIST_LIMIT = 100;
const MAX_MESSAGE_LIMIT = 80;
const MAX_NOTIFICATION_LIMIT = 10;

function toPositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), maximum);
}

function toOffset(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function toConversationKind(value: string | undefined): SocialConversationKind | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "direct") return "direct";
  if (normalized === "group") return "group";
  return null;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "t", "yes", "online"].includes(normalized);
  }
  return false;
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

function sanitizePreviewText(value: string | null | undefined, maxLength = 140): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/gu, " ");
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function sanitizeDisplayText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeParticipant(row: ConversationParticipantRow): SocialConversationParticipant {
  return {
    user_id: row.user_id,
    username: row.username,
    full_name: row.full_name,
    avatar_url: row.avatar_url ?? null,
    is_online: coerceBoolean(row.is_online),
  };
}

function normalizeConversationKind(value: string): SocialConversationKind {
  return value === "group" ? "group" : "direct";
}

function isPresenceLookupError(message: string): boolean {
  return isSocialPresenceLookupError(message);
}

function isMediaLookupError(message: string): boolean {
  return (
    message.includes("conversation_message_media") ||
    message.includes("no such table") ||
    message.includes("relation")
  );
}

function buildInClausePlaceholders(size: number): string {
  return new Array(size).fill("?").join(", ");
}

export function buildDirectConversationKey(leftUserId: string, rightUserId: string): string {
  return [leftUserId.trim(), rightUserId.trim()].sort((left, right) => left.localeCompare(right)).join(":");
}

export function resolveConversationDisplay(
  conversation: Pick<ConversationListRow, "conversation_kind" | "title">,
  participants: readonly SocialConversationParticipant[],
  currentUserId: string,
): { displayTitle: string; avatarUrl: string | null } {
  const others = participants.filter((participant) => participant.user_id !== currentUserId);

  if (conversation.conversation_kind === "direct") {
    const directPeer = others[0] ?? participants[0] ?? null;
    if (!directPeer) {
      return { displayTitle: "Conversa direta", avatarUrl: null };
    }

    return {
      displayTitle: directPeer.full_name?.trim() || directPeer.username || "Conversa direta",
      avatarUrl: directPeer.avatar_url ?? null,
    };
  }

  const fallbackTitle = others
    .slice(0, 3)
    .map((participant) => participant.username)
    .filter((value) => value.trim().length > 0)
    .join(", ");

  return {
    displayTitle: conversation.title?.trim() || fallbackTitle || "Grupo",
    avatarUrl: null,
  };
}

function buildMediaConversationPreviewLabel(mediaKind: string | null | undefined): string {
  return mediaKind === "image" ? "Imagem" : "Nova mensagem";
}

function normalizeMessageKind(value: string | null | undefined): "text" | "image" {
  return value === "image" ? "image" : "text";
}

function buildConversationPreviewFromMessageRow(
  row: Pick<ConversationLatestMessageRow, "message_kind" | "message_text"> | null,
): string | null {
  if (!row) return null;
  if (normalizeMessageKind(row.message_kind) === "image") {
    return buildMediaConversationPreviewLabel(row.message_kind);
  }

  return sanitizePreviewText(row.message_text, 160);
}

async function resolveDirectConversationPeerUserId(
  db: D1Database,
  conversationId: number,
  currentUserId: string,
): Promise<string | null> {
  const peer = await db
    .prepare(
      `SELECT user_id
         FROM conversation_members
        WHERE conversation_id = ?
          AND user_id <> ?
        ORDER BY joined_at ASC, user_id ASC
        LIMIT 1`,
    )
    .bind(conversationId, currentUserId)
    .first<DirectConversationPeerRow>();

  return typeof peer?.user_id === "string" && peer.user_id.trim().length > 0
    ? peer.user_id
    : null;
}

async function assertNoUserBlock(
  db: D1Database,
  leftUserId: string,
  rightUserId: string,
): Promise<void> {
  const blocked = await areUsersBlocked(db, leftUserId, rightUserId);
  if (!blocked) return;

  const error = new Error("USER_BLOCKED");
  error.name = "UserBlockedError";
  throw error;
}

async function assertConversationWriteAllowed(
  db: D1Database,
  conversationId: number,
  userId: string,
): Promise<void> {
  const conversation = await db
    .prepare(
      `SELECT conversation_kind
         FROM conversations
        WHERE id = ?
        LIMIT 1`,
    )
    .bind(conversationId)
    .first<{ conversation_kind?: string | null }>();

  if (!conversation?.conversation_kind) {
    const error = new Error("CONVERSATION_NOT_FOUND");
    error.name = "ConversationNotFoundError";
    throw error;
  }

  if (conversation.conversation_kind !== "direct") {
    return;
  }

  const peerUserId = await resolveDirectConversationPeerUserId(db, conversationId, userId);
  if (!peerUserId) {
    const error = new Error("CONVERSATION_NOT_FOUND");
    error.name = "ConversationNotFoundError";
    throw error;
  }

  await assertNoUserBlock(db, userId, peerUserId);
  await assertAcceptedFriendship(db, userId, peerUserId);
}

async function assertConversationMember(
  db: D1Database,
  conversationId: number,
  userId: string,
): Promise<void> {
  const membership = await db
    .prepare(
      `SELECT 1
         FROM conversation_members
        WHERE conversation_id = ?
          AND user_id = ?
        LIMIT 1`,
    )
    .bind(conversationId, userId)
    .first<{ 1: number }>();

  if (!membership) {
    const error = new Error("CONVERSATION_NOT_FOUND");
    error.name = "ConversationNotFoundError";
    throw error;
  }
}

async function assertAcceptedFriendship(
  db: D1Database,
  userId: string,
  friendUserId: string,
): Promise<void> {
  const friendship = await db
    .prepare(
      `SELECT 1
         FROM friendships
        WHERE user_id = ?
          AND COALESCE(friend_id, friend_user_id) = ?
          AND status = 'accepted'
        LIMIT 1`,
    )
    .bind(userId, friendUserId)
    .first<{ 1: number }>();

  if (!friendship) {
    const error = new Error("FRIENDSHIP_REQUIRED");
    error.name = "FriendshipRequiredError";
    throw error;
  }
}

async function assertAcceptedFriendships(
  db: D1Database,
  userId: string,
  memberUserIds: readonly string[],
): Promise<void> {
  if (memberUserIds.length === 0) return;

  const placeholders = buildInClausePlaceholders(memberUserIds.length);
  const result = await db
    .prepare(
      `SELECT COUNT(*) as accepted_count
         FROM friendships
        WHERE user_id = ?
          AND status = 'accepted'
          AND COALESCE(friend_id, friend_user_id) IN (${placeholders})`,
    )
    .bind(userId, ...memberUserIds)
    .first<{ accepted_count: number }>();

  if (Number(result?.accepted_count ?? 0) !== memberUserIds.length) {
    const error = new Error("FRIENDSHIP_REQUIRED");
    error.name = "FriendshipRequiredError";
    throw error;
  }
}

async function assertGroupInvitesAllowed(
  db: D1Database,
  memberUserIds: readonly string[],
): Promise<void> {
  if (memberUserIds.length === 0) return;

  const placeholders = buildInClausePlaceholders(memberUserIds.length);
  const result = await db
    .prepare(
      `SELECT COUNT(*) as allowed_count
         FROM user_profiles up
         LEFT JOIN social_user_preferences sup
           ON sup.user_id = up.user_id
        WHERE up.user_id IN (${placeholders})
          AND (sup.allow_group_invites IS NULL OR sup.allow_group_invites = TRUE)`,
      )
      .bind(...memberUserIds)
      .first<{ allowed_count: number }>();

  if (Number(result?.allowed_count ?? 0) !== memberUserIds.length) {
    const error = new Error("GROUP_INVITES_DISABLED");
    error.name = "GroupInvitesDisabledError";
    throw error;
  }
}

async function listConversationRows(
  db: D1Database,
  userId: string,
  options: {
    kind?: SocialConversationKind | null;
    limit: number;
    offset: number;
    conversationId?: number | undefined;
    conversationIds?: readonly number[] | undefined;
  },
): Promise<ConversationListRow[]> {
  const conditions = ["cm.user_id = ?"];
  const params: unknown[] = [userId, userId];

  if (options.kind) {
    conditions.push("c.conversation_kind = ?");
    params.push(options.kind);
  }

  if (typeof options.conversationId === "number") {
    conditions.push("c.id = ?");
    params.push(options.conversationId);
  }

  if (Array.isArray(options.conversationIds) && options.conversationIds.length > 0) {
    conditions.push(`c.id IN (${buildInClausePlaceholders(options.conversationIds.length)})`);
    params.push(...options.conversationIds);
  }

  params.push(options.limit, options.offset);

  const rows = await db
    .prepare(
      `SELECT
         c.id,
         c.conversation_kind,
         c.title,
         c.last_message_id,
         c.last_message_preview,
         c.last_message_at,
         c.created_at,
         c.updated_at,
         cm.notifications_muted,
         (
           SELECT COUNT(*)
             FROM conversation_members cm_count
            WHERE cm_count.conversation_id = c.id
         ) as member_count,
         (
           SELECT COUNT(*)
             FROM conversation_messages unread
            WHERE unread.conversation_id = c.id
              AND unread.deleted_at IS NULL
              AND unread.sender_user_id <> ?
              AND unread.id > COALESCE(cm.last_read_message_id, 0)
         ) as unread_count
       FROM conversation_members cm
       INNER JOIN conversations c
         ON c.id = cm.conversation_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
      LIMIT ? OFFSET ?`,
    )
    .bind(...params)
    .all<ConversationListRow>();

  return Array.isArray(rows.results) ? rows.results : [];
}

async function listConversationParticipants(
  db: D1Database,
  conversationIds: readonly number[],
): Promise<Map<number, SocialConversationParticipant[]>> {
  const participantMap = new Map<number, SocialConversationParticipant[]>();
  if (conversationIds.length === 0) return participantMap;

  const placeholders = buildInClausePlaceholders(conversationIds.length);
  const heartbeatWindowStart = new Date(Date.now() - FRIEND_ONLINE_WINDOW_MS).toISOString();

  let rows: ConversationParticipantRow[];
  try {
    const result = await db
      .prepare(
        `SELECT
           cm.conversation_id,
           cm.user_id,
           up.username,
           up.full_name,
           u.avatar_url,
           CASE
             WHEN p.presence_status = 'online'
              AND p.last_heartbeat_at >= ?
             THEN 1
             ELSE 0
           END as is_online
         FROM conversation_members cm
         INNER JOIN user_profiles up
           ON up.user_id = cm.user_id
         LEFT JOIN users u
           ON u.id = cm.user_id
         LEFT JOIN user_presence p
           ON p.user_id = cm.user_id
        WHERE cm.conversation_id IN (${placeholders})
        ORDER BY cm.joined_at ASC, cm.user_id ASC`,
      )
      .bind(heartbeatWindowStart, ...conversationIds)
      .all<ConversationParticipantRow>();

    rows = Array.isArray(result.results) ? result.results : [];
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (!isPresenceLookupError(message)) {
      throw error;
    }

    const fallback = await db
      .prepare(
        `SELECT
           cm.conversation_id,
           cm.user_id,
           up.username,
           up.full_name,
           u.avatar_url,
           0 as is_online
         FROM conversation_members cm
         INNER JOIN user_profiles up
           ON up.user_id = cm.user_id
         LEFT JOIN users u
           ON u.id = cm.user_id
        WHERE cm.conversation_id IN (${placeholders})
        ORDER BY cm.joined_at ASC, cm.user_id ASC`,
      )
      .bind(...conversationIds)
      .all<ConversationParticipantRow>();

    rows = Array.isArray(fallback.results) ? fallback.results : [];
  }

  for (const row of rows) {
    const conversationId = toNonNegativeNumber(row.conversation_id);
    const current = participantMap.get(conversationId) ?? [];
    current.push(normalizeParticipant(row));
    participantMap.set(conversationId, current);
  }

  return participantMap;
}

async function hydrateConversationPreviews(
  db: D1Database,
  userId: string,
  rows: readonly ConversationListRow[],
): Promise<SocialConversationPreview[]> {
  const ids = rows.map((row) => row.id);
  const participantsByConversation = await listConversationParticipants(db, ids);

  return rows.map((row) => {
    const participants = participantsByConversation.get(row.id) ?? [];
    const display = resolveConversationDisplay(row, participants, userId);
    return {
      id: toNonNegativeNumber(row.id),
      conversation_kind: normalizeConversationKind(row.conversation_kind),
      title: row.title ?? null,
      display_title: display.displayTitle,
      avatar_url: display.avatarUrl,
      member_count: toNonNegativeNumber(row.member_count ?? participants.length),
      unread_count: toNonNegativeNumber(row.unread_count),
      last_message_id: toNullablePositiveNumber(row.last_message_id),
      last_message_preview: sanitizePreviewText(row.last_message_preview),
      last_message_at: row.last_message_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      notifications_muted: coerceBoolean(row.notifications_muted),
      participants,
    };
  });
}

async function getConversationPreviewById(
  db: D1Database,
  userId: string,
  conversationId: number,
): Promise<SocialConversationPreview | null> {
  const rows = await listConversationRows(db, userId, {
    conversationId,
    limit: 1,
    offset: 0,
  });
  if (rows.length === 0) return null;

  const previews = await hydrateConversationPreviews(db, userId, rows);
  return previews[0] ?? null;
}

async function listSocialHubBundle(
  db: D1Database,
  userId: string,
  options: {
    friendLimit: number;
    friendOffset: number;
    requestLimit: number;
    requestOffset: number;
  },
): Promise<SocialHubBundle> {
  const [friends, pendingRequests, conversationRows, preferences] = await Promise.all([
    listAcceptedFriendsWithPresence(
      db,
      userId,
      options.friendLimit,
      options.friendOffset,
    ),
    listPendingFriendRequests(
      db,
      userId,
      options.requestLimit,
      options.requestOffset,
    ),
    listConversationRows(db, userId, {
      limit: Math.max(options.friendLimit + options.friendOffset + 120, 220),
      offset: 0,
    }),
    readSocialUserPreferences(db, userId),
  ]);

  const allPreviews = await hydrateConversationPreviews(db, userId, conversationRows);
  const previewsByPeerUserId = new Map<string, SocialConversationPreview>();
  const groupPreviews: SocialConversationPreview[] = [];

  for (const preview of allPreviews) {
    if (preview.conversation_kind === "group") {
      groupPreviews.push(preview);
      continue;
    }

    const peer = preview.participants.find((participant) => participant.user_id !== userId);
    if (!peer?.user_id) continue;
    previewsByPeerUserId.set(peer.user_id, preview);
  }

  const mappedFriends: SocialHubFriendItem[] = friends.map((friend) => {
    const conversation = previewsByPeerUserId.get(friend.friend_user_id) ?? null;
    return {
      ...friend,
      direct_conversation_id: toNullablePositiveNumber(conversation?.id),
      unread_count: toNonNegativeNumber(conversation?.unread_count),
      last_message_preview: conversation?.last_message_preview ?? null,
      last_message_at: conversation?.last_message_at ?? null,
      notifications_muted: conversation?.notifications_muted === true,
    };
  });

  return {
    friends: mappedFriends,
    pending_requests: pendingRequests,
    groups: groupPreviews,
    preferences,
  };
}

function resolveNotificationConversationTitle(row: ConversationNotificationRow): string {
  if (row.conversation_kind === "group") {
    return sanitizeDisplayText(row.title, "Grupo");
  }

  return (
    sanitizeDisplayText(row.sender_full_name) ||
    sanitizeDisplayText(row.sender_username, "Nova mensagem")
  );
}

async function upsertSocialUserPreferences(
  db: D1Database,
  userId: string,
  preferences: SocialUserPreferences,
): Promise<SocialUserPreferences> {
  await db
    .prepare(
      `INSERT INTO social_user_preferences (
         user_id,
         show_online_status,
         allow_friend_requests,
         allow_group_invites,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         show_online_status = excluded.show_online_status,
         allow_friend_requests = excluded.allow_friend_requests,
         allow_group_invites = excluded.allow_group_invites,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      userId,
      preferences.show_online_status,
      preferences.allow_friend_requests,
      preferences.allow_group_invites,
    )
    .run();

  return readSocialUserPreferences(db, userId);
}

async function listConversationMedia(
  db: D1Database,
  userId: string,
  conversationId: number,
  limit: number,
): Promise<SocialConversationMessageMedia[]> {
  await assertConversationMember(db, conversationId, userId);
  await assertConversationWriteAllowed(db, conversationId, userId);

  try {
    const rows = await db
      .prepare(
        `SELECT
           media.id,
           media.media_kind,
           media.public_url,
           media.created_at
         FROM conversation_message_media media
        WHERE media.conversation_id = ?
        ORDER BY media.created_at DESC, media.id DESC
        LIMIT ?`,
      )
      .bind(conversationId, limit)
      .all<ConversationMessageMediaRow>();

    return (rows.results ?? []).map((row) => ({
      id: toNonNegativeNumber(row.id),
      media_kind: row.media_kind === "image" ? "image" : "image",
      public_url: row.public_url,
      created_at: row.created_at,
    }));
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (!isMediaLookupError(message)) {
      throw error;
    }

    return [];
  }
}

async function listConversationMessages(
  db: D1Database,
  userId: string,
  conversationId: number,
  limit: number,
  beforeMessageId: number | null,
): Promise<SocialConversationMessage[]> {
  const conditions = [
    "m.conversation_id = ?",
    "m.deleted_at IS NULL",
  ];
  const params: unknown[] = [userId, conversationId];

  if (typeof beforeMessageId === "number" && Number.isFinite(beforeMessageId) && beforeMessageId > 0) {
    conditions.push("m.id < ?");
    params.push(beforeMessageId);
  }

  params.push(limit);

  const rows = await db
    .prepare(
      `SELECT
         m.id,
         m.conversation_id,
         m.sender_user_id,
         up.username as sender_username,
         up.full_name as sender_full_name,
         u.avatar_url as sender_avatar_url,
         m.message_text,
         m.message_kind,
         m.created_at,
         m.edited_at
       FROM conversation_messages m
       INNER JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id
        AND cm.user_id = ?
       INNER JOIN user_profiles up
         ON up.user_id = m.sender_user_id
       LEFT JOIN users u
         ON u.id = m.sender_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY m.id DESC
      LIMIT ?`,
    )
    .bind(...params)
    .all<ConversationMessageRow>();

  const results = Array.isArray(rows.results) ? rows.results : [];
  const messageIds = results
    .map((row) => toNonNegativeNumber(row.id))
    .filter((value) => Number.isFinite(value) && value > 0);
  const mediaByMessageId = new Map<number, SocialConversationMessageMedia>();

  if (messageIds.length > 0) {
    try {
      const mediaRows = await db
        .prepare(
          `SELECT
             id,
             message_id,
             media_kind,
             public_url,
             created_at
           FROM conversation_message_media
          WHERE message_id IN (${buildInClausePlaceholders(messageIds.length)})
          ORDER BY id ASC`,
        )
        .bind(...messageIds)
        .all<ConversationMessageMediaRow>();

      for (const row of mediaRows.results ?? []) {
        mediaByMessageId.set(toNonNegativeNumber(row.message_id), {
          id: toNonNegativeNumber(row.id),
          media_kind: row.media_kind === "image" ? "image" : "image",
          public_url: row.public_url,
          created_at: row.created_at,
        });
      }
    } catch (error) {
      const message = getErrorMessage(error).toLowerCase();
      if (!isMediaLookupError(message)) {
        throw error;
      }
    }
  }

  return results
    .reverse()
    .map((row) => ({
      id: toNonNegativeNumber(row.id),
      conversation_id: toNonNegativeNumber(row.conversation_id),
      sender_user_id: row.sender_user_id,
      sender_username: row.sender_username,
      sender_full_name: row.sender_full_name,
      sender_avatar_url: row.sender_avatar_url ?? null,
      message_text: row.message_text ?? "",
      message_kind: normalizeMessageKind(row.message_kind),
      media: mediaByMessageId.get(toNonNegativeNumber(row.id)) ?? null,
      created_at: row.created_at,
      edited_at: row.edited_at ?? null,
      is_own_message: row.sender_user_id === userId,
    }));
}

async function createDirectConversation(
  db: D1Database,
  withTransaction: WithTransaction,
  userId: string,
  friendUserId: string,
  env?: Pick<AppContext["Bindings"], "DB_BACKEND">,
): Promise<number> {
  const directKey = buildDirectConversationKey(userId, friendUserId);

  const existing = await db
    .prepare(
      `SELECT id
         FROM conversations
        WHERE direct_key = ?
          AND conversation_kind = 'direct'
        LIMIT 1`,
    )
    .bind(directKey)
    .first<{ id: number }>();

  if (existing?.id) {
    return Number(existing.id);
  }

  try {
    return await withTransaction(
      db,
      async () => {
        const inserted = await db
          .prepare(
            `INSERT INTO conversations (
               conversation_kind,
               direct_key,
               created_by_user_id,
               created_at,
               updated_at
             ) VALUES ('direct', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING id`,
          )
          .bind(directKey, userId)
          .first<{ id: number }>();

        const conversationId = Number(inserted?.id ?? 0);
        if (!conversationId) {
          throw new Error("DIRECT_CONVERSATION_CREATE_FAILED");
        }

        await db
          .prepare(
            `INSERT INTO conversation_members (
               conversation_id,
               user_id,
               member_role,
               joined_at,
               created_at,
               updated_at
             ) VALUES (?, ?, 'owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(conversationId, userId)
          .run();

        await db
          .prepare(
            `INSERT INTO conversation_members (
               conversation_id,
               user_id,
               member_role,
               joined_at,
               created_at,
               updated_at
             ) VALUES (?, ?, 'member', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(conversationId, friendUserId)
          .run();

        return conversationId;
      },
      env,
    );
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (!message.includes("unique") && !message.includes("direct_key")) {
      throw error;
    }

    const insertedAfterRace = await db
      .prepare(
        `SELECT id
           FROM conversations
          WHERE direct_key = ?
            AND conversation_kind = 'direct'
          LIMIT 1`,
      )
      .bind(directKey)
      .first<{ id: number }>();

    if (!insertedAfterRace?.id) {
      throw error;
    }

    return Number(insertedAfterRace.id);
  }
}

async function createGroupConversation(
  db: D1Database,
  withTransaction: WithTransaction,
  userId: string,
  title: string,
  memberUserIds: readonly string[],
  env?: Pick<AppContext["Bindings"], "DB_BACKEND">,
): Promise<number> {
  return withTransaction(
    db,
    async () => {
      const inserted = await db
        .prepare(
          `INSERT INTO conversations (
             conversation_kind,
             title,
             created_by_user_id,
             created_at,
             updated_at
           ) VALUES ('group', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id`,
        )
        .bind(title, userId)
        .first<{ id: number }>();

      const conversationId = Number(inserted?.id ?? 0);
      if (!conversationId) {
        throw new Error("GROUP_CONVERSATION_CREATE_FAILED");
      }

      await db
        .prepare(
          `INSERT INTO conversation_members (
             conversation_id,
             user_id,
             member_role,
             joined_at,
             created_at,
             updated_at
           ) VALUES (?, ?, 'owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(conversationId, userId)
        .run();

      for (const memberUserId of memberUserIds) {
        await db
          .prepare(
            `INSERT INTO conversation_members (
               conversation_id,
               user_id,
               member_role,
               joined_at,
               created_at,
               updated_at
             ) VALUES (?, ?, 'member', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(conversationId, memberUserId)
          .run();
      }

      return conversationId;
    },
    env,
  );
}

async function readConversationAuthor(
  db: D1Database,
  userId: string,
): Promise<{
  sender_username: string;
  sender_full_name: string;
  sender_avatar_url: string | null;
}> {
  const author = await db
    .prepare(
      `SELECT
         up.username as sender_username,
         up.full_name as sender_full_name,
         u.avatar_url as sender_avatar_url
       FROM user_profiles up
       LEFT JOIN users u
         ON u.id = up.user_id
      WHERE up.user_id = ?
      LIMIT 1`,
    )
    .bind(userId)
    .first<{
      sender_username: string;
      sender_full_name: string;
      sender_avatar_url: string | null;
    }>();

  return {
    sender_username: author?.sender_username ?? "usuario",
    sender_full_name: author?.sender_full_name ?? author?.sender_username ?? "Usuario",
    sender_avatar_url: author?.sender_avatar_url ?? null,
  };
}

async function updateConversationAfterMessage(
  db: D1Database,
  conversationId: number,
  senderUserId: string,
  messageId: number,
  previewText: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE conversations
          SET last_message_id = ?,
              last_message_preview = ?,
              last_message_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(messageId, previewText, conversationId)
    .run();

  await db
    .prepare(
      `UPDATE conversation_members
          SET last_read_message_id = ?,
              last_read_at = CURRENT_TIMESTAMP,
              last_notified_message_id = ?,
              last_notified_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE conversation_id = ?
          AND user_id = ?`,
    )
    .bind(messageId, messageId, conversationId, senderUserId)
    .run();
}

async function syncConversationSummaryAfterMutation(
  db: D1Database,
  conversationId: number,
): Promise<void> {
  const latestMessage = await db
    .prepare(
      `SELECT
         id,
         message_text,
         message_kind,
         created_at
       FROM conversation_messages
      WHERE conversation_id = ?
        AND deleted_at IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    )
    .bind(conversationId)
    .first<ConversationLatestMessageRow>();

  if (latestMessage?.id) {
    await db
      .prepare(
        `UPDATE conversations
            SET last_message_id = ?,
                last_message_preview = ?,
                last_message_at = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .bind(
        Number(latestMessage.id),
        buildConversationPreviewFromMessageRow(latestMessage),
        latestMessage.created_at,
        conversationId,
      )
      .run();
    return;
  }

  await db
    .prepare(
      `UPDATE conversations
          SET last_message_id = NULL,
              last_message_preview = NULL,
              last_message_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(conversationId)
    .run();
}

async function readConversationMessageForMutation(
  db: D1Database,
  conversationId: number,
  messageId: number,
  userId: string,
): Promise<ConversationMessageMutationRow> {
  const message = await db
    .prepare(
      `SELECT
         id,
         conversation_id,
         sender_user_id,
         message_text,
         message_kind,
         created_at,
         edited_at,
         deleted_at
       FROM conversation_messages
      WHERE id = ?
        AND conversation_id = ?
      LIMIT 1`,
    )
    .bind(messageId, conversationId)
    .first<ConversationMessageMutationRow>();

  if (!message || message.deleted_at) {
    const error = new Error("CONVERSATION_MESSAGE_NOT_FOUND");
    error.name = "ConversationMessageNotFoundError";
    throw error;
  }

  if (message.sender_user_id !== userId) {
    const error = new Error("CONVERSATION_MESSAGE_NOT_OWNED");
    error.name = "ConversationMessageOwnershipError";
    throw error;
  }

  return message;
}

async function readConversationMessageById(
  db: D1Database,
  userId: string,
  conversationId: number,
  messageId: number,
): Promise<SocialConversationMessage | null> {
  const row = await db
    .prepare(
      `SELECT
         m.id,
         m.conversation_id,
         m.sender_user_id,
         up.username as sender_username,
         up.full_name as sender_full_name,
         u.avatar_url as sender_avatar_url,
         m.message_text,
         m.message_kind,
         m.created_at,
         m.edited_at
       FROM conversation_messages m
       INNER JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id
        AND cm.user_id = ?
       INNER JOIN user_profiles up
         ON up.user_id = m.sender_user_id
       LEFT JOIN users u
         ON u.id = m.sender_user_id
      WHERE m.id = ?
        AND m.conversation_id = ?
        AND m.deleted_at IS NULL
      LIMIT 1`,
    )
    .bind(userId, messageId, conversationId)
    .first<ConversationMessageRow>();

  if (!row) return null;

  const media = await db
    .prepare(
      `SELECT
         id,
         message_id,
         media_kind,
         public_url,
         created_at
       FROM conversation_message_media
      WHERE message_id = ?
      ORDER BY id ASC
      LIMIT 1`,
    )
    .bind(messageId)
    .first<ConversationMessageMediaRow>();

  return {
    id: toNonNegativeNumber(row.id),
    conversation_id: toNonNegativeNumber(row.conversation_id),
    sender_user_id: row.sender_user_id,
    sender_username: row.sender_username,
    sender_full_name: row.sender_full_name,
    sender_avatar_url: row.sender_avatar_url,
    message_text: row.message_text ?? "",
    message_kind: normalizeMessageKind(row.message_kind),
    media: media
      ? {
          id: toNonNegativeNumber(media.id),
          media_kind: "image",
          public_url: media.public_url,
          created_at: media.created_at,
        }
      : null,
    created_at: row.created_at,
    edited_at: row.edited_at ?? null,
    is_own_message: row.sender_user_id === userId,
  };
}

async function updateConversationMessageText(
  db: D1Database,
  withTransaction: WithTransaction,
  conversationId: number,
  messageId: number,
  userId: string,
  messageText: string,
  env?: Pick<AppContext["Bindings"], "DB_BACKEND">,
): Promise<SocialConversationMessage> {
  return withTransaction(
    db,
    async () => {
      await readConversationMessageForMutation(db, conversationId, messageId, userId);

      await db
        .prepare(
          `UPDATE conversation_messages
              SET message_text = ?,
                  edited_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND conversation_id = ?
              AND sender_user_id = ?
              AND deleted_at IS NULL`,
        )
        .bind(messageText, messageId, conversationId, userId)
        .run();

      const conversation = await db
        .prepare(
          `SELECT last_message_id
             FROM conversations
            WHERE id = ?
            LIMIT 1`,
        )
        .bind(conversationId)
        .first<{ last_message_id?: number | null }>();

      if (Number(conversation?.last_message_id ?? 0) === messageId) {
        await db
          .prepare(
            `UPDATE conversations
                SET last_message_preview = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
          )
          .bind(sanitizePreviewText(messageText, 160), conversationId)
          .run();
      }

      const updatedMessage = await readConversationMessageById(
        db,
        userId,
        conversationId,
        messageId,
      );
      if (!updatedMessage) {
        throw new Error("CONVERSATION_MESSAGE_UPDATE_FAILED");
      }

      return updatedMessage;
    },
    env,
  );
}

async function deleteConversationMessage(
  db: D1Database,
  withTransaction: WithTransaction,
  conversationId: number,
  messageId: number,
  userId: string,
  env?: Pick<AppContext["Bindings"], "DB_BACKEND">,
): Promise<{ storagePaths: string[] }> {
  return withTransaction(
    db,
    async () => {
      await readConversationMessageForMutation(db, conversationId, messageId, userId);

      const mediaRows = await db
        .prepare(
          `SELECT storage_path
             FROM conversation_message_media
            WHERE message_id = ?`,
        )
        .bind(messageId)
        .all<ConversationMessageStorageRow>();

      const storagePaths = (mediaRows.results ?? [])
        .map((row) => row.storage_path?.trim() ?? "")
        .filter((value) => value.length > 0);

      await db
        .prepare(
          `DELETE FROM conversation_message_media
            WHERE message_id = ?`,
        )
        .bind(messageId)
        .run();

      await db
        .prepare(
          `UPDATE conversation_messages
              SET deleted_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND conversation_id = ?
              AND sender_user_id = ?
              AND deleted_at IS NULL`,
        )
        .bind(messageId, conversationId, userId)
        .run();

      await syncConversationSummaryAfterMutation(db, conversationId);

      return { storagePaths };
    },
    env,
  );
}

async function insertConversationMessage(
  db: D1Database,
  withTransaction: WithTransaction,
  conversationId: number,
  senderUserId: string,
  messageText: string,
  env?: Pick<AppContext["Bindings"], "DB_BACKEND">,
): Promise<SocialConversationMessage> {
  return withTransaction(
    db,
    async () => {
      const inserted = await db
        .prepare(
          `INSERT INTO conversation_messages (
             conversation_id,
             sender_user_id,
             message_text,
             message_kind,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, 'text', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id, conversation_id, sender_user_id, message_text, message_kind, created_at, edited_at`,
        )
        .bind(conversationId, senderUserId, messageText)
        .first<ConversationMessageRow>();

      const messageId = Number(inserted?.id ?? 0);
      if (!messageId) {
        throw new Error("CONVERSATION_MESSAGE_CREATE_FAILED");
      }

      await updateConversationAfterMessage(
        db,
        conversationId,
        senderUserId,
        messageId,
        sanitizePreviewText(messageText, 160) ?? messageText,
      );

      const author = await readConversationAuthor(db, senderUserId);

      return {
        id: messageId,
        conversation_id: conversationId,
        sender_user_id: senderUserId,
        sender_username: author.sender_username,
        sender_full_name: author.sender_full_name,
        sender_avatar_url: author.sender_avatar_url,
        message_text: inserted?.message_text ?? messageText,
        message_kind: "text",
        media: null,
        created_at: inserted?.created_at ?? new Date().toISOString(),
        edited_at: inserted?.edited_at ?? null,
        is_own_message: true,
      };
    },
    env,
  );
}

async function insertConversationMediaMessage(
  db: D1Database,
  withTransaction: WithTransaction,
  conversationId: number,
  senderUserId: string,
  media: {
    path: string;
    publicUrl: string;
    mediaKind: "image";
  },
  caption: string,
  env?: Pick<AppContext["Bindings"], "DB_BACKEND">,
): Promise<SocialConversationMessage> {
  return withTransaction(
    db,
    async () => {
      const inserted = await db
        .prepare(
          `INSERT INTO conversation_messages (
             conversation_id,
             sender_user_id,
             message_text,
             message_kind,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, 'image', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id, conversation_id, sender_user_id, message_text, message_kind, created_at, edited_at`,
        )
        .bind(conversationId, senderUserId, caption.length > 0 ? caption : null)
        .first<ConversationMessageRow>();

      const messageId = Number(inserted?.id ?? 0);
      if (!messageId) {
        throw new Error("CONVERSATION_MEDIA_MESSAGE_CREATE_FAILED");
      }

      const insertedMedia = await db
        .prepare(
          `INSERT INTO conversation_message_media (
             message_id,
             conversation_id,
             uploaded_by_user_id,
             media_kind,
             storage_path,
             public_url,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id, message_id, media_kind, public_url, created_at`,
        )
        .bind(
          messageId,
          conversationId,
          senderUserId,
          media.mediaKind,
          media.path,
          media.publicUrl,
        )
        .first<ConversationMessageMediaRow>();

      await updateConversationAfterMessage(
        db,
        conversationId,
        senderUserId,
        messageId,
        buildMediaConversationPreviewLabel(media.mediaKind),
      );

      const author = await readConversationAuthor(db, senderUserId);

      return {
        id: messageId,
        conversation_id: conversationId,
        sender_user_id: senderUserId,
        sender_username: author.sender_username,
        sender_full_name: author.sender_full_name,
        sender_avatar_url: author.sender_avatar_url,
        message_text: inserted?.message_text ?? "",
        message_kind: "image",
        media: {
          id: Number(insertedMedia?.id ?? 0) || messageId,
          media_kind: media.mediaKind,
          public_url: media.publicUrl,
          created_at: insertedMedia?.created_at ?? inserted?.created_at ?? new Date().toISOString(),
        },
        created_at: inserted?.created_at ?? new Date().toISOString(),
        edited_at: inserted?.edited_at ?? null,
        is_own_message: true,
      };
    },
    env,
  );
}

function normalizeConversationMessageId(
  value: unknown,
  fallback: number | null,
): number | null {
  const parsed = Number(value ?? fallback ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback ?? null;
  }
  return Math.floor(parsed);
}

export function registerSocialChatRoutes(
  app: Hono<AppContext>,
  { authMiddleware, withTransaction }: SocialChatRouteDeps,
): void {
  app.get("/api/social/hub", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const friendLimit = toPositiveInteger(c.req.query("friend_limit"), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const friendOffset = toOffset(c.req.query("friend_offset"));
    const requestLimit = toPositiveInteger(c.req.query("request_limit"), 50, 100);
    const requestOffset = toOffset(c.req.query("request_offset"));
    c.header("Cache-Control", "no-store");

    try {
      const hub = await listSocialHubBundle(c.env.fitloot_db, user.id, {
        friendLimit,
        friendOffset,
        requestLimit,
        requestOffset,
      });
      return c.json(hub);
    } catch (error) {
      console.error("[/api/social/hub]", {
        message: getErrorMessage(error),
        userId: user.id,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      return internalErrorResponse(c);
    }
  });

  app.post(
    "/api/social/preferences",
    authMiddleware,
    zValidator("json", SocialUserPreferencesUpdateRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      try {
        const body = c.req.valid("json");
        const preferences = await upsertSocialUserPreferences(c.env.fitloot_db, user.id, body);
        return c.json(preferences);
      } catch (error) {
        console.error("[/api/social/preferences]", {
          message: getErrorMessage(error),
          userId: user.id,
        });
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }
        return internalErrorResponse(c);
      }
    },
  );

  app.post("/api/social/users/:userId/block", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const targetUserId = c.req.param("userId")?.trim();
    if (!targetUserId) {
      return c.json({ error: "Usuario invalido." }, 400);
    }
    if (targetUserId === user.id) {
      return c.json({ error: "Nao e possivel bloquear a si mesmo." }, 400);
    }

    try {
      await withTransaction(
        c.env.fitloot_db,
        async () => {
          await c.env.fitloot_db
            .prepare(
              `INSERT INTO user_blocks (
                 blocker_user_id,
                 blocked_user_id,
                 created_at,
                 updated_at
               ) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT DO NOTHING`,
            )
            .bind(user.id, targetUserId)
            .run();

          await c.env.fitloot_db
            .prepare(
              `DELETE FROM friendships
                WHERE (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)
                   OR (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)`,
            )
            .bind(user.id, targetUserId, targetUserId, user.id)
            .run();

          await c.env.fitloot_db
            .prepare(
              `UPDATE friend_requests
                  SET status = 'rejected',
                      updated_at = CURRENT_TIMESTAMP
                WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
                  AND status = 'pending'`,
            )
            .bind(user.id, targetUserId, targetUserId, user.id)
            .run();
        },
        c.env,
      );

      return c.json({ success: true });
    } catch (error) {
      console.error("[/api/social/users/:userId/block]", {
        message: getErrorMessage(error),
        userId: user.id,
        targetUserId,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      return internalErrorResponse(c);
    }
  });

  app.get("/api/social/conversations", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const kind = toConversationKind(c.req.query("kind"));
    const limit = toPositiveInteger(c.req.query("limit"), DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const offset = toOffset(c.req.query("offset"));
    c.header("Cache-Control", "no-store");

    try {
      const rows = await listConversationRows(c.env.fitloot_db, user.id, {
        kind,
        limit,
        offset,
      });
      const previews = await hydrateConversationPreviews(c.env.fitloot_db, user.id, rows);
      return c.json(previews);
    } catch (error) {
      console.error("[/api/social/conversations]", {
        message: getErrorMessage(error),
        userId: user.id,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      return internalErrorResponse(c);
    }
  });

  app.get("/api/social/conversations/:id/messages", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const conversationId = Number(c.req.param("id"));
    const limit = toPositiveInteger(c.req.query("limit"), DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT);
    const beforeMessageId = normalizeConversationMessageId(c.req.query("before_id"), null);
    c.header("Cache-Control", "no-store");

    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return c.json({ error: "Conversa invalida." }, 400);
    }

    try {
      await assertConversationMember(c.env.fitloot_db, conversationId, user.id);
      await assertConversationWriteAllowed(c.env.fitloot_db, conversationId, user.id);
      const conversation = await getConversationPreviewById(c.env.fitloot_db, user.id, conversationId);
      if (!conversation) {
        return c.json({ error: "Conversa nao encontrada." }, 404);
      }

      const messages = await listConversationMessages(
        c.env.fitloot_db,
        user.id,
        conversationId,
        limit,
        beforeMessageId,
      );

      return c.json({
        conversation,
        messages,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "ConversationNotFoundError") {
        return c.json({ error: "Conversa nao encontrada." }, 404);
      }
      if (error instanceof Error && error.name === "FriendshipRequiredError") {
        return c.json({ error: "Esta conversa nao aceita novas mensagens." }, 403);
      }
      if (error instanceof Error && error.name === "UserBlockedError") {
        return c.json({ error: "Esta conversa nao esta disponivel agora." }, 403);
      }

      console.error("[/api/social/conversations/:id/messages]", {
        message: getErrorMessage(error),
        userId: user.id,
        conversationId,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      return internalErrorResponse(c);
    }
  });

  app.get("/api/social/conversations/:id/media", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const conversationId = Number(c.req.param("id"));
    const limit = toPositiveInteger(c.req.query("limit"), 80, 200);
    c.header("Cache-Control", "no-store");

    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return c.json({ error: "Conversa invalida." }, 400);
    }

    try {
      const items = await listConversationMedia(
        c.env.fitloot_db,
        user.id,
        conversationId,
        limit,
      );
      return c.json(items);
    } catch (error) {
      if (error instanceof Error && error.name === "ConversationNotFoundError") {
        return c.json({ error: "Conversa nao encontrada." }, 404);
      }
      if (error instanceof Error && error.name === "FriendshipRequiredError") {
        return c.json({ error: "Esta conversa nao aceita novas mensagens." }, 403);
      }
      if (error instanceof Error && error.name === "UserBlockedError") {
        return c.json({ error: "Esta conversa nao esta disponivel agora." }, 403);
      }

      console.error("[/api/social/conversations/:id/media]", {
        message: getErrorMessage(error),
        userId: user.id,
        conversationId,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      return internalErrorResponse(c);
    }
  });

  app.post(
    "/api/social/conversations/direct",
    authMiddleware,
    zValidator("json", SocialDirectConversationRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const data = c.req.valid("json");
      const friendUserId = data.friend_user_id.trim();

      if (friendUserId === user.id) {
        return c.json({ error: "Escolha outro usuario para iniciar a conversa." }, 400);
      }

      try {
        await assertNoUserBlock(c.env.fitloot_db, user.id, friendUserId);
        await assertAcceptedFriendship(c.env.fitloot_db, user.id, friendUserId);
        const conversationId = await createDirectConversation(
          c.env.fitloot_db,
          withTransaction,
          user.id,
          friendUserId,
          c.env,
        );

        const conversation = await getConversationPreviewById(
          c.env.fitloot_db,
          user.id,
          conversationId,
        );

        if (!conversation) {
          return c.json({ error: "Nao foi possivel iniciar a conversa." }, 500);
        }

        return c.json(conversation);
      } catch (error) {
        if (error instanceof Error && error.name === "UserBlockedError") {
          return c.json({ error: "Este usuario nao esta disponivel para novas conversas." }, 403);
        }

        if (error instanceof Error && error.name === "FriendshipRequiredError") {
          return c.json({ error: "A conversa direta so pode ser criada com amigos aceitos." }, 403);
        }

        console.error("[/api/social/conversations/direct]", {
          message: getErrorMessage(error),
          userId: user.id,
          friendUserId,
        });
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }
        return internalErrorResponse(c);
      }
    },
  );

  app.post(
    "/api/social/groups",
    authMiddleware,
    zValidator("json", SocialGroupConversationRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const data = c.req.valid("json");
      const title = data.title.trim();
      const memberUserIds = [...new Set(
        data.member_user_ids
          .map((value) => value.trim())
          .filter((value) => value.length > 0 && value !== user.id),
      )];

      if (memberUserIds.length < 2) {
        return c.json({ error: "Selecione pelo menos dois amigos para criar um grupo." }, 400);
      }

      try {
        for (const memberUserId of memberUserIds) {
          await assertNoUserBlock(c.env.fitloot_db, user.id, memberUserId);
        }
        await assertAcceptedFriendships(c.env.fitloot_db, user.id, memberUserIds);
        await assertGroupInvitesAllowed(c.env.fitloot_db, memberUserIds);
        const conversationId = await createGroupConversation(
          c.env.fitloot_db,
          withTransaction,
          user.id,
          title,
          memberUserIds,
          c.env,
        );

        const conversation = await getConversationPreviewById(
          c.env.fitloot_db,
          user.id,
          conversationId,
        );

        if (!conversation) {
          return c.json({ error: "Nao foi possivel criar o grupo." }, 500);
        }

        return c.json(conversation, 201);
      } catch (error) {
        if (error instanceof Error && error.name === "UserBlockedError") {
          return c.json({ error: "Nao e possivel criar grupo com usuarios bloqueados." }, 403);
        }

        if (error instanceof Error && error.name === "FriendshipRequiredError") {
          return c.json({ error: "Os grupos so podem incluir amigos aceitos." }, 403);
        }
        if (error instanceof Error && error.name === "GroupInvitesDisabledError") {
          return c.json({ error: "Um dos amigos selecionados nao aceita convites para grupos." }, 403);
        }

        console.error("[/api/social/groups]", {
          message: getErrorMessage(error),
          userId: user.id,
        });
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }
        return internalErrorResponse(c);
      }
    },
  );

  app.post(
    "/api/social/conversations/:id/messages",
    authMiddleware,
    zValidator("json", SocialConversationMessageRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const conversationId = Number(c.req.param("id"));
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        return c.json({ error: "Conversa invalida." }, 400);
      }

      const data = c.req.valid("json");

      try {
        await assertConversationMember(c.env.fitloot_db, conversationId, user.id);
        await assertConversationWriteAllowed(c.env.fitloot_db, conversationId, user.id);
        const message = await insertConversationMessage(
          c.env.fitloot_db,
          withTransaction,
          conversationId,
          user.id,
          data.message_text.trim(),
          c.env,
        );
        const conversation = await getConversationPreviewById(
          c.env.fitloot_db,
          user.id,
          conversationId,
        );

        return c.json({
          conversation,
          message,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "ConversationNotFoundError") {
          return c.json({ error: "Conversa nao encontrada." }, 404);
        }
        if (error instanceof Error && error.name === "FriendshipRequiredError") {
          return c.json({ error: "Esta conversa nao aceita novas mensagens." }, 403);
        }
        if (error instanceof Error && error.name === "UserBlockedError") {
          return c.json({ error: "Esta conversa nao esta disponivel agora." }, 403);
        }

        console.error("[/api/social/conversations/:id/messages]", {
          message: getErrorMessage(error),
          userId: user.id,
          conversationId,
        });
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }
        return internalErrorResponse(c);
      }
    },
  );

  app.patch(
    "/api/social/conversations/:id/messages/:messageId",
    authMiddleware,
    zValidator("json", SocialConversationMessageUpdateRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const conversationId = Number(c.req.param("id"));
      const messageId = Number(c.req.param("messageId"));
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        return c.json({ error: "Conversa invalida." }, 400);
      }
      if (!Number.isFinite(messageId) || messageId <= 0) {
        return c.json({ error: "Mensagem invalida." }, 400);
      }

      const data = c.req.valid("json");

      try {
        await assertConversationMember(c.env.fitloot_db, conversationId, user.id);
        await assertConversationWriteAllowed(c.env.fitloot_db, conversationId, user.id);
        const message = await updateConversationMessageText(
          c.env.fitloot_db,
          withTransaction,
          conversationId,
          messageId,
          user.id,
          data.message_text.trim(),
          c.env,
        );
        const conversation = await getConversationPreviewById(
          c.env.fitloot_db,
          user.id,
          conversationId,
        );

        return c.json({
          conversation,
          message,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "ConversationNotFoundError") {
          return c.json({ error: "Conversa nao encontrada." }, 404);
        }
        if (error instanceof Error && error.name === "ConversationMessageNotFoundError") {
          return c.json({ error: "Mensagem nao encontrada." }, 404);
        }
        if (error instanceof Error && error.name === "ConversationMessageOwnershipError") {
          return c.json({ error: "Voce so pode editar mensagens enviadas por voce." }, 403);
        }
        if (error instanceof Error && error.name === "FriendshipRequiredError") {
          return c.json({ error: "Esta conversa nao aceita novas mensagens." }, 403);
        }
        if (error instanceof Error && error.name === "UserBlockedError") {
          return c.json({ error: "Esta conversa nao esta disponivel agora." }, 403);
        }

        console.error("[/api/social/conversations/:id/messages/:messageId][patch]", {
          message: getErrorMessage(error),
          userId: user.id,
          conversationId,
          messageId,
        });
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }
        return internalErrorResponse(c);
      }
    },
  );

  app.delete("/api/social/conversations/:id/messages/:messageId", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const conversationId = Number(c.req.param("id"));
    const messageId = Number(c.req.param("messageId"));
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return c.json({ error: "Conversa invalida." }, 400);
    }
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return c.json({ error: "Mensagem invalida." }, 400);
    }

    try {
      await assertConversationMember(c.env.fitloot_db, conversationId, user.id);
      await assertConversationWriteAllowed(c.env.fitloot_db, conversationId, user.id);
      const result = await deleteConversationMessage(
        c.env.fitloot_db,
        withTransaction,
        conversationId,
        messageId,
        user.id,
        c.env,
      );
      const conversation = await getConversationPreviewById(
        c.env.fitloot_db,
        user.id,
        conversationId,
      );

      if (result.storagePaths.length > 0) {
        c.executionCtx.waitUntil(
          Promise.allSettled(
            result.storagePaths.map((storagePath) =>
              removeStoredSocialChatMedia(c.env, storagePath),
            ),
          ).then(() => undefined),
        );
      }

      return c.json({
        conversation,
        deleted_message_id: messageId,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "ConversationNotFoundError") {
        return c.json({ error: "Conversa nao encontrada." }, 404);
      }
      if (error instanceof Error && error.name === "ConversationMessageNotFoundError") {
        return c.json({ error: "Mensagem nao encontrada." }, 404);
      }
      if (error instanceof Error && error.name === "ConversationMessageOwnershipError") {
        return c.json({ error: "Voce so pode excluir mensagens enviadas por voce." }, 403);
      }
      if (error instanceof Error && error.name === "FriendshipRequiredError") {
        return c.json({ error: "Esta conversa nao aceita novas mensagens." }, 403);
      }
      if (error instanceof Error && error.name === "UserBlockedError") {
        return c.json({ error: "Esta conversa nao esta disponivel agora." }, 403);
      }

      console.error("[/api/social/conversations/:id/messages/:messageId][delete]", {
        message: getErrorMessage(error),
        userId: user.id,
        conversationId,
        messageId,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      return internalErrorResponse(c);
    }
  });

  app.post("/api/social/conversations/:id/media", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const conversationId = Number(c.req.param("id"));
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return c.json({ error: "Conversa invalida." }, 400);
    }

    if (!isSocialChatMediaStorageConfigured(c.env)) {
      return c.json(
        {
          error: "Armazenamento de midia do chat nao configurado.",
          code: "SOCIAL_CHAT_MEDIA_STORAGE_NOT_CONFIGURED",
        },
        503,
      );
    }

    let storedMediaPath: string | null = null;

    try {
      await assertConversationMember(c.env.fitloot_db, conversationId, user.id);
      await assertConversationWriteAllowed(c.env.fitloot_db, conversationId, user.id);

      const formData = await c.req.formData();
      const file = formData.get("file");
      const captionValue = formData.get("caption");
      const caption =
        typeof captionValue === "string" ? captionValue.trim().slice(0, 2000) : "";

      if (!file || typeof file === "string") {
        return c.json({ error: "Arquivo de midia obrigatorio." }, 400);
      }

      const uploadedFile = file as unknown as {
        arrayBuffer: () => Promise<ArrayBuffer>;
        type?: string | undefined;
      };
      if (typeof uploadedFile.arrayBuffer !== "function") {
        return c.json({ error: "Arquivo de midia obrigatorio." }, 400);
      }

      const fileBytes = new Uint8Array(await uploadedFile.arrayBuffer());
      const storedMedia = await storeSocialChatImage({
        env: c.env,
        userId: user.id,
        conversationId,
        bytes: fileBytes,
        mimeType: typeof uploadedFile.type === "string" ? uploadedFile.type : "",
      });
      storedMediaPath = storedMedia.path;

      const message = await insertConversationMediaMessage(
        c.env.fitloot_db,
        withTransaction,
        conversationId,
        user.id,
        storedMedia,
        caption,
        c.env,
      );

      const conversation = await getConversationPreviewById(
        c.env.fitloot_db,
        user.id,
        conversationId,
      );

      return c.json({
        conversation,
        message,
      });
    } catch (error) {
      if (storedMediaPath) {
        c.executionCtx.waitUntil(
          removeStoredSocialChatMedia(c.env, storedMediaPath).catch(() => undefined),
        );
      }

      if (error instanceof Error && error.name === "ConversationNotFoundError") {
        return c.json({ error: "Conversa nao encontrada." }, 404);
      }
      if (error instanceof Error && error.name === "FriendshipRequiredError") {
        return c.json({ error: "Esta conversa nao aceita novas mensagens." }, 403);
      }
      if (error instanceof Error && error.name === "UserBlockedError") {
        return c.json({ error: "Nao e possivel enviar midia para este usuario." }, 403);
      }

      const loweredMessage = getErrorMessage(error).toLowerCase();
      if (
        loweredMessage.includes("nao suportado") ||
        loweredMessage.includes("limite") ||
        loweredMessage.includes("vazio")
      ) {
        return c.json({ error: getErrorMessage(error) }, 400);
      }

      console.error("[/api/social/conversations/:id/media][post]", {
        message: getErrorMessage(error),
        userId: user.id,
        conversationId,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      return internalErrorResponse(c);
    }
  });

  app.post(
    "/api/social/conversations/:id/read",
    authMiddleware,
    zValidator("json", SocialConversationReadRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const conversationId = Number(c.req.param("id"));
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        return c.json({ error: "Conversa invalida." }, 400);
      }

      try {
        const conversation = await getConversationPreviewById(
          c.env.fitloot_db,
          user.id,
          conversationId,
        );

        if (!conversation) {
          return c.json({ error: "Conversa nao encontrada." }, 404);
        }

        const body = c.req.valid("json");
        const lastReadMessageId = normalizeConversationMessageId(
          body.last_read_message_id,
          conversation.last_message_id ?? null,
        );

        if (!lastReadMessageId) {
          return c.json({ success: true, unread_count: 0 });
        }

        await c.env.fitloot_db
          .prepare(
            `UPDATE conversation_members
                SET last_read_message_id = ?,
                    last_read_at = CURRENT_TIMESTAMP,
                    last_notified_message_id = ?,
                    last_notified_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
              WHERE conversation_id = ?
                AND user_id = ?`,
          )
          .bind(lastReadMessageId, lastReadMessageId, conversationId, user.id)
          .run();

        return c.json({ success: true, unread_count: 0 });
      } catch (error) {
        console.error("[/api/social/conversations/:id/read]", {
          message: getErrorMessage(error),
          userId: user.id,
          conversationId,
        });
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }
        return internalErrorResponse(c);
      }
    },
  );

  app.post(
    "/api/social/conversations/:id/mute",
    authMiddleware,
    zValidator("json", SocialConversationMuteRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const conversationId = Number(c.req.param("id"));
      if (!Number.isFinite(conversationId) || conversationId <= 0) {
        return c.json({ error: "Conversa invalida." }, 400);
      }

      try {
        await assertConversationMember(c.env.fitloot_db, conversationId, user.id);
        const body = c.req.valid("json");

        await c.env.fitloot_db
          .prepare(
            `UPDATE conversation_members
                SET notifications_muted = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE conversation_id = ?
                AND user_id = ?`,
          )
          .bind(body.muted === true, conversationId, user.id)
          .run();

        return c.json({ success: true, muted: body.muted });
      } catch (error) {
        if (error instanceof Error && error.name === "ConversationNotFoundError") {
          return c.json({ error: "Conversa nao encontrada." }, 404);
        }

        console.error("[/api/social/conversations/:id/mute]", {
          message: getErrorMessage(error),
          userId: user.id,
          conversationId,
        });
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }
        return internalErrorResponse(c);
      }
    },
  );

  app.get("/api/social/notifications/pending", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const limit = toPositiveInteger(c.req.query("limit"), MAX_NOTIFICATION_LIMIT, MAX_NOTIFICATION_LIMIT);
    c.header("Cache-Control", "no-store");

    try {
      const rows = await c.env.fitloot_db
        .prepare(
          `SELECT
             c.id as conversation_id,
             c.conversation_kind,
             c.title,
             latest.id as message_id,
             latest.message_text,
             latest.message_kind,
             latest.sender_user_id,
             up.username as sender_username,
             up.full_name as sender_full_name,
             u.avatar_url as sender_avatar_url,
             latest.created_at
           FROM conversation_members cm
           INNER JOIN conversations c
             ON c.id = cm.conversation_id
           INNER JOIN conversation_messages latest
             ON latest.id = (
               SELECT MAX(m2.id)
                 FROM conversation_messages m2
                WHERE m2.conversation_id = c.id
                  AND m2.deleted_at IS NULL
                  AND m2.sender_user_id <> ?
                  AND m2.id > COALESCE(cm.last_notified_message_id, 0)
                  AND m2.id > COALESCE(cm.last_read_message_id, 0)
             )
           INNER JOIN user_profiles up
             ON up.user_id = latest.sender_user_id
          LEFT JOIN users u
          ON u.id = latest.sender_user_id
          WHERE cm.user_id = ?
            AND (cm.notifications_muted IS NULL OR cm.notifications_muted = FALSE)
            AND (
              c.conversation_kind <> 'direct'
              OR EXISTS (
                SELECT 1
                  FROM conversation_members direct_peer
                 WHERE direct_peer.conversation_id = c.id
                   AND direct_peer.user_id <> cm.user_id
                   AND EXISTS (
                     SELECT 1
                       FROM friendships f
                      WHERE f.user_id = cm.user_id
                        AND COALESCE(f.friend_id, f.friend_user_id) = direct_peer.user_id
                        AND f.status = 'accepted'
                   )
                   AND NOT EXISTS (
                     SELECT 1
                       FROM user_blocks ub
                      WHERE (ub.blocker_user_id = cm.user_id AND ub.blocked_user_id = direct_peer.user_id)
                         OR (ub.blocker_user_id = direct_peer.user_id AND ub.blocked_user_id = cm.user_id)
                   )
              )
            )
          ORDER BY latest.id ASC
          LIMIT ?`,
        )
        .bind(user.id, user.id, limit)
        .all<ConversationNotificationRow>();

      const notificationsSource = Array.isArray(rows.results) ? rows.results : [];
      const notifications: SocialChatNotification[] = notificationsSource.map((row) => {
        return {
          conversation_id: toNonNegativeNumber(row.conversation_id),
          conversation_kind: normalizeConversationKind(row.conversation_kind),
          conversation_title: resolveNotificationConversationTitle(row),
          message_id: toNonNegativeNumber(row.message_id),
          message_text:
            sanitizeDisplayText(row.message_text) || buildMediaConversationPreviewLabel(row.message_kind),
          sender_user_id: row.sender_user_id,
          sender_username: sanitizeDisplayText(row.sender_username, "usuario"),
          sender_full_name:
            sanitizeDisplayText(row.sender_full_name) ||
            sanitizeDisplayText(row.sender_username, "Usuario"),
          sender_avatar_url: row.sender_avatar_url ?? null,
          created_at: row.created_at,
        };
      });

      return c.json(notifications);
    } catch (error) {
      console.error("[/api/social/notifications/pending]", {
        message: getErrorMessage(error),
        userId: user.id,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      return internalErrorResponse(c);
    }
  });

  app.post(
    "/api/social/notifications/consume",
    authMiddleware,
    zValidator("json", ConsumeSocialChatNotificationsRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const data = c.req.valid("json");
      const maxByConversation = new Map<number, number>();

      for (const item of data.items) {
        const current = maxByConversation.get(item.conversation_id) ?? 0;
        if (item.message_id > current) {
          maxByConversation.set(item.conversation_id, item.message_id);
        }
      }

      try {
        for (const [conversationId, messageId] of maxByConversation.entries()) {
          await c.env.fitloot_db
            .prepare(
              `UPDATE conversation_members
                  SET last_notified_message_id = ?,
                      last_notified_at = CURRENT_TIMESTAMP,
                      updated_at = CURRENT_TIMESTAMP
                WHERE conversation_id = ?
                  AND user_id = ?`,
            )
            .bind(messageId, conversationId, user.id)
            .run();
        }

        return c.json({ success: true });
      } catch (error) {
        console.error("[/api/social/notifications/consume]", {
          message: getErrorMessage(error),
          userId: user.id,
        });
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }
        return internalErrorResponse(c);
      }
    },
  );
}
