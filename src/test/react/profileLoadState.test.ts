import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/react-app/utils/api";
import { resolveProfilePrimaryLoadState } from "@/react-app/pages/profileLoadState";

describe("resolveProfilePrimaryLoadState", () => {
  it("navigates away when a primary read is unauthorized", () => {
    const state = resolveProfilePrimaryLoadState({
      cachedProfileHasCached: false,
      cachedProgressionHasCached: false,
      primaryTasks: [{ key: "profile" }],
      primaryResults: [
        {
          status: "rejected",
          reason: new ApiRequestError(401, "Unauthorized"),
        },
      ],
    });

    expect(state).toEqual({
      shouldNavigateToApp: true,
      shouldShowCriticalError: false,
    });
  });

  it("keeps the surface alive when only a non-critical primary read fails", () => {
    const state = resolveProfilePrimaryLoadState({
      cachedProfileHasCached: false,
      cachedProgressionHasCached: false,
      primaryTasks: [
        { key: "profile" },
        { key: "attributes" },
        { key: "progression" },
      ],
      primaryResults: [
        { status: "fulfilled", value: { user_id: "user-1" } },
        { status: "rejected", reason: new Error("query read timeout") },
        { status: "fulfilled", value: { level: 2 } },
      ],
    });

    expect(state).toEqual({
      shouldNavigateToApp: false,
      shouldShowCriticalError: false,
    });
  });

  it("shows the critical error when profile or progression are missing and not cached", () => {
    const state = resolveProfilePrimaryLoadState({
      cachedProfileHasCached: false,
      cachedProgressionHasCached: false,
      primaryTasks: [
        { key: "profile" },
        { key: "progression" },
      ],
      primaryResults: [
        { status: "rejected", reason: new Error("socket hang up") },
        { status: "fulfilled", value: { level: 2 } },
      ],
    });

    expect(state).toEqual({
      shouldNavigateToApp: false,
      shouldShowCriticalError: true,
    });
  });
});
