import type { ConditioningLevel } from "../../shared/types";

export type TrainingPlanChatPreferences = {
  planFocus: string | null;
  routineStyle: string | null;
  summary: string | null;
  constraints: string[];
  userRequest: string | null;
  updatedAt: string;
};

// Builds the default weekly training plan used by onboarding and plan refresh flows.
export async function buildInitialTrainingPlan(
  mainGoal: string | null | undefined,
  conditioning: ConditioningLevel,
  equipment: string | null | undefined,
  injuries: string | null | undefined,
) {
  const restDay = conditioning === "avancado" ? "domingo" : "quarta";
  const weekly = {
    segunda: {
      focus: "push",
      muscles: ["chest", "shoulders", "triceps"],
      intensity: "moderada",
    },
    terca: {
      focus: "legs",
      muscles: ["legs", "glutes", "core"],
      intensity: "moderada",
    },
    quarta: {
      focus: "active_recovery",
      muscles: ["full body", "core"],
      intensity: "leve",
    },
    quinta: {
      focus: "pull",
      muscles: ["back", "biceps", "core"],
      intensity: "moderada",
    },
    sexta: {
      focus: mainGoal === "calistenia" ? "skill" : "conditioning",
      muscles: ["full body"],
      intensity: "moderada",
    },
    sabado: {
      focus: "conditioning",
      muscles: ["full body", "core"],
      intensity: "moderada",
    },
    domingo: {
      focus: restDay === "domingo" ? "rest" : "optional",
      muscles: ["walk", "stretching"],
      intensity: "leve",
    },
  };

  return {
    goal: mainGoal ?? "saude_geral",
    conditioning,
    equipment: equipment ?? "",
    injuries: injuries ?? "",
    rest_days: [restDay],
    weekly,
    progression: "Primeiras 4 semanas com progressao linear de volume e tecnica.",
  };
}

// Parses the stored JSON plan payload while keeping the return shape narrow for callers.
export function parseStoredPlanRecord(
  rawValue: unknown,
): Record<string, unknown> | null {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeOptionalPlanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePlanConstraintList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 6);
}

// Normalizes the optional chat-driven training preferences stored inside the plan JSON.
export function normalizeTrainingPlanChatPreferences(
  value: unknown,
): TrainingPlanChatPreferences | null {
  const source =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  if (!source) return null;

  const planFocus = normalizeOptionalPlanText(
    source.plan_focus ?? source.planFocus,
  );
  const routineStyle = normalizeOptionalPlanText(
    source.routine_style ?? source.routineStyle,
  );
  const summary = normalizeOptionalPlanText(
    source.summary ??
      source.adjustment_summary ??
      source.adjustmentSummary,
  );
  const constraints = normalizePlanConstraintList(source.constraints);
  const userRequest = normalizeOptionalPlanText(
    source.user_request ?? source.userRequest,
  );
  const updatedAt =
    normalizeOptionalPlanText(source.updated_at ?? source.updatedAt) ??
    new Date().toISOString();

  if (
    !planFocus &&
    !routineStyle &&
    !summary &&
    constraints.length === 0 &&
    !userRequest
  ) {
    return null;
  }

  return {
    planFocus,
    routineStyle,
    summary,
    constraints,
    userRequest,
    updatedAt,
  };
}

// Serializes the normalized preferences back to the JSON shape already used in storage.
export function serializeTrainingPlanChatPreferences(
  preferences: TrainingPlanChatPreferences | null,
): Record<string, unknown> | null {
  if (!preferences) return null;
  return {
    plan_focus: preferences.planFocus,
    routine_style: preferences.routineStyle,
    summary: preferences.summary,
    constraints: preferences.constraints,
    user_request: preferences.userRequest,
    updated_at: preferences.updatedAt,
  };
}

// Builds a stable summary used by prompts, comparisons and idempotency checks.
export function summarizeTrainingPlanChatPreferences(
  preferences: TrainingPlanChatPreferences | null,
): string {
  if (!preferences) return "";

  const parts = [
    preferences.summary,
    preferences.planFocus ? `foco: ${preferences.planFocus}` : "",
    preferences.routineStyle ? `estilo: ${preferences.routineStyle}` : "",
    preferences.constraints.length > 0
      ? `diretrizes: ${preferences.constraints.join(", ")}`
      : "",
  ]
    .map((item) => item?.trim() ?? "")
    .filter(
      (item, index, array) =>
        item.length > 0 && array.indexOf(item) === index,
    );

  return parts.join(" | ");
}

export function trainingPlanChatPreferencesHash(
  preferences: TrainingPlanChatPreferences | null,
): string {
  return summarizeTrainingPlanChatPreferences(preferences)
    .split("|")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .join("|");
}

export function normalizeTrainingFrequencyInput(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 4;
  return Math.max(1, Math.min(7, Math.round(numeric)));
}

// Persists the training plan while preserving the current chat-preference contract.
export async function upsertTrainingPlan(
  db: D1Database,
  userId: string,
  plan: Record<string, unknown>,
  mainGoal: string | null,
  conditioning: ConditioningLevel,
  equipment: string | null,
  injuries: string | null,
  trainingFrequency: number | null | undefined,
): Promise<void> {
  const normalizedTrainingFrequency =
    normalizeTrainingFrequencyInput(trainingFrequency);
  const existingRow = await db
    .prepare(
      "SELECT weekly_plan_json FROM user_training_plans WHERE user_id = ?",
    )
    .bind(userId)
    .first<{ weekly_plan_json: string | null }>();
  const existingPlan = parseStoredPlanRecord(existingRow?.weekly_plan_json);
  const existingPreferences = normalizeTrainingPlanChatPreferences(
    existingPlan?.chat_preferences,
  );
  const hasIncomingPreferences = Object.prototype.hasOwnProperty.call(
    plan,
    "chat_preferences",
  );
  const incomingPreferences = normalizeTrainingPlanChatPreferences(
    plan.chat_preferences,
  );
  const planToStore: Record<string, unknown> = { ...plan };

  if (hasIncomingPreferences) {
    if (incomingPreferences) {
      planToStore.chat_preferences =
        serializeTrainingPlanChatPreferences(incomingPreferences);
    } else {
      delete planToStore.chat_preferences;
    }
  } else if (existingPreferences) {
    planToStore.chat_preferences =
      serializeTrainingPlanChatPreferences(existingPreferences);
  }

  await db
    .prepare(
      `INSERT INTO user_training_plans (
        user_id,
        main_goal,
        conditioning,
        training_frequency,
        equipment,
        injuries,
        weekly_plan_json,
        progression_notes,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        main_goal = excluded.main_goal,
        conditioning = excluded.conditioning,
        training_frequency = excluded.training_frequency,
        equipment = excluded.equipment,
        injuries = excluded.injuries,
        weekly_plan_json = excluded.weekly_plan_json,
        progression_notes = excluded.progression_notes,
        updated_at = datetime('now')`,
    )
    .bind(
      userId,
      mainGoal,
      conditioning,
      normalizedTrainingFrequency,
      equipment ?? "",
      injuries ?? "",
      JSON.stringify(planToStore),
      "progressao de base",
    )
    .run();
}
