import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
  ApiTimeoutError,
  isExpectedApiCancellation,
} from "@/react-app/utils/api";

describe("api request orchestration", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it("joins identical orchestrated requests and returns clonable responses", async () => {
    let resolveFetch: ((response: Response) => void) | null = null;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as typeof fetch;

    const first = api("/api/example", {
      method: "POST",
      body: "{}",
      orchestrationKey: "example",
      orchestrationPolicy: "join",
    });
    const second = api("/api/example", {
      method: "POST",
      body: "{}",
      orchestrationKey: "example",
      orchestrationPolicy: "join",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch?.(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(await firstResponse.json()).toEqual({ ok: true });
    expect(await secondResponse.json()).toEqual({ ok: true });
  });

  it("replaces superseded requests with an expected cancellation", async () => {
    const pending: Array<{ resolve: (response: Response) => void }> = [];
    global.fetch = vi.fn((_, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }

        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );

        pending.push({ resolve });
      });
    }) as typeof fetch;

    const firstPromise = api("/api/example", {
      method: "POST",
      body: "{}",
      orchestrationKey: "replaceable",
      orchestrationPolicy: "replace",
    }).catch((error) => error);

    const secondPromise = api("/api/example", {
      method: "POST",
      body: "{}",
      orchestrationKey: "replaceable",
      orchestrationPolicy: "replace",
    });

    const firstError = await firstPromise;
    expect(isExpectedApiCancellation(firstError)).toBe(true);

    pending.at(-1)?.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await secondPromise;
    expect(await response.json()).toEqual({ ok: true });
  });

  it("throws a typed timeout error when the request exceeds timeout", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((_, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise<Response>((_, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }

        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }) as typeof fetch;

    const request = api("/api/slow", {
      timeoutMs: 25,
      orchestrationKey: "slow-request",
      orchestrationPolicy: "replace",
    });
    const expectation = expect(request).rejects.toBeInstanceOf(ApiTimeoutError);

    await vi.advanceTimersByTimeAsync(30);
    await expectation;
  });
});
