import { getCache, waitUntil } from "@vercel/functions";

export const config = {
  runtime: "edge",
};

const WORKER_BASE_URL =
  process.env.FITLOOT_WORKER_BASE_URL?.trim() ||
  "https://fitloot-worker.suportefitloot.workers.dev";
const CACHE_NAMESPACE = "fitloot-public-auth";
const FRESH_TTL_MS = 30_000;
const STALE_TTL_MS = 5 * 60_000;
const WORKER_TIMEOUT_MS = 6_500;

type AvailabilityPayload = {
  emailAvailable: boolean | null;
  usernameAvailable: boolean | null;
  message?: string;
  error?: string;
};

type CachedAvailabilityEnvelope = {
  status: number;
  payload: AvailabilityPayload;
  cachedAt: number;
  freshUntil: number;
  staleUntil: number;
};

function jsonResponse(
  payload: AvailabilityPayload,
  status: number,
  cacheStatus: string,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300",
      "X-FitLoot-Read-Plane": "vercel-runtime-cache",
      "X-FitLoot-Cache-Status": cacheStatus,
    },
  });
}

function normalizeAvailabilityQuery(request: Request): URLSearchParams | null {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const username = (url.searchParams.get("username") ?? "").trim().toLowerCase();

  if (!email && !username) {
    return null;
  }

  const normalized = new URLSearchParams();
  if (email) {
    normalized.set("email", email);
  }
  if (username) {
    normalized.set("username", username);
  }
  return normalized;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}

async function fetchWorkerAvailability(
  normalizedQuery: URLSearchParams,
  request: Request,
): Promise<CachedAvailabilityEnvelope> {
  const workerUrl = new URL("/api/auth/check-availability", WORKER_BASE_URL);
  workerUrl.search = normalizedQuery.toString();

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort("timeout");
  }, WORKER_TIMEOUT_MS);

  try {
    const response = await fetch(workerUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": request.headers.get("User-Agent") ?? "fitloot-vercel-read-plane",
      },
    });
    const payload = (await response.json().catch(() => null)) as AvailabilityPayload | null;
    const now = Date.now();
    return {
      status: response.status,
      payload:
        payload && typeof payload === "object"
          ? payload
          : {
              error: "Falha ao validar disponibilidade.",
              emailAvailable: null,
              usernameAvailable: null,
            },
      cachedAt: now,
      freshUntil: now + FRESH_TTL_MS,
      staleUntil: now + STALE_TTL_MS,
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function readOrRefreshAvailability(
  request: Request,
  normalizedQuery: URLSearchParams,
): Promise<Response> {
  const cache = getCache({ namespace: CACHE_NAMESPACE });
  const descriptor = `check-availability:${normalizedQuery.toString()}`;
  const cacheKey = await sha256(descriptor);
  const cached = (await cache.get(cacheKey)) as CachedAvailabilityEnvelope | null;
  const now = Date.now();

  if (cached && cached.freshUntil > now) {
    return jsonResponse(cached.payload, cached.status, "fresh");
  }

  if (cached && cached.staleUntil > now) {
    waitUntil(
      fetchWorkerAvailability(normalizedQuery, request)
        .then((refreshed) =>
          cache.set(cacheKey, refreshed, {
            ttl: Math.ceil(STALE_TTL_MS / 1000),
            name: "check-availability",
            tags: ["public-auth-availability"],
          }),
        )
        .catch((error) => {
          console.warn("[vercel-check-availability][background-refresh]", {
            message: error instanceof Error ? error.message : String(error),
          });
        }),
    );

    return jsonResponse(cached.payload, cached.status, "stale");
  }

  const refreshed = await fetchWorkerAvailability(normalizedQuery, request);
  if (refreshed.status < 500) {
    await cache.set(cacheKey, refreshed, {
      ttl: Math.ceil(STALE_TTL_MS / 1000),
      name: "check-availability",
      tags: ["public-auth-availability"],
    });
  }
  return jsonResponse(refreshed.payload, refreshed.status, "miss");
}

export default async function handler(request: Request): Promise<Response> {
  const normalizedQuery = normalizeAvailabilityQuery(request);
  if (!normalizedQuery) {
    return jsonResponse(
      {
        emailAvailable: null,
        usernameAvailable: null,
        message: "Informe email e/ou username para validacao.",
      },
      400,
      "bypass",
    );
  }

  try {
    return await readOrRefreshAvailability(request, normalizedQuery);
  } catch (error) {
    console.error("[vercel-check-availability]", {
      message: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      {
        error: "Falha ao validar disponibilidade.",
        emailAvailable: null,
        usernameAvailable: null,
      },
      500,
      "error",
    );
  }
}
