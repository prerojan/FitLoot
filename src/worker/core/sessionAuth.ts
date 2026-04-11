import type { MiddlewareHandler } from "hono";

import {
  databaseNotInitializedResponse,
  hasCoreSchema,
} from "./database";
import {
  deleteRuntimeSession,
  readRuntimeSession,
  upsertRuntimeSession,
} from "./runtimeSessionStore";
import {
  deleteRuntimeUserAuth,
  readRuntimeUserAuth,
  upsertRuntimeUserAuth,
} from "./runtimeUserAuthStore";
import { deleteRuntimeHttpCacheBySession } from "./runtimeHttpCacheStore";
import { deleteRuntimeUserProjections } from "./runtimeUserProjectionStore";
import type {
  AppContext,
  AuthUser,
  UserAuthRecord,
} from "./types";
import { sanitizeMissionTimeZone } from "../services/missionCycle";

type SessionCookieUser = {
  id: string;
  user_id: string;
};

type SessionCookieRecord = SessionCookieUser & {
  expires_at?: string | null;
};

type CreateAuthMiddlewareDeps = {
  catalogCacheTtlMs?: number;
  sessionCacheTtlMs?: number;
  userRecordCacheTtlMs?: number;
  onboardingReconcileTtlMs?: number;
  authCacheMaxEntries?: number;
  cleanupSettledMissionsWithGuard: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  ensureCaminhadaLeveUserSkill: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  ensureCatalogReady: (db: D1Database) => Promise<void>;
  getUserAuthRecordById: (
    db: D1Database,
    userId: string,
  ) => Promise<UserAuthRecord | null>;
  hasPlanAccess: (
    planId: UserAuthRecord["plan_id"],
    planStatus: UserAuthRecord["plan_status"],
  ) => boolean;
  refreshMissionExpiryWithGuard: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  repairActivatedProfileState?: (params: {
    db: D1Database;
    env: AppContext["Bindings"];
    user: AuthUser;
  }) => Promise<Record<string, unknown> | null>;
  resolvePlanRedirectPath: (
    onboardingCompleted: number,
    planStatus: UserAuthRecord["plan_status"],
  ) => string;
  shouldBypassPlanGuard: (path: string) => boolean;
  tryUnlockSkillsFromPerformance: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
};

function isTransientAuthDatabaseError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .trim();
  return (
    message.includes("query read timeout") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("connection terminated") ||
    message.includes("connect etimedout") ||
    message.includes("read etimedout") ||
    message.includes("socket hang up")
  );
}

function isSupabaseRuntimeDb(db: D1Database): boolean {
  return (db as D1Database & { __backend?: string }).__backend === "supabase";
}

function resolveRuntimeFallbackDb(
  db: D1Database,
  runtimeDb: D1Database | undefined,
): D1Database | null {
  if (!runtimeDb) return null;
  if (runtimeDb === db) return null;
  return runtimeDb;
}

async function clearRuntimeAuthArtifacts(params: {
  runtimeDb: D1Database | null;
  sessionId?: string | null;
  userId?: string | null;
}): Promise<void> {
  const { runtimeDb, sessionId, userId } = params;
  if (!runtimeDb) return;

  const cleanupTasks: Promise<unknown>[] = [];
  if (typeof sessionId === "string" && sessionId.trim().length > 0) {
    cleanupTasks.push(deleteRuntimeSession(runtimeDb, sessionId));
    cleanupTasks.push(deleteRuntimeHttpCacheBySession(runtimeDb, sessionId));
  }

  if (typeof userId === "string" && userId.trim().length > 0) {
    cleanupTasks.push(deleteRuntimeUserAuth(runtimeDb, userId));
    cleanupTasks.push(deleteRuntimeUserProjections(runtimeDb, userId));
  }

  if (cleanupTasks.length === 0) return;
  await Promise.allSettled(cleanupTasks);
}

export function parseCookieHeader(cookieHeader: string | undefined) {
  if (!cookieHeader) return new Map<string, string>();

  const pairs = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) return null;
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!key) return null;
      return [key, value] as const;
    })
    .filter((pair): pair is readonly [string, string] => pair !== null);

  return new Map<string, string>(pairs);
}

export function getSessionIdFromCookieHeader(
  cookieHeader: string | undefined,
) {
  const sessionCookie = parseCookieHeader(cookieHeader).get("session_id");
  if (!sessionCookie) return null;

  try {
    return decodeURIComponent(sessionCookie);
  } catch {
    return sessionCookie;
  }
}

function shouldUseSecureCookie(requestUrl: string): boolean {
  try {
    return new URL(requestUrl).protocol === "https:";
  } catch {
    return true;
  }
}

function buildSessionCookieAttributes(
  requestUrl: string,
  maxAgeSeconds: number,
): string {
  const secureCookie = shouldUseSecureCookie(requestUrl);
  const attributes = [
    "Path=/",
    "HttpOnly",
    secureCookie ? "SameSite=None" : "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (secureCookie) {
    attributes.push("Secure");
    attributes.push("Partitioned");
  }

  return attributes.join("; ");
}

export function generateCookie(sessionId: string, requestUrl: string) {
  const encodedSessionId = encodeURIComponent(sessionId);
  return `session_id=${encodedSessionId}; ${buildSessionCookieAttributes(requestUrl, 2_592_000)}`;
}

export function generateExpiredSessionCookie(requestUrl: string) {
  return `session_id=; ${buildSessionCookieAttributes(requestUrl, 0)}`;
}

const encoder = new TextEncoder();

async function deriveKeyFromPassword(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPassword(
  password: string,
  salt: string,
): Promise<string> {
  const keyMaterial = await deriveKeyFromPassword(password);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 15_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toHex(derivedBits);
}

export function createAuthMiddleware({
  catalogCacheTtlMs = 60_000,
  sessionCacheTtlMs = 5_000,
  userRecordCacheTtlMs = 10_000,
  onboardingReconcileTtlMs = 120_000,
  authCacheMaxEntries = 5_000,
  cleanupSettledMissionsWithGuard,
  ensureCaminhadaLeveUserSkill,
  ensureCatalogReady,
  getUserAuthRecordById,
  hasPlanAccess,
  refreshMissionExpiryWithGuard,
  repairActivatedProfileState,
  resolvePlanRedirectPath,
  shouldBypassPlanGuard,
  tryUnlockSkillsFromPerformance,
}: CreateAuthMiddlewareDeps): MiddlewareHandler<AppContext> {
  type CacheEntry<T> = {
    value: T;
    expiresAt: number;
    staleUntil: number;
  };

  let catalogInitCheckedAt = 0;
  let catalogInitPromise: Promise<void> | null = null;
  const sessionCache = new Map<string, CacheEntry<SessionCookieUser>>();
  const userRecordCache = new Map<string, CacheEntry<UserAuthRecord>>();
  const inflightSessionLoads = new Map<string, Promise<SessionCookieRecord | null>>();
  const inflightUserLoads = new Map<string, Promise<UserAuthRecord | null>>();
  const onboardingReconcileAttempts = new Map<string, number>();

  function readCache<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    now: number,
  ): T | null {
    const cached = cache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= now) {
      cache.delete(key);
      return null;
    }
    return cached.value;
  }

  function readStaleCache<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    now: number,
  ): T | null {
    const cached = cache.get(key);
    if (!cached) return null;
    if (cached.staleUntil <= now) {
      cache.delete(key);
      return null;
    }
    return cached.value;
  }

  function writeCache<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    value: T,
    ttlMs: number,
    now: number,
  ): void {
    const staleWindowMs = Math.min(180_000, Math.max(15_000, ttlMs * 6));
    cache.set(key, {
      value,
      expiresAt: now + ttlMs,
      staleUntil: now + staleWindowMs,
    });

    if (cache.size <= authCacheMaxEntries) return;

    for (const [entryKey, entryValue] of cache.entries()) {
      if (entryValue.expiresAt <= now) {
        cache.delete(entryKey);
      }
    }

    while (cache.size > authCacheMaxEntries) {
      const oldestKey = cache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      cache.delete(oldestKey);
    }
  }

  async function loadWithDedupe<T>(
    inflightMap: Map<string, Promise<T | null>>,
    key: string,
    loader: () => Promise<T | null>,
  ): Promise<T | null> {
    const inflight = inflightMap.get(key);
    if (inflight) {
      return inflight;
    }

    const pending = (async () => loader())()
      .finally(() => {
        inflightMap.delete(key);
      });
    inflightMap.set(key, pending);
    return pending;
  }

  function shouldRunOnboardingReconcile(userId: string, now: number): boolean {
    const lastAttemptAt = onboardingReconcileAttempts.get(userId);
    if (
      typeof lastAttemptAt === "number" &&
      now - lastAttemptAt < onboardingReconcileTtlMs
    ) {
      return false;
    }

    onboardingReconcileAttempts.set(userId, now);
    if (onboardingReconcileAttempts.size <= authCacheMaxEntries) {
      return true;
    }

    while (onboardingReconcileAttempts.size > authCacheMaxEntries) {
      const oldestKey = onboardingReconcileAttempts.keys().next().value;
      if (typeof oldestKey !== "string") break;
      onboardingReconcileAttempts.delete(oldestKey);
    }

    return true;
  }

  function scheduleCatalogInitialization(
    db: D1Database,
    executionCtx: ExecutionContext,
  ): void {
    const now = Date.now();
    if (now - catalogInitCheckedAt < catalogCacheTtlMs) return;
    if (catalogInitPromise) return;

    const initPromise = ensureCatalogReady(db)
      .then(() => {
        catalogInitCheckedAt = Date.now();
      })
      .finally(() => {
        catalogInitPromise = null;
      });

    catalogInitPromise = initPromise;
    executionCtx.waitUntil(
      initPromise.catch((error) => {
        console.error("[catalog][background-init]", {
          message: error instanceof Error ? error.message : String(error),
        });
      }),
    );
  }

  function shouldRunBackgroundMaintenance(path: string, method: string): boolean {
    // Read-heavy screens fire multiple parallel GETs (skills/titles/progression/etc).
    // Running catalog/mission maintenance on every GET creates avoidable DB pressure.
    // Keep this work for write flows only.
    if (method.toUpperCase() === "GET") return false;
    // Lightweight auth/bootstrap endpoints should not compete with mission/catalog jobs.
    return !shouldBypassPlanGuard(path);
  }

  async function hasPersistedOnboardingState(
    db: D1Database,
    userId: string,
  ): Promise<boolean> {
    const [profile, attributes, progression, trainingPlan] = await Promise.all([
      db
        .prepare("SELECT user_id FROM user_profiles WHERE user_id = ? LIMIT 1")
        .bind(userId)
        .first<{ user_id: string | null }>(),
      db
        .prepare("SELECT user_id FROM user_attributes WHERE user_id = ? LIMIT 1")
        .bind(userId)
        .first<{ user_id: string | null }>(),
      db
        .prepare("SELECT user_id FROM user_progression WHERE user_id = ? LIMIT 1")
        .bind(userId)
        .first<{ user_id: string | null }>(),
      db
        .prepare("SELECT user_id FROM user_training_plans WHERE user_id = ? LIMIT 1")
        .bind(userId)
        .first<{ user_id: string | null }>(),
    ]);

    return Boolean(
      profile?.user_id &&
        attributes?.user_id &&
        progression?.user_id &&
        trainingPlan?.user_id,
    );
  }

  function toAuthUser(userRecord: UserAuthRecord): AuthUser {
    return {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      avatar_url: userRecord.avatar_url ?? undefined,
      onboarding_completed: userRecord.onboarding_completed,
      plan_id: userRecord.plan_id,
      plan_status: userRecord.plan_status,
      payment_method: userRecord.payment_method,
    };
  }

  return async function authMiddleware(c, next) {
    const schemaReady = await hasCoreSchema(c.env.fitloot_db);
    if (!schemaReady) {
      return databaseNotInitializedResponse(c);
    }

    const shouldRunHeavyBackground = shouldRunBackgroundMaintenance(
      c.req.path,
      c.req.method,
    );
    if (shouldRunHeavyBackground && !isSupabaseRuntimeDb(c.env.fitloot_db)) {
      scheduleCatalogInitialization(c.env.fitloot_db, c.executionCtx);
    }

    try {
      const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));
      if (!sessionId) {
        return c.json(
          { error: "Unauthorized", code: "SESSION_COOKIE_MISSING" },
          401,
        );
      }

      const now = Date.now();
      let session = readCache(sessionCache, sessionId, now);
      const staleSession = readStaleCache(sessionCache, sessionId, now);
      const runtimeFallbackDb = resolveRuntimeFallbackDb(
        c.env.fitloot_db,
        c.env.fitloot_runtime_db,
      );
      if (!session) {
        try {
          const sessionRecord = await loadWithDedupe(
            inflightSessionLoads,
            sessionId,
            () =>
              c.env.fitloot_db
                .prepare(
                  "SELECT id, user_id, expires_at FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP",
                )
                .bind(sessionId)
                .first<SessionCookieRecord>(),
          );

          if (sessionRecord) {
            session = {
              id: sessionRecord.id,
              user_id: sessionRecord.user_id,
            };
            if (runtimeFallbackDb && sessionRecord.expires_at) {
              c.executionCtx.waitUntil(
                upsertRuntimeSession(runtimeFallbackDb, {
                  id: sessionRecord.id,
                  user_id: sessionRecord.user_id,
                  expires_at: sessionRecord.expires_at,
                }).catch(() => undefined),
              );
            }
          }
        } catch (sessionError) {
          if (!isTransientAuthDatabaseError(sessionError)) {
            throw sessionError;
          }

          if (runtimeFallbackDb) {
            try {
              session = await readRuntimeSession(runtimeFallbackDb, sessionId);
            } catch {
              // Runtime fallback is best-effort during transient Supabase failures.
            }
          }

          if (!session && staleSession) {
            session = staleSession;
          }

          if (!session) {
            throw sessionError;
          }
        }
      }

      if (!session) {
        sessionCache.delete(sessionId);
        await clearRuntimeAuthArtifacts({
          runtimeDb: runtimeFallbackDb,
          sessionId,
        });
        return c.json({ error: "Unauthorized", code: "SESSION_INVALID" }, 401);
      }
      writeCache(sessionCache, sessionId, session, sessionCacheTtlMs, now);

      let userRecord = readCache(userRecordCache, session.user_id, now);
      const staleUserRecord = readStaleCache(userRecordCache, session.user_id, now);
      let runtimeUserRecord: UserAuthRecord | null = null;
      let shouldSyncRuntimeUserRecord = false;

      if (!userRecord) {
        try {
          userRecord = await loadWithDedupe(
            inflightUserLoads,
            session.user_id,
            () =>
              getUserAuthRecordById(
                c.env.fitloot_db,
                session.user_id,
              ),
          );
          shouldSyncRuntimeUserRecord = Boolean(userRecord);
        } catch (userRecordError) {
          if (!isTransientAuthDatabaseError(userRecordError)) {
            throw userRecordError;
          }

          if (runtimeFallbackDb) {
            try {
              runtimeUserRecord = await readRuntimeUserAuth(
                runtimeFallbackDb,
                session.user_id,
                { maxAgeMs: 180_000 },
              );
            } catch {
              // Runtime fallback is best-effort during transient Supabase failures.
            }
          }

          userRecord = staleUserRecord ?? runtimeUserRecord;
          if (!userRecord) {
            throw userRecordError;
          }
        }
      }

      if (!userRecord) {
        userRecordCache.delete(session.user_id);
        sessionCache.delete(sessionId);
        await clearRuntimeAuthArtifacts({
          runtimeDb: runtimeFallbackDb,
          sessionId,
          userId: session.user_id,
        });
        return c.json(
          { error: "Usuário não encontrado", code: "USER_NOT_FOUND" },
          404,
        );
      }
      writeCache(
        userRecordCache,
        session.user_id,
        userRecord,
        userRecordCacheTtlMs,
        now,
      );

      if (
        Number(userRecord.onboarding_completed) !== 1 &&
        hasPlanAccess(userRecord.plan_id, userRecord.plan_status) &&
        shouldRunOnboardingReconcile(userRecord.id, now)
      ) {
        try {
          let persistedOnboardingState = await hasPersistedOnboardingState(
            c.env.fitloot_db,
            userRecord.id,
          );

          if (
            !persistedOnboardingState &&
            shouldBypassPlanGuard(c.req.path) &&
            repairActivatedProfileState
          ) {
            const recoveredProfile = await repairActivatedProfileState({
              db: c.env.fitloot_db,
              env: c.env,
              user: toAuthUser(userRecord),
            });

            if (recoveredProfile) {
              persistedOnboardingState = await hasPersistedOnboardingState(
                c.env.fitloot_db,
                userRecord.id,
              );
            }
          }

          if (persistedOnboardingState) {
            await c.env.fitloot_db
              .prepare("UPDATE users SET onboarding_completed = 1 WHERE id = ?")
              .bind(userRecord.id)
              .run();

            userRecord = {
              ...userRecord,
              onboarding_completed: 1,
            };
            shouldSyncRuntimeUserRecord = true;
            onboardingReconcileAttempts.delete(userRecord.id);

            writeCache(
              userRecordCache,
              session.user_id,
              userRecord,
              userRecordCacheTtlMs,
              now,
            );
          }
        } catch (reconcileError) {
          console.warn("[authMiddleware][onboarding-reconcile]", {
            userId: userRecord.id,
            message:
              reconcileError instanceof Error
                ? reconcileError.message
                : String(reconcileError),
          });
        }
      }

      if (runtimeFallbackDb && shouldSyncRuntimeUserRecord) {
        c.executionCtx.waitUntil(
          upsertRuntimeUserAuth(runtimeFallbackDb, userRecord).catch(
            () => undefined,
          ),
        );
      }

      const hasUnlockedAccess =
        Number(userRecord.onboarding_completed) === 1 &&
        hasPlanAccess(userRecord.plan_id, userRecord.plan_status);

      if (!shouldBypassPlanGuard(c.req.path) && !hasUnlockedAccess) {
        const isPending = userRecord.plan_status === "pending";
        return c.json(
          {
            error: isPending
              ? "Pagamento em processamento. Aguarde a confirmação para liberar o acesso."
              : "Pagamento não aprovado. Atualize seu plano para liberar o acesso.",
            code: "PLAN_ACCESS_REQUIRED",
            plan_id: userRecord.plan_id,
            plan_status: userRecord.plan_status,
            payment_method: userRecord.payment_method,
            redirect_to: resolvePlanRedirectPath(
              userRecord.onboarding_completed,
              userRecord.plan_status,
            ),
          },
          402,
        );
      }

      c.set("user", {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        avatar_url: userRecord.avatar_url ?? undefined,
        onboarding_completed: userRecord.onboarding_completed,
        plan_id: userRecord.plan_id,
        plan_status: userRecord.plan_status,
        payment_method: userRecord.payment_method,
      });

      const requestTimeZone = sanitizeMissionTimeZone(
        c.req.header("X-FitLoot-Timezone"),
      );
      if (requestTimeZone) {
        c.executionCtx.waitUntil(
          c.env.fitloot_db
            .prepare(
              `UPDATE user_profiles
                  SET timezone = ?,
                      updated_at = datetime('now')
                WHERE user_id = ?
                  AND COALESCE(timezone, '') <> ?`,
            )
            .bind(requestTimeZone, userRecord.id, requestTimeZone)
            .run()
            .catch((error) => {
              console.warn("[authMiddleware][timezone-sync]", {
                userId: userRecord.id,
                message: error instanceof Error ? error.message : String(error),
              });
            }),
        );
      }

      if (shouldRunHeavyBackground) {
        c.executionCtx.waitUntil(
          (async () => {
            try {
              await cleanupSettledMissionsWithGuard(
                c.env.fitloot_db,
                userRecord.id,
              );
            } catch (cleanupError) {
              console.error("[authMiddleware][cleanupSettledMissions]", {
                message:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : String(cleanupError),
                userId: userRecord.id,
              });
            }

            try {
              await refreshMissionExpiryWithGuard(
                c.env.fitloot_db,
                userRecord.id,
              );
            } catch (streakError) {
              console.error("[authMiddleware][refreshMissionExpiryWithGuard]", {
                message:
                  streakError instanceof Error
                    ? streakError.message
                    : String(streakError),
                userId: userRecord.id,
              });
            }
          })(),
        );

        c.executionCtx.waitUntil(
          (async () => {
            try {
              await ensureCaminhadaLeveUserSkill(c.env.fitloot_db, userRecord.id);
              await tryUnlockSkillsFromPerformance(
                c.env.fitloot_db,
                userRecord.id,
              );
            } catch (error) {
              console.error("[authMiddleware][skillConsistency]", {
                userId: userRecord.id,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })(),
        );
      }

      await next();
    } catch (error) {
      console.error("[authMiddleware]", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
    }
  };
}

