import { useEffect, useState } from "react";
import {
  metricsService,
  type ConsolidatedMetrics,
  type MetricsStoreState,
} from "@/react-app/services/native/metricsService";

type UseDailyMetricsOptions = {
  syncRemote?: boolean;
};

type RefreshMetricsOptions = {
  forceApi?: boolean;
  syncRemote?: boolean;
};

export function useDailyMetrics(options: UseDailyMetricsOptions = {}) {
  // Espelha no React o estado consolidado do store nativo de metricas.
  const { syncRemote = true } = options;
  const [state, setState] = useState<MetricsStoreState>(() => metricsService.getState());

  useEffect(() => {
    return metricsService.subscribe(setState);
  }, []);

  const refreshMetrics = (refreshOptions: RefreshMetricsOptions = {}): Promise<ConsolidatedMetrics> => {
    // Permite refresh manual reaproveitando a mesma politica do service central.
    return metricsService.refresh({
      ...(typeof refreshOptions.forceApi === "boolean" ? { forceApi: refreshOptions.forceApi } : {}),
      syncRemote: refreshOptions.syncRemote ?? syncRemote,
    });
  };

  return {
    metrics: state.metrics,
    loading: state.loading,
    error: state.error,
    refreshMetrics,
  };
}

export default useDailyMetrics;
