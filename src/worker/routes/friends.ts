import { Hono, type MiddlewareHandler } from "hono";

import type { AppContext } from "../core/types";

type WithTransaction = <T>(
  db: D1Database,
  run: () => Promise<T>,
) => Promise<T>;

type FriendsRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  onFriendAdded: (db: D1Database, userId: string) => Promise<void>;
  withTransaction: WithTransaction;
};

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
      if (!username) return c.json({ error: "username Ã© obrigatÃ³rio" }, 400);
      const target = await c.env.fitloot_db
        .prepare("SELECT user_id FROM user_profiles WHERE username = ?")
        .bind(username)
        .first<{ user_id: string }>();
      if (!target?.user_id) {
        return c.json({ error: "UsuÃ¡rio nÃ£o encontrado" }, 404);
      }
      targetUserId = target.user_id;
    }

    if (targetUserId === user.id) {
      return c.json({ error: "NÃ£o Ã© possÃ­vel adicionar a si mesmo" }, 400);
    }

    const existingFriend = await c.env.fitloot_db
      .prepare(
        `SELECT id FROM friendships
          WHERE (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)
             OR (user_id = ? AND COALESCE(friend_id, friend_user_id) = ?)`,
      )
      .bind(user.id, targetUserId, targetUserId, user.id)
      .first();
    if (existingFriend) return c.json({ error: "JÃ¡ sÃ£o amigos" }, 400);

    const existingReq = await c.env.fitloot_db
      .prepare(
        `SELECT id FROM friend_requests WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) AND status = 'pending'`,
      )
      .bind(user.id, targetUserId, targetUserId, user.id)
      .first();
    if (existingReq) return c.json({ error: "SolicitaÃ§Ã£o pendente" }, 400);

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
    if (!requestId) return c.json({ error: "request_id obrigatÃ³rio" }, 400);

    const request = await c.env.fitloot_db
      .prepare(
        `SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`,
      )
      .bind(requestId, user.id)
      .first<{ id: number; from_user_id: string; to_user_id: string }>();
    if (!request) {
      return c.json({ error: "SolicitaÃ§Ã£o nÃ£o encontrada" }, 404);
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
    });

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
    if (!requestId) return c.json({ error: "request_id obrigatÃ³rio" }, 400);

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
    return c.json({ success: true });
  });

  app.get("/api/friends", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 120), 1), 300);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

    const friends = await c.env.fitloot_db
      .prepare(
        `SELECT f.id, COALESCE(f.friend_id, f.friend_user_id) as friend_user_id, up.username as friend_username,
          up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
          pr.current_streak as friend_streak, pr.last_activity_date
        FROM friendships f
        INNER JOIN user_profiles up ON COALESCE(f.friend_id, f.friend_user_id) = up.user_id
        INNER JOIN user_progression pr ON COALESCE(f.friend_id, f.friend_user_id) = pr.user_id
        WHERE f.user_id = ?
        ORDER BY friend_level DESC, friend_xp DESC
        LIMIT ? OFFSET ?`,
      )
      .bind(user.id, limit, offset)
      .all();

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const friendsWithOnlineStatus = friends.results.map((friend) => ({
      ...friend,
      is_online: friend.last_activity_date
        ? new Date(friend.last_activity_date as string) > new Date(fiveMinutesAgo)
        : false,
    }));

    return c.json(friendsWithOnlineStatus);
  });

  app.get("/api/friends/requests", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
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
