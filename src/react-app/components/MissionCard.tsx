import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CheckCircle2,
  Clock3,
  Dumbbell,
  MapPinned,
  Play,
  Sparkles,
  Star,
  Trophy,
  X,
  Info,
  Pause,
  FastForward,
  Square,
} from "lucide-react";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Badge } from "@/react-app/components/ui/badge";
import LoadingBall from "@/react-app/components/LoadingBall";
import { formatMissionGoal, shouldShowMissionDuration } from "@/constants/missionMetrics";
import { resolveExerciseMediaFallbackUrl } from "@/shared/exerciseCatalog";
import type { CircuitTask, Mission, MissionMetricType } from "@/shared/types";
import { localizeMissionText, localizeMissionTextArray, normalizeMissionMediaUrl } from "@/shared/missionLocalization";
import { api } from "@/react-app/utils/api";
import { useAppChrome } from "@/react-app/contexts/appChrome";
import WalkingMissionExecution from "./WalkingMissionExecution";

type MissionCardProps = {
  mission: Mission & { skill_name?: string | undefined };
  onComplete: (id: number, reps: number, verified: boolean) => Promise<void> | void;
  layout?: "default" | "compact";
};

type MissionExecutionState = {
  currentSet: number;
  remainingSeconds: number;
  restSeconds: number;
  running: boolean;
  resting: boolean;
  repsDone: number;
  totalRepsDone: number;
  inputValue: string;
  finished: boolean;
};

const DEFAULT_EXECUTION_STATE: MissionExecutionState = {
  currentSet: 1,
  remainingSeconds: 0,
  restSeconds: 0,
  running: false,
  resting: false,
  repsDone: 0,
  totalRepsDone: 0,
  inputValue: "",
  finished: false,
};

// Normalizes mission metrics and goals before any card or modal rendering happens.
function normalizeMetricType(mission: Mission): MissionMetricType {
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

function resolveCircuitTasks(mission: Mission): CircuitTask[] {
  if (!Array.isArray(mission.circuit_tasks)) return [];
  return mission.circuit_tasks.filter((task) =>
    typeof task.id === "string" &&
    typeof task.label === "string" &&
    typeof task.mission_type === "string" &&
    typeof task.required_count === "number" &&
    typeof task.current_count === "number" &&
    typeof task.completed === "boolean"
  );
}

function missionTotalGoal(mission: Mission, metricType: MissionMetricType): number {
  if (metricType === "circuit_tasks") {
    const tasks = resolveCircuitTasks(mission);
    return tasks.length > 0
      ? tasks.length
      : Math.max(1, Number(mission.metric_value ?? 1));
  }
  if (typeof mission.metric_value === "number" && mission.metric_value > 0) {
    return mission.metric_value;
  }
  if (metricType === "duration_seconds" || metricType === "duration_minutes") {
    return Math.max(1, Number(mission.target_time ?? 0));
  }
  return Math.max(1, Number(mission.target_reps ?? 1));
}

function formatGoal(mission: Mission, metricType: MissionMetricType): string {
  const goal = missionTotalGoal(mission, metricType);
  const sets = mission.sets ?? undefined;

  if (metricType === "duration_seconds" && sets && sets > 0) {
    const secondsPerSet = Math.max(1, Math.floor(goal / sets));
    return formatMissionGoal(metricType, secondsPerSet, sets);
  }

  if (metricType === "sets_reps" && sets && sets > 0) {
    const repsPerSet = Math.max(1, Math.floor(goal / sets));
    return formatMissionGoal(metricType, repsPerSet, sets);
  }

  if (metricType === "circuit_tasks") {
    const tasks = resolveCircuitTasks(mission);
    const completedCount = tasks.filter((task) => task.completed).length;
    return formatMissionGoal(metricType, completedCount);
  }

  return formatMissionGoal(metricType, goal, sets);
}

function bodyAreaLabel(bodyArea: Mission["body_area"]): string {
  if (bodyArea === "upper") return "Parte superior";
  if (bodyArea === "lower") return "Parte inferior";
  if (bodyArea === "core") return "Core";
  return "Corpo inteiro";
}

function isGifUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.gif(?:$|\?)/i.test(url) || /format=gif/i.test(url);
}

function isPixelOrLineArtUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /(pixel|lineart|sprite|icon|outline|vector)/i.test(url);
}

function normalizeLookupText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDistanceAmount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toLocaleString("pt-BR", {
      minimumFractionDigits: value % 1000 === 0 ? 0 : 1,
      maximumFractionDigits: 1,
    })} km`;
  }
  return `${Math.round(value).toLocaleString("pt-BR")} m`;
}

function extractGoalCounterValue(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  const rawValue = match?.[1];
  if (!rawValue) return null;
  const numeric = Number.parseFloat(rawValue);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveProgressTarget(mission: Mission, metricType: MissionMetricType): number {
  const metricTarget = Math.max(1, missionTotalGoal(mission, metricType));
  const normalizedGoal = normalizeLookupText(mission.goal);
  const explicitGoalValue = extractGoalCounterValue(mission.goal);

  if (explicitGoalValue === null || explicitGoalValue <= 0) {
    return metricTarget;
  }

  if (metricType === "steps" || normalizedGoal.includes("passos")) {
    return Math.max(1, Math.round(explicitGoalValue));
  }

  if (
    metricType === "distance_meters"
    || normalizedGoal.includes(" km")
    || normalizedGoal.endsWith("km")
    || normalizedGoal.includes("metros")
  ) {
    const rawGoal = String(mission.goal ?? "").toLowerCase();
    const asMeters = rawGoal.includes("km")
      ? explicitGoalValue * 1000
      : explicitGoalValue;
    return Math.max(1, Math.round(asMeters));
  }

  if (
    normalizedGoal.includes("missoes concluidas")
    || normalizedGoal.includes("dias ativos")
    || normalizedGoal.includes("circuitos semanais")
  ) {
    return Math.max(1, Math.round(explicitGoalValue));
  }

  return metricTarget;
}

function resolveProgressCounterParts(
  mission: Mission,
  metricType: MissionMetricType,
  current: number,
  target: number,
): { current: string; target: string; unitLabel: string | null } {
  const title = normalizeLookupText(mission.title);
  const goal = normalizeLookupText(mission.goal);

  if (title.includes("consistencia mensal") || title.includes("volume mensal") || goal.includes("missoes concluidas")) {
    return {
      current: Math.round(current).toLocaleString("pt-BR"),
      target: Math.round(target).toLocaleString("pt-BR"),
      unitLabel: "missões",
    };
  }

  if (title.includes("dias ativos") || title.includes("pratica ativa") || goal.includes("dias ativos")) {
    return {
      current: Math.round(current).toLocaleString("pt-BR"),
      target: Math.round(target).toLocaleString("pt-BR"),
      unitLabel: "dias",
    };
  }

  if (title.includes("circuitos semanais") || goal.includes("circuitos semanais")) {
    return {
      current: Math.round(current).toLocaleString("pt-BR"),
      target: Math.round(target).toLocaleString("pt-BR"),
      unitLabel: "circuitos",
    };
  }

  if (metricType === "steps" || goal.includes("passos") || title.includes("passos")) {
    return {
      current: Math.round(current).toLocaleString("pt-BR"),
      target: Math.round(target).toLocaleString("pt-BR"),
      unitLabel: "passos",
    };
  }

  if (metricType === "distance_meters") {
    return {
      current: formatDistanceAmount(current),
      target: formatDistanceAmount(target),
      unitLabel: null,
    };
  }

  return {
    current: Math.round(current).toLocaleString("pt-BR"),
    target: Math.round(target).toLocaleString("pt-BR"),
    unitLabel: null,
  };
}

function formatProgressAmount(
  mission: Mission,
  metricType: MissionMetricType,
  current: number,
  target: number,
): string {
  const parts = resolveProgressCounterParts(mission, metricType, current, target);
  if (parts.unitLabel) {
    return `${parts.current}/${parts.target} ${parts.unitLabel}`;
  }
  return `${parts.current}/${parts.target}`;
}

function resolveMissionGoalText(mission: Mission, metricType: MissionMetricType): string {
  if (typeof mission.goal === "string" && mission.goal.trim().length > 0) {
    return (localizeMissionText(mission.goal) ?? mission.goal).trim();
  }
  return localizeMissionText(formatGoal(mission, metricType)) ?? formatGoal(mission, metricType);
}

const MISSION_TITLE_PREFIX_PATTERN = /^(?:miss(?:\u00e3o|ao)\s+(?:di[a\u00e1]ria|semanal|mensal)|daily mission|weekly mission|monthly mission|meta\s+(?:di[a\u00e1]ria|semanal|mensal)|daily goal|weekly goal|monthly goal)\s*:\s*/i;

// Cleans display copy and media choices so each card surfaces the best localized presentation.
function resolveMissionDisplayTitle(value: string | null | undefined): string {
  const localized = localizeMissionText(value ?? "") ?? "";
  const stripped = localized.replace(MISSION_TITLE_PREFIX_PATTERN, "").trim();
  return stripped.length > 0 ? stripped : localized.trim();
}

function formatDifficultyLabel(value: string | null | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Iniciante";
  }
  const localized = (localizeMissionText(value) ?? value).trim();
  const normalized = localized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.includes("advanced") || normalized.includes("avancado") || normalized.includes("avan")) return "Avançado";
  if (normalized.includes("intermediate") || normalized.includes("intermedio") || normalized.includes("intermediar")) return "Intermediário";
  return localized.charAt(0).toUpperCase() + localized.slice(1);
}

function summarizeCircuitTaskLabel(label: string): string {
  const localized = localizeMissionText(label) ?? label;
  return localized
    .replace(/^Conclua\s+/i, "")
    .replace(/^Complete\s+/i, "")
    .replace(/^\d+\s+miss(?:\u00f5es|oes)\s+di[a\u00e1]rias\s+de\s+/i, "")
    .replace(/^\d+\s+miss(?:\u00f5es|oes)\s+de\s+/i, "")
    .trim();
}

function uniqueMissionLabels(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const localized = (localizeMissionText(value) ?? value).trim();
    if (localized.length === 0) continue;
    const key = localized.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(localized);
  }
  return labels;
}

function resolveMissionFocusLabels(mission: Mission): string[] {
  const labels = uniqueMissionLabels([
    ...(Array.isArray(mission.muscle_groups) ? mission.muscle_groups : []),
    mission.exercise_target,
    mission.exercise_body_part,
    ...(Array.isArray(mission.exercise_secondary_muscles) ? mission.exercise_secondary_muscles.slice(0, 3) : []),
  ]);
  if (labels.length > 0) return labels.slice(0, 6);
  return [bodyAreaLabel(mission.body_area)];
}

const UNILATERAL_EXECUTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:split squat|bulgarian split squat|agachamento bulgaro|agachamento dividido|agachamento unilateral)\b/,
  /\b(?:single leg|single-leg|single arm|single-arm|one leg|one-leg|one arm|one-arm|unilateral)\b/,
  /\b(?:step up|step-up|subida no banco|afundo alternado|avanco alternado|passada alternada)\b/,
  /\b(?:cada lado|cada perna|cada braco|troque de lado|troque de perna|alterne os lados|alterne as pernas)\b/,
];

// Detects execution-specific mission behavior and chooses the most suitable media asset.
function isUnilateralExecutionMission(mission: Mission): boolean {
  const sourceTexts = [
    mission.title,
    mission.description,
    mission.goal,
    ...(Array.isArray(mission.instructions) ? mission.instructions.slice(0, 6) : []),
    ...(Array.isArray(mission.exercise_instructions_pt) ? mission.exercise_instructions_pt.slice(0, 6) : []),
    ...(Array.isArray(mission.exercise_instructions_en) ? mission.exercise_instructions_en.slice(0, 6) : []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeLookupText(value));

  if (sourceTexts.length === 0) return false;

  const combined = sourceTexts.join(" | ");
  return UNILATERAL_EXECUTION_PATTERNS.some((pattern) => pattern.test(combined));
}

function summarizeAutoProgressLabel(tasks: readonly CircuitTask[]): string {
  const taskLabels = uniqueMissionLabels(tasks.map((task) => summarizeCircuitTaskLabel(task.label)));
  if (taskLabels.length === 0) return "Miss\u00f5es di\u00e1rias compat\u00edveis";
  if (taskLabels.length === 1) return taskLabels[0] ?? "Miss\u00f5es di\u00e1rias compat\u00edveis";
  if (taskLabels.length === 2) return `${taskLabels[0]} e ${taskLabels[1]}`;
  return `${taskLabels[0]}, ${taskLabels[1]} e mais ${taskLabels.length - 2}`;
}

function resolveCatalogMissionMediaFallbackUrl(mission: Mission): string | null {
  if (mission.type !== "daily") {
    return null;
  }

  const candidates = [
    mission.exercise_name,
    resolveMissionDisplayTitle(mission.title),
    mission.description,
  ];

  for (const candidate of candidates) {
    const fallbackUrl = resolveExerciseMediaFallbackUrl(candidate);
    if (fallbackUrl) {
      return normalizeMissionMediaUrl(fallbackUrl);
    }
  }

  return null;
}

function resolveMissionMediaUrl(mission: Mission): string | null {
  const primaryImage = normalizeMissionMediaUrl(mission.image_url);
  const ascendGif = isGifUrl(primaryImage) ? primaryImage : null;
  const exerciseDbGif = normalizeMissionMediaUrl(mission.exercise_db_gif_url);
  const exerciseDbImage = normalizeMissionMediaUrl(mission.exercise_db_image_url);
  const videoUrl = normalizeMissionMediaUrl(mission.video_url);
  const thumbnail = normalizeMissionMediaUrl(mission.thumbnail_url);
  const catalogFallback = resolveCatalogMissionMediaFallbackUrl(mission);

  return ascendGif
    ?? exerciseDbGif
    ?? (videoUrl ? (thumbnail ?? null) : null)
    ?? exerciseDbImage
    ?? primaryImage
    ?? thumbnail
    ?? catalogFallback
    ?? null;
}

function resolveMissionVideoUrl(mission: Mission): string | null {
  return normalizeMissionMediaUrl(mission.video_url);
}

function resolveMissionMediaStyle(url: string | null | undefined): CSSProperties {
  const pixelOrLineArt = isPixelOrLineArtUrl(url);

  return {
    imageRendering: pixelOrLineArt ? "crisp-edges" : "auto",
    filter: pixelOrLineArt
      ? "contrast(1.06) saturate(1.06) brightness(1.01)"
      : "contrast(1.02) saturate(1.03) brightness(1.01)",
  };
}

function MissionExecutionModal({
  mission,
  metricType,
  open,
  onClose,
  onFinish,
}: {
  mission: Mission;
  metricType: MissionMetricType;
  open: boolean;
  onClose: () => void;
  onFinish: (value: number) => Promise<void>;
}) {
  const [state, setState] = useState<MissionExecutionState>(DEFAULT_EXECUTION_STATE);
  const [videoVisibleControls, setVideoVisibleControls] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [showCompletionToast, setShowCompletionToast] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Derives the execution targets used by counters, timers, and finish validation.
  const sets = Math.max(1, Number(mission.sets ?? 1));
  const restSecondsConfigured = Math.max(0, Number(mission.rest_seconds ?? 0));
  const totalGoal = missionTotalGoal(mission, metricType);
  const totalTimeSeconds = metricType === "duration_minutes" ? totalGoal * 60 : totalGoal;
  const setGoal = metricType === "sets_reps" ? Math.max(1, Math.floor(totalGoal / sets)) : Math.max(1, totalGoal);
  const setDuration = metricType === "duration_seconds" || metricType === "duration_minutes"
    ? Math.max(1, Math.floor(totalTimeSeconds / sets))
    : 0;

  // Resets the execution state every time a new modal session starts.
  useEffect(() => {
    if (!open) return;
    setState({
      ...DEFAULT_EXECUTION_STATE,
      remainingSeconds: setDuration,
      running: metricType === "duration_seconds" || metricType === "duration_minutes",
    });
    setVideoVisibleControls(false);
    setFinishing(false);
    setShowCompletionToast(false);
  }, [metricType, open, setDuration]);

  // Advances the timer-based mission flow while the timer is actively running.
  useEffect(() => {
    if (!open) return;
    if (!state.running) return;

    const isTimeMission = metricType === "duration_seconds" || metricType === "duration_minutes";
    if (!isTimeMission) return;

    const timer = window.setInterval(() => {
      setState((current) => {
        if (!current.running) return current;

        if (current.resting) {
          if (current.restSeconds > 1) {
            return { ...current, restSeconds: current.restSeconds - 1 };
          }
          return {
            ...current,
            resting: false,
            running: true,
            remainingSeconds: setDuration,
            restSeconds: 0,
          };
        }

        if (current.remainingSeconds > 1) {
          return { ...current, remainingSeconds: current.remainingSeconds - 1 };
        }

        if (current.currentSet < sets) {
          return {
            ...current,
            currentSet: current.currentSet + 1,
            resting: restSecondsConfigured > 0,
            running: restSecondsConfigured > 0,
            restSeconds: restSecondsConfigured,
            remainingSeconds: restSecondsConfigured > 0 ? 0 : setDuration,
          };
        }

        return { ...current, running: false, resting: false, finished: true, remainingSeconds: 0 };
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [metricType, open, restSecondsConfigured, setDuration, sets, state.running]);

  // Counts down the rest window for counter-based missions between sets.
  useEffect(() => {
    if (!open) return;
    if (!state.resting) return;
    if (state.restSeconds <= 0) return;
    if (metricType === "duration_seconds" || metricType === "duration_minutes") return;

    const restTimer = window.setInterval(() => {
      setState((current) => {
        if (!current.resting) return current;
        if (current.restSeconds > 1) {
          return { ...current, restSeconds: current.restSeconds - 1 };
        }
        return { ...current, resting: false, restSeconds: 0 };
      });
    }, 1000);

    return () => window.clearInterval(restTimer);
  }, [metricType, open, state.restSeconds, state.resting]);

  // Classifies the current mission execution mode to drive the available controls.
  const isTimeMission = metricType === "duration_seconds" || metricType === "duration_minutes";
  const isCounterMission = metricType === "repetitions" || metricType === "sets_reps";
  const isDistanceMission = metricType === "steps" || metricType === "distance_meters";
  const usesPerSideExecutionLabel = isCounterMission && isUnilateralExecutionMission(mission);

  // Handles counter interactions for rep-based execution flows.
  const incrementRep = () => {
    if (!isCounterMission) return;
    setState((current) => ({ ...current, repsDone: current.repsDone + 1 }));
  };

  const decrementRep = () => {
    if (!isCounterMission) return;
    setState((current) => ({ ...current, repsDone: Math.max(0, current.repsDone - 1) }));
  };

  const completeCurrentSet = () => {
    if (!isCounterMission) return;
    setState((current) => {
      const validSetReps = Math.max(current.repsDone, 0);
      if (metricType === "sets_reps" && validSetReps < setGoal) {
        return current;
      }
      const accumulated = current.totalRepsDone + validSetReps;

      if (current.currentSet < sets) {
        return {
          ...current,
          totalRepsDone: accumulated,
          repsDone: 0,
          currentSet: current.currentSet + 1,
          resting: restSecondsConfigured > 0,
          restSeconds: restSecondsConfigured,
        };
      }

      const targetReached = metricType === "sets_reps"
        ? accumulated >= setGoal * sets
        : accumulated >= totalGoal;

      return {
        ...current,
        totalRepsDone: accumulated,
        finished: targetReached,
      };
    });
  };

  const canFinishInputMission = isDistanceMission && Number(state.inputValue) > 0;
  const totalCounterProgress = state.totalRepsDone + state.repsDone;
  const canFinishCounterMission = isCounterMission && state.finished;
  const canFinishMission = isDistanceMission ? canFinishInputMission : isTimeMission ? state.finished : canFinishCounterMission;
  const interactionLocked = finishing || showCompletionToast;

  // Controls inline video playback for exercise demonstrations inside the modal.
  const toggleVideoPlayback = useCallback(async () => {
    const currentVideo = videoRef.current;
    if (!currentVideo) return;

    if (currentVideo.paused) {
      try {
        await currentVideo.play();
        setVideoVisibleControls(false);
      } catch {
        setVideoVisibleControls(true);
      }
      return;
    }

    currentVideo.pause();
    setVideoVisibleControls(true);
  }, []);

  // Lets timed missions manually advance after a set is completed or skipped.
  const advanceTimedSet = () => {
    setState((current) => {
      if (!isTimeMission) return current;
      if (current.running || current.resting || current.remainingSeconds > 0) return current;
      if (current.currentSet >= sets) {
        return { ...current, remainingSeconds: 0, restSeconds: 0, resting: false, running: false, finished: true };
      }
      return {
        ...current,
        currentSet: current.currentSet + 1,
        remainingSeconds: restSecondsConfigured > 0 ? 0 : setDuration,
        restSeconds: restSecondsConfigured,
        resting: restSecondsConfigured > 0,
        running: true,
      };
    });
  };

  const toggleRunning = () => {
    setState((current) => {
      if (current.finished || isDistanceMission) return current;
      return { ...current, running: !current.running };
    });
  };

  const resetExecution = () => {
    if (interactionLocked) return;
    setState(DEFAULT_EXECUTION_STATE);
    setVideoVisibleControls(false);
  };

  // Finalizes the mission with the value expected by the existing completion contract.
  const finishMission = async () => {
    if (!canFinishMission || finishing) return;
    const value = isDistanceMission
      ? Number(state.inputValue)
      : isCounterMission
        ? Math.max(totalGoal, totalCounterProgress)
        : totalGoal;
    try {
      setFinishing(true);
      await onFinish(value);
      setShowCompletionToast(true);
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      onClose();
    } catch {
      setFinishing(false);
      setShowCompletionToast(false);
    }
  };

  if (!open) return null;

  const detailMissionMediaUrl = resolveMissionMediaUrl(mission);
  const missionVideoUrl = normalizeMissionMediaUrl(mission.video_url);
  const executionTitle = resolveMissionDisplayTitle(mission.title);
  const displaySeconds = state.resting ? state.restSeconds : state.remainingSeconds;
  const m = Math.floor(displaySeconds / 60).toString().padStart(2, '0');
  const s = (displaySeconds % 60).toString().padStart(2, '0');

  let activeProgress = 0;
  if (state.finished) {
    activeProgress = 100;
  } else if (isCounterMission) {
    activeProgress = Math.min(100, (totalCounterProgress / totalGoal) * 100 || 0);
  } else if (isDistanceMission) {
    activeProgress = Math.min(100, (Number(state.inputValue || 0) / totalGoal) * 100 || 0);
  } else {
    const completedSets = Math.max(0, state.currentSet - 1);
    const currentSetProgress = setDuration > 0 && !state.resting
      ? Math.max(0, (setDuration - state.remainingSeconds) / setDuration)
      : 0;
    activeProgress = Math.min(100, ((completedSets + currentSetProgress) / sets) * 100 || 0);
  }
  const sessionXp = Math.max(0, Math.round((mission.xp_reward * activeProgress) / 100));
  const timedPrimaryActionLabel = state.finished
    ? "SÉRIE CONCLUÍDA"
    : state.resting
      ? "DESCANSO EM ANDAMENTO"
      : state.running
        ? "TIMER EM ANDAMENTO"
        : "USE PAUSAR/RETOMAR";
  const primaryActionLabel = isCounterMission
    ? "PRÓXIMA SÉRIE"
    : isDistanceMission
      ? "REGISTRO MANUAL"
      : timedPrimaryActionLabel;
  const primaryActionDisabled = isCounterMission
    ? (interactionLocked || state.resting || state.repsDone <= 0)
    : true;

  return (
    <div className="fl-z-mission-screen fixed inset-0 flex flex-col overflow-x-hidden font-display antialiased min-w-0" style={{ backgroundColor: "var(--app-bg-color)", color: "var(--fl-color-text)" }}>
      <div className="layout-container flex h-full grow flex-col min-w-0">
        {/* Keeps the brand framing and top-level session controls visible. */}
        <header className="flex items-center justify-between border-b px-3 py-2 sm:px-4 sm:py-3 md:px-6 md:py-4" style={{ borderColor: "var(--fl-border-soft)" }}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex size-7 sm:size-8 items-center justify-center rounded shrink-0" style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}>
              <Dumbbell className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={2.5} />
            </div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight truncate">FitLoot</h2>
          </div>
          <div className="flex gap-1 sm:gap-2 shrink-0">
            <button type="button" className="flex size-8 sm:size-10 items-center justify-center rounded-full border transition-opacity hover:opacity-80 disabled:opacity-50" onClick={resetExecution} disabled={interactionLocked} style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
              <Info className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button type="button" className="flex size-8 sm:size-10 items-center justify-center rounded-full border transition-opacity hover:opacity-80 disabled:opacity-50" onClick={onClose} disabled={interactionLocked} style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 max-w-2xl mx-auto w-full px-3 py-4 sm:px-6 sm:py-8 flex flex-col min-w-0">
          {/* Shows the overall completion percentage for the active mission session. */}
          <div className="mb-6 sm:mb-10">
            <div className="flex justify-between items-end mb-2 sm:mb-3 gap-2">
              <div className="min-w-0 overflow-hidden">
                <p className="text-[10px] sm:text-xs md:text-sm font-medium uppercase tracking-widest truncate" style={{ color: "var(--app-primary-color)" }}>Missão Ativa</p>
                <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold mt-0.5 sm:mt-1 truncate">{executionTitle}</h1>
              </div>
              <p className="text-base sm:text-lg md:text-xl font-bold shrink-0" style={{ color: "var(--app-primary-color)" }}>{Math.round(activeProgress)}%</p>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--fl-color-text) 8%, transparent)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${activeProgress}%`,
                  backgroundColor: "var(--app-primary-color)",
                  boxShadow: "0 0 15px color-mix(in srgb, var(--app-primary-color) 50%, transparent)"
                }}
              />
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center py-10">
            {/* Displays the live timer for active sets or rest intervals. */}
            {(isTimeMission || state.resting) && (
              <div className="text-center mb-6 sm:mb-12">
                <p className="text-xs sm:text-sm md:text-base lg:text-lg mb-2 sm:mb-4" style={{ color: "var(--fl-color-text-muted)" }}>
                  {state.resting ? "Timer de Descanso" : "Timer de Série"}
                </p>
                <div className="flex items-center justify-center gap-2 sm:gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      className="rounded-xl sm:rounded-2xl w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 lg:w-28 lg:h-28 flex items-center justify-center border transition-all"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 82%, transparent)",
                        borderColor: displaySeconds > 59 ? "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" : "var(--fl-border-soft)",
                        boxShadow: displaySeconds > 59 ? "0 0 0 2px color-mix(in srgb, var(--app-primary-color) 20%, transparent)" : "none",
                      }}
                    >
                      <span className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold" style={{ color: displaySeconds > 59 ? "var(--app-primary-color)" : "var(--fl-color-text)" }}>{m}</span>
                    </div>
                    <span className="text-[10px] mt-2 sm:mt-3 uppercase tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>Min</span>
                  </div>
                  <span className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold pb-6 sm:pb-8" style={{ color: "var(--fl-color-text-soft)" }}>:</span>
                  <div className="flex flex-col items-center">
                    <div
                      className="rounded-xl sm:rounded-2xl w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 lg:w-28 lg:h-28 flex items-center justify-center border transition-all"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 82%, transparent)",
                        borderColor: displaySeconds <= 59 ? "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" : "var(--fl-border-soft)",
                        boxShadow: displaySeconds <= 59 ? "0 0 0 2px color-mix(in srgb, var(--app-primary-color) 20%, transparent)" : "none",
                      }}
                    >
                      <span className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold" style={{ color: displaySeconds <= 59 ? "var(--app-primary-color)" : "var(--fl-color-text)" }}>{s}</span>
                    </div>
                    <span className="text-[10px] mt-2 sm:mt-3 uppercase tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>Seg</span>
                  </div>
                </div>
              </div>
            )}

            {/* Renders the mission media preview with optional inline video controls. */}
            <div
              className="relative w-full max-w-md aspect-video overflow-hidden rounded-2xl border shadow-2xl"
              style={{
                backgroundColor: "#ffffff",
                borderColor: "var(--fl-border-soft)",
                boxShadow: "var(--fl-shadow-glass)",
              }}
            >
              {missionVideoUrl ? (
                <video
                  ref={videoRef}
                  src={missionVideoUrl}
                  poster={detailMissionMediaUrl ?? undefined}
                  className="absolute inset-0 h-full w-full object-contain"
                  style={resolveMissionMediaStyle(missionVideoUrl)}
                  autoPlay loop muted playsInline
                  onPause={() => setVideoVisibleControls(true)}
                  onPlay={() => setVideoVisibleControls(false)}
                  onClick={() => { void toggleVideoPlayback(); }}
                />
              ) : detailMissionMediaUrl ? (
                <img
                  src={detailMissionMediaUrl}
                  alt={executionTitle}
                  className="absolute inset-0 h-full w-full object-contain"
                  style={resolveMissionMediaStyle(detailMissionMediaUrl)}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 60%, transparent)" }}>
                  <Dumbbell className="w-16 h-16 opacity-20" />
                </div>
              )}
              {missionVideoUrl ? (
                <button
                  type="button"
                  aria-label={videoVisibleControls ? "Reproduzir vídeo" : "Pausar vídeo"}
                  onClick={() => { void toggleVideoPlayback(); }}
                  className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${videoVisibleControls ? "opacity-100" : "pointer-events-none opacity-0"}`}
                  style={{ backgroundColor: "rgba(0,0,0,0.18)" }}
                >
                  <span
                    className="flex size-14 items-center justify-center rounded-full shadow-lg"
                    style={{ backgroundColor: "var(--app-primary-color)", color: "var(--app-bg-color, #000)" }}
                  >
                    {videoVisibleControls
                      ? <Play className="w-6 h-6 fill-current ml-1" strokeWidth={1} />
                      : <Pause className="w-6 h-6 fill-current" strokeWidth={1} />
                    }
                  </span>
                </button>
              ) : null}
              <div className="absolute bottom-2 sm:bottom-4 left-2 sm:left-4 right-2 sm:right-4 flex items-center justify-between gap-1">
                <span className="rounded-full border px-2 py-1 sm:px-4 sm:py-1.5 text-[9px] sm:text-xs font-bold backdrop-blur-md truncate" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 88%, transparent)", borderColor: "var(--fl-border-soft)" }}>
                  VERIFICAR FORMA
                </span>
                <span className="rounded-full border px-2 py-1 sm:px-4 sm:py-1.5 text-[9px] sm:text-xs font-bold backdrop-blur-md shrink-0" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 88%, transparent)", borderColor: "var(--fl-border-soft)" }}>
                  SÉRIE {state.currentSet}/{sets}
                </span>
              </div>
            </div>
            
            {/* Allows manual progress entry for distance and step missions. */}
            {isDistanceMission && (
              <div className="mt-4 sm:mt-6 w-full max-w-md space-y-3 min-w-0">
                <p className="text-[10px] sm:text-sm text-center" style={{ color: "var(--fl-color-text-muted)" }}>
                  Registre o valor atingido (Passos ou Metros)
                </p>
                <input
                  type="number"
                  className="w-full rounded-xl border-2 focus:outline-none px-4 py-3 bg-transparent text-center text-xl font-bold"
                  style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 30%, transparent)", color: "var(--app-primary-color)" }}
                  placeholder={metricType === "steps" ? "Passos" : "Metros"}
                  value={state.inputValue}
                  onChange={(event) => setState((current) => ({ ...current, inputValue: event.target.value }))}
                  min={0}
                  disabled={interactionLocked}
                />
              </div>
            )}

            {/* Drives the manual repetition flow for counter-based missions. */}
            {isCounterMission && !isTimeMission && (
              <div className="mt-4 sm:mt-6 w-full max-w-md flex flex-col items-center justify-center space-y-2 min-w-0">
                <p className="text-[10px] sm:text-xs md:text-sm uppercase tracking-widest font-bold" style={{ color: "var(--app-primary-color)" }}>
                  {usesPerSideExecutionLabel ? "Repetições por lado" : "Repetições"}
                </p>
                <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                  <button type="button" onClick={decrementRep} disabled={state.resting || interactionLocked} className="size-10 sm:size-14 rounded-full border text-lg sm:text-2xl active:scale-95 disabled:opacity-50" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 78%, transparent)" }}>-</button>
                  <span className="text-3xl sm:text-5xl font-bold w-16 sm:w-20 text-center">{state.repsDone}</span>
                  <button type="button" onClick={incrementRep} disabled={state.resting || interactionLocked} className="size-10 sm:size-14 rounded-full border text-lg sm:text-2xl active:scale-95 disabled:opacity-50" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 78%, transparent)" }}>+</button>
                </div>
                <p className="text-[10px] sm:text-xs text-center" style={{ color: "var(--fl-color-text-muted)" }}>
                  Meta da série: {setGoal}{usesPerSideExecutionLabel ? " cada lado" : ""} | Progresso: {totalCounterProgress}/{totalGoal}
                </p>
              </div>
            )}
            
          </div>

          {/* Anchors the execution actions used to progress, pause, and finish the mission. */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4 mt-auto pt-4 sm:pt-8 min-w-0">
            <button
              type="button"
              className="col-span-2 h-12 sm:h-16 rounded-xl sm:rounded-2xl font-bold text-base sm:text-xl flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale"
              style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)", boxShadow: "0 10px 15px -3px color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}
              onClick={isCounterMission ? completeCurrentSet : advanceTimedSet}
              disabled={primaryActionDisabled}
            >
              <FastForward className="w-5 h-5 sm:w-6 sm:h-6 fill-current" strokeWidth={1} />
              {primaryActionLabel}
            </button>

            <button
              type="button"
              className="h-10 sm:h-14 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm md:text-base flex items-center justify-center gap-1 sm:gap-2 border transition-colors active:scale-95 hover:bg-white/10 truncate"
              style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 82%, transparent)", borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}
              onClick={toggleRunning}
              disabled={state.finished || isDistanceMission || interactionLocked}
            >
              {state.running ? <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-current shrink-0" strokeWidth={1} /> : <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current shrink-0" strokeWidth={1} />}
              <span className="truncate">{state.running ? "PAUSAR" : "RETOMAR"}</span>
            </button>

            <button
              type="button"
              className="h-10 sm:h-14 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm md:text-base flex items-center justify-center gap-1 sm:gap-2 border transition-colors active:scale-95 disabled:opacity-50 disabled:grayscale truncate"
              style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 22%, transparent)", color: "var(--app-primary-color)" }}
              onClick={() => { void finishMission(); }}
              disabled={!canFinishMission || interactionLocked}
            >
              {finishing ? <LoadingBall size="sm" /> : <Square className="w-3 h-3 sm:w-4 sm:h-4 fill-current shrink-0" strokeWidth={2} />}
              <span className="truncate">{finishing ? "FINALIZANDO..." : isDistanceMission ? "REGISTRAR" : "FINALIZAR"}</span>
            </button>
          </div>
        </main>

        {/* Shows the session loot preview derived from the current execution progress. */}
        <footer className="mt-auto py-3 sm:py-6 flex justify-center uppercase tracking-[0.2em] sm:tracking-[0.3em] font-medium" style={{ color: "var(--fl-color-text-muted)", fontSize: 0 }}>
          <span className="text-[9px] sm:text-[10px]">Loot desta sessão: {sessionXp} / {mission.xp_reward} XP</span>
        </footer>
      </div>
      {/* Blocks interaction while the mission completion is being finalized or confirmed. */}
      {(finishing || showCompletionToast) ? (
        <div
          className="absolute inset-0 flex items-center justify-center px-6"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.28)", backdropFilter: "blur(8px)" }}
        >
          <div
            className="w-full max-w-sm rounded-[2rem] border p-6 text-center"
            style={{
              background: "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-strong) 96%, transparent), color-mix(in srgb, var(--fl-surface-muted) 92%, transparent))",
              borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
              boxShadow: "var(--fl-shadow-glass)",
            }}
          >
            <div
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
              style={{
                background: showCompletionToast
                  ? "color-mix(in srgb, var(--app-primary-color) 16%, transparent)"
                  : "color-mix(in srgb, var(--fl-surface-muted) 92%, transparent)",
                color: "var(--app-primary-color)",
              }}
            >
              {showCompletionToast ? <CheckCircle2 className="h-8 w-8" /> : <LoadingBall size="md" />}
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em]" style={{ color: "var(--app-primary-color)" }}>
              {showCompletionToast ? "Missão concluída" : "Finalizando"}
            </p>
            <h3 className="mt-3 text-xl font-black" style={{ color: "var(--fl-color-text)" }}>
              {showCompletionToast ? "Seu progresso foi salvo" : "Estamos registrando sua missão"}
            </h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}>
              {showCompletionToast
                ? `+${mission.xp_reward} XP liberados para ${executionTitle}.`
                : "Aguarde um instante enquanto validamos e fechamos sua execução."}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MissionCardComponent({ mission, onComplete, layout = "default" }: MissionCardProps) {
  const { setMissionDetailsOpen, setMissionExecutionOpen } = useAppChrome();
  const [showDetails, setShowDetails] = useState(false);
  const [showExecution, setShowExecution] = useState(false);
  const [showWalkingExecution, setShowWalkingExecution] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailedMission, setDetailedMission] = useState<Mission | null>(null);

  // Derives the mission state used by the compact card, details modal, and execution entrypoints.
  const metricType = useMemo(() => normalizeMetricType(mission), [mission]);
  const missionStatus = (mission as Mission & { status?: string | undefined }).status || (mission.is_completed === 1 ? "completed" : "pending");
  const isFailed = missionStatus === "failed" || missionStatus === "expired";
  const isCompleted = mission.is_completed === 1 || missionStatus === "completed";
  const isCircuitMission = metricType === "circuit_tasks";
  const isWeeklyMission = mission.type === "weekly";
  const isMonthlyMission = mission.type === "monthly";
  const isAutoProgressMission = isWeeklyMission || isMonthlyMission;
  const isAIMission = Number(mission.is_ai_special ?? 0) === 1 || mission.mission_origin === "ai";
  const isWalkingMission = metricType === "steps" || metricType === "distance_meters";
  const isTrackableWalkingMission = isWalkingMission && mission.type === "daily";
  const circuitTasks = useMemo(() => resolveCircuitTasks(mission), [mission]);
  const hasTaskProgressMission = isWeeklyMission || (isMonthlyMission && circuitTasks.length > 0);
  const autoProgressRequiredTotal = circuitTasks.reduce((total, task) => total + Math.max(1, task.required_count), 0);
  const autoProgressCurrentTotal = circuitTasks.reduce(
    (total, task) => total + Math.min(Math.max(0, task.current_count), Math.max(1, task.required_count)),
    0,
  );
  const circuitProgress = autoProgressRequiredTotal > 0 ? (autoProgressCurrentTotal / autoProgressRequiredTotal) * 100 : 0;
  const missionMediaUrl = resolveMissionMediaUrl(mission);
  const missionGoalText = resolveMissionGoalText(mission, metricType);
  const primaryLabel = hasTaskProgressMission
    ? summarizeAutoProgressLabel(circuitTasks)
    : isMonthlyMission
      ? missionGoalText
      : resolveMissionFocusLabels(mission)[0] ?? bodyAreaLabel(mission.body_area);
  const hasCircuitProgress = circuitTasks.some((task) => task.current_count > 0);
  const isInProgress = !isFailed && !isCompleted && (missionStatus === "in_progress" || hasCircuitProgress);
  const visualState = isFailed ? "failed" : isCompleted ? "completed" : isInProgress ? "in_progress" : "available";
  const stateLabel = visualState === "failed"
    ? "Falhou"
    : visualState === "completed"
      ? "Concluída"
      : visualState === "in_progress"
        ? "Em progresso"
        : "Disponível";
  const missionTypeLabel = mission.type === "daily" ? "Diária" : mission.type === "weekly" ? "Semanal" : "Mensal";
  const monthlyTarget = resolveProgressTarget(mission, metricType);
  const monthlyProgressValue = Number((mission as Mission & { progress_value?: number | undefined }).progress_value ?? 0);
  const monthlyCurrent = circuitTasks.length > 0
    ? (isCompleted ? autoProgressRequiredTotal : autoProgressCurrentTotal)
    : (isCompleted ? monthlyTarget : Math.max(0, Math.min(monthlyTarget, monthlyProgressValue)));
  const monthlyProgress = Math.min(100, Math.round((monthlyCurrent / monthlyTarget) * 100));
  const monthlyProgressParts = resolveProgressCounterParts(mission, metricType, monthlyCurrent, monthlyTarget);
  const hasInlineInstructions =
    (Array.isArray(mission.instructions) && mission.instructions.length > 0) ||
    (Array.isArray(mission.exercise_instructions_pt) && mission.exercise_instructions_pt.length > 0) ||
    (Array.isArray(mission.exercise_instructions_en) && mission.exercise_instructions_en.length > 0);
  const hasInlineMuscles = Array.isArray(mission.muscle_groups) && mission.muscle_groups.length > 0;
  const hasInlineDetails = hasInlineInstructions && hasInlineMuscles && Array.isArray(mission.safety_tips) && mission.safety_tips.length > 0;

  // Loads the rich mission payload only when inline data is incomplete.
  const loadMissionDetails = useCallback(async (options?: { silent?: boolean }) => {
    if (hasInlineDetails) return;
    if (detailsLoading || detailedMission) return;

    try {
      setDetailsLoading(true);
      if (!options?.silent) {
        setDetailsError(null);
      }
      const response = await api(`/api/missions/${mission.id}`);
      if (!response.ok) {
        throw new Error("Falha ao carregar detalhes da missão.");
      }
      const payload = (await response.json()) as Mission;
      setDetailedMission(payload);
    } catch {
      if (!options?.silent) {
        setDetailsError("Não foi possível carregar os detalhes completos desta missão agora.");
      }
    } finally {
      setDetailsLoading(false);
    }
  }, [detailedMission, detailsLoading, hasInlineDetails, mission.id]);

  const completeMission = async (value: number) => {
    setCompleting(true);
    try {
      await onComplete(mission.id, value, true);
      setShowDetails(false);
      setShowWalkingExecution(false);
    } finally {
      setCompleting(false);
    }
  };

  const openDetails = async () => {
    setShowDetails(true);
    setDetailsError(null);
    await loadMissionDetails();
  };

  // Keeps detail data warm in the background once the card is mounted.
  useEffect(() => {
    if (hasInlineDetails || detailedMission || detailsLoading) return;
    void loadMissionDetails({ silent: true });
  }, [detailedMission, detailsLoading, hasInlineDetails, loadMissionDetails]);

  // Mirrors modal visibility into the shared chrome context.
  useEffect(() => {
    setMissionDetailsOpen(showDetails);
    return () => { setMissionDetailsOpen(false); };
  }, [setMissionDetailsOpen, showDetails]);

  useEffect(() => {
    setMissionExecutionOpen(showExecution);
    return () => { setMissionExecutionOpen(false); };
  }, [setMissionExecutionOpen, showExecution]);

  // Recomputes the detail-modal state from the best mission payload currently available.
  const missionDetails = detailedMission ?? mission;
  const detailMetricType = normalizeMetricType(missionDetails);
  const detailCircuitTasks = resolveCircuitTasks(missionDetails);
  const detailIsWeeklyMission = missionDetails.type === "weekly";
  const detailIsMonthlyMission = missionDetails.type === "monthly";
  const detailIsAutoProgressMission = detailIsWeeklyMission || detailIsMonthlyMission;
  const detailIsCompleted = missionDetails.is_completed === 1 || ((missionDetails as Mission & { status?: string | undefined }).status ?? "") === "completed";
  const detailHasTaskProgressMission = detailIsWeeklyMission || (detailIsMonthlyMission && detailCircuitTasks.length > 0);
  const detailAutoProgressRequiredTotal = detailCircuitTasks.reduce((total, task) => total + Math.max(1, task.required_count), 0);
  const detailAutoProgressCurrentTotal = detailCircuitTasks.reduce(
    (total, task) => total + Math.min(Math.max(0, task.current_count), Math.max(1, task.required_count)),
    0,
  );
  const detailCircuitProgress = detailAutoProgressRequiredTotal > 0
    ? (detailAutoProgressCurrentTotal / detailAutoProgressRequiredTotal) * 100
    : 0;
  const detailMonthlyTarget = resolveProgressTarget(missionDetails, detailMetricType);
  const detailMonthlyProgressValue = Number((missionDetails as Mission & { progress_value?: number | undefined }).progress_value ?? 0);
  const detailMonthlyCurrent = detailCircuitTasks.length > 0
    ? (detailIsCompleted ? detailAutoProgressRequiredTotal : detailAutoProgressCurrentTotal)
    : (detailIsCompleted ? detailMonthlyTarget : Math.max(0, Math.min(detailMonthlyTarget, detailMonthlyProgressValue)));
  const detailMonthlyProgress = Math.min(100, Math.round((detailMonthlyCurrent / detailMonthlyTarget) * 100));
  const detailMonthlyProgressParts = resolveProgressCounterParts(missionDetails, detailMetricType, detailMonthlyCurrent, detailMonthlyTarget);
  const detailFocusLabels = detailIsAutoProgressMission ? [] : resolveMissionFocusLabels(missionDetails);
  const detailMissionMediaUrl = resolveMissionMediaUrl(missionDetails);
  const missionVideoUrl = resolveMissionVideoUrl(mission);
  const detailMissionVideoUrl = resolveMissionVideoUrl(missionDetails);
  const detailTitle = resolveMissionDisplayTitle(missionDetails.title);
  const detailDescription = missionDetails.description
    ? (localizeMissionText(missionDetails.description) ?? missionDetails.description)
    : null;
  const safetyTips = Array.isArray(missionDetails.safety_tips) && missionDetails.safety_tips.length > 0
    ? localizeMissionTextArray(missionDetails.safety_tips)
    : ["Mantenha alinhamento postural e interrompa em caso de dor aguda."];
  const instructionList =
    (Array.isArray(missionDetails.instructions) && missionDetails.instructions.length > 0
      ? localizeMissionTextArray(missionDetails.instructions)
      : Array.isArray(missionDetails.exercise_instructions_pt) && missionDetails.exercise_instructions_pt.length > 0
        ? localizeMissionTextArray(missionDetails.exercise_instructions_pt)
        : Array.isArray(missionDetails.exercise_instructions_en) && missionDetails.exercise_instructions_en.length > 0
          ? localizeMissionTextArray(missionDetails.exercise_instructions_en)
          : detailDescription
            ? [detailDescription]
            : ["Siga o movimento com controle e respire durante cada repetição."]);
  const missionMediaStyle = resolveMissionMediaStyle(missionMediaUrl);
  const detailMissionMediaStyle = resolveMissionMediaStyle(detailMissionMediaUrl);
  const detailIsTrackableWalkingMission = (detailMetricType === "steps" || detailMetricType === "distance_meters") && missionDetails.type === "daily";
  const detailIsCircuitMission = detailMetricType === "circuit_tasks";
  const showMissionDuration = shouldShowMissionDuration(mission.type)
    && typeof mission.duration_estimate_minutes === "number"
    && mission.duration_estimate_minutes > 0;
  const showDetailDuration = shouldShowMissionDuration(missionDetails.type)
    && typeof missionDetails.duration_estimate_minutes === "number"
    && missionDetails.duration_estimate_minutes > 0;
  const compactDurationLabel = showMissionDuration ? `${mission.duration_estimate_minutes} min` : null;
  const compactXpLabel = `+${mission.xp_reward} XP`;
  const cardTitle = resolveMissionDisplayTitle(mission.title);
  const cardDescription = mission.description
    ? (localizeMissionText(mission.description) ?? mission.description)
    : null;
  const compactSummary = isWeeklyMission
    ? [`${autoProgressCurrentTotal}/${autoProgressRequiredTotal || 1} tarefas`, compactXpLabel].join(" | ")
    : isMonthlyMission && circuitTasks.length > 0
      ? [`${autoProgressCurrentTotal}/${autoProgressRequiredTotal || 1} tarefas`, compactXpLabel].join(" | ")
      : isMonthlyMission
        ? [formatProgressAmount(mission, metricType, monthlyCurrent, monthlyTarget), compactXpLabel].join(" | ")
        : isCircuitMission
          ? [compactDurationLabel, `${circuitTasks.length || monthlyTarget} tarefas`].filter(Boolean).join(" | ")
          : [compactDurationLabel, formatGoal(mission, metricType)].filter(Boolean).join(" | ");
  const compactActionLabel = isAutoProgressMission ? "Ver progresso" : isTrackableWalkingMission ? "Iniciar caminhada" : isCircuitMission ? "Ver detalhes" : "Iniciar treino";

  // Switches between the compact row layout and the richer card layout.
  const triggerContent = layout === "compact" ? (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}
        >
          <Dumbbell className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold" style={{ color: "var(--fl-color-text)" }}>
            {cardTitle}
          </h3>
          <p className="truncate text-[11px] font-medium" style={{ color: "var(--fl-color-text-muted)" }}>
            {compactSummary}
          </p>
        </div>
      </div>

      {isFailed ? (
        <span className="text-xs font-bold" style={{ color: "var(--fl-color-text-muted)" }}>
          Expirada
        </span>
      ) : isCompleted ? (
        <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: "var(--app-primary-color)" }} />
      ) : (
        <button
          type="button"
          onClick={() => { 
            if (isTrackableWalkingMission) {
              setShowWalkingExecution(true);
            } else {
              void openDetails();
            }
          }}
          disabled={completing}
          className="shrink-0 text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ color: "var(--app-primary-color)" }}
        >
          {completing ? "Finalizando..." : compactActionLabel}
        </button>
      )}
    </div>
  ) : (
    <Card
      tone="soft"
      className={`p-5 transition-all min-h-[280px] ${
        visualState === "failed"
          ? "border-2 border-red-200 bg-red-50 opacity-90"
          : visualState === "completed"
            ? "border-2 border-emerald-200 bg-emerald-50"
            : visualState === "in_progress"
              ? "border-2 border-teal-200 bg-teal-50/80"
              : "hover:shadow-xl"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`w-fit ${
            mission.type === "daily"
              ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
              : mission.type === "weekly"
                ? "bg-teal-100 text-teal-700 border border-teal-200"
                : "bg-cyan-100 text-cyan-700 border border-cyan-200"
          }`}>
            {missionTypeLabel}
          </Badge>
          <Badge className="w-fit bg-gray-100 text-gray-700 border border-gray-200">
            {primaryLabel}
          </Badge>
          {isAIMission ? (
            <Badge className="w-fit gap-1 bg-purple-100 text-purple-700 border border-purple-200">
              <Sparkles className="w-3 h-3" />
              IA
            </Badge>
          ) : null}
        </div>
        <Badge className={`w-fit ${
          visualState === "failed"
            ? "bg-red-100 text-red-700 border border-red-200"
            : visualState === "completed"
              ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
              : visualState === "in_progress"
                ? "bg-teal-100 text-teal-700 border border-teal-200"
                : "bg-gray-100 text-gray-700 border border-gray-200"
        }`}>
          {stateLabel}
        </Badge>
      </div>

      {!isAutoProgressMission && (missionMediaUrl || missionVideoUrl) ? (
        <div
          className="hidden sm:block relative w-full mb-3 aspect-video overflow-hidden rounded-2xl border"
          style={{ background: "#ffffff", borderColor: "var(--fl-border-soft)" }}
        >
          {missionVideoUrl ? (
            <video
              src={missionVideoUrl}
              poster={missionMediaUrl ?? undefined}
              className="absolute inset-0 h-full w-full object-contain"
              style={missionMediaStyle}
              autoPlay
              loop
              muted
              playsInline
            />
          ) : missionMediaUrl ? (
              <img
                src={missionMediaUrl}
                alt={cardTitle}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-contain"
              style={missionMediaStyle}
            />
          ) : null}
        </div>
      ) : null}

      <h3 className="font-semibold text-gray-900 mb-1">{cardTitle}</h3>
      <p className="text-sm text-gray-500 mb-2">{primaryLabel}</p>
      {!isAutoProgressMission && cardDescription ? <p className="text-sm text-gray-600 mb-3 line-clamp-2">{cardDescription}</p> : null}

      {isWeeklyMission ? (
        <div className="space-y-3 mb-3">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>Progresso do circuito semanal</span>
            <span>{autoProgressCurrentTotal}/{autoProgressRequiredTotal || 1}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${circuitProgress}%` }} />
          </div>
          <div className="space-y-2">
            {circuitTasks.map((task) => {
              const progress = task.required_count > 0
                ? Math.min(100, Math.round((task.current_count / task.required_count) * 100))
                : 0;
              return (
                <div key={task.id} className="rounded-xl border border-gray-200 p-2">
                  <div className="flex items-center justify-between text-xs text-gray-700 mb-1">
                    <span className="line-clamp-1">{localizeMissionText(task.label) ?? task.label}</span>
                    <span className="font-semibold">{task.current_count}/{task.required_count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-teal-500" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : isMonthlyMission ? (
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>Progresso mensal</span>
            <span>{monthlyProgressParts.current}/{monthlyProgressParts.target}{monthlyProgressParts.unitLabel ? ` ${monthlyProgressParts.unitLabel}` : ""}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-cyan-500" style={{ width: `${monthlyProgress}%` }} />
          </div>
        </div>
      ) : (
        <div className="space-y-1 mb-3">
          <p className="text-sm text-gray-600">Meta: {formatGoal(mission, metricType)}</p>
          {mission.rest_seconds ? <p className="text-xs text-gray-500">Descanso entre séries: {mission.rest_seconds}s</p> : null}
        </div>
      )}

      <div className={`grid gap-2 mb-3 ${showMissionDuration ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-2 text-center">
          <p className="text-[10px] text-emerald-700 uppercase tracking-wide">XP</p>
          <p className="text-sm font-bold text-emerald-700">+{mission.xp_reward}</p>
        </div>
        <div className="rounded-xl border border-teal-100 bg-teal-50 p-2 text-center">
          <p className="text-[10px] text-teal-700 uppercase tracking-wide">Pontos</p>
          <p className="text-sm font-bold text-teal-700">+{mission.points_reward}</p>
        </div>
        {showMissionDuration ? (
          <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-2 text-center">
            <p className="text-[10px] text-cyan-700 uppercase tracking-wide">Tempo</p>
            <p className="text-sm font-bold text-cyan-700">{mission.duration_estimate_minutes ?? 10} min</p>
          </div>
        ) : null}
      </div>

      {mission.deadline ? (
        <div className={`flex items-center gap-1 text-xs mb-3 ${isFailed ? "text-red-600" : "text-gray-500"}`}>
          <Clock3 className="w-3 h-3" />
          <span>{isFailed ? "Expirada/falhou" : "Em andamento"}</span>
        </div>
      ) : null}

      {isFailed ? (
        <div className="w-full py-3 text-center rounded-xl bg-red-100 text-red-700 font-medium">Missão falhou por expiração</div>
      ) : isCompleted ? (
        <div className="w-full py-3 text-center rounded-xl bg-emerald-100 text-emerald-700 font-medium">
          Missão concluída (+{mission.xp_reward} XP)
        </div>
      ) : (
        <Button 
          onClick={() => { 
            if (isTrackableWalkingMission) {
              setShowWalkingExecution(true);
            } else {
              void openDetails();
            }
          }} 
          variant="primary" 
          className="w-full py-3 rounded-xl shadow-md hover:shadow-lg" 
          disabled={completing}
        >
          {completing ? "Finalizando..." : isTrackableWalkingMission ? "Iniciar caminhada" : "Ver detalhes"}
        </Button>
      )}
    </Card>
  );

  return (
    <>
      {triggerContent}
      {showDetails && (
        <div className="fl-z-modal fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 md:p-8 overflow-y-auto">
          {/* Hosts the full mission-detail experience above the card grid. */}
          <div className="layout-content-container flex flex-col max-w-[600px] w-full rounded-xl shadow-2xl overflow-hidden relative" style={{ background: "var(--fl-surface-strong)", border: "1px solid color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
            
            {/* Keeps the detail header and close affordance pinned to the top of the modal. */}
            <header className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--fl-border-soft)" }}>
              <div className="flex items-center gap-3">
                <Dumbbell className="w-6 h-6" style={{ color: "var(--app-primary-color)" }} />
                <h2 className="text-xl font-bold tracking-tight" style={{ color: "var(--fl-color-text)" }}>Detalhes da Missão</h2>
              </div>
              <button 
                onClick={() => setShowDetails(false)}
                className="flex items-center justify-center rounded-full h-10 w-10 transition-colors opacity-70 hover:opacity-100"
                style={{ background: "var(--fl-surface-muted)", color: "var(--fl-color-text)" }}
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="overflow-y-auto pb-32 min-h-[50vh] max-h-[75vh]">
              <div className="px-6 py-4">
                {!detailIsAutoProgressMission ? (
                  <div
                    className="relative w-full aspect-video rounded-xl overflow-hidden group border"
                    style={{ background: "#ffffff", borderColor: "var(--fl-border-soft)" }}
                  >
                    {detailMissionVideoUrl ? (
                      <video
                        src={detailMissionVideoUrl}
                        poster={detailMissionMediaUrl ?? undefined}
                        className="absolute inset-0 h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                        style={detailMissionMediaStyle}
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                    ) : detailMissionMediaUrl ? (
                      <img
                        src={detailMissionMediaUrl}
                        alt={detailTitle}
                        className="absolute inset-0 h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
                        style={detailMissionMediaStyle}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Dumbbell className="w-16 h-16 opacity-50" style={{ color: "var(--app-primary-color)" }} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute bottom-4 left-4">
                      <span className="rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-black" style={{ background: "var(--app-primary-color)" }}>
                        {stateLabel}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Summarizes the mission identity, difficulty, and load state. */}
              <div className="px-6 py-2">
                <h1 className="text-3xl font-black leading-tight" style={{ color: "var(--fl-color-text)" }}>{detailTitle}</h1>
                <p className="hidden text-base font-medium mt-1" style={{ color: "var(--app-primary-color)" }}>
                  Dificuldade: {missionDetails.difficulty_level ? missionDetails.difficulty_level.charAt(0).toUpperCase() + missionDetails.difficulty_level.slice(1) : "Iniciante"} • Est. {missionDetails.duration_estimate_minutes ?? 10} min
                </p>
                <p className="text-base font-medium mt-1" style={{ color: "var(--app-primary-color)" }}>
                  {[
                    `Dificuldade: ${formatDifficultyLabel(missionDetails.difficulty_level)}`,
                    detailIsAutoProgressMission
                      ? "Progresso automático"
                      : showDetailDuration
                        ? `Est. ${missionDetails.duration_estimate_minutes ?? 10} min`
                        : null,
                  ].filter(Boolean).join(" • ")}
                </p>
                {detailsLoading ? (
                  <div className="flex items-center gap-2 text-sm mt-3" style={{ color: "var(--fl-color-text-muted)" }}>
                    <LoadingBall size="sm" />
                    Carregando detalhes...
                  </div>
                ) : null}
                {detailsError ? (
                  <p className="text-sm text-red-600 mt-2">{detailsError}</p>
                ) : null}
              </div>

              {/* Shows either automatic-progress tracking or the manual execution briefing. */}
              {detailIsAutoProgressMission ? (
                <div className="px-6 pt-6">
                  <div
                    className="rounded-[28px] border p-5 space-y-4"
                    style={{
                      background: "linear-gradient(180deg, color-mix(in srgb, var(--app-primary-color) 14%, transparent), color-mix(in srgb, var(--fl-surface-muted) 72%, transparent))",
                      borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: "var(--app-primary-color)" }}>
                          {detailIsWeeklyMission ? "Circuito semanal" : "Meta mensal"}
                        </p>
                      </div>
                      <Badge className="shrink-0 border-0" style={{ background: "color-mix(in srgb, var(--app-primary-color) 14%, transparent)", color: "var(--app-primary-color)" }}>
                        {Math.round(detailHasTaskProgressMission ? detailCircuitProgress : detailMonthlyProgress)}%
                      </Badge>
                    </div>

                    {detailHasTaskProgressMission ? (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold" style={{ color: "var(--fl-color-text-muted)" }}>
                            <span>{detailIsWeeklyMission ? "Progresso geral" : "Progresso mensal"}</span>
                            <span>{detailAutoProgressCurrentTotal}/{detailAutoProgressRequiredTotal || 1}</span>
                          </div>
                          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }}>
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${detailCircuitProgress}%`,
                                background: detailIsWeeklyMission ? "linear-gradient(90deg, #10b981, #14b8a6)" : "linear-gradient(90deg, #06b6d4, #22d3ee)",
                              }}
                            />
                          </div>
                        </div>

                        <div className="space-y-3">
                          {detailCircuitTasks.map((task) => {
                            const taskProgress = task.required_count > 0
                              ? Math.min(100, Math.round((task.current_count / task.required_count) * 100))
                              : 0;
                            return (
                              <div
                                key={task.id}
                                className="rounded-2xl border p-3"
                                style={{
                                  background: "color-mix(in srgb, var(--fl-surface-strong) 84%, transparent)",
                                  borderColor: "var(--fl-border-soft)",
                                }}
                              >
                                <div className="flex items-center justify-between gap-3 mb-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <CheckCircle2
                                      className="w-4 h-4 shrink-0"
                                      style={{ color: task.completed ? "var(--app-primary-color)" : "var(--fl-color-text-muted)" }}
                                    />
                                    <span className="text-sm font-semibold line-clamp-2" style={{ color: "var(--fl-color-text)" }}>
                                      {localizeMissionText(task.label) ?? task.label}
                                    </span>
                                  </div>
                                  <span className="text-xs font-bold shrink-0" style={{ color: "var(--fl-color-text-muted)" }}>
                                    {task.current_count}/{task.required_count}
                                  </span>
                                </div>
                                <div className="h-2 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }}>
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${taskProgress}%`,
                                      background: task.completed ? "var(--app-primary-color)" : (detailIsWeeklyMission ? "#14b8a6" : "#22d3ee"),
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold" style={{ color: "var(--fl-color-text-muted)" }}>
                            <span>Progresso mensal</span>
                            <span>{detailMonthlyProgressParts.current}/{detailMonthlyProgressParts.target}{detailMonthlyProgressParts.unitLabel ? ` ${detailMonthlyProgressParts.unitLabel}` : ""}</span>
                          </div>
                          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--fl-color-text) 10%, transparent)" }}>
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${detailMonthlyProgress}%`,
                                background: "linear-gradient(90deg, #06b6d4, #22d3ee)",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {!detailIsAutoProgressMission ? (
                <>
                  <div className="px-6 pt-6">
                    <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                      <Dumbbell className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                      Músculos Alvo
                    </h3>
                    <div className="flex gap-2 flex-wrap">
                      {detailFocusLabels.map((label, idx) => (
                        <div
                          key={`${label}-${idx}`}
                          className="flex items-center gap-2 rounded-full px-4 py-1.5 border"
                          style={{ background: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}
                        >
                          <span className="font-semibold text-sm" style={{ color: "var(--app-primary-color)" }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="px-6 pt-8">
                    <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                      <Info className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                      Execução
                    </h3>
                    <div className="space-y-3">
                      {instructionList.map((step, index) => (
                        <div
                          key={`${step}-${index}`}
                          className="flex gap-3 rounded-2xl border p-3"
                          style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "var(--fl-border-soft)" }}
                        >
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black"
                            style={{ background: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)", color: "var(--app-primary-color)" }}
                          >
                            {index + 1}
                          </span>
                          <p className="text-sm leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}>
                            {step}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {safetyTips && safetyTips.length > 0 ? (
                    <div className="px-6 pt-8">
                      <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                        <Sparkles className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                        Instruções de Segurança
                      </h3>
                      <div className="space-y-3">
                        {safetyTips.map((tip, index) => (
                          <div
                            key={`${tip}-${index}`}
                            className="flex gap-3 p-3 rounded-lg border"
                            style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "var(--fl-border-soft)" }}
                          >
                            <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: "var(--app-primary-color)" }} />
                            <p className="text-sm" style={{ color: "var(--fl-color-text-muted)" }}>{tip}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {/* Highlights the rewards tied to completing the mission. */}
              <div className="px-6 pt-8 pb-4">
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                  <Trophy className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                  Recompensas
                </h3>
                <div className={`grid gap-4 ${detailIsAutoProgressMission ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
                  <div className="min-w-0 p-4 rounded-xl flex items-center gap-4 border" style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                      <Star className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] sm:text-xs font-bold uppercase leading-tight break-words" style={{ color: "color-mix(in srgb, var(--app-primary-color) 60%, var(--fl-color-text))" }}>Experiência</p>
                      <p className="text-[clamp(0.95rem,4vw,1.125rem)] font-bold leading-tight break-words tabular-nums" style={{ color: "var(--fl-color-text)" }}>+{missionDetails.xp_reward} XP</p>
                    </div>
                  </div>
                  {!detailIsAutoProgressMission ? (
                    <div className="min-w-0 p-4 rounded-xl flex items-center gap-4 border" style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                        <Trophy className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] sm:text-xs font-bold uppercase leading-tight break-words" style={{ color: "color-mix(in srgb, var(--app-primary-color) 60%, var(--fl-color-text))" }}>FitCoins</p>
                        <p className="text-[clamp(0.95rem,4vw,1.125rem)] font-bold leading-tight break-words tabular-nums" style={{ color: "var(--fl-color-text)" }}>{missionDetails.points_reward}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Anchors the primary action that closes, continues, or starts the mission. */}
            <div className="absolute bottom-0 left-0 right-0 p-6 backdrop-blur-md flex flex-col items-center" style={{ borderTop: "1px solid var(--fl-border-soft)", background: "color-mix(in srgb, var(--fl-surface-strong) 92%, transparent)" }}>
              <button 
                onClick={() => {
                  if (detailIsAutoProgressMission || detailIsCircuitMission || detailIsCompleted || visualState === "failed") {
                    setShowDetails(false);
                  } else {
                    setShowDetails(false);
                    if (detailIsTrackableWalkingMission) {
                      setShowWalkingExecution(true);
                    } else {
                      setShowExecution(true);
                    }
                  }
                }}
                className="w-full text-black font-black text-lg py-4 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3 relative z-10"
                style={{ 
                  background: "var(--app-primary-color)", 
                  boxShadow: "0 0 20px color-mix(in srgb, var(--app-primary-color) 25%, transparent)" 
                }}
              >
                {!detailIsCircuitMission && !detailIsAutoProgressMission && !detailIsCompleted && visualState !== "failed" ? <Play className="w-6 h-6 fill-black text-black" strokeWidth={1.5} /> : null}
                {detailIsCompleted
                  ? "CONCLUÍDA"
                  : visualState === "failed"
                    ? "FECHAR"
                    : detailIsAutoProgressMission || detailIsCircuitMission
                      ? "FECHAR"
                      : isInProgress
                        ? "CONTINUAR"
                        : detailIsTrackableWalkingMission
                          ? "INICIAR CAMINHADA"
                          : "INICIAR MISSÃO"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Opens the exercise execution flow only for trackable, non-auto-progress training missions. */}
      {!detailIsCircuitMission && !detailIsTrackableWalkingMission && !detailIsAutoProgressMission && (
        <MissionExecutionModal
          mission={missionDetails}
          metricType={detailMetricType}
          open={showExecution}
          onClose={() => setShowExecution(false)}
          onFinish={completeMission}
        />
      )}

      {/* Routes walking missions to the dedicated tracking experience. */}
      {showWalkingExecution && detailIsTrackableWalkingMission && (
        <WalkingMissionExecution
          mission={missionDetails}
          onComplete={async (id, value, verified) => {
            await onComplete(id, value, verified);
            setShowWalkingExecution(false);
          }}
          onClose={() => setShowWalkingExecution(false)}
        />
      )}

      {/* Keeps a lightweight footer context visible while the detail modal is open. */}
      {showDetails && !detailIsAutoProgressMission && (
        <div className="fl-z-modal fixed bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-500 flex items-center gap-2">
          <MapPinned className="w-3 h-3" />
          <span>{detailFocusLabels[0] ?? bodyAreaLabel(missionDetails.body_area)}</span>
          <Trophy className="w-3 h-3" />
          <span>{missionDetails.xp_reward} XP</span>
        </div>
      )}
    </>
  );
}

const MissionCard = memo(MissionCardComponent);
export default MissionCard;
