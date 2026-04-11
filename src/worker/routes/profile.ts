import { Hono, type MiddlewareHandler } from "hono";

import { type ConditioningLevel } from "../../shared/types";
import {
  hasTableColumn,
  runWithTransientDatabaseRetry,
} from "../core/database";
import {
  getErrorMessage,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import {
  deleteRuntimeBootstrapProjection,
  deleteRuntimeUserProjections,
  readRuntimeProfileProjection,
  upsertRuntimeProfileProjection,
} from "../core/runtimeUserProjectionStore";
import {
  currentDateKeyInTimeZone,
  resolveMissionTimeZone,
  sanitizeMissionTimeZone,
} from "../services/missionCycle";
import type { AppContext, AuthUser, Env } from "../core/types";

type FeedbackKind = "Sugestao" | "Bug" | "Elogio" | "Outro";

type FeedbackEmailPayload = {
  kind: FeedbackKind;
  message: string;
  userName: string;
  userUsername: string;
  userEmail: string;
  userLevel: number;
  timestamp: string;
};

type ProfileRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  buildInitialTrainingPlan: (
    env: Env,
    mainGoal: string | null,
    conditioning: ConditioningLevel,
    equipment: string | null,
    injuries: string | null,
    trainingFrequency: number | null | undefined,
  ) => Promise<Record<string, unknown>>;
  createMissionsForPeriod: (
    env: Env,
    db: D1Database,
    userId: string,
    period: "daily" | "weekly" | "monthly",
    limit?: number,
  ) => Promise<void>;
  ensureGoalStatsRow: (
    db: D1Database,
    userId: string,
    goal: string | null,
  ) => Promise<void>;
  fetchResponseWithTimeout: (
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ) => Promise<Response>;
  invalidateMissionListCache: (userId: string) => void;
  missionCycleStartIso: (period: "daily" | "weekly" | "monthly") => string;
  normalizeConditioning: (
    value: unknown,
  ) => ConditioningLevel;
  normalizeTrainingFrequencyInput: (value: unknown) => number;
  onGoalChanged: (
    db: D1Database,
    userId: string,
    oldGoal: string,
    newGoal: string,
    changeCount: number,
  ) => Promise<void>;
  onProfileCustomization: (
    db: D1Database,
    userId: string,
    customizations: Record<string, unknown>,
  ) => Promise<void>;
  unlockAchievementIfNeeded: (
    db: D1Database,
    userId: string,
    achievementName: string,
    progressCurrent: number,
    progressRequired: number,
  ) => Promise<void>;
  upsertTrainingPlan: (
    db: D1Database,
    userId: string,
    plan: Record<string, unknown>,
    mainGoal: string | null,
    conditioning: ConditioningLevel,
    equipment: string | null,
    injuries: string | null,
    trainingFrequency: number | null | undefined,
  ) => Promise<void>;
  repairActivatedProfileState: (params: {
    db: D1Database;
    env: Env;
    user: AuthUser;
  }) => Promise<Record<string, unknown> | null>;
};

const RUNTIME_PROFILE_PROJECTION_TTL_MS = 30_000;

function resolveRuntimeProjectionDb(
  c: import("hono").Context<AppContext>,
): D1Database | null {
  const runtimeDb = c.env.fitloot_runtime_db;
  if (!runtimeDb) return null;
  if (runtimeDb === c.env.fitloot_db) return null;
  return runtimeDb;
}

function normalizeFeedbackKind(raw: unknown): FeedbackKind {
  const value = String(raw ?? "").trim().toLowerCase();
  if (
    value === "sugestao" ||
    value === "sugestão" ||
    value === "suggestion"
  ) {
    return "Sugestao";
  }
  if (value === "bug") return "Bug";
  if (value === "elogio" || value === "praise") return "Elogio";
  return "Outro";
}

function buildFeedbackEmailText(payload: FeedbackEmailPayload): string {
  return [
    `Tipo: ${payload.kind}`,
    `Usuario: ${payload.userName} (@${payload.userUsername})`,
    `Email: ${payload.userEmail}`,
    `Nivel: ${payload.userLevel}`,
    `Data: ${payload.timestamp}`,
    "",
    "Mensagem:",
    payload.message,
  ].join("\n");
}

// Registers profile editing, goal management, and feedback-delivery routes.
export function registerProfileRoutes(
  app: Hono<AppContext>,
  {
    authMiddleware,
    buildInitialTrainingPlan,
    createMissionsForPeriod,
    ensureGoalStatsRow,
    fetchResponseWithTimeout,
    invalidateMissionListCache,
    missionCycleStartIso,
    normalizeConditioning,
    normalizeTrainingFrequencyInput,
    onGoalChanged,
    onProfileCustomization,
    repairActivatedProfileState,
    unlockAchievementIfNeeded,
    upsertTrainingPlan,
  }: ProfileRouteDeps,
): void {
  // Returns the editable user profile once onboarding has been completed.
  app.get("/api/profile", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const runtimeProjectionDb = resolveRuntimeProjectionDb(c);

    try {
      if (Number(user.onboarding_completed ?? 0) !== 1) {
        return c.json(
          { error: "Perfil nao encontrado", code: "PROFILE_NOT_FOUND" },
          404,
        );
      }

      if (runtimeProjectionDb) {
        try {
          const cachedProfile = await readRuntimeProfileProjection<Record<string, unknown>>(
            runtimeProjectionDb,
            user.id,
            RUNTIME_PROFILE_PROJECTION_TTL_MS,
          );
          if (cachedProfile) {
            return c.json(cachedProfile);
          }
        } catch (runtimeProjectionError) {
          console.warn("[/api/profile][runtime-read]", {
            userId: user.id,
            message: getErrorMessage(runtimeProjectionError),
          });
        }
      }

      const profileWithState = await runWithTransientDatabaseRetry(() =>
        c.env.fitloot_db
          .prepare(
            `SELECT
              up.*,
              u.avatar_url,
              ua.user_id as __has_attributes_user_id,
              pr.user_id as __has_progression_user_id,
              tp.user_id as __has_training_plan_user_id
            FROM user_profiles up
            INNER JOIN users u
              ON u.id = up.user_id
            LEFT JOIN user_attributes ua
              ON ua.user_id = up.user_id
            LEFT JOIN user_progression pr
              ON pr.user_id = up.user_id
            LEFT JOIN user_training_plans tp
              ON tp.user_id = up.user_id
            WHERE up.user_id = ?
            LIMIT 1`,
          )
          .bind(user.id)
          .first<Record<string, unknown>>(),
      );
      let profile: Record<string, unknown> | null = null;
      let hasAttributes = false;
      let hasProgression = false;
      let hasTrainingPlan = false;

      if (profileWithState) {
        const normalized = { ...profileWithState };
        hasAttributes = Boolean(normalized.__has_attributes_user_id);
        hasProgression = Boolean(normalized.__has_progression_user_id);
        hasTrainingPlan = Boolean(normalized.__has_training_plan_user_id);
        delete normalized.__has_attributes_user_id;
        delete normalized.__has_progression_user_id;
        delete normalized.__has_training_plan_user_id;
        profile = normalized;
      }

      if (
        !profile ||
        !hasAttributes ||
        !hasProgression ||
        !hasTrainingPlan
      ) {
        const recoveredProfile = await repairActivatedProfileState({
          db: c.env.fitloot_db,
          env: c.env,
          user,
        });
        if (recoveredProfile) {
          const hydratedRecoveredProfile = {
            ...recoveredProfile,
            avatar_url: user.avatar_url ?? null,
          };
          console.warn("[/api/profile][recovered-missing-profile]", {
            userId: user.id,
          });
          if (runtimeProjectionDb) {
            c.executionCtx.waitUntil(
              upsertRuntimeProfileProjection(runtimeProjectionDb, user.id, hydratedRecoveredProfile).catch(
                (runtimeProjectionError) => {
                  console.warn("[/api/profile][runtime-write-recovered]", {
                    userId: user.id,
                    message: getErrorMessage(runtimeProjectionError),
                  });
                },
              ),
            );
          }
          return c.json(hydratedRecoveredProfile);
        }

        return c.json(
          { error: "Perfil nao encontrado", code: "PROFILE_NOT_FOUND" },
          404,
        );
      }

      if (runtimeProjectionDb) {
        c.executionCtx.waitUntil(
          upsertRuntimeProfileProjection(runtimeProjectionDb, user.id, profile).catch(
            (runtimeProjectionError) => {
              console.warn("[/api/profile][runtime-write]", {
                userId: user.id,
                message: getErrorMessage(runtimeProjectionError),
              });
            },
          ),
        );
      }

      return c.json(profile);
    } catch (error) {
      console.error("[/api/profile]", {
        message: getErrorMessage(error),
        userId: user.id,
      });

      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
    }
  });

  // Persists visual profile customization choices and updates related achievements.
  app.post("/api/profile/customization", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const customPrimaryColor =
      typeof body.custom_primary_color === "string"
        ? body.custom_primary_color
        : null;
    const customSecondaryColor =
      typeof body.custom_secondary_color === "string"
        ? body.custom_secondary_color
        : null;
    const customBackgroundType =
      typeof body.custom_background_type === "string"
        ? body.custom_background_type
        : null;
    const customBackgroundValue =
      typeof body.custom_background_value === "string"
        ? body.custom_background_value
        : null;
    const customFont =
      typeof body.custom_font === "string" ? body.custom_font : null;
    const customTitleId = Number.isFinite(Number(body.custom_title_id))
      ? Number(body.custom_title_id)
      : null;
    const showcasedAchievements = Array.isArray(body.showcased_achievements)
      ? JSON.stringify(body.showcased_achievements)
      : null;

    await c.env.fitloot_db
      .prepare(
        `UPDATE user_profiles SET
          custom_primary_color = COALESCE(?, custom_primary_color),
          custom_secondary_color = COALESCE(?, custom_secondary_color),
          custom_background_type = COALESCE(?, custom_background_type),
          custom_background_value = COALESCE(?, custom_background_value),
          custom_font = COALESCE(?, custom_font),
          custom_title_id = COALESCE(?, custom_title_id),
          showcased_achievements = COALESCE(?, showcased_achievements),
          updated_at = datetime('now')
          WHERE user_id = ?`,
      )
      .bind(
        customPrimaryColor,
        customSecondaryColor,
        customBackgroundType,
        customBackgroundValue,
        customFont,
        customTitleId,
        showcasedAchievements,
        user.id,
      )
      .run();

    await onProfileCustomization(c.env.fitloot_db, user.id, {
      custom_primary_color: customPrimaryColor,
      custom_secondary_color: customSecondaryColor,
      custom_background_type: customBackgroundType,
      custom_background_value: customBackgroundValue,
      custom_font: customFont,
      custom_title_id: customTitleId,
      showcased_achievements: showcasedAchievements,
    });

    const done = [
      customPrimaryColor,
      customSecondaryColor,
      customBackgroundType,
      customBackgroundValue,
      customFont,
      customTitleId,
      showcasedAchievements,
    ].every((value) => value !== null && value !== undefined && value !== "");

    if (done) {
      await unlockAchievementIfNeeded(
        c.env.fitloot_db,
        user.id,
        "Mestre Artesão",
        1,
        1,
      );
    }

    const profile = await c.env.fitloot_db
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
      .first();

    const runtimeProjectionDb = resolveRuntimeProjectionDb(c);
    if (runtimeProjectionDb) {
      c.executionCtx.waitUntil(
        (async () => {
          await deleteRuntimeBootstrapProjection(runtimeProjectionDb, user.id);
          if (profile) {
            await upsertRuntimeProfileProjection(runtimeProjectionDb, user.id, profile);
          } else {
            await deleteRuntimeUserProjections(runtimeProjectionDb, user.id);
          }
        })().catch((runtimeProjectionError) => {
          console.warn("[/api/profile/customization][runtime-sync]", {
            userId: user.id,
            message: getErrorMessage(runtimeProjectionError),
          });
        }),
      );
    }

    return c.json({ success: true, profile });
  });

  // Switches the currently active skill focus used by the profile and training surfaces.
  app.post("/api/profile/skill-focus", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as {
      active_skill_focus?: string | undefined;
    };
    const focus =
      body.active_skill_focus === "yoga" ? "yoga" : "calistenia";
    await c.env.fitloot_db
      .prepare(
        "UPDATE user_profiles SET active_skill_focus = ?, updated_at = datetime('now') WHERE user_id = ?",
      )
      .bind(focus, user.id)
      .run();

    const runtimeProjectionDb = resolveRuntimeProjectionDb(c);
    if (runtimeProjectionDb) {
      c.executionCtx.waitUntil(
        deleteRuntimeUserProjections(runtimeProjectionDb, user.id).catch((runtimeProjectionError) => {
          console.warn("[/api/profile/skill-focus][runtime-invalidate]", {
            userId: user.id,
            message: getErrorMessage(runtimeProjectionError),
          });
        }),
      );
    }

    return c.json({ success: true, active_skill_focus: focus });
  });

  // Updates the user's main goal, refreshes the plan, and regenerates the active daily slate.
  app.post("/api/profile/goal", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = (await c.req.json().catch(() => ({}))) as {
      main_goal?: string | undefined;
    };
    const newGoal = String(body.main_goal ?? "").trim();
    if (!newGoal) {
      return c.json({ error: "main_goal obrigatório" }, 400);
    }

    const current = await c.env.fitloot_db
      .prepare("SELECT main_goal FROM user_profiles WHERE user_id = ?")
      .bind(user.id)
      .first<{ main_goal: string | null }>();
    const oldGoal = current?.main_goal ?? "saúde_geral";

    await c.env.fitloot_db
      .prepare(
        "UPDATE user_profiles SET main_goal = ?, updated_at = datetime('now') WHERE user_id = ?",
      )
      .bind(newGoal, user.id)
      .run();
    await ensureGoalStatsRow(c.env.fitloot_db, user.id, newGoal);

    const stats = await c.env.fitloot_db
      .prepare(
        "SELECT goal_change_count, original_goal, completed_goals FROM user_goal_stats WHERE user_id = ?",
      )
      .bind(user.id)
      .first<{
        goal_change_count: number;
        original_goal: string;
        completed_goals: string | null;
      }>();
    const changeCount =
      Number(stats?.goal_change_count ?? 0) + (oldGoal !== newGoal ? 1 : 0);
    const completedGoals = new Set<string>(
      JSON.parse(stats?.completed_goals || "[]"),
    );
    if (oldGoal) completedGoals.add(oldGoal);

    let returned = 0;
    if ((stats?.original_goal ?? oldGoal) === newGoal && oldGoal !== newGoal) {
      returned = 1;
    }

    await c.env.fitloot_db
      .prepare(
        `UPDATE user_goal_stats SET current_goal = ?, goal_change_count = ?, completed_goals = ?, returned_to_original_count = COALESCE(returned_to_original_count,0) + ?, missions_after_return = CASE WHEN ? = 1 THEN 0 ELSE missions_after_return END, updated_at = datetime('now') WHERE user_id = ?`,
      )
      .bind(
        newGoal,
        changeCount,
        JSON.stringify(Array.from(completedGoals)),
        returned,
        returned,
        user.id,
      )
      .run();

    await onGoalChanged(c.env.fitloot_db, user.id, oldGoal, newGoal, changeCount);
    if (completedGoals.size >= 5) {
      await unlockAchievementIfNeeded(
        c.env.fitloot_db,
        user.id,
        "A Jornada é o Destino",
        completedGoals.size,
        5,
      );
    }

    const [profileForRegeneration, planForRegeneration] = await Promise.all([
      c.env.fitloot_db
        .prepare(
          "SELECT initial_conditioning, injuries, equipment FROM user_profiles WHERE user_id = ?",
        )
        .bind(user.id)
        .first<{
          initial_conditioning: string | null;
          injuries: string | null;
          equipment: string | null;
        }>(),
      c.env.fitloot_db
        .prepare(
          "SELECT training_frequency FROM user_training_plans WHERE user_id = ?",
        )
        .bind(user.id)
        .first<{ training_frequency: number | null }>(),
    ]);
    const conditioning = normalizeConditioning(
      profileForRegeneration?.initial_conditioning,
    );
    const injuries =
      typeof profileForRegeneration?.injuries === "string"
        ? profileForRegeneration.injuries
        : "";
    const equipment =
      typeof profileForRegeneration?.equipment === "string"
        ? profileForRegeneration.equipment
        : "";
    const trainingFrequency = normalizeTrainingFrequencyInput(
      planForRegeneration?.training_frequency,
    );
    const refreshedPlan = await buildInitialTrainingPlan(
      c.env,
      newGoal,
      conditioning,
      equipment,
      injuries,
      trainingFrequency,
    );
    await upsertTrainingPlan(
      c.env.fitloot_db,
      user.id,
      refreshedPlan as Record<string, unknown>,
      newGoal,
      conditioning,
      equipment,
      injuries,
      trainingFrequency,
    );

    const hasMissionCycleDate = await hasTableColumn(
      c.env.fitloot_db,
      "missions",
      "cycle_date",
    );
    const missionTimeZone = resolveMissionTimeZone(
      sanitizeMissionTimeZone(c.req.header("X-FitLoot-Timezone")),
    );
    if (hasMissionCycleDate) {
      const dailyCycleDate = currentDateKeyInTimeZone(new Date(), missionTimeZone);
      await c.env.fitloot_db
        .prepare(
          `DELETE FROM missions
            WHERE user_id = ?
              AND type = 'daily'
              AND is_completed = 0
              AND COALESCE(mission_origin, 'regular') = 'regular'
              AND COALESCE(cycle_date, substr(CAST(created_at AS TEXT), 1, 10)) = ?`,
        )
        .bind(user.id, dailyCycleDate)
        .run();
    } else {
      const dailyCycleStart = missionCycleStartIso("daily");
      await c.env.fitloot_db
        .prepare(
          `DELETE FROM missions
            WHERE user_id = ?
              AND type = 'daily'
              AND is_completed = 0
              AND COALESCE(mission_origin, 'regular') = 'regular'
              AND datetime(created_at) >= datetime(?)`,
        )
        .bind(user.id, dailyCycleStart)
        .run();
    }
    c.executionCtx.waitUntil(
      (async () => {
        try {
          await createMissionsForPeriod(
            c.env,
            c.env.fitloot_db,
            user.id,
            "daily",
            5,
          );
          invalidateMissionListCache(user.id);
        } catch (error) {
          console.error("[/api/profile/goal][background-missions]", {
            userId: user.id,
            message: getErrorMessage(error),
          });
        }
      })(),
    );

    const runtimeProjectionDb = resolveRuntimeProjectionDb(c);
    if (runtimeProjectionDb) {
      c.executionCtx.waitUntil(
        deleteRuntimeUserProjections(runtimeProjectionDb, user.id).catch((runtimeProjectionError) => {
          console.warn("[/api/profile/goal][runtime-invalidate]", {
            userId: user.id,
            message: getErrorMessage(runtimeProjectionError),
          });
        }),
      );
    }

    return c.json({
      success: true,
      old_goal: oldGoal,
      new_goal: newGoal,
      change_count: changeCount,
    });
  });

  async function sendFeedbackViaResend(
    env: Env,
    subject: string,
    textBody: string,
    replyTo: string,
  ): Promise<boolean> {
    if (!env.RESEND_API_KEY) {
      return false;
    }

    const fromAddress =
      env.FEEDBACK_FROM_EMAIL ?? "FitLoot <feedback@fitloot.app>";
    const response = await fetchResponseWithTimeout(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: fromAddress,
          to: ["suportefitloot@gmail.com"],
          subject,
          text: textBody,
          reply_to: replyTo,
        }),
      },
      8_000,
    );

    if (!response.ok) {
      const reason = await response.text();
      throw new Error(`resend-failed:${response.status}:${reason}`);
    }

    return true;
  }

  // Falls back to MailChannels when Resend is unavailable or fails for feedback delivery.
  async function sendFeedbackViaMailChannels(
    subject: string,
    textBody: string,
    payload: FeedbackEmailPayload,
    env: Env,
  ): Promise<void> {
    const fromAddress = env.FEEDBACK_FROM_EMAIL ?? "feedback@fitloot.app";
    const response = await fetchResponseWithTimeout(
      "https://api.mailchannels.net/tx/v1/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [
                {
                  email: "suportefitloot@gmail.com",
                  name: "FitLoot Suporte",
                },
              ],
            },
          ],
          from: {
            email: fromAddress,
            name: "FitLoot Feedback",
          },
          reply_to: {
            email: payload.userEmail,
            name: payload.userName,
          },
          subject,
          content: [
            {
              type: "text/plain",
              value: textBody,
            },
          ],
        }),
      },
      8_000,
    );

    if (!response.ok) {
      const reason = await response.text();
      throw new Error(`mailchannels-failed:${response.status}:${reason}`);
    }
  }

  // Accepts in-app feedback and forwards it through the configured email provider chain.
  app.post("/api/feedback", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        type?: unknown;
        message?: unknown;
      };
      const kind = normalizeFeedbackKind(body.type);
      const message = String(body.message ?? "").trim();

      if (message.length < 5) {
        return c.json(
          {
            error:
              "Escreva uma mensagem com pelo menos 5 caracteres.",
          },
          400,
        );
      }

      const [profile, progression] = await Promise.all([
        c.env.fitloot_db
          .prepare(
            "SELECT full_name, username FROM user_profiles WHERE user_id = ?",
          )
          .bind(user.id)
          .first<{ full_name: string | null; username: string | null }>(),
        c.env.fitloot_db
          .prepare("SELECT level FROM user_progression WHERE user_id = ?")
          .bind(user.id)
          .first<{ level: number | null }>(),
      ]);

      const feedbackPayload: FeedbackEmailPayload = {
        kind,
        message,
        userName: profile?.full_name ?? user.name,
        userUsername: profile?.username ?? user.email.split("@")[0],
        userEmail: user.email,
        userLevel: Number(progression?.level ?? 1),
        timestamp: new Date().toISOString(),
      };

      const subject = `[FitLoot Feedback] ${feedbackPayload.kind} - ${feedbackPayload.userName}`;
      const textBody = buildFeedbackEmailText(feedbackPayload);

      let provider: "resend" | "mailchannels" = "mailchannels";

      try {
        const sentByResend = await sendFeedbackViaResend(
          c.env,
          subject,
          textBody,
          feedbackPayload.userEmail,
        );
        if (sentByResend) {
          provider = "resend";
        } else {
          await sendFeedbackViaMailChannels(
            subject,
            textBody,
            feedbackPayload,
            c.env,
          );
        }
      } catch (primaryError) {
        console.warn("[/api/feedback][primary-provider-failed]", {
          message: getErrorMessage(primaryError),
        });
        await sendFeedbackViaMailChannels(
          subject,
          textBody,
          feedbackPayload,
          c.env,
        );
        provider = "mailchannels";
      }

      return c.json({ success: true, provider });
    } catch (error) {
      console.error("[/api/feedback]", {
        message: getErrorMessage(error),
        userId: user.id,
      });
      return c.json(
        { error: "Não foi possível enviar o feedback agora." },
        500,
      );
    }
  });

}
