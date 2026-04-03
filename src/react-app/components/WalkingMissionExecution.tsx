/**
 * Modal de execucao para missoes de caminhada e corrida.
 * Mantem a UI sincronizada com saude, rota e conclusao da missao.
 */

import { memo, useCallback, useEffect, useState } from "react";
import { MapPin, Navigation, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Badge } from "@/react-app/components/ui/badge";
import { useHealthData } from "@/react-app/hooks/useHealthData";
import { useMapService } from "@/react-app/hooks/useMapService";
import { formatStepsSourceLabel } from "@/react-app/services/native/stepsService";
import type { Mission, MissionMetricType } from "@/shared/types";

const NOOP_ASYNC_LOCATION_TRACKING = async (): Promise<void> => undefined;
const NOOP_LOCATION_TRACKING = (): void => undefined;

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
  const { healthData } = useHealthData({
    autoRefresh: true,
    refreshInterval: 1,
  });

  const {
    getCurrentLocation,
    getDirections,
    addMarker,
    clearMarkers,
    userLocation: mapUserLocation,
    startForegroundLocationTracking = NOOP_ASYNC_LOCATION_TRACKING,
    stopForegroundLocationTracking = NOOP_LOCATION_TRACKING,
    locationPrecision = "precise",
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

  // Resolve o tipo de metrica esperado para a missao ativa.
  const metricType = mission.metric_type as MissionMetricType;
  const isStepsMission = metricType === "steps";
  const isDistanceMission = metricType === "distance_meters";

  // Finaliza a missao usando o valor confirmado pela fonte ativa.
  const completeMission = useCallback(async (finalValue: number) => {
    try {
      setState((prev) => ({
        ...prev,
        isCompleted: true,
        endTime: new Date(),
        isRunning: false,
        isPaused: false,
      }));
      stopForegroundLocationTracking();

      const verified = healthData
        ? healthData.source !== "api" && healthData.source !== "unavailable"
        : false;
      await onComplete(mission.id, finalValue, verified);
    } catch (error) {
      console.error("Erro ao completar missao:", error);
      setState((prev) => ({
        ...prev,
        error: "Falha ao registrar conclusao da missao.",
      }));
    }
  }, [healthData, mission.id, onComplete, stopForegroundLocationTracking]);

  // Converte a meta para passos e distancia a partir da configuracao da missao.
  useEffect(() => {
    if (isStepsMission) {
      setState((prev) => ({
        ...prev,
        targetSteps: mission.metric_value || 5000,
        targetDistance: (mission.metric_value || 5000) * 0.0007,
      }));
    } else if (isDistanceMission) {
      setState((prev) => ({
        ...prev,
        targetDistance: mission.metric_value || 3000,
        targetSteps: Math.ceil((mission.metric_value || 3000) / 0.0007),
      }));
    }
  }, [mission, isStepsMission, isDistanceMission]);

  // Mantem o progresso local alinhado com a fonte de saude ativa.
  useEffect(() => {
    if (healthData && state.isRunning && !state.isCompleted) {
      setState((prev) => ({
        ...prev,
        currentSteps: healthData.steps,
        currentDistance: healthData.distance * 1000,
      }));

      if (isStepsMission && healthData.steps >= state.targetSteps) {
        void completeMission(healthData.steps);
      } else if (isDistanceMission && healthData.distance * 1000 >= state.targetDistance) {
        void completeMission(Math.round(healthData.distance * 1000));
      }
    }
  }, [
    completeMission,
    healthData,
    isDistanceMission,
    isStepsMission,
    state.isCompleted,
    state.isRunning,
    state.targetDistance,
    state.targetSteps,
  ]);

  // Gera uma rota sugerida a partir da posicao atual e da meta calculada.
  const generateSafeRoute = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null }));

      const currentLocation = mapUserLocation || await getCurrentLocation();
      if (!currentLocation) {
        setState((prev) => ({ ...prev, error: "Nao foi possivel obter sua localizacao atual" }));
        return;
      }

      setState((prev) => ({ ...prev, userLocation: currentLocation }));

      const targetDistance = state.targetDistance;
      const angle = Math.random() * 2 * Math.PI;
      const destination: [number, number] = [
        currentLocation[0] + (targetDistance / 111320) * Math.cos(angle) / Math.cos(currentLocation[1] * Math.PI / 180),
        currentLocation[1] + (targetDistance / 111320) * Math.sin(angle),
      ];

      const directions = await getDirections(currentLocation, destination, "foot-walking");

      setState((prev) => ({
        ...prev,
        route: directions,
      }));

      clearMarkers();
      addMarker({
        id: "start",
        longitude: currentLocation[0],
        latitude: currentLocation[1],
        title: "Ponto de Partida",
        description: "Sua localizacao atual",
        color: "green",
      });

      addMarker({
        id: "end",
        longitude: destination[0],
        latitude: destination[1],
        title: "Destino",
        description: `Meta: ${targetDistance}m`,
        color: "red",
      });
    } catch (error) {
      console.error("Erro ao gerar rota:", error);
      setState((prev) => ({
        ...prev,
        error: "Nao foi possivel gerar uma rota segura. Tente novamente.",
      }));
    }
  }, [addMarker, clearMarkers, getCurrentLocation, getDirections, mapUserLocation, state.targetDistance]);

  // Inicia a execucao, prepara a rota e marca o relogio inicial.
  const startExecution = useCallback(async () => {
    try {
      setState((prev) => ({
        ...prev,
        isRunning: true,
        isPaused: false,
        startTime: new Date(),
        error: null,
      }));

      await generateSafeRoute();
      await startForegroundLocationTracking();

      if (import.meta.env.DEV && healthData && healthData.confidence !== "official") {
        console.warn(`Fonte de passos em fallback: ${formatStepsSourceLabel(healthData.source)}.`);
      }
    } catch (error) {
      console.error("Erro ao iniciar execucao:", error);
      setState((prev) => ({
        ...prev,
        isRunning: false,
        error: "Falha ao iniciar a missao. Tente novamente.",
      }));
    }
  }, [generateSafeRoute, healthData]);

  // Alterna entre execucao ativa e pausada.
  const togglePause = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isPaused: !prev.isPaused,
    }));
  }, []);

  // Cancela a execucao, limpa o mapa e fecha o modal.
  const cancelExecution = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isRunning: false,
      isPaused: false,
      endTime: new Date(),
    }));
    stopForegroundLocationTracking();
    clearMarkers();
    onClose();
  }, [clearMarkers, onClose, stopForegroundLocationTracking]);

  useEffect(() => {
    return () => {
      stopForegroundLocationTracking();
    };
  }, [stopForegroundLocationTracking]);

  // Deriva o percentual de progresso a partir da metrica da missao.
  const progress = isStepsMission
    ? Math.min(100, (state.currentSteps / state.targetSteps) * 100)
    : Math.min(100, (state.currentDistance / state.targetDistance) * 100);

  // Calcula o tempo corrido desde o inicio da execucao.
  const elapsedSeconds = state.startTime
    ? Math.floor((Date.now() - state.startTime.getTime()) / 1000)
    : 0;

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Cabecalho da missao */}
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

          {/* Erro operacional da execucao */}
          {state.error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-sm text-red-700">{state.error}</p>
            </div>
          )}

          {/* Resumo de progresso */}
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
                <span className="text-gray-600">Distancia:</span>
                <p className="font-semibold">
                  {(state.currentDistance / 1000).toFixed(2)}km / {(state.targetDistance / 1000).toFixed(2)}km
                </p>
              </div>
            </div>
          </div>

          {/* Dados da rota sugerida */}
          {state.route && (
            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Rota Sugerida
              </h3>
              <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Distancia da rota:</span>
                  <span className="font-medium">{(state.route.distance / 1000).toFixed(2)}km</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Tempo estimado:</span>
                  <span className="font-medium">{formatTime(Math.round(state.route.duration))}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Status:</span>
                  <Badge variant={state.isCompleted ? "default" : "neutral"}>
                    {state.isCompleted ? "Concluida" : state.isRunning ? "Em andamento" : "Pendente"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Precisao do GPS:</span>
                  <span className="font-medium">
                    {locationPrecision === "approximate" ? "Aproximada" : "Precisa"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Cronometro da execucao */}
          <div className="flex items-center justify-center">
            <div className="text-center">
              <Clock className="w-8 h-8 mx-auto mb-2 text-gray-600" />
              <div className="text-2xl font-bold">
                {formatTime(elapsedSeconds)}
              </div>
              <p className="text-sm text-gray-600">Tempo decorrido</p>
            </div>
          </div>

          {/* Origem e atualizacao dos dados de saude */}
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-700">Fonte de dados:</span>
              <Badge variant="neutral">
                {formatStepsSourceLabel(healthData?.source)}
              </Badge>
            </div>
            {healthData?.lastUpdated && (
              <p className="text-xs text-blue-600 mt-1">
                Ultima atualizacao: {new Date(healthData.lastUpdated).toLocaleTimeString()}
              </p>
            )}
          </div>

          {/* Acoes disponiveis conforme o estado da execucao */}
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
                  {state.isPaused ? "Retomar" : "Pausar"}
                </Button>
                <Button
                  onClick={() => {
                    void completeMission(
                      isStepsMission ? state.currentSteps : Math.round(state.currentDistance),
                    );
                  }}
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
                  <span className="font-semibold">Missao Concluida!</span>
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
