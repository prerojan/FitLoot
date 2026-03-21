import { memo, useCallback, useEffect, useState } from "react";
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
import { useAppChrome } from "@/react-app/contexts/appChrome";
import { formatMissionGoal } from "@/constants/missionMetrics";
import type { Mission, MissionMetricType } from "@/shared/types";
import { localizeMissionText } from "@/shared/missionLocalization";
import WalkingMissionExecution from "./WalkingMissionExecution";

type MissionCardProps = {
  mission: Mission & { skill_name?: string | undefined };
  onComplete: (id: number, reps: number, verified: boolean) => Promise<void> | void;
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

function formatGoal(mission: Mission, metricType: MissionMetricType): string {
  const goal = mission.metric_value ?? 1;
  const sets = mission.sets ?? undefined;

  if (metricType === "duration_seconds" && sets && sets > 0) {
    const secondsPerSet = Math.max(1, Math.floor(goal / sets));
    return formatMissionGoal(metricType, secondsPerSet, sets);
  }

  if (metricType === "sets_reps" && sets && sets > 0) {
    const repsPerSet = Math.max(1, Math.floor(goal / sets));
    return formatMissionGoal(metricType, repsPerSet, sets);
  }

  return formatMissionGoal(metricType, goal, sets);
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
  const [reps, setReps] = useState(0);
  const [sets, setSets] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const completeMission = useCallback(async () => {
    const totalReps = reps * sets;
    await onFinish(totalReps);
    setIsCompleted(true);
  }, [reps, sets, onFinish]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{mission.title}</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {isCompleted ? "Concluída!" : `${sets} x ${reps}`}
            </div>
            <div className="text-sm text-gray-600">
              Total: {reps * sets} repetições
            </div>
          </div>

          {!isCompleted && (
            <div className="flex gap-2">
              <button
                onClick={() => setReps(Math.max(0, reps - 1))}
                className="px-3 py-2 bg-gray-200 rounded-lg"
              >
                -
              </button>
              <input
                type="number"
                value={reps}
                onChange={(e) => setReps(Math.max(0, parseInt(e.target.value) || 0))}
                className="flex-1 text-center border rounded-lg"
              />
              <button
                onClick={() => setReps(reps + 1)}
                className="px-3 py-2 bg-gray-200 rounded-lg"
              >
                +
              </button>
            </div>
          )}

          {!isCompleted && (
            <button
              onClick={completeMission}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
            >
              Finalizar Missão
            </button>
          )}

          {isCompleted && (
            <button
              onClick={onClose}
              className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700"
            >
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MissionCardComponent({ mission, onComplete }: MissionCardProps) {
  const { setMissionDetailsOpen, setMissionExecutionOpen } = useAppChrome();
  const [showDetails, setShowDetails] = useState(false);
  const [showExecution, setShowExecution] = useState(false);
  const [showWalkingExecution, setShowWalkingExecution] = useState(false);
  const [completing, setCompleting] = useState(false);

  const metricType = normalizeMetricType(mission);
  const missionStatus = (mission as Mission & { status?: string | undefined }).status || (mission.is_completed === 1 ? "completed" : "pending");
  const isFailed = missionStatus === "failed" || missionStatus === "expired";
  const isCompleted = mission.is_completed === 1 || missionStatus === "completed";
  const isWalkingMission = metricType === "steps" || metricType === "distance_meters";

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
      <Card
        tone="soft"
        className={`p-5 transition-all ${
          isFailed ? "border-2 border-red-200 bg-red-50 opacity-90" : "hover:shadow-xl"
        } ${isCompleted ? "border-2 border-emerald-200 bg-emerald-50" : ""}`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">
              {localizeMissionText(mission.title) ?? mission.title}
            </h3>
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

        <div className="text-sm text-gray-600 mb-3">
          Meta: {formatGoal(mission, metricType)}
        </div>

        {mission.deadline && (
          <div className={`flex items-center gap-1 text-xs mb-3 ${isFailed ? "text-red-600" : "text-gray-500"}`}>
            <Clock3 className="w-3 h-3" />
            <span>{isFailed ? "Expirada/falhou" : "Em andamento"}</span>
          </div>
        )}

        {isFailed ? (
          <div className="w-full py-3 text-center rounded-xl bg-red-100 text-red-700 font-medium">
            Missão falhou por expiração
          </div>
        ) : isCompleted ? (
          <div className="w-full py-3 text-center rounded-xl bg-emerald-100 text-emerald-700 font-medium">
            Missão concluída
          </div>
        ) : (
          <Button
            onClick={() => {
              if (isWalkingMission) {
                setShowWalkingExecution(true);
              } else {
                setShowDetails(true);
              }
            }}
            variant="primary"
            className="w-full py-3 rounded-xl shadow-md hover:shadow-lg"
            disabled={completing}
          >
            {isWalkingMission ? "Iniciar Caminhada" : "Ver Detalhes"}
          </Button>
        )}
      </Card>

      {showDetails && !isWalkingMission && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">
                {localizeMissionText(mission.title) ?? mission.title}
              </h3>
              <button
                onClick={() => setShowDetails(false)}
                className="p-2 rounded-xl hover:bg-gray-100"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {mission.image_url ? (
                <img
                  src={mission.image_url}
                  alt={mission.title}
                  className="w-full h-48 object-cover rounded-2xl border border-gray-200"
                />
              ) : (
                <div className="w-full h-48 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                  <Dumbbell className="w-12 h-12 text-emerald-600" />
                </div>
              )}
              <p className="text-sm text-gray-700">{mission.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 p-3">
                <p className="text-xs text-gray-500">Área do corpo</p>
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
                  <span
                    key={attribute}
                    className="px-2 py-1 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
                  >
                    <Star className="w-3 h-3 inline mr-1" />
                    {attribute}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setShowDetails(false)}>
                Fechar
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setShowDetails(false);
                  setShowExecution(true);
                }}
              >
                <Play className="w-4 h-4" />
                Iniciar Missão
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
        onFinish={finishMission}
      />

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
