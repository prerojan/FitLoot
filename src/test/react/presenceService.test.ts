import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
const subscribeToLifecycleStateMock = vi.fn(() => () => undefined);
const subscribeToNetworkStatusMock = vi.fn(() => () => undefined);

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
  resolveApiRequestUrl: (path: string) => path,
}));

vi.mock("../../react-app/services/runtime/hostRuntime", () => ({
  subscribeToLifecycleState: (...args: Parameters<typeof subscribeToLifecycleStateMock>) =>
    subscribeToLifecycleStateMock(...args),
  subscribeToNetworkStatus: (...args: Parameters<typeof subscribeToNetworkStatusMock>) =>
    subscribeToNetworkStatusMock(...args),
}));

import { startPresenceHeartbeat } from "../../react-app/services/presenceService";

describe("presenceService", () => {
  const originalSendBeacon = navigator.sendBeacon;
  const originalNavigatorOnLine = navigator.onLine;
  let clockSeed = Date.parse("2026-04-09T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    clockSeed += 10_000;
    vi.setSystemTime(clockSeed);
    vi.clearAllMocks();
    apiMock.mockResolvedValue({ ok: true });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: originalSendBeacon,
    });
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: originalNavigatorOnLine,
    });
  });

  it("sends heartbeats through api and reserves beacon transport for offline transitions", async () => {
    const sendBeaconMock = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: sendBeaconMock,
    });

    const stop = startPresenceHeartbeat(15_000);
    await Promise.resolve();

    expect(apiMock).toHaveBeenCalledWith(
      "/api/presence/heartbeat",
      expect.objectContaining({
        method: "POST",
        timeoutMs: 6_000,
        orchestrationKey: "presence:heartbeat",
        orchestrationPolicy: "join",
        requestClass: "background",
      }),
    );
    expect(sendBeaconMock).not.toHaveBeenCalledWith(
      "/api/presence/heartbeat",
      expect.anything(),
    );

    stop();

    expect(sendBeaconMock).toHaveBeenCalledWith(
      "/api/presence/offline",
      expect.any(Blob),
    );
  });

  it("does not start overlapping heartbeat requests while one is still pending", async () => {
    const sendBeaconMock = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: sendBeaconMock,
    });

    let resolveHeartbeat: ((value: { ok: boolean }) => void) | null = null;
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/presence/heartbeat") {
        return new Promise<{ ok: boolean }>((resolve) => {
          resolveHeartbeat = resolve;
        });
      }

      return Promise.resolve({ ok: true });
    });

    const stop = startPresenceHeartbeat(20_000);
    await Promise.resolve();

    expect(apiMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(apiMock).toHaveBeenCalledTimes(1);

    resolveHeartbeat?.({ ok: true });
    await Promise.resolve();

    stop();
    expect(sendBeaconMock).toHaveBeenCalledWith(
      "/api/presence/offline",
      expect.any(Blob),
    );
  });
});
