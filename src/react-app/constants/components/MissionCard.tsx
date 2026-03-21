/**
 * MissionCard Component - Versão limpa e funcional
 * Integrado com APIs de saúde e mapas para missões de caminhada/corrida
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
import { useAppChrome } from "@/react-app/contexts/appChrome";
import LoadingBall from "@/react-app/components/LoadingBall";
import { formatMissionGoal, shouldShowMissionDuration } from "@/constants/missionMetrics";
import type { CircuitTask, Mission, MissionMetricType } from "@/shared/types";
import { localizeMissionText, localizeMissionTextArray, normalizeMissionMediaUrl } from "@/shared/missionLocalization";
import { api } from "@/react-app/utils/api";
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
  return mission.circuitTasks
    .filter((task) =>
      typeof task.id === "string" &&
      typeof task.label === "string" &&
      typeof task.mission_type === "string" &&
      typeof task.required_count === "number" &&
      typeof task.current_count === "number" &&
      typeof task.completed === "boolean"
    )
    .map((task) => ({
      ...task,
      label: localizeMissionText(task.label) ?? task.label,
    }));
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

function formatProgressAmount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("pt-BR");
}

function resolveMissionGoalText(mission: Mission, metricType: MissionMetricType): string {
  if (typeof mission.goal === "string" && mission.goal.trim().length > 0) {
    return mission.goal;
  }
  return formatGoal(mission, metricType);
}

function localizeDifficulty(difficulty: string | null | undefined): string {
  if (!difficulty) return "Iniciante";
  const localized = localizeMissionText(difficulty) ?? difficulty;
  const normalized = localized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("avanc")) return "Avançado";
  if (normalized.includes("inter")) return "Intermediário";
  if (normalized.includes("sedent")) return "Sedentário";
  if (normalized.includes("inic")) return "Iniciante";

  return localized.charAt(0).toUpperCase() + localized.slice(1);
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

function resolveMissionMediaUrl(mission: Mission): string | null {
  const primaryImage = normalizeMissionMediaUrl(mission.image_url);
  const ascendGif = isGifUrl(primaryImage) ? primaryImage : null;
  const exerciseDbGif = normalizeMissionMediaUrl(mission.exercise_db_gif_url);
  const thumbnail = normalizeMissionMediaUrl(mission.thumbnail_url);
  const exerciseDbImage = normalizeMissionMediaUrl(mission.exercise_db_image_url);
  const videoUrl = normalizeMissionMediaUrl(mission.video_url);

  return ascendGif
    ?? exerciseDbGif
    ?? exerciseDbImage
    ?? thumbnail
    ?? videoUrl;
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

  const sets = Math.max(1, Number(mission.sets ?? 1));
  const restSecondsConfigured = Math.max(0, Number(mission.rest_seconds ?? 0));
  const totalGoal = missionTotalGoal(mission, metricType);
  const setDuration = isTimeMission ? totalGoal : Math.max(1, Math.floor(totalGoal / sets));
  const isTimeMission = metricType === "duration_seconds" || metricType === "duration_minutes";
  const isCounterMission = metricType === "repetitions" || metricType === "sets_reps";
  const isDistanceMission = metricType === "steps" || metricType === "distance_meters";
  const initialExecutionState = useMemo<MissionExecutionState>(() => ({
    ...DEFAULT_EXECUTION_STATE,
    remainingSeconds: setDuration,
    running: isTimeMission,
  }), [isTimeMission, setDuration]);

  useEffect(() => {
    if (!open) return;
    setState(initialExecutionState);
  }, [initialExecutionState, open]);

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

        const nextSet = current.currentSet + 1;
        if (nextSet <= sets) {
          return {
            ...current,
            currentSet: nextSet,
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

  useEffect(() => {
    if (!open) return;
    if (!state.running) return;

    const isCounterMission = metricType === "repetitions" || metricType === "sets_reps";
    if (!isCounterMission) return;

    const timer = window.setInterval(() => {
      setState((current) => {
        if (!current.running || current.finished) return current;
        if (current.repsDone >= setDuration) {
          const nextSet = current.currentSet + 1;
          if (nextSet <= sets) {
            return {
              ...current,
              currentSet: nextSet,
              repsDone: 0,
              totalRepsDone: current.totalRepsDone + current.repsDone,
              resting: restSecondsConfigured > 0,
              running: restSecondsConfigured > 0,
              restSeconds: restSecondsConfigured,
              remainingSeconds: restSecondsConfigured > 0 ? 0 : setDuration,
            };
          }
          return {
            ...current,
            running: false,
            resting: false,
            finished: true,
            totalRepsDone: current.totalRepsDone + current.repsDone,
            repsDone: 0,
          };
        }
        return current;
      });
    }, 100);

    return () => window.clearInterval(timer);
  }, [metricType, open, restSecondsConfigured, setDuration, sets, state.running, state.finished]);

  const incrementReps = useCallback(() => {
    if (state.finished || state.resting) return;
    setState((current) => ({
      ...current,
      repsDone: Math.min(current.repsDone + 1, setDuration),
    }));
  }, [setDuration, state.finished, state.resting]);

  const decrementReps = useCallback(() => {
    if (state.finished || state.resting) return;
    setState((current) => ({
      ...current,
      repsDone: Math.max(0, current.repsDone - 1),
    }));
  }, [state.finished, state.resting]);

  const finishSet = useCallback(() => {
    setState((current) => {
      if (current.finished || current.resting) return current;

      const nextSet = current.currentSet + 1;
      if (nextSet <= sets) {
        return {
          ...current,
          currentSet: nextSet,
          repsDone: 0,
          totalRepsDone: current.totalRepsDone + current.repsDone,
          resting: restSecondsConfigured > 0,
          running: restSecondsConfigured > 0,
          restSeconds: restSecondsConfigured,
          remainingSeconds: restSecondsConfigured > 0 ? 0 : setDuration,
        };
      }

      return {
        ...current,
        running: false,
        resting: false,
        finished: true,
        totalRepsDone: current.totalRepsDone + current.repsDone,
        repsDone: 0,
        remainingSeconds: 0,
        restSeconds: 0,
      };
    });
  }, [setDuration, sets, restSecondsConfigured]);

  const resetExecution = useCallback(() => {
    setState(initialExecutionState);
  }, [initialExecutionState]);

  const toggleRunning = useCallback(() => {
    setState((current) => {
      if (current.finished || isDistanceMission) return current;
      return { ...current, running: !current.running };
    });
  }, [isDistanceMission]);

  const canFinishInputMission = isDistanceMission && Number(state.inputValue) > 0;
  const totalCounterProgress = state.totalRepsDone + state.repsDone;
  const canFinishCounterMission = isCounterMission && state.finished;
  const canFinishMission = isDistanceMission ? canFinishInputMission : isTimeMission ? state.finished : canFinishCounterMission;
  
  const finishMission = async () => {
    if (!canFinishMission) return;
    const value = isDistanceMission
      ? Number(state.inputValue)
      : isCounterMission
        ? Math.max(totalGoal, totalCounterProgress)
        : totalGoal;
    await onFinish(value);
  };

  let activeProgress = 0;
  if (isTimeMission) {
    const completedSets = Math.max(0, state.currentSet - 1);
    const currentSetProgress = state.resting
      ? 0
      : setDuration > 0
        ? Math.max(0, (setDuration - state.remainingSeconds) / setDuration)
        : 0;
    activeProgress = ((completedSets + currentSetProgress) / sets) * 100;
  } else if (isCounterMission) {
    activeProgress = Math.min(100, (totalCounterProgress / totalGoal) * 100 || 0);
  } else if (isDistanceMission) {
    activeProgress = Math.min(100, (Number(state.inputValue || 0) / totalGoal) * 100 || 0);
  } else {
    const completedSets = Math.max(0, state.currentSet - 1);
    activeProgress = (completedSets / sets) * 100;
  }

  activeProgress = Math.max(0, Math.min(100, activeProgress));

  const missionVideoUrl = normalizeMissionMediaUrl(mission.video_url);
  const missionMediaUrl = resolveMissionMediaUrl(mission);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="relative">
          {missionMediaUrl && (
            <div className="relative aspect-video bg-gray-100">
              {isGifUrl(missionMediaUrl) ? (
                <img
                  src={missionMediaUrl}
                  alt={mission.title}
                  className="w-full h-full object-cover"
                  loading="eager"
                />
              ) : (
                <img
                  src={missionMediaUrl}
                  alt={mission.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center backdrop-blur-[2px]" style={{ backgroundColor: "rgba(0, 0, 0, 0.32)" }}>
                <button
                  type="button"
                  onClick={toggleRunning}
                  className="size-14 sm:size-20 rounded-full flex items-center justify-center hover:scale-110 transition-transform shadow-xl"
                  style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)", boxShadow: "0 20px 25px -5px color-mix(in srgb, var(--app-primary-color) 30%, transparent)" }}
                >
                  {state.running && !state.resting ? (
                    <Pause className="w-6 h-6 sm:w-8 sm:h-8 fill-current" strokeWidth={1} />
                  ) : (
                    <Play className="w-6 h-6 sm:w-8 sm:h-8 fill-current ml-1" strokeWidth={1} />
                  )}
                </button>
              </div>
            </div>
          )}
          
          {/* Input Overlay for Distance Missions inside Media area or just below */}
          {isDistanceMission && (
               <div className="mt-6 w-full max-w-md space-y-3">
                 <p className="text-sm text-center" style={{ color: "var(--fl-color-text-muted)" }}>
                   Registre o valor atingido (Passos ou Metros)
                 </p>
                 <input
                   type="number"
                   className="w-full rounded-xl border-2 bg-transparent px-4 py-3 text-center text-xl font-bold focus:outline-none"
                   style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 30%, transparent)", color: "var(--app-primary-color)" }}
                   placeholder={metricType === "steps" ? "Passos" : "Metros"}
                   value={state.inputValue}
                   onChange={(event) => setState((current) => ({ ...current, inputValue: event.target.value }))}
                   min={0}
                 />
               </div>
            )}
            
            <div className="absolute top-4 right-4 flex gap-1 sm:gap-2 shrink-0">
              <button type="button" className="flex size-8 sm:size-10 items-center justify-center rounded-full border transition-opacity hover:opacity-80" onClick={resetExecution} style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                <Info className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button type="button" className="flex size-8 sm:size-10 items-center justify-center rounded-full border transition-opacity hover:opacity-80" onClick={onClose} style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>

          <main className="p-6 space-y-6">
            <header className="text-center">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight truncate">FitLoot</h2>
            </header>

            <div className="space-y-4">
              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-bold" style={{ color: "var(--app-primary-color)" }}>
                  {localizeMissionText(mission.title) ?? mission.title}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  {resolveMissionGoalText(mission, metricType)}
                </div>
              </div>

              <div className="relative">
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div 
                    className="h-full transition-all duration-500 ease-out"
                    style={{ 
                      width: `${activeProgress}%`,
                      backgroundColor: "var(--app-primary-color)"
                    }}
                  />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-medium text-gray-700">
                    {Math.round(activeProgress)}%
                  </span>
                </div>
              </div>

              {isTimeMission && (
                <div className="text-center">
                  <div className="text-4xl sm:text-5xl font-bold tabular-nums" style={{ color: "var(--app-primary-color)" }}>
                    {Math.floor(state.remainingSeconds / 60)}:{(state.remainingSeconds % 60).toString().padStart(2, "0")}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    {state.resting ? "Descanso" : `Série ${state.currentSet} de ${sets}`}
                  </div>
                </div>
              )}

              {isCounterMission && (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="text-4xl sm:text-5xl font-bold tabular-nums" style={{ color: "var(--app-primary-color)" }}>
                      {state.repsDone}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      Repetições nesta série
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      type="button"
                      onClick={decrementReps}
                      disabled={state.finished || state.resting}
                      className="size-12 rounded-full border-2 flex items-center justify-center hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      style={{ borderColor: "var(--app-primary-color)", color: "var(--app-primary-color)" }}
                    >
                      <span className="text-xl font-bold">-</span>
                    </button>
                    <button
                      type="button"
                      onClick={incrementReps}
                      disabled={state.finished || state.resting}
                      className="size-12 rounded-full border-2 flex items-center justify-center hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      style={{ borderColor: "var(--app-primary-color)", color: "var(--app-primary-color)" }}
                    >
                      <span className="text-xl font-bold">+</span>
                    </button>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold">
                      Total: {totalCounterProgress} / {totalGoal}
                    </div>
                    <div className="text-sm text-gray-600">
                      Série {state.currentSet} de {sets}
                    </div>
                  </div>
                </div>
              )}

              {isCounterMission && (
                <button 
                  className="w-full py-3 rounded-xl font-bold text-sm sm:text-base border transition-colors active:scale-95 hover:bg-white/10"
                  style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 82%, transparent)", borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}
                  onClick={finishSet}
                  disabled={state.finished || state.resting}
                >
                  {state.resting ? "Descansando..." : "Finalizar Série"}
                </button>
              )}
            </div>

            <div className="flex gap-3">
              <button 
                className="h-10 sm:h-14 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm md:text-base flex items-center justify-center gap-1 sm:gap-2 border transition-colors active:scale-95 hover:bg-white/10 truncate"
                style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 82%, transparent)", borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}
                onClick={toggleRunning}
                disabled={state.finished || isDistanceMission}
              >
                {state.running ? <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-current" strokeWidth={1} /> : <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current" strokeWidth={1} />}
                {isDistanceMission ? "SEM TIMER" : state.running ? "PAUSAR" : "RETOMAR"}
              </button>
              
              <button 
                className="flex-1 h-10 sm:h-14 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm md:text-base flex items-center justify-center gap-1 sm:gap-2 transition-colors active:scale-95 truncate"
                style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}
                onClick={finishMission}
                disabled={!canFinishMission}
              >
                <Square className="w-3 h-3 sm:w-4 sm:h-4 fill-current" strokeWidth={2} />
                {isDistanceMission ? "REGISTRAR" : "FINALIZAR"}
              </button>
            </div>
          </div>
        </main>
      </div>
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

  const metricType = useMemo(() => normalizeMetricType(mission), [mission]);
  const missionStatus = (mission as Mission & { status?: string | undefined }).status || (mission.is_completed === 1 ? "completed" : "pending");
  const isFailed = missionStatus === "failed" || missionStatus === "expired";
  const isCompleted = mission.is_completed === 1 || missionStatus === "completed";
  const isCircuitMission = metricType === "circuit_tasks";
  
  const missionDetails = detailedMission ?? mission;
  const detailMetricType = normalizeMetricType(missionDetails);
  const isWalkingMission = detailMetricType === "steps" || detailMetricType === "distance_meters";
  const isAutoProgressMission = mission.type === "weekly" || mission.type === "monthly";
  const visualState = missionStatus === "completed" ? "completed" : missionStatus === "failed" ? "failed" : "pending";
  const isInProgress = missionStatus === "in_progress";

  const finishMission = useCallback(async (value: number) => {
    setCompleting(true);
    try {
      await onComplete(mission.id, value, true);
      setShowExecution(false);
      setShowDetails(false);
    } finally {
      setCompleting(false);
    }
  }, [mission.id, onComplete]);

  useEffect(() => {
    setMissionDetailsOpen(showDetails);
    return () => {
      setMissionDetailsOpen(false);
    };
  }, [setMissionDetailsOpen, showDetails]);

  useEffect(() => {
    setMissionExecutionOpen(showExecution);
    return () => {
      setMissionExecutionOpen(false);
    };
  }, [setMissionExecutionOpen, showExecution]);

  return (
    <>
      {/* Mission Card */}
      <Card className="relative overflow-hidden transition-all duration-300 hover:shadow-lg" style={{ backgroundColor: "var(--fl-surface-card)" }}>
        <div className="relative">
          {/* Card Header */}
          <div className="p-6 pb-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--fl-color-text-primary)" }}>
                  {localizeMissionText(mission.title) ?? mission.title}
                </h3>
                <p className="text-sm" style={{ color: "var(--fl-color-text-secondary)" }}>
                  {resolveMissionGoalText(mission, metricType)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isCompleted && (
                  <div className="p-2 rounded-full bg-green-100">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                )}
                {isFailed && (
                  <div className="p-2 rounded-full bg-red-100">
                    <X className="w-5 h-5 text-red-600" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card Body */}
          <div className="px-6 pb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: "var(--app-primary-color)" }}>
                    {mission.xp_reward}
                  </div>
                  <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>XP</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: "var(--app-primary-color)" }}>
                    {mission.points_reward}
                  </div>
                  <div className="text-xs" style={{ color: "var(--fl-color-text-muted)" }}>FC</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" style={{ borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}>
                  {localizeDifficulty(mission.difficulty_level)}
                </Badge>
                {mission.body_area && (
                  <Badge variant="outline" style={{ borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}>
                    {bodyAreaLabel(mission.body_area)}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="p-6 pt-0">
            <button 
              onClick={() => {
                if (isAutoProgressMission || isCompleted || visualState === "failed") {
                  setShowDetails(false);
                } else if (isWalkingMission) {
                  setShowDetails(false);
                  setShowWalkingExecution(true);
                } else {
                  setShowDetails(false);
                  setShowExecution(true);
                }
              }}
              className="w-full py-3 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ 
                backgroundColor: isCompleted ? "var(--fl-surface-strong)" : "var(--app-primary-color)", 
                color: isCompleted ? "var(--fl-color-text-muted)" : "var(--fl-nav-item-active-text)"
              }}
              disabled={isCompleted || isFailed}
            >
              {!isAutoProgressMission && !isCompleted && visualState !== "failed" && <Play className="w-4 h-4" />}
              {isCompleted ? "CONCLUÍDA" : visualState === "failed" ? "FECHAR" : isAutoProgressMission ? "FECHAR" : isInProgress ? "CONTINUAR" : isWalkingMission ? "INICIAR CAMINHADA" : "INICIAR MISSÃO"}
            </button>
          </div>
        </div>
      </Card>

      {/* Standard Mission Execution Modal */}
      {showExecution && !isWalkingMission && (
        <MissionExecutionModal
          mission={mission}
          metricType={metricType}
          open={showExecution}
          onClose={() => setShowExecution(false)}
          onFinish={finishMission}
        />
      )}

      {/* Walking Mission Execution Modal */}
      {showWalkingExecution && isWalkingMission && (
        <WalkingMissionExecution
          mission={mission}
          onComplete={async (id, value, verified) => {
            await onComplete(id, value, verified);
            setShowWalkingExecution(false);
          }}
          onClose={() => setShowWalkingExecution(false)}
        />
      )}
    </>
  );
}

export default memo(MissionCardComponent);
