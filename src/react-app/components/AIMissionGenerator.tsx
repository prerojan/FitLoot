// ====================================
// src/react-app/components/AIMissionGenerator.tsx
// Botão para gerar missões personalizadas com IA
// ====================================

import { useState } from "react";
import { Wand2, Loader2, CheckCircle, XCircle } from "lucide-react";

interface GeneratedMission {
  title: string;
  description: string;
  skill_name: string;
  target_reps: number;
  xp_reward: number;
  points_reward: number;
  difficulty: string;
}

export default function AIMissionGenerator({ onMissionsGenerated }: { onMissionsGenerated?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedMissions, setGeneratedMissions] = useState<GeneratedMission[]>([]);

  const generateMissions = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(false);

      const response = await fetch("/api/ai/generate-missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error("Failed to generate missions");
      }

      const data = await response.json();
      setGeneratedMissions(data.missions);
      setSuccess(true);

      // Notify parent component to refresh missions list
      setTimeout(() => {
        if (onMissionsGenerated) {
          onMissionsGenerated();
        }
        setSuccess(false);
      }, 3000);

    } catch (err) {
      console.error("Error generating missions:", err);
      setError("Não foi possível gerar missões. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case "easy":
        return "text-green-600 bg-green-100";
      case "medium":
        return "text-yellow-600 bg-yellow-100";
      case "hard":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  const getDifficultyLabel = (difficulty: string) => {
    switch (difficulty) {
      case "easy":
        return "Fácil";
      case "medium":
        return "Médio";
      case "hard":
        return "Difícil";
      default:
        return difficulty;
    }
  };

  if (success) {
    return (
      <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle className="w-5 h-5" />
          <span className="font-medium">Missões geradas com sucesso!</span>
        </div>

        <div className="space-y-2">
          {generatedMissions.map((mission, index) => (
            <div key={index} className="bg-white rounded-lg p-3 border border-green-200">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h4 className="font-bold text-sm text-gray-900">{mission.title}</h4>
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${getDifficultyColor(
                    mission.difficulty
                  )}`}
                >
                  {getDifficultyLabel(mission.difficulty)}
                </span>
              </div>
              <p className="text-xs text-gray-600 mb-2">{mission.description}</p>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-purple-600 font-medium">
                  {mission.xp_reward} XP
                </span>
                <span className="text-yellow-600 font-medium">
                  {mission.points_reward} pts
                </span>
                <span className="text-emerald-600 font-medium">
                  {mission.target_reps} reps
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 text-red-600 mb-3">
          <XCircle className="w-5 h-5" />
          <span className="font-medium">{error}</span>
        </div>
        <button
          onClick={generateMissions}
          className="w-full px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors"
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl p-4 shadow-lg">
      <div className="flex items-start gap-3 mb-3">
        <div className="bg-white/20 backdrop-blur-sm p-2 rounded-lg">
          <Wand2 className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 text-white">
          <h3 className="font-bold mb-1">Gerador de Missões IA</h3>
          <p className="text-sm text-white/90">
            Deixe a IA criar missões personalizadas para você baseadas no seu perfil e progresso!
          </p>
        </div>
      </div>

      <button
        onClick={generateMissions}
        disabled={loading}
        className="w-full px-4 py-3 bg-white text-purple-600 rounded-xl font-medium shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Gerando missões...</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Wand2 className="w-4 h-4" />
            <span>Gerar Missões Personalizadas</span>
          </div>
        )}
      </button>

      <p className="text-xs text-white/70 text-center mt-2">
        Gera 3 missões diárias adaptadas ao seu nível
      </p>
    </div>
  );
}