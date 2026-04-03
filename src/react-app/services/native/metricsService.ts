import type { DailyMetrics } from "@/shared/types";
import { fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
import { debugNativeOnce } from "./androidBridge";
import { offlineSyncService } from "@/react-app/services/runtime/offlineSyncService";
import {
  stepsService,
  type StepConfidence,
  type StepSnapshot,
  type StepSource,
} from "./stepsService";

export type MetricsSource = StepSource | "api";
export type MetricsValueSource = "official" | "derived" | "server" | "unavailable";
export type MetricsConfidence = StepConfidence | "server" | "unavailable";

export type ConsolidatedMetrics = {
  dailyMetrics: DailyMetrics;
  steps: number;
  caloriesBurned: number;
  activeCaloriesBurned?: number | null;
  distanceMeters: number | null;
  activeMinutes: number;
  lastUpdated: string;
  source: MetricsSource;
  sourceDetail?: string;
  confidence: MetricsConfidence;
  stepsSource: MetricsValueSource;
  caloriesSource: MetricsValueSource;
  sessionSteps?: number;
  officialCalories?: number | null;
  error?: string | null;
};

export type MetricsStoreState = {
  metrics: ConsolidatedMetrics | null;
  loading: boolean;
  error: string | null;
};

type MetricsListener = (state: MetricsStoreState) => void;

type RefreshMetricsOptions = {
  forceApi?: boolean;
  syncRemote?: boolean;
};

const METRICS_API_PATH = "/api/metrics/today";
const SUBSCRIPTION_INTERVAL_MS = 60 * 1000;

// Normaliza timestamps e payloads mínimos antes de montar o estado consolidado.
function toIsoString(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function createEmptyDailyMetrics(): DailyMetrics {
  const now = new Date().toISOString();
  return {
    id: 0,
    user_id: "",
    date: now.slice(0, 10),
    steps: 0,
    calories_burned: 0,
    created_at: now,
    updated_at: now,
  };
}

function cloneDailyMetrics(metrics: DailyMetrics | null | undefined): DailyMetrics {
  if (!metrics) {
    return createEmptyDailyMetrics();
  }

  return {
    ...metrics,
    steps: Math.max(0, Math.round(Number(metrics.steps ?? 0))),
    calories_burned: Math.max(0, Math.round(Number(metrics.calories_burned ?? 0))),
  };
}

function buildConsolidatedMetrics(
  apiMetrics: DailyMetrics | null,
  stepSnapshot: StepSnapshot | null,
): ConsolidatedMetrics {
  const baseMetrics = cloneDailyMetrics(apiMetrics);
  const lastUpdated = stepSnapshot?.lastUpdated ?? toIsoString(apiMetrics?.updated_at, new Date().toISOString());

  if (!stepSnapshot) {
    return {
      dailyMetrics: baseMetrics,
      steps: baseMetrics.steps,
      caloriesBurned: baseMetrics.calories_burned,
      distanceMeters: null,
      activeMinutes: 0,
      lastUpdated,
      source: "api",
      confidence: apiMetrics ? "server" : "unavailable",
      stepsSource: apiMetrics ? "server" : "unavailable",
      caloriesSource: apiMetrics ? "server" : "unavailable",
    };
  }

  const nextSteps = Math.max(0, Math.round(stepSnapshot.steps));
  const hasOfficialCalories = stepSnapshot.caloriesSource === "official";
  const nextCalories = hasOfficialCalories
    ? Math.max(0, Math.round(stepSnapshot.calories))
    : baseMetrics.calories_burned;

  return {
    dailyMetrics: {
      ...baseMetrics,
      steps: nextSteps,
      calories_burned: nextCalories,
      updated_at: lastUpdated,
    },
    steps: nextSteps,
    caloriesBurned: nextCalories,
    distanceMeters:
      Number.isFinite(stepSnapshot.distance) && stepSnapshot.distance > 0
        ? Math.round(stepSnapshot.distance * 1000)
        : 0,
    activeMinutes: Math.max(0, Math.round(stepSnapshot.activeMinutes)),
    lastUpdated,
    source: stepSnapshot.source,
    confidence: stepSnapshot.confidence,
    stepsSource: stepSnapshot.confidence === "official" ? "official" : "derived",
    caloriesSource: hasOfficialCalories ? "official" : apiMetrics ? "server" : "unavailable",
    ...(typeof stepSnapshot.activeCalories === "number" || stepSnapshot.activeCalories === null
      ? { activeCaloriesBurned: stepSnapshot.activeCalories }
      : {}),
    ...(typeof stepSnapshot.sourceDetail === "string" ? { sourceDetail: stepSnapshot.sourceDetail } : {}),
    ...(typeof stepSnapshot.sessionSteps === "number" ? { sessionSteps: stepSnapshot.sessionSteps } : {}),
    ...(typeof stepSnapshot.officialCalories === "number" || stepSnapshot.officialCalories === null
      ? { officialCalories: stepSnapshot.officialCalories }
      : {}),
    ...(typeof stepSnapshot.error === "string" ? { error: stepSnapshot.error } : {}),
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Falha ao carregar métricas.";
}

function shouldPublishOfflineMetrics(stepSnapshot: StepSnapshot | null): boolean {
  if (!stepSnapshot) return false;
  return stepSnapshot.source === "android-health-connect" || stepSnapshot.source === "android-sensor";
}

class MetricsService {
  private state: MetricsStoreState = { metrics: null, loading: false, error: null };
  private listeners = new Set<MetricsListener>();
  private started = false;
  private unsubscribeSteps: (() => void) | null = null;
  private apiMetrics: DailyMetrics | null = readCachedJson<DailyMetrics>(METRICS_API_PATH)?.data ?? null;
  private refreshInFlight: Promise<ConsolidatedMetrics> | null = null;
  private lastSyncedPayloadKey: string | null = null;

  // Expõe o snapshot atual para hooks e consumidores diretos.
  getState(): MetricsStoreState {
    return this.state;
  }

  // Liga a coleta quando surge o primeiro assinante e desliga no último unsubscribe.
  subscribe(listener: MetricsListener): () => void {
    this.listeners.add(listener);
    listener(this.state);

    if (this.listeners.size === 1) {
      this.start();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  }

  // Serializa refresh concorrente para evitar disputa entre API e sensores.
  async refresh(options: RefreshMetricsOptions = {}): Promise<ConsolidatedMetrics> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    const refreshPromise = this.performRefresh(options).finally(() => {
      this.refreshInFlight = null;
    });

    this.refreshInFlight = refreshPromise;
    return refreshPromise;
  }

  // Inicia tracking, hidrata cache e assina atualizações de passos.
  private start(): void {
    if (this.started) return;
    this.started = true;

    if (this.apiMetrics && !this.state.metrics) {
      this.setState({
        metrics: buildConsolidatedMetrics(this.apiMetrics, null),
        loading: false,
        error: null,
      });
    }

    void stepsService.startTracking().catch(() => undefined);
    void this.refresh({ syncRemote: true });

    this.unsubscribeSteps = stepsService.subscribeToSteps(
      (snapshot) => {
        const metrics = buildConsolidatedMetrics(this.apiMetrics, snapshot);
        this.setState({ metrics, loading: false, error: null });
        void this.syncOfficialMetrics(snapshot, metrics);
      },
      {
        allowFallback: false,
        intervalMs: SUBSCRIPTION_INTERVAL_MS,
        onError: (error) => {
          const fallbackMetrics = buildConsolidatedMetrics(this.apiMetrics, null);
          const hasServerMetrics = fallbackMetrics.stepsSource === "server" || fallbackMetrics.caloriesSource === "server";
          this.setState({
            metrics: fallbackMetrics,
            loading: false,
            error: hasServerMetrics ? null : getErrorMessage(error),
          });
          if (hasServerMetrics) {
            debugNativeOnce("metrics-server-fallback", "Using server metrics fallback while native metrics are unavailable.");
          }
        },
      },
    );
  }

  // Encerra apenas a assinatura local mantida por este serviço.
  private stop(): void {
    this.unsubscribeSteps?.();
    this.unsubscribeSteps = null;
    this.started = false;
  }

  // Consolida dados de servidor e nativos em um único snapshot.
  private async performRefresh(options: RefreshMetricsOptions): Promise<ConsolidatedMetrics> {
    const { forceApi = false, syncRemote = true } = options;

    this.setState({ ...this.state, loading: true, error: null });

    let nativeSnapshot: StepSnapshot | null = null;
    let nativeError: string | null = null;

    try {
      this.apiMetrics = await this.loadApiMetrics(forceApi);
    } catch (error) {
      nativeError = getErrorMessage(error);
    }

    try {
      nativeSnapshot = await stepsService.getCurrentSteps({ allowFallback: false });
    } catch (error) {
      nativeError = getErrorMessage(error);
    }

    const metrics = buildConsolidatedMetrics(this.apiMetrics, nativeSnapshot);
    const error = metrics.stepsSource === "unavailable" && metrics.caloriesSource === "unavailable" ? nativeError : null;

    this.setState({
      metrics,
      loading: false,
      error,
    });

    if (syncRemote) {
      await this.syncOfficialMetrics(nativeSnapshot, metrics);
    }

    return metrics;
  }

  // Reaproveita cache local antes de buscar o resumo remoto novamente.
  private async loadApiMetrics(forceApi: boolean): Promise<DailyMetrics | null> {
    if (!forceApi) {
      const cached = readCachedJson<DailyMetrics>(METRICS_API_PATH);
      if (cached?.data) {
        this.apiMetrics = cached.data;
        offlineSyncService.hydrateMetricsBaseline({
          date: cached.data.date,
          steps: cached.data.steps,
          calories: cached.data.calories_burned,
        });
      }
    }

    if (!forceApi && this.apiMetrics) {
      return this.apiMetrics;
    }

    try {
      const metrics = await fetchAndCacheJson<DailyMetrics>(METRICS_API_PATH);
      this.apiMetrics = metrics;
      offlineSyncService.hydrateMetricsBaseline({
        date: metrics.date,
        steps: metrics.steps,
        calories: metrics.calories_burned,
      });
      return metrics;
    } catch {
      return this.apiMetrics;
    }
  }

  // Sincroniza o backend apenas quando a fonte oficial mudou de fato.
  private async syncOfficialMetrics(
    stepSnapshot: StepSnapshot | null,
    consolidatedMetrics: ConsolidatedMetrics,
  ): Promise<void> {
    if (!shouldPublishOfflineMetrics(stepSnapshot)) {
      return;
    }

    const nextPayload = {
      steps: consolidatedMetrics.dailyMetrics.steps,
      calories_burned: consolidatedMetrics.dailyMetrics.calories_burned,
      date: consolidatedMetrics.dailyMetrics.date,
    };
    const payloadKey = JSON.stringify(nextPayload);
    if (this.lastSyncedPayloadKey === payloadKey) {
      return;
    }

    const hasChanges =
      !this.apiMetrics ||
      this.apiMetrics.steps !== nextPayload.steps ||
      this.apiMetrics.calories_burned !== nextPayload.calories_burned;
    if (!hasChanges) {
      this.lastSyncedPayloadKey = payloadKey;
      return;
    }

    try {
      await offlineSyncService.publishMetricsSnapshot({
        date: consolidatedMetrics.dailyMetrics.date,
        steps: consolidatedMetrics.dailyMetrics.steps,
        calories: consolidatedMetrics.dailyMetrics.calories_burned,
        confidence: stepSnapshot?.confidence === "official" ? "official" : "derived",
      });

      this.lastSyncedPayloadKey = payloadKey;
      this.apiMetrics = {
        ...(this.apiMetrics ?? createEmptyDailyMetrics()),
        steps: nextPayload.steps,
        calories_burned: nextPayload.calories_burned,
        date: nextPayload.date,
        updated_at: consolidatedMetrics.lastUpdated,
      };

      this.setState({
        metrics: buildConsolidatedMetrics(this.apiMetrics, stepSnapshot),
        loading: false,
        error: null,
      });
    } catch {
      // Silent failure: the local snapshot remains the source of truth until the next sync attempt.
    }
  }

  // Notifica todos os consumidores assinados com o novo estado consolidado.
  private setState(nextState: MetricsStoreState): void {
    this.state = nextState;
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export const metricsService = new MetricsService();

export default metricsService;
