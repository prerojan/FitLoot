export const FRIEND_ONLINE_WINDOW_MS = 10 * 60 * 1000;

export type SocialFriendRow = {
  id: number;
  friend_user_id: string;
  friend_username: string;
  friend_full_name: string;
  friend_avatar_url: string | null;
  friend_level: number;
  friend_xp: number;
  friend_streak: number;
  last_heartbeat_at: string | null;
  is_online: boolean;
};

export type PendingFriendRequestRow = {
  id: number;
  friend_user_id: string;
  friend_username: string;
  friend_full_name: string;
  friend_avatar_url: string | null;
  friend_level: number;
  friend_xp: number;
  friend_streak: number;
  created_at: string;
};

export type SocialUserPreferencesRow = {
  show_online_status: boolean;
  allow_friend_requests: boolean;
  allow_group_invites: boolean;
};

const DEFAULT_SOCIAL_USER_PREFERENCES: SocialUserPreferencesRow = {
  show_online_status: true,
  allow_friend_requests: true,
  allow_group_invites: true,
};

function coercePresenceBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "t", "yes", "online"].includes(normalized)) return true;
    if (["0", "false", "f", "no", "offline"].includes(normalized)) return false;
  }
  return null;
}

function hasRecentPresenceHeartbeat(
  value: unknown,
  windowMs = FRIEND_ONLINE_WINDOW_MS,
): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed <= windowMs;
}

export function resolveFriendOnlineState(
  row: {
    is_online?: unknown;
    presence_status?: unknown;
    last_heartbeat_at?: unknown;
  },
): boolean {
  const explicit = coercePresenceBoolean(row.is_online);
  if (explicit !== null) return explicit;

  const normalizedStatus =
    typeof row.presence_status === "string"
      ? row.presence_status.trim().toLowerCase()
      : "";
  if (normalizedStatus === "offline") return false;
  if (normalizedStatus === "online") {
    return hasRecentPresenceHeartbeat(row.last_heartbeat_at);
  }

  return false;
}

function normalizeFriendRow(row: Record<string, unknown>): SocialFriendRow {
  return {
    id: Math.max(0, Number(row.id ?? 0)),
    friend_user_id: String(row.friend_user_id ?? ""),
    friend_username: String(row.friend_username ?? ""),
    friend_full_name: String(row.friend_full_name ?? row.friend_username ?? ""),
    friend_avatar_url:
      typeof row.friend_avatar_url === "string" && row.friend_avatar_url.trim().length > 0
        ? row.friend_avatar_url
        : null,
    friend_level: Math.max(0, Number(row.friend_level ?? 0)),
    friend_xp: Math.max(0, Number(row.friend_xp ?? 0)),
    friend_streak: Math.max(0, Number(row.friend_streak ?? 0)),
    last_heartbeat_at:
      typeof row.last_heartbeat_at === "string" && row.last_heartbeat_at.trim().length > 0
        ? row.last_heartbeat_at
        : null,
    is_online: resolveFriendOnlineState(row),
  };
}

function normalizeSocialUserPreferencesRow(
  row: Record<string, unknown> | null | undefined,
): SocialUserPreferencesRow {
  return {
    show_online_status: coercePresenceBoolean(row?.show_online_status) ?? true,
    allow_friend_requests: coercePresenceBoolean(row?.allow_friend_requests) ?? true,
    allow_group_invites: coercePresenceBoolean(row?.allow_group_invites) ?? true,
  };
}

export function isPresenceRelationError(message: string): boolean {
  return (
    message.includes("friend_online_presence") ||
    message.includes("user_presence") ||
    message.includes("no such table") ||
    message.includes("relation")
  );
}

async function listFriendsViaPresenceView(
  db: D1Database,
  userId: string,
  limit: number,
  offset: number,
): Promise<SocialFriendRow[]> {
  const friendsWithPresence = await db
    .prepare(
      `SELECT
        f.id,
        COALESCE(f.friend_id, f.friend_user_id) as friend_user_id,
        up.username as friend_username,
        up.full_name as friend_full_name,
        u.avatar_url as friend_avatar_url,
        pr.level as friend_level,
        pr.xp as friend_xp,
        pr.current_streak as friend_streak,
        CASE
          WHEN COALESCE(sup.show_online_status, 1) = 1 THEN fp.last_heartbeat_at
          ELSE NULL
        END as last_heartbeat_at,
        CASE
          WHEN COALESCE(sup.show_online_status, 1) = 1 THEN COALESCE(fp.is_online, FALSE)
          ELSE FALSE
        END as is_online
      FROM friendships f
      INNER JOIN user_profiles up
        ON COALESCE(f.friend_id, f.friend_user_id) = up.user_id
      LEFT JOIN users u
        ON u.id = up.user_id
      INNER JOIN user_progression pr
        ON COALESCE(f.friend_id, f.friend_user_id) = pr.user_id
      LEFT JOIN social_user_preferences sup
        ON sup.user_id = up.user_id
      LEFT JOIN friend_online_presence fp
        ON fp.user_id = f.user_id
       AND fp.friend_user_id = COALESCE(f.friend_id, f.friend_user_id)
      WHERE f.user_id = ?
        AND f.status = 'accepted'
      ORDER BY friend_level DESC, friend_xp DESC
      LIMIT ? OFFSET ?`,
    )
    .bind(userId, limit, offset)
    .all<Record<string, unknown>>();

  return friendsWithPresence.results.map(normalizeFriendRow);
}

async function listFriendsViaPresenceTable(
  db: D1Database,
  userId: string,
  limit: number,
  offset: number,
): Promise<SocialFriendRow[]> {
  const friendsWithPresence = await db
    .prepare(
      `SELECT
        f.id,
        COALESCE(f.friend_id, f.friend_user_id) as friend_user_id,
        up.username as friend_username,
        up.full_name as friend_full_name,
        u.avatar_url as friend_avatar_url,
        pr.level as friend_level,
        pr.xp as friend_xp,
        pr.current_streak as friend_streak,
        CASE
          WHEN COALESCE(sup.show_online_status, 1) = 1 THEN p.presence_status
          ELSE 'offline'
        END as presence_status,
        CASE
          WHEN COALESCE(sup.show_online_status, 1) = 1 THEN p.last_heartbeat_at
          ELSE NULL
        END as last_heartbeat_at
      FROM friendships f
      INNER JOIN user_profiles up
        ON COALESCE(f.friend_id, f.friend_user_id) = up.user_id
      LEFT JOIN users u
        ON u.id = up.user_id
      INNER JOIN user_progression pr
        ON COALESCE(f.friend_id, f.friend_user_id) = pr.user_id
      LEFT JOIN social_user_preferences sup
        ON sup.user_id = up.user_id
      LEFT JOIN user_presence p
        ON p.user_id = COALESCE(f.friend_id, f.friend_user_id)
      WHERE f.user_id = ?
        AND f.status = 'accepted'
      ORDER BY friend_level DESC, friend_xp DESC
      LIMIT ? OFFSET ?`,
    )
    .bind(userId, limit, offset)
    .all<Record<string, unknown>>();

  return friendsWithPresence.results.map(normalizeFriendRow);
}

async function listFriendsWithoutPresence(
  db: D1Database,
  userId: string,
  limit: number,
  offset: number,
): Promise<SocialFriendRow[]> {
  const friends = await db
    .prepare(
      `SELECT
        f.id,
        COALESCE(f.friend_id, f.friend_user_id) as friend_user_id,
        up.username as friend_username,
        up.full_name as friend_full_name,
        u.avatar_url as friend_avatar_url,
        pr.level as friend_level,
        pr.xp as friend_xp,
        pr.current_streak as friend_streak
      FROM friendships f
      INNER JOIN user_profiles up
        ON COALESCE(f.friend_id, f.friend_user_id) = up.user_id
      LEFT JOIN users u
        ON u.id = up.user_id
      INNER JOIN user_progression pr
        ON COALESCE(f.friend_id, f.friend_user_id) = pr.user_id
      WHERE f.user_id = ?
        AND f.status = 'accepted'
      ORDER BY friend_level DESC, friend_xp DESC
      LIMIT ? OFFSET ?`,
    )
    .bind(userId, limit, offset)
    .all<Record<string, unknown>>();

  return friends.results.map((friend) =>
    normalizeFriendRow({
      ...friend,
      last_heartbeat_at: null,
      is_online: false,
    }),
  );
}

export async function listAcceptedFriendsWithPresence(
  db: D1Database,
  userId: string,
  limit: number,
  offset: number,
): Promise<SocialFriendRow[]> {
  try {
    return await listFriendsViaPresenceView(db, userId, limit, offset);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!isPresenceRelationError(message)) {
      throw error;
    }
  }

  try {
    return await listFriendsViaPresenceTable(db, userId, limit, offset);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!isPresenceRelationError(message)) {
      throw error;
    }
  }

  return listFriendsWithoutPresence(db, userId, limit, offset);
}

export async function listPendingFriendRequests(
  db: D1Database,
  userId: string,
  limit: number,
  offset: number,
): Promise<PendingFriendRequestRow[]> {
  const requests = await db
    .prepare(
      `SELECT
         fr.id,
         fr.from_user_id as friend_user_id,
         up.username as friend_username,
         up.full_name as friend_full_name,
         pr.level as friend_level,
         pr.xp as friend_xp,
         u.avatar_url as friend_avatar_url,
         pr.current_streak as friend_streak,
         fr.created_at
       FROM friend_requests fr
       INNER JOIN user_profiles up
         ON fr.from_user_id = up.user_id
       LEFT JOIN users u
         ON u.id = up.user_id
       INNER JOIN user_progression pr
         ON fr.from_user_id = pr.user_id
      WHERE fr.to_user_id = ?
        AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
      LIMIT ? OFFSET ?`,
    )
    .bind(userId, limit, offset)
    .all<PendingFriendRequestRow>();

  return Array.isArray(requests.results) ? requests.results : [];
}

export async function areUsersBlocked(
  db: D1Database,
  leftUserId: string,
  rightUserId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1
         FROM user_blocks
        WHERE (blocker_user_id = ? AND blocked_user_id = ?)
           OR (blocker_user_id = ? AND blocked_user_id = ?)
        LIMIT 1`,
    )
    .bind(leftUserId, rightUserId, rightUserId, leftUserId)
    .first<{ 1: number }>();

  return Boolean(row);
}

export async function hasUserBlocked(
  db: D1Database,
  blockerUserId: string,
  blockedUserId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1
         FROM user_blocks
        WHERE blocker_user_id = ?
          AND blocked_user_id = ?
        LIMIT 1`,
    )
    .bind(blockerUserId, blockedUserId)
    .first<{ 1: number }>();

  return Boolean(row);
}

export async function readSocialUserPreferences(
  db: D1Database,
  userId: string,
): Promise<SocialUserPreferencesRow> {
  const row = await db
    .prepare(
      `SELECT show_online_status, allow_friend_requests, allow_group_invites
         FROM social_user_preferences
        WHERE user_id = ?
        LIMIT 1`,
    )
    .bind(userId)
    .first<Record<string, unknown>>();

  if (!row) {
    return { ...DEFAULT_SOCIAL_USER_PREFERENCES };
  }

  return normalizeSocialUserPreferencesRow(row);
}
