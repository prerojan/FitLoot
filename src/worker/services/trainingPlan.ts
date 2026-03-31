import type { ConditioningLevel } from "../../shared/types";
import type { Env } from "../core/types";
import { rapidRequestJson, resolveRapidApiKey } from "./rapidApi";

export type TrainingPlanChatPreferences = {
  planFocus: string | null;
  routineStyle: string | null;
  summary: string | null;
  constraints: string[];
  userRequest: string | null;
  updatedAt: string;
};

type TrainingPlanWeekday =
  | "segunda"
  | "terca"
  | "quarta"
  | "quinta"
  | "sexta"
  | "sabado"
  | "domingo";

type TrainingPlanWeekdayConfig = {
  focus: string;
  muscles: string[];
  intensity: string;
  exercises: string[];
  rest_day?: boolean | undefined;
};

type TrainingPlanWeekly = Record<TrainingPlanWeekday, TrainingPlanWeekdayConfig>;

type RapidWorkoutPlannerExercise = {
  name?: string | undefined;
  duration?: string | undefined;
  repetitions?: string | undefined;
  sets?: string | undefined;
  equipment?: string | undefined;
};

type RapidWorkoutPlannerDay = {
  day?: string | undefined;
  exercises?: RapidWorkoutPlannerExercise[] | undefined;
};

type RapidWorkoutPlannerResponse = {
  result?: {
    exercises?: RapidWorkoutPlannerDay[] | undefined;
    total_weeks?: number | undefined;
  } | undefined;
};

const RAPID_WORKOUT_PLANNER_HOST =
  "ai-workout-planner-exercise-fitness-nutrition-guide.p.rapidapi.com";
const RAPID_WORKOUT_PLANNER_TIMEOUT_MS = 8_500;
const TRAINING_PLAN_WEEKDAY_ORDER: TrainingPlanWeekday[] = [
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo",
];

function resolveStaticSessionDurationMinutes(
  conditioning: ConditioningLevel,
  trainingFrequency: number,
): number {
  const baseDurationByConditioning: Record<ConditioningLevel, number> = {
    sedentario: 30,
    iniciante: 40,
    intermediario: 55,
    avancado: 70,
  };
  const baseDuration = baseDurationByConditioning[conditioning] ?? 45;
  const frequencyAdjustment =
    trainingFrequency >= 5 ? -5 : trainingFrequency <= 2 ? 5 : 0;
  return Math.max(25, Math.min(90, baseDuration + frequencyAdjustment));
}

function buildStaticWeeklyPlan(mainGoal: string | null | undefined): TrainingPlanWeekly {
  return {
    segunda: {
      focus: "push",
      muscles: ["chest", "shoulders", "triceps"],
      intensity: "moderada",
      exercises: ["Push-up", "Bench Dip", "Shoulder Press"],
    },
    terca: {
      focus: "legs",
      muscles: ["legs", "glutes", "core"],
      intensity: "moderada",
      exercises: ["Air Squat", "Reverse Lunge", "Glute Bridge"],
    },
    quarta: {
      focus: "active_recovery",
      muscles: ["full body", "core"],
      intensity: "leve",
      exercises: ["Walking", "Mobility Flow", "Stretching"],
      rest_day: true,
    },
    quinta: {
      focus: "pull",
      muscles: ["back", "biceps", "core"],
      intensity: "moderada",
      exercises: ["Resistance Band Row", "Inverted Row", "Superman"],
    },
    sexta: {
      focus: mainGoal === "calistenia" ? "skill" : "conditioning",
      muscles: ["full body"],
      intensity: "moderada",
      exercises:
        mainGoal === "calistenia"
          ? ["Plank", "Hollow Body Hold", "Scapular Pull-up"]
          : ["Jumping Jack", "Mountain Climber", "Burpee"],
    },
    sabado: {
      focus: "conditioning",
      muscles: ["full body", "core"],
      intensity: "moderada",
      exercises: ["Bodyweight Circuit", "Jump Rope", "Walking"],
    },
    domingo: {
      focus: "rest",
      muscles: ["walk", "stretching"],
      intensity: "leve",
      exercises: ["Walking", "Stretching"],
      rest_day: true,
    },
  };
}

function buildStaticInitialTrainingPlan(
  mainGoal: string | null | undefined,
  conditioning: ConditioningLevel,
  equipment: string | null | undefined,
  injuries: string | null | undefined,
) {
  const weekly = buildStaticWeeklyPlan(mainGoal);
  const restDays = TRAINING_PLAN_WEEKDAY_ORDER.filter(
    (day) => weekly[day].rest_day === true,
  );

  return {
    goal: mainGoal ?? "saude_geral",
    conditioning,
    equipment: equipment ?? "",
    injuries: injuries ?? "",
    source_provider: "fitloot-static",
    rest_days: restDays,
    weekly,
    progression:
      "Primeiras 4 semanas com progressao linear de volume e tecnica.",
  };
}

function parseDelimitedValues(value: string | null | undefined): string[] {
  if (typeof value !== "string" || value.trim().length === 0) return [];
  return value
    .split(/[,;\n|/]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function mapMainGoalToRapidGoal(mainGoal: string | null | undefined): string {
  switch (mainGoal) {
    case "perder_peso":
      return "Lose weight";
    case "ganhar_massa":
      return "Build muscle";
    case "resistencia":
      return "Improve endurance";
    case "calistenia":
      return "Build bodyweight strength";
    case "saude_geral":
    default:
      return "Improve overall wellness";
  }
}

function mapConditioningToRapidFitnessLevel(
  conditioning: ConditioningLevel,
): string {
  switch (conditioning) {
    case "intermediario":
      return "Intermediate";
    case "avancado":
      return "Advanced";
    case "sedentario":
    case "iniciante":
    default:
      return "Beginner";
  }
}

function buildRapidWorkoutPreferences(
  mainGoal: string | null | undefined,
  equipment: string | null | undefined,
): string[] {
  const normalizedEquipment = parseDelimitedValues(equipment).map((entry) =>
    entry.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(),
  );
  const preferences = new Set<string>();

  if (mainGoal === "calistenia") {
    preferences.add("Calisthenics");
    preferences.add("Bodyweight training");
  } else if (mainGoal === "ganhar_massa") {
    preferences.add("Strength training");
  } else if (mainGoal === "perder_peso") {
    preferences.add("Cardio");
    preferences.add("Fat loss workouts");
  } else if (mainGoal === "resistencia") {
    preferences.add("Cardio");
    preferences.add("Endurance training");
  } else {
    preferences.add("Functional fitness");
  }

  if (normalizedEquipment.some((entry) => entry.includes("halter"))) {
    preferences.add("Dumbbell training");
  }
  if (
    normalizedEquipment.some(
      (entry) => entry.includes("barra") || entry.includes("anilha"),
    )
  ) {
    preferences.add("Weight training");
  }
  if (normalizedEquipment.some((entry) => entry.includes("corda"))) {
    preferences.add("Cardio");
  }
  if (normalizedEquipment.some((entry) => entry.includes("elast"))) {
    preferences.add("Resistance bands");
  }
  if (normalizedEquipment.some((entry) => entry.includes("kettlebell"))) {
    preferences.add("Kettlebell training");
  }

  if (preferences.size === 0) {
    preferences.add("Bodyweight training");
  }

  return Array.from(preferences).slice(0, 6);
}

function buildRapidHealthConditions(
  injuries: string | null | undefined,
): string[] {
  const conditions = parseDelimitedValues(injuries);
  return conditions.length > 0 ? conditions.slice(0, 6) : ["None"];
}

function resolveRapidDayToWeekday(
  rawDay: string | null | undefined,
  fallbackIndex: number,
): TrainingPlanWeekday | null {
  const normalizedDay =
    typeof rawDay === "string"
      ? rawDay
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .trim()
          .toLowerCase()
      : "";

  const byName = new Map<string, TrainingPlanWeekday>([
    ["monday", "segunda"],
    ["mon", "segunda"],
    ["segunda", "segunda"],
    ["tuesday", "terca"],
    ["tue", "terca"],
    ["terca", "terca"],
    ["wednesday", "quarta"],
    ["wed", "quarta"],
    ["quarta", "quarta"],
    ["thursday", "quinta"],
    ["thu", "quinta"],
    ["quinta", "quinta"],
    ["friday", "sexta"],
    ["fri", "sexta"],
    ["sexta", "sexta"],
    ["saturday", "sabado"],
    ["sat", "sabado"],
    ["sabado", "sabado"],
    ["sunday", "domingo"],
    ["sun", "domingo"],
    ["domingo", "domingo"],
  ]);

  if (normalizedDay.length > 0 && byName.has(normalizedDay)) {
    return byName.get(normalizedDay) ?? null;
  }

  return TRAINING_PLAN_WEEKDAY_ORDER[fallbackIndex] ?? null;
}

function normalizeRapidExerciseName(
  exercise: RapidWorkoutPlannerExercise,
): string | null {
  const name =
    typeof exercise.name === "string" ? exercise.name.trim() : "";
  return name.length > 0 ? name : null;
}

function resolveFocusFromRapidExercises(
  exerciseNames: string[],
  fallbackFocus: string,
): string {
  const scoringRules: Array<{ focus: string; keywords: string[] }> = [
    {
      focus: "push",
      keywords: [
        "push",
        "bench",
        "press",
        "chest",
        "shoulder",
        "tricep",
        "dip",
      ],
    },
    {
      focus: "pull",
      keywords: ["row", "pull", "lat", "back", "bicep", "chin-up"],
    },
    {
      focus: "legs",
      keywords: [
        "squat",
        "lunge",
        "leg",
        "glute",
        "deadlift",
        "calf",
      ],
    },
    {
      focus: "core",
      keywords: ["plank", "crunch", "sit-up", "abs", "core", "hollow"],
    },
    {
      focus: "conditioning",
      keywords: [
        "run",
        "cardio",
        "burpee",
        "jump",
        "cycling",
        "rope",
        "mountain climber",
      ],
    },
    {
      focus: "active_recovery",
      keywords: ["stretch", "mobility", "recovery", "walk", "yoga"],
    },
  ];

  const scores = new Map<string, number>();
  for (const exerciseName of exerciseNames) {
    const normalizedName = exerciseName
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    for (const rule of scoringRules) {
      for (const keyword of rule.keywords) {
        if (!normalizedName.includes(keyword)) continue;
        scores.set(rule.focus, (scores.get(rule.focus) ?? 0) + 1);
      }
    }
  }

  const rankedFocus = Array.from(scores.entries()).sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
  return rankedFocus ?? fallbackFocus;
}

function resolveMusclesForFocus(focus: string): string[] {
  switch (focus) {
    case "push":
      return ["chest", "shoulders", "triceps"];
    case "pull":
      return ["back", "biceps", "core"];
    case "legs":
      return ["legs", "glutes", "core"];
    case "core":
      return ["core", "abs", "hip flexors"];
    case "active_recovery":
      return ["full body", "mobility"];
    case "rest":
      return ["walk", "stretching"];
    case "conditioning":
    case "skill":
    case "optional":
    default:
      return ["full body", "core"];
  }
}

function resolveIntensityForFocus(
  focus: string,
  conditioning: ConditioningLevel,
): string {
  if (focus === "rest" || focus === "active_recovery") {
    return "leve";
  }
  if (conditioning === "avancado") {
    return focus === "conditioning" ? "alta" : "moderada";
  }
  if (conditioning === "intermediario") {
    return "moderada";
  }
  return focus === "conditioning" ? "moderada" : "leve";
}

async function buildRapidInitialTrainingPlan(
  env: Pick<Env, "RAPID_API_KEY">,
  mainGoal: string | null | undefined,
  conditioning: ConditioningLevel,
  equipment: string | null | undefined,
  injuries: string | null | undefined,
  trainingFrequency: number | null | undefined,
  staticPlan: ReturnType<typeof buildStaticInitialTrainingPlan>,
): Promise<Record<string, unknown> | null> {
  if (!resolveRapidApiKey(env)) return null;

  const normalizedTrainingFrequency =
    normalizeTrainingFrequencyInput(trainingFrequency);
  const payload = await rapidRequestJson<RapidWorkoutPlannerResponse>(
    `https://${RAPID_WORKOUT_PLANNER_HOST}/generateWorkoutPlan`,
    RAPID_WORKOUT_PLANNER_HOST,
    env,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: mapMainGoalToRapidGoal(mainGoal),
        fitness_level: mapConditioningToRapidFitnessLevel(conditioning),
        preferences: buildRapidWorkoutPreferences(mainGoal, equipment),
        health_conditions: buildRapidHealthConditions(injuries),
        schedule: {
          days_per_week: normalizedTrainingFrequency,
          session_duration: resolveStaticSessionDurationMinutes(
            conditioning,
            normalizedTrainingFrequency,
          ),
        },
        plan_duration_weeks: 4,
        lang: "en",
      }),
    },
    RAPID_WORKOUT_PLANNER_TIMEOUT_MS,
  );

  const rapidDays = Array.isArray(payload.result?.exercises)
    ? payload.result?.exercises
    : [];
  if (rapidDays.length === 0) {
    return null;
  }

  const weekly = { ...staticPlan.weekly } as TrainingPlanWeekly;
  const touchedWeekdays = new Set<TrainingPlanWeekday>();

  for (const [index, rapidDay] of rapidDays.entries()) {
    const weekday = resolveRapidDayToWeekday(rapidDay.day, index);
    if (!weekday) continue;

    const exerciseNames = (Array.isArray(rapidDay.exercises)
      ? rapidDay.exercises
      : []
    )
      .map((exercise) => normalizeRapidExerciseName(exercise))
      .filter((exerciseName): exerciseName is string => Boolean(exerciseName));

    if (exerciseNames.length === 0) {
      weekly[weekday] = {
        focus: "rest",
        muscles: ["walk", "stretching"],
        intensity: "leve",
        exercises: ["Walking", "Stretching"],
        rest_day: true,
      };
      touchedWeekdays.add(weekday);
      continue;
    }

    const fallbackFocus = weekly[weekday]?.focus ?? "conditioning";
    const focus = resolveFocusFromRapidExercises(exerciseNames, fallbackFocus);
    weekly[weekday] = {
      focus,
      muscles: resolveMusclesForFocus(focus),
      intensity: resolveIntensityForFocus(focus, conditioning),
      exercises: exerciseNames.slice(0, 8),
      rest_day: focus === "rest" || focus === "active_recovery",
    };
    touchedWeekdays.add(weekday);
  }

  if (touchedWeekdays.size === 0) {
    return null;
  }

  for (const weekday of TRAINING_PLAN_WEEKDAY_ORDER) {
    if (touchedWeekdays.has(weekday)) continue;
    weekly[weekday] = {
      focus: "rest",
      muscles: ["walk", "stretching"],
      intensity: "leve",
      exercises: ["Walking", "Stretching"],
      rest_day: true,
    };
  }

  const restDays = TRAINING_PLAN_WEEKDAY_ORDER.filter(
    (weekday) => weekly[weekday].rest_day === true,
  );

  return {
    goal: mainGoal ?? "saude_geral",
    conditioning,
    equipment: equipment ?? "",
    injuries: injuries ?? "",
    source_provider: "ai-workout-planner",
    source_language: "en",
    source_total_weeks: Number(payload.result?.total_weeks ?? 4),
    rest_days: restDays,
    weekly,
    progression:
      "Plano inicial gerado com a RapidAPI AI Workout Planner e complementado pelo mapeamento interno do FitLoot.",
  };
}

// Builds the default weekly training plan used by onboarding and plan refresh flows.
export async function buildInitialTrainingPlan(
  env: Pick<Env, "RAPID_API_KEY">,
  mainGoal: string | null | undefined,
  conditioning: ConditioningLevel,
  equipment: string | null | undefined,
  injuries: string | null | undefined,
  trainingFrequency?: number | null | undefined,
) {
  const staticPlan = buildStaticInitialTrainingPlan(
    mainGoal,
    conditioning,
    equipment,
    injuries,
  );

  try {
    const rapidPlan = await buildRapidInitialTrainingPlan(
      env,
      mainGoal,
      conditioning,
      equipment,
      injuries,
      trainingFrequency,
      staticPlan,
    );
    return rapidPlan ?? staticPlan;
  } catch (error) {
    console.warn("[training-plan][rapid-fallback]", {
      message: error instanceof Error ? error.message : String(error),
    });
    return staticPlan;
  }
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
