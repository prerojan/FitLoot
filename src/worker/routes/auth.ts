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
} from "../core/database";
import type { AppContext } from "../core/types";
import {
  getUserAuthRecordById,
  isReusableIncompleteAccount,
} from "../services/userPlanAccess";

type AuthRouteDeps = {
  generateCookie: (sessionId: string, requestUrl: string) => string;
  hashPassword: (password: string, salt: string) => Promise<string>;
};

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

        const existing = await c.env.fitloot_db
          .prepare("SELECT id FROM users WHERE lower(email) = ?")
          .bind(normalizedEmail)
          .first<{ id: string }>();

        if (existing?.id) {
          const existingUser = await getUserAuthRecordById(c.env.fitloot_db, existing.id);
          if (!isReusableIncompleteAccount(existingUser)) {
            return c.json({ error: "E-mail ja cadastrado" }, 409);
          }

          await purgeUserAccountData(c.env.fitloot_db, existing.id);
        }

        const userId = crypto.randomUUID();
        const salt = crypto.randomUUID();
        const passwordHash = await hashPassword(data.password, salt);

        await c.env.fitloot_db
          .prepare(
            "INSERT INTO users (id, email, name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(userId, normalizedEmail, data.name ?? "", passwordHash, salt)
          .run();

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

        const availabilityLookup =
          emailQuery || normalizedUsernameQuery
            ? await c.env.fitloot_db
                .prepare(
                  `SELECT
                    (SELECT id FROM users WHERE lower(email) = ? LIMIT 1) AS email_user_id,
                    (SELECT user_id FROM user_profiles WHERE lower(username) = ? LIMIT 1) AS username_user_id`,
                )
                .bind(emailQuery || null, normalizedUsernameQuery || null)
                .first<{ email_user_id: string | null; username_user_id: string | null }>()
            : null;
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

        const userRow = await c.env.fitloot_db
          .prepare(
            "SELECT id, password_hash, password_salt FROM users WHERE lower(email) = ?",
          )
          .bind(normalizedEmail)
          .first<{
            id: string;
            password_hash: string | null;
            password_salt: string | null;
          }>();

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

        await c.env.fitloot_db
          .prepare(
            "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
          )
          .bind(sessionId, userRow.id, expiresAt)
          .run();

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
