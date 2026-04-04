import { Hono, type MiddlewareHandler } from "hono";

import {
  getErrorMessage,
  internalErrorResponse,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import type { AppContext } from "../core/types";

type PresenceRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  getSessionIdFromCookieHeader: (cookieHeader: string | undefined) => string | null;
};

function resolveRuntimeFriendCacheDb(
  c: Pick<import("hono").Context<AppContext>, "env">,
): D1Database | null {
  const runtimeDb = c.env.fitloot_runtime_db;
  if (!runtimeDb) return null;
  if (runtimeDb === c.env.fitloot_db) return null;
  return runtimeDb;
}

async function clearRuntimeFriendSnapshots(
  runtimeDb: D1Database,
  userId: string,
): Promise<void> {
  await runtimeDb
    .prepare(
      `DELETE FROM runtime_friend_snapshots
        WHERE user_id = ?
           OR friend_user_id = ?`,
    )
    .bind(userId, userId)
    .run();
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

function isTransientDatabaseError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("query read timeout") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("read etimedout") ||
    message.includes("socket hang up") ||
    message.includes("connection terminated")
  );
}

async function runWithTransientRetry(
  task: () => Promise<void>,
  maxAttempts = 2,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await task();
      return;
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 140 * attempt);
      });
    }
  }
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
      await runWithTransientRetry(async () => {
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
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
            ON CONFLICT(user_id) DO UPDATE SET
              presence_status = 'online',
              visibility = excluded.visibility,
              session_id = excluded.session_id,
              current_activity = excluded.current_activity,
              last_heartbeat_at = CURRENT_TIMESTAMP,
              last_seen_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(user.id, visibility, sessionId, currentActivity)
          .run();
      });

      const runtimeDb = resolveRuntimeFriendCacheDb(c);
      if (runtimeDb) {
        void clearRuntimeFriendSnapshots(runtimeDb, user.id).catch(() => undefined);
      }

      return c.json({ success: true });
    } catch (error) {
      console.error("[/api/presence/heartbeat]", {
        message: getErrorMessage(error),
        userId: user.id,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      if (isTransientDatabaseError(error)) {
        return c.json(
          {
            error:
              "Servico temporariamente indisponivel para atualizar presenca.",
            code: "PRESENCE_TRANSIENT_DB_ERROR",
          },
          503,
        );
      }
      return internalErrorResponse(c);
    }
  });

  app.post("/api/presence/offline", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      await runWithTransientRetry(async () => {
        await c.env.fitloot_db
          .prepare(
            `UPDATE user_presence
                SET presence_status = 'offline',
                    last_seen_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
              WHERE user_id = ?`,
          )
          .bind(user.id)
          .run();
      });

      const runtimeDb = resolveRuntimeFriendCacheDb(c);
      if (runtimeDb) {
        void clearRuntimeFriendSnapshots(runtimeDb, user.id).catch(() => undefined);
      }

      return c.json({ success: true });
    } catch (error) {
      console.error("[/api/presence/offline]", {
        message: getErrorMessage(error),
        userId: user.id,
      });
      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }
      if (isTransientDatabaseError(error)) {
        return c.json(
          {
            error:
              "Servico temporariamente indisponivel para atualizar presenca.",
            code: "PRESENCE_TRANSIENT_DB_ERROR",
          },
          503,
        );
      }
      return internalErrorResponse(c);
    }
  });
}
