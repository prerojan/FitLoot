import { useState } from "react";
import { CheckCircle, Clock, Dumbbell } from "lucide-react";
import type { Mission } from "@/shared/types";

interface MissionCardProps {
  mission: Mission & { skill_name?: string };
  onComplete: (id: number, reps: number, verified: boolean) => void;
}

export default function MissionCard({ mission, onComplete }: MissionCardProps) {
  const [showComplete, setShowComplete] = useState(false);
  const [reps, setReps] = useState(mission.target_reps?.toString() || "");
  const [completing, setCompleting] = useState(false);

  const handleComplete = async () => {
    setCompleting(true);
    try {
      // Simulação de verificação de sensor
      const verified = Math.random() > 0.3; // 70% de chance de verificação bem-sucedida
      await onComplete(mission.id, parseInt(reps) || 0, verified);
      setShowComplete(false);
    } catch (error) {
      console.error("Error completing mission:", error);
    } finally {
      setCompleting(false);
    }
  };

  const getDeadlineText = () => {
    if (!mission.deadline) return "";
    const deadline = new Date(mission.deadline);
    const now = new Date();
    const diff = deadline.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    if (hours < 24) {
      return `${hours}h restantes`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d restantes`;
  };

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 shadow-lg hover:shadow-xl transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 mb-1">{mission.title}</h3>
          {mission.description && (
            <p className="text-sm text-gray-600 mb-2">{mission.description}</p>
          )}
          {mission.skill_name && (
            <div className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 rounded-full px-3 py-1 w-fit">
              <Dumbbell className="w-3 h-3" />
              <span>{mission.skill_name}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-emerald-600 font-bold text-lg">+{mission.xp_reward} XP</div>
          <div className="text-teal-600 text-sm">+{mission.points_reward} pts</div>
        </div>
      </div>

      {mission.target_reps && (
        <div className="text-sm text-gray-600 mb-2">
          Meta: {mission.target_reps} repetições
        </div>
      )}

      {mission.deadline && (
        <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
          <Clock className="w-3 h-3" />
          <span>{getDeadlineText()}</span>
        </div>
      )}

      {!showComplete ? (
        <button
          onClick={() => setShowComplete(true)}
          className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white py-3 rounded-xl font-semibold shadow-md hover:shadow-lg transition-all hover:scale-105"
        >
          Completar Missão
        </button>
      ) : (
        <div className="space-y-3 bg-emerald-50 p-4 rounded-xl">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Quantas repetições você fez?
            </label>
            <input
              type="number"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border-2 border-emerald-200 focus:border-emerald-500 focus:outline-none"
              placeholder="0"
              min="0"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowComplete(false)}
              className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-300 transition-colors"
              disabled={completing}
            >
              Cancelar
            </button>
            <button
              onClick={handleComplete}
              disabled={completing || !reps}
              className="flex-1 bg-emerald-600 text-white py-2 rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              {completing ? "Verificando..." : "Confirmar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
