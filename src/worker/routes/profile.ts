import { Hono, type MiddlewareHandler } from "hono";

import { type ConditioningLevel } from "../../shared/types";
import { hasTableColumn } from "../core/database";
import {
  getErrorMessage,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
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
};

type RepairActivatedProfileStateParams = {
  db: D1Database;
  env: Env;
  user: AuthUser;
  buildInitialTrainingPlan: ProfileRouteDeps["buildInitialTrainingPlan"];
  ensureGoalStatsRow: ProfileRouteDeps["ensureGoalStatsRow"];
  normalizeConditioning: ProfileRouteDeps["normalizeConditioning"];
  normalizeTrainingFrequencyInput: ProfileRouteDeps["normalizeTrainingFrequencyInput"];
  upsertTrainingPlan: ProfileRouteDeps["upsertTrainingPlan"];
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

function normalizeFallbackUsernameFragment(raw: string): string {
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized.length >= 3) {
    return normalized.slice(0, 20);
  }

  return "";
}

async function resolveRecoverableUsername(
  db: D1Database,
  user: AuthUser,
): Promise<string> {
  const fallbackIdFragment = user.id.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 6) || "user";
  const emailBase = normalizeFallbackUsernameFragment(user.email.split("@")[0] ?? "");
  const nameBase = normalizeFallbackUsernameFragment(user.name);
  const baseCandidate = (nameBase || emailBase || `fitloot_${fallbackIdFragment}`).slice(0, 20);
  const base = baseCandidate.length >= 3 ? baseCandidate : `fitloot_${fallbackIdFragment}`.slice(0, 20);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffix = attempt === 0 ? "" : `_${fallbackIdFragment}${attempt}`;
    const maxBaseLength = Math.max(3, 20 - suffix.length);
    const candidate = `${base.slice(0, maxBaseLength)}${suffix}`.slice(0, 20);

    const existing = await db
      .prepare("SELECT user_id FROM user_profiles WHERE username = ? LIMIT 1")
      .bind(candidate)
      .first<{ user_id: string | null }>();

    if (!existing?.user_id || existing.user_id === user.id) {
      return candidate;
    }
  }

  return `fit_${fallbackIdFragment}_${Date.now().toString().slice(-4)}`.slice(0, 20);
}

function resolveDefaultAttributes(conditioning: ConditioningLevel) {
  if (conditioning === "sedentario") {
    return {
      strength: 10,
      constitution: 10,
      vitality: 10,
      dexterity: 10,
      focus: 10,
    };
  }

  if (conditioning === "intermediario") {
    return {
      strength: 25,
      constitution: 25,
      vitality: 25,
      dexterity: 20,
      focus: 20,
    };
  }

  if (conditioning === "avancado") {
    return {
      strength: 40,
      constitution: 40,
      vitality: 40,
      dexterity: 35,
      focus: 35,
    };
  }

  return {
    strength: 15,
    constitution: 15,
    vitality: 15,
    dexterity: 12,
    focus: 12,
  };
}

async function repairActivatedProfileState({
  db,
  env,
  user,
  buildInitialTrainingPlan,
  ensureGoalStatsRow,
  normalizeConditioning,
  normalizeTrainingFrequencyInput,
  upsertTrainingPlan,
}: RepairActivatedProfileStateParams): Promise<Record<string, unknown> | null> {
  const username = await resolveRecoverableUsername(db, user);
  const fullName = user.name.trim() || user.email.split("@")[0] || "Usuario FitLoot";
  const trainingPlanRow = await db
    .prepare(
      `SELECT main_goal, conditioning, training_frequency, equipment, injuries
      FROM user_training_plans
      WHERE user_id = ?`,
    )
    .bind(user.id)
    .first<{
      main_goal: string | null;
      conditioning: string | null;
      training_frequency: number | null;
      equipment: string | null;
      injuries: string | null;
    }>();
  const conditioning = normalizeConditioning(trainingPlanRow?.conditioning ?? "iniciante");
  const mainGoal = typeof trainingPlanRow?.main_goal === "string" && trainingPlanRow.main_goal.trim().length > 0
    ? trainingPlanRow.main_goal.trim()
    : "saude_geral";
  const trainingFrequency = normalizeTrainingFrequencyInput(trainingPlanRow?.training_frequency ?? 3);
  const injuries = typeof trainingPlanRow?.injuries === "string" ? trainingPlanRow.injuries : "";
  const equipment = typeof trainingPlanRow?.equipment === "string" ? trainingPlanRow.equipment : "";

  const [hasAgeColumn, hasGenderColumn, hasGoalsJsonColumn] = await Promise.all([
    hasTableColumn(db, "user_profiles", "age"),
    hasTableColumn(db, "user_profiles", "gender"),
    hasTableColumn(db, "user_profiles", "goals_json"),
  ]);

  const columns = [
    "user_id",
    "username",
    "full_name",
    "initial_conditioning",
    "injuries",
    "equipment",
    "main_goal",
    "updated_at",
  ];
  const values: unknown[] = [
    user.id,
    username,
    fullName,
    conditioning,
    injuries,
    equipment,
    mainGoal,
  ];
  const placeholders = [
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    "?",
    "datetime('now')",
  ];

  if (hasAgeColumn) {
    columns.splice(columns.length - 1, 0, "age");
    placeholders.splice(placeholders.length - 1, 0, "NULL");
  }

  if (hasGenderColumn) {
    columns.splice(columns.length - 1, 0, "gender");
    placeholders.splice(placeholders.length - 1, 0, "NULL");
  }

  if (hasGoalsJsonColumn) {
    columns.splice(columns.length - 1, 0, "goals_json");
    placeholders.splice(placeholders.length - 1, 0, "?");
    values.push(JSON.stringify([mainGoal]));
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO user_profiles (${columns.join(", ")})
      VALUES (${placeholders.join(", ")})`,
    )
    .bind(...values)
    .run();

  const existingAttributes = await db
    .prepare("SELECT user_id FROM user_attributes WHERE user_id = ?")
    .bind(user.id)
    .first<{ user_id: string | null }>();

  if (!existingAttributes?.user_id) {
    const defaults = resolveDefaultAttributes(conditioning);
    await db
      .prepare(
        `INSERT INTO user_attributes (user_id, strength, constitution, vitality, dexterity, focus, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .bind(
        user.id,
        defaults.strength,
        defaults.constitution,
        defaults.vitality,
        defaults.dexterity,
        defaults.focus,
      )
      .run();
  }

  const existingProgression = await db
    .prepare("SELECT user_id FROM user_progression WHERE user_id = ?")
    .bind(user.id)
    .first<{ user_id: string | null }>();

  if (!existingProgression?.user_id) {
    await db
      .prepare(
        `INSERT INTO user_progression (user_id, xp, level, points, current_streak, best_streak, updated_at)
        VALUES (?, 0, 1, 0, 0, 0, datetime('now'))`,
      )
      .bind(user.id)
      .run();
  }

  const existingTrainingPlan = await db
    .prepare("SELECT user_id FROM user_training_plans WHERE user_id = ?")
    .bind(user.id)
    .first<{ user_id: string | null }>();

  if (!existingTrainingPlan?.user_id) {
    const plan = await buildInitialTrainingPlan(
      env,
      mainGoal,
      conditioning,
      equipment || null,
      injuries || null,
      trainingFrequency,
    );
    await upsertTrainingPlan(
      db,
      user.id,
      plan,
      mainGoal,
      conditioning,
      equipment || null,
      injuries || null,
      trainingFrequency,
    );
  }

  await ensureGoalStatsRow(db, user.id, mainGoal);

  return await db
    .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
    .bind(user.id)
    .first<Record<string, unknown>>();
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
    unlockAchievementIfNeeded,
    upsertTrainingPlan,
  }: ProfileRouteDeps,
): void {
  // Returns the editable user profile once onboarding has been completed.
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
      const [hasAttributes, hasProgression, hasTrainingPlan] = await Promise.all([
        c.env.fitloot_db
          .prepare("SELECT user_id FROM user_attributes WHERE user_id = ? LIMIT 1")
          .bind(user.id)
          .first<{ user_id: string | null }>(),
        c.env.fitloot_db
          .prepare("SELECT user_id FROM user_progression WHERE user_id = ? LIMIT 1")
          .bind(user.id)
          .first<{ user_id: string | null }>(),
        c.env.fitloot_db
          .prepare("SELECT user_id FROM user_training_plans WHERE user_id = ? LIMIT 1")
          .bind(user.id)
          .first<{ user_id: string | null }>(),
      ]);

      if (
        !profile ||
        !hasAttributes?.user_id ||
        !hasProgression?.user_id ||
        !hasTrainingPlan?.user_id
      ) {
        const recoveredProfile = await repairActivatedProfileState({
          db: c.env.fitloot_db,
          env: c.env,
          user,
          buildInitialTrainingPlan,
          ensureGoalStatsRow,
          normalizeConditioning,
          normalizeTrainingFrequencyInput,
          upsertTrainingPlan,
        });
        if (recoveredProfile) {
          console.warn("[/api/profile][recovered-missing-profile]", {
            userId: user.id,
          });
          return c.json(recoveredProfile);
        }

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
      .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
      .bind(user.id)
      .first();
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
