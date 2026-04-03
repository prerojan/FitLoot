import {
  getAndroidHostContext,
  isAndroidNativeAvailable,
  type AndroidAppLifecycleDetail,
  type AndroidHostContext,
  type AndroidNetworkStatusDetail,
} from "@/react-app/services/native/androidBridge";

export type HostLifecycleState = "foreground" | "background";

export type HostNetworkStatus = {
  online: boolean;
  type: string;
  timestamp: string;
};

function getBrowserNetworkStatus(): HostNetworkStatus {
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  return {
    online,
    type: online ? "browser-online" : "browser-offline",
    timestamp: new Date().toISOString(),
  };
}

function buildWebHostContext(): AndroidHostContext {
  const hasNavigator = typeof navigator !== "undefined";
  const hasMedia = hasNavigator && !!navigator.mediaDevices;
  const hasGeo = hasNavigator && "geolocation" in navigator;

  return {
    platform: "web",
    webMode: "remote",
    buildType: import.meta.env.DEV ? "dev" : "prod",
    networkOnline: getBrowserNetworkStatus().online,
    capabilities: {
      camera: hasMedia,
      gallery: hasMedia,
      healthMetrics: false,
      offlineQueue: true,
      lifecycleEvents: true,
      location: hasGeo,
    },
  };
}

export function getHostContext(): AndroidHostContext {
  if (!isAndroidNativeAvailable()) {
    return buildWebHostContext();
  }

  return getAndroidHostContext() ?? {
    ...buildWebHostContext(),
    platform: "android",
    capabilities: {
      ...buildWebHostContext().capabilities,
      healthMetrics: true,
      location: true,
    },
  };
}

export function isAndroidHost(): boolean {
  return getHostContext().platform === "android";
}

export function subscribeToNetworkStatus(
  listener: (status: HostNetworkStatus) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const emitBrowserStatus = () => {
    listener(getBrowserNetworkStatus());
  };

  const handleNativeStatus = (event: Event) => {
    const detail = (event as CustomEvent<AndroidNetworkStatusDetail>).detail;
    listener({
      online: detail?.online !== false,
      type:
        typeof detail?.type === "string" && detail.type.trim().length > 0
          ? detail.type
          : detail?.online === false
            ? "android-offline"
            : "android-online",
      timestamp:
        typeof detail?.timestamp === "string" && detail.timestamp.trim().length > 0
          ? detail.timestamp
          : new Date().toISOString(),
    });
  };

  window.addEventListener("online", emitBrowserStatus);
  window.addEventListener("offline", emitBrowserStatus);
  window.addEventListener("network_status_changed", handleNativeStatus as EventListener);

  return () => {
    window.removeEventListener("online", emitBrowserStatus);
    window.removeEventListener("offline", emitBrowserStatus);
    window.removeEventListener("network_status_changed", handleNativeStatus as EventListener);
  };
}

export function subscribeToLifecycleState(
  listener: (state: HostLifecycleState) => void,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const emitBrowserState = () => {
    listener(document.visibilityState === "hidden" ? "background" : "foreground");
  };

  const handleNativeLifecycle = (event: Event) => {
    const detail = (event as CustomEvent<AndroidAppLifecycleDetail>).detail;
    listener(detail?.state === "background" ? "background" : "foreground");
  };

  document.addEventListener("visibilitychange", emitBrowserState);
  window.addEventListener("focus", emitBrowserState);
  window.addEventListener("blur", emitBrowserState);
  window.addEventListener("app_lifecycle_changed", handleNativeLifecycle as EventListener);

  return () => {
    document.removeEventListener("visibilitychange", emitBrowserState);
    window.removeEventListener("focus", emitBrowserState);
    window.removeEventListener("blur", emitBrowserState);
    window.removeEventListener("app_lifecycle_changed", handleNativeLifecycle as EventListener);
  };
}
