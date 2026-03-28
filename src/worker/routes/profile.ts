import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  OnboardingRequestSchema,
  type ConditioningLevel,
} from "../../shared/types";
import { hasTableColumn } from "../core/database";
import {
  getErrorMessage,
  isInvalidPromoCodeError,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import type {
  AppContext,
  CheckoutStartResult,
  Env,
} from "../core/types";

type WithTransaction = <T>(
  db: D1Database,
  run: () => Promise<T>,
) => Promise<T>;

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
    mainGoal: string | null,
    conditioning: ConditioningLevel,
    equipment: string | null,
    injuries: string | null,
  ) => Promise<Record<string, unknown>>;
  conditioningOrder: (conditioning: ConditioningLevel) => number;
  createMissionsForPeriod: (
    env: Env,
    db: D1Database,
    userId: string,
    period: "daily" | "weekly" | "monthly",
    limit?: number,
  ) => Promise<void>;
  ensureGamificationCatalog: (db: D1Database) => Promise<void>;
  ensureGoalStatsRow: (
    db: D1Database,
    userId: string,
    goal: string | null,
  ) => Promise<void>;
  ensurePeriodicMissions: (
    env: Env,
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  ensureUserCounterRow: (db: D1Database, userId: string) => Promise<void>;
  evaluateLevelTitles: (
    db: D1Database,
    userId: string,
    level: number,
  ) => Promise<void>;
  fetchResponseWithTimeout: (
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ) => Promise<Response>;
  invalidateMissionListCache: (userId: string) => void;
  logUserEvent: (
    db: D1Database,
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
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
  startCheckoutForUser: (
    db: D1Database,
    env: Env,
    params: {
      userId: string;
      planId: "basic" | "pro" | "annual";
      paymentMethod: "card" | "pix";
      cardNumber?: string | undefined;
      cardHolderName?: string | undefined;
      cardExpiry?: string | undefined;
      promoCode?: string | undefined;
      markOnboardingCompleted: boolean;
    },
  ) => Promise<CheckoutStartResult>;
  skillTierOrder: (tier: string) => number;
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
  withTransaction: WithTransaction;
};

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

// Route registration for profile editing, feedback, and onboarding flows.
export function registerProfileRoutes(
  app: Hono<AppContext>,
  {
    authMiddleware,
    buildInitialTrainingPlan,
    conditioningOrder,
    createMissionsForPeriod,
    ensureGamificationCatalog,
    ensureGoalStatsRow,
    ensurePeriodicMissions,
    ensureUserCounterRow,
    evaluateLevelTitles,
    fetchResponseWithTimeout,
    invalidateMissionListCache,
    logUserEvent,
    missionCycleStartIso,
    normalizeConditioning,
    normalizeTrainingFrequencyInput,
    onGoalChanged,
    onProfileCustomization,
    startCheckoutForUser,
    skillTierOrder,
    unlockAchievementIfNeeded,
    upsertTrainingPlan,
    withTransaction,
  }: ProfileRouteDeps,
): void {
  app.get("/api/profile", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      if (Number(user.onboarding_completed ?? 0) !== 1) {
        return c.json(
          { error: "Perfil nao encontrado", code: "PROFILE_NOT_FOUND" },
          404,
        );
      }

      const profile = await c.env.fitloot_db
        .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
        .bind(user.id)
        .first();

      if (!profile) {
        return c.json(
          { error: "Perfil nao encontrado", code: "PROFILE_NOT_FOUND" },
          404,
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
      .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
      .bind(user.id)
      .first();
    return c.json({ success: true, profile });
  });

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

    return c.json({ success: true, active_skill_focus: focus });
  });

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
    const oldGoal = current?.main_goal ?? "saude_geral";

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
      newGoal,
      conditioning,
      equipment,
      injuries,
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
        { error: "Nao foi possivel enviar o feedback agora." },
        500,
      );
    }
  });

  app.post(
    "/api/onboarding",
    authMiddleware,
    zValidator("json", OnboardingRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const data = c.req.valid("json");
      await ensureGamificationCatalog(c.env.fitloot_db);

      const selectedGoals = Array.from(
        new Set(
          (
            Array.isArray(data.goals) && data.goals.length > 0
              ? data.goals
              : [data.main_goal]
          )
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0),
        ),
      );
      const username = data.username.trim();
      const fullName = data.full_name.trim();
      const primaryGoal = selectedGoals[0] ?? data.main_goal;
      const trainingFrequency = normalizeTrainingFrequencyInput(
        data.training_frequency,
      );
      const goalsJson = JSON.stringify(selectedGoals);

      if (username.length < 3 || fullName.length === 0) {
        return c.json({ error: "Dados de identidade invalidos" }, 400);
      }

      const existingUsername = await c.env.fitloot_db
        .prepare(
          "SELECT user_id FROM user_profiles WHERE username = ? LIMIT 1",
        )
        .bind(username)
        .first<{ user_id: string | null }>();

      if (existingUsername?.user_id && existingUsername.user_id !== user.id) {
        return c.json({ error: "Username already taken" }, 400);
      }

      let initialAttrs = {
        strength: 10,
        constitution: 10,
        vitality: 10,
        dexterity: 10,
        focus: 10,
      };
      if (data.initial_conditioning === "iniciante") {
        initialAttrs = {
          strength: 15,
          constitution: 15,
          vitality: 15,
          dexterity: 12,
          focus: 12,
        };
      } else if (data.initial_conditioning === "intermediario") {
        initialAttrs = {
          strength: 25,
          constitution: 25,
          vitality: 25,
          dexterity: 20,
          focus: 20,
        };
      } else if (data.initial_conditioning === "avancado") {
        initialAttrs = {
          strength: 40,
          constitution: 40,
          vitality: 40,
          dexterity: 35,
          focus: 35,
        };
      }

      initialAttrs.strength += Math.floor(data.initial_pushups / 5);
      initialAttrs.constitution += Math.floor(data.initial_situps / 5);
      initialAttrs.vitality += Math.floor(data.initial_squats / 5);

      const conditioning = data.initial_conditioning as ConditioningLevel;
      const maxTier = conditioningOrder(conditioning);
      const [
        hasInitialPushupsColumn,
        hasInitialSitupsColumn,
        hasInitialSquatsColumn,
      ] = await Promise.all([
        hasTableColumn(c.env.fitloot_db, "user_profiles", "initial_pushups"),
        hasTableColumn(c.env.fitloot_db, "user_profiles", "initial_situps"),
        hasTableColumn(c.env.fitloot_db, "user_profiles", "initial_squats"),
      ]);
      let checkoutResult: CheckoutStartResult | undefined;
      try {
        await withTransaction(c.env.fitloot_db, async () => {
          const profileColumns = [
            "user_id",
            "username",
            "full_name",
            "weight",
            "height",
            "initial_conditioning",
            "injuries",
            "equipment",
            "main_goal",
            "age",
            "gender",
            "goals_json",
            "updated_at",
          ];
          const profileValues: unknown[] = [
            user.id,
            username,
            fullName,
            data.weight,
            data.height,
            data.initial_conditioning,
            data.injuries || "",
            data.equipment || "",
            primaryGoal,
            data.age,
            data.gender,
            goalsJson,
          ];
          const profilePlaceholders = [
            "?",
            "?",
            "?",
            "?",
            "?",
            "?",
            "?",
            "?",
            "?",
            "?",
            "?",
            "?",
            "datetime('now')",
          ];
          const profileUpdates = [
            "username = excluded.username",
            "full_name = excluded.full_name",
            "weight = excluded.weight",
            "height = excluded.height",
            "initial_conditioning = excluded.initial_conditioning",
            "injuries = excluded.injuries",
            "equipment = excluded.equipment",
            "main_goal = excluded.main_goal",
            "age = excluded.age",
            "gender = excluded.gender",
            "goals_json = excluded.goals_json",
            "updated_at = datetime('now')",
          ];

          if (hasInitialPushupsColumn) {
            profileColumns.splice(profileColumns.length - 1, 0, "initial_pushups");
            profilePlaceholders.splice(profilePlaceholders.length - 1, 0, "?");
            profileValues.push(data.initial_pushups);
            profileUpdates.splice(
              profileUpdates.length - 1,
              0,
              "initial_pushups = excluded.initial_pushups",
            );
          }
          if (hasInitialSitupsColumn) {
            profileColumns.splice(profileColumns.length - 1, 0, "initial_situps");
            profilePlaceholders.splice(profilePlaceholders.length - 1, 0, "?");
            profileValues.push(data.initial_situps);
            profileUpdates.splice(
              profileUpdates.length - 1,
              0,
              "initial_situps = excluded.initial_situps",
            );
          }
          if (hasInitialSquatsColumn) {
            profileColumns.splice(profileColumns.length - 1, 0, "initial_squats");
            profilePlaceholders.splice(profilePlaceholders.length - 1, 0, "?");
            profileValues.push(data.initial_squats);
            profileUpdates.splice(
              profileUpdates.length - 1,
              0,
              "initial_squats = excluded.initial_squats",
            );
          }

          await c.env.fitloot_db
            .prepare(
              `INSERT INTO user_profiles (${profileColumns.join(", ")})
               VALUES (${profilePlaceholders.join(", ")})
               ON CONFLICT(user_id) DO UPDATE SET ${profileUpdates.join(", ")}`,
            )
            .bind(...profileValues)
            .run();

          await c.env.fitloot_db
            .prepare(
              `INSERT INTO user_attributes (user_id, strength, constitution, vitality, dexterity, focus, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET
                strength = excluded.strength,
                constitution = excluded.constitution,
                vitality = excluded.vitality,
                dexterity = excluded.dexterity,
                focus = excluded.focus,
                updated_at = datetime('now')`,
            )
            .bind(
              user.id,
              initialAttrs.strength,
              initialAttrs.constitution,
              initialAttrs.vitality,
              initialAttrs.dexterity,
              initialAttrs.focus,
            )
            .run();

          await c.env.fitloot_db
            .prepare(
              `INSERT OR IGNORE INTO user_progression (user_id, xp, level, points, current_streak, best_streak, updated_at)
              VALUES (?, 0, 1, 0, 0, 0, datetime('now'))`,
            )
            .bind(user.id)
            .run();

          const initialSkills = await c.env.fitloot_db
            .prepare("SELECT id, tier, level_required FROM skills")
            .all<{ id: number; tier: string; level_required: number }>();

          for (const skill of initialSkills.results) {
            if (
              skillTierOrder(skill.tier) <= Math.max(1, maxTier) &&
              Number(skill.level_required ?? 1) <= 1
            ) {
              await c.env.fitloot_db
                .prepare(
                  `INSERT OR IGNORE INTO user_skills (user_id, skill_id, status, current_stage, total_reps, total_time, best_reps, unlocked_at, updated_at)
                  VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`,
                )
                .bind(user.id, skill.id)
                .run();
            }
          }

          const plan = await buildInitialTrainingPlan(
            primaryGoal,
            conditioning,
            data.equipment ?? null,
            data.injuries ?? null,
          );
          await upsertTrainingPlan(
            c.env.fitloot_db,
            user.id,
            plan,
            primaryGoal,
            conditioning,
            data.equipment ?? null,
            data.injuries ?? null,
            trainingFrequency,
          );

          checkoutResult = await startCheckoutForUser(c.env.fitloot_db, c.env, {
            userId: user.id,
            planId: data.plan_id,
            paymentMethod: data.payment_method,
            cardNumber: data.card_number,
            cardHolderName: data.card_holder_name,
            cardExpiry: data.card_expiry,
            promoCode: data.promo_code,
            markOnboardingCompleted: false,
          });

          await ensureGoalStatsRow(c.env.fitloot_db, user.id, primaryGoal);
          await ensureUserCounterRow(c.env.fitloot_db, user.id);
          await logUserEvent(c.env.fitloot_db, user.id, "onboarding_submitted", {
            conditioning,
            main_goal: primaryGoal,
            goals: selectedGoals,
            training_frequency: trainingFrequency,
            plan_id: checkoutResult.plan_id,
            plan_status: checkoutResult.plan_status,
            amount: checkoutResult.amount,
          });
          await evaluateLevelTitles(c.env.fitloot_db, user.id, 1);
        });
      } catch (error) {
        if (isInvalidPromoCodeError(error)) {
          return c.json({ error: "Código inválido ou expirado" }, 400);
        }
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }

        throw error;
      }

      if (!checkoutResult) {
        throw new Error(
          "Checkout result missing after onboarding transaction.",
        );
      }

      c.executionCtx.waitUntil(
        (async () => {
          try {
            await ensurePeriodicMissions(c.env, c.env.fitloot_db, user.id);
            invalidateMissionListCache(user.id);
          } catch (error) {
            console.error("[/api/onboarding][background-missions]", {
              userId: user.id,
              message: getErrorMessage(error),
            });
          }
        })(),
      );

      return c.json(
        { success: true, plan_created: true, ...checkoutResult },
        201,
      );
    },
  );
}
