import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  UpdateMeRequestSchema,
  UserPlanRequestSchema,
} from "../../shared/types";
import { purgeUserAccountData } from "../core/database";
import {
  getErrorMessage,
  internalErrorResponse,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import type {
  AppContext,
  UserAuthRecord,
} from "../core/types";

type AccountRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  generateExpiredSessionCookie: (requestUrl: string) => string;
  getSessionIdFromCookieHeader: (cookieHeader: string | undefined) => string | null;
  getUserAuthRecordById: (
    db: D1Database,
    userId: string,
  ) => Promise<UserAuthRecord | null>;
  logUserEvent: (
    db: D1Database,
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onAppOpen: (
    db: D1Database,
    userId: string,
    timestamp: string,
  ) => Promise<void>;
  onProfileCustomization: (
    db: D1Database,
    userId: string,
    customizations: Record<string, unknown>,
  ) => Promise<void>;
  shouldPurgeUserOnLogout: (user: UserAuthRecord) => boolean;
  unlockAchievementIfNeeded: (
    db: D1Database,
    userId: string,
    achievementName: string,
    progressCurrent: number,
    progressRequired: number,
  ) => Promise<void>;
};

// Route registration for account, session, and user identity endpoints.
export function registerAccountRoutes(
  app: Hono<AppContext>,
  {
    authMiddleware,
    generateExpiredSessionCookie,
    getSessionIdFromCookieHeader,
    getUserAuthRecordById,
    logUserEvent,
    onAppOpen,
    onProfileCustomization,
    shouldPurgeUserOnLogout,
    unlockAchievementIfNeeded,
  }: AccountRouteDeps,
): void {
  app.get("/api/users/me", authMiddleware, async (c) => {
    const user = c.get("user");

    try {
      if (!user?.id) {
        return c.json(
          { error: "Usuário não encontrado", code: "USER_NOT_FOUND" },
          404,
        );
      }

      const userRecord = await getUserAuthRecordById(c.env.fitloot_db, user.id);
      const profileRecord = await c.env.fitloot_db
        .prepare(
          "SELECT showcased_achievements FROM user_profiles WHERE user_id = ?",
        )
        .bind(user.id)
        .first<{ showcased_achievements?: string | null }>();

      if (!userRecord) {
        return c.json(
          { error: "Usuário não encontrado", code: "USER_NOT_FOUND" },
          404,
        );
      }

      return c.json({
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        avatar_url: userRecord.avatar_url ?? undefined,
        showcased_achievements: profileRecord?.showcased_achievements ?? null,
        onboarding_completed: userRecord.onboarding_completed,
        plan_id: userRecord.plan_id,
        plan_status: userRecord.plan_status,
        payment_method: userRecord.payment_method,
      });
    } catch (err) {
      console.error("[/api/users/me] Erro interno:", {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        userId: user?.id,
      });

      if (isMissingSchemaError(err)) {
        return schemaMismatchResponse(c);
      }

      return internalErrorResponse(c);
    }
  });

  app.post("/api/app/open", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const timestamp = new Date().toISOString();
      await onAppOpen(c.env.fitloot_db, user.id, timestamp);
      return c.json({ success: true });
    } catch (error) {
      console.error("[/api/app/open]", {
        message: getErrorMessage(error),
        userId: user.id,
      });

      if (isMissingSchemaError(error)) {
        return c.json({ success: true, degraded: true }, 200);
      }

      return internalErrorResponse(c);
    }
  });

  app.post("/api/events/route-not-found", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      await logUserEvent(c.env.fitloot_db, user.id, "onRouteNotFound", {});
      await unlockAchievementIfNeeded(
        c.env.fitloot_db,
        user.id,
        "404 Not Found",
        1,
        1,
      );
      return c.json({ success: true });
    } catch (error) {
      console.error("[/api/events/route-not-found]", {
        message: getErrorMessage(error),
        userId: user.id,
      });

      if (isMissingSchemaError(error)) {
        return c.json({ success: true, degraded: true }, 200);
      }

      return internalErrorResponse(c);
    }
  });

  app.patch(
    "/api/users/me",
    authMiddleware,
    zValidator("json", UpdateMeRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const data = c.req.valid("json");

      try {
        if (data.name !== undefined) {
          await c.env.fitloot_db
            .prepare("UPDATE users SET name = ? WHERE id = ?")
            .bind(data.name, user.id)
            .run();
        }
        if (data.photo_url !== undefined) {
          await c.env.fitloot_db
            .prepare("UPDATE users SET avatar_url = ? WHERE id = ?")
            .bind(data.photo_url || null, user.id)
            .run();
        }

        // Falhas no hook de telemetria nao devem bloquear a atualizacao basica do perfil.
        try {
          await onProfileCustomization(c.env.fitloot_db, user.id, {
            name_changed: data.name !== undefined,
            photo_changed: data.photo_url !== undefined,
          });
        } catch (error) {
          console.error("[/api/users/me][profile-hook]", {
            message: getErrorMessage(error),
            userId: user.id,
          });
        }

        const updated = await getUserAuthRecordById(c.env.fitloot_db, user.id);
        return c.json(updated ?? c.get("user"));
      } catch (error) {
        console.error("[/api/users/me][patch]", {
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
    "/api/users/plan",
    authMiddleware,
    zValidator("json", UserPlanRequestSchema),
    async (c) => {
      c.req.valid("json");
      return c.json(
        {
          error:
            "Endpoint desativado para evitar atualização manual de plano. Use o fluxo de checkout.",
          code: "PLAN_ENDPOINT_DISABLED",
        },
        410,
      );
    },
  );

  app.get("/api/logout", async (c) => {
    const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));
    let accountReset = false;

    if (sessionId) {
      try {
        const session = await c.env.fitloot_db
          .prepare("SELECT user_id FROM sessions WHERE id = ?")
          .bind(sessionId)
          .first<{ user_id: string }>();

        if (session?.user_id) {
          const userRecord = await getUserAuthRecordById(
            c.env.fitloot_db,
            session.user_id,
          );
          if (userRecord && shouldPurgeUserOnLogout(userRecord)) {
            await purgeUserAccountData(c.env.fitloot_db, session.user_id);
            accountReset = true;
          } else {
            await c.env.fitloot_db
              .prepare("DELETE FROM sessions WHERE id = ?")
              .bind(sessionId)
              .run();
          }
        } else {
          await c.env.fitloot_db
            .prepare("DELETE FROM sessions WHERE id = ?")
            .bind(sessionId)
            .run();
        }
      } catch (error) {
        console.error("[/api/logout][cleanup]", {
          message: getErrorMessage(error),
        });
        return c.json(
          {
            error: "Erro ao encerrar sessão",
            code: "LOGOUT_CLEANUP_FAILED",
          },
          500,
        );
      }
    }

    c.header("Set-Cookie", generateExpiredSessionCookie(c.req.url));

    return c.json({ success: true, account_reset: accountReset });
  });
}
