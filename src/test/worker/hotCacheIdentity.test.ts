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

  it("hashes public runtime identifiers for onboarding availability checks", async () => {
    const identity = await resolveHotCacheRequestIdentity({
      path: "/api/auth/check-availability",
      url: "https://fitloot.vercel.app/api/auth/check-availability?username=teste",
      ipAddress: "203.0.113.12",
      userAgent: "Mozilla/5.0",
    });

    expect(identity?.requestClass).toBe("public");
    expect(identity?.requestKey).toContain("203.0.113.12");
    expect(identity?.runtimeScopeKey).toMatch(/^anon:[a-f0-9]{32}$/);
    expect(identity?.runtimeCacheKey).toMatch(/^anon:[a-f0-9]{32}$/);
    expect(identity?.runtimeCacheKey).not.toContain("203.0.113.12");
    expect(identity?.runtimeCacheKey).not.toContain("Mozilla/5.0");
  });
});
