export type AndroidBridgeApi = {
  checkNativeLayer?: () => string;
  isNativeAvailable?: () => boolean;
  getHostContext?: () => string;
  requestPermissions?: () => void;
  startStepCounter?: () => void;
  stopStepCounter?: () => void;
  getStepCount?: () => number;
  startStepTracking?: () => void;
  stopStepTracking?: () => void;
  getStepMetrics?: () => void;
  openCamera?: () => void;
  openGallery?: () => void;
  requestCurrentLocation?: () => void;
  startLocationTracking?: () => void;
  stopLocationTracking?: () => void;
  requestLocationPermission?: () => void;
  getLocationPermissionStatus?: () => string;
  requestNotificationPermission?: () => void;
  getNotificationPermissionStatus?: () => string;
};

export type AndroidHostCapabilities = {
  camera: boolean;
  gallery: boolean;
  healthMetrics: boolean;
  offlineQueue: boolean;
  lifecycleEvents: boolean;
  location: boolean;
};

export type AndroidHostContext = {
  platform: "web" | "android";
  webMode: "remote" | "bundled";
  buildType: "dev" | "internal" | "prod";
  networkOnline: boolean;
  capabilities: AndroidHostCapabilities;
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

export type AndroidNativeMediaErrorDetail = {
  message?: string;
  source?: string;
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

export type AndroidNetworkStatusDetail = {
  online?: boolean;
  type?: string;
  timestamp?: string;
};

export type AndroidAppLifecycleDetail = {
  state?: "foreground" | "background";
  timestamp?: string;
};

export type AndroidLocationDetail = {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  precision?: "precise" | "approximate";
  timestamp?: string;
  source?: "android-native" | "browser";
};

export type AndroidLocationPermissionDetail = {
  granted?: boolean;
  precise?: boolean;
  approximate?: boolean;
  permission?: "granted" | "denied" | "prompt";
  precision?: "precise" | "approximate" | "unavailable";
  timestamp?: string;
};

export type AndroidNotificationPermissionDetail = {
  granted?: boolean;
  permission?: "granted" | "denied" | "prompt";
  timestamp?: string;
};

export type AndroidNotificationOpenedDetail = {
  route?: string;
  conversation_id?: number;
  notification_type?: "social" | "reward";
  timestamp?: string;
};

declare global {
  interface Window {
    AndroidBridge?: AndroidBridgeApi;
  }

  interface WindowEventMap {
    camera_captured: CustomEvent<AndroidCameraCapturedDetail>;
    camera_capture_error: CustomEvent<AndroidNativeMediaErrorDetail>;
    gallery_image_selected: CustomEvent<AndroidGallerySelectedDetail>;
    native_metrics_updated: CustomEvent<AndroidNativeMetricsDetail>;
    network_status_changed: CustomEvent<AndroidNetworkStatusDetail>;
    app_lifecycle_changed: CustomEvent<AndroidAppLifecycleDetail>;
    location_updated: CustomEvent<AndroidLocationDetail>;
    location_permission_changed: CustomEvent<AndroidLocationPermissionDetail>;
    notification_permission_changed: CustomEvent<AndroidNotificationPermissionDetail>;
    native_notification_opened: CustomEvent<AndroidNotificationOpenedDetail>;
  }
}

// Evita repetição de logs ruidosos enquanto a bridge mantém o mesmo estado.
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

// Resolve a bridge Android real a partir do objeto global exposto pelo WebView.
export function getAndroidBridge(): AndroidBridgeApi | null {
  if (typeof window === "undefined") return null;
  return typeof window.AndroidBridge === "object" && window.AndroidBridge !== null
    ? window.AndroidBridge
    : null;
}

// Normaliza a disponibilidade da camada nativa para os consumidores do frontend.
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

export function getAndroidHostContext(): AndroidHostContext | null {
  const bridge = getAndroidBridge();
  const readContext = bridge?.getHostContext;
  if (!readContext) {
    return null;
  }

  try {
    const raw = readContext.call(bridge);
    const parsed = JSON.parse(raw) as Partial<AndroidHostContext>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const capabilities = (parsed.capabilities ?? {}) as Partial<AndroidHostCapabilities>;
    return {
      platform: parsed.platform === "android" ? "android" : "web",
      webMode: parsed.webMode === "bundled" ? "bundled" : "remote",
      buildType:
        parsed.buildType === "dev" || parsed.buildType === "internal" || parsed.buildType === "prod"
          ? parsed.buildType
          : "prod",
      networkOnline: parsed.networkOnline !== false,
      capabilities: {
        camera: capabilities.camera !== false,
        gallery: capabilities.gallery !== false,
        healthMetrics: capabilities.healthMetrics !== false,
        offlineQueue: capabilities.offlineQueue !== false,
        lifecycleEvents: capabilities.lifecycleEvents !== false,
        location: capabilities.location !== false,
      },
    };
  } catch (error) {
    debugNative("Failed to parse Android host context", error);
    return null;
  }
}
