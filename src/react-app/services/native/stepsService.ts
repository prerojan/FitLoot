import { googleFitService } from "@/react-app/services/googleFit";
import { healthConnectService } from "@/react-app/services/healthConnect";
import {
  debugNativeOnce,
  getAndroidBridge,
  isAndroidNativeAvailable,
  type AndroidNativeMetricsDetail,
} from "./androidBridge";

export type StepSource =
  | "android-health-connect"
  | "android-sensor"
  | "health-connect"
  | "google-fit"
  | "unavailable";

export type StepConfidence = "official" | "derived" | "fallback";

export type StepCaloriesSource = "official" | "unavailable";

export type StepSnapshot = {
  steps: number;
  calories: number;
  distance: number;
  activeMinutes: number;
  activeCalories?: number | null;
  heartRate?: number;
  lastUpdated: string;
  source: StepSource;
  confidence: StepConfidence;
  caloriesSource: StepCaloriesSource;
  sourceDetail?: string;
  sessionSteps?: number;
  officialCalories?: number | null;
  error?: string | null;
};

type StepSubscriptionOptions = {
  allowFallback?: boolean;
  intervalMs?: number;
  onError?: (error: unknown) => void;
};

type StepSnapshotInput = {
  steps: number;
  calories: number;
  distance: number;
  activeMinutes: number;
  activeCalories?: number | null;
  heartRate?: number;
  sourceDetail?: string;
  sessionSteps?: number;
  officialCalories?: number | null;
  error?: string | null;
};

const STEP_DISTANCE_KM = 0.0007;
const DEFAULT_INTERVAL_MS = 60 * 1000;
const NATIVE_REQUEST_TIMEOUT_MS = 1_500;

function buildStepSnapshot(
  data: StepSnapshotInput,
  source: StepSource,
  confidence: StepConfidence,
  caloriesSource: StepCaloriesSource,
): StepSnapshot {
  return {
    steps: data.steps,
    calories: data.calories,
    distance: data.distance,
    activeMinutes: data.activeMinutes,
    lastUpdated: new Date().toISOString(),
    source,
    confidence,
    caloriesSource,
    ...(typeof data.activeCalories === "number" || data.activeCalories === null
      ? { activeCalories: data.activeCalories }
      : {}),
    ...(typeof data.heartRate === "number" ? { heartRate: data.heartRate } : {}),
    ...(typeof data.sourceDetail === "string" ? { sourceDetail: data.sourceDetail } : {}),
    ...(typeof data.sessionSteps === "number" ? { sessionSteps: data.sessionSteps } : {}),
    ...(typeof data.officialCalories === "number" || data.officialCalories === null
      ? { officialCalories: data.officialCalories }
      : {}),
    ...(typeof data.error === "string" ? { error: data.error } : {}),
  };
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatDistanceKm(valueInMeters: number | null): number {
  if (valueInMeters === null) return 0;
  return Math.round((Math.max(0, valueInMeters) / 1000) * 1000) / 1000;
}

function estimateActiveMinutes(steps: number): number {
  return Math.max(0, Math.floor(steps / 100));
}

export function formatStepsSourceLabel(source: StepSource | "api" | null | undefined): string {
  if (source === "android-health-connect") return "Health Connect (Android)";
  if (source === "android-sensor") return "Sensor Android";
  if (source === "health-connect") return "Health Connect";
  if (source === "google-fit") return "Google Fit";
  if (source === "api") return "Servidor";
  if (source === "unavailable") return "Nao disponivel";
  return "Nao disponivel";
}

class StepsService {
  private androidTrackingStarted = false;
  private lastLoggedSource: StepSource | null = null;
  private lastNativeSnapshot: StepSnapshot | null = null;
  private nativeRequestInFlight: Promise<StepSnapshot | null> | null = null;

  async startTracking(): Promise<StepSource> {
    const nativeStarted = this.startAndroidTrackingIfAvailable();
    if (nativeStarted) {
      const nativeSnapshot = await this.getAndroidSnapshot();
      const source = nativeSnapshot?.source ?? "android-sensor";
      this.logSource(source);
      return source;
    }

    const fallbackSource = await this.resolveBestFallbackSource();
    if (!fallbackSource) {
      throw new Error("Nenhuma fonte oficial de passos disponivel.");
    }

    this.logSource(fallbackSource);
    return fallbackSource;
  }

  async getCurrentSteps(options: { allowFallback?: boolean } = {}): Promise<StepSnapshot> {
    const { allowFallback = true } = options;

    const androidSnapshot = await this.getAndroidSnapshot();
    if (androidSnapshot) {
      this.logSource(androidSnapshot.source);
      return androidSnapshot;
    }

    const healthConnectSnapshot = await this.getHealthConnectSnapshot();
    if (healthConnectSnapshot) {
      this.logSource(healthConnectSnapshot.source);
      return healthConnectSnapshot;
    }

    const googleFitSnapshot = await this.getGoogleFitSnapshot();
    if (googleFitSnapshot) {
      this.logSource(googleFitSnapshot.source);
      return googleFitSnapshot;
    }

    if (!allowFallback) {
      throw new Error("Nenhuma fonte oficial de passos disponivel.");
    }

    throw new Error("Nenhuma fonte oficial de passos disponivel.");
  }

  subscribeToSteps(
    callback: (snapshot: StepSnapshot) => void,
    options: StepSubscriptionOptions = {},
  ): () => void {
    if (typeof window === "undefined") {
      return () => undefined;
    }

    const {
      allowFallback = true,
      intervalMs = DEFAULT_INTERVAL_MS,
      onError,
    } = options;

    let disposed = false;

    const poll = async () => {
      try {
        const snapshot = await this.getCurrentSteps({ allowFallback });
        if (!disposed) {
          callback(snapshot);
        }
      } catch (error) {
        if (!disposed) {
          onError?.(error);
        }
      }
    };

    void poll();
    const timerId = window.setInterval(() => {
      void poll();
    }, Math.max(1_000, intervalMs));

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }

  private startAndroidTrackingIfAvailable(): boolean {
    if (!isAndroidNativeAvailable()) return false;

    const bridge = getAndroidBridge();
    const startTracking = bridge?.startStepTracking ?? bridge?.startStepCounter;
    if (!startTracking) return false;

    if (!this.androidTrackingStarted) {
      try {
        startTracking.call(bridge);
        this.androidTrackingStarted = true;
        debugNativeOnce("steps-android-started", "Using Android native step tracking.");
      } catch {
        this.androidTrackingStarted = false;
        return false;
      }
    }

    return true;
  }

  private async getAndroidSnapshot(): Promise<StepSnapshot | null> {
    if (!this.startAndroidTrackingIfAvailable()) {
      return null;
    }

    const bridge = getAndroidBridge();
    if (!bridge) {
      return null;
    }

    if (bridge.getStepMetrics) {
      const nativeSnapshot = await this.requestNativeMetrics();
      if (nativeSnapshot) {
        return nativeSnapshot;
      }
    }

    if (!bridge.getStepCount) {
      return this.lastNativeSnapshot;
    }

    try {
      const sessionSteps = Math.max(0, Number(bridge.getStepCount() ?? 0));
      const fallbackSnapshot = buildStepSnapshot(
        {
          steps: sessionSteps,
          calories: 0,
          distance: Math.round(sessionSteps * STEP_DISTANCE_KM * 1000) / 1000,
          activeMinutes: estimateActiveMinutes(sessionSteps),
          sourceDetail: "sensor",
          sessionSteps,
          officialCalories: null,
        },
        "android-sensor",
        "derived",
        "unavailable",
      );

      this.lastNativeSnapshot = fallbackSnapshot;
      return fallbackSnapshot;
    } catch {
      return this.lastNativeSnapshot;
    }
  }

  private requestNativeMetrics(): Promise<StepSnapshot | null> {
    if (typeof window === "undefined") {
      return Promise.resolve(null);
    }

    if (this.nativeRequestInFlight) {
      return this.nativeRequestInFlight;
    }

    const bridge = getAndroidBridge();
    const getStepMetrics = bridge?.getStepMetrics;
    if (!getStepMetrics) {
      return Promise.resolve(this.lastNativeSnapshot);
    }

    this.nativeRequestInFlight = new Promise<StepSnapshot | null>((resolve) => {
      let settled = false;

      const cleanup = (timerId: number) => {
        window.clearTimeout(timerId);
        window.removeEventListener("native_metrics_updated", handleNativeMetrics as EventListener);
      };

      const settle = (value: StepSnapshot | null, timerId: number) => {
        if (settled) return;
        settled = true;
        cleanup(timerId);
        resolve(value);
      };

      const handleNativeMetrics = (event: Event) => {
        const customEvent = event as CustomEvent<AndroidNativeMetricsDetail>;
        const snapshot = this.parseNativeMetrics(customEvent.detail);
        if (snapshot) {
          this.lastNativeSnapshot = snapshot;
        }
        settle(snapshot, timerId);
      };

      const timerId = window.setTimeout(() => {
        settle(this.lastNativeSnapshot, timerId);
      }, NATIVE_REQUEST_TIMEOUT_MS);

      window.addEventListener("native_metrics_updated", handleNativeMetrics as EventListener);

      try {
        getStepMetrics.call(bridge);
      } catch {
        settle(this.lastNativeSnapshot, timerId);
      }
    }).finally(() => {
      this.nativeRequestInFlight = null;
    });

    return this.nativeRequestInFlight;
  }

  private parseNativeMetrics(detail: AndroidNativeMetricsDetail | null | undefined): StepSnapshot | null {
    if (!detail || typeof detail !== "object") {
      return null;
    }

    const stepsToday = coerceNumber(detail.stepsToday);
    const sessionSteps = coerceNumber(detail.sessionSteps);
    const distanceMeters = coerceNumber(detail.distanceMeters);
    const activeCalories = coerceNumber(detail.activeCalories);
    const officialCalories = coerceNumber(detail.calories);
    const sourceDetail =
      typeof detail.source === "string" && detail.source.trim().length > 0
        ? detail.source.trim().toLowerCase()
        : stepsToday !== null
          ? "health_connect"
          : "sensor";
    const confidence =
      detail.confidence === "official"
        ? "official"
        : sourceDetail === "health_connect" && stepsToday !== null
          ? "official"
          : "derived";
    const source: StepSource = sourceDetail === "health_connect" ? "android-health-connect" : "android-sensor";
    const steps = Math.max(0, Math.round(stepsToday ?? sessionSteps ?? 0));
    const calories = officialCalories !== null ? Math.max(0, Math.round(officialCalories)) : 0;

    return buildStepSnapshot(
      {
        steps,
        calories,
        distance: formatDistanceKm(distanceMeters),
        activeMinutes: estimateActiveMinutes(steps),
        ...(activeCalories !== null ? { activeCalories: Math.max(0, Math.round(activeCalories)) } : {}),
        sourceDetail,
        ...(sessionSteps !== null ? { sessionSteps: Math.max(0, Math.round(sessionSteps)) } : {}),
        officialCalories,
        ...(typeof detail.error === "string" ? { error: detail.error } : {}),
      },
      source,
      confidence,
      officialCalories !== null ? "official" : "unavailable",
    );
  }

  private async getHealthConnectSnapshot(): Promise<StepSnapshot | null> {
    const available = await healthConnectService.getAvailability().catch(() => false);
    if (!available) return null;

    try {
      const data = await healthConnectService.readTodayData();
      return buildStepSnapshot(
        {
          steps: data.steps,
          calories: Math.max(0, Math.round(data.calories)),
          distance: Math.max(0, data.distance),
          activeMinutes: Math.max(0, Math.round(data.activeMinutes)),
          ...(typeof data.heartRate === "number" ? { heartRate: data.heartRate } : {}),
          sourceDetail: "health_connect",
          officialCalories: Math.max(0, Math.round(data.calories)),
        },
        "health-connect",
        "official",
        "official",
      );
    } catch {
      return null;
    }
  }

  private async getGoogleFitSnapshot(): Promise<StepSnapshot | null> {
    const available = await googleFitService.getAvailability().catch(() => false);
    if (!available) return null;

    const status = await googleFitService.checkAuthStatus().catch(() => null);
    if (!status?.oauthToken) return null;

    try {
      const data = await googleFitService.readTodayData();
      return buildStepSnapshot(
        {
          steps: data.steps,
          calories: Math.max(0, Math.round(data.calories)),
          distance: Math.max(0, data.distance),
          activeMinutes: Math.max(0, Math.round(data.activeMinutes)),
          ...(typeof data.heartRate === "number" ? { heartRate: data.heartRate } : {}),
          sourceDetail: "google_fit",
          officialCalories: Math.max(0, Math.round(data.calories)),
        },
        "google-fit",
        "official",
        "official",
      );
    } catch {
      return null;
    }
  }

  private async resolveBestFallbackSource(): Promise<StepSource | null> {
    const healthConnectSnapshot = await this.getHealthConnectSnapshot();
    if (healthConnectSnapshot) return healthConnectSnapshot.source;

    const googleFitSnapshot = await this.getGoogleFitSnapshot();
    if (googleFitSnapshot) return googleFitSnapshot.source;

    return null;
  }

  private logSource(source: StepSource): void {
    if (this.lastLoggedSource === source) return;
    this.lastLoggedSource = source;

    if (source === "android-health-connect" || source === "android-sensor") {
      debugNativeOnce(`steps-source-${source}`, `Android steps source: ${formatStepsSourceLabel(source)}.`);
      return;
    }

    debugNativeOnce(`steps-source-${source}`, `Android steps unavailable. Using ${formatStepsSourceLabel(source)}.`);
  }
}

export const stepsService = new StepsService();

export default stepsService;
