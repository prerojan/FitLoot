export type AndroidBridgeApi = {
  checkNativeLayer?: () => string;
  isNativeAvailable?: () => boolean;
  requestPermissions?: () => void;
  startStepCounter?: () => void;
  stopStepCounter?: () => void;
  getStepCount?: () => number;
  startStepTracking?: () => void;
  stopStepTracking?: () => void;
  getStepMetrics?: () => void;
  openCamera?: () => void;
  openGallery?: () => void;
};

export type AndroidCameraCapturedDetail = {
  path?: string;
  base64?: string;
  mimeType?: string;
  dataUrl?: string;
};

export type AndroidGallerySelectedDetail = {
  uri?: string;
  path?: string;
  dataUrl?: string;
  base64?: string;
  mimeType?: string;
};

export type AndroidNativeMetricsDetail = {
  stepsToday?: number | null;
  sessionSteps?: number | null;
  distanceMeters?: number | null;
  calories?: number | null;
  activeCalories?: number | null;
  source?: string | null;
  confidence?: string | null;
  error?: string | null;
  timestamp?: string | null;
};

declare global {
  interface Window {
    AndroidBridge?: AndroidBridgeApi;
  }

  interface WindowEventMap {
    camera_captured: CustomEvent<AndroidCameraCapturedDetail>;
    gallery_image_selected: CustomEvent<AndroidGallerySelectedDetail>;
    native_metrics_updated: CustomEvent<AndroidNativeMetricsDetail>;
  }
}

const debugLogCache = new Set<string>();
let lastAvailability: boolean | null = null;

function isDevEnvironment(): boolean {
  return Boolean(import.meta.env.DEV);
}

export function debugNative(message: string, payload?: unknown): void {
  if (!isDevEnvironment()) return;
  if (payload === undefined) {
    console.info(`[native] ${message}`);
    return;
  }
  console.info(`[native] ${message}`, payload);
}

export function debugNativeOnce(key: string, message: string, payload?: unknown): void {
  if (debugLogCache.has(key)) return;
  debugLogCache.add(key);
  debugNative(message, payload);
}

export function getAndroidBridge(): AndroidBridgeApi | null {
  if (typeof window === "undefined") return null;
  return typeof window.AndroidBridge === "object" && window.AndroidBridge !== null
    ? window.AndroidBridge
    : null;
}

export function isAndroidNativeAvailable(): boolean {
  const bridge = getAndroidBridge();
  let available = Boolean(bridge);

  if (bridge?.isNativeAvailable) {
    try {
      available = bridge.isNativeAvailable() === true;
    } catch {
      available = true;
    }
  } else if (bridge?.checkNativeLayer) {
    try {
      available = bridge.checkNativeLayer() === "available";
    } catch {
      available = true;
    }
  }

  if (lastAvailability !== available) {
    lastAvailability = available;
    debugNative(`AndroidBridge ${available ? "available" : "unavailable"}`);
  }

  return available;
}
