import { useCallback, useEffect, useMemo, useState } from "react";
import {
  findCachedDistanceMissionRoutePreview,
  getDistanceMissionRoutePreview,
  isDistanceRouteMission,
  type DistanceMissionRoutePreviewData,
} from "@/react-app/services/distanceMissionRoute";
import {
  locationRuntimeService,
  type LocationRuntimeState,
} from "@/react-app/services/runtime/locationRuntimeService";
import type { Mission } from "@/shared/types";

export type DistanceMissionRoutePreviewLoadStrategy = "passive" | "eager" | "manual";

type UseDistanceMissionRoutePreviewOptions = {
  loadStrategy?: DistanceMissionRoutePreviewLoadStrategy;
};

type DistanceMissionRoutePreviewState = {
  preview: DistanceMissionRoutePreviewData | null;
  loading: boolean;
  error: string | null;
};

function shouldPassiveLoad(runtimeState: LocationRuntimeState): boolean {
  return Boolean(runtimeState.location) || runtimeState.permission.granted;
}

export function useDistanceMissionRoutePreview(
  mission: Mission,
  options: UseDistanceMissionRoutePreviewOptions = {},
) {
  const { loadStrategy = "eager" } = options;
  const initialCachedPreview = useMemo(
    () => findCachedDistanceMissionRoutePreview(mission.id),
    [mission.id],
  );
  const [state, setState] = useState<DistanceMissionRoutePreviewState>(() => ({
    preview: initialCachedPreview,
    loading: false,
    error: null,
  }));
  const [runtimeState, setRuntimeState] = useState<LocationRuntimeState>(() => locationRuntimeService.getState());

  const supportsRoutePreview = isDistanceRouteMission(mission);
  const hasCachedPreview = state.preview !== null;
  const canPassiveLoad = shouldPassiveLoad(runtimeState);

  useEffect(() => {
    const cachedPreview = findCachedDistanceMissionRoutePreview(mission.id);
    setState({
      preview: cachedPreview,
      loading: false,
      error: null,
    });
  }, [mission.id, mission.updated_at, mission.cycle_date]);

  useEffect(() => {
    return locationRuntimeService.subscribe((nextState) => {
      setRuntimeState(nextState);
    });
  }, []);

  const loadPreview = useCallback(
    async (loadOptions?: { forceRefresh?: boolean }) => {
      if (!supportsRoutePreview) {
        return null;
      }

      if (!loadOptions?.forceRefresh) {
        const cachedPreview = findCachedDistanceMissionRoutePreview(mission.id);
        if (cachedPreview) {
          setState({
            preview: cachedPreview,
            loading: false,
            error: null,
          });
          return cachedPreview;
        }
      }

      setState((current) => ({
        preview: current.preview,
        loading: true,
        error: null,
      }));

      try {
        const preview = await getDistanceMissionRoutePreview(mission, loadOptions);
        setState({
          preview,
          loading: false,
          error: null,
        });
        return preview;
      } catch (error) {
        setState((current) => ({
          preview: current.preview,
          loading: false,
          error: error instanceof Error ? error.message : "Nao foi possivel carregar a rota sugerida.",
        }));
        return null;
      }
    },
    [mission, supportsRoutePreview],
  );

  useEffect(() => {
    if (!supportsRoutePreview) {
      return;
    }

    if (loadStrategy === "manual") {
      return;
    }

    if (loadStrategy === "passive" && !canPassiveLoad && !hasCachedPreview) {
      return;
    }

    void loadPreview();
  }, [canPassiveLoad, hasCachedPreview, loadPreview, loadStrategy, supportsRoutePreview]);

  return {
    preview: state.preview,
    loading: state.loading,
    error: state.error,
    loadPreview,
    supportsRoutePreview,
    hasCachedPreview,
    locationPermissionGranted: runtimeState.permission.granted,
    locationPrecision: runtimeState.permission.precision,
    showPassivePlaceholder:
      supportsRoutePreview
      && loadStrategy === "passive"
      && !hasCachedPreview
      && !canPassiveLoad
      && !state.loading,
  };
}

export default useDistanceMissionRoutePreview;
