import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHostContextMock, hasProtectedRouteChunkMock, preloadProtectedRouteMock } = vi.hoisted(() => ({
  getHostContextMock: vi.fn(),
  hasProtectedRouteChunkMock: vi.fn(),
  preloadProtectedRouteMock: vi.fn(),
}));

vi.mock("../../react-app/services/runtime/hostRuntime", () => ({
  getHostContext: getHostContextMock,
}));

vi.mock("../../react-app/routes/lazyPages", () => ({
  hasProtectedRouteChunk: hasProtectedRouteChunkMock,
  preloadProtectedRoute: preloadProtectedRouteMock,
}));

import { navigateProtectedRoute, OFFLINE_ROUTE_BLOCKED_EVENT } from "../../react-app/services/appNavigation";

describe("navigateProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHostContextMock.mockReturnValue({
      platform: "android",
      webMode: "remote",
      buildType: "prod",
      networkOnline: true,
      capabilities: {
        camera: true,
        gallery: true,
        healthMetrics: true,
        offlineQueue: true,
        lifecycleEvents: true,
        location: true,
      },
    });
    hasProtectedRouteChunkMock.mockReturnValue(false);
    preloadProtectedRouteMock.mockResolvedValue(undefined);
  });

  it("preloads and navigates normally while online", async () => {
    const navigate = vi.fn();

    const result = await navigateProtectedRoute(navigate, "/shop");

    expect(preloadProtectedRouteMock).toHaveBeenCalledWith("/shop");
    expect(navigate).toHaveBeenCalledWith("/shop", undefined);
    expect(result).toEqual({ status: "navigated" });
  });

  it("blocks route navigation only when offline and the chunk is not available locally", async () => {
    const navigate = vi.fn();
    const eventSpy = vi.fn();
    window.addEventListener(OFFLINE_ROUTE_BLOCKED_EVENT, eventSpy as EventListener);

    getHostContextMock.mockReturnValue({
      platform: "android",
      webMode: "remote",
      buildType: "prod",
      networkOnline: false,
      capabilities: {
        camera: true,
        gallery: true,
        healthMetrics: true,
        offlineQueue: true,
        lifecycleEvents: true,
        location: true,
      },
    });

    const result = await navigateProtectedRoute(navigate, "/ranking");

    expect(navigate).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "blocked_offline" });
    expect(eventSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener(OFFLINE_ROUTE_BLOCKED_EVENT, eventSpy as EventListener);
  });

  it("allows offline navigation when the route chunk was already preloaded", async () => {
    const navigate = vi.fn();
    hasProtectedRouteChunkMock.mockReturnValue(true);
    getHostContextMock.mockReturnValue({
      platform: "android",
      webMode: "remote",
      buildType: "prod",
      networkOnline: false,
      capabilities: {
        camera: true,
        gallery: true,
        healthMetrics: true,
        offlineQueue: true,
        lifecycleEvents: true,
        location: true,
      },
    });

    const result = await navigateProtectedRoute(navigate, "/profile", { state: { openSettings: true } });

    expect(preloadProtectedRouteMock).toHaveBeenCalledWith("/profile");
    expect(navigate).toHaveBeenCalledWith("/profile", { state: { openSettings: true } });
    expect(result).toEqual({ status: "navigated" });
  });
});
