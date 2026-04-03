import { Hono, type MiddlewareHandler } from "hono";

import type { AppContext } from "../core/types";

type PresenceRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  getSessionIdFromCookieHeader: (cookieHeader: string | undefined) => string | null;
};

function isPresenceSchemaError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("no such table") ||
    message.includes("relation") ||
    message.includes("user_presence")
  );
}

function normalizePresenceVisibility(value: unknown): "friends" | "private" | "public" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "private") return "private";
  if (normalized === "public") return "public";
  return "friends";
}

function normalizeCurrentActivity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 120);
}

// Registers lightweight user presence heartbeat routes used by friends online status.
export function registerPresenceRoutes(
  app: Hono<AppContext>,
  { authMiddleware, getSessionIdFromCookieHeader }: PresenceRouteDeps,
): void {
  app.post("/api/presence/heartbeat", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const visibility = normalizePresenceVisibility(body.visibility);
    const currentActivity = normalizeCurrentActivity(body.current_activity);
    const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));

    try {
      await c.env.fitloot_db
        .prepare(
          `INSERT INTO user_presence (
            user_id,
            presence_status,
            visibility,
            source,
            session_id,
            current_activity,
            last_heartbeat_at,
            last_seen_at,
            updated_at
          ) VALUES (
            ?,
            'online',
            ?,
            'app',
            ?,
            ?,
            datetime('now'),
            datetime('now'),
            datetime('now')
          )
          ON CONFLICT(user_id) DO UPDATE SET
            presence_status = 'online',
            visibility = excluded.visibility,
            session_id = excluded.session_id,
            current_activity = excluded.current_activity,
            last_heartbeat_at = datetime('now'),
            last_seen_at = datetime('now'),
            updated_at = datetime('now')`,
        )
        .bind(user.id, visibility, sessionId, currentActivity)
        .run();
      return c.json({ success: true });
    } catch (error) {
      if (isPresenceSchemaError(error)) {
        return c.json({ success: true, degraded: true });
      }
      throw error;
    }
  });

  app.post("/api/presence/offline", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      await c.env.fitloot_db
        .prepare(
          `UPDATE user_presence
              SET presence_status = 'offline',
                  last_seen_at = datetime('now'),
                  updated_at = datetime('now')
            WHERE user_id = ?`,
        )
        .bind(user.id)
        .run();
      return c.json({ success: true });
    } catch (error) {
      if (isPresenceSchemaError(error)) {
        return c.json({ success: true, degraded: true });
      }
      throw error;
    }
  });
}

