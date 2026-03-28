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
  const { syncRemote = true } = options;
  const [state, setState] = useState<MetricsStoreState>(() => metricsService.getState());

  useEffect(() => {
    return metricsService.subscribe(setState);
  }, []);

  const refreshMetrics = (refreshOptions: RefreshMetricsOptions = {}): Promise<ConsolidatedMetrics> => {
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
