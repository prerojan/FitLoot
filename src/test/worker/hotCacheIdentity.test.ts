import { describe, expect, it } from "vitest";

import { resolveHotCacheRequestIdentity } from "@/worker/core/hotCacheIdentity";

describe("resolveHotCacheRequestIdentity", () => {
  it("preserves session-scoped keys for authenticated users", async () => {
    const identity = await resolveHotCacheRequestIdentity({
      path: "/api/metrics/today",
      url: "https://fitloot.vercel.app/api/metrics/today?refresh=1",
      cookieHeader: "session_id=session-123",
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
    });

    expect(identity).toEqual({
      requestKey: "session-123:/api/metrics/today:?refresh=1",
      runtimeCacheKey: "session-123:/api/metrics/today:?refresh=1",
      runtimeScopeKey: "session-123",
      requestClass: "authenticated",
    });
  });

  it("shares public onboarding availability cache keys by normalized query", async () => {
    const identity = await resolveHotCacheRequestIdentity({
      path: "/api/auth/check-availability",
      url: "https://fitloot.vercel.app/api/auth/check-availability?username=Teste",
      ipAddress: "203.0.113.12",
      userAgent: "Mozilla/5.0",
    });
    const repeatedIdentity = await resolveHotCacheRequestIdentity({
      path: "/api/auth/check-availability",
      url: "https://fitloot.vercel.app/api/auth/check-availability?username=teste",
      ipAddress: "198.51.100.99",
      userAgent: "DifferentAgent/1.0",
    });

    expect(identity).toEqual(repeatedIdentity);
    expect(identity?.requestClass).toBe("public");
    expect(identity?.requestKey).toMatch(/^public:[a-f0-9]{32}$/);
    expect(identity?.runtimeScopeKey).toBe("public:/api/auth/check-availability");
    expect(identity?.runtimeCacheKey).toMatch(/^public:[a-f0-9]{32}$/);
  });
});
