import { formatMissionGoal } from "@/constants/missionMetrics";
import { STEP_MISSION_PROGRESS_STORAGE_PREFIX } from "@/react-app/constants/storage";
import type { Mission, MissionMetricType } from "@/shared/types";

export const MATERIAL_SYMBOLS_LINK_ID = "fitloot-material-symbols";
export const MATERIAL_SYMBOLS_HREF =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,500,0,0";
export const STEPS_TARGET = 15000;

export const DESKTOP_NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", path: "/dashboard", matches: ["/dashboard", "/home", "/ai-chat", "/food-analysis"] },
  { id: "arena", label: "Arena", icon: "swords", path: "/minigames", matches: ["/minigames", "/friends"] },
  { id: "ranking", label: "Ranking", icon: "leaderboard", path: "/ranking", matches: ["/ranking"] },

  { id: "shop", label: "Loja", icon: "storefront", path: "/shop", matches: ["/shop"] },
  { id: "profile", label: "Perfil", icon: "person", path: "/profile", matches: ["/profile"] },
] as const;

export const PANEL_STYLE = {
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--fl-color-text) 5%, transparent), transparent 24%), color-mix(in srgb, var(--fl-surface-strong) 96%, transparent)",
  border: "1px solid var(--fl-border-soft)",
  boxShadow: "var(--fl-shadow-glass)",
};

export const SUBTLE_PANEL_STYLE = {
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--fl-color-text) 4%, transparent), transparent 28%), color-mix(in srgb, var(--fl-surface-muted) 92%, transparent)",
  border: "1px solid var(--fl-border-soft)",
};

export const PRIMARY_GLOW_STYLE = {
  background: "var(--app-primary-color)",
  color: "var(--fl-nav-item-active-text)",
  boxShadow: "0 24px 52px color-mix(in srgb, var(--app-primary-color) 28%, transparent)",
};

export type StepMissionSnapshot = {
  signature: string;
  stepsAtSnapshot: number;
  progressByMissionId: Record<number, number>;
};

export type PersistentStepMissionProgressEntry = {
  metricsDate: string;
  lastDailySteps: number;
  progressValue: number;
};

export type PersistentStepMissionProgressState = Record<
  number,
  PersistentStepMissionProgressEntry
>;

type ReconcilePersistentStepMissionProgressParams = {
  missions: Mission[];
  metricsDate: string;
  stepsValue: number;
  state: PersistentStepMissionProgressState;
};

export function ensureMaterialSymbolsLoaded() {
  if (typeof document === "undefined") return;
  if (document.getElementById(MATERIAL_SYMBOLS_LINK_ID)) return;

  const link = document.createElement("link");
  link.id = MATERIAL_SYMBOLS_LINK_ID;
  link.rel = "stylesheet";
  link.href = MATERIAL_SYMBOLS_HREF;
  document.head.appendChild(link);
}

export function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function persistentStepMissionProgressStorageKey(
  userId: string | null | undefined,
): string | null {
  if (typeof userId !== "string" || userId.trim().length === 0) {
    return null;
  }
  return `${STEP_MISSION_PROGRESS_STORAGE_PREFIX}:${userId.trim()}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function bodyAreaLabel(bodyArea: Mission["body_area"]): string {
  if (bodyArea === "upper") return "Parte superior";
  if (bodyArea === "lower") return "Parte inferior";
  if (bodyArea === "core") return "Core";
  return "Corpo inteiro";
}

export function normalizeMetricType(mission: Mission): MissionMetricType {
  if (
    mission.metric_type === "repetitions" ||
    mission.metric_type === "duration_seconds" ||
    mission.metric_type === "sets_reps" ||
    mission.metric_type === "steps" ||
    mission.metric_type === "distance_meters" ||
    mission.metric_type === "duration_minutes" ||
    mission.metric_type === "circuit_tasks"
  ) {
    return mission.metric_type;
  }

  if ((mission.target_time ?? 0) > 0) return "duration_seconds";
  return "sets_reps";
}

export function missionTotalGoal(mission: Mission, metricType: MissionMetricType): number {
  if (metricType === "circuit_tasks") {
    const tasks = Array.isArray(mission.circuit_tasks) ? mission.circuit_tasks.length : 0;
    return tasks > 0 ? tasks : Math.max(1, Number(mission.metric_value ?? 1));
  }

  if (typeof mission.metric_value === "number" && mission.metric_value > 0) {
    return mission.metric_value;
  }

  if (metricType === "duration_seconds" || metricType === "duration_minutes") {
    return Math.max(1, Number(mission.target_time ?? 0));
  }

  return Math.max(1, Number(mission.target_reps ?? 1));
}

export function formatMissionGoalLabel(mission: Mission): string {
  const metricType = normalizeMetricType(mission);
  const goal = missionTotalGoal(mission, metricType);
  const sets = mission.sets ?? undefined;

  if (metricType === "duration_seconds" && sets && sets > 0) {
    return formatMissionGoal(metricType, Math.max(1, Math.floor(goal / sets)), sets);
  }

  if (metricType === "sets_reps" && sets && sets > 0) {
    return formatMissionGoal(metricType, Math.max(1, Math.floor(goal / sets)), sets);
  }

  return formatMissionGoal(metricType, goal, sets);
}

export function missionSummary(mission: Mission): string {
  const metricType = normalizeMetricType(mission);
  const duration =
    typeof mission.duration_estimate_minutes === "number" && mission.duration_estimate_minutes > 0
      ? `${mission.duration_estimate_minutes} min`
      : null;

  if (metricType === "circuit_tasks") {
    const tasks = Array.isArray(mission.circuit_tasks) && mission.circuit_tasks.length > 0
      ? mission.circuit_tasks.length
      : missionTotalGoal(mission, metricType);
    return [duration, `${tasks} tarefas`].filter(Boolean).join(" | ");
  }

  return [duration, formatMissionGoalLabel(mission)].filter(Boolean).join(" | ");
}

export function primaryMissionLabel(mission: Mission): string {
  return mission.muscle_groups?.[0] ?? bodyAreaLabel(mission.body_area);
}

export function isStepProgressMission(mission: Mission): boolean {
  const hasCircuitTasks = Array.isArray(mission.circuit_tasks) && mission.circuit_tasks.length > 0;
  const goalText = typeof mission.goal === "string" ? mission.goal.toLowerCase() : "";
  return !hasCircuitTasks && (mission.metric_type === "steps" || goalText.includes("passos"));
}

export function buildStepMissionProgressSignature(missions: Mission[]): string {
  return missions
    .filter((mission) => isStepProgressMission(mission) && mission.is_completed !== 1)
    .map((mission) => `${mission.id}:${Number(mission.progress_value ?? 0)}`)
    .join("|");
}

export function createStepMissionSnapshot(
  missions: Mission[],
  stepsAtSnapshot: number,
  signature: string = buildStepMissionProgressSignature(missions),
): StepMissionSnapshot {
  const progressByMissionId = missions.reduce<Record<number, number>>((accumulator, mission) => {
    if (!isStepProgressMission(mission) || mission.is_completed === 1) {
      return accumulator;
    }

    accumulator[Number(mission.id)] = Math.max(0, Number(mission.progress_value ?? 0));
    return accumulator;
  }, {});

  return {
    signature,
    stepsAtSnapshot: Math.max(0, Math.round(stepsAtSnapshot)),
    progressByMissionId,
  };
}

export function readPersistentStepMissionProgressState(
  userId: string | null | undefined,
): PersistentStepMissionProgressState {
  const storageKey = persistentStepMissionProgressStorageKey(userId);
  if (!storageKey || !canUseStorage()) {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) return {};
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<PersistentStepMissionProgressState>(
      (accumulator, [rawMissionId, rawEntry]) => {
        const missionId = Number(rawMissionId);
        if (!Number.isInteger(missionId) || missionId <= 0) {
          return accumulator;
        }

        if (!rawEntry || typeof rawEntry !== "object") {
          return accumulator;
        }

        const candidate = rawEntry as Record<string, unknown>;
        const metricsDate =
          typeof candidate.metricsDate === "string" && candidate.metricsDate.trim().length > 0
            ? candidate.metricsDate.trim()
            : null;
        const lastDailySteps = Math.max(0, Math.round(Number(candidate.lastDailySteps ?? 0) || 0));
        const progressValue = Math.max(0, Math.round(Number(candidate.progressValue ?? 0) || 0));

        if (!metricsDate) {
          return accumulator;
        }

        accumulator[missionId] = {
          metricsDate,
          lastDailySteps,
          progressValue,
        };
        return accumulator;
      },
      {},
    );
  } catch {
    return {};
  }
}

export function writePersistentStepMissionProgressState(
  userId: string | null | undefined,
  state: PersistentStepMissionProgressState,
): void {
  const storageKey = persistentStepMissionProgressStorageKey(userId);
  if (!storageKey || !canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Best-effort persistence only.
  }
}

export function arePersistentStepMissionProgressStatesEqual(
  left: PersistentStepMissionProgressState,
  right: PersistentStepMissionProgressState,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([rawMissionId, leftEntry]) => {
    const missionId = Number(rawMissionId);
    const rightEntry = right[missionId];
    if (!rightEntry) {
      return false;
    }

    return (
      leftEntry.metricsDate === rightEntry.metricsDate &&
      leftEntry.lastDailySteps === rightEntry.lastDailySteps &&
      leftEntry.progressValue === rightEntry.progressValue
    );
  });
}

function missionUpdatedOnMetricsDate(
  mission: Mission,
  metricsDate: string,
): boolean {
  return extractDateKey(mission.updated_at) === metricsDate;
}

export function reconcilePersistentStepMissionProgress({
  missions,
  metricsDate,
  stepsValue,
  state,
}: ReconcilePersistentStepMissionProgressParams): PersistentStepMissionProgressState {
  const safeStepsValue = Math.max(0, Math.round(stepsValue));
  const nextState: PersistentStepMissionProgressState = {};

  for (const mission of missions) {
    if (!isStepProgressMission(mission) || mission.is_completed === 1) {
      continue;
    }

    const missionId = Number(mission.id);
    if (!Number.isInteger(missionId) || missionId <= 0) {
      continue;
    }

    const target = missionTotalGoal(mission, normalizeMetricType(mission));
    const serverProgress = Math.max(0, Math.round(Number(mission.progress_value ?? 0) || 0));
    const previousEntry = state[missionId];

    if (!previousEntry) {
      const seededProgress = missionUpdatedOnMetricsDate(mission, metricsDate)
        ? serverProgress
        : Math.min(target, serverProgress + safeStepsValue);

      nextState[missionId] = {
        metricsDate,
        lastDailySteps: safeStepsValue,
        progressValue: seededProgress,
      };
      continue;
    }

    const sameMetricsDate = previousEntry.metricsDate === metricsDate;
    const lastDailySteps = sameMetricsDate ? previousEntry.lastDailySteps : 0;
    const deltaSteps = Math.max(0, safeStepsValue - lastDailySteps);
    const progressValue = Math.min(
      target,
      Math.max(serverProgress, previousEntry.progressValue) + deltaSteps,
    );

    nextState[missionId] = {
      metricsDate,
      lastDailySteps: Math.max(lastDailySteps, safeStepsValue),
      progressValue,
    };
  }

  return nextState;
}

export function isMissionCompleted(mission: Mission): boolean {
  return mission.is_completed === 1 || mission.status === "completed";
}

export function sortMissions(items: Mission[]): Mission[] {
  return [...items].sort((left, right) => {
    const completionDelta = Number(isMissionCompleted(left)) - Number(isMissionCompleted(right));
    if (completionDelta !== 0) return completionDelta;
    return left.id - right.id;
  });
}

export function formatDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function extractDateKey(value: string | null | undefined): string | null {
  if (!value) return null;

  const directMatch = value.match(/\d{4}-\d{2}-\d{2}/);
  if (directMatch) return directMatch[0];

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateKey(parsed);
}

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
  return start;
}

export function buildWeekDates(baseDate: Date): Date[] {
  const weekStart = startOfWeek(baseDate);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
}

export function buildCenteredDates(baseDate: Date, radius = 2): Date[] {
  const normalizedBaseDate = new Date(baseDate);
  normalizedBaseDate.setHours(0, 0, 0, 0);

  return Array.from({ length: radius * 2 + 1 }, (_, index) => {
    const date = new Date(normalizedBaseDate);
    date.setDate(normalizedBaseDate.getDate() + index - radius);
    return date;
  });
}

export function capitalizeLabel(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
