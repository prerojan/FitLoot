import { Hono, type MiddlewareHandler } from "hono";

import { getErrorMessage } from "../core/errors";
import type { AppContext } from "../core/types";
import type { WithTransaction } from "./contracts";

type FriendsRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  onFriendAdded: (db: D1Database, userId: string) => Promise<void>;
  withTransaction: WithTransaction;
};

const RUNTIME_FRIEND_PROJECTION_TTL_MS = 10_000;
const FRIEND_ONLINE_WINDOW_MS = 10 * 60 * 1000;
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
): Promise<Record<string, unknown>[] | null> {
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
        return JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((row): row is Record<string, unknown> => row !== null);
}

async function writeRuntimeFriendProjection(
  runtimeDb: D1Database,
  userId: string,
  friends: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  await ensureRuntimeFriendProjectionSchema(runtimeDb);
  const snapshotAt = new Date().toISOString();
  await runtimeDb
    .prepare("DELETE FROM runtime_friend_snapshots WHERE user_id = ?")
    .bind(userId)
    .run();

  if (friends.length === 0) return;

  const statements: D1PreparedStatement[] = [];
  for (const friend of friends) {
    statements.push(
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
          String(friend.friend_user_id ?? ""),
          Math.max(0, Number(friend.friend_level ?? 0)),
          Math.max(0, Number(friend.friend_xp ?? 0)),
          JSON.stringify(friend),
          snapshotAt,
        ),
    );
  }
  await runtimeDb.batch(statements);
}

async function clearRuntimeFriendProjection(
  runtimeDb: D1Database,
  ...userIds: string[]
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return;

  await ensureRuntimeFriendProjectionSchema(runtimeDb);
  const statements = uniqueUserIds.map((userId) =>
    runtimeDb.prepare("DELETE FROM runtime_friend_snapshots WHERE user_id = ?").bind(userId),
  );
  await runtimeDb.batch(statements);
}

// Route registration for friend discovery, requests, and legacy aliases.
export function registerFriendsRoutes(
  app: Hono<AppContext>,
  { authMiddleware, onFriendAdded, withTransaction }: FriendsRouteDeps,
): void {
  app.get("/api/friends/search", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const username = (c.req.query("username") ?? "").trim();
    if (username.length < 3) return c.json([]);

    const users = await c.env.fitloot_db
      .prepare(
        `SELECT up.user_id, up.username, up.full_name, pr.level, pr.xp
          FROM user_profiles up
          INNER JOIN user_progression pr ON up.user_id = pr.user_id
          WHERE up.user_id != ? AND up.username LIKE ?
          LIMIT 20`,
      )
      .bind(user.id, `%${username}%`)
      .all();

    return c.json(users.results);
  });

  app.get("/api/users/search", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 3) return c.json([]);
    const users = await c.env.fitloot_db
      .prepare(
        `SELECT up.user_id, up.username, up.full_name, pr.level, pr.xp
          FROM user_profiles up
          INNER JOIN user_progression pr ON up.user_id = pr.user_id
          WHERE up.user_id != ? AND up.username LIKE ?
          LIMIT 20`,
      )
      .bind(user.id, `%${q}%`)
      .all();
    return c.json(users.results);
  });

  app.post("/api/friends/request", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as {
      username?: string | undefined;
      friend_user_id?: string | undefined;
    };
    const username = String(body.username ?? "").trim();
    let targetUserId = String(body.friend_user_id ?? "").trim();

    if (!targetUserId) {
      if (!username) return c.json({ error: "username é obrigatório" }, 400);
      const target = await c.env.fitloot_db
        .prepare("SELECT user_id FROM user_profiles WHERE username = ?")
        .bind(username)
        .first<{ user_id: string }>();
      if (!target?.user_id) {
        return c.json({ error: "Usuário não encontrado" }, 404);
      }
      targetUserId = target.user_id;
    }

    if (targetUserId === user.id) {
      return c.json({ error: "Não é possível adicionar a si mesmo" }, 400);
    }

    const existingFriend = await c.env.fitloot_db
      .prepare(
        `SELECT id FROM friendships
          WHERE (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)
             OR (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)`,
      )
      .bind(user.id, targetUserId, targetUserId, user.id)
      .first();
    if (existingFriend) return c.json({ error: "Já são amigos" }, 400);

    const existingReq = await c.env.fitloot_db
      .prepare(
        `SELECT id FROM friend_requests WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) AND status = 'pending'`,
      )
      .bind(user.id, targetUserId, targetUserId, user.id)
      .first();
    if (existingReq) return c.json({ error: "Solicitação pendente" }, 400);

    await c.env.fitloot_db
      .prepare(
        `INSERT INTO friend_requests (from_user_id, to_user_id, status, updated_at) VALUES (?, ?, 'pending', datetime('now'))`,
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
    const requestId = Number(body.request_id);
    if (!requestId) return c.json({ error: "request_id obrigatório" }, 400);

    const request = await c.env.fitloot_db
      .prepare(
        `SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`,
      )
      .bind(requestId, user.id)
      .first<{ id: number; from_user_id: string; to_user_id: string }>();
    if (!request) {
      return c.json({ error: "Solicitação não encontrada" }, 404);
    }

    await withTransaction(c.env.fitloot_db, async () => {
      await c.env.fitloot_db
        .prepare(
          "UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?",
        )
        .bind(requestId)
        .run();
      await c.env.fitloot_db
        .prepare(
          `INSERT OR IGNORE INTO friendships (user_id, friend_user_id, friend_id, status, created_at, updated_at)
          VALUES (?, ?, ?, 'accepted', datetime('now'), datetime('now'))`,
        )
        .bind(request.from_user_id, request.to_user_id, request.to_user_id)
        .run();
      await c.env.fitloot_db
        .prepare(
          `INSERT OR IGNORE INTO friendships (user_id, friend_user_id, friend_id, status, created_at, updated_at)
          VALUES (?, ?, ?, 'accepted', datetime('now'), datetime('now'))`,
        )
        .bind(request.to_user_id, request.from_user_id, request.from_user_id)
        .run();
    }, c.env);

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
    const requestId = Number(body.request_id);
    if (!requestId) return c.json({ error: "request_id obrigatório" }, 400);

    await c.env.fitloot_db
      .prepare(
        `UPDATE friend_requests SET status = 'rejected', updated_at = datetime('now') WHERE id = ? AND to_user_id = ?`,
      )
      .bind(requestId, user.id)
      .run();

    return c.json({ success: true });
  });

  app.delete("/api/friends/:friendId", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const friendId = c.req.param("friendId");
    await c.env.fitloot_db
      .prepare(
        `DELETE FROM friendships
          WHERE (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)
             OR (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)`,
      )
      .bind(user.id, friendId, friendId, user.id)
      .run();

    if (c.env.fitloot_runtime_db) {
      void clearRuntimeFriendProjection(c.env.fitloot_runtime_db, user.id, friendId).catch(
        () => undefined,
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
        // projection read should never block canonical source fetch
      }
    }

    try {
      const friendsWithPresence = await c.env.fitloot_db
        .prepare(
          `SELECT
            f.id,
            COALESCE(f.friend_id, f.friend_user_id) as friend_user_id,
            up.username as friend_username,
            up.full_name as friend_full_name,
            pr.level as friend_level,
            pr.xp as friend_xp,
            pr.current_streak as friend_streak,
            fp.last_heartbeat_at,
            COALESCE(fp.is_online, 0) as is_online
          FROM friendships f
          INNER JOIN user_profiles up
            ON COALESCE(f.friend_id, f.friend_user_id) = up.user_id
          INNER JOIN user_progression pr
            ON COALESCE(f.friend_id, f.friend_user_id) = pr.user_id
          LEFT JOIN friend_online_presence fp
            ON fp.user_id = f.user_id
           AND fp.friend_user_id = COALESCE(f.friend_id, f.friend_user_id)
          WHERE f.user_id = ?
          ORDER BY friend_level DESC, friend_xp DESC
          LIMIT ? OFFSET ?`,
        )
        .bind(user.id, limit, offset)
        .all<Record<string, unknown>>();

      const normalized = friendsWithPresence.results.map((friend) => ({
        ...friend,
        is_online: Number(friend.is_online ?? 0) > 0,
      }));

      if (runtimeDb) {
        void writeRuntimeFriendProjection(runtimeDb, user.id, normalized).catch(() => undefined);
      }
      return c.json(normalized);
    } catch (error) {
      const errorMessage = getErrorMessage(error).toLowerCase();
      const canFallback =
        errorMessage.includes("friend_online_presence") ||
        errorMessage.includes("user_presence") ||
        errorMessage.includes("no such table") ||
        errorMessage.includes("relation");

      if (!canFallback) {
        throw error;
      }

      // Fallback de compatibilidade para ambientes sem a view de presença.
      const friends = await c.env.fitloot_db
        .prepare(
          `SELECT f.id, COALESCE(f.friend_id, f.friend_user_id) as friend_user_id, up.username as friend_username,
            up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
            pr.current_streak as friend_streak, pr.last_activity_date as last_heartbeat_at
          FROM friendships f
          INNER JOIN user_profiles up ON COALESCE(f.friend_id, f.friend_user_id) = up.user_id
          INNER JOIN user_progression pr ON COALESCE(f.friend_id, f.friend_user_id) = pr.user_id
          WHERE f.user_id = ?
          ORDER BY friend_level DESC, friend_xp DESC
          LIMIT ? OFFSET ?`,
        )
        .bind(user.id, limit, offset)
        .all();

      const onlineWindowStart = new Date(Date.now() - FRIEND_ONLINE_WINDOW_MS).toISOString();
      const friendsWithOnlineStatus = friends.results.map((friend) => ({
        ...friend,
        is_online: friend.last_heartbeat_at
          ? new Date(friend.last_heartbeat_at as string) > new Date(onlineWindowStart)
          : false,
      }));

      if (runtimeDb) {
        void writeRuntimeFriendProjection(runtimeDb, user.id, friendsWithOnlineStatus).catch(() => undefined);
      }

      return c.json(friendsWithOnlineStatus);
    }
  });

  app.get("/api/friends/requests", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    c.header("Cache-Control", "no-store");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 80), 1), 200);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

    const requests = await c.env.fitloot_db
      .prepare(
        `SELECT fr.id, fr.from_user_id as friend_user_id, up.username as friend_username,
          up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
          pr.current_streak as friend_streak, fr.created_at
        FROM friend_requests fr
        INNER JOIN user_profiles up ON fr.from_user_id = up.user_id
        INNER JOIN user_progression pr ON fr.from_user_id = pr.user_id
        WHERE fr.to_user_id = ? AND fr.status = 'pending'
        ORDER BY fr.created_at DESC
        LIMIT ? OFFSET ?`,
      )
      .bind(user.id, limit, offset)
      .all();

    return c.json(requests.results);
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
