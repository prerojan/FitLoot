import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFriendOnlineState } from "../../worker/services/socialGraph";

describe("resolveFriendOnlineState", () => {
  let clockSeed = Date.parse("2026-04-09T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    clockSeed += 10_000;
    vi.setSystemTime(clockSeed);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers the explicit is_online flag when present", () => {
    expect(
      resolveFriendOnlineState({
        is_online: 1,
        presence_status: "offline",
        last_heartbeat_at: null,
      }),
    ).toBe(true);
  });

  it("marks online presence as active only within the heartbeat window", () => {
    expect(
      resolveFriendOnlineState({
        is_online: null,
        presence_status: "online",
        last_heartbeat_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      }),
    ).toBe(true);
  });

  it("marks stale online presence as offline", () => {
    expect(
      resolveFriendOnlineState({
        is_online: null,
        presence_status: "online",
        last_heartbeat_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      }),
    ).toBe(false);
  });

  it("keeps explicit offline presence offline even with a fresh heartbeat", () => {
    expect(
      resolveFriendOnlineState({
        is_online: null,
        presence_status: "offline",
        last_heartbeat_at: new Date(Date.now() - 30 * 1000).toISOString(),
      }),
    ).toBe(false);
  });
});
