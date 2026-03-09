const DEFAULT_PROD_API_URL = "https://fitloot-worker.suportefitloot.workers.dev";
const DEFAULT_DEV_API_URL = "http://localhost:8787";
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

const rawApiUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
const resolvedApiUrl = rawApiUrl || (import.meta.env.PROD ? DEFAULT_PROD_API_URL : DEFAULT_DEV_API_URL);

export const API_URL = resolvedApiUrl.endsWith("/") ? resolvedApiUrl.slice(0, -1) : resolvedApiUrl;

type CacheEntry = {
  data: unknown;
  timestamp: number;
  inflight: Promise<unknown> | null;
};

export type ApiRequestOptions = RequestInit & {
  timeoutMs?: number | undefined;
};

export class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const requestCache = new Map<string, CacheEntry>();

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function buildCacheKey(path: string): string {
  return `GET:${normalizePath(path)}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | T | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Falha na requisição.";
    throw new ApiRequestError(response.status, message);
  }

  return payload as T;
}

export async function api(path: string, options: ApiRequestOptions = {}) {
  const requestPath = normalizePath(path);
  const url = API_URL ? `${API_URL}${requestPath}` : requestPath;
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, headers, signal, ...restOptions } = options;
  const method = String(restOptions.method ?? "GET").toUpperCase();
  const requestHeaders = new Headers(headers ?? {});
  const hasBody = typeof restOptions.body !== "undefined" && restOptions.body !== null;
  const shouldSendJsonContentType = hasBody && method !== "GET" && method !== "HEAD";

  if (shouldSendJsonContentType && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const abortListener = () => controller.abort();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortListener, { once: true });
    }
  }

  const hasTimeout = Number.isFinite(timeoutMs) && Number(timeoutMs) > 0;
  const timeoutId = hasTimeout
    ? globalThis.setTimeout(() => {
        controller.abort();
      }, Number(timeoutMs))
    : null;

  try {
    return await fetch(url, {
      ...restOptions,
      method,
      credentials: "include",
      signal: controller.signal,
      headers: requestHeaders,
    });
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }

    if (signal) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}

export function readCachedJson<T>(path: string, ttlMs = DEFAULT_CACHE_TTL_MS): { data: T; stale: boolean } | null {
  const cacheKey = buildCacheKey(path);
  const entry = requestCache.get(cacheKey);
  if (!entry || typeof entry.data === "undefined") return null;

  return {
    data: entry.data as T,
    stale: Date.now() - entry.timestamp >= ttlMs,
  };
}

export async function fetchJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await api(path, options);
  return parseJsonResponse<T>(response);
}

export async function fetchAndCacheJson<T>(path: string): Promise<T> {
  const cacheKey = buildCacheKey(path);
  const entry = requestCache.get(cacheKey);

  if (entry?.inflight) {
    return entry.inflight as Promise<T>;
  }

  const inflight = fetchJson<T>(path)
    .then((data) => {
      requestCache.set(cacheKey, {
        data,
        timestamp: Date.now(),
        inflight: null,
      });
      return data;
    })
    .catch((error) => {
      const current = requestCache.get(cacheKey);
      if (current) {
        requestCache.set(cacheKey, { ...current, inflight: null });
      }
      throw error;
    });

  if (entry && typeof entry.data !== "undefined") {
    requestCache.set(cacheKey, {
      data: entry.data,
      timestamp: entry.timestamp,
      inflight,
    });
  } else {
    requestCache.set(cacheKey, {
      data: undefined,
      timestamp: 0,
      inflight,
    });
  }

  return inflight;
}

export async function prefetchJson(path: string): Promise<void> {
  try {
    await fetchAndCacheJson(path);
  } catch {
    // Prefetch failures are intentionally ignored to keep navigation non-blocking.
  }
}

export function clearJsonCache(path?: string): void {
  if (!path) {
    requestCache.clear();
    return;
  }

  requestCache.delete(buildCacheKey(path));
}
