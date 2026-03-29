import type { MiddlewareHandler } from "hono";

import {
  databaseNotInitializedResponse,
  hasCoreSchema,
} from "./database";
import type {
  AppContext,
  UserAuthRecord,
} from "./types";

type SessionCookieUser = {
  id: string;
  user_id: string;
};

type CreateAuthMiddlewareDeps = {
  catalogCacheTtlMs?: number;
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
      iterations: 60_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toHex(derivedBits);
}

export function createAuthMiddleware({
  catalogCacheTtlMs = 60_000,
  cleanupSettledMissionsWithGuard,
  ensureCaminhadaLeveUserSkill,
  ensureCatalogReady,
  getUserAuthRecordById,
  hasPlanAccess,
  refreshMissionExpiryWithGuard,
  resolvePlanRedirectPath,
  shouldBypassPlanGuard,
  tryUnlockSkillsFromPerformance,
}: CreateAuthMiddlewareDeps): MiddlewareHandler<AppContext> {
  let catalogInitCheckedAt = 0;
  let catalogInitPromise: Promise<void> | null = null;

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

  return async function authMiddleware(c, next) {
    const schemaReady = await hasCoreSchema(c.env.fitloot_db);
    if (!schemaReady) {
      return databaseNotInitializedResponse(c);
    }

    scheduleCatalogInitialization(c.env.fitloot_db, c.executionCtx);

    try {
      const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));
      if (!sessionId) {
        return c.json(
          { error: "Unauthorized", code: "SESSION_COOKIE_MISSING" },
          401,
        );
      }

      const session = await c.env.fitloot_db
        .prepare(
          'SELECT id, user_id FROM sessions WHERE id = ? AND expires_at > datetime("now")',
        )
        .bind(sessionId)
        .first<SessionCookieUser>();

      if (!session) {
        return c.json({ error: "Unauthorized", code: "SESSION_INVALID" }, 401);
      }

      const userRecord = await getUserAuthRecordById(
        c.env.fitloot_db,
        session.user_id,
      );

      if (!userRecord) {
        return c.json(
          { error: "Usuário não encontrado", code: "USER_NOT_FOUND" },
          404,
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
