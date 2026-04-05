import type { MissionMetricType } from "../shared/types";
import { resolveSupportedRouteMissionActivityKind } from "../shared/exerciseCatalog";

export const MISSION_LIMITS = {
  daily: 8,
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

const EXERCISE_METRIC_RULES: ReadonlyArray<{
  match: RegExp;
  type: MissionMetricType;
}> = [
  { match: /\bwalking[\s-]?lunge\b/, type: "sets_reps" },
  { match: /\bstep[\s-]?up\b/, type: "sets_reps" },
  { match: /\bmountain climber\b/, type: "sets_reps" },
  { match: /\bburpee\b/, type: "sets_reps" },
  { match: /\babdominal\b/, type: "sets_reps" },
  { match: /\bcrunch\b/, type: "sets_reps" },
  { match: /\bsit[\s-]?up\b/, type: "sets_reps" },
  { match: /\bplank\b/, type: "duration_seconds" },
  { match: /\bprancha\b/, type: "duration_seconds" },
  { match: /\bhollow body\b/, type: "duration_seconds" },
  { match: /\bwall sit\b/, type: "duration_seconds" },
  { match: /\bdead hang\b/, type: "duration_seconds" },
  { match: /\bl[\s-]?sit\b/, type: "duration_seconds" },
  { match: /\bcycling\b|\bciclismo\b/, type: "distance_meters" },
  { match: /\byoga\b/, type: "duration_minutes" },
  { match: /\bstretch(?:ing)?\b|\balongamento\b/, type: "duration_minutes" },
  { match: /\bmobility\b|\bmobilidade\b/, type: "duration_minutes" },
  { match: /\bpull[\s-]?up\b|\bbarra\b/, type: "sets_reps" },
  { match: /\bpush[\s-]?up\b|\bflexao\b/, type: "sets_reps" },
  { match: /\bsquat\b|\bagachamento\b/, type: "sets_reps" },
  { match: /\bfull body circuit\b/, type: "circuit_tasks" },
  { match: /\bupper body circuit\b/, type: "circuit_tasks" },
  { match: /\blower body circuit\b/, type: "circuit_tasks" },
  { match: /\bcore circuit\b/, type: "circuit_tasks" },
];

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function getMissionMetricType(exerciseName: string): MissionMetricType {
  const routeActivityKind = resolveSupportedRouteMissionActivityKind(exerciseName);
  if (routeActivityKind === "walking" || routeActivityKind === "running") {
    return "distance_meters";
  }

  const lower = normalizeText(exerciseName);
  for (const rule of EXERCISE_METRIC_RULES) {
    if (rule.match.test(lower)) return rule.type;
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
