/**
 * Hook unificado para dados de saúde
 * Integra Google Fit como principal com fallback para dados simulados
 */

import { useState, useEffect, useCallback } from 'react';
import { googleFitService } from '../services/googleFit';

export interface HealthMetrics {
  steps: number;
  calories: number;
  distance: number;
  activeMinutes: number;
  heartRate: number | undefined;
  lastUpdated: string;
  source: 'google-fit' | 'simulated';
}

export interface UseHealthDataOptions {
  autoRefresh?: boolean;
  refreshInterval?: number; // minutes
  enableFallback?: boolean;
}

export const useHealthData = (options: UseHealthDataOptions = {}) => {
  const {
    autoRefresh = true,
    refreshInterval = 5, // 5 minutes
    enableFallback = true,
  } = options;

  const [healthData, setHealthData] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // Authenticate with Google Fit
  const authenticate = useCallback(async (): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);
      
      const success = await googleFitService.authenticate();
      setIsAuthenticated(success);
      
      if (success) {
        // Load data immediately after authentication
        await fetchHealthData();
      }
      
      return success;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Falha na autenticação';
      setError(errorMessage);
      setIsAuthenticated(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch health data from Google Fit
  const fetchHealthData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      // Try Google Fit first
      if (isAuthenticated) {
        try {
          const data = await googleFitService.readTodayData();
          setHealthData({
            steps: data.steps,
            calories: data.calories,
            distance: data.distance,
            activeMinutes: data.activeMinutes,
            heartRate: data.heartRate,
            source: 'google-fit',
            lastUpdated: new Date().toISOString(),
          });
          setLastSync(new Date());
          return;
        } catch (googleFitError) {
          console.warn('Google Fit falhou, usando fallback:', googleFitError);
        }
      }

      // Fallback to simulated data if enabled
      if (enableFallback) {
        const simulatedData = generateSimulatedData();
        setHealthData({
          ...simulatedData,
          source: 'simulated',
          lastUpdated: new Date().toISOString(),
        });
        setLastSync(new Date());
      } else {
        throw new Error('Nenhuma fonte de dados disponível');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Falha ao carregar dados';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, enableFallback]);

  // Generate simulated health data
  const generateSimulatedData = (): Omit<HealthMetrics, 'source' | 'lastUpdated'> => {
    const now = new Date();
    const hour = now.getHours();
    
    // Simulate realistic patterns based on time of day
    let baseSteps = 0;
    let baseCalories = 0;
    
    if (hour >= 6 && hour <= 8) {
      // Morning activity
      baseSteps = Math.floor(Math.random() * 2000) + 1000;
      baseCalories = Math.floor(Math.random() * 100) + 50;
    } else if (hour >= 12 && hour <= 14) {
      // Lunch time
      baseSteps = Math.floor(Math.random() * 3000) + 1500;
      baseCalories = Math.floor(Math.random() * 150) + 100;
    } else if (hour >= 17 && hour <= 19) {
      // Evening activity
      baseSteps = Math.floor(Math.random() * 4000) + 2000;
      baseCalories = Math.floor(Math.random() * 200) + 150;
    } else {
      // Rest of day
      baseSteps = Math.floor(Math.random() * 1000) + 500;
      baseCalories = Math.floor(Math.random() * 80) + 30;
    }

    return {
      steps: baseSteps,
      calories: baseCalories,
      distance: Math.round((baseSteps * 0.0007) * 1000) / 1000, // km
      activeMinutes: Math.floor(baseSteps / 100),
      heartRate: Math.floor(Math.random() * 30) + 60, // 60-90 bpm
    };
  };

  // Manual step counting (for manual input)
  const addSteps = useCallback(async (additionalSteps: number): Promise<void> => {
    try {
      if (!healthData) {
        await fetchHealthData();
      }

      const newSteps = (healthData?.steps || 0) + additionalSteps;
      const newDistance = newSteps * 0.0007;
      const newActiveMinutes = Math.floor(newSteps / 100);
      const newCalories = Math.round(additionalSteps * 0.04); // ~0.04 cal per step

      const updatedData: HealthMetrics = {
        steps: newSteps,
        calories: (healthData?.calories || 0) + newCalories,
        distance: Math.round(newDistance * 1000) / 1000,
        activeMinutes: (healthData?.activeMinutes || 0) + newActiveMinutes,
        heartRate: healthData?.heartRate,
        lastUpdated: new Date().toISOString(),
        source: healthData?.source || 'simulated',
      };

      setHealthData(updatedData);
      setLastSync(new Date());

      // Try to sync with Google Fit if authenticated
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
          console.warn('Falha ao sincronizar com Google Fit:', syncError);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Falha ao adicionar passos';
      setError(errorMessage);
    }
  }, [healthData, isAuthenticated, fetchHealthData]);

  // Manual calorie counting
  const addCalories = useCallback(async (additionalCalories: number): Promise<void> => {
    try {
      if (!healthData) {
        await fetchHealthData();
      }

      const updatedData: HealthMetrics = {
        ...healthData!,
        calories: (healthData?.calories || 0) + additionalCalories,
        lastUpdated: new Date().toISOString(),
        source: healthData?.source || 'simulated',
      };

      setHealthData(updatedData);
      setLastSync(new Date());

      // Try to sync with Google Fit if authenticated
      if (isAuthenticated) {
        try {
          await googleFitService.writeHealthData({
            calories: additionalCalories,
            timestamp: new Date().toISOString(),
          });
        } catch (syncError) {
          console.warn('Falha ao sincronizar calorias com Google Fit:', syncError);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Falha ao adicionar calorias';
      setError(errorMessage);
    }
  }, [healthData, isAuthenticated, fetchHealthData]);

  // Reset daily data
  const resetDailyData = useCallback((): void => {
    setHealthData(null);
    setLastSync(null);
    setError(null);
  }, []);

  // Check authentication status
  const checkAuthStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await googleFitService.checkAuthStatus();
      setIsAuthenticated(!!status.oauthToken);
    } catch (err) {
      console.warn('Falha ao verificar status de autenticação:', err);
      setIsAuthenticated(false);
    }
  }, []);

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      if (isAuthenticated || enableFallback) {
        fetchHealthData();
      }
    }, refreshInterval * 60 * 1000); // Convert minutes to milliseconds

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, isAuthenticated, enableFallback, fetchHealthData]);

  // Initial load
  useEffect(() => {
    checkAuthStatus();
    if (isAuthenticated || enableFallback) {
      fetchHealthData();
    }
  }, []);

  return {
    // Data
    healthData,
    loading,
    error,
    isAuthenticated,
    lastSync,

    // Actions
    authenticate,
    fetchHealthData,
    addSteps,
    addCalories,
    resetDailyData,
    checkAuthStatus,

    // Computed values
    isTodayData: healthData ? 
      new Date(healthData.lastUpdated).toDateString() === new Date().toDateString() : 
      false,
    
    stepsProgress: healthData ? Math.min((healthData.steps / 10000) * 100, 100) : 0, // 10k steps goal
    caloriesProgress: healthData ? Math.min((healthData.calories / 500) * 100, 100) : 0, // 500 cal goal
  };
};

export default useHealthData;
