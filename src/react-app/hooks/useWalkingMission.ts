/**
 * Hook especializado para missoes de caminhada e corrida.
 * Une sensores de saude, geolocalizacao e rota em um unico fluxo.
 */

import { useState, useEffect, useCallback } from "react";
import { useHealthData } from "./useHealthData";
import { useMapService } from "./useMapService";
import { formatStepsSourceLabel } from "@/react-app/services/native/stepsService";
import type { Mission, MissionMetricType } from "@/shared/types";

export interface WalkingMissionState {
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
  progress: number;
  elapsedSeconds: number;
}

export interface UseWalkingMissionOptions {
  mission: Mission;
  onComplete: (id: number, value: number, verified: boolean) => Promise<void>;
  autoRefresh?: boolean;
}

export const useWalkingMission = ({ mission, onComplete, autoRefresh = true }: UseWalkingMissionOptions) => {
  const { healthData, isAuthenticated } = useHealthData({
    autoRefresh,
    enableFallback: true,
  });

  const {
    getCurrentLocation,
    getDirections,
    addMarker,
    clearMarkers,
    userLocation: mapUserLocation,
  } = useMapService();

  const [state, setState] = useState<WalkingMissionState>({
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
    progress: 0,
    elapsedSeconds: 0,
  });

  // Resolve o tipo de metrica esperado para a missao atual.
  const metricType = mission.metric_type as MissionMetricType;
  const isStepsMission = metricType === "steps";
  const isDistanceMission = metricType === "distance_meters";

  // Finaliza a missao com o valor validado pela fonte disponivel.
  const completeMission = useCallback(async (finalValue: number) => {
    try {
      setState((prev) => ({
        ...prev,
        isCompleted: true,
        endTime: new Date(),
        isRunning: false,
        isPaused: false,
      }));

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
  }, [healthData, mission.id, onComplete]);

  // Converte a meta da missao para passos e distancia, mantendo ambos disponiveis.
  useEffect(() => {
    if (isStepsMission) {
      const targetSteps = mission.metric_value || 5000;
      setState((prev) => ({
        ...prev,
        targetSteps,
        targetDistance: targetSteps * 0.0007,
      }));
    } else if (isDistanceMission) {
      const targetDistance = mission.metric_value || 3000;
      setState((prev) => ({
        ...prev,
        targetDistance,
        targetSteps: Math.ceil(targetDistance / 0.0007),
      }));
    }
  }, [mission, isDistanceMission, isStepsMission]);

  // Sincroniza o progresso local com a fonte de saude ativa.
  useEffect(() => {
    if (healthData && state.isRunning && !state.isCompleted) {
      const newSteps = healthData.steps;
      const newDistance = healthData.distance * 1000;
      const newProgress = isStepsMission
        ? Math.min(100, (newSteps / state.targetSteps) * 100)
        : Math.min(100, (newDistance / state.targetDistance) * 100);

      setState((prev) => ({
        ...prev,
        currentSteps: newSteps,
        currentDistance: newDistance,
        progress: newProgress,
      }));

      if ((isStepsMission && newSteps >= state.targetSteps)
        || (isDistanceMission && newDistance >= state.targetDistance)) {
        void completeMission(isStepsMission ? newSteps : Math.round(newDistance));
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

  // Atualiza o cronometro enquanto a missao estiver em execucao.
  useEffect(() => {
    if (!state.isRunning || state.isPaused || state.isCompleted) return;

    const timer = setInterval(() => {
      setState((prev) => {
        if (prev.startTime) {
          const elapsed = Math.floor((Date.now() - prev.startTime.getTime()) / 1000);
          return { ...prev, elapsedSeconds: elapsed };
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state.isCompleted, state.isPaused, state.isRunning, state.startTime]);

  // Gera uma rota sugerida a partir da posicao atual e da meta de distancia.
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

  // Inicia a execucao, prepara a rota e registra o estado inicial.
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

  // Cancela a execucao e limpa os marcadores da sessao atual.
  const cancelExecution = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isRunning: false,
      isPaused: false,
      endTime: new Date(),
    }));
    clearMarkers();
  }, [clearMarkers]);

  // Reinicia o estado para uma nova tentativa da mesma missao.
  const resetExecution = useCallback(() => {
    setState({
      isRunning: false,
      isPaused: false,
      isCompleted: false,
      startTime: null,
      endTime: null,
      currentSteps: 0,
      currentDistance: 0,
      targetSteps: state.targetSteps,
      targetDistance: state.targetDistance,
      route: null,
      userLocation: null,
      error: null,
      progress: 0,
      elapsedSeconds: 0,
    });
    clearMarkers();
  }, [clearMarkers, state.targetDistance, state.targetSteps]);

  // Formata o cronometro em HH:MM:SS para a UI.
  const formatTime = useCallback((seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  return {
    // Estado exposto
    state,

    // Acoes de execucao
    startExecution,
    togglePause,
    completeMission,
    cancelExecution,
    resetExecution,

    // Derivados da execucao
    progress: state.progress,
    elapsedSeconds: state.elapsedSeconds,
    formattedTime: formatTime(state.elapsedSeconds),
    isStepsMission,
    isDistanceMission,
    healthData,
    isAuthenticated,

    // Flags prontas para a interface
    canStart: !state.isRunning && !state.isCompleted,
    canPause: state.isRunning && !state.isPaused,
    canResume: state.isRunning && state.isPaused,
    canComplete: state.isRunning || (state.currentSteps > 0 || state.currentDistance > 0),
    isReady: state.targetSteps > 0 || state.targetDistance > 0,
  };
};

export default useWalkingMission;
