import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  AuthRegisterRequestSchema,
  LoginRequestSchema,
} from "../../shared/types";
import {
  databaseNotInitializedResponse,
  hasCoreSchema,
  hasTableColumn,
  purgeUserAccountData,
  runWithTransientDatabaseRetry,
} from "../core/database";
import { upsertRuntimeSession } from "../core/runtimeSessionStore";
import {
  deleteRuntimeUserAuth,
  readRuntimeUserAuth,
  readRuntimeUserAuthAvailability,
  type RuntimeUserAvailabilityMatch,
  upsertRuntimeUserAuth,
} from "../core/runtimeUserAuthStore";
import type { AppContext } from "../core/types";
import {
  getUserAuthRecordById,
  isReusableIncompleteAccount,
} from "../services/userPlanAccess";

type AuthRouteDeps = {
  generateCookie: (sessionId: string, requestUrl: string) => string;
  hashPassword: (password: string, salt: string) => Promise<string>;
};

type AvailabilityLookupRow = {
  email_user_id: string | null;
  username_user_id: string | null;
};

function resolveRuntimeSessionDb(c: import("hono").Context<AppContext>): D1Database | null {
  const runtimeDb = c.env.fitloot_runtime_db;
  if (!runtimeDb) return null;
  if (runtimeDb === c.env.fitloot_db) return null;
  return runtimeDb;
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .trim();
  return (
    message.includes("unique constraint") ||
    message.includes("duplicate key value") ||
    message.includes("violates unique")
  );
}

function isConnectionTimeoutLike(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .trim();
  return (
    message.includes("query read timeout") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("connect etimedout") ||
    message.includes("read etimedout") ||
    message.includes("socket hang up") ||
    message.includes("connection terminated")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRuntimeAvailability(
  queryValue: string,
  match: RuntimeUserAvailabilityMatch | null,
): boolean | null {
  if (!queryValue) {
    return null;
  }

  if (!match) {
    return null;
  }

  return isReusableIncompleteAccount(match);
}

async function readAvailabilityLookup(
  db: D1Database,
  emailLower: string,
  usernameLower: string,
): Promise<AvailabilityLookupRow | null> {
  if (!emailLower && !usernameLower) {
    return null;
  }

  return db
    .prepare(
      `SELECT
        (SELECT id FROM users WHERE lower(email) = ? LIMIT 1) AS email_user_id,
        (SELECT user_id FROM user_profiles WHERE lower(username) = ? LIMIT 1) AS username_user_id`,
    )
    .bind(emailLower || null, usernameLower || null)
    .first<AvailabilityLookupRow>();
}

async function syncRuntimeAvailabilityUser(
  runtimeDb: D1Database,
  primaryDb: D1Database,
  userId: string,
): Promise<void> {
  const authRecord = await getUserAuthRecordById(primaryDb, userId);
  if (!authRecord) {
    return;
  }

  const profileRow = await primaryDb
    .prepare("SELECT username FROM user_profiles WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ username: string | null }>()
    .catch(() => null);

  await upsertRuntimeUserAuth(runtimeDb, authRecord, {
    username: profileRow?.username ?? null,
  });
}

// Registers the authentication surface responsible for account creation and session login.
export function registerAuthRoutes(
  app: Hono<AppContext>,
  { generateCookie, hashPassword }: AuthRouteDeps,
): void {
  // Creates a new account, initializes plan defaults, and persists the password hash.
  app.post(
    "/api/auth/register",
    zValidator("json", AuthRegisterRequestSchema),
    async (c) => {
      const schemaReady = await hasCoreSchema(c.env.fitloot_db);
      if (!schemaReady) return databaseNotInitializedResponse(c);

      try {
        const data = c.req.valid("json");
        const normalizedEmail = data.email.trim().toLowerCase();

        const insertUser = async (userId: string) => {
          await c.env.fitloot_db
            .prepare(
              "INSERT INTO users (id, email, name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(userId, normalizedEmail, data.name ?? "", passwordHash, salt)
            .run();
        };

        const salt = crypto.randomUUID();
        const passwordHash = await hashPassword(data.password, salt);
        let userId = crypto.randomUUID();
        let userInserted = false;

        for (let attempt = 1; attempt <= 2 && !userInserted; attempt += 1) {
          try {
            await insertUser(userId);
            userInserted = true;
            break;
          } catch (insertError) {
            if (isUniqueConstraintError(insertError)) {
              const existing = await c.env.fitloot_db
                .prepare("SELECT id FROM users WHERE lower(email) = ?")
                .bind(normalizedEmail)
                .first<{ id: string }>();

              if (!existing?.id) {
                throw insertError;
              }

              const existingUser = await getUserAuthRecordById(c.env.fitloot_db, existing.id);
              if (!isReusableIncompleteAccount(existingUser)) {
                return c.json({ error: "E-mail ja cadastrado" }, 409);
              }

              await purgeUserAccountData(c.env.fitloot_db, existing.id);
              const runtimeSessionDb = resolveRuntimeSessionDb(c);
              if (runtimeSessionDb) {
                await deleteRuntimeUserAuth(runtimeSessionDb, existing.id).catch(() => undefined);
              }
              userId = crypto.randomUUID();
              await insertUser(userId);
              userInserted = true;
              break;
            }

            if (!isConnectionTimeoutLike(insertError)) {
              throw insertError;
            }

            const existingAfterTimeout = await c.env.fitloot_db
              .prepare("SELECT id FROM users WHERE lower(email) = ?")
              .bind(normalizedEmail)
              .first<{ id: string }>()
              .catch(() => null);

            if (existingAfterTimeout?.id) {
              const existingUser = await getUserAuthRecordById(
                c.env.fitloot_db,
                existingAfterTimeout.id,
              ).catch(() => null);

              if (existingUser && !isReusableIncompleteAccount(existingUser)) {
                return c.json({ error: "E-mail ja cadastrado" }, 409);
              }

              userId = existingAfterTimeout.id;
              await c.env.fitloot_db
                .prepare(
                  "UPDATE users SET name = ?, password_hash = ?, password_salt = ? WHERE id = ?",
                )
                .bind(data.name ?? "", passwordHash, salt, userId)
                .run()
                .catch(() => undefined);
              userInserted = true;
              break;
            }

            if (attempt >= 2) {
              throw insertError;
            }

            await sleep(140 * attempt);
          }
        }

        if (!userInserted) {
          throw new Error("REGISTER_USER_INSERT_FAILED");
        }

        const isSupabaseDb =
          (c.env.fitloot_db as D1Database & { __backend?: string }).__backend ===
          "supabase";

        if (isSupabaseDb) {
          await c.env.fitloot_db
            .prepare(
              "UPDATE users SET plan_id = 'basic', plan_status = 'failed', payment_method = 'none', onboarding_completed = 0 WHERE id = ?",
            )
            .bind(userId)
            .run();
        } else {
          const [
            planIdColumnExists,
            planStatusColumnExists,
            paymentMethodColumnExists,
            onboardingColumnExists,
          ] = await Promise.all([
            hasTableColumn(c.env.fitloot_db, "users", "plan_id"),
            hasTableColumn(c.env.fitloot_db, "users", "plan_status"),
            hasTableColumn(c.env.fitloot_db, "users", "payment_method"),
            hasTableColumn(c.env.fitloot_db, "users", "onboarding_completed"),
          ]);

          if (planIdColumnExists && planStatusColumnExists) {
            const assignments = ["plan_id = 'basic'", "plan_status = 'failed'"];
            if (paymentMethodColumnExists) {
              assignments.push("payment_method = 'none'");
            }
            if (onboardingColumnExists) {
              assignments.push("onboarding_completed = 0");
            }

            await c.env.fitloot_db
              .prepare(
                `UPDATE users SET ${assignments.join(", ")} WHERE id = ?`,
              )
              .bind(userId)
              .run();
          }
        }

        let sessionEstablished = false;
        try {
          const sessionId = crypto.randomUUID();
          const expiresAt = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString();

          await c.env.fitloot_db
            .prepare(
              "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
            )
            .bind(sessionId, userId, expiresAt)
            .run();

          const runtimeSessionDb = resolveRuntimeSessionDb(c);
          if (runtimeSessionDb) {
            try {
              await Promise.all([
                upsertRuntimeSession(runtimeSessionDb, {
                  id: sessionId,
                  user_id: userId,
                  expires_at: expiresAt,
                }),
                upsertRuntimeUserAuth(runtimeSessionDb, {
                  id: userId,
                  email: normalizedEmail,
                  name: data.name ?? "",
                  avatar_url: null,
                  onboarding_completed: 0,
                  plan_id: "basic",
                  plan_status: "failed",
                  payment_method: "none",
                }),
              ]);
            } catch (runtimeSyncError) {
              console.warn("[register][runtime-session-sync]", {
                message:
                  runtimeSyncError instanceof Error
                    ? runtimeSyncError.message
                    : String(runtimeSyncError),
              });
            }
          }

          c.header("Set-Cookie", generateCookie(sessionId, c.req.url));
          sessionEstablished = true;
        } catch (sessionError) {
          console.error("[register][session-bootstrap]", sessionError);
        }

        return c.json({ success: true, session_established: sessionEstablished }, 201);
      } catch (error) {
        console.error("[register]", error);
        return c.json(
          {
            error: "Erro interno ao criar usuario",
            code: "INTERNAL_ERROR",
          },
          500,
        );
      }
    },
  );

  // Checks whether email and username values are already reserved before onboarding completes.
  app.get("/api/auth/check-availability", async (c) => {
    const emailQuery = (c.req.query("email") || "").trim().toLowerCase();
    const usernameQuery = (c.req.query("username") || "").trim();
    const normalizedUsernameQuery = usernameQuery.toLowerCase();

    if (!emailQuery && !usernameQuery) {
      return c.json(
        {
          emailAvailable: null,
          usernameAvailable: null,
          message: "Informe email e/ou username para validacao.",
        },
        400,
      );
    }

    try {
      const runtimeSessionDb = resolveRuntimeSessionDb(c);
      if (runtimeSessionDb) {
        try {
          const runtimeLookup = await readRuntimeUserAuthAvailability(runtimeSessionDb, {
            emailLower: emailQuery || null,
            usernameLower: normalizedUsernameQuery || null,
          });

          const runtimeEmailAvailability = resolveRuntimeAvailability(
            emailQuery,
            runtimeLookup.email,
          );
          const runtimeUsernameAvailability = resolveRuntimeAvailability(
            normalizedUsernameQuery,
            runtimeLookup.username,
          );

          const resolvedAllFromRuntime =
            (!emailQuery || runtimeEmailAvailability !== null) &&
            (!normalizedUsernameQuery || runtimeUsernameAvailability !== null);

          if (resolvedAllFromRuntime) {
            return c.json({
              emailAvailable: runtimeEmailAvailability,
              usernameAvailable: runtimeUsernameAvailability,
            });
          }
        } catch (runtimeLookupError) {
          console.warn("[check-availability][runtime]", {
            message:
              runtimeLookupError instanceof Error
                ? runtimeLookupError.message
                : String(runtimeLookupError),
          });
        }
      }

      const reusableByUserId = new Map<string, Promise<boolean>>();
      const isReusableByUserId = async (userId: string): Promise<boolean> => {
        const cached = reusableByUserId.get(userId);
        if (cached) return cached;

        const started = (async () => {
          const existingUser = await getUserAuthRecordById(c.env.fitloot_db, userId);
          return isReusableIncompleteAccount(existingUser);
        })();
          reusableByUserId.set(userId, started);
          return started;
        };

      const availabilityLookup = await readAvailabilityLookup(
        c.env.fitloot_db,
        emailQuery,
        normalizedUsernameQuery,
      );
      const emailUserId = availabilityLookup?.email_user_id ?? null;
      const usernameUserId = availabilityLookup?.username_user_id ?? null;

      let emailAvailable: boolean | null = null;
      if (emailQuery) {
        if (!emailUserId) {
          emailAvailable = true;
        } else {
          emailAvailable = await isReusableByUserId(emailUserId);
        }
      }

      let usernameAvailable: boolean | null = null;
      if (normalizedUsernameQuery) {
        if (!usernameUserId) {
          usernameAvailable = true;
        } else {
          usernameAvailable = await isReusableByUserId(usernameUserId);
        }
      }

      if (runtimeSessionDb) {
        const userIdsToSync = [
          ...new Set(
            [emailUserId, usernameUserId].filter(
              (userId): userId is string => typeof userId === "string" && userId.length > 0,
            ),
          ),
        ];
        for (const userId of userIdsToSync) {
          await syncRuntimeAvailabilityUser(runtimeSessionDb, c.env.fitloot_db, userId).catch(
            (runtimeSyncError) => {
              console.warn("[check-availability][runtime-sync]", {
                message:
                  runtimeSyncError instanceof Error
                    ? runtimeSyncError.message
                    : String(runtimeSyncError),
                userId,
              });
            },
          );
        }
      }

      return c.json({
        emailAvailable,
        usernameAvailable,
      });
    } catch (error) {
      console.error("[check-availability]", error);
      return c.json(
        {
          error: "Falha ao validar disponibilidade.",
        },
        500,
      );
    }
  });

  // Validates credentials and opens a new session cookie for the authenticated user.
  app.post(
    "/api/auth/login",
    zValidator("json", LoginRequestSchema),
    async (c) => {
      const schemaReady = await hasCoreSchema(c.env.fitloot_db);
      if (!schemaReady) return databaseNotInitializedResponse(c);

      try {
        const data = c.req.valid("json");
        const normalizedEmail = data.email.trim().toLowerCase();

        const userRow = await runWithTransientDatabaseRetry(() =>
          c.env.fitloot_db
            .prepare(
              "SELECT id, password_hash, password_salt FROM users WHERE lower(email) = ?",
            )
            .bind(normalizedEmail)
            .first<{
              id: string;
              password_hash: string | null;
              password_salt: string | null;
            }>(),
        );

        if (!userRow) {
          return c.json(
            {
              error: "Nenhuma conta encontrada com esse e-mail.",
              code: "USER_NOT_FOUND",
            },
            404,
          );
        }

        if (!userRow.password_hash || !userRow.password_salt) {
          return c.json({ error: "Credenciais invalidas" }, 401);
        }

        const computed = await hashPassword(data.password, userRow.password_salt);
        if (computed !== userRow.password_hash) {
          return c.json({ error: "Credenciais invalidas" }, 401);
        }

        const sessionId = crypto.randomUUID();
        const expiresAt = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();

        let sessionInserted = false;
        for (let attempt = 1; attempt <= 2 && !sessionInserted; attempt += 1) {
          try {
            await c.env.fitloot_db
              .prepare(
                "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
              )
              .bind(sessionId, userRow.id, expiresAt)
              .run();
            sessionInserted = true;
            break;
          } catch (sessionInsertError) {
            if (!isConnectionTimeoutLike(sessionInsertError)) {
              throw sessionInsertError;
            }

            const existingSession = await c.env.fitloot_db
              .prepare("SELECT id FROM sessions WHERE id = ? LIMIT 1")
              .bind(sessionId)
              .first<{ id: string }>()
              .catch(() => null);

            if (existingSession?.id) {
              sessionInserted = true;
              break;
            }

            if (attempt >= 2) {
              throw sessionInsertError;
            }

            await sleep(140 * attempt);
          }
        }

        if (!sessionInserted) {
          throw new Error("LOGIN_SESSION_INSERT_FAILED");
        }

        const runtimeSessionDb = resolveRuntimeSessionDb(c);
        if (runtimeSessionDb) {
          try {
            const authRecord = await getUserAuthRecordById(
              c.env.fitloot_db,
              userRow.id,
            ).catch(async (error) => {
              if (!isConnectionTimeoutLike(error)) {
                throw error;
              }

              console.warn("[login][runtime-auth-primary]", {
                userId: userRow.id,
                message:
                  error instanceof Error ? error.message : String(error),
              });
              return readRuntimeUserAuth(runtimeSessionDb, userRow.id, {
                maxAgeMs: 15 * 60_000,
              }).catch(() => null);
            });

            const runtimeSyncTasks: Promise<unknown>[] = [
              upsertRuntimeSession(runtimeSessionDb, {
                id: sessionId,
                user_id: userRow.id,
                expires_at: expiresAt,
              }),
            ];

            if (authRecord) {
              runtimeSyncTasks.push((async () => {
                const profileRow = await c.env.fitloot_db
                  .prepare(
                    "SELECT username FROM user_profiles WHERE user_id = ? LIMIT 1",
                  )
                  .bind(userRow.id)
                  .first<{ username: string | null }>()
                  .catch(() => null);
                await upsertRuntimeUserAuth(runtimeSessionDb, authRecord, {
                  username: profileRow?.username ?? null,
                });
              })());
            } else {
              console.warn("[login][runtime-auth-sync-skip]", {
                userId: userRow.id,
                reason: "auth-record-unavailable",
              });
            }

            await Promise.all(runtimeSyncTasks);
          } catch (runtimeSyncError) {
            console.warn("[login][runtime-session-sync]", {
              message:
                runtimeSyncError instanceof Error
                  ? runtimeSyncError.message
                  : String(runtimeSyncError),
            });
          }
        }

        c.header("Set-Cookie", generateCookie(sessionId, c.req.url));
        return c.json({ success: true }, 200);
      } catch (error) {
        console.error("[login]", error);
        return c.json(
          {
            error: "Falha ao autenticar.",
            code: "INTERNAL_ERROR",
          },
          500,
        );
      }
    },
  );
}
