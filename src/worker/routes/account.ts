import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  UpdateMeRequestSchema,
  UpdateUserAvatarRequestSchema,
  UserPlanRequestSchema,
} from "../../shared/types";
import {
  isTransientDatabaseError,
  purgeUserAccountData,
  runWithTransientDatabaseRetry,
} from "../core/database";
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
  upsertRuntimeDashboardProjection,
  upsertRuntimeProfileProjection,
  readRuntimeBootstrapProjection,
  upsertRuntimeBootstrapProjection,
} from "../core/runtimeUserProjectionStore";
import {
  extractManagedAvatarPathFromUrl,
  isSupabaseAvatarStorageConfigured,
  removeStoredAvatar,
  storeUserAvatar,
} from "../services/userAvatar";
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
  invalidateRankingCache: () => void;
  syncTrainingRankState: (
    db: D1Database,
    userId: string,
  ) => Promise<unknown>;
  shouldPurgeUserOnLogout: (user: UserAuthRecord) => boolean;
  unlockAchievementIfNeeded: (
    db: D1Database,
    userId: string,
    achievementName: string,
    progressCurrent: number,
    progressRequired: number,
  ) => Promise<void>;
};

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
  profile: Record<string, unknown> | null;
  progression: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
};

async function readStoredAvatarUrl(
  db: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT avatar_url FROM users WHERE id = ?")
    .bind(userId)
    .first<{ avatar_url: string | null }>();
  return typeof row?.avatar_url === "string" ? row.avatar_url : null;
}

function scheduleAvatarDeletion(
  c: import("hono").Context<AppContext>,
  storagePath: string | null,
  logContext: string,
): void {
  if (!storagePath || !isSupabaseAvatarStorageConfigured(c.env)) return;
  c.executionCtx.waitUntil(
    removeStoredAvatar(c.env, storagePath).catch((error) => {
      console.warn(`[${logContext}][avatar-delete]`, {
        storagePath,
        message: getErrorMessage(error),
      });
    }),
  );
}

function scheduleUpdatedUserRuntimeSync(
  c: import("hono").Context<AppContext>,
  userId: string,
  updatedUser: UserAuthRecord | null,
  logContext: string,
  options: {
    clearRuntimeUserProjections?: boolean;
  } = {},
): void {
  const runtimeCacheDb = resolveRuntimeCacheDb(c);
  if (!runtimeCacheDb) return;

  c.executionCtx.waitUntil(
    Promise.allSettled([
      updatedUser
        ? upsertRuntimeUserAuth(runtimeCacheDb, updatedUser)
        : Promise.resolve(),
      options.clearRuntimeUserProjections
        ? deleteRuntimeUserProjections(runtimeCacheDb, userId)
        : Promise.resolve(),
    ]).catch((runtimeError) => {
      console.warn(`[${logContext}][runtime-sync]`, {
        message: getErrorMessage(runtimeError),
        userId,
      });
    }),
  );
}

function buildProfileThemeProjection(
  profile: Record<string, unknown> | null | undefined,
): {
  custom_primary_color: unknown;
  custom_secondary_color: unknown;
  custom_background_type: unknown;
  custom_background_value: unknown;
  custom_font: unknown;
} | null {
  if (!profile) {
    return null;
  }

  return {
    custom_primary_color: profile.custom_primary_color ?? null,
    custom_secondary_color: profile.custom_secondary_color ?? null,
    custom_background_type: profile.custom_background_type ?? null,
    custom_background_value: profile.custom_background_value ?? null,
    custom_font: profile.custom_font ?? null,
  };
}

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
    invalidateRankingCache,
    syncTrainingRankState,
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
            const profileTheme = buildProfileThemeProjection(cachedProjection.profile);
            return c.json({
              user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar_url: user.avatar_url ?? undefined,
                showcased_achievements:
                  cachedProjection.profile?.showcased_achievements ?? null,
                onboarding_completed: user.onboarding_completed,
                plan_id: user.plan_id,
                plan_status: user.plan_status,
                payment_method: user.payment_method,
              },
              profile: cachedProjection.profile ?? null,
              profile_theme: profileTheme,
              progression: cachedProjection.progression ?? null,
              attributes: cachedProjection.attributes ?? null,
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
      let attributes: Record<string, unknown> | null = null;
      let bootstrapDegraded = false;

      try {
        profile = await runWithTransientDatabaseRetry(() =>
          c.env.fitloot_db
            .prepare(
              `SELECT
                up.*,
                u.avatar_url
              FROM user_profiles up
              INNER JOIN users u
                ON u.id = up.user_id
              WHERE up.user_id = ?`,
            )
            .bind(user.id)
            .first<Record<string, unknown>>(),
        );
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
        progression = await runWithTransientDatabaseRetry(() =>
          c.env.fitloot_db
            .prepare(
              `SELECT *
              FROM user_progression
              WHERE user_id = ?`,
            )
            .bind(user.id)
            .first<Record<string, unknown>>(),
        );
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

      const hasPersistedTrainingRankState =
        progression &&
        progression.training_rank != null &&
        progression.training_rank_score != null &&
        progression.training_rank_snapshot != null;
      if (progression && !hasPersistedTrainingRankState) {
        await syncTrainingRankState(c.env.fitloot_db, user.id);
        progression = await c.env.fitloot_db
          .prepare(
            `SELECT *
              FROM user_progression
              WHERE user_id = ?`,
          )
          .bind(user.id)
          .first<Record<string, unknown>>();
        invalidateRankingCache();
      }

      try {
        attributes = await runWithTransientDatabaseRetry(() =>
          c.env.fitloot_db
            .prepare(
              `SELECT *
              FROM user_attributes
              WHERE user_id = ?`,
            )
            .bind(user.id)
            .first<Record<string, unknown>>(),
        );
      } catch (attributesError) {
        if (!isTransientDatabaseError(attributesError)) {
          throw attributesError;
        }
        bootstrapDegraded = true;
        console.warn("[/api/app/bootstrap][attributes]", {
          message: getErrorMessage(attributesError),
          userId: user.id,
        });
      }

      const profileTheme = buildProfileThemeProjection(profile);

      if (runtimeCacheDb) {
        c.executionCtx.waitUntil(
          Promise.allSettled([
            upsertRuntimeBootstrapProjection(runtimeCacheDb, user.id, {
              profile: profile ?? null,
              progression: progression ?? null,
              attributes: attributes ?? null,
            }),
            profile
              ? upsertRuntimeProfileProjection(runtimeCacheDb, user.id, profile)
              : Promise.resolve(),
            progression
              ? upsertRuntimeDashboardProjection(
                  runtimeCacheDb,
                  user.id,
                  "progression",
                  progression,
                )
              : Promise.resolve(),
            attributes
              ? upsertRuntimeDashboardProjection(
                  runtimeCacheDb,
                  user.id,
                  "attributes",
                  attributes,
                )
              : Promise.resolve(),
          ]).catch((runtimeProjectionError) => {
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
        profile: profile ?? null,
        profile_theme: profileTheme,
        progression: progression ?? null,
        attributes: attributes ?? null,
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
      runWithTransientDatabaseRetry(
        () => onAppOpen(c.env.fitloot_db, user.id, timestamp),
        { maxAttempts: 2, baseDelayMs: 150 },
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
        const previousAvatarUrl =
          data.photo_url !== undefined
            ? await readStoredAvatarUrl(c.env.fitloot_db, user.id)
            : null;
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
        scheduleUpdatedUserRuntimeSync(c, user.id, updated, "/api/users/me", {
          clearRuntimeUserProjections: data.photo_url !== undefined,
        });

        if (data.photo_url !== undefined) {
          invalidateRankingCache();
          const previousAvatarPath = extractManagedAvatarPathFromUrl(
            previousAvatarUrl,
            c.env.SUPABASE_URL,
          );
          const nextAvatarPath = extractManagedAvatarPathFromUrl(
            data.photo_url,
            c.env.SUPABASE_URL,
          );
          if (previousAvatarPath && previousAvatarPath !== nextAvatarPath) {
            scheduleAvatarDeletion(c, previousAvatarPath, "/api/users/me");
          }
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
    "/api/users/me/avatar",
    authMiddleware,
    zValidator("json", UpdateUserAvatarRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      if (!isSupabaseAvatarStorageConfigured(c.env)) {
        return c.json(
          {
            error: "Armazenamento de avatar do Supabase nao configurado.",
            code: "AVATAR_STORAGE_NOT_CONFIGURED",
          },
          503,
        );
      }

      const data = c.req.valid("json");
      const previousAvatarUrl = await readStoredAvatarUrl(c.env.fitloot_db, user.id);

      try {
        const storedAvatar = await storeUserAvatar({
          env: c.env,
          imageBase64: data.image_base64,
          imageMimeType: data.image_mime_type,
          userId: user.id,
        });

        try {
          await c.env.fitloot_db
            .prepare("UPDATE users SET avatar_url = ? WHERE id = ?")
            .bind(storedAvatar.publicUrl, user.id)
            .run();
        } catch (error) {
          await removeStoredAvatar(c.env, storedAvatar.path).catch(() => undefined);
          throw error;
        }

        try {
          await onProfileCustomization(c.env.fitloot_db, user.id, {
            photo_changed: true,
            avatar_storage: "supabase",
          });
        } catch (error) {
          console.error("[/api/users/me/avatar][profile-hook]", {
            message: getErrorMessage(error),
            userId: user.id,
          });
        }

        const updated = await getUserAuthRecordById(c.env.fitloot_db, user.id);
        scheduleUpdatedUserRuntimeSync(
          c,
          user.id,
          updated,
          "/api/users/me/avatar",
          { clearRuntimeUserProjections: true },
        );
        invalidateRankingCache();

        const previousAvatarPath = extractManagedAvatarPathFromUrl(
          previousAvatarUrl,
          c.env.SUPABASE_URL,
        );
        if (previousAvatarPath && previousAvatarPath !== storedAvatar.path) {
          scheduleAvatarDeletion(c, previousAvatarPath, "/api/users/me/avatar");
        }

        return c.json(updated ?? { ...user, avatar_url: storedAvatar.publicUrl });
      } catch (error) {
        console.error("[/api/users/me/avatar][post]", {
          message: getErrorMessage(error),
          userId: user.id,
        });

        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }

        const lowerMessage = getErrorMessage(error).toLowerCase();
        if (
          lowerMessage.includes("nao suportado") ||
          lowerMessage.includes("limite") ||
          lowerMessage.includes("2 mb") ||
          lowerMessage.includes("decodificar") ||
          lowerMessage.includes("vazia")
        ) {
          return c.json({ error: getErrorMessage(error) }, 400);
        }

        return internalErrorResponse(c);
      }
    },
  );

  app.delete("/api/users/me/avatar", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const previousAvatarUrl = await readStoredAvatarUrl(c.env.fitloot_db, user.id);

      await c.env.fitloot_db
        .prepare("UPDATE users SET avatar_url = NULL WHERE id = ?")
        .bind(user.id)
        .run();

      try {
        await onProfileCustomization(c.env.fitloot_db, user.id, {
          photo_changed: true,
          avatar_removed: true,
        });
      } catch (error) {
        console.error("[/api/users/me/avatar][remove-hook]", {
          message: getErrorMessage(error),
          userId: user.id,
        });
      }

      const updated = await getUserAuthRecordById(c.env.fitloot_db, user.id);
      scheduleUpdatedUserRuntimeSync(
        c,
        user.id,
        updated,
        "/api/users/me/avatar",
        { clearRuntimeUserProjections: true },
      );
      invalidateRankingCache();

      const previousAvatarPath = extractManagedAvatarPathFromUrl(
        previousAvatarUrl,
        c.env.SUPABASE_URL,
      );
      if (previousAvatarPath) {
        scheduleAvatarDeletion(c, previousAvatarPath, "/api/users/me/avatar");
      }

      return c.json(updated ?? { ...user, avatar_url: undefined });
    } catch (error) {
      console.error("[/api/users/me/avatar][delete]", {
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
