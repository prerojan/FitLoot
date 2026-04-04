import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAuthBootstrap,
  fetchCurrentUser,
  hasPlanAccess,
  notifyAppOpen,
  resolveAuthenticatedStartRoute,
} from "../../react-app/services/authService";

describe("authService routing", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    localStorage.clear();
    sessionStorage.clear();
  });

  it("routes users with paid access to home", () => {
    const route = resolveAuthenticatedStartRoute({
      id: "u1",
      email: "user@example.com",
      name: "User",
      onboarding_completed: 1,
      plan_id: "pro",
      plan_status: "active",
      payment_method: "card",
    });

    expect(route).toBe("/home");
  });

  it("keeps checkout route when access is not granted", () => {
    const route = resolveAuthenticatedStartRoute({
      id: "u2",
      email: "user2@example.com",
      name: "User2",
      onboarding_completed: 0,
      plan_id: "basic",
      plan_status: "pending",
      payment_method: "none",
    });

    expect(route).toBe("/checkout");
  });

  it("requires onboarding completion and active/vip status", () => {
    expect(
      hasPlanAccess({
        id: "u3",
        email: "u3@example.com",
        name: "U3",
        onboarding_completed: 1,
        plan_id: "vip",
        plan_status: "pending",
        payment_method: "card",
      }),
    ).toBe(true);

    expect(
      hasPlanAccess({
        id: "u4",
        email: "u4@example.com",
        name: "U4",
        onboarding_completed: 0,
        plan_id: "vip",
        plan_status: "active",
        payment_method: "card",
      }),
    ).toBe(false);
  });

  it("marks bootstrap as unauthorized when session is invalid", async () => {
    localStorage.setItem("fitloot_authenticated_hint", "1");
    global.fetch = vi.fn(async () => new Response(null, { status: 401 })) as typeof fetch;

    const result = await fetchAuthBootstrap();

    expect(result).toEqual({ state: "unauthorized" });
    expect(localStorage.getItem("fitloot_authenticated_hint")).toBeNull();
  });

  it("treats missing users as unauthorized and clears local state", async () => {
    localStorage.setItem("fitloot_authenticated_hint", "1");
    localStorage.setItem("fitloot_ai_chat_u1", JSON.stringify([{ role: "user" }]));
    sessionStorage.setItem("fitloot_activation_notice", JSON.stringify({ title: "x", message: "y", tone: "success" }));
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Usuário não encontrado", code: "USER_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const result = await fetchAuthBootstrap();

    expect(result).toEqual({ state: "unauthorized" });
    expect(localStorage.getItem("fitloot_authenticated_hint")).toBeNull();
    expect(localStorage.getItem("fitloot_ai_chat_u1")).toBeNull();
    expect(sessionStorage.getItem("fitloot_activation_notice")).toBeNull();
  });

  it("returns unavailable when bootstrap payload is not JSON", async () => {
    global.fetch = vi.fn(async () =>
      new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })) as typeof fetch;

    const result = await fetchAuthBootstrap();

    expect(result).toEqual({ state: "unavailable" });
  });

  it("hydrates auth bootstrap when payload is valid", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          user: {
            id: "u5",
            email: "u5@example.com",
            name: "U5",
            onboarding_completed: 1,
            plan_id: "vip",
            plan_status: "active",
            payment_method: "card",
          },
          profile: null,
          profile_theme: null,
          progression: null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof fetch;

    const result = await fetchAuthBootstrap();

    expect(result).toEqual({
      state: "ok",
      payload: expect.objectContaining({
        user: expect.objectContaining({ id: "u5" }),
      }),
    });
  });

  it("clears local state when current user is gone", async () => {
    localStorage.setItem("fitloot_authenticated_hint", "1");
    localStorage.setItem("fitloot_ai_chat_u7", JSON.stringify([{ role: "assistant" }]));
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Usuário não encontrado", code: "USER_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const result = await fetchCurrentUser();

    expect(result).toBeNull();
    expect(localStorage.getItem("fitloot_authenticated_hint")).toBeNull();
    expect(localStorage.getItem("fitloot_ai_chat_u7")).toBeNull();
  });

  it("dedupes app-open background notifications while a request is inflight", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as typeof fetch;

    const first = notifyAppOpen();
    const second = notifyAppOpen();

    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch?.(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await Promise.all([first, second]);
  });
});
