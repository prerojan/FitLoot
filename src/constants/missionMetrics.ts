import type { MissionMetricType } from "@/shared/types";

export const MISSION_LIMITS = {
  daily: 5,
  weekly: 5,
  monthly: 5,
} as const;

export function shouldShowMissionDuration(missionType: string | null | undefined): boolean {
  return missionType === "daily";
}

export const WEEKLY_MISSION_KEYWORDS = [
  "full body",
  "corpo inteiro",
  "circuit",
  "circuito",
  "upper body circuit",
  "lower body circuit",
  "core circuit",
  "45 minutos",
  "40 minutos",
  "sessao completa",
] as const;

export const EXERCISE_METRIC_MAP: Record<string, MissionMetricType> = {
  plank: "duration_seconds",
  "hollow body": "duration_seconds",
  "wall sit": "duration_seconds",
  "dead hang": "duration_seconds",
  "l-sit": "duration_seconds",
  walk: "steps",
  caminhada: "steps",
  run: "distance_meters",
  corrida: "distance_meters",
  cycling: "distance_meters",
  yoga: "duration_minutes",
  stretching: "duration_minutes",
  alongamento: "duration_minutes",
  mobility: "duration_minutes",
  mobilidade: "duration_minutes",
  "pull-up": "sets_reps",
  barra: "sets_reps",
  "push-up": "sets_reps",
  flexao: "sets_reps",
  squat: "sets_reps",
  agachamento: "sets_reps",
  abdominal: "sets_reps",
  crunch: "sets_reps",
  "full body circuit": "circuit_tasks",
  "upper body circuit": "circuit_tasks",
  "lower body circuit": "circuit_tasks",
  "core circuit": "circuit_tasks",
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function getMissionMetricType(exerciseName: string): MissionMetricType {
  const lower = normalizeText(exerciseName);
  for (const [key, type] of Object.entries(EXERCISE_METRIC_MAP)) {
    if (lower.includes(normalizeText(key))) return type;
  }
  return "sets_reps";
}

export function classifyMission(title: string, durationMinutes?: number): "daily" | "weekly" {
  const lower = normalizeText(title);
  const isCircuit = WEEKLY_MISSION_KEYWORDS.some((keyword) => lower.includes(normalizeText(keyword)));
  const isLong = typeof durationMinutes === "number" && durationMinutes >= 30;
  return isCircuit || isLong ? "weekly" : "daily";
}

export function formatMissionGoal(metricType: MissionMetricType, value: number, sets?: number): string {
  switch (metricType) {
    case "repetitions":
      return sets ? `${sets} series de ${value} repeticoes` : `${value} repeticoes`;
    case "duration_seconds":
      return sets ? `${sets} series de ${value} segundos` : `${value} segundos`;
    case "duration_minutes":
      return `${value} minutos`;
    case "sets_reps":
      return `${sets ?? 3} series de ${value} repeticoes`;
    case "steps":
      return `${value.toLocaleString("pt-BR")} passos`;
    case "distance_meters":
      return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${value} metros`;
    case "circuit_tasks":
      return `${value} tarefas concluidas`;
    default:
      return `${value}`;
  }
}

export function metricUnitByType(metricType: MissionMetricType): string {
  switch (metricType) {
    case "duration_seconds":
      return "segundos";
    case "duration_minutes":
      return "minutos";
    case "steps":
      return "passos";
    case "distance_meters":
      return "metros";
    case "circuit_tasks":
      return "tarefas";
    default:
      return "repeticoes";
  }
}
