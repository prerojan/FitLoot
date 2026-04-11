import { api, resolveApiRequestUrl } from "@/react-app/utils/api";
import {
  subscribeToLifecycleState,
  subscribeToNetworkStatus,
} from "@/react-app/services/runtime/hostRuntime";

const DEFAULT_PRESENCE_INTERVAL_MS = 30_000;
const DEFAULT_PRESENCE_TIMEOUT_MS = 6_000;
const OFFLINE_DEDUPE_WINDOW_MS = 3_000;

let lastOfflineSentAt = 0;

function canUseSameOriginBeaconTransport(requestUrl: string): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  if (typeof navigator.sendBeacon !== "function") {
    return false;
  }

  try {
    const resolvedUrl = new URL(requestUrl, window.location.origin);
    return resolvedUrl.origin === window.location.origin;
  } catch {
    return false;
  }
}

function trySendPresenceOfflineBeacon(
  path: string,
  payload?: Record<string, unknown>,
): boolean {
  const requestUrl = resolveApiRequestUrl(path);
  if (!canUseSameOriginBeaconTransport(requestUrl)) {
    return false;
  }

  const body = payload ? JSON.stringify(payload) : "{}";
  return navigator.sendBeacon(
    requestUrl,
    new Blob([body], { type: "application/json" }),
  );
}

function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

function isNavigatorOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

async function sendPresenceHeartbeat(): Promise<boolean> {
  if (!isNavigatorOnline()) {
    return false;
  }

  const response = await api("/api/presence/heartbeat", {
    method: "POST",
    body: JSON.stringify({ visibility: "friends" }),
    timeoutMs: DEFAULT_PRESENCE_TIMEOUT_MS,
    orchestrationKey: "presence:heartbeat",
    orchestrationPolicy: "join",
    requestClass: "background",
  });

  return response.ok;
}

async function sendPresenceOffline(): Promise<void> {
  const now = Date.now();
  if (now - lastOfflineSentAt < OFFLINE_DEDUPE_WINDOW_MS) {
    return;
  }

  lastOfflineSentAt = now;
  if (trySendPresenceOfflineBeacon("/api/presence/offline")) {
    return;
  }

  await api("/api/presence/offline", {
    method: "POST",
    keepalive: true,
    orchestrationKey: "presence:offline",
    orchestrationPolicy: "join",
    requestClass: "background",
  })
    .then(() => undefined);
}

// Starts a lightweight visibility-aware heartbeat loop for friends online presence.
export function startPresenceHeartbeat(
  intervalMs = DEFAULT_PRESENCE_INTERVAL_MS,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  let timer: number | null = null;
  let stopped = false;
  let heartbeatInFlight = false;

  const safeInterval = Math.max(20_000, Math.min(45_000, Math.floor(intervalMs)));

  const clearScheduledTick = () => {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  };

  const scheduleNextTick = (delay = safeInterval) => {
    if (stopped) return;
    clearScheduledTick();
    timer = window.setTimeout(() => {
      void runHeartbeatCycle();
    }, delay);
  };

  const runHeartbeatCycle = async () => {
    if (stopped) return;
    if (!isDocumentVisible() || !isNavigatorOnline() || heartbeatInFlight) {
      scheduleNextTick();
      return;
    }

    heartbeatInFlight = true;
    try {
      await sendPresenceHeartbeat();
    } catch {
      // The next scheduled heartbeat will retry naturally without stacking requests.
    } finally {
      heartbeatInFlight = false;
      scheduleNextTick();
    }
  };

  const triggerImmediateHeartbeat = () => {
    if (stopped || !isDocumentVisible() || heartbeatInFlight) return;
    clearScheduledTick();
    void runHeartbeatCycle();
  };

  const onVisibilityChange = () => {
    if (stopped || !isDocumentVisible()) return;
    triggerImmediateHeartbeat();
  };

  const onFocus = () => {
    if (stopped) return;
    triggerImmediateHeartbeat();
  };

  const onOnline = () => {
    if (stopped) return;
    triggerImmediateHeartbeat();
  };

  const onPageHide = () => {
    if (stopped) return;
    void sendPresenceOffline().catch(() => undefined);
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onFocus);
  window.addEventListener("pageshow", onFocus);
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onPageHide);
  const unsubscribeLifecycle = subscribeToLifecycleState((state) => {
    if (stopped) return;
    if (state === "foreground") {
      triggerImmediateHeartbeat();
      return;
    }
    void sendPresenceOffline().catch(() => undefined);
  });
  const unsubscribeNetwork = subscribeToNetworkStatus((status) => {
    if (stopped) return;
    if (status.online) {
      triggerImmediateHeartbeat();
      return;
    }
    void sendPresenceOffline().catch(() => undefined);
  });

  triggerImmediateHeartbeat();
  scheduleNextTick();

  return () => {
    stopped = true;
    clearScheduledTick();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("pageshow", onFocus);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("beforeunload", onPageHide);
    unsubscribeLifecycle();
    unsubscribeNetwork();
    void sendPresenceOffline().catch(() => undefined);
  };
}
