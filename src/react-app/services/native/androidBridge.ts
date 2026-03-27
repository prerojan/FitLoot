export type AndroidBridgeApi = {
  checkNativeLayer?: () => string;
  requestPermissions?: () => void;
  startStepCounter?: () => void;
  stopStepCounter?: () => void;
  getStepCount?: () => number;
  openCamera?: () => void;
};

export type AndroidCameraCapturedDetail = {
  path?: string;
};

declare global {
  interface Window {
    AndroidBridge?: AndroidBridgeApi;
  }

  interface WindowEventMap {
    camera_captured: CustomEvent<AndroidCameraCapturedDetail>;
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

  if (bridge?.checkNativeLayer) {
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
