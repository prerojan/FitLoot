import { Hono, type MiddlewareHandler } from "hono";

import type { AppContext } from "../core/types";
import {
  areUsersBlocked,
  listAcceptedFriendsWithPresence,
  listPendingFriendRequests,
  readSocialUserPreferences,
  type SocialFriendRow,
} from "../services/socialGraph";
import type { WithTransaction } from "./contracts";

type FriendsRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  onFriendAdded: (db: D1Database, userId: string) => Promise<void>;
  withTransaction: WithTransaction;
};

const RUNTIME_FRIEND_PROJECTION_TTL_MS = 10_000;
let runtimeFriendProjectionSchemaReady = false;

async function ensureRuntimeFriendProjectionSchema(runtimeDb: D1Database): Promise<void> {
  if (runtimeFriendProjectionSchemaReady) return;

  await runtimeDb.exec(
    `CREATE TABLE IF NOT EXISTS runtime_friend_snapshots (
      user_id TEXT NOT NULL,
      friend_user_id TEXT NOT NULL,
      friend_level INTEGER NOT NULL DEFAULT 0,
      friend_xp INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      snapshot_at TEXT NOT NULL,
      PRIMARY KEY (user_id, friend_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_friend_snapshots_user_rank
      ON runtime_friend_snapshots (user_id, friend_level DESC, friend_xp DESC, friend_user_id ASC);`,
  );

  runtimeFriendProjectionSchemaReady = true;
}

async function readRuntimeFriendProjection(
  runtimeDb: D1Database,
  userId: string,
  limit: number,
  offset: number,
): Promise<SocialFriendRow[] | null> {
  await ensureRuntimeFriendProjectionSchema(runtimeDb);

  const freshness = await runtimeDb
    .prepare(
      `SELECT snapshot_at
         FROM runtime_friend_snapshots
        WHERE user_id = ?
        ORDER BY snapshot_at DESC
        LIMIT 1`,
    )
    .bind(userId)
    .first<{ snapshot_at?: string | null }>();

  const snapshotAt = freshness?.snapshot_at ? Date.parse(freshness.snapshot_at) : NaN;
  if (!Number.isFinite(snapshotAt)) return null;
  if (Date.now() - snapshotAt > RUNTIME_FRIEND_PROJECTION_TTL_MS) return null;

  const rows = await runtimeDb
    .prepare(
      `SELECT payload_json
         FROM runtime_friend_snapshots
        WHERE user_id = ?
        ORDER BY friend_level DESC, friend_xp DESC, friend_user_id ASC
        LIMIT ? OFFSET ?`,
    )
    .bind(userId, limit, offset)
    .all<{ payload_json: string }>();

  return rows.results
    .map((row) => {
      try {
        return JSON.parse(row.payload_json) as SocialFriendRow;
      } catch {
        return null;
      }
    })
    .filter((row): row is SocialFriendRow => row !== null);
}

async function writeRuntimeFriendProjection(
  runtimeDb: D1Database,
  userId: string,
  friends: readonly SocialFriendRow[],
): Promise<void> {
  await ensureRuntimeFriendProjectionSchema(runtimeDb);

  const snapshotAt = new Date().toISOString();
  await runtimeDb.prepare("DELETE FROM runtime_friend_snapshots WHERE user_id = ?").bind(userId).run();

  if (friends.length === 0) return;

  const statements = friends.map((friend) =>
    runtimeDb
      .prepare(
        `INSERT INTO runtime_friend_snapshots (
          user_id,
          friend_user_id,
          friend_level,
          friend_xp,
          payload_json,
          snapshot_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        userId,
        friend.friend_user_id,
        Math.max(0, friend.friend_level),
        Math.max(0, friend.friend_xp),
        JSON.stringify(friend),
        snapshotAt,
      ),
  );

  await runtimeDb.batch(statements);
}

async function clearRuntimeFriendProjection(runtimeDb: D1Database, ...userIds: string[]): Promise<void> {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return;

  await ensureRuntimeFriendProjectionSchema(runtimeDb);
  await runtimeDb.batch(
    uniqueUserIds.map((userId) =>
      runtimeDb.prepare("DELETE FROM runtime_friend_snapshots WHERE user_id = ?").bind(userId),
    ),
  );
}

function normalizeSearchQuery(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

async function resolveTargetUserId(
  db: D1Database,
  currentUserId: string,
  friendUserId: string,
  username: string,
): Promise<string | null> {
  const explicitUserId = friendUserId.trim();
  if (explicitUserId) {
    return explicitUserId;
  }

  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    return null;
  }

  const target = await db
    .prepare(
      `SELECT user_id
         FROM user_profiles
        WHERE username = ?
          AND user_id <> ?
        LIMIT 1`,
    )
    .bind(normalizedUsername, currentUserId)
    .first<{ user_id: string }>();

  return target?.user_id?.trim() || null;
}

export function registerFriendsRoutes(
  app: Hono<AppContext>,
  { authMiddleware, onFriendAdded, withTransaction }: FriendsRouteDeps,
): void {
  app.get("/api/friends/search", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const username = normalizeSearchQuery(c.req.query("username"));
    if (username.length < 3) return c.json([]);

    const users = await c.env.fitloot_db
      .prepare(
        `SELECT
           up.user_id,
           up.username,
           up.full_name,
           u.avatar_url,
           pr.level,
           pr.xp
         FROM user_profiles up
         LEFT JOIN users u
           ON up.user_id = u.id
         INNER JOIN user_progression pr
           ON up.user_id = pr.user_id
         LEFT JOIN social_user_preferences sup
           ON sup.user_id = up.user_id
        WHERE up.user_id <> ?
          AND up.username LIKE ?
          AND COALESCE(sup.allow_friend_requests, 1) = 1
          AND NOT EXISTS (
            SELECT 1
              FROM user_blocks ub
             WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = up.user_id)
                OR (ub.blocker_user_id = up.user_id AND ub.blocked_user_id = ?)
          )
        ORDER BY up.username ASC
        LIMIT 20`,
      )
      .bind(user.id, `%${username}%`, user.id, user.id)
      .all();

    return c.json(Array.isArray(users.results) ? users.results : []);
  });

  app.get("/api/users/search", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const query = normalizeSearchQuery(c.req.query("q"));
    if (query.length < 3) return c.json([]);

    const users = await c.env.fitloot_db
      .prepare(
        `SELECT
           up.user_id,
           up.username,
           up.full_name,
           u.avatar_url,
           pr.level,
           pr.xp
         FROM user_profiles up
         LEFT JOIN users u
           ON up.user_id = u.id
         INNER JOIN user_progression pr
           ON up.user_id = pr.user_id
         LEFT JOIN social_user_preferences sup
           ON sup.user_id = up.user_id
        WHERE up.user_id <> ?
          AND up.username LIKE ?
          AND COALESCE(sup.allow_friend_requests, 1) = 1
          AND NOT EXISTS (
            SELECT 1
              FROM user_blocks ub
             WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = up.user_id)
                OR (ub.blocker_user_id = up.user_id AND ub.blocked_user_id = ?)
          )
        ORDER BY up.username ASC
        LIMIT 20`,
      )
      .bind(user.id, `%${query}%`, user.id, user.id)
      .all();

    return c.json(Array.isArray(users.results) ? users.results : []);
  });

  app.post("/api/friends/request", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as {
      username?: string | undefined;
      friend_user_id?: string | undefined;
    };

    const targetUserId = await resolveTargetUserId(
      c.env.fitloot_db,
      user.id,
      String(body.friend_user_id ?? ""),
      String(body.username ?? ""),
    );

    if (!targetUserId) {
      return c.json({ error: "Usuario nao encontrado." }, 404);
    }
    if (targetUserId === user.id) {
      return c.json({ error: "Nao e possivel adicionar a si mesmo." }, 400);
    }

    const blocked = await areUsersBlocked(c.env.fitloot_db, user.id, targetUserId);
    if (blocked) {
      return c.json({ error: "Este usuario nao esta disponivel para solicitacoes." }, 403);
    }

    const targetPreferences = await readSocialUserPreferences(c.env.fitloot_db, targetUserId);
    if (!targetPreferences.allow_friend_requests) {
      return c.json({ error: "Este usuario nao aceita novas solicitacoes de amizade." }, 403);
    }

    const existingFriend = await c.env.fitloot_db
      .prepare(
        `SELECT id
           FROM friendships
          WHERE (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)
             OR (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)
          LIMIT 1`,
      )
      .bind(user.id, targetUserId, targetUserId, user.id)
      .first();
    if (existingFriend) {
      return c.json({ error: "Voce ja e amigo deste usuario." }, 400);
    }

    const existingRequest = await c.env.fitloot_db
      .prepare(
        `SELECT id
           FROM friend_requests
          WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
            AND status = 'pending'
          LIMIT 1`,
      )
      .bind(user.id, targetUserId, targetUserId, user.id)
      .first();
    if (existingRequest) {
      return c.json({ error: "Ja existe uma solicitacao pendente." }, 400);
    }

    await c.env.fitloot_db
      .prepare(
        `INSERT INTO friend_requests (
           from_user_id,
           to_user_id,
           status,
           created_at,
           updated_at
         ) VALUES (?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(user.id, targetUserId)
      .run();

    return c.json({ success: true }, 201);
  });

  app.post("/api/friends/accept", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as {
      request_id?: number | undefined;
    };
    const requestId = Number(body.request_id ?? 0);
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return c.json({ error: "request_id obrigatorio." }, 400);
    }

    const request = await c.env.fitloot_db
      .prepare(
        `SELECT id, from_user_id, to_user_id
           FROM friend_requests
          WHERE id = ?
            AND to_user_id = ?
            AND status = 'pending'
          LIMIT 1`,
      )
      .bind(requestId, user.id)
      .first<{
        id: number;
        from_user_id: string;
        to_user_id: string;
      }>();

    if (!request) {
      return c.json({ error: "Solicitacao nao encontrada." }, 404);
    }

    const blocked = await areUsersBlocked(c.env.fitloot_db, user.id, request.from_user_id);
    if (blocked) {
      return c.json({ error: "Nao e possivel aceitar esta solicitacao." }, 403);
    }

    await withTransaction(
      c.env.fitloot_db,
      async () => {
        await c.env.fitloot_db
          .prepare(
            `UPDATE friend_requests
                SET status = 'accepted',
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
          )
          .bind(requestId)
          .run();

        await c.env.fitloot_db
          .prepare(
            `INSERT OR IGNORE INTO friendships (
               user_id,
               friend_user_id,
               friend_id,
               status,
               created_at,
               updated_at
             ) VALUES (?, ?, ?, 'accepted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(request.from_user_id, request.to_user_id, request.to_user_id)
          .run();

        await c.env.fitloot_db
          .prepare(
            `INSERT OR IGNORE INTO friendships (
               user_id,
               friend_user_id,
               friend_id,
               status,
               created_at,
               updated_at
             ) VALUES (?, ?, ?, 'accepted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(request.to_user_id, request.from_user_id, request.from_user_id)
          .run();
      },
      c.env,
    );

    if (c.env.fitloot_runtime_db) {
      c.executionCtx.waitUntil(
        clearRuntimeFriendProjection(
          c.env.fitloot_runtime_db,
          request.from_user_id,
          request.to_user_id,
        ).catch(() => undefined),
      );
    }

    await onFriendAdded(c.env.fitloot_db, request.to_user_id);
    await onFriendAdded(c.env.fitloot_db, request.from_user_id);

    return c.json({ success: true });
  });

  app.post("/api/friends/reject", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as {
      request_id?: number | undefined;
    };
    const requestId = Number(body.request_id ?? 0);
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return c.json({ error: "request_id obrigatorio." }, 400);
    }

    await c.env.fitloot_db
      .prepare(
        `UPDATE friend_requests
            SET status = 'rejected',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND to_user_id = ?`,
      )
      .bind(requestId, user.id)
      .run();

    return c.json({ success: true });
  });

  app.delete("/api/friends/:friendId", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const friendId = normalizeSearchQuery(c.req.param("friendId"));
    if (!friendId) {
      return c.json({ error: "Amigo invalido." }, 400);
    }

    await c.env.fitloot_db
      .prepare(
        `DELETE FROM friendships
          WHERE (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)
             OR (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)`,
      )
      .bind(user.id, friendId, friendId, user.id)
      .run();

    if (c.env.fitloot_runtime_db) {
      c.executionCtx.waitUntil(
        clearRuntimeFriendProjection(c.env.fitloot_runtime_db, user.id, friendId).catch(() => undefined),
      );
    }

    return c.json({ success: true });
  });

  app.get("/api/friends", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    c.header("Cache-Control", "no-store");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 120), 1), 300);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
    const runtimeDb = c.env.fitloot_runtime_db;

    if (runtimeDb) {
      try {
        const projected = await readRuntimeFriendProjection(runtimeDb, user.id, limit, offset);
        if (projected && projected.length > 0) {
          return c.json(projected);
        }
      } catch {
        // Runtime projection is opportunistic and should never block the canonical source.
      }
    }

    const friends = await listAcceptedFriendsWithPresence(c.env.fitloot_db, user.id, limit, offset);

    if (runtimeDb) {
      c.executionCtx.waitUntil(
        writeRuntimeFriendProjection(runtimeDb, user.id, friends).catch(() => undefined),
      );
    }

    return c.json(friends);
  });

  app.get("/api/friends/requests", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    c.header("Cache-Control", "no-store");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 80), 1), 200);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

    const requests = await listPendingFriendRequests(c.env.fitloot_db, user.id, limit, offset);
    return c.json(requests);
  });

  app.get("/api/friends/list", authMiddleware, async (c) =>
    app.fetch(
      new Request(new URL("/api/friends", c.req.url).toString(), {
        method: "GET",
        headers: c.req.raw.headers,
      }),
      c.env,
      c.executionCtx,
    ),
  );

  app.post("/api/friends/:id/accept", authMiddleware, async (c) =>
    app.fetch(
      new Request(new URL("/api/friends/accept", c.req.url).toString(), {
        method: "POST",
        headers: c.req.raw.headers,
        body: JSON.stringify({ request_id: Number(c.req.param("id")) }),
      }),
      c.env,
      c.executionCtx,
    ),
  );

  app.post("/api/friends/:id/reject", authMiddleware, async (c) =>
    app.fetch(
      new Request(new URL("/api/friends/reject", c.req.url).toString(), {
        method: "POST",
        headers: c.req.raw.headers,
        body: JSON.stringify({ request_id: Number(c.req.param("id")) }),
      }),
      c.env,
      c.executionCtx,
    ),
  );
}
