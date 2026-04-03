import { api } from "@/react-app/utils/api";

const DEFAULT_PRESENCE_INTERVAL_MS = 35_000;
const OFFLINE_DEDUPE_WINDOW_MS = 3_000;

let inflightHeartbeat: Promise<void> | null = null;
let inflightOffline: Promise<void> | null = null;
let lastOfflineSentAt = 0;

function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

async function sendPresenceHeartbeat(): Promise<void> {
  if (inflightHeartbeat) return inflightHeartbeat;

  inflightHeartbeat = api("/api/presence/heartbeat", {
    method: "POST",
    body: JSON.stringify({ visibility: "friends" }),
    keepalive: true,
  })
    .then(() => undefined)
    .finally(() => {
      inflightHeartbeat = null;
    });

  return inflightHeartbeat;
}

async function sendPresenceOffline(): Promise<void> {
  const now = Date.now();
  if (now - lastOfflineSentAt < OFFLINE_DEDUPE_WINDOW_MS) {
    return;
  }

  if (inflightOffline) return inflightOffline;

  lastOfflineSentAt = now;
  inflightOffline = api("/api/presence/offline", {
    method: "POST",
    keepalive: true,
  })
    .then(() => undefined)
    .finally(() => {
      inflightOffline = null;
    });

  return inflightOffline;
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

  const safeInterval = Math.max(30_000, Math.min(45_000, Math.floor(intervalMs)));

  const tick = () => {
    if (stopped || !isDocumentVisible()) return;
    void sendPresenceHeartbeat().catch(() => undefined);
  };

  const onVisibilityChange = () => {
    if (stopped) return;
    if (isDocumentVisible()) {
      tick();
    }
  };

  const onPageHide = () => {
    if (stopped) return;
    void sendPresenceOffline().catch(() => undefined);
  };

  timer = window.setInterval(() => {
    tick();
  }, safeInterval);

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onPageHide);
  tick();

  return () => {
    stopped = true;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("beforeunload", onPageHide);
    void sendPresenceOffline().catch(() => undefined);
  };
}
