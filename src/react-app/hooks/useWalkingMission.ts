/**
 * Hook especializado para missoes de caminhada e corrida.
 * Usa metricas consolidadas para passos/calorias e localizacao para distancia de sessao.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useHealthData } from "./useHealthData";
import { formatStepsSourceLabel } from "@/react-app/services/native/stepsService";
import { openStreetMapService } from "@/react-app/services/openStreetMapService";
import {
  buildDistanceMissionSessionRoutePreview,
  calculateDistanceToRouteMeters,
  toRouteCoordinate,
  validateDistanceMissionStartLocation,
  type DistanceMissionRoutePreviewData,
} from "@/react-app/services/distanceMissionRoute";
import {
  locationRuntimeService,
  type LocationPermissionStatus,
  type RuntimeLocation,
} from "@/react-app/services/runtime/locationRuntimeService";
import type { MapCoordinate } from "@/shared/mapTypes";
import type { Mission, MissionMetricType } from "@/shared/types";

const MIN_TRACKED_SEGMENT_METERS = 2;
const MAX_TRACKED_SEGMENT_METERS = 250;
const MAX_TRACKABLE_ACCURACY_METERS = 45;
const MOTION_EVIDENCE_GRACE_MS = 20_000;
const MOVEMENT_DIRECTION_ALIGNMENT_THRESHOLD = 0.35;
const OFF_ROUTE_CONSECUTIVE_SAMPLES = 2;
const REROUTE_COOLDOWN_MS = 45_000;
const MIN_REROUTE_REMAINING_DISTANCE_METERS = 150;

type SessionMetricsSnapshot = {
  steps: number;
  calories: number;
};

type SessionRouteState = {
  preview: DistanceMissionRoutePreviewData | null;
  loading: boolean;
  error: string | null;
};

type PendingMovementCandidate = {
  anchorTimestamp: string;
  candidate: RuntimeLocation;
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

function hasReachedWalkingTarget(
  currentValue: number,
  targetValue: number,
): boolean {
  return Math.max(0, Math.round(currentValue)) >= Math.max(1, Math.round(targetValue));
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

const EMPTY_SESSION_ROUTE_STATE: SessionRouteState = {
  preview: null,
  loading: false,
  error: null,
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

function appendCoordinateIfNeeded(
  currentCoordinates: MapCoordinate[],
  nextCoordinate: MapCoordinate,
): MapCoordinate[] {
  const lastCoordinate = currentCoordinates[currentCoordinates.length - 1];
  if (
    lastCoordinate
    && Math.abs(lastCoordinate[0] - nextCoordinate[0]) <= 0.00001
    && Math.abs(lastCoordinate[1] - nextCoordinate[1]) <= 0.00001
  ) {
    return currentCoordinates;
  }

  return [...currentCoordinates, nextCoordinate];
}

function resolveRouteDeviationThresholdMeters(location: RuntimeLocation): number {
  const baseThreshold = location.precision === "approximate" ? 85 : 45;
  const accuracyThreshold = location.accuracyMeters > 0
    ? location.accuracyMeters * (location.precision === "approximate" ? 1.6 : 1.2)
    : 0;

  return Math.max(baseThreshold, Math.min(140, accuracyThreshold));
}

function isTrackableRuntimeLocation(location: RuntimeLocation): boolean {
  if (!Number.isFinite(location.accuracyMeters) || location.accuracyMeters <= 0) {
    return true;
  }

  const maxAccuracyMeters = location.precision === "approximate"
    ? MAX_TRACKABLE_ACCURACY_METERS * 1.4
    : MAX_TRACKABLE_ACCURACY_METERS;
  return location.accuracyMeters <= maxAccuracyMeters;
}

function resolveTrackedMovementThresholdMeters(
  anchorLocation: RuntimeLocation,
  nextLocation: RuntimeLocation,
): number {
  const baseThreshold =
    anchorLocation.precision === "approximate" || nextLocation.precision === "approximate"
      ? 16
      : 9;
  const accuracyThreshold = Math.max(anchorLocation.accuracyMeters, nextLocation.accuracyMeters) * 0.9;

  return Math.max(baseThreshold, Math.min(32, accuracyThreshold));
}

function hasRecentMotionEvidence(lastMotionTimestamp: number | null): boolean {
  return lastMotionTimestamp !== null && (Date.now() - lastMotionTimestamp) <= MOTION_EVIDENCE_GRACE_MS;
}

function resolveMovementVector(
  anchorLocation: RuntimeLocation,
  nextLocation: RuntimeLocation,
): { x: number; y: number } {
  return {
    x: nextLocation.longitude - anchorLocation.longitude,
    y: nextLocation.latitude - anchorLocation.latitude,
  };
}

function isMovementDirectionConsistent(
  anchorLocation: RuntimeLocation,
  candidateLocation: RuntimeLocation,
  nextLocation: RuntimeLocation,
): boolean {
  const candidateVector = resolveMovementVector(anchorLocation, candidateLocation);
  const nextVector = resolveMovementVector(anchorLocation, nextLocation);
  const candidateMagnitude = Math.hypot(candidateVector.x, candidateVector.y);
  const nextMagnitude = Math.hypot(nextVector.x, nextVector.y);

  if (candidateMagnitude <= 0.000001 || nextMagnitude <= 0.000001) {
    return false;
  }

  const directionCosine = (
    (candidateVector.x * nextVector.x)
    + (candidateVector.y * nextVector.y)
  ) / (candidateMagnitude * nextMagnitude);

  return directionCosine >= MOVEMENT_DIRECTION_ALIGNMENT_THRESHOLD;
}

function isMovementCandidateConfirmed(
  anchorLocation: RuntimeLocation,
  candidateLocation: RuntimeLocation,
  nextLocation: RuntimeLocation,
  thresholdMeters: number,
): boolean {
  const candidateDistanceFromAnchor = openStreetMapService.calculateDistance(
    [anchorLocation.longitude, anchorLocation.latitude],
    [candidateLocation.longitude, candidateLocation.latitude],
  );
  const nextDistanceFromAnchor = openStreetMapService.calculateDistance(
    [anchorLocation.longitude, anchorLocation.latitude],
    [nextLocation.longitude, nextLocation.latitude],
  );

  if (candidateDistanceFromAnchor < thresholdMeters || nextDistanceFromAnchor < thresholdMeters) {
    return false;
  }

  const candidateSpreadMeters = openStreetMapService.calculateDistance(
    [candidateLocation.longitude, candidateLocation.latitude],
    [nextLocation.longitude, nextLocation.latitude],
  );
  const maintainedDisplacement = nextDistanceFromAnchor >= candidateDistanceFromAnchor * 0.8;

  return maintainedDisplacement && (
    isMovementDirectionConsistent(anchorLocation, candidateLocation, nextLocation)
    || candidateSpreadMeters <= Math.max(18, thresholdMeters * 1.4)
  );
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
  const [routeState, setRouteState] = useState<SessionRouteState>(EMPTY_SESSION_ROUTE_STATE);
  const [currentLocation, setCurrentLocation] = useState<RuntimeLocation | null>(null);
  const [trackedCoordinates, setTrackedCoordinates] = useState<MapCoordinate[]>([]);

  const sessionBaselineRef = useRef<SessionMetricsSnapshot>(DEFAULT_SESSION_METRICS);
  const pauseSnapshotRef = useRef<SessionMetricsSnapshot | null>(null);
  const trackedDistanceMetersRef = useRef<number>(0);
  const lastTrackedLocationRef = useRef<RuntimeLocation | null>(null);
  const elapsedBeforePauseRef = useRef<number>(0);
  const resumedAtRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  const sessionOriginRef = useRef<RuntimeLocation | null>(null);
  const routePreviewRef = useRef<DistanceMissionRoutePreviewData | null>(null);
  const trackedCoordinatesRef = useRef<MapCoordinate[]>([]);
  const pendingMovementRef = useRef<PendingMovementCandidate | null>(null);
  const lastMotionEvidenceAtRef = useRef<number | null>(null);
  const activeRouteRequestRef = useRef<{
    key: string;
    promise: Promise<DistanceMissionRoutePreviewData | null>;
  } | null>(null);
  const isMountedRef = useRef(true);
  const rerouteStateRef = useRef({
    offRouteSamples: 0,
    lastRerouteAt: 0,
  });

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

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

  const resetRouteSession = useCallback(() => {
    sessionOriginRef.current = null;
    routePreviewRef.current = null;
    trackedCoordinatesRef.current = [];
    pendingMovementRef.current = null;
    lastMotionEvidenceAtRef.current = null;
    lastTrackedLocationRef.current = null;
    activeRouteRequestRef.current = null;
    rerouteStateRef.current = {
      offRouteSamples: 0,
      lastRerouteAt: 0,
    };
    setRouteState(EMPTY_SESSION_ROUTE_STATE);
    setCurrentLocation(null);
    setTrackedCoordinates([]);
  }, []);

  const requestSessionRoute = useCallback(async (
    originLocation: RuntimeLocation,
    requestedDistanceMeters: number,
    forceRefresh = false,
  ): Promise<DistanceMissionRoutePreviewData | null> => {
    if (!isDistanceMission) {
      return null;
    }

    const sessionOrigin = sessionOriginRef.current;
    if (!sessionOrigin) {
      return null;
    }

    const returnOrigin = toRouteCoordinate(sessionOrigin);
    const directDistanceToOrigin = openStreetMapService.calculateDistance(
      toRouteCoordinate(originLocation),
      returnOrigin,
    );
    const nextTargetDistance = Math.max(
      requestedDistanceMeters,
      Math.round(directDistanceToOrigin),
    );

    const requestKey = [
      mission.id,
      originLocation.latitude.toFixed(5),
      originLocation.longitude.toFixed(5),
      nextTargetDistance,
      returnOrigin[0].toFixed(5),
      returnOrigin[1].toFixed(5),
    ].join(":");

    if (!forceRefresh && activeRouteRequestRef.current?.key === requestKey) {
      return activeRouteRequestRef.current.promise;
    }

    setRouteState((current) => ({
      preview: current.preview,
      loading: true,
      error: null,
    }));

    const routePromise = buildDistanceMissionSessionRoutePreview(mission, {
      origin: originLocation,
      returnOrigin,
      targetDistanceMeters: nextTargetDistance,
    })
      .then((preview) => {
        if (!isMountedRef.current) {
          return preview;
        }
        routePreviewRef.current = preview;
        setRouteState({
          preview,
          loading: false,
          error: null,
        });
        return preview;
      })
      .catch((error) => {
        if (!isMountedRef.current) {
          return null;
        }
        const message = error instanceof Error
          ? error.message
          : "Nao foi possivel atualizar a rota em tempo real.";
        setRouteState((current) => ({
          preview: current.preview,
          loading: false,
          error: message,
        }));
        return null;
      })
      .finally(() => {
        if (activeRouteRequestRef.current?.key === requestKey) {
          activeRouteRequestRef.current = null;
        }
      });

    activeRouteRequestRef.current = {
      key: requestKey,
      promise: routePromise,
    };

    return routePromise;
  }, [isDistanceMission, mission]);

  const completeMission = useCallback(async (finalValue: number) => {
    const requiredTarget = isDistanceMission
      ? stateRef.current.targetDistance
      : stateRef.current.targetSteps;
    if (!hasReachedWalkingTarget(finalValue, requiredTarget)) {
      setState((current) => ({
        ...current,
        error: "A missao so pode ser concluida ao atingir 100% da meta.",
      }));
      return;
    }

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
  }, [
    healthData,
    isDistanceMission,
    mission.id,
    onComplete,
    resolveElapsedSeconds,
    stopTracking,
  ]);

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
      let nextDistance = currentState.currentDistance;

      if (!previousLocation) {
        const initialCoordinate = toRouteCoordinate(nextLocation);
        lastTrackedLocationRef.current = nextLocation;
        trackedCoordinatesRef.current = appendCoordinateIfNeeded(
          trackedCoordinatesRef.current,
          initialCoordinate,
        );
        setCurrentLocation(nextLocation);
        setTrackedCoordinates(trackedCoordinatesRef.current);
      } else {
        const segmentDistance = openStreetMapService.calculateDistance(
          [previousLocation.longitude, previousLocation.latitude],
          [nextLocation.longitude, nextLocation.latitude],
        );

        const movementThresholdMeters = resolveTrackedMovementThresholdMeters(previousLocation, nextLocation);
        const segmentIsTrackable =
          isTrackableRuntimeLocation(nextLocation)
          && Number.isFinite(segmentDistance)
          && segmentDistance >= Math.max(MIN_TRACKED_SEGMENT_METERS, movementThresholdMeters)
          && segmentDistance <= MAX_TRACKED_SEGMENT_METERS;

        if (!segmentIsTrackable) {
          pendingMovementRef.current = null;
        } else {
          const motionEvidenceActive = hasRecentMotionEvidence(lastMotionEvidenceAtRef.current);
          const pendingMovement = pendingMovementRef.current;
          const canAcceptSegment = motionEvidenceActive || (
            pendingMovement !== null
            && pendingMovement.anchorTimestamp === previousLocation.timestamp
            && isMovementCandidateConfirmed(
              previousLocation,
              pendingMovement.candidate,
              nextLocation,
              movementThresholdMeters,
            )
          );

          if (!canAcceptSegment) {
            pendingMovementRef.current = {
              anchorTimestamp: previousLocation.timestamp,
              candidate: nextLocation,
            };
          } else {
            pendingMovementRef.current = null;
            lastTrackedLocationRef.current = nextLocation;
            lastMotionEvidenceAtRef.current = Date.now();
            setCurrentLocation(nextLocation);

            trackedDistanceMetersRef.current += segmentDistance;
            nextDistance = Math.round(trackedDistanceMetersRef.current);

            trackedCoordinatesRef.current = appendCoordinateIfNeeded(
              trackedCoordinatesRef.current,
              toRouteCoordinate(nextLocation),
            );
            setTrackedCoordinates(trackedCoordinatesRef.current);

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
          }
        }
      }

      const trackedRouteLocation = lastTrackedLocationRef.current ?? nextLocation;
      const activeRoute = routePreviewRef.current;
      const sessionOrigin = sessionOriginRef.current;
      if (activeRoute && sessionOrigin && trackedRouteLocation) {
        const distanceToRouteMeters = calculateDistanceToRouteMeters(
          toRouteCoordinate(trackedRouteLocation),
          activeRoute.coordinates,
        );
        const routeDeviationThresholdMeters = resolveRouteDeviationThresholdMeters(trackedRouteLocation);

        if (distanceToRouteMeters > routeDeviationThresholdMeters) {
          rerouteStateRef.current.offRouteSamples += 1;
        } else {
          rerouteStateRef.current.offRouteSamples = 0;
        }

        const canReroute =
          rerouteStateRef.current.offRouteSamples >= OFF_ROUTE_CONSECUTIVE_SAMPLES
          && !activeRouteRequestRef.current
          && (Date.now() - rerouteStateRef.current.lastRerouteAt) >= REROUTE_COOLDOWN_MS;
        if (canReroute) {
          rerouteStateRef.current.offRouteSamples = 0;
          rerouteStateRef.current.lastRerouteAt = Date.now();

          const remainingDistanceMeters = Math.max(
            currentState.targetDistance - nextDistance,
            Math.round(openStreetMapService.calculateDistance(
              toRouteCoordinate(trackedRouteLocation),
              toRouteCoordinate(sessionOrigin),
            )),
          );

          if (remainingDistanceMeters >= MIN_REROUTE_REMAINING_DISTANCE_METERS) {
            void requestSessionRoute(trackedRouteLocation, remainingDistanceMeters, true);
          }
        }
      }

      if (nextDistance >= stateRef.current.targetDistance) {
        void completeMission(nextDistance);
      }
    });
  }, [completeMission, isDistanceMission, requestSessionRoute]);

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
    const nextDistance = isDistanceMission ? currentState.currentDistance : absoluteDistanceMeters;
    const hasSessionMotion = isDistanceMission && (
      nextSteps > 0
      || nextDistance >= MIN_TRACKED_SEGMENT_METERS
      || hasRecentMotionEvidence(lastMotionEvidenceAtRef.current)
    );
    const nextCalories = isDistanceMission
      ? (hasSessionMotion ? Math.max(0, absoluteCalories - sessionBaselineRef.current.calories) : 0)
      : absoluteCalories;
    const nextProgress = isDistanceMission
      ? Math.min(100, (nextDistance / Math.max(1, currentState.targetDistance)) * 100)
      : Math.min(100, (nextSteps / Math.max(1, currentState.targetSteps)) * 100);

    if (isDistanceMission && nextSteps > currentState.currentSteps) {
      lastMotionEvidenceAtRef.current = Date.now();
    }

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
      pendingMovementRef.current = null;
      lastMotionEvidenceAtRef.current = null;
      elapsedBeforePauseRef.current = 0;
      resumedAtRef.current = Date.now();

      if (isDistanceMission) {
        const currentRuntimeLocation = await locationRuntimeService.getCurrentLocation();
        const validationMessage = validateDistanceMissionStartLocation(currentRuntimeLocation);
        if (validationMessage) {
          resumedAtRef.current = null;
          setState((current) => ({
            ...current,
            error: validationMessage,
          }));
          return;
        }
        if (!currentRuntimeLocation) {
          resumedAtRef.current = null;
          return;
        }

        sessionOriginRef.current = currentRuntimeLocation;
        lastTrackedLocationRef.current = currentRuntimeLocation;
        routePreviewRef.current = null;
        trackedCoordinatesRef.current = [toRouteCoordinate(currentRuntimeLocation)];
        setCurrentLocation(currentRuntimeLocation);
        setTrackedCoordinates(trackedCoordinatesRef.current);
        setRouteState({
          preview: null,
          loading: true,
          error: null,
        });
      } else {
        lastTrackedLocationRef.current = null;
        resetRouteSession();
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

      const startTrackingPromise = locationRuntimeService.startForegroundLocationTracking();
      const sessionRoutePromise =
        isDistanceMission && sessionOriginRef.current
          ? requestSessionRoute(sessionOriginRef.current, nextTargets.targetDistance, true)
          : Promise.resolve(null);

      await Promise.all([startTrackingPromise, sessionRoutePromise]);

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
  }, [healthData, isDistanceMission, mission, requestSessionRoute, resetRouteSession]);

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
          const currentRuntimeLocation = await locationRuntimeService.getCurrentLocation();
          const validationMessage = validateDistanceMissionStartLocation(currentRuntimeLocation);
          if (!validationMessage && currentRuntimeLocation) {
            lastTrackedLocationRef.current = currentRuntimeLocation;
            setCurrentLocation(currentRuntimeLocation);

            const remainingDistanceMeters = Math.max(
              stateRef.current.targetDistance - stateRef.current.currentDistance,
              MIN_REROUTE_REMAINING_DISTANCE_METERS,
            );
            void requestSessionRoute(currentRuntimeLocation, remainingDistanceMeters, true);
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
  }, [healthData, isDistanceMission, requestSessionRoute, stopTracking]);

  const cancelExecution = useCallback(() => {
    stopTracking();
    resumedAtRef.current = null;
    resetRouteSession();
    setState((current) => ({
      ...current,
      isRunning: false,
      isPaused: false,
      endTime: new Date(),
      elapsedSeconds: resolveElapsedSeconds(),
    }));
  }, [resetRouteSession, resolveElapsedSeconds, stopTracking]);

  const resetExecution = useCallback(() => {
    stopTracking();
    sessionBaselineRef.current = DEFAULT_SESSION_METRICS;
    pauseSnapshotRef.current = null;
    trackedDistanceMetersRef.current = 0;
    lastTrackedLocationRef.current = null;
    pendingMovementRef.current = null;
    lastMotionEvidenceAtRef.current = null;
    elapsedBeforePauseRef.current = 0;
    resumedAtRef.current = null;
    resetRouteSession();

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
  }, [isDistanceMission, mission, resetRouteSession, stopTracking]);

  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

  return {
    state,
    routePreview: routeState.preview,
    routeLoading: routeState.loading,
    routeError: routeState.error,
    currentLocation,
    sessionOrigin: sessionOriginRef.current,
    trackedCoordinates,
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
      ? hasReachedWalkingTarget(state.currentDistance, state.targetDistance)
      : hasReachedWalkingTarget(state.currentSteps, state.targetSteps),
    isReady: state.targetSteps > 0 || state.targetDistance > 0,
  };
};

export default useWalkingMission;
