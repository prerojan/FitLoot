/**
 * Hook especializado para missões de caminhada e corrida.
 * Une sensores de saúde, geolocalização e rota em um único fluxo.
 */

import { useState, useEffect, useCallback } from 'react';
import { useHealthData } from './useHealthData';
import { useMapService } from './useMapService';
import { formatStepsSourceLabel } from '@/react-app/services/native/stepsService';
import type { Mission, MissionMetricType } from '@/shared/types';

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
    autoRefresh: autoRefresh,
    enableFallback: true,
  });

  const { 
    getCurrentLocation, 
    getDirections, 
    addMarker, 
    clearMarkers,
    userLocation: mapUserLocation 
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

  // Resolve o tipo de métrica esperado para a missão atual.
  const metricType = mission.metric_type as MissionMetricType;
  const isStepsMission = metricType === "steps";
  const isDistanceMission = metricType === "distance_meters";

  // Converte a meta da missão para passos e distância, mantendo ambos disponíveis.
  useEffect(() => {
    if (isStepsMission) {
      const targetSteps = mission.metric_value || 5000;
      setState(prev => ({
        ...prev,
        targetSteps,
        targetDistance: targetSteps * 0.0007, // ~0.7m por passo
      }));
    } else if (isDistanceMission) {
      const targetDistance = mission.metric_value || 3000;
      setState(prev => ({
        ...prev,
        targetDistance,
        targetSteps: Math.ceil(targetDistance / 0.0007), // Converter para passos
      }));
    }
  }, [mission, isStepsMission, isDistanceMission]);

  // Sincroniza o progresso local com a fonte de saúde ativa.
  useEffect(() => {
    if (healthData && state.isRunning && !state.isCompleted) {
      const newSteps = healthData.steps;
      const newDistance = healthData.distance * 1000; // Converter km para metros
      const newProgress = isStepsMission 
        ? Math.min(100, (newSteps / state.targetSteps) * 100)
        : Math.min(100, (newDistance / state.targetDistance) * 100);

      setState(prev => ({
        ...prev,
        currentSteps: newSteps,
        currentDistance: newDistance,
        progress: newProgress,
      }));

      // Fecha automaticamente a missão quando a meta é atingida.
      if ((isStepsMission && newSteps >= state.targetSteps) || 
          (isDistanceMission && newDistance >= state.targetDistance)) {
        completeMission(isStepsMission ? newSteps : Math.round(newDistance));
      }
    }
  }, [healthData, state.isRunning, state.isCompleted, isStepsMission, isDistanceMission, state.targetSteps, state.targetDistance]);

  // Timer para tempo decorrido
  useEffect(() => {
    if (!state.isRunning || state.isPaused || state.isCompleted) return;

    const timer = setInterval(() => {
      setState(prev => {
        if (prev.startTime) {
          const elapsed = Math.floor((Date.now() - prev.startTime.getTime()) / 1000);
          return { ...prev, elapsedSeconds: elapsed };
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state.isRunning, state.isPaused, state.isCompleted, state.startTime]);

  // Gera uma rota sugerida a partir da posição atual e da meta de distância.
  const generateSafeRoute = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, error: null }));

      // Resolve a posição atual antes de montar o destino.
      const currentLocation = mapUserLocation || await getCurrentLocation();
      if (!currentLocation) {
        setState(prev => ({ ...prev, error: "Não foi possível obter sua localização atual" }));
        return;
      }

      setState(prev => ({ ...prev, userLocation: currentLocation }));

      // Projeta um destino inicial coerente com a meta.
      const targetDistance = state.targetDistance;
      const angle = Math.random() * 2 * Math.PI;
      const destination: [number, number] = [
        currentLocation[0] + (targetDistance / 111320) * Math.cos(angle) / Math.cos(currentLocation[1] * Math.PI / 180),
        currentLocation[1] + (targetDistance / 111320) * Math.sin(angle),
      ];

      const directions = await getDirections(currentLocation, destination, 'foot-walking');

      setState(prev => ({
        ...prev,
        route: directions,
      }));

      // Recria os marcadores da execução atual.
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

  // Inicia a execução, prepara a rota e registra o estado inicial.
  const startExecution = useCallback(async () => {
    try {
      setState(prev => ({
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
      console.error('Erro ao iniciar execução:', error);
      setState(prev => ({
        ...prev,
        isRunning: false,
        error: "Falha ao iniciar a missão. Tente novamente.",
      }));
    }
  }, [generateSafeRoute, healthData?.source, isAuthenticated]);

  // Alterna entre execução ativa e pausada.
  const togglePause = useCallback(() => {
    setState(prev => ({
      ...prev,
      isPaused: !prev.isPaused,
    }));
  }, []);

  // Finaliza a missão com o valor validado pela fonte disponível.
  const completeMission = useCallback(async (finalValue: number) => {
    try {
      setState(prev => ({
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
      console.error('Erro ao completar missão:', error);
      setState(prev => ({
        ...prev,
        error: "Falha ao registrar conclusão da missão.",
      }));
    }
  }, [mission.id, onComplete]);

  // Cancela a execução e limpa os marcadores da sessão atual.
  const cancelExecution = useCallback(() => {
    setState(prev => ({
      ...prev,
      isRunning: false,
      isPaused: false,
      endTime: new Date(),
    }));
    clearMarkers();
  }, [clearMarkers]);

  // Reinicia o estado para uma nova tentativa da mesma missão.
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
  }, [state.targetSteps, state.targetDistance, clearMarkers]);

  // Formata o cronômetro em HH:MM:SS para a UI.
  const formatTime = useCallback((seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    // Estado exposto
    state,
    
    // Ações de execução
    startExecution,
    togglePause,
    completeMission,
    cancelExecution,
    resetExecution,
    
    // Derivados da execução
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
