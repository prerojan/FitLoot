import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Dumbbell,
  FastForward,
  Info,
  Pause,
  Play,
  Square,
  X,
} from "lucide-react";
import LoadingBall from "@/react-app/components/LoadingBall";
import type { Mission, MissionMetricType } from "@/shared/types";
import {
  isUnilateralExecutionMission,
  missionTotalGoal,
  resolveMissionDisplayTitle,
  resolveMissionMediaStyle,
  resolveMissionMediaUrl,
  resolveMissionVideoUrl,
} from "./helpers";

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

type MissionExecutionModalProps = {
  mission: Mission;
  metricType: MissionMetricType;
  open: boolean;
  onClose: () => void;
  onFinish: (value: number) => Promise<void>;
};

export function MissionExecutionModal({
  mission,
  metricType,
  open,
  onClose,
  onFinish,
}: MissionExecutionModalProps) {
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
  const missionVideoUrl = resolveMissionVideoUrl(mission);
  const executionTitle = resolveMissionDisplayTitle(mission.title);
  const displaySeconds = state.resting ? state.restSeconds : state.remainingSeconds;
  const m = Math.floor(displaySeconds / 60).toString().padStart(2, "0");
  const s = (displaySeconds % 60).toString().padStart(2, "0");

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
                  boxShadow: "0 0 15px color-mix(in srgb, var(--app-primary-color) 50%, transparent)",
                }}
              />
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center py-10">
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
                  autoPlay
                  loop
                  muted
                  playsInline
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
                      : <Pause className="w-6 h-6 fill-current" strokeWidth={1} />}
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

        <footer className="mt-auto py-3 sm:py-6 flex justify-center uppercase tracking-[0.2em] sm:tracking-[0.3em] font-medium" style={{ color: "var(--fl-color-text-muted)", fontSize: 0 }}>
          <span className="text-[9px] sm:text-[10px]">Loot desta sessão: {sessionXp} / {mission.xp_reward} XP</span>
        </footer>
      </div>
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
