import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  OnboardingProfileSeedRequestSchema,
  OnboardingRequestSchema,
  type ConditioningLevel,
  type OnboardingProfileSeedRequest,
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
import type { WithTransaction } from "./contracts";

type OnboardingRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  buildInitialTrainingPlan: (
    env: Env,
    mainGoal: string | null,
    conditioning: ConditioningLevel,
    equipment: string | null,
    injuries: string | null,
    trainingFrequency: number | null | undefined,
  ) => Promise<Record<string, unknown>>;
  conditioningOrder: (conditioning: ConditioningLevel) => number;
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
  invalidateMissionListCache: (userId: string) => void;
  logUserEvent: (
    db: D1Database,
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  normalizeTrainingFrequencyInput: (value: unknown) => number;
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

type PersistedOnboardingSnapshot = {
  conditioning: ConditioningLevel;
  maxTier: number;
  primaryGoal: string;
  selectedGoals: string[];
  trainingFrequency: number;
};

type PersistOnboardingProfileStateParams = {
  env: Env;
  userId: string;
  data: OnboardingProfileSeedRequest;
  buildInitialTrainingPlan: OnboardingRouteDeps["buildInitialTrainingPlan"];
  conditioningOrder: OnboardingRouteDeps["conditioningOrder"];
  ensureGoalStatsRow: OnboardingRouteDeps["ensureGoalStatsRow"];
  ensureUserCounterRow: OnboardingRouteDeps["ensureUserCounterRow"];
  evaluateLevelTitles: OnboardingRouteDeps["evaluateLevelTitles"];
  logUserEvent: OnboardingRouteDeps["logUserEvent"];
  normalizeTrainingFrequencyInput: OnboardingRouteDeps["normalizeTrainingFrequencyInput"];
  skillTierOrder: OnboardingRouteDeps["skillTierOrder"];
  upsertTrainingPlan: OnboardingRouteDeps["upsertTrainingPlan"];
};

async function persistOnboardingProfileState({
  env,
  userId,
  data,
  buildInitialTrainingPlan,
  conditioningOrder,
  ensureGoalStatsRow,
  ensureUserCounterRow,
  evaluateLevelTitles,
  logUserEvent,
  normalizeTrainingFrequencyInput,
  skillTierOrder,
  upsertTrainingPlan,
}: PersistOnboardingProfileStateParams): Promise<PersistedOnboardingSnapshot> {
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
    throw new Error("INVALID_IDENTITY_DATA");
  }

  const existingUsername = await env.fitloot_db
    .prepare(
      "SELECT user_id FROM user_profiles WHERE username = ? LIMIT 1",
    )
    .bind(username)
    .first<{ user_id: string | null }>();

  if (existingUsername?.user_id && existingUsername.user_id !== userId) {
    throw new Error("USERNAME_ALREADY_TAKEN");
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
    hasTableColumn(env.fitloot_db, "user_profiles", "initial_pushups"),
    hasTableColumn(env.fitloot_db, "user_profiles", "initial_situps"),
    hasTableColumn(env.fitloot_db, "user_profiles", "initial_squats"),
  ]);

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
    userId,
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

  await env.fitloot_db
    .prepare(
      `INSERT INTO user_profiles (${profileColumns.join(", ")})
       VALUES (${profilePlaceholders.join(", ")})
       ON CONFLICT(user_id) DO UPDATE SET ${profileUpdates.join(", ")}`,
    )
    .bind(...profileValues)
    .run();

  await env.fitloot_db
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
      userId,
      initialAttrs.strength,
      initialAttrs.constitution,
      initialAttrs.vitality,
      initialAttrs.dexterity,
      initialAttrs.focus,
    )
    .run();

  await env.fitloot_db
    .prepare(
      `INSERT OR IGNORE INTO user_progression (user_id, xp, level, points, current_streak, best_streak, updated_at)
      VALUES (?, 0, 1, 0, 0, 0, datetime('now'))`,
    )
    .bind(userId)
    .run();

  const initialSkills = await env.fitloot_db
    .prepare("SELECT id, tier, level_required FROM skills")
    .all<{ id: number; tier: string; level_required: number }>();

  for (const skill of initialSkills.results) {
    if (
      skillTierOrder(skill.tier) <= Math.max(1, maxTier) &&
      Number(skill.level_required ?? 1) <= 1
    ) {
      await env.fitloot_db
        .prepare(
          `INSERT OR IGNORE INTO user_skills (user_id, skill_id, status, current_stage, total_reps, total_time, best_reps, unlocked_at, updated_at)
          VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`,
        )
        .bind(userId, skill.id)
        .run();
    }
  }

  const plan = await buildInitialTrainingPlan(
    env,
    primaryGoal,
    conditioning,
    data.equipment ?? null,
    data.injuries ?? null,
    trainingFrequency,
  );
  await upsertTrainingPlan(
    env.fitloot_db,
    userId,
    plan,
    primaryGoal,
    conditioning,
    data.equipment ?? null,
    data.injuries ?? null,
    trainingFrequency,
  );

  await ensureGoalStatsRow(env.fitloot_db, userId, primaryGoal);
  await ensureUserCounterRow(env.fitloot_db, userId);
  await logUserEvent(env.fitloot_db, userId, "onboarding_profile_seeded", {
    conditioning,
    main_goal: primaryGoal,
    goals: selectedGoals,
    training_frequency: trainingFrequency,
  });
  await evaluateLevelTitles(env.fitloot_db, userId, 1);

  return {
    conditioning,
    maxTier,
    primaryGoal,
    selectedGoals,
    trainingFrequency,
  };
}

function respondOnboardingPersistenceError(
  c: import("hono").Context<AppContext>,
  error: unknown,
) {
  const message = getErrorMessage(error);
  if (message === "INVALID_IDENTITY_DATA") {
    return c.json({ error: "Dados de identidade inválidos" }, 400);
  }
  if (message === "USERNAME_ALREADY_TAKEN") {
    return c.json({ error: "Username already taken" }, 400);
  }
  if (isMissingSchemaError(error)) {
    return schemaMismatchResponse(c);
  }

  return null;
}

// Registers the onboarding pipeline that persists profile state, training plans, and checkout intent.
export function registerOnboardingRoutes(
  app: Hono<AppContext>,
  {
    authMiddleware,
    buildInitialTrainingPlan,
    conditioningOrder,
    ensureGamificationCatalog,
    ensureGoalStatsRow,
    ensurePeriodicMissions,
    ensureUserCounterRow,
    evaluateLevelTitles,
    invalidateMissionListCache,
    logUserEvent,
    normalizeTrainingFrequencyInput,
    startCheckoutForUser,
    skillTierOrder,
    upsertTrainingPlan,
    withTransaction,
  }: OnboardingRouteDeps,
): void {
  app.post(
    "/api/onboarding/profile",
    authMiddleware,
    zValidator("json", OnboardingProfileSeedRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const data = c.req.valid("json");
      await ensureGamificationCatalog(c.env.fitloot_db);

      try {
        await withTransaction(c.env.fitloot_db, async () => {
          await persistOnboardingProfileState({
            env: c.env,
            userId: user.id,
            data,
            buildInitialTrainingPlan,
            conditioningOrder,
            ensureGoalStatsRow,
            ensureUserCounterRow,
            evaluateLevelTitles,
            logUserEvent,
            normalizeTrainingFrequencyInput,
            skillTierOrder,
            upsertTrainingPlan,
          });
        }, c.env);
      } catch (error) {
        const handled = respondOnboardingPersistenceError(c, error);
        if (handled) return handled;
        throw error;
      }

      return c.json({ success: true, onboarding_ready: true }, 200);
    },
  );

  // Completes the onboarding submission and seeds the first mission-capable user state.
  app.post(
    "/api/onboarding",
    authMiddleware,
    zValidator("json", OnboardingRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const data = c.req.valid("json");
      await ensureGamificationCatalog(c.env.fitloot_db);

      let checkoutResult: CheckoutStartResult | undefined;
      try {
        let onboardingSnapshot: PersistedOnboardingSnapshot | null = null;

        await withTransaction(c.env.fitloot_db, async () => {
          onboardingSnapshot = await persistOnboardingProfileState({
            env: c.env,
            userId: user.id,
            data,
            buildInitialTrainingPlan,
            conditioningOrder,
            ensureGoalStatsRow,
            ensureUserCounterRow,
            evaluateLevelTitles,
            logUserEvent,
            normalizeTrainingFrequencyInput,
            skillTierOrder,
            upsertTrainingPlan,
          });

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

          if (!onboardingSnapshot) {
            throw new Error("ONBOARDING_SNAPSHOT_MISSING");
          }

          await logUserEvent(c.env.fitloot_db, user.id, "onboarding_submitted", {
            conditioning: onboardingSnapshot.conditioning,
            main_goal: onboardingSnapshot.primaryGoal,
            goals: onboardingSnapshot.selectedGoals,
            training_frequency: onboardingSnapshot.trainingFrequency,
            plan_id: checkoutResult.plan_id,
            plan_status: checkoutResult.plan_status,
            amount: checkoutResult.amount,
          });
        }, c.env);
      } catch (error) {
        const handled = respondOnboardingPersistenceError(c, error);
        if (handled) return handled;
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
