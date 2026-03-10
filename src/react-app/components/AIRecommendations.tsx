import { useState, useEffect } from "react";
import { Sparkles, TrendingUp, Target, Lightbulb } from "lucide-react";
import { api } from "@/react-app/utils/api";
import LoadingBall from "@/react-app/components/LoadingBall";

type Recommendations = {
  next_skill_recommendation: {
    name: string;
    reason: string;
  };
  weak_attribute: {
    name: string;
    suggestion: string;
  };
  training_focus: {
    type: string;
    reason: string;
  };
  motivation_message: string;
};

function parseRecommendations(raw: unknown): Recommendations | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  const nextSkill = (data.next_skill_recommendation ?? {}) as Record<string, unknown>;
  const weakAttribute = (data.weak_attribute ?? {}) as Record<string, unknown>;
  const trainingFocus = (data.training_focus ?? {}) as Record<string, unknown>;

  const parsed: Recommendations = {
    next_skill_recommendation: {
      name: typeof nextSkill.name === "string" && nextSkill.name.trim() ? nextSkill.name : "Sugestão indisponível",
      reason:
        typeof nextSkill.reason === "string" && nextSkill.reason.trim()
          ? nextSkill.reason
          : "A IA não retornou justificativa para a próxima skill.",
    },
    weak_attribute: {
      name:
        typeof weakAttribute.name === "string" && weakAttribute.name.trim()
          ? weakAttribute.name
          : "Atributo não identificado",
      suggestion:
        typeof weakAttribute.suggestion === "string" && weakAttribute.suggestion.trim()
          ? weakAttribute.suggestion
          : "Sem sugestão detalhada no momento.",
    },
    training_focus: {
      type:
        typeof trainingFocus.type === "string" && trainingFocus.type.trim()
          ? trainingFocus.type
          : "Foco geral",
      reason:
        typeof trainingFocus.reason === "string" && trainingFocus.reason.trim()
          ? trainingFocus.reason
          : "Sem detalhes adicionais fornecidos.",
    },
    motivation_message:
      typeof data.motivation_message === "string" && data.motivation_message.trim()
        ? data.motivation_message
        : "Continue consistente: pequenos passos diários geram grandes resultados.",
  };

  return parsed;
}

export default function AIRecommendations() {
  const [recommendations, setRecommendations] = useState<Recommendations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api("/api/ai/recommendations");

      if (!response.ok) {
        throw new Error("Failed to load recommendations");
      }

      const data = (await response.json()) as { recommendations?: unknown };
      const parsed = parseRecommendations(data.recommendations);
      if (!parsed) {
        throw new Error("Invalid recommendations payload");
      }

      setRecommendations(parsed);
    } catch {
      setError("Não foi possível carregar as recomendações");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="fl-card p-6">
        <div className="flex items-center justify-center gap-2 text-emerald-600">
          <LoadingBall size="md" />
          <span className="text-sm">Analisando seu progresso...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
        <p className="text-red-600 text-sm text-center">{error}</p>
        <button
          onClick={loadRecommendations}
          className="mt-2 w-full px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors"
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  if (!recommendations) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-purple-600" />
        <h2 className="fl-title-card">Recomendações IA</h2>
      </div>

      <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl p-4 text-white shadow-lg">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 mt-1 flex-shrink-0" />
          <p className="text-sm font-medium">{recommendations.motivation_message}</p>
        </div>
      </div>

      <div className="fl-card p-4 shadow-md">
        <div className="flex items-start gap-3">
          <div className="bg-emerald-100 p-2 rounded-lg">
            <Target className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 mb-1">Próxima Skill Recomendada</h3>
            <p className="text-emerald-600 font-medium text-sm mb-2">{recommendations.next_skill_recommendation.name}</p>
            <p className="text-gray-600 text-xs">{recommendations.next_skill_recommendation.reason}</p>
          </div>
        </div>
      </div>

      <div className="fl-card p-4 shadow-md">
        <div className="flex items-start gap-3">
          <div className="bg-orange-100 p-2 rounded-lg">
            <TrendingUp className="w-5 h-5 text-orange-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 mb-1">Área para Melhorar</h3>
            <p className="text-orange-600 font-medium text-sm mb-2">{recommendations.weak_attribute.name}</p>
            <p className="text-gray-600 text-xs">{recommendations.weak_attribute.suggestion}</p>
          </div>
        </div>
      </div>

      <div className="fl-card p-4 shadow-md">
        <div className="flex items-start gap-3">
          <div className="bg-blue-100 p-2 rounded-lg">
            <Lightbulb className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 mb-1">Foco do Treino</h3>
            <p className="text-blue-600 font-medium text-sm mb-2">{recommendations.training_focus.type}</p>
            <p className="text-gray-600 text-xs">{recommendations.training_focus.reason}</p>
          </div>
        </div>
      </div>

      <button
        onClick={loadRecommendations}
        className="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-shadow"
      >
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4" />
          <span>Atualizar Recomendações</span>
        </div>
      </button>
    </div>
  );
}

