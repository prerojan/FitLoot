/**
 * Hook especializado para missoes de caminhada e corrida.
 * Usa metricas consolidadas para passos/calorias e localizacao para distancia de sessao.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useHealthData } from "./useHealthData";
import { formatStepsSourceLabel } from "@/react-app/services/native/stepsService";
import { openStreetMapService } from "@/react-app/services/openStreetMapService";
import {
  locationRuntimeService,
  type LocationPermissionStatus,
  type RuntimeLocation,
} from "@/react-app/services/runtime/locationRuntimeService";
import type { Mission, MissionMetricType } from "@/shared/types";

const MIN_TRACKED_SEGMENT_METERS = 2;
const MAX_TRACKED_SEGMENT_METERS = 250;

type SessionMetricsSnapshot = {
  steps: number;
  calories: number;
};

export interface WalkingMissionState {
  isRunning: boolean;
  isPaused: boolean;
  isCompleted: boolean;
  startTime: Date | null;
  endTime: Date | null;
  currentSteps: number;
  currentDistance: number;
  currentCalories: number;
  targetSteps: number;
  targetDistance: number;
  error: string | null;
  progress: number;
  elapsedSeconds: number;
  locationPrecision: LocationPermissionStatus["precision"];
}

export interface UseWalkingMissionOptions {
  mission: Mission;
  onComplete: (id: number, value: number, verified: boolean) => Promise<void>;
  autoRefresh?: boolean;
}

const DEFAULT_SESSION_METRICS: SessionMetricsSnapshot = {
  steps: 0,
  calories: 0,
};

function resolveAbsoluteSteps(steps: number | undefined): number {
  return Math.max(0, Math.round(Number(steps ?? 0) || 0));
}

function resolveAbsoluteCalories(calories: number | undefined): number {
  return Math.max(0, Math.round(Number(calories ?? 0) || 0));
}

function resolveMissionTargets(mission: Mission, isDistanceMission: boolean) {
  if (isDistanceMission) {
    const targetDistance = Math.max(1, Math.round(Number(mission.metric_value ?? 3000) || 3000));
    return {
      targetDistance,
      targetSteps: Math.ceil(targetDistance / 0.7),
    };
  }

  const targetSteps = Math.max(1, Math.round(Number(mission.metric_value ?? 5000) || 5000));
  return {
    targetSteps,
    targetDistance: Math.round(targetSteps * 0.7),
  };
}

export const useWalkingMission = ({ mission, onComplete, autoRefresh = true }: UseWalkingMissionOptions) => {
  const { healthData, isAuthenticated } = useHealthData({
    autoRefresh,
    enableFallback: true,
  });

  const metricType = mission.metric_type as MissionMetricType;
  const isStepsMission = metricType === "steps";
  const isDistanceMission = metricType === "distance_meters";
  const initialPermission = locationRuntimeService.getState().permission;
  const initialTargets = resolveMissionTargets(mission, isDistanceMission);

  const [state, setState] = useState<WalkingMissionState>({
    isRunning: false,
    isPaused: false,
    isCompleted: false,
    startTime: null,
    endTime: null,
    currentSteps: 0,
    currentDistance: 0,
    currentCalories: 0,
    targetSteps: initialTargets.targetSteps,
    targetDistance: initialTargets.targetDistance,
    error: null,
    progress: 0,
    elapsedSeconds: 0,
    locationPrecision: initialPermission.precision,
  });

  const sessionBaselineRef = useRef<SessionMetricsSnapshot>(DEFAULT_SESSION_METRICS);
  const pauseSnapshotRef = useRef<SessionMetricsSnapshot | null>(null);
  const trackedDistanceMetersRef = useRef<number>(0);
  const lastTrackedLocationRef = useRef<RuntimeLocation | null>(null);
  const elapsedBeforePauseRef = useRef<number>(0);
  const resumedAtRef = useRef<number | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const nextTargets = resolveMissionTargets(mission, isDistanceMission);
    setState((current) => ({
      ...current,
      targetSteps: nextTargets.targetSteps,
      targetDistance: nextTargets.targetDistance,
    }));
  }, [isDistanceMission, mission]);

  const resolveElapsedSeconds = useCallback((): number => {
    const liveSeconds = resumedAtRef.current
      ? Math.max(0, Math.floor((Date.now() - resumedAtRef.current) / 1000))
      : 0;
    return elapsedBeforePauseRef.current + liveSeconds;
  }, []);

  const stopTracking = useCallback(() => {
    locationRuntimeService.stopForegroundLocationTracking();
  }, []);

  const completeMission = useCallback(async (finalValue: number) => {
    try {
      const elapsedSeconds = resolveElapsedSeconds();
      stopTracking();
      resumedAtRef.current = null;

      setState((current) => ({
        ...current,
        isCompleted: true,
        endTime: new Date(),
        isRunning: false,
        isPaused: false,
        elapsedSeconds,
      }));

      const verified = healthData
        ? healthData.source !== "api" && healthData.source !== "unavailable"
        : false;
      await onComplete(mission.id, finalValue, verified);
    } catch (error) {
      console.error("Erro ao completar missao:", error);
      setState((current) => ({
        ...current,
        error: "Falha ao registrar conclusao da missao.",
      }));
    }
  }, [healthData, mission.id, onComplete, resolveElapsedSeconds, stopTracking]);

  useEffect(() => {
    return locationRuntimeService.subscribe((runtimeState) => {
      setState((current) => (
        current.locationPrecision === runtimeState.permission.precision
          ? current
          : { ...current, locationPrecision: runtimeState.permission.precision }
      ));

      if (!isDistanceMission) {
        return;
      }

      const currentState = stateRef.current;
      if (!currentState.isRunning || currentState.isPaused || currentState.isCompleted) {
        return;
      }

      const nextLocation = runtimeState.location;
      if (!nextLocation) {
        return;
      }

      const previousLocation = lastTrackedLocationRef.current;
      lastTrackedLocationRef.current = nextLocation;

      if (!previousLocation) {
        return;
      }

      const segmentDistance = openStreetMapService.calculateDistance(
        [previousLocation.longitude, previousLocation.latitude],
        [nextLocation.longitude, nextLocation.latitude],
      );

      if (
        !Number.isFinite(segmentDistance)
        || segmentDistance < MIN_TRACKED_SEGMENT_METERS
        || segmentDistance > MAX_TRACKED_SEGMENT_METERS
      ) {
        return;
      }

      trackedDistanceMetersRef.current += segmentDistance;
      const nextDistance = Math.round(trackedDistanceMetersRef.current);

      setState((current) => {
        const progress = Math.min(100, (nextDistance / Math.max(1, current.targetDistance)) * 100);
        if (current.currentDistance === nextDistance && current.progress === progress) {
          return current;
        }

        return {
          ...current,
          currentDistance: nextDistance,
          progress,
        };
      });

      if (nextDistance >= stateRef.current.targetDistance) {
        void completeMission(nextDistance);
      }
    });
  }, [completeMission, isDistanceMission]);

  useEffect(() => {
    if (!healthData) {
      return;
    }

    const absoluteSteps = resolveAbsoluteSteps(healthData.steps);
    const absoluteCalories = resolveAbsoluteCalories(healthData.calories);
    const absoluteDistanceMeters = Math.max(0, Math.round(Number(healthData.distance ?? 0) * 1000));
    const currentState = stateRef.current;

    if (!currentState.isRunning || currentState.isCompleted || currentState.isPaused) {
      if (!isDistanceMission) {
        setState((current) => {
          const progress = Math.min(100, (absoluteSteps / Math.max(1, current.targetSteps)) * 100);
          return {
            ...current,
            currentSteps: absoluteSteps,
            currentDistance: absoluteDistanceMeters,
            currentCalories: absoluteCalories,
            progress,
          };
        });
      }
      return;
    }

    const nextSteps = isDistanceMission
      ? Math.max(0, absoluteSteps - sessionBaselineRef.current.steps)
      : absoluteSteps;
    const nextCalories = isDistanceMission
      ? Math.max(0, absoluteCalories - sessionBaselineRef.current.calories)
      : absoluteCalories;
    const nextDistance = isDistanceMission ? currentState.currentDistance : absoluteDistanceMeters;
    const nextProgress = isDistanceMission
      ? Math.min(100, (nextDistance / Math.max(1, currentState.targetDistance)) * 100)
      : Math.min(100, (nextSteps / Math.max(1, currentState.targetSteps)) * 100);

    setState((current) => {
      if (
        current.currentSteps === nextSteps
        && current.currentCalories === nextCalories
        && current.progress === nextProgress
        && (!isStepsMission || current.currentDistance === nextDistance)
      ) {
        return current;
      }

      return {
        ...current,
        currentSteps: nextSteps,
        currentDistance: nextDistance,
        currentCalories: nextCalories,
        progress: nextProgress,
      };
    });

    if (isStepsMission && nextSteps >= currentState.targetSteps) {
      void completeMission(nextSteps);
    }
  }, [completeMission, healthData, isDistanceMission, isStepsMission]);

  useEffect(() => {
    if (!state.isRunning || state.isPaused || state.isCompleted) {
      return;
    }

    const timer = window.setInterval(() => {
      const elapsedSeconds = resolveElapsedSeconds();
      setState((current) => (
        current.elapsedSeconds === elapsedSeconds
          ? current
          : { ...current, elapsedSeconds }
      ));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resolveElapsedSeconds, state.isCompleted, state.isPaused, state.isRunning]);

  const startExecution = useCallback(async () => {
    try {
      const absoluteSteps = resolveAbsoluteSteps(healthData?.steps);
      const absoluteCalories = resolveAbsoluteCalories(healthData?.calories);
      const absoluteDistanceMeters = Math.max(0, Math.round(Number(healthData?.distance ?? 0) * 1000));
      const precision = locationRuntimeService.getState().permission.precision;
      const nextTargets = resolveMissionTargets(mission, isDistanceMission);

      sessionBaselineRef.current = isDistanceMission
        ? {
            steps: absoluteSteps,
            calories: absoluteCalories,
          }
        : DEFAULT_SESSION_METRICS;
      pauseSnapshotRef.current = null;
      trackedDistanceMetersRef.current = 0;
      elapsedBeforePauseRef.current = 0;
      resumedAtRef.current = Date.now();

      if (isDistanceMission) {
        const currentLocation = await locationRuntimeService.getCurrentLocation();
        if (!currentLocation) {
          resumedAtRef.current = null;
          setState((current) => ({
            ...current,
            error: "Ative a localizacao para iniciar esta missao de distancia.",
          }));
          return;
        }
        lastTrackedLocationRef.current = currentLocation;
      } else {
        lastTrackedLocationRef.current = null;
      }

      setState((current) => ({
        ...current,
        isRunning: true,
        isPaused: false,
        isCompleted: false,
        startTime: new Date(),
        endTime: null,
        currentSteps: isDistanceMission ? 0 : absoluteSteps,
        currentDistance: isDistanceMission ? 0 : absoluteDistanceMeters,
        currentCalories: isDistanceMission ? 0 : absoluteCalories,
        error: null,
        progress: isDistanceMission
          ? 0
          : Math.min(100, (absoluteSteps / Math.max(1, nextTargets.targetSteps)) * 100),
        elapsedSeconds: 0,
        locationPrecision: precision,
      }));

      await locationRuntimeService.startForegroundLocationTracking();

      if (import.meta.env.DEV && healthData && healthData.confidence !== "official") {
        console.warn(`Fonte de passos em fallback: ${formatStepsSourceLabel(healthData.source)}.`);
      }
    } catch (error) {
      console.error("Erro ao iniciar execucao:", error);
      resumedAtRef.current = null;
      setState((current) => ({
        ...current,
        isRunning: false,
        isPaused: false,
        error: "Falha ao iniciar a missao. Tente novamente.",
      }));
    }
  }, [healthData, isDistanceMission, mission]);

  const togglePause = useCallback(() => {
    if (!stateRef.current.isRunning || stateRef.current.isCompleted) {
      return;
    }

    const absoluteSteps = resolveAbsoluteSteps(healthData?.steps);
    const absoluteCalories = resolveAbsoluteCalories(healthData?.calories);

    if (stateRef.current.isPaused) {
      if (isDistanceMission && pauseSnapshotRef.current) {
        sessionBaselineRef.current = {
          steps:
            sessionBaselineRef.current.steps
            + Math.max(0, absoluteSteps - pauseSnapshotRef.current.steps),
          calories:
            sessionBaselineRef.current.calories
            + Math.max(0, absoluteCalories - pauseSnapshotRef.current.calories),
        };
      }

      pauseSnapshotRef.current = null;
      resumedAtRef.current = Date.now();

      void (async () => {
        if (isDistanceMission) {
          const currentLocation = await locationRuntimeService.getCurrentLocation();
          if (currentLocation) {
            lastTrackedLocationRef.current = currentLocation;
          }
        }
        await locationRuntimeService.startForegroundLocationTracking();
      })();

      setState((current) => ({
        ...current,
        isPaused: false,
        error: null,
      }));
      return;
    }

    if (resumedAtRef.current) {
      elapsedBeforePauseRef.current += Math.max(0, Math.floor((Date.now() - resumedAtRef.current) / 1000));
    }
    resumedAtRef.current = null;
    stopTracking();

    if (isDistanceMission) {
      pauseSnapshotRef.current = {
        steps: absoluteSteps,
        calories: absoluteCalories,
      };
    }

    setState((current) => ({
      ...current,
      isPaused: true,
      elapsedSeconds: elapsedBeforePauseRef.current,
    }));
  }, [healthData, isDistanceMission, stopTracking]);

  const cancelExecution = useCallback(() => {
    stopTracking();
    resumedAtRef.current = null;
    setState((current) => ({
      ...current,
      isRunning: false,
      isPaused: false,
      endTime: new Date(),
      elapsedSeconds: resolveElapsedSeconds(),
    }));
  }, [resolveElapsedSeconds, stopTracking]);

  const resetExecution = useCallback(() => {
    stopTracking();
    sessionBaselineRef.current = DEFAULT_SESSION_METRICS;
    pauseSnapshotRef.current = null;
    trackedDistanceMetersRef.current = 0;
    lastTrackedLocationRef.current = null;
    elapsedBeforePauseRef.current = 0;
    resumedAtRef.current = null;

    const nextTargets = resolveMissionTargets(mission, isDistanceMission);
    setState({
      isRunning: false,
      isPaused: false,
      isCompleted: false,
      startTime: null,
      endTime: null,
      currentSteps: 0,
      currentDistance: 0,
      currentCalories: 0,
      targetSteps: nextTargets.targetSteps,
      targetDistance: nextTargets.targetDistance,
      error: null,
      progress: 0,
      elapsedSeconds: 0,
      locationPrecision: locationRuntimeService.getState().permission.precision,
    });
  }, [isDistanceMission, mission, stopTracking]);

  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

  return {
    state,
    startExecution,
    togglePause,
    completeMission,
    cancelExecution,
    resetExecution,
    progress: state.progress,
    elapsedSeconds: state.elapsedSeconds,
    formattedTime: (() => {
      const hours = Math.floor(state.elapsedSeconds / 3600);
      const minutes = Math.floor((state.elapsedSeconds % 3600) / 60);
      const seconds = state.elapsedSeconds % 60;
      return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    })(),
    isStepsMission,
    isDistanceMission,
    healthData,
    isAuthenticated,
    canStart: !state.isRunning && !state.isCompleted,
    canPause: state.isRunning && !state.isPaused,
    canResume: state.isRunning && state.isPaused,
    canComplete: isDistanceMission
      ? state.currentDistance > 0
      : state.isRunning || state.currentSteps > 0 || state.currentDistance > 0,
    isReady: state.targetSteps > 0 || state.targetDistance > 0,
  };
};

export default useWalkingMission;
