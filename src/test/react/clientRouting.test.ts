import { beforeEach, describe, expect, it, vi } from "vitest";

const getHostContextMock = vi.fn();

vi.mock("../../react-app/services/runtime/hostRuntime", () => ({
  getHostContext: () => getHostContextMock(),
}));

import {
  resolveClientRouteUrl,
  resolveCurrentClientPath,
} from "../../react-app/utils/clientRouting";

function buildHostContext(webMode: "remote" | "bundled") {
  return {
    platform: webMode === "bundled" ? ("android" as const) : ("web" as const),
    webMode,
    buildType: "prod" as const,
    networkOnline: true,
    capabilities: {
      camera: true,
      gallery: true,
      healthMetrics: webMode === "bundled",
      offlineQueue: true,
      lifecycleEvents: true,
      location: true,
    },
  };
}

describe("clientRouting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHostContextMock.mockReturnValue(buildHostContext("remote"));
    window.history.replaceState({}, "", "/login");
  });

  it("reads the current route from the hash in bundled mode", () => {
    getHostContextMock.mockReturnValue(buildHostContext("bundled"));
    window.history.replaceState({}, "", "/#/checkout?plan=pro");

    expect(resolveCurrentClientPath()).toBe("/checkout");
  });

  it("builds internal redirects with a hash in bundled mode", () => {
    getHostContextMock.mockReturnValue(buildHostContext("bundled"));
    window.history.replaceState({}, "", "/#/login");

    expect(resolveClientRouteUrl("/payment/pending")).toBe(
      `${window.location.origin}/#/payment/pending`,
    );
  });

  it("keeps plain paths in remote web mode", () => {
    expect(resolveCurrentClientPath()).toBe("/login");
    expect(resolveClientRouteUrl("/checkout")).toBe("/checkout");
  });
});
