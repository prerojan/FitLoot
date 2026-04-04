import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
  resolveApiRequestUrl: (path: string) => path,
}));

import { startPresenceHeartbeat } from "../../react-app/services/presenceService";

describe("presenceService", () => {
  const originalSendBeacon = navigator.sendBeacon;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: originalSendBeacon,
    });
  });

  it("uses beacon transport for heartbeat and offline transitions without fallback fetches", () => {
    const sendBeaconMock = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: sendBeaconMock,
    });

    const stop = startPresenceHeartbeat(15_000);

    expect(sendBeaconMock).toHaveBeenCalledWith(
      "/api/presence/heartbeat",
      expect.any(Blob),
    );
    expect(apiMock).not.toHaveBeenCalled();

    stop();

    expect(sendBeaconMock).toHaveBeenCalledWith(
      "/api/presence/offline",
      expect.any(Blob),
    );
    expect(apiMock).not.toHaveBeenCalled();
  });
});
