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
} from "lucide-react";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Badge } from "@/react-app/components/ui/badge";
import LoadingBall from "@/react-app/components/LoadingBall";
import { formatMissionGoal } from "@/constants/missionMetrics";
import type { CircuitTask, Mission, MissionMetricType } from "@/shared/types";
import { api } from "@/react-app/utils/api";

type MissionCardProps = {
  mission: Mission & { skill_name?: string | undefined };
  onComplete: (id: number, reps: number, verified: boolean) => Promise<void> | void;
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

  useEffect(() => {
    if (!open) return;
    setState({
      ...DEFAULT_EXECUTION_STATE,
      remainingSeconds: setDuration,
      running: metricType === "duration_seconds" || metricType === "duration_minutes",
    });
  }, [metricType, open, setDuration]);

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

  const isTimeMission = metricType === "duration_seconds" || metricType === "duration_minutes";
  const isCounterMission = metricType === "repetitions" || metricType === "sets_reps";
  const isDistanceMission = metricType === "steps" || metricType === "distance_meters";

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
  const finishButtonLabel = isDistanceMission ? "Registrar e Concluir" : "Concluir";

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

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Executar Missao</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isTimeMission && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center">
              <p className="text-xs text-emerald-700 mb-1">{state.resting ? "Descanso" : `Serie ${state.currentSet} de ${sets}`}</p>
              <p className="text-4xl font-bold text-emerald-700">
                {state.resting ? state.restSeconds : state.remainingSeconds}s
              </p>
            </div>
            <Button
              onClick={() => setState((current) => ({ ...current, running: !current.running }))}
              variant="secondary"
              className="w-full"
              disabled={state.finished}
            >
              {state.running ? "Pausar" : "Retomar"}
            </Button>
          </div>
        )}

        {isCounterMission && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center">
              <p className="text-xs text-emerald-700 mb-1">{`Serie ${state.currentSet} de ${sets}`}</p>
              <p className="text-4xl font-bold text-emerald-700">{state.repsDone}</p>
              <p className="text-xs text-gray-500 mt-1">
                Meta da serie: {setGoal} reps
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={decrementRep} variant="secondary" className="w-full text-lg py-4" disabled={state.resting}>
                -
              </Button>
              <Button onClick={incrementRep} className="w-full text-lg py-4" disabled={state.resting}>
                +
              </Button>
            </div>

            <Button
              onClick={completeCurrentSet}
              className="w-full"
              variant="secondary"
              disabled={state.resting || state.repsDone <= 0}
            >
              Serie Completa
            </Button>

            {state.resting ? (
              <p className="text-center text-xs text-emerald-700 font-medium">
                Descanso: {state.restSeconds}s
              </p>
            ) : null}

            <p className="text-center text-xs text-gray-600">
              Progresso total: {totalCounterProgress}/{totalGoal}
            </p>
          </div>
        )}

        {isDistanceMission && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Use seu app de saude/relogio e registre o valor atingido aqui.
            </p>
            <input
              type="number"
              className="w-full rounded-xl border-2 border-emerald-200 focus:border-emerald-500 focus:outline-none px-4 py-3"
              placeholder={metricType === "steps" ? "Passos" : "Metros"}
              value={state.inputValue}
              onChange={(event) => setState((current) => ({ ...current, inputValue: event.target.value }))}
              min={0}
            />
          </div>
        )}

        <Button
          onClick={() => { void finishMission(); }}
          className="w-full"
          disabled={!canFinishMission}
        >
          {finishButtonLabel}
        </Button>
      </div>
    </div>
  );
}

function MissionCardComponent({ mission, onComplete }: MissionCardProps) {
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
  const hasInlineDetails =
    Array.isArray(mission.instructions) &&
    mission.instructions.length > 0 &&
    Array.isArray(mission.safety_tips) &&
    mission.safety_tips.length > 0;

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

  const missionDetails = detailedMission ?? mission;
  const detailMetricType = normalizeMetricType(missionDetails);
  const detailMissionMediaUrl = resolveMissionMediaUrl(missionDetails);
  const detailsInstructions = Array.isArray(missionDetails.instructions) && missionDetails.instructions.length > 0
    ? missionDetails.instructions
    : [
      "Aqueca por 3 a 5 minutos antes de iniciar.",
      "Mantenha postura e amplitude seguras durante o movimento.",
      "Respeite intervalos e hidratacao durante a execucao.",
    ];
  const safetyTips = Array.isArray(missionDetails.safety_tips) && missionDetails.safety_tips.length > 0
    ? missionDetails.safety_tips
    : ["Mantenha alinhamento postural e interrompa em caso de dor aguda."];
  const pixelOrLineArt = isPixelOrLineArtUrl(detailMissionMediaUrl);
  const gifLikeMedia = isGifUrl(detailMissionMediaUrl);
  const detailCircuitTasks = resolveCircuitTasks(missionDetails);
  const detailCompletedCircuitTasks = detailCircuitTasks.filter((task) => task.completed).length;
  const detailCircuitProgress = detailCircuitTasks.length > 0 ? (detailCompletedCircuitTasks / detailCircuitTasks.length) * 100 : 0;

  return (
    <>
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
            {isAIMission && (
              <Badge className="w-fit gap-1 bg-purple-100 text-purple-700 border border-purple-200">
                <Sparkles className="w-3 h-3" />
                IA
              </Badge>
            )}
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

        {!isWeeklyMission && missionMediaUrl && (
          <div className="hidden sm:block w-full mb-3">
            <img
              src={missionMediaUrl}
              alt={mission.title}
              loading="lazy"
              decoding="async"
              className="w-full h-36 object-cover rounded-2xl border border-gray-200"
            />
          </div>
        )}

        <h3 className="font-semibold text-gray-900 mb-1">{mission.title}</h3>
        <p className="text-sm text-gray-500 mb-2">{primaryMuscle}</p>
        {mission.description && (
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">{mission.description}</p>
        )}

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
            {mission.rest_seconds ? (
              <p className="text-xs text-gray-500">Descanso entre series: {mission.rest_seconds}s</p>
            ) : null}
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

        {mission.deadline && (
          <div className={`flex items-center gap-1 text-xs mb-3 ${isFailed ? "text-red-600" : "text-gray-500"}`}>
            <Clock3 className="w-3 h-3" />
            <span>{isFailed ? "Expirada/falhou" : "Em andamento"}</span>
          </div>
        )}

        {isFailed ? (
          <div className="w-full py-3 text-center rounded-xl bg-red-100 text-red-700 font-medium">Missao falhou por expiracao</div>
        ) : isCompleted ? (
          <div className="w-full py-3 text-center rounded-xl bg-emerald-100 text-emerald-700 font-medium">
            Missao concluida (+{mission.xp_reward} XP)
          </div>
        ) : (
          <Button
            onClick={() => { void openDetails(); }}
            variant="primary"
            className="w-full py-3 rounded-xl shadow-md hover:shadow-lg"
            disabled={completing}
          >
            Ver Detalhes
          </Button>
        )}
      </Card>

      {showDetails && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">{missionDetails.title}</h3>
              <button onClick={() => setShowDetails(false)} className="p-2 rounded-xl hover:bg-gray-100" aria-label="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {detailMissionMediaUrl ? (
                <div className="w-full h-64 rounded-2xl border border-gray-200 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                  <img
                    src={detailMissionMediaUrl}
                    alt={missionDetails.title}
                    loading="lazy"
                    decoding="async"
                    className="w-[125%] h-[125%] object-contain"
                    style={{
                      objectFit: "contain",
                      imageRendering: pixelOrLineArt ? "crisp-edges" : "auto",
                      filter: pixelOrLineArt || gifLikeMedia ? "blur(0px)" : "contrast(1.05) saturate(1.1) blur(0px)",
                      transform: "scale(1)",
                    }}
                  />
                </div>
              ) : (
                <div className="w-full h-64 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center overflow-hidden">
                  <Dumbbell className="w-12 h-12 text-emerald-600" />
                </div>
              )}
              {detailsLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <LoadingBall size="sm" />
                  Carregando detalhes completos...
                </div>
              ) : null}
              {detailsError ? (
                <p className="text-sm text-red-600">{detailsError}</p>
              ) : null}
              <p className="text-sm text-gray-700">{missionDetails.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Area do corpo</p>
                <p className="font-semibold text-gray-900">{bodyAreaLabel(missionDetails.body_area)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Meta</p>
                <p className="font-semibold text-gray-900">{formatGoal(missionDetails, detailMetricType)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Dificuldade</p>
                <p className="font-semibold text-gray-900">{missionDetails.difficulty_level ?? "iniciante"}</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Tempo estimado</p>
                <p className="font-semibold text-gray-900">{missionDetails.duration_estimate_minutes ?? 10} min</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">XP</p>
                <p className="font-semibold text-emerald-700">{missionDetails.xp_reward}</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Pontos</p>
                <p className="font-semibold text-teal-700">{missionDetails.points_reward}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">Atributos beneficiados</p>
              <div className="flex flex-wrap gap-2">
                {(missionDetails.attributes_benefited ?? []).map((attribute) => (
                  <span key={attribute} className="px-2 py-1 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <Star className="w-3 h-3 inline mr-1" />
                    {attribute}
                  </span>
                ))}
              </div>
            </div>

            {isCircuitMission && detailCircuitTasks.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-900">Progresso do circuito semanal</p>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${detailCircuitProgress}%` }} />
                </div>
                <div className="space-y-2">
                  {detailCircuitTasks.map((task) => (
                    <div key={task.id} className="rounded-xl border border-gray-200 p-3 text-sm flex items-center justify-between">
                      <span>{task.label}</span>
                      <span className="font-semibold text-emerald-700">
                        {task.current_count}/{task.required_count} {task.completed ? "OK" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">Como executar</p>
              <ol className="space-y-2">
                {(Array.isArray(missionDetails.instructions) && missionDetails.instructions.length > 0
                  ? missionDetails.instructions
                  : detailsInstructions
                ).map((instruction, index) => (
                  <li key={`${instruction}-${index}`} className="text-sm text-gray-700 flex gap-2">
                    <span className="font-semibold text-emerald-700">{index + 1}.</span>
                    <span>{instruction}</span>
                  </li>
                ))}
              </ol>
              {missionDetails.rest_seconds ? (
                <p className="text-xs text-gray-500">Descanso entre series: {missionDetails.rest_seconds} segundos</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">Seguranca e forma</p>
              <ul className="space-y-2">
                {safetyTips.map((tip, index) => (
                  <li key={`${tip}-${index}`} className="text-sm text-gray-700 flex gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setShowDetails(false)}>
                Fechar
              </Button>
              {!isCircuitMission && (
                <Button className="flex-1" onClick={() => setShowExecution(true)}>
                  <Play className="w-4 h-4" />
                  Iniciar
                </Button>
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-500 flex items-center gap-2">
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

