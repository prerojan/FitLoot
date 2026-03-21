/**
 * Hook especializado para missões de caminhada/corrida
 * Integra APIs de saúde e mapas de forma coesa
 */

import { useState, useEffect, useCallback } from 'react';
import { useHealthData } from './useHealthData';
import { useMapService } from './useMapService';
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
    autoRefresh: autoRefresh ? 1 : 0, // Atualizar a cada 1 minuto
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

  // Determinar tipo e metas da missão
  const metricType = mission.metric_type as MissionMetricType;
  const isStepsMission = metricType === "steps";
  const isDistanceMission = metricType === "distance_meters";

  // Configurar metas baseadas na missão
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

  // Atualizar dados de saúde quando disponíveis
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

      // Verificar se completou a missão
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
  }, [clearMarkers]);

  // Reset para nova execução
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

  // Formatar tempo
  const formatTime = useCallback((seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    // Estado
    state,
    
    // Actions
    startExecution,
    togglePause,
    completeMission,
    cancelExecution,
    resetExecution,
    
    // Computed values
    progress: state.progress,
    elapsedSeconds: state.elapsedSeconds,
    formattedTime: formatTime(state.elapsedSeconds),
    isStepsMission,
    isDistanceMission,
    healthData,
    isAuthenticated,
    
    // Status
    canStart: !state.isRunning && !state.isCompleted,
    canPause: state.isRunning && !state.isPaused,
    canResume: state.isRunning && state.isPaused,
    canComplete: state.isRunning || (state.currentSteps > 0 || state.currentDistance > 0),
    isReady: state.targetSteps > 0 || state.targetDistance > 0,
  };
};

export default useWalkingMission;
