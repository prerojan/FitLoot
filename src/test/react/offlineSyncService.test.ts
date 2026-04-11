import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  getHostContextMock,
  subscribeToLifecycleStateMock,
  subscribeToNetworkStatusMock,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  getHostContextMock: vi.fn(),
  subscribeToLifecycleStateMock: vi.fn(),
  subscribeToNetworkStatusMock: vi.fn(),
}));

vi.mock("../../react-app/utils/api", () => ({
  api: apiMock,
}));

vi.mock("../../react-app/services/runtime/hostRuntime", () => ({
  getHostContext: getHostContextMock,
  subscribeToLifecycleState: subscribeToLifecycleStateMock,
  subscribeToNetworkStatus: subscribeToNetworkStatusMock,
}));

function buildHostContext(online: boolean) {
  return {
    platform: "android" as const,
    webMode: "remote" as const,
    buildType: "prod" as const,
    networkOnline: online,
    capabilities: {
      camera: true,
      gallery: true,
      healthMetrics: true,
      offlineQueue: true,
      lifecycleEvents: true,
      location: true,
    },
  };
}

function createResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

describe("offlineSyncService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
    getHostContextMock.mockReturnValue(buildHostContext(false));
    subscribeToLifecycleStateMock.mockImplementation(() => () => undefined);
    subscribeToNetworkStatusMock.mockImplementation(() => () => undefined);
  });

  it("deduplicates repeated offline mission completions for the same mission", async () => {
    const { offlineSyncService } = await import("../../react-app/services/runtime/offlineSyncService");

    const firstResult = await offlineSyncService.syncMissionCompletion({
      missionId: 42,
      metricCompleted: 12,
      sensorVerified: true,
      userId: "user-1",
    });
    const secondResult = await offlineSyncService.syncMissionCompletion({
      missionId: 42,
      metricCompleted: 12,
      sensorVerified: true,
      userId: "user-1",
    });

    expect(firstResult.status).toBe("queued");
    expect(secondResult.status).toBe("queued");
    expect(secondResult.operationId).toBe(firstResult.operationId);
    expect(offlineSyncService.getState().operations).toHaveLength(1);
    expect(Array.from(offlineSyncService.getPendingMissionIds())).toEqual([42]);
  });

  it("does not report failed mission syncs as pending missions", async () => {
    getHostContextMock.mockReturnValue(buildHostContext(true));
    apiMock.mockRejectedValueOnce(new Error("timeout"));

    const { offlineSyncService } = await import("../../react-app/services/runtime/offlineSyncService");

    const result = await offlineSyncService.syncMissionCompletion({
      missionId: 7,
      metricCompleted: 5,
      sensorVerified: true,
      userId: "user-1",
    });

    expect(result.status).toBe("queued");
    expect(offlineSyncService.getState().operations).toHaveLength(1);
    expect(offlineSyncService.getState().operations[0]?.syncStatus).toBe("failed");
    expect(Array.from(offlineSyncService.getPendingMissionIds())).toEqual([]);
  });

  it("publishes metrics without waiting for the flush to finish", async () => {
    getHostContextMock.mockReturnValue(buildHostContext(true));

    let resolveFlush: ((value: Response) => void) | null = null;
    apiMock.mockImplementation(async (path: string) => {
      if (path !== "/api/offline/sync") {
        throw new Error(`Unexpected path: ${path}`);
      }

      return await new Promise<Response>((resolve) => {
        resolveFlush = resolve;
      });
    });

    const { offlineSyncService } = await import("../../react-app/services/runtime/offlineSyncService");

    await offlineSyncService.hydrateMetricsBaseline({
      date: "2026-04-03",
      steps: 10,
      calories: 5,
    });

    await expect(
      offlineSyncService.publishMetricsSnapshot({
        date: "2026-04-03",
        steps: 25,
        calories: 11,
        confidence: "official",
      }),
    ).resolves.toBeUndefined();

    expect(apiMock).toHaveBeenCalledWith(
      "/api/offline/sync",
      expect.objectContaining({ method: "POST", requestClass: "background" }),
    );

    resolveFlush?.(createResponse({ success: true }));
    await vi.waitFor(() => {
      expect(offlineSyncService.getState().operations).toHaveLength(0);
    });
  });

  it("does not drop the first metrics snapshot of a new day", async () => {
    getHostContextMock.mockReturnValue(buildHostContext(true));
    apiMock.mockResolvedValue(createResponse({ success: true }));

    const { offlineSyncService } = await import("../../react-app/services/runtime/offlineSyncService");

    await expect(
      offlineSyncService.publishMetricsSnapshot({
        date: "2026-04-04",
        steps: 178,
        calories: 12,
        distanceMeters: 140,
        confidence: "official",
      }),
    ).resolves.toBeUndefined();

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/offline/sync",
        expect.objectContaining({ method: "POST", requestClass: "background" }),
      );
    });

    expect(offlineSyncService.getState().operations).toHaveLength(0);
  });

  it("dispatches a mission-synced event after queued missions flush successfully", async () => {
    const { offlineSyncService, OFFLINE_MISSION_SYNCED_EVENT } = await import("../../react-app/services/runtime/offlineSyncService");

    const eventSpy = vi.fn();
    window.addEventListener(OFFLINE_MISSION_SYNCED_EVENT, eventSpy as EventListener);

    await offlineSyncService.syncMissionCompletion({
      missionId: 99,
      metricCompleted: 1,
      sensorVerified: true,
      userId: "user-1",
    });

    getHostContextMock.mockReturnValue(buildHostContext(true));
    Reflect.set(offlineSyncService as object, "networkOnline", true);
    apiMock.mockResolvedValue(createResponse({ success: true }));

    await offlineSyncService.flush();

    expect(eventSpy).toHaveBeenCalledTimes(1);
    const customEvent = eventSpy.mock.calls[0]?.[0] as CustomEvent<{ missionIds: number[] }>;
    expect(customEvent.detail.missionIds).toEqual([99]);
    expect(offlineSyncService.getState().operations).toHaveLength(0);

    window.removeEventListener(OFFLINE_MISSION_SYNCED_EVENT, eventSpy as EventListener);
  });
});
