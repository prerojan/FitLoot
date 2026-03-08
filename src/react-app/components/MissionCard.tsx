import { memo, useEffect, useMemo, useState } from "react";
import { Clock3, Dumbbell, MapPinned, Play, Star, Trophy, X } from "lucide-react";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Badge } from "@/react-app/components/ui/badge";
import type { Mission, MissionMetricType } from "@/shared/types";

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
    mission.metric_type === "duration_minutes"
  ) {
    return mission.metric_type;
  }
  if ((mission.target_time ?? 0) > 0) return "duration_seconds";
  return "repetitions";
}

function missionTotalGoal(mission: Mission, metricType: MissionMetricType): number {
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
  const sets = mission.sets ?? null;
  if (metricType === "duration_seconds") {
    if (sets && sets > 1) {
      const eachSet = Math.max(1, Math.floor(goal / sets));
      return `${sets} series de ${eachSet} segundos`;
    }
    return `${goal} segundos`;
  }
  if (metricType === "duration_minutes") return `${goal} minutos`;
  if (metricType === "steps") return `${goal.toLocaleString("pt-BR")} passos`;
  if (metricType === "distance_meters") return `${(goal / 1000).toFixed(goal >= 1000 ? 1 : 2)} km`;
  if (metricType === "sets_reps") {
    const safeSets = sets && sets > 0 ? sets : 3;
    const eachSet = Math.max(1, Math.floor(goal / safeSets));
    return `${safeSets}x${eachSet} repeticoes`;
  }
  return `${goal} repeticoes`;
}

function bodyAreaLabel(bodyArea: Mission["body_area"]): string {
  if (bodyArea === "upper") return "Parte superior";
  if (bodyArea === "lower") return "Parte inferior";
  if (bodyArea === "core") return "Core";
  return "Corpo inteiro";
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
  }, [open, state.restSeconds, state.resting]);

  const isTimeMission = metricType === "duration_seconds" || metricType === "duration_minutes";
  const isCounterMission = metricType === "repetitions" || metricType === "sets_reps";
  const isDistanceMission = metricType === "steps" || metricType === "distance_meters";

  const incrementRep = () => {
    if (!isCounterMission) return;
    setState((current) => {
      if (current.resting) return current;
      const nextReps = current.repsDone + 1;
      if (metricType === "sets_reps" && nextReps >= setGoal) {
        if (current.currentSet < sets) {
          return {
            ...current,
            repsDone: 0,
            currentSet: current.currentSet + 1,
            resting: restSecondsConfigured > 0,
            restSeconds: restSecondsConfigured,
          };
        }
        return { ...current, repsDone: nextReps, finished: true };
      }
      if (metricType === "repetitions" && nextReps >= totalGoal) {
        return { ...current, repsDone: nextReps, finished: true };
      }
      return { ...current, repsDone: nextReps };
    });
  };

  const canFinishInputMission = isDistanceMission && Number(state.inputValue) > 0;
  const canFinishMission = isDistanceMission ? canFinishInputMission : state.finished;
  const finishButtonLabel = isDistanceMission ? "Registrar e Concluir" : "Concluir Missao";

  const finishMission = async () => {
    if (isDistanceMission && !canFinishInputMission) return;
    const value = isDistanceMission
      ? Number(state.inputValue)
      : isCounterMission
        ? Math.max(totalGoal, state.repsDone)
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
              <p className="text-xs text-emerald-700 mb-1">
                {metricType === "sets_reps" ? `Serie ${state.currentSet} de ${sets}` : "Repeticoes"}
              </p>
              <p className="text-4xl font-bold text-emerald-700">{state.repsDone}</p>
              <p className="text-xs text-gray-500 mt-1">
                Meta: {metricType === "sets_reps" ? setGoal : totalGoal}
              </p>
            </div>
            <Button onClick={incrementRep} className="w-full text-lg py-6" disabled={state.resting}>
              +1
            </Button>
            {state.resting ? (
              <p className="text-center text-xs text-emerald-700 font-medium">
                Descanso: {state.restSeconds}s
              </p>
            ) : null}
          </div>
        )}

        {isDistanceMission && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Registre o valor atingido (app de saúde, relógio ou esteira).
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

  const metricType = useMemo(() => normalizeMetricType(mission), [mission]);
  const missionStatus = (mission as Mission & { status?: string | undefined }).status || (mission.is_completed === 1 ? "completed" : "pending");
  const isFailed = missionStatus === "failed";
  const isCompleted = mission.is_completed === 1 || missionStatus === "completed";

  const detailsInstructions = Array.isArray(mission.instructions) && mission.instructions.length > 0
    ? mission.instructions
    : [
      "Aqueça por 3 a 5 minutos antes de iniciar.",
      "Mantenha postura e amplitude seguras durante o movimento.",
      "Respeite intervalos e hidratação durante a execução.",
    ];

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

  return (
    <>
      <Card
        tone="soft"
        className={`p-5 transition-all ${
          isFailed ? "border-2 border-red-200 bg-red-50 opacity-90" : "hover:shadow-xl"
        } ${isCompleted ? "border-2 border-emerald-200 bg-emerald-50" : ""}`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">{mission.title}</h3>
            {mission.description && (
              <p className="text-sm text-gray-600 mb-2">{mission.description}</p>
            )}
            {mission.skill_name && (
              <Badge className="w-fit gap-1">
                <Dumbbell className="w-3 h-3" />
                <span>{mission.skill_name}</span>
              </Badge>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-emerald-600 font-bold text-lg">+{mission.xp_reward} XP</div>
            <div className="text-teal-600 text-sm">+{mission.points_reward} pts</div>
          </div>
        </div>

        <div className="text-sm text-gray-600 mb-3">Meta: {formatGoal(mission, metricType)}</div>

        {mission.deadline && (
          <div className={`flex items-center gap-1 text-xs mb-3 ${isFailed ? "text-red-600" : "text-gray-500"}`}>
            <Clock3 className="w-3 h-3" />
            <span>{isFailed ? "Expirada/falhou" : "Em andamento"}</span>
          </div>
        )}

        {isFailed ? (
          <div className="w-full py-3 text-center rounded-xl bg-red-100 text-red-700 font-medium">Missao falhou por expiracao</div>
        ) : isCompleted ? (
          <div className="w-full py-3 text-center rounded-xl bg-emerald-100 text-emerald-700 font-medium">Missao concluida</div>
        ) : (
          <Button
            onClick={() => setShowDetails(true)}
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
              <h3 className="text-xl font-bold text-gray-900">{mission.title}</h3>
              <button onClick={() => setShowDetails(false)} className="p-2 rounded-xl hover:bg-gray-100" aria-label="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {mission.image_url ? (
                <img src={mission.image_url} alt={mission.title} className="w-full h-48 object-cover rounded-2xl border border-gray-200" />
              ) : (
                <div className="w-full h-48 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                  <Dumbbell className="w-12 h-12 text-emerald-600" />
                </div>
              )}
              <p className="text-sm text-gray-700">{mission.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Area do corpo</p>
                <p className="font-semibold text-gray-900">{bodyAreaLabel(mission.body_area)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Meta</p>
                <p className="font-semibold text-gray-900">{formatGoal(mission, metricType)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">XP</p>
                <p className="font-semibold text-emerald-700">{mission.xp_reward}</p>
              </div>
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Pontos</p>
                <p className="font-semibold text-teal-700">{mission.points_reward}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">Atributos beneficiados</p>
              <div className="flex flex-wrap gap-2">
                {(mission.attributes_benefited ?? []).map((attribute) => (
                  <span key={attribute} className="px-2 py-1 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <Star className="w-3 h-3 inline mr-1" />
                    {attribute}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">Como executar</p>
              <ol className="space-y-2">
                {detailsInstructions.map((instruction, index) => (
                  <li key={`${instruction}-${index}`} className="text-sm text-gray-700 flex gap-2">
                    <span className="font-semibold text-emerald-700">{index + 1}.</span>
                    <span>{instruction}</span>
                  </li>
                ))}
              </ol>
              {mission.rest_seconds ? (
                <p className="text-xs text-gray-500">Descanso entre series: {mission.rest_seconds} segundos</p>
              ) : null}
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setShowDetails(false)}>
                Fechar
              </Button>
              <Button className="flex-1" onClick={() => setShowExecution(true)}>
                <Play className="w-4 h-4" />
                Iniciar Missao
              </Button>
            </div>
          </div>
        </div>
      )}

      <MissionExecutionModal
        mission={mission}
        metricType={metricType}
        open={showExecution}
        onClose={() => setShowExecution(false)}
        onFinish={completeMission}
      />

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
