import { describe, expect, it } from "vitest";

import { resolveRequestInvalidationPlan } from "@/worker/core/requestInvalidationPlan";

describe("resolveRequestInvalidationPlan", () => {
  it("does not invalidate caches for presence heartbeats", () => {
    expect(resolveRequestInvalidationPlan("POST", "/api/presence/heartbeat")).toEqual({
      hotCachePaths: [],
      runtimeProjectionScopes: [],
    });
  });

  it("invalidates only reward-related hot paths on app open", () => {
    expect(resolveRequestInvalidationPlan("POST", "/api/app/open")).toEqual({
      hotCachePaths: [
        "/api/reward-notifications/pending",
        "/api/achievements",
        "/api/titles",
      ],
      runtimeProjectionScopes: [],
    });
  });

  it("invalidates only metrics cache for offline metric sync", () => {
    expect(resolveRequestInvalidationPlan("POST", "/api/offline/sync")).toEqual({
      hotCachePaths: ["/api/metrics/today"],
      runtimeProjectionScopes: [],
    });
  });

  it("invalidates only pending rewards cache when consuming notifications", () => {
    expect(
      resolveRequestInvalidationPlan("POST", "/api/reward-notifications/consume"),
    ).toEqual({
      hotCachePaths: ["/api/reward-notifications/pending"],
      runtimeProjectionScopes: [],
    });
  });

  it("keeps profile customization on route-local invalidation only", () => {
    expect(
      resolveRequestInvalidationPlan("POST", "/api/profile/customization"),
    ).toEqual({
      hotCachePaths: [],
      runtimeProjectionScopes: [],
    });
  });

  it("keeps async AI mission generation from invalidating unrelated caches", () => {
    expect(
      resolveRequestInvalidationPlan("POST", "/api/ai/generate-missions"),
    ).toEqual({
      hotCachePaths: [],
      runtimeProjectionScopes: [],
    });
  });

  it("keeps social chat mutations route-local without broad cache invalidation", () => {
    expect(
      resolveRequestInvalidationPlan("POST", "/api/social/conversations/direct"),
    ).toEqual({
      hotCachePaths: [],
      runtimeProjectionScopes: [],
    });

    expect(
      resolveRequestInvalidationPlan("POST", "/api/social/groups"),
    ).toEqual({
      hotCachePaths: [],
      runtimeProjectionScopes: [],
    });

    expect(
      resolveRequestInvalidationPlan("POST", "/api/social/conversations/18/messages"),
    ).toEqual({
      hotCachePaths: [],
      runtimeProjectionScopes: [],
    });

    expect(
      resolveRequestInvalidationPlan("POST", "/api/social/conversations/18/media"),
    ).toEqual({
      hotCachePaths: [],
      runtimeProjectionScopes: [],
    });

    expect(
      resolveRequestInvalidationPlan("POST", "/api/social/conversations/18/mute"),
    ).toEqual({
      hotCachePaths: [],
      runtimeProjectionScopes: [],
    });

    expect(
      resolveRequestInvalidationPlan("POST", "/api/social/users/friend-9/block"),
    ).toEqual({
      hotCachePaths: [],
      runtimeProjectionScopes: [],
    });
  });

  it("invalidates only title-facing caches when activating a title", () => {
    expect(
      resolveRequestInvalidationPlan("POST", "/api/titles/12/activate"),
    ).toEqual({
      hotCachePaths: ["/api/titles"],
      runtimeProjectionScopes: ["bootstrap", "profile"],
    });
  });

  it("invalidates identity and ranking caches when mutating the avatar", () => {
    expect(
      resolveRequestInvalidationPlan("POST", "/api/users/me/avatar"),
    ).toEqual({
      hotCachePaths: [
        "/api/users/me",
        "/api/app/bootstrap",
        "/api/profile",
        "/api/ranking/global",
        "/api/ranking/friends",
      ],
      runtimeProjectionScopes: ["bootstrap", "profile"],
    });
  });

  it("preserves broad invalidation for logout", () => {
    expect(resolveRequestInvalidationPlan("GET", "/api/logout")).toEqual({
      hotCachePaths: "all",
      runtimeProjectionScopes: "all",
    });
  });

  it("falls back to broad invalidation for unknown mutations", () => {
    expect(resolveRequestInvalidationPlan("POST", "/api/shop/purchase/7")).toEqual({
      hotCachePaths: "all",
      runtimeProjectionScopes: "all",
    });
  });
});
