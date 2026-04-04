import type { ConditioningLevel } from "../../shared/types";
import { hasTableColumn } from "../core/database";
import type { AuthUser, Env } from "../core/types";

type ActivatedProfileRecoveryDeps = {
  buildInitialTrainingPlan: (
    env: Env,
    mainGoal: string | null,
    conditioning: ConditioningLevel,
    equipment: string | null,
    injuries: string | null,
    trainingFrequency: number | null | undefined,
  ) => Promise<Record<string, unknown>>;
  ensureGoalStatsRow: (
    db: D1Database,
    userId: string,
    goal: string | null,
  ) => Promise<void>;
  normalizeConditioning: (value: unknown) => ConditioningLevel;
  normalizeTrainingFrequencyInput: (value: unknown) => number;
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
};

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

export function createActivatedProfileRecoveryService(
  deps: ActivatedProfileRecoveryDeps,
) {
  async function repairActivatedProfileState({
    db,
    env,
    user,
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
    const conditioning = deps.normalizeConditioning(trainingPlanRow?.conditioning ?? "iniciante");
    const mainGoal = typeof trainingPlanRow?.main_goal === "string" && trainingPlanRow.main_goal.trim().length > 0
      ? trainingPlanRow.main_goal.trim()
      : "saude_geral";
    const trainingFrequency = deps.normalizeTrainingFrequencyInput(trainingPlanRow?.training_frequency ?? 3);
    const injuries = typeof trainingPlanRow?.injuries === "string" ? trainingPlanRow.injuries : "";
    const equipment = typeof trainingPlanRow?.equipment === "string" ? trainingPlanRow.equipment : "";

    const isSupabaseDb =
      (db as D1Database & { __backend?: string }).__backend === "supabase";
    const [hasAgeColumn, hasGenderColumn, hasGoalsJsonColumn] = isSupabaseDb
      ? [true, true, true]
      : await Promise.all([
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
      const plan = await deps.buildInitialTrainingPlan(
        env,
        mainGoal,
        conditioning,
        equipment || null,
        injuries || null,
        trainingFrequency,
      );
      await deps.upsertTrainingPlan(
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

    await deps.ensureGoalStatsRow(db, user.id, mainGoal);

    return await db
      .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
      .bind(user.id)
      .first<Record<string, unknown>>();
  }

  return {
    repairActivatedProfileState,
  };
}
