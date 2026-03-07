import { useState } from "react";
import { CheckCircle, Clock, Dumbbell } from "lucide-react";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import { Badge } from "@/react-app/components/ui/badge";
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

  const missionStatus = (mission as Mission & { status?: string }).status || (mission.is_completed === 1 ? 'completed' : 'pending');
  const isFailed = missionStatus === 'failed';
  const isCompleted = mission.is_completed === 1 || missionStatus === 'completed';

  return (
    <Card tone="soft" className={`p-5 transition-all ${isFailed ? 'border-2 border-red-200 bg-red-50 opacity-90' : 'hover:shadow-xl'} ${isCompleted ? 'border-2 border-emerald-200 bg-emerald-50' : ''}`}>
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

      {mission.target_reps && (
        <div className="text-sm text-gray-600 mb-2">
          Meta: {mission.target_reps} repetições
        </div>
      )}

      {mission.deadline && (
        <div className={`flex items-center gap-1 text-xs mb-3 ${isFailed ? 'text-red-600' : 'text-gray-500'}`}>
          <Clock className="w-3 h-3" />
          <span>{isFailed ? 'Expirada/falhou' : getDeadlineText()}</span>
        </div>
      )}

      {isFailed ? (
        <div className="w-full py-3 text-center rounded-xl bg-red-100 text-red-700 font-medium">Missão falhou por expiração</div>
      ) : isCompleted ? (
        <div className="w-full py-3 text-center rounded-xl bg-emerald-100 text-emerald-700 font-medium">Missão concluída</div>
      ) : !showComplete ? (
        <Button
          onClick={() => setShowComplete(true)}
          variant="primary"
          className="w-full py-3 rounded-xl shadow-md hover:shadow-lg hover:scale-105"
        >
          Completar Missão
        </Button>
      ) : (
        <div className="space-y-3 bg-emerald-50 p-4 rounded-xl">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Quantas repetições você fez?
            </label>
            <Input
              type="number"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border-2 border-emerald-200 focus:border-emerald-500 focus:outline-none"
              placeholder="0"
              min="0"
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setShowComplete(false)}
              variant="secondary"
              className="flex-1 py-2 rounded-lg"
              disabled={completing}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleComplete}
              disabled={completing || !reps}
              variant="primary"
              className="flex-1 py-2 rounded-lg"
            >
              <CheckCircle className="w-4 h-4" />
              {completing ? "Verificando..." : "Confirmar"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
