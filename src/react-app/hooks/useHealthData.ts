import { useCallback, useEffect, useMemo, useState } from "react";
import { googleFitService } from "../services/googleFit";
import { useDailyMetrics } from "./useDailyMetrics";
import type { MetricsConfidence, MetricsSource, MetricsValueSource } from "@/react-app/services/native/metricsService";

export interface HealthMetrics {
  steps: number;
  calories: number;
  distance: number;
  activeMinutes: number;
  heartRate: number | undefined;
  lastUpdated: string;
  source: MetricsSource;
  confidence: MetricsConfidence;
  caloriesSource: MetricsValueSource;
  sourceDetail?: string;
  sessionSteps?: number;
}

export interface UseHealthDataOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
  enableFallback?: boolean;
}

type ManualHealthOverride = {
  steps: number;
  calories: number;
  distance: number;
  activeMinutes: number;
};

const EMPTY_MANUAL_OVERRIDE: ManualHealthOverride = {
  steps: 0,
  calories: 0,
  distance: 0,
  activeMinutes: 0,
};

export const useHealthData = (options: UseHealthDataOptions = {}) => {
  void options;
  const { metrics, loading, error: metricsError, refreshMetrics } = useDailyMetrics({ syncRemote: true });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [manualOverride, setManualOverride] = useState<ManualHealthOverride>(EMPTY_MANUAL_OVERRIDE);

  const baseHealthData = useMemo<HealthMetrics | null>(() => {
    if (!metrics) return null;

    return {
      steps: metrics.steps,
      calories: metrics.caloriesBurned,
      distance: Math.max(0, (metrics.distanceMeters ?? 0) / 1000),
      activeMinutes: metrics.activeMinutes,
      heartRate: undefined,
      lastUpdated: metrics.lastUpdated,
      source: metrics.source,
      confidence: metrics.confidence,
      caloriesSource: metrics.caloriesSource,
      ...(typeof metrics.sourceDetail === "string" ? { sourceDetail: metrics.sourceDetail } : {}),
      ...(typeof metrics.sessionSteps === "number" ? { sessionSteps: metrics.sessionSteps } : {}),
    };
  }, [metrics]);

  const healthData = useMemo<HealthMetrics | null>(() => {
    if (!baseHealthData) return null;

    if (
      manualOverride.steps === 0 &&
      manualOverride.calories === 0 &&
      manualOverride.distance === 0 &&
      manualOverride.activeMinutes === 0
    ) {
      return baseHealthData;
    }

    return {
      ...baseHealthData,
      steps: baseHealthData.steps + manualOverride.steps,
      calories: baseHealthData.calories + manualOverride.calories,
      distance: Math.round((baseHealthData.distance + manualOverride.distance) * 1000) / 1000,
      activeMinutes: baseHealthData.activeMinutes + manualOverride.activeMinutes,
      lastUpdated: new Date().toISOString(),
      source: baseHealthData.source,
      confidence: baseHealthData.confidence,
      caloriesSource: baseHealthData.caloriesSource,
    };
  }, [baseHealthData, manualOverride]);

  const fetchHealthData = useCallback(async (): Promise<void> => {
    try {
      setLocalError(null);
      await refreshMetrics({ forceApi: true, syncRemote: true });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Falha ao carregar dados.");
    }
  }, [refreshMetrics]);

  const authenticate = useCallback(async (): Promise<boolean> => {
    try {
      setLocalError(null);
      const success = await googleFitService.authenticate();
      setIsAuthenticated(success);

      if (success) {
        await fetchHealthData();
      }

      return success;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Falha na autenticacao.");
      setIsAuthenticated(false);
      return false;
    }
  }, [fetchHealthData]);

  const addSteps = useCallback(async (additionalSteps: number): Promise<void> => {
    if (!Number.isFinite(additionalSteps) || additionalSteps <= 0) return;

    setManualOverride((current) => ({
      steps: current.steps + Math.round(additionalSteps),
      calories: current.calories,
      distance: current.distance + additionalSteps * 0.0007,
      activeMinutes: current.activeMinutes + Math.floor(additionalSteps / 100),
    }));
  }, []);

  const addCalories = useCallback(async (additionalCalories: number): Promise<void> => {
    if (!Number.isFinite(additionalCalories) || additionalCalories <= 0) return;

    setManualOverride((current) => ({
      ...current,
      calories: current.calories + Math.round(additionalCalories),
    }));
  }, []);

  const resetDailyData = useCallback((): void => {
    setManualOverride(EMPTY_MANUAL_OVERRIDE);
    setLocalError(null);
  }, []);

  const checkAuthStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await googleFitService.checkAuthStatus();
      setIsAuthenticated(!!status.oauthToken);
    } catch {
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    void checkAuthStatus();
  }, [checkAuthStatus]);

  return {
    healthData,
    loading,
    error: localError ?? metricsError,
    isAuthenticated,
    lastSync: healthData ? new Date(healthData.lastUpdated) : null,
    authenticate,
    fetchHealthData,
    addSteps,
    addCalories,
    resetDailyData,
    checkAuthStatus,
    isTodayData: healthData
      ? new Date(healthData.lastUpdated).toDateString() === new Date().toDateString()
      : false,
    stepsProgress: healthData ? Math.min((healthData.steps / 10000) * 100, 100) : 0,
    caloriesProgress: healthData ? Math.min((healthData.calories / 500) * 100, 100) : 0,
  };
};

export default useHealthData;
