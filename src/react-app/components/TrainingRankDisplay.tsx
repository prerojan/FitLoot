import React from 'react';
import { Shield, TrendingUp, Target, Activity, AlertTriangle } from 'lucide-react';
import type { TrainingRankSnapshot, UserProgression, UserSkill } from '@/shared/types';

interface TrainingRankDisplayProps {
  snapshot: TrainingRankSnapshot | null;
  isLoading?: boolean;
  error?: string | null;
  showDetails?: boolean;
  compact?: boolean;
}

const rankConfig = {
  iniciante: {
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-300',
    label: 'Iniciante',
    description: 'Começando sua jornada fitness'
  },
  intermediario: {
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-300',
    label: 'Intermediário',
    description: 'Em pleno desenvolvimento'
  },
  avancado: {
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
    borderColor: 'border-purple-300',
    label: 'Avançado',
    description: 'Atleta experiente'
  }
};

export function TrainingRankDisplay({ 
  snapshot, 
  isLoading = false, 
  error = null, 
  showDetails = false,
  compact = false 
}: TrainingRankDisplayProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-12 bg-gray-200 rounded-lg mb-2"></div>
        {!compact && <div className="h-4 bg-gray-200 rounded w-3/4"></div>}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-red-200 bg-red-50 rounded-lg">
        <div className="flex items-center gap-2 text-red-600">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">Erro ao carregar rank</span>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="p-4 border border-gray-200 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2 text-gray-500">
          <Activity className="w-4 h-4" />
          <span className="text-sm">Rank não disponível</span>
        </div>
      </div>
    );
  }

  const config = rankConfig[snapshot.globalRank];

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${config.bgColor} ${config.borderColor} ${config.color}`}>
        <Shield className="w-3 h-3" />
        <span className="text-xs font-medium">{config.label}</span>
        {snapshot.fallbackUsed && (
          <div className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 opacity-60" />
            <span className="text-xs text-yellow-700">Dados incompletos</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-lg border ${config.bgColor} ${config.borderColor}`}>
      {/* Cabeçalho do Rank */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${config.bgColor}`}>
            <Shield className={`w-5 h-5 ${config.color}`} />
          </div>
          <div>
            <h3 className={`font-semibold ${config.color}`}>{config.label}</h3>
            <p className="text-xs text-gray-600">{config.description}</p>
          </div>
        </div>
        
        <div className="text-right">
          <div className={`text-2xl font-bold ${config.color}`}>
            {snapshot.globalScore}
          </div>
          <div className="text-xs text-gray-500">pontos</div>
        </div>
      </div>

      {/* Alerta de Fallback */}
      {snapshot.fallbackUsed && (
        <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded">
          <div className="flex items-center gap-2 text-yellow-700 text-xs">
            <AlertTriangle className="w-3 h-3" />
            <span>
              {snapshot.hasBenchmarkData && snapshot.hasSkillData 
                ? "Rank calculado com dados estimados - complete benchmarks para maior precisão"
                : "Continue treinando para desbloquear ranking completo"
              }
            </span>
          </div>
        </div>
      )}

      {/* Detalhes dos Fatores */}
      {showDetails && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Fatores de Avaliação</h4>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <div className="flex-1">
                <div className="text-xs text-gray-600">Volume</div>
                <div className="text-sm font-medium">{snapshot.factors.volumeScore}/25</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              <div className="flex-1">
                <div className="text-xs text-gray-600">Consistência</div>
                <div className="text-sm font-medium">{snapshot.factors.consistencyScore}/25</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-purple-600" />
              <div className="flex-1">
                <div className="text-xs text-gray-600">Benchmarks</div>
                <div className="text-sm font-medium">{snapshot.factors.benchmarkScore}/30</div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-orange-600" />
              <div className="flex-1">
                <div className="text-xs text-gray-600">Skills</div>
                <div className="text-sm font-medium">{snapshot.factors.skillMasteryScore}/20</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="mt-3 pt-2 border-t border-gray-200">
        <div className="text-xs text-gray-500">
          Atualizado: {new Date(snapshot.lastCalculatedAt).toLocaleDateString('pt-BR')}
        </div>
      </div>
    </div>
  );
}

// Hook para facilitar o uso do componente
export function useTrainingRank(
  userProgression: UserProgression | null,
  userSkills: UserSkill[],
  benchmarkResults?: {
    pushUpMaxReps?: number;
    squatMaxReps?: number;
    plankMaxSeconds?: number;
    sitUpMaxReps?: number;
    skillStageScore?: number;
  }
) {
  const [snapshot, setSnapshot] = React.useState<TrainingRankSnapshot | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const calculateRank = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Import dinâmico para evitar dependência circular
        const { getOrCalculateRankSnapshot } = await import('@/shared/trainingLevels');
        
        const rankSnapshot = getOrCalculateRankSnapshot(
          userProgression ? {
            xp: userProgression.xp,
            level: userProgression.level,
            current_streak: userProgression.current_streak,
            best_streak: userProgression.best_streak,
            training_rank_snapshot: userProgression.training_rank_snapshot || null
          } : {
            xp: 0,
            level: 1,
            current_streak: 0,
            best_streak: 0,
            training_rank_snapshot: null
          },
          userSkills,
          benchmarkResults
        );
        
        setSnapshot(rankSnapshot);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido');
      } finally {
        setIsLoading(false);
      }
    };

    if (userProgression && userSkills) {
      calculateRank();
    } else {
      setIsLoading(false);
    }
  }, [userProgression, userSkills, benchmarkResults]);

  return { snapshot, isLoading, error };
}
