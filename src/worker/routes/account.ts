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
import { deleteRuntimeSession } from "../core/runtimeSessionStore";
import {
  deleteRuntimeUserAuth,
  upsertRuntimeUserAuth,
} from "../core/runtimeUserAuthStore";
import {
  deleteRuntimeUserProjections,
  readRuntimeBootstrapProjection,
  upsertRuntimeBootstrapProjection,
} from "../core/runtimeUserProjectionStore";
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
        setTimeout(resolve, 150 * attempt);
      });
    }
  }
}

function resolveRuntimeCacheDb(
  c: import("hono").Context<AppContext>,
): D1Database | null {
  const runtimeDb = c.env.fitloot_runtime_db;
  if (!runtimeDb) return null;
  if (runtimeDb === c.env.fitloot_db) return null;
  return runtimeDb;
}

const RUNTIME_BOOTSTRAP_PROJECTION_TTL_MS = 30_000;

type BootstrapRuntimeProjection = {
  showcased_achievements: unknown;
  profile_theme: {
    custom_primary_color: unknown;
    custom_secondary_color: unknown;
    custom_background_type: unknown;
    custom_background_value: unknown;
    custom_font: unknown;
  } | null;
  progression: Record<string, unknown> | null;
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
        return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
      }

      let showcasedAchievements: string | null = null;
      try {
        const profileRecord = await c.env.fitloot_db
          .prepare(
            "SELECT showcased_achievements FROM user_profiles WHERE user_id = ?",
          )
          .bind(user.id)
          .first<{ showcased_achievements?: string | null }>();
        showcasedAchievements = profileRecord?.showcased_achievements ?? null;
      } catch (profileError) {
        // Session bootstrap should stay responsive even when optional profile decoration fails.
        console.error("[/api/users/me][profile-read]", {
          message: getErrorMessage(profileError),
          userId: user.id,
        });
      }

      return c.json({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url ?? undefined,
        showcased_achievements: showcasedAchievements,
        onboarding_completed: user.onboarding_completed,
        plan_id: user.plan_id,
        plan_status: user.plan_status,
        payment_method: user.payment_method,
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

  app.get("/api/app/bootstrap", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    }

    try {
      const runtimeCacheDb = resolveRuntimeCacheDb(c);
      if (runtimeCacheDb) {
        try {
          const cachedProjection = await readRuntimeBootstrapProjection<BootstrapRuntimeProjection>(
            runtimeCacheDb,
            user.id,
            RUNTIME_BOOTSTRAP_PROJECTION_TTL_MS,
          );
          if (cachedProjection) {
            return c.json({
              user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar_url: user.avatar_url ?? undefined,
                showcased_achievements:
                  cachedProjection.showcased_achievements ?? null,
                onboarding_completed: user.onboarding_completed,
                plan_id: user.plan_id,
                plan_status: user.plan_status,
                payment_method: user.payment_method,
              },
              profile_theme: cachedProjection.profile_theme ?? null,
              progression: cachedProjection.progression ?? null,
              app_open_degraded: false,
            });
          }
        } catch (runtimeProjectionError) {
          console.warn("[/api/app/bootstrap][runtime-read]", {
            message: getErrorMessage(runtimeProjectionError),
            userId: user.id,
          });
        }
      }

      let profile: Record<string, unknown> | null = null;
      let progression: Record<string, unknown> | null = null;
      let bootstrapDegraded = false;

      try {
        profile = await c.env.fitloot_db
          .prepare(
            `SELECT
              custom_primary_color,
              custom_secondary_color,
              custom_background_type,
              custom_background_value,
              custom_font,
              showcased_achievements
            FROM user_profiles
            WHERE user_id = ?`,
          )
          .bind(user.id)
          .first<Record<string, unknown>>();
      } catch (profileError) {
        if (!isTransientDatabaseError(profileError)) {
          throw profileError;
        }
        bootstrapDegraded = true;
        console.warn("[/api/app/bootstrap][profile]", {
          message: getErrorMessage(profileError),
          userId: user.id,
        });
      }

      try {
        progression = await c.env.fitloot_db
          .prepare(
            `SELECT
              level,
              xp,
              CASE
                WHEN COALESCE(level, 1) * 100 > 100 THEN COALESCE(level, 1) * 100
                ELSE 100
              END AS next_level_xp,
              current_streak,
              best_streak,
              last_activity_date
            FROM user_progression
            WHERE user_id = ?`,
          )
          .bind(user.id)
          .first<Record<string, unknown>>();
      } catch (progressionError) {
        if (!isTransientDatabaseError(progressionError)) {
          throw progressionError;
        }
        bootstrapDegraded = true;
        console.warn("[/api/app/bootstrap][progression]", {
          message: getErrorMessage(progressionError),
          userId: user.id,
        });
      }

      const profileTheme = profile
        ? {
            custom_primary_color: profile.custom_primary_color ?? null,
            custom_secondary_color: profile.custom_secondary_color ?? null,
            custom_background_type: profile.custom_background_type ?? null,
            custom_background_value: profile.custom_background_value ?? null,
            custom_font: profile.custom_font ?? null,
          }
        : null;

      if (runtimeCacheDb) {
        c.executionCtx.waitUntil(
          upsertRuntimeBootstrapProjection(runtimeCacheDb, user.id, {
            showcased_achievements: profile?.showcased_achievements ?? null,
            profile_theme: profileTheme,
            progression: progression ?? null,
          }).catch((runtimeProjectionError) => {
            console.warn("[/api/app/bootstrap][runtime-write]", {
              message: getErrorMessage(runtimeProjectionError),
              userId: user.id,
            });
          }),
        );
      }

      return c.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar_url: user.avatar_url ?? undefined,
          showcased_achievements: profile?.showcased_achievements ?? null,
          onboarding_completed: user.onboarding_completed,
          plan_id: user.plan_id,
          plan_status: user.plan_status,
          payment_method: user.payment_method,
        },
        profile_theme: profileTheme,
        progression: progression ?? null,
        app_open_degraded: bootstrapDegraded,
      });
    } catch (error) {
      console.error("[/api/app/bootstrap]", {
        message: getErrorMessage(error),
        userId: user.id,
      });

      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      return internalErrorResponse(c);
    }
  });

  app.post("/api/app/open", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const timestamp = new Date().toISOString();
    c.executionCtx.waitUntil(
      runWithTransientRetry(
        () => onAppOpen(c.env.fitloot_db, user.id, timestamp),
        2,
      ).catch((error) => {
        console.error("[/api/app/open]", {
          message: getErrorMessage(error),
          userId: user.id,
        });
      }),
    );

    return c.json({ success: true });
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
        return schemaMismatchResponse(c);
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
        const runtimeCacheDb = resolveRuntimeCacheDb(c);
        if (updated && runtimeCacheDb) {
          c.executionCtx.waitUntil(
            upsertRuntimeUserAuth(runtimeCacheDb, updated).catch((runtimeError) => {
              console.warn("[/api/users/me][runtime-sync]", {
                message: getErrorMessage(runtimeError),
                userId: user.id,
              });
            }),
          );
        }
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
            "Endpoint desativado para evitar atualizacao manual de plano. Use o fluxo de checkout.",
          code: "PLAN_ENDPOINT_DISABLED",
        },
        410,
      );
    },
  );

  app.get("/api/logout", async (c) => {
    const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));
    let accountReset = false;
    let cleanupDegraded = false;
    const runtimeSessionDb = resolveRuntimeCacheDb(c);

    if (sessionId) {
      try {
        const deleteSessionInAllStores = async () => {
          await c.env.fitloot_db
            .prepare("DELETE FROM sessions WHERE id = ?")
            .bind(sessionId)
            .run();

          if (runtimeSessionDb) {
            try {
              await deleteRuntimeSession(runtimeSessionDb, sessionId);
            } catch (runtimeCleanupError) {
              console.warn("[/api/logout][runtime-session-sync]", {
                message: getErrorMessage(runtimeCleanupError),
              });
            }
          }
        };

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
            await deleteSessionInAllStores();
            if (runtimeSessionDb) {
              try {
                await deleteRuntimeUserAuth(runtimeSessionDb, session.user_id);
              } catch (runtimeCleanupError) {
                console.warn("[/api/logout][runtime-user-sync]", {
                  message: getErrorMessage(runtimeCleanupError),
                });
              }
            }
            accountReset = true;
          } else {
            await deleteSessionInAllStores();
          }

          if (runtimeSessionDb) {
            try {
              await deleteRuntimeUserProjections(runtimeSessionDb, session.user_id);
            } catch (runtimeCleanupError) {
              console.warn("[/api/logout][runtime-projection-sync]", {
                message: getErrorMessage(runtimeCleanupError),
              });
            }
          }
        } else {
          await deleteSessionInAllStores();
        }
      } catch (error) {
        console.error("[/api/logout][cleanup]", {
          message: getErrorMessage(error),
        });
        cleanupDegraded = true;
      }
    }

    c.header("Set-Cookie", generateExpiredSessionCookie(c.req.url));

    return c.json({
      success: true,
      account_reset: accountReset,
      cleanup_degraded: cleanupDegraded,
    });
  });
}
