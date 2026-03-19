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
import { formatMissionGoal } from "@/constants/missionMetrics";
import type { CircuitTask, Mission, MissionMetricType } from "@/shared/types";
import { api } from "@/react-app/utils/api";

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

function resolveMissionMediaUrl(mission: Mission): string | null {
  const primaryImage = mission.image_url ?? null;
  const ascendGif = isGifUrl(primaryImage) ? primaryImage : null;

  return ascendGif
    ?? mission.exercise_db_gif_url
    ?? (mission.video_url ? (mission.thumbnail_url ?? null) : null)
    ?? mission.exercise_db_image_url
    ?? primaryImage
    ?? mission.thumbnail_url
    ?? null;
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
  const totalTimeSeconds = metricType === "duration_minutes" ? totalGoal * 60 : totalGoal;
  const setGoal = metricType === "sets_reps" ? Math.max(1, Math.floor(totalGoal / sets)) : Math.max(1, totalGoal);
  const setDuration = metricType === "duration_seconds" || metricType === "duration_minutes"
    ? Math.max(1, Math.floor(totalTimeSeconds / sets))
    : 0;
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

  const advanceTimedSet = () => {
    setState((current) => {
      if (!isTimeMission) return current;
      if (current.currentSet >= sets) {
        return {
          ...current,
          remainingSeconds: 0,
          restSeconds: 0,
          resting: false,
          running: false,
          finished: true,
        };
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

  const resetExecution = () => {
    setState(initialExecutionState);
  };

  const toggleRunning = () => {
    setState((current) => {
      if (current.finished || isDistanceMission) return current;
      return { ...current, running: !current.running };
    });
  };

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

  if (!open) return null;

  const detailMissionMediaUrl = resolveMissionMediaUrl(mission);
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

  return (
    <div className="fl-z-mission-screen fixed inset-0 flex flex-col overflow-x-hidden font-display antialiased min-w-0" style={{ backgroundColor: "var(--app-bg-color)", color: "var(--fl-color-text)" }}>
      <div className="layout-container flex h-full grow flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-3 py-2 sm:px-4 sm:py-3 md:px-6 md:py-4" style={{ borderColor: "var(--fl-border-soft)" }}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex size-7 sm:size-8 items-center justify-center rounded shrink-0" style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}>
              <Dumbbell className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={2.5} />
            </div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight truncate">FitLoot</h2>
          </div>
          <div className="flex gap-1 sm:gap-2 shrink-0">
            <button type="button" className="flex size-8 sm:size-10 items-center justify-center rounded-full border transition-opacity hover:opacity-80" onClick={resetExecution} style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
              <Info className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button type="button" className="flex size-8 sm:size-10 items-center justify-center rounded-full border transition-opacity hover:opacity-80" onClick={onClose} style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 max-w-2xl mx-auto w-full px-3 py-4 sm:px-6 sm:py-8 flex flex-col min-w-0">
          {/* Progress Bar */}
          <div className="mb-6 sm:mb-10">
            <div className="flex justify-between items-end mb-2 sm:mb-3 gap-2">
              <div className="min-w-0 overflow-hidden">
                <p className="text-[10px] sm:text-xs md:text-sm font-medium uppercase tracking-widest truncate" style={{ color: "var(--app-primary-color)" }}>Missão Ativa</p>
                <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold mt-0.5 sm:mt-1 truncate">{mission.title}</h1>
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
            {/* Rest Timer */}
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

            {/* Mission Media */}
            <div className="relative w-full max-w-md aspect-video overflow-hidden rounded-2xl border shadow-2xl" style={{ borderColor: "var(--fl-border-soft)", boxShadow: "var(--fl-shadow-glass)" }}>
              {mission.video_url ? (
                <video
                  src={mission.video_url}
                  poster={detailMissionMediaUrl ?? undefined}
                  className="absolute inset-0 h-full w-full object-cover"
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : detailMissionMediaUrl ? (
                <img src={detailMissionMediaUrl} alt={mission.title} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 60%, transparent)" }}>
                  <Dumbbell className="w-16 h-16 opacity-20" />
                </div>
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
              
              <div className="absolute bottom-2 sm:bottom-4 left-2 sm:left-4 right-2 sm:right-4 flex items-center justify-between gap-1">
                <span className="rounded-full border px-2 py-1 sm:px-4 sm:py-1.5 text-[9px] sm:text-xs font-bold backdrop-blur-md truncate" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 88%, transparent)", borderColor: "var(--fl-border-soft)" }}>
                  VERIFICAR FORMA
                </span>
                <span className="rounded-full border px-2 py-1 sm:px-4 sm:py-1.5 text-[9px] sm:text-xs font-bold backdrop-blur-md shrink-0" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 88%, transparent)", borderColor: "var(--fl-border-soft)" }}>
                  SÉRIE {state.currentSet}/{sets}
                </span>
              </div>
            </div>
            
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
            
            {/* Input Overlay for Reps Manual count */}
            {isCounterMission && !isTimeMission && (
               <div className="mt-4 sm:mt-6 w-full max-w-md flex flex-col items-center justify-center space-y-2 min-w-0">
                 <p className="text-[10px] sm:text-xs md:text-sm uppercase tracking-widest font-bold" style={{ color: "var(--app-primary-color)" }}>Repetições</p>
                 <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                    <button type="button" onClick={decrementRep} disabled={state.resting} className="size-10 sm:size-14 rounded-full border text-lg sm:text-2xl active:scale-95 disabled:opacity-50" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 78%, transparent)" }}>-</button>
                   <span className="text-3xl sm:text-5xl font-bold w-16 sm:w-20 text-center">{state.repsDone}</span>
                    <button type="button" onClick={incrementRep} disabled={state.resting} className="size-10 sm:size-14 rounded-full border text-lg sm:text-2xl active:scale-95 disabled:opacity-50" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 78%, transparent)" }}>+</button>
                 </div>
                 <p className="text-[10px] sm:text-xs text-center" style={{ color: "var(--fl-color-text-muted)" }}>
                   Meta da série: {setGoal} | Progresso: {totalCounterProgress}/{totalGoal}
                 </p>
               </div>
            )}
            
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4 mt-auto pt-4 sm:pt-8 min-w-0">
            <button 
              className="col-span-2 h-12 sm:h-16 rounded-xl sm:rounded-2xl font-bold text-base sm:text-xl flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale" 
              style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)", boxShadow: "0 10px 15px -3px color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}
              onClick={isCounterMission ? completeCurrentSet : advanceTimedSet}
              disabled={isCounterMission ? state.resting || state.repsDone <= 0 : state.finished}
            >
              <FastForward className="w-5 h-5 sm:w-6 sm:h-6 fill-current" strokeWidth={1} />
              PRÓXIMA SÉRIE
            </button>
            
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
              className="h-10 sm:h-14 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm md:text-base flex items-center justify-center gap-1 sm:gap-2 border transition-colors active:scale-95 disabled:opacity-50 disabled:grayscale truncate"
              style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 22%, transparent)", color: "var(--app-primary-color)" }}
              onClick={() => { void finishMission(); }}
              disabled={!canFinishMission}
            >
              <Square className="w-3 h-3 sm:w-4 sm:h-4 fill-current" strokeWidth={2} />
              {isDistanceMission ? "REGISTRAR" : "FINALIZAR"}
            </button>
          </div>
        </main>

        {/* Footer */}
        <footer className="mt-auto py-3 sm:py-6 flex justify-center uppercase tracking-[0.2em] sm:tracking-[0.3em] font-medium" style={{ color: "var(--fl-color-text-muted)", fontSize: 0 }}>
          <span className="text-[9px] sm:text-[10px]">Loot desta sessao: {sessionXp} / {mission.xp_reward} XP</span>
        </footer>
      </div>
    </div>
  );
}

function MissionCardComponent({ mission, onComplete, layout = "default" }: MissionCardProps) {
  const { setMissionDetailsOpen, setMissionExecutionOpen } = useAppChrome();
  const [showDetails, setShowDetails] = useState(false);
  const [showExecution, setShowExecution] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailedMission, setDetailedMission] = useState<Mission | null>(null);

  const metricType = useMemo(() => normalizeMetricType(mission), [mission]);
  const missionStatus = (mission as Mission & { status?: string | undefined }).status || (mission.is_completed === 1 ? "completed" : "pending");
  const isFailed = missionStatus === "failed";
  const isCompleted = mission.is_completed === 1 || missionStatus === "completed";
  const isCircuitMission = metricType === "circuit_tasks";
  const isWeeklyMission = mission.type === "weekly";
  const isMonthlyMission = mission.type === "monthly";
  const isAIMission = mission.mission_origin === "ai";
  const circuitTasks = useMemo(() => resolveCircuitTasks(mission), [mission]);
  const completedCircuitTasks = circuitTasks.filter((task) => task.completed).length;
  const circuitProgress = circuitTasks.length > 0 ? (completedCircuitTasks / circuitTasks.length) * 100 : 0;
  const missionMediaUrl = resolveMissionMediaUrl(mission);
  const primaryMuscle = mission.muscle_groups?.[0] ?? bodyAreaLabel(mission.body_area);
  const hasCircuitProgress = circuitTasks.some((task) => task.current_count > 0);
  const isInProgress = !isFailed && !isCompleted && (missionStatus === "in_progress" || hasCircuitProgress);
  const visualState = isFailed ? "failed" : isCompleted ? "completed" : isInProgress ? "in_progress" : "available";
  const stateLabel = visualState === "failed"
    ? "Falhou"
    : visualState === "completed"
      ? "Concluida"
      : visualState === "in_progress"
        ? "Em progresso"
        : "Disponivel";
  const missionTypeLabel = mission.type === "daily" ? "Diaria" : mission.type === "weekly" ? "Semanal" : "Mensal";
  const monthlyTarget = Math.max(1, missionTotalGoal(mission, metricType));
  const monthlyProgressValue = Number((mission as Mission & { progress_value?: number | undefined }).progress_value ?? 0);
  const monthlyCurrent = isCompleted ? monthlyTarget : Math.max(0, Math.min(monthlyTarget, monthlyProgressValue));
  const monthlyProgress = Math.min(100, Math.round((monthlyCurrent / monthlyTarget) * 100));
  const hasInlineInstructions =
    (Array.isArray(mission.instructions) && mission.instructions.length > 0) ||
    (Array.isArray(mission.exercise_instructions_pt) && mission.exercise_instructions_pt.length > 0) ||
    (Array.isArray(mission.exercise_instructions_en) && mission.exercise_instructions_en.length > 0);
  const hasInlineMuscles = Array.isArray(mission.muscle_groups) && mission.muscle_groups.length > 0;
  const hasInlineDetails = hasInlineInstructions && hasInlineMuscles && Array.isArray(mission.safety_tips) && mission.safety_tips.length > 0;

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
      setShowExecution(false);
      setShowDetails(false);
    } finally {
      setCompleting(false);
    }
  };

  const openDetails = async () => {
    setShowDetails(true);
    setDetailsError(null);
    await loadMissionDetails();
  };

  useEffect(() => {
    if (hasInlineDetails || detailedMission || detailsLoading) return;
    void loadMissionDetails({ silent: true });
  }, [detailedMission, detailsLoading, hasInlineDetails, loadMissionDetails]);

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

  const missionDetails = detailedMission ?? mission;
  const detailMetricType = normalizeMetricType(missionDetails);
  const detailMissionMediaUrl = resolveMissionMediaUrl(missionDetails);
  const safetyTips = Array.isArray(missionDetails.safety_tips) && missionDetails.safety_tips.length > 0
    ? missionDetails.safety_tips
    : ["Mantenha alinhamento postural e interrompa em caso de dor aguda."];
  const instructionList =
    (Array.isArray(missionDetails.instructions) && missionDetails.instructions.length > 0
      ? missionDetails.instructions
      : Array.isArray(missionDetails.exercise_instructions_pt) && missionDetails.exercise_instructions_pt.length > 0
        ? missionDetails.exercise_instructions_pt
        : Array.isArray(missionDetails.exercise_instructions_en) && missionDetails.exercise_instructions_en.length > 0
          ? missionDetails.exercise_instructions_en
          : missionDetails.description
            ? [missionDetails.description]
            : ["Siga o movimento com controle e respire durante cada repeticao."]);
  const pixelOrLineArt = isPixelOrLineArtUrl(detailMissionMediaUrl);
  const gifLikeMedia = isGifUrl(detailMissionMediaUrl);

  const compactDurationLabel = mission.duration_estimate_minutes && mission.duration_estimate_minutes > 0
    ? `${mission.duration_estimate_minutes} min`
    : null;
  const compactSummary = isCircuitMission
    ? [compactDurationLabel, `${circuitTasks.length || monthlyTarget} tarefas`].filter(Boolean).join(" | ")
    : [compactDurationLabel, formatGoal(mission, metricType)].filter(Boolean).join(" | ");
  const compactActionLabel = isCircuitMission ? "Ver detalhes" : "Iniciar Treino";
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
          <h3 className="truncate text-xs sm:text-sm md:text-base font-bold" style={{ color: "var(--fl-color-text)" }}>
            {mission.title}
          </h3>
          <p className="truncate text-[10px] sm:text-xs font-medium" style={{ color: "var(--fl-color-text-muted)" }}>
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
          onClick={() => { void openDetails(); }}
          disabled={completing}
          className="shrink-0 text-[10px] sm:text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ color: "var(--app-primary-color)" }}
        >
          {completing ? "Abrindo..." : compactActionLabel}
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
            {primaryMuscle}
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

      {!isWeeklyMission && missionMediaUrl ? (
        <div className="hidden sm:block w-full mb-3">
          <img
            src={missionMediaUrl}
            alt={mission.title}
            loading="lazy"
            decoding="async"
            className="w-full h-36 object-cover rounded-2xl border border-gray-200"
          />
        </div>
      ) : null}

      <h3 className="font-semibold text-gray-900 mb-1">{mission.title}</h3>
      <p className="text-sm text-gray-500 mb-2">{primaryMuscle}</p>
      {mission.description ? <p className="text-sm text-gray-600 mb-3 line-clamp-2">{mission.description}</p> : null}

      {isWeeklyMission ? (
        <div className="space-y-3 mb-3">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>Progresso geral</span>
            <span>{completedCircuitTasks}/{circuitTasks.length || 1}</span>
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
                    <span className="line-clamp-1">{task.label}</span>
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
            <span>{monthlyCurrent}/{monthlyTarget}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-cyan-500" style={{ width: `${monthlyProgress}%` }} />
          </div>
          <p className="text-sm text-gray-600">Meta: {formatGoal(mission, metricType)}</p>
        </div>
      ) : (
        <div className="space-y-1 mb-3">
          <p className="text-sm text-gray-600">Meta: {formatGoal(mission, metricType)}</p>
          {mission.rest_seconds ? <p className="text-xs text-gray-500">Descanso entre series: {mission.rest_seconds}s</p> : null}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-2 text-center">
          <p className="text-[10px] text-emerald-700 uppercase tracking-wide">XP</p>
          <p className="text-sm font-bold text-emerald-700">+{mission.xp_reward}</p>
        </div>
        <div className="rounded-xl border border-teal-100 bg-teal-50 p-2 text-center">
          <p className="text-[10px] text-teal-700 uppercase tracking-wide">Pontos</p>
          <p className="text-sm font-bold text-teal-700">+{mission.points_reward}</p>
        </div>
        <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-2 text-center">
          <p className="text-[10px] text-cyan-700 uppercase tracking-wide">Tempo</p>
          <p className="text-sm font-bold text-cyan-700">{mission.duration_estimate_minutes ?? 10} min</p>
        </div>
      </div>

      {mission.deadline ? (
        <div className={`flex items-center gap-1 text-xs mb-3 ${isFailed ? "text-red-600" : "text-gray-500"}`}>
          <Clock3 className="w-3 h-3" />
          <span>{isFailed ? "Expirada/falhou" : "Em andamento"}</span>
        </div>
      ) : null}

      {isFailed ? (
        <div className="w-full py-3 text-center rounded-xl bg-red-100 text-red-700 font-medium">Missao falhou por expiracao</div>
      ) : isCompleted ? (
        <div className="w-full py-3 text-center rounded-xl bg-emerald-100 text-emerald-700 font-medium">
          Missao concluida (+{mission.xp_reward} XP)
        </div>
      ) : (
        <Button onClick={() => { void openDetails(); }} variant="primary" className="w-full py-3 rounded-xl shadow-md hover:shadow-lg" disabled={completing}>
          Ver Detalhes
        </Button>
      )}
    </Card>
  );

  return (
    <>
      {triggerContent}      {showDetails && (
        <div className="fl-z-detail fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 md:p-8 overflow-y-auto">
          {/* Modal Container */}
          <div className="layout-content-container flex flex-col max-w-[600px] w-full rounded-xl shadow-2xl overflow-hidden relative" style={{ background: "var(--fl-surface-strong)", border: "1px solid color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
            
            {/* Header */}
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
              {/* Hero Image Section */}
              <div className="px-6 py-4">
                <div 
                  className="relative w-full aspect-video rounded-xl overflow-hidden group"
                  style={{ background: "color-mix(in srgb, var(--app-primary-color) 5%, transparent)" }}
                >
                  {missionDetails.video_url ? (
                    <>
                      <video
                        src={missionDetails.video_url}
                        poster={detailMissionMediaUrl ?? undefined}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                      <div className="absolute bottom-4 left-4">
                        <span className="text-black text-xs font-bold px-2 py-1 rounded-full uppercase tracking-wider" style={{ background: "var(--app-primary-color)" }}>
                          {stateLabel}
                        </span>
                      </div>
                    </>
                  ) : detailMissionMediaUrl ? (
                    <>
                      <img
                        src={detailMissionMediaUrl}
                        alt={missionDetails.title}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        style={{
                          imageRendering: pixelOrLineArt ? "crisp-edges" : "auto",
                          filter: pixelOrLineArt || gifLikeMedia ? "none" : "contrast(1.05) saturate(1.1)",
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                      <div className="absolute bottom-4 left-4">
                        <span className="text-black text-xs font-bold px-2 py-1 rounded-full uppercase tracking-wider" style={{ background: "var(--app-primary-color)" }}>
                          {stateLabel}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Dumbbell className="w-16 h-16 opacity-50" style={{ color: "var(--app-primary-color)" }} />
                    </div>
                  )}
                </div>
              </div>

              {/* Title & Description */}
              <div className="px-6 py-2">
                <h1 className="text-3xl font-black leading-tight" style={{ color: "var(--fl-color-text)" }}>{missionDetails.title}</h1>
                <p className="text-base font-medium mt-1" style={{ color: "var(--app-primary-color)" }}>
                  Dificuldade: {missionDetails.difficulty_level ? missionDetails.difficulty_level.charAt(0).toUpperCase() + missionDetails.difficulty_level.slice(1) : "Iniciante"} • Est. {missionDetails.duration_estimate_minutes ?? 10} min
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

              {/* Target Muscles */}
              <div className="px-6 pt-6">
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                  <Dumbbell className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                  Músculos Alvo
                </h3>
                <div className="flex gap-2 flex-wrap">
                  {(missionDetails.muscle_groups?.length ? missionDetails.muscle_groups : [bodyAreaLabel(missionDetails.body_area)]).map((muscle, idx) => (
                    <div key={`${muscle}-${idx}`} className="flex items-center gap-2 rounded-full px-4 py-1.5 border" style={{ background: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                      <span className="font-semibold text-sm" style={{ color: "var(--app-primary-color)" }}>{muscle}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="px-6 pt-8">
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                  <Info className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                  Execucao
                </h3>
                <div className="space-y-3">
                  {instructionList.map((instruction, index) => (
                    <div key={`${instruction}-${index}`} className="flex gap-3 rounded-lg border p-3" style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "var(--fl-border-soft)" }}>
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)", color: "var(--app-primary-color)" }}>
                        {index + 1}
                      </span>
                      <p className="text-sm" style={{ color: "var(--fl-color-text-muted)" }}>{instruction}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Safety Instructions */}
              {safetyTips && safetyTips.length > 0 && (
                <div className="px-6 pt-8">
                  <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                    <Sparkles className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                    Instruções de Segurança
                  </h3>
                  <div className="space-y-3">
                    {safetyTips.map((tip, index) => (
                      <div key={`${tip}-${index}`} className="flex gap-3 p-3 rounded-lg border" style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "var(--fl-border-soft)" }}>
                        <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: "var(--app-primary-color)" }} />
                        <p className="text-sm" style={{ color: "var(--fl-color-text-muted)" }}>{tip}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Loot / Rewards */}
              <div className="px-6 pt-8 pb-4">
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2" style={{ color: "var(--fl-color-text)" }}>
                  <Trophy className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                  Recompensas
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl flex items-center gap-4 border" style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                      <Star className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase" style={{ color: "color-mix(in srgb, var(--app-primary-color) 60%, var(--fl-color-text))" }}>Experiência</p>
                      <p className="text-lg font-bold" style={{ color: "var(--fl-color-text)" }}>+{missionDetails.xp_reward} XP</p>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl flex items-center gap-4 border" style={{ background: "color-mix(in srgb, var(--fl-surface-muted) 50%, transparent)", borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}>
                      <Trophy className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase" style={{ color: "color-mix(in srgb, var(--app-primary-color) 60%, var(--fl-color-text))" }}>FitCoins</p>
                      <p className="text-lg font-bold" style={{ color: "var(--fl-color-text)" }}>{missionDetails.points_reward}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sticky Bottom Action */}
            <div className="absolute bottom-0 left-0 right-0 p-6 backdrop-blur-md flex flex-col items-center" style={{ borderTop: "1px solid var(--fl-border-soft)", background: "color-mix(in srgb, var(--fl-surface-strong) 92%, transparent)" }}>
              <button 
                onClick={() => {
                  if (isCircuitMission || isCompleted || visualState === "failed") {
                    setShowDetails(false);
                  } else {
                    setShowDetails(false);
                    setShowExecution(true);
                  }
                }}
                className="w-full text-black font-black text-lg py-4 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3 relative z-10"
                style={{ 
                  background: "var(--app-primary-color)", 
                  boxShadow: "0 0 20px color-mix(in srgb, var(--app-primary-color) 25%, transparent)" 
                }}
              >
                {!isCircuitMission && !isCompleted && visualState !== "failed" && <Play className="w-6 h-6 fill-black text-black" strokeWidth={1.5} />}
                {isCompleted ? "CONCLUÍDA" : visualState === "failed" ? "FECHAR" : isCircuitMission ? "FECHAR" : isInProgress ? "CONTINUAR" : "INICIAR MISSÃO"}
              </button>
              {!isCircuitMission && (
                 <p className="text-center text-xs mt-3 font-medium uppercase tracking-widest relative z-10" style={{ color: "var(--fl-color-text-muted)" }}>
                   {missionDetails.sets && missionDetails.sets > 0 ? `${missionDetails.sets} séries • ` : ""}{formatGoal(missionDetails, detailMetricType)}{missionDetails.rest_seconds && missionDetails.rest_seconds > 0 ? ` • ${missionDetails.rest_seconds}s descanso` : ""}
                 </p>
              )}
            </div>
          </div>
        </div>
      )}
      {!isCircuitMission && (
        <MissionExecutionModal
          mission={missionDetails}
          metricType={detailMetricType}
          open={showExecution}
          onClose={() => setShowExecution(false)}
          onFinish={completeMission}
        />
      )}

      {showDetails && (
        <div className="fl-z-detail fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-xs" style={{ color: "var(--fl-color-text-muted)", borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 86%, transparent)" }}>
          <MapPinned className="w-3 h-3" />
          <span>{bodyAreaLabel(mission.body_area)}</span>
          <Trophy className="w-3 h-3" />
          <span>{mission.xp_reward} XP</span>
        </div>
      )}
    </>
  );
}

const MissionCard = memo(MissionCardComponent);
export default MissionCard;

