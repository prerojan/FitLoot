import {
  getAndroidBridge,
  isAndroidNativeAvailable,
  type AndroidNotificationOpenedDetail,
  type AndroidNotificationPermissionDetail,
} from "@/react-app/services/native/androidBridge";

export type NativeNotificationPermissionStatus = {
  granted: boolean;
  permission: "granted" | "denied" | "prompt";
  timestamp: string;
};

function normalizePermissionStatus(
  detail: Partial<AndroidNotificationPermissionDetail> | null | undefined,
): NativeNotificationPermissionStatus {
  const permission =
    detail?.permission === "granted" || detail?.permission === "denied" || detail?.permission === "prompt"
      ? detail.permission
      : detail?.granted === true
        ? "granted"
        : "prompt";

  return {
    granted: permission === "granted",
    permission,
    timestamp:
      typeof detail?.timestamp === "string" && detail.timestamp.trim().length > 0
        ? detail.timestamp
        : new Date().toISOString(),
  };
}

class NativeNotificationService {
  requestPermission(): boolean {
    if (!isAndroidNativeAvailable()) return false;
    const bridge = getAndroidBridge();
    if (!bridge?.requestNotificationPermission) return false;
    bridge.requestNotificationPermission();
    return true;
  }

  readPermissionStatus(): NativeNotificationPermissionStatus {
    if (!isAndroidNativeAvailable()) {
      return normalizePermissionStatus({
        granted: false,
        permission: "denied",
      });
    }

    const bridge = getAndroidBridge();
    const reader = bridge?.getNotificationPermissionStatus;
    if (!reader) {
      return normalizePermissionStatus({
        granted: false,
        permission: "prompt",
      });
    }

    try {
      const payload = JSON.parse(reader.call(bridge)) as Partial<AndroidNotificationPermissionDetail>;
      return normalizePermissionStatus(payload);
    } catch {
      return normalizePermissionStatus({
        granted: false,
        permission: "prompt",
      });
    }
  }

  subscribeToPermissionChanges(
    handler: (status: NativeNotificationPermissionStatus) => void,
  ): () => void {
    if (typeof window === "undefined") {
      return () => undefined;
    }

    const handleEvent = (event: Event) => {
      const detail = (event as CustomEvent<AndroidNotificationPermissionDetail>).detail;
      handler(normalizePermissionStatus(detail));
    };

    window.addEventListener("notification_permission_changed", handleEvent as EventListener);
    return () => {
      window.removeEventListener("notification_permission_changed", handleEvent as EventListener);
    };
  }

  subscribeToNotificationOpen(
    handler: (detail: AndroidNotificationOpenedDetail) => void,
  ): () => void {
    if (typeof window === "undefined") {
      return () => undefined;
    }

    const handleEvent = (event: Event) => {
      const detail = (event as CustomEvent<AndroidNotificationOpenedDetail>).detail ?? {};
      handler(detail);
    };

    window.addEventListener("native_notification_opened", handleEvent as EventListener);
    return () => {
      window.removeEventListener("native_notification_opened", handleEvent as EventListener);
    };
  }
}

export const notificationService = new NativeNotificationService();

export default notificationService;
