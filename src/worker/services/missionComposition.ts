import type {
  CircuitTask,
  ConditioningLevel,
  MissionMetricType,
} from "../../shared/types";
import { repairKnownMojibakeString } from "../../shared/textEncoding";
import {
  inferMissionVisualTarget,
  localizeMissionText,
} from "../../shared/missionLocalization";
import {
  MISSION_LIMITS,
  formatMissionGoal,
  metricUnitByType,
  shouldShowMissionDuration,
} from "../../constants/missionMetrics";
import { sanitizeMissionExerciseNames } from "./missionExerciseSelection";

export type MissionPeriod = "daily" | "weekly" | "monthly";

export type MissionExerciseCategory =
  | "plank"
  | "isometric"
  | "walk"
  | "run"
  | "yoga"
  | "stretching"
  | "mobility"
  | "strength"
  | "abdominal"
  | "cardio_circuit"
  | "default";

export type MissionExerciseType =
  | "forca"
  | "cardio"
  | "flexibilidade"
  | "equilibrio";

export type MissionBodyArea = "upper" | "lower" | "core" | "full_body";

type MissionMetricPayloadLike = {
  description: string;
  instructions: string[];
  exercise_category: string;
  metric_type: MissionMetricType;
  metric_value: number;
  metric_unit: string;
  sets: number | null;
  rest_seconds: number | null;
  duration_estimate_minutes: number | null;
  circuit_tasks: CircuitTask[];
  target_reps: number | null;
  target_time: number | null;
};

type MissionConfig = {
  amount: number;
  xp: number;
  points: number;
  titlePrefix: string;
};

// Shared mission-composition helpers keep planning, persistence, and presentation aligned on the same rules.
function normalizeMatchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function futureIsoForPeriod(
  period: MissionPeriod,
  reference = new Date(),
): string {
  const date = new Date(reference);

  if (period === "daily") {
    date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  if (period === "weekly") {
    const day = date.getUTCDay();
    const shift = day === 0 ? 1 : 8 - day;
    date.setUTCDate(date.getUTCDate() + shift);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  date.setUTCMonth(date.getUTCMonth() + 1, 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export function normalizeExerciseCategory(
  name: string,
  muscle: string,
): MissionExerciseCategory {
  // Category inference is the base routing layer that decides how each exercise should be framed downstream.
  const text = `${name} ${muscle}`.toLowerCase();

  if (text.includes("plank") || text.includes("prancha")) return "plank";
  if (
    text.includes("hold") ||
    text.includes("isometric") ||
    text.includes("isometr")
  ) {
    return "isometric";
  }
  if (
    text.includes("walk") ||
    text.includes("caminha") ||
    text.includes("step")
  ) {
    return "walk";
  }
  if (
    text.includes("run") ||
    text.includes("corrid") ||
    text.includes("jog") ||
    text.includes("sprint") ||
    text.includes("cicl")
  ) {
    return "run";
  }
  if (text.includes("yoga") || text.includes("pose")) return "yoga";
  if (text.includes("stretch") || text.includes("along")) return "stretching";
  if (text.includes("mobility") || text.includes("mobilidade")) {
    return "mobility";
  }
  if (
    text.includes("circuit") ||
    text.includes("circuito") ||
    text.includes("hiit")
  ) {
    return "cardio_circuit";
  }
  if (
    text.includes("abdominal") ||
    text.includes("crunch") ||
    text.includes("situp") ||
    text.includes("sit-up") ||
    text.includes("sit up")
  ) {
    return "abdominal";
  }
  if (
    text.includes("push") ||
    text.includes("squat") ||
    text.includes("lunge") ||
    text.includes("pull") ||
    text.includes("press")
  ) {
    return "strength";
  }
  return "default";
}

export function inferExerciseType(
  category: MissionExerciseCategory,
): MissionExerciseType {
  if (
    category === "run" ||
    category === "walk" ||
    category === "cardio_circuit"
  ) {
    return "cardio";
  }
  if (
    category === "yoga" ||
    category === "stretching" ||
    category === "mobility"
  ) {
    return "flexibilidade";
  }
  if (category === "plank" || category === "isometric") return "equilibrio";
  return "forca";
}

export function inferBodyArea(muscle: string): MissionBodyArea {
  const value = muscle.toLowerCase();
  if (value.includes("core") || value.includes("abs")) return "core";
  if (
    value.includes("leg") ||
    value.includes("glute") ||
    value.includes("calf")
  ) {
    return "lower";
  }
  if (
    value.includes("chest") ||
    value.includes("back") ||
    value.includes("shoulder") ||
    value.includes("arm") ||
    value.includes("triceps") ||
    value.includes("biceps")
  ) {
    return "upper";
  }
  return "full_body";
}

export function inferAttributes(category: MissionExerciseCategory): string[] {
  if (category === "run" || category === "walk") {
    return ["resistencia", "cardio", "consistencia"];
  }
  if (
    category === "yoga" ||
    category === "stretching" ||
    category === "mobility"
  ) {
    return ["mobilidade", "flexibilidade", "controle"];
  }
  if (category === "plank" || category === "isometric") {
    return ["estabilidade", "core", "foco"];
  }
  if (category === "cardio_circuit") {
    return ["resistencia", "agilidade", "cardio"];
  }
  return ["forca", "resistencia", "potencia"];
}

export function missionConfigByPeriod(period: MissionPeriod): MissionConfig {
  if (period === "weekly") {
    return {
      amount: MISSION_LIMITS.weekly,
      xp: 170,
      points: 50,
      titlePrefix: "Missao Semanal",
    };
  }

  if (period === "monthly") {
    return {
      amount: MISSION_LIMITS.monthly,
      xp: 420,
      points: 130,
      titlePrefix: "Missao Mensal",
    };
  }

  return {
    amount: MISSION_LIMITS.daily,
    xp: 65,
    points: 14,
    titlePrefix: "Missao Diaria",
  };
}

export function metricValueByPeriod(
  metricType: MissionMetricType,
  period: MissionPeriod,
): number {
  const table: Record<MissionMetricType, Record<MissionPeriod, number>> = {
    repetitions: { daily: 30, weekly: 180, monthly: 680 },
    duration_seconds: { daily: 90, weekly: 480, monthly: 1800 },
    sets_reps: { daily: 36, weekly: 220, monthly: 760 },
    steps: { daily: 8000, weekly: 45000, monthly: 180000 },
    distance_meters: { daily: 2000, weekly: 12000, monthly: 50000 },
    duration_minutes: { daily: 15, weekly: 45, monthly: 180 },
    circuit_tasks: { daily: 3, weekly: 4, monthly: 5 },
  };
  return table[metricType][period];
}

function conditioningVolumeFactor(conditioning: ConditioningLevel): number {
  if (conditioning === "sedentario") return 0.6;
  if (conditioning === "iniciante") return 0.82;
  if (conditioning === "avancado") return 1.15;
  return 1;
}

export function conditionedMetricValue(
  metricType: MissionMetricType,
  period: MissionPeriod,
  conditioning: ConditioningLevel,
  volumeMultiplier: number,
): number {
  const base = metricValueByPeriod(metricType, period);
  const conditioned =
    base * conditioningVolumeFactor(conditioning) * volumeMultiplier;
  return Math.max(1, Math.round(conditioned));
}

export function missionCycleStartIso(
  period: MissionPeriod,
  reference = new Date(),
): string {
  const date = new Date(reference);

  if (period === "daily") {
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  if (period === "weekly") {
    const day = date.getUTCDay();
    const shift = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - shift);
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export function currentWeekKey(reference = new Date()): string {
  return missionCycleStartIso("weekly", reference).split("T")[0] ?? "";
}

export function fallbackExercisesByFocus(
  focus: string,
  muscles: string[],
): string[] {
  // Fallback exercise catalogs must stay anchored to the curated ExerciseDB-backed set.
  return sanitizeMissionExerciseNames({
    requestedNames: [],
    muscles,
    focus,
    limit: 6,
  });
}

export function uniqueExercises(
  entries: Array<{ name: string; muscle: string }>,
): Array<{ name: string; muscle: string }> {
  const output: Array<{ name: string; muscle: string }> = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = normalizeMatchText(entry.name);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

export function inferSets(
  metricType: MissionMetricType,
  period: MissionPeriod,
): number | null {
  if (metricType === "duration_seconds") {
    if (period === "daily") return 3;
    if (period === "weekly") return 6;
    return 10;
  }
  if (metricType === "sets_reps") {
    if (period === "daily") return 3;
    if (period === "weekly") return 5;
    return 8;
  }
  return null;
}

export function inferRestSeconds(metricType: MissionMetricType): number | null {
  if (metricType === "duration_seconds" || metricType === "sets_reps") {
    return 60;
  }
  return null;
}

export function isMissionMetricType(
  value: unknown,
): value is MissionMetricType {
  return (
    value === "repetitions" ||
    value === "duration_seconds" ||
    value === "sets_reps" ||
    value === "steps" ||
    value === "distance_meters" ||
    value === "duration_minutes" ||
    value === "circuit_tasks"
  );
}

export function estimateMissionDuration(
  metricType: MissionMetricType,
  metricValue: number,
): number {
  if (metricType === "duration_seconds") {
    return Math.max(3, Math.ceil(metricValue / 60));
  }

  if (metricType === "duration_minutes") {
    return Math.max(1, metricValue);
  }

  if (metricType === "circuit_tasks") {
    return 45;
  }

  return Math.max(8, Math.floor(metricValue / 4));
}

function normalizeMissionCopy(value: string): string {
  // Copy and circuit builders are reused by drafting, repair, and rendering flows to keep mission wording coherent.
  return repairKnownMojibakeString(localizeMissionText(value) ?? value)
    .replace(/\s+/g, " ")
    .trim();
}

function ensureSentence(value: string): string {
  const normalized = normalizeMissionCopy(value);
  if (normalized.length === 0) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

export function stripMissionTaskPrefix(value: string): string {
  return normalizeMissionCopy(value)
    .replace(/^Conclua\s+\d+\s+miss(?:\u00f5es|oes)\s+di[a\u00e1]rias\s+de\s+/i, "")
    .replace(/^Miss(?:\u00e3o|ao)\s+Di[a\u00e1]ria:\s+/i, "")
    .trim();
}

function missionStretchFocus(value: string): string {
  const target = inferMissionVisualTarget(value);
  if (target === "upper body") return "ombros, peito e costas";
  if (target === "legs") return "quadris, coxas e panturrilhas";
  if (target === "core") return "abd\u00f4men, lombar e quadris";
  if (target === "mobility") return "ombros, coluna, quadris e tornozelos";
  return "corpo inteiro";
}

export function buildStretchingTip(
  exerciseName: string,
  phase: "before" | "after",
): string {
  const focus = missionStretchFocus(exerciseName);
  if (phase === "before") {
    return ensureSentence(
      `Antes de come\u00e7ar, fa\u00e7a alongamento din\u00e2mico leve em ${focus} por 2 minutos para preparar o corpo`,
    );
  }
  return ensureSentence(
    `Ao finalizar, alongue ${focus} novamente e respire fundo para evitar dores musculares intensas`,
  );
}

export function wrapMissionInstructionsWithStretching(
  instructions: readonly string[],
  exerciseName: string,
): string[] {
  const warmup = buildStretchingTip(exerciseName, "before");
  const cooldown = buildStretchingTip(exerciseName, "after");
  const middle = instructions
    .map((item) => ensureSentence(item))
    .filter((item) => item.length > 0)
    .filter((item) => {
      const normalized = normalizeMatchText(item);
      return (
        normalized !== normalizeMatchText(warmup) &&
        normalized !== normalizeMatchText(cooldown)
      );
    });

  if (middle.length === 0) {
    middle.push(
      ensureSentence(
        `Execute ${exerciseName} com movimento controlado e respira\u00e7\u00e3o constante`,
      ),
    );
  }

  return [warmup, ...middle.slice(0, 4), cooldown];
}

function formatMissionRequirement(requiredCount: number, title: string): string {
  const missionName = stripMissionTaskPrefix(title);
  const countLabel = `${requiredCount} miss${
    requiredCount === 1 ? "\u00e3o" : "\u00f5es"
  } di\u00e1rias`;
  return `${countLabel} de ${missionName}`;
}

export function buildPeriodicMissionDescription(
  missionName: string,
  period: "weekly" | "monthly",
  requirements: ReadonlyArray<{ title: string; requiredCount: number }>,
): string {
  const periodLabel =
    period === "weekly" ? "nesta semana" : "ao longo deste m\u00eas";
  const requirementList = requirements
    .map((item) => formatMissionRequirement(item.requiredCount, item.title))
    .join(", ");
  const requirementSentence = ensureSentence(
    `Miss\u00f5es di\u00e1rias que comp\u00f5em ${normalizeMissionCopy(
      missionName,
    )} ${periodLabel}: ${requirementList}`,
  );
  const progressSentence = ensureSentence(
    "O progresso atualiza automaticamente sempre que uma miss\u00e3o di\u00e1ria compat\u00edvel for conclu\u00edda",
  );
  return [
    buildStretchingTip(missionName, "before"),
    requirementSentence,
    progressSentence,
    buildStretchingTip(missionName, "after"),
  ].join(" ");
}

export function buildMissionDescriptionFromInstructions(
  instructions: readonly string[],
  fallbackDescription: string,
): string {
  const normalized = instructions
    .map((item) => ensureSentence(item))
    .filter((item) => item.length > 0)
    .slice(0, 6);
  return normalized.length > 0 ? normalized.join(" ") : fallbackDescription;
}

export function buildCircuitTasks(
  exerciseName: string,
  period: MissionPeriod,
): CircuitTask[] {
  const normalizedName = normalizeMatchText(exerciseName);
  const baseRequired = period === "weekly" ? 5 : period === "monthly" ? 7 : 3;
  const fullBodyRequired = period === "weekly" ? 3 : baseRequired;

  const toTask = (
    missionType: string,
    exerciseLabel: string,
    requiredCount = baseRequired,
  ): CircuitTask => ({
    id: crypto.randomUUID(),
    label: `Conclua ${requiredCount} miss\u00f5es di\u00e1rias de ${exerciseLabel}`,
    mission_type: missionType,
    required_count: requiredCount,
    current_count: 0,
    completed: false,
  });

  if (
    normalizedName.includes("upper body") ||
    normalizedName.includes("parte superior")
  ) {
    return [
      toTask("push-up", "flex\u00e3o"),
      toTask("abdominal", "abdominal"),
      toTask("plank", "prancha"),
    ];
  }

  if (
    normalizedName.includes("lower body") ||
    normalizedName.includes("parte inferior")
  ) {
    return [
      toTask("squat", "agachamento"),
      toTask("lunge", "avan\u00e7o"),
      toTask("glute bridge", "ponte de gl\u00fateos"),
    ];
  }

  if (normalizedName.includes("core")) {
    return [
      toTask("abdominal", "abdominal"),
      toTask("plank", "prancha"),
      toTask("hollow body", "hollow body"),
    ];
  }

  if (
    normalizedName.includes("mobility") ||
    normalizedName.includes("recovery") ||
    normalizedName.includes("mobilidade") ||
    normalizedName.includes("recupera")
  ) {
    return [
      toTask("stretching", "alongamento"),
      toTask("walk", "caminhada"),
      toTask("yoga", "yoga"),
    ];
  }

  return [
    toTask("push-up", "flex\u00e3o", fullBodyRequired),
    toTask("squat", "agachamento", fullBodyRequired),
    toTask("abdominal", "abdominal", fullBodyRequired),
    toTask("plank", "prancha", fullBodyRequired),
  ];
}

export function buildMissionDescription(
  exerciseName: string,
  metricType: MissionMetricType,
  metricValue: number,
  sets: number | null,
  period: MissionPeriod = "daily",
): string {
  const goalText = formatMissionGoal(metricType, metricValue, sets ?? undefined);
  if (metricType === "circuit_tasks") {
    return buildPeriodicMissionDescription(
      exerciseName,
      period === "monthly" ? "monthly" : "weekly",
      buildCircuitTasks(exerciseName, period).map((task) => ({
        title: task.label,
        requiredCount: task.required_count,
      })),
    );
  }
  if (metricType === "duration_seconds" && sets) {
    const secondsPerSet = Math.max(10, Math.floor(metricValue / sets));
    return ensureSentence(
      `Fa\u00e7a ${sets} s\u00e9ries de ${exerciseName}, sustentando ${secondsPerSet} segundos por s\u00e9rie com alinhamento firme`,
    );
  }
  if (metricType === "sets_reps" && sets) {
    const repsPerSet = Math.max(4, Math.floor(metricValue / sets));
    return ensureSentence(
      `Execute ${sets} s\u00e9ries de ${repsPerSet} repeti\u00e7\u00f5es de ${exerciseName} com amplitude segura e cad\u00eancia controlada`,
    );
  }
  if (metricType === "steps") {
    return ensureSentence(
      `Some ${metricValue.toLocaleString(
        "pt-BR",
      )} passos no dia com caminhada ativa em ritmo confort\u00e1vel`,
    );
  }
  if (metricType === "distance_meters") {
    const km = (metricValue / 1000).toFixed(metricValue >= 1000 ? 1 : 0);
    return ensureSentence(
      `Cubra ${km} km de corrida ou trote sem perder a postura e o ritmo`,
    );
  }
  if (metricType === "duration_minutes") {
    return ensureSentence(
      `Treine ${exerciseName} por ${metricValue} minutos com movimentos controlados e respira\u00e7\u00e3o regular`,
    );
  }
  return ensureSentence(
    `Cumpra a meta de ${goalText} em ${exerciseName} com foco total na t\u00e9cnica`,
  );
}

export function buildMissionInstructions(
  exerciseName: string,
  metricType: MissionMetricType,
  sets: number | null,
  restSeconds: number | null,
  apiInstruction?: string | undefined,
): string[] {
  const instructions: string[] = [];

  if (metricType === "circuit_tasks") {
    return wrapMissionInstructionsWithStretching(
      [
        "Confira a lista de miss\u00f5es di\u00e1rias do circuito antes de iniciar a semana.",
        "Priorize as di\u00e1rias do mesmo grupo muscular para fazer o progresso subir mais r\u00e1pido.",
        "Acompanhe o contador de cada subtarefa e mantenha consist\u00eancia entre os dias de treino.",
        "As recompensas s\u00e3o liberadas automaticamente quando todas as subtarefas forem conclu\u00eddas.",
      ],
      exerciseName,
    );
  }

  if (apiInstruction) {
    instructions.push(apiInstruction.slice(0, 180));
  }

  instructions.push(
    `Ajuste a postura e organize o ritmo de execu\u00e7\u00e3o para ${exerciseName}.`,
  );

  if (
    metricType === "duration_seconds" ||
    metricType === "duration_minutes"
  ) {
    instructions.push(
      "Mantenha a respira\u00e7\u00e3o constante durante toda a execu\u00e7\u00e3o.",
    );
  }

  if (metricType === "sets_reps" || metricType === "repetitions") {
    instructions.push(
      "Execute cada repeti\u00e7\u00e3o com amplitude segura, sem perder o controle.",
    );
  }

  if (sets && restSeconds) {
    instructions.push(
      `Siga ${sets} s\u00e9ries com ${restSeconds} segundos de descanso entre elas.`,
    );
  }

  instructions.push(
    "Interrompa imediatamente se sentir dor aguda, tontura ou perda de estabilidade.",
  );
  return wrapMissionInstructionsWithStretching(instructions, exerciseName).slice(
    0,
    6,
  );
}

export function applyMissionMetricContext<
  TPayload extends MissionMetricPayloadLike,
>(
  payload: TPayload,
  period: MissionPeriod,
  exerciseName: string,
  desiredMetricType: MissionMetricType,
  desiredMetricValue: number,
  options?: {
    conditioning?: ConditioningLevel | undefined;
    volumeMultiplier?: number | undefined;
  },
): TPayload {
  // Applies the final metric payload shape expected by mission rows after all composition rules have run.
  const normalizedMetricType =
    period !== "weekly" && desiredMetricType === "circuit_tasks"
      ? "sets_reps"
      : desiredMetricType;
  const baselineMetricValue = options?.conditioning
    ? conditionedMetricValue(
        normalizedMetricType,
        period,
        options.conditioning,
        options.volumeMultiplier ?? 1,
      )
    : metricValueByPeriod(normalizedMetricType, period);
  const minValue = Math.max(1, Math.round(baselineMetricValue * 0.4));
  const maxValue = Math.max(minValue, Math.round(baselineMetricValue * 1.8));
  const normalizedMetricValue = Math.min(
    maxValue,
    Math.max(minValue, Math.round(desiredMetricValue)),
  );

  const sets =
    normalizedMetricType === "circuit_tasks"
      ? null
      : inferSets(normalizedMetricType, period);
  const restSeconds =
    normalizedMetricType === "circuit_tasks"
      ? null
      : inferRestSeconds(normalizedMetricType);
  const targetReps =
    normalizedMetricType === "duration_seconds" ||
    normalizedMetricType === "duration_minutes" ||
    normalizedMetricType === "circuit_tasks"
      ? null
      : normalizedMetricValue;
  const targetTime =
    normalizedMetricType === "duration_seconds"
      ? normalizedMetricValue
      : normalizedMetricType === "duration_minutes"
        ? normalizedMetricValue * 60
        : null;

  return {
    ...payload,
    metric_type: normalizedMetricType,
    metric_value: normalizedMetricValue,
    metric_unit: metricUnitByType(normalizedMetricType),
    sets,
    rest_seconds: restSeconds,
    description:
      normalizedMetricType === "circuit_tasks"
        ? payload.description
        : buildMissionDescriptionFromInstructions(
            wrapMissionInstructionsWithStretching(
              payload.instructions,
              exerciseName,
            ),
            buildMissionDescription(
              exerciseName,
              normalizedMetricType,
              normalizedMetricValue,
              sets,
            ),
          ),
    duration_estimate_minutes: shouldShowMissionDuration(period)
      ? estimateMissionDuration(normalizedMetricType, normalizedMetricValue)
      : null,
    circuit_tasks:
      normalizedMetricType === "circuit_tasks"
        ? buildCircuitTasks(exerciseName, period)
        : [],
    target_reps: targetReps,
    target_time: targetTime,
    exercise_category:
      normalizedMetricType === "circuit_tasks"
        ? "cardio_circuit"
        : payload.exercise_category,
  };
}

