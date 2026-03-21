/**
 * Componente de Execução de Missões de Caminhada/Corrida
 * Integra APIs de saúde (Google Fit) e mapas (OpenStreetMap + OpenRouteService)
 */

import { memo, useCallback, useEffect, useState } from "react";
import { MapPin, Navigation, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Badge } from "@/react-app/components/ui/badge";
import { useHealthData } from "@/react-app/hooks/useHealthData";
import { useMapService } from "@/react-app/hooks/useMapService";
import type { Mission, MissionMetricType } from "@/shared/types";

type WalkingMissionExecutionProps = {
  mission: Mission & { skill_name?: string | undefined };
  onComplete: (id: number, value: number, verified: boolean) => Promise<void> | void;
  onClose: () => void;
};

type ExecutionState = {
  isRunning: boolean;
  isPaused: boolean;
  isCompleted: boolean;
  startTime: Date | null;
  endTime: Date | null;
  currentSteps: number;
  currentDistance: number;
  targetSteps: number;
  targetDistance: number;
  route: {
    coordinates: [number, number][];
    distance: number;
    duration: number;
  } | null;
  userLocation: [number, number] | null;
  error: string | null;
};

const WalkingMissionExecution = ({ mission, onComplete, onClose }: WalkingMissionExecutionProps) => {
  const { healthData, isAuthenticated } = useHealthData({
    autoRefresh: true,
    refreshInterval: 1, // Atualizar a cada 1 minuto
  });

  const { 
    getCurrentLocation, 
    getDirections, 
    addMarker, 
    clearMarkers,
    userLocation: mapUserLocation 
  } = useMapService();

  const [state, setState] = useState<ExecutionState>({
    isRunning: false,
    isPaused: false,
    isCompleted: false,
    startTime: null,
    endTime: null,
    currentSteps: 0,
    currentDistance: 0,
    targetSteps: 0,
    targetDistance: 0,
    route: null,
    userLocation: null,
    error: null,
  });

  // Determinar tipo e metas da missão
  const metricType = mission.metric_type as MissionMetricType;
  const isStepsMission = metricType === "steps";
  const isDistanceMission = metricType === "distance_meters";

  useEffect(() => {
    // Configurar metas baseadas na missão
    if (isStepsMission) {
      setState(prev => ({
        ...prev,
        targetSteps: mission.metric_value || 5000, // Meta padrão 5000 passos
        targetDistance: (mission.metric_value || 5000) * 0.0007, // ~0.7m por passo
      }));
    } else if (isDistanceMission) {
      setState(prev => ({
        ...prev,
        targetDistance: mission.metric_value || 3000, // Meta padrão 3000m
        targetSteps: Math.ceil((mission.metric_value || 3000) / 0.0007), // Converter para passos
      }));
    }
  }, [mission, isStepsMission, isDistanceMission]);

  // Atualizar dados de saúde quando disponíveis
  useEffect(() => {
    if (healthData && state.isRunning && !state.isCompleted) {
      setState(prev => ({
        ...prev,
        currentSteps: healthData.steps,
        currentDistance: healthData.distance * 1000, // Converter km para metros
      }));

      // Verificar se completou a missão
      if (isStepsMission && healthData.steps >= state.targetSteps) {
        completeMission(healthData.steps);
      } else if (isDistanceMission && healthData.distance * 1000 >= state.targetDistance) {
        completeMission(Math.round(healthData.distance * 1000));
      }
    }
  }, [healthData, state.isRunning, state.isCompleted, isStepsMission, isDistanceMission, state.targetSteps, state.targetDistance]);

  // Gerar rota segura para caminhada
  const generateSafeRoute = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, error: null }));

      // Obter localização atual do usuário
      const currentLocation = mapUserLocation || await getCurrentLocation();
      if (!currentLocation) {
        setState(prev => ({ ...prev, error: "Não foi possível obter sua localização atual" }));
        return;
      }

      setState(prev => ({ ...prev, userLocation: currentLocation }));

      // Gerar ponto de destino baseado na meta de distância
      const targetDistance = state.targetDistance;
      const angle = Math.random() * 2 * Math.PI; // Direção aleatória
      const destination: [number, number] = [
        currentLocation[0] + (targetDistance / 111320) * Math.cos(angle) / Math.cos(currentLocation[1] * Math.PI / 180),
        currentLocation[1] + (targetDistance / 111320) * Math.sin(angle),
      ];

      // Obter rota do OpenRouteService
      const directions = await getDirections(currentLocation, destination, 'walking');

      setState(prev => ({
        ...prev,
        route: directions,
      }));

      // Adicionar marcadores no mapa
      clearMarkers();
      addMarker({
        id: 'start',
        longitude: currentLocation[0],
        latitude: currentLocation[1],
        title: 'Ponto de Partida',
        description: 'Sua localização atual',
        color: 'green',
      });

      addMarker({
        id: 'end',
        longitude: destination[0],
        latitude: destination[1],
        title: 'Destino',
        description: `Meta: ${targetDistance}m`,
        color: 'red',
      });

    } catch (error) {
      console.error('Erro ao gerar rota:', error);
      setState(prev => ({ 
        ...prev, 
        error: "Não foi possível gerar uma rota segura. Tente novamente." 
      }));
    }
  }, [mapUserLocation, getCurrentLocation, getDirections, addMarker, clearMarkers, state.targetDistance]);

  // Iniciar execução da missão
  const startExecution = useCallback(async () => {
    try {
      setState(prev => ({
        ...prev,
        isRunning: true,
        isPaused: false,
        startTime: new Date(),
        error: null,
      }));

      // Gerar rota segura
      await generateSafeRoute();

      // Se não estiver autenticado com Google Fit, usar dados simulados
      if (!isAuthenticated) {
        console.warn('Google Fit não autenticado. Usando dados simulados.');
      }

    } catch (error) {
      console.error('Erro ao iniciar execução:', error);
      setState(prev => ({
        ...prev,
        isRunning: false,
        error: "Falha ao iniciar a missão. Tente novamente.",
      }));
    }
  }, [generateSafeRoute, isAuthenticated]);

  // Pausar/Retomar execução
  const togglePause = useCallback(() => {
    setState(prev => ({
      ...prev,
      isPaused: !prev.isPaused,
    }));
  }, []);

  // Completar missão
  const completeMission = useCallback(async (finalValue: number) => {
    try {
      setState(prev => ({
        ...prev,
        isCompleted: true,
        endTime: new Date(),
        isRunning: false,
        isPaused: false,
      }));

      // Completar missão com valor verificado
      await onComplete(mission.id, finalValue, true);

    } catch (error) {
      console.error('Erro ao completar missão:', error);
      setState(prev => ({
        ...prev,
        error: "Falha ao registrar conclusão da missão.",
      }));
    }
  }, [mission.id, onComplete]);

  // Cancelar execução
  const cancelExecution = useCallback(() => {
    setState(prev => ({
      ...prev,
      isRunning: false,
      isPaused: false,
      endTime: new Date(),
    }));
    clearMarkers();
    onClose();
  }, [clearMarkers, onClose]);

  // Calcular progresso
  const progress = isStepsMission 
    ? Math.min(100, (state.currentSteps / state.targetSteps) * 100)
    : Math.min(100, (state.currentDistance / state.targetDistance) * 100);

  // Calcular tempo decorrido
  const elapsedSeconds = state.startTime 
    ? Math.floor((Date.now() - state.startTime.getTime()) / 1000)
    : 0;

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100">
                <Navigation className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{mission.title}</h2>
                <p className="text-sm text-gray-600">
                  {isStepsMission ? `${state.targetSteps.toLocaleString()} passos` : `${state.targetDistance.toLocaleString()} metros`}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={cancelExecution}>
              Fechar
            </Button>
          </div>

          {/* Error Display */}
          {state.error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-sm text-red-700">{state.error}</p>
            </div>
          )}

          {/* Progress Overview */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Progresso</span>
              <span className="text-sm text-gray-600">
                {progress.toFixed(1)}% completo
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Passos:</span>
                <p className="font-semibold">
                  {state.currentSteps.toLocaleString()} / {state.targetSteps.toLocaleString()}
                </p>
              </div>
              <div>
                <span className="text-gray-600">Distância:</span>
                <p className="font-semibold">
                  {(state.currentDistance / 1000).toFixed(2)}km / {(state.targetDistance / 1000).toFixed(2)}km
                </p>
              </div>
            </div>
          </div>

          {/* Route Information */}
          {state.route && (
            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Rota Sugerida
              </h3>
              <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Distância da rota:</span>
                  <span className="font-medium">{(state.route.distance / 1000).toFixed(2)}km</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Tempo estimado:</span>
                  <span className="font-medium">{formatTime(Math.round(state.route.duration))}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Status:</span>
                  <Badge variant={state.isCompleted ? "default" : "neutral"}>
                    {state.isCompleted ? "Concluída" : state.isRunning ? "Em andamento" : "Pendente"}
                  </Badge>
                </div>
              </div>
            </div>
          )}

          {/* Timer */}
          <div className="flex items-center justify-center">
            <div className="text-center">
              <Clock className="w-8 h-8 mx-auto mb-2 text-gray-600" />
              <div className="text-2xl font-bold">
                {formatTime(elapsedSeconds)}
              </div>
              <p className="text-sm text-gray-600">Tempo decorrido</p>
            </div>
          </div>

          {/* Health Data Status */}
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-700">Fonte de dados:</span>
              <Badge variant="neutral">
                {healthData?.source === 'google-fit' ? 'Google Fit' : 'Dados Simulados'}
              </Badge>
            </div>
            {healthData?.lastUpdated && (
              <p className="text-xs text-blue-600 mt-1">
                Última atualização: {new Date(healthData.lastUpdated).toLocaleTimeString()}
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            {!state.isRunning && !state.isCompleted && (
              <Button onClick={startExecution} className="flex-1">
                <Navigation className="w-4 h-4 mr-2" />
                Iniciar Caminhada
              </Button>
            )}

            {state.isRunning && !state.isCompleted && (
              <>
                <Button onClick={togglePause} variant="outline" className="flex-1">
                  {state.isPaused ? 'Retomar' : 'Pausar'}
                </Button>
                <Button 
                  onClick={() => completeMission(isStepsMission ? state.currentSteps : Math.round(state.currentDistance))}
                  className="flex-1"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Concluir
                </Button>
              </>
            )}

            {state.isCompleted && (
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-green-600 mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                  <span className="font-semibold">Missão Concluída!</span>
                </div>
                <Button onClick={cancelExecution} className="w-full">
                  Fechar
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default memo(WalkingMissionExecution);
