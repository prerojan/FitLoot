import { googleFitService } from "@/react-app/services/googleFit";
import { healthConnectService } from "@/react-app/services/healthConnect";
import { debugNativeOnce, getAndroidBridge, isAndroidNativeAvailable } from "./androidBridge";

export type StepSource = "android-native" | "health-connect" | "google-fit" | "simulated";

export type StepSnapshot = {
  steps: number;
  calories: number;
  distance: number;
  activeMinutes: number;
  heartRate?: number;
  lastUpdated: string;
  source: StepSource;
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
  heartRate?: number;
};

const STEP_DISTANCE_KM = 0.0007;
const CALORIES_PER_STEP = 0.04;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function buildStepSnapshot(
  data: StepSnapshotInput,
  source: StepSource,
): StepSnapshot {
  return {
    steps: data.steps,
    calories: data.calories,
    distance: data.distance,
    activeMinutes: data.activeMinutes,
    lastUpdated: new Date().toISOString(),
    source,
    ...(typeof data.heartRate === "number" ? { heartRate: data.heartRate } : {}),
  };
}

function createSimulatedSnapshot(): StepSnapshot {
  const now = new Date();
  const hour = now.getHours();

  let steps = 0;
  let calories = 0;

  if (hour >= 6 && hour <= 8) {
    steps = Math.floor(Math.random() * 2000) + 1000;
    calories = Math.floor(Math.random() * 100) + 50;
  } else if (hour >= 12 && hour <= 14) {
    steps = Math.floor(Math.random() * 3000) + 1500;
    calories = Math.floor(Math.random() * 150) + 100;
  } else if (hour >= 17 && hour <= 19) {
    steps = Math.floor(Math.random() * 4000) + 2000;
    calories = Math.floor(Math.random() * 200) + 150;
  } else {
    steps = Math.floor(Math.random() * 1000) + 500;
    calories = Math.floor(Math.random() * 80) + 30;
  }

  return buildStepSnapshot(
    {
      steps,
      calories,
      distance: Math.round(steps * STEP_DISTANCE_KM * 1000) / 1000,
      activeMinutes: Math.floor(steps / 100),
      heartRate: Math.floor(Math.random() * 30) + 60,
    },
    "simulated",
  );
}

export function formatStepsSourceLabel(source: StepSource | null | undefined): string {
  if (source === "android-native") return "Android nativo";
  if (source === "health-connect") return "Health Connect";
  if (source === "google-fit") return "Google Fit";
  if (source === "simulated") return "Dados simulados";
  return "Nao disponivel";
}

class StepsService {
  private androidTrackingStarted = false;
  private lastLoggedSource: StepSource | null = null;

  async startTracking(): Promise<StepSource> {
    const nativeStarted = this.startAndroidTrackingIfAvailable();
    if (nativeStarted) {
      return "android-native";
    }

    const fallbackSource = await this.resolveBestFallbackSource();
    this.logSource(fallbackSource);
    return fallbackSource;
  }

  async getCurrentSteps(options: { allowFallback?: boolean } = {}): Promise<StepSnapshot> {
    const { allowFallback = true } = options;

    const androidSnapshot = this.getAndroidSnapshot();
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
      throw new Error("Nenhuma fonte de passos disponivel.");
    }

    const simulatedSnapshot = createSimulatedSnapshot();
    this.logSource(simulatedSnapshot.source);
    return simulatedSnapshot;
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
    }, Math.max(1000, intervalMs));

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }

  private startAndroidTrackingIfAvailable(): boolean {
    if (!isAndroidNativeAvailable()) return false;

    const bridge = getAndroidBridge();
    if (!bridge?.startStepCounter) return false;

    if (!this.androidTrackingStarted) {
      try {
        bridge.startStepCounter();
        this.androidTrackingStarted = true;
        debugNativeOnce("steps-android-started", "Using Android native step counter.");
      } catch {
        this.androidTrackingStarted = false;
        return false;
      }
    }

    return true;
  }

  private getAndroidSnapshot(): StepSnapshot | null {
    if (!this.startAndroidTrackingIfAvailable()) {
      return null;
    }

    const bridge = getAndroidBridge();
    if (!bridge?.getStepCount) {
      return null;
    }

    try {
      const steps = Math.max(0, Number(bridge.getStepCount() ?? 0));
      return buildStepSnapshot(
        {
          steps,
          calories: Math.round(steps * CALORIES_PER_STEP),
          distance: Math.round(steps * STEP_DISTANCE_KM * 1000) / 1000,
          activeMinutes: Math.floor(steps / 100),
        },
        "android-native",
      );
    } catch {
      return null;
    }
  }

  private async getHealthConnectSnapshot(): Promise<StepSnapshot | null> {
    const available = await healthConnectService.getAvailability().catch(() => false);
    if (!available) return null;

    try {
      const data = await healthConnectService.readTodayData();
      return buildStepSnapshot(
        {
          steps: data.steps,
          calories: data.calories,
          distance: data.distance,
          activeMinutes: data.activeMinutes,
          ...(typeof data.heartRate === "number" ? { heartRate: data.heartRate } : {}),
        },
        "health-connect",
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
          calories: data.calories,
          distance: data.distance,
          activeMinutes: data.activeMinutes,
          ...(typeof data.heartRate === "number" ? { heartRate: data.heartRate } : {}),
        },
        "google-fit",
      );
    } catch {
      return null;
    }
  }

  private async resolveBestFallbackSource(): Promise<StepSource> {
    const healthConnectSnapshot = await this.getHealthConnectSnapshot();
    if (healthConnectSnapshot) return healthConnectSnapshot.source;

    const googleFitSnapshot = await this.getGoogleFitSnapshot();
    if (googleFitSnapshot) return googleFitSnapshot.source;

    return "simulated";
  }

  private logSource(source: StepSource): void {
    if (this.lastLoggedSource === source) return;
    this.lastLoggedSource = source;

    if (source === "android-native") {
      debugNativeOnce("steps-source-android", "Android native steps available.");
      return;
    }

    debugNativeOnce(`steps-source-${source}`, `Android steps unavailable. Using ${formatStepsSourceLabel(source)} fallback.`);
  }
}

export const stepsService = new StepsService();

export default stepsService;
