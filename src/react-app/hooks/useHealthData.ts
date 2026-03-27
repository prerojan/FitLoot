/**
 * Unified hook for health data.
 * Prioritizes Android native steps when available and falls back automatically.
 */

import { useCallback, useEffect, useState } from "react";
import { googleFitService } from "../services/googleFit";
import { stepsService, type StepSnapshot, type StepSource } from "../services/native/stepsService";

export interface HealthMetrics {
  steps: number;
  calories: number;
  distance: number;
  activeMinutes: number;
  heartRate: number | undefined;
  lastUpdated: string;
  source: StepSource;
}

export interface UseHealthDataOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
  enableFallback?: boolean;
}

function toHealthMetrics(snapshot: StepSnapshot): HealthMetrics {
  return {
    steps: snapshot.steps,
    calories: snapshot.calories,
    distance: snapshot.distance,
    activeMinutes: snapshot.activeMinutes,
    heartRate: snapshot.heartRate,
    lastUpdated: snapshot.lastUpdated,
    source: snapshot.source,
  };
}

export const useHealthData = (options: UseHealthDataOptions = {}) => {
  const {
    autoRefresh = true,
    refreshInterval = 5,
    enableFallback = true,
  } = options;

  const [healthData, setHealthData] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const applySnapshot = useCallback((snapshot: StepSnapshot) => {
    setHealthData(toHealthMetrics(snapshot));
    setLastSync(new Date(snapshot.lastUpdated));
    setError(null);
  }, []);

  const fetchHealthData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      const snapshot = await stepsService.getCurrentSteps({ allowFallback: enableFallback });
      applySnapshot(snapshot);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Falha ao carregar dados";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, enableFallback]);

  const authenticate = useCallback(async (): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);

      const success = await googleFitService.authenticate();
      setIsAuthenticated(success);

      if (success) {
        await fetchHealthData();
      }

      return success;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Falha na autenticacao";
      setError(errorMessage);
      setIsAuthenticated(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchHealthData]);

  const addSteps = useCallback(async (additionalSteps: number): Promise<void> => {
    try {
      let baseline = healthData;

      if (!baseline) {
        const snapshot = await stepsService.getCurrentSteps({ allowFallback: true });
        baseline = toHealthMetrics(snapshot);
        setHealthData(baseline);
      }

      const newSteps = (baseline?.steps || 0) + additionalSteps;
      const newDistance = newSteps * 0.0007;
      const newActiveMinutes = Math.floor(newSteps / 100);
      const newCalories = Math.round(additionalSteps * 0.04);

      const updatedData: HealthMetrics = {
        steps: newSteps,
        calories: (baseline?.calories || 0) + newCalories,
        distance: Math.round(newDistance * 1000) / 1000,
        activeMinutes: (baseline?.activeMinutes || 0) + newActiveMinutes,
        heartRate: baseline?.heartRate,
        lastUpdated: new Date().toISOString(),
        source: baseline?.source || "simulated",
      };

      setHealthData(updatedData);
      setLastSync(new Date());

      if (isAuthenticated) {
        try {
          await googleFitService.writeHealthData({
            steps: additionalSteps,
            calories: newCalories,
            distance: additionalSteps * 0.0007,
            activeMinutes: newActiveMinutes,
            timestamp: new Date().toISOString(),
          });
        } catch (syncError) {
          console.warn("Falha ao sincronizar com Google Fit:", syncError);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Falha ao adicionar passos";
      setError(errorMessage);
    }
  }, [healthData, isAuthenticated]);

  const addCalories = useCallback(async (additionalCalories: number): Promise<void> => {
    try {
      let baseline = healthData;

      if (!baseline) {
        const snapshot = await stepsService.getCurrentSteps({ allowFallback: true });
        baseline = toHealthMetrics(snapshot);
        setHealthData(baseline);
      }

      const updatedData: HealthMetrics = {
        ...baseline!,
        calories: (baseline?.calories || 0) + additionalCalories,
        lastUpdated: new Date().toISOString(),
        source: baseline?.source || "simulated",
      };

      setHealthData(updatedData);
      setLastSync(new Date());

      if (isAuthenticated) {
        try {
          await googleFitService.writeHealthData({
            calories: additionalCalories,
            timestamp: new Date().toISOString(),
          });
        } catch (syncError) {
          console.warn("Falha ao sincronizar calorias com Google Fit:", syncError);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Falha ao adicionar calorias";
      setError(errorMessage);
    }
  }, [healthData, isAuthenticated]);

  const resetDailyData = useCallback((): void => {
    setHealthData(null);
    setLastSync(null);
    setError(null);
  }, []);

  const checkAuthStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await googleFitService.checkAuthStatus();
      setIsAuthenticated(!!status.oauthToken);
    } catch (err) {
      console.warn("Falha ao verificar status de autenticacao:", err);
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    void checkAuthStatus();
    void stepsService.startTracking().catch(() => undefined);
    void fetchHealthData();
  }, [checkAuthStatus, fetchHealthData]);

  useEffect(() => {
    if (!autoRefresh) return undefined;

    const unsubscribe = stepsService.subscribeToSteps(
      (snapshot) => {
        applySnapshot(snapshot);
        setLoading(false);
      },
      {
        allowFallback: enableFallback,
        intervalMs: refreshInterval * 60 * 1000,
        onError: (err) => {
          const errorMessage = err instanceof Error ? err.message : "Falha ao sincronizar dados";
          setError(errorMessage);
          setLoading(false);
        },
      },
    );

    return () => {
      unsubscribe();
    };
  }, [applySnapshot, autoRefresh, enableFallback, refreshInterval]);

  return {
    healthData,
    loading,
    error,
    isAuthenticated,
    lastSync,
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
