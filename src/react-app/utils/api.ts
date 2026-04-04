const DEFAULT_DEV_API_URL = "http://localhost:8787";
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

const rawApiUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
// In production we prefer same-origin `/api` calls so previews and custom domains
// do not depend on cross-origin cookies/CORS to reach the worker.
const resolvedApiUrl = rawApiUrl || (import.meta.env.PROD ? "" : DEFAULT_DEV_API_URL);

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
const inflightGetRequests = new Map<string, Promise<Response>>();

type PlanAccessRequiredPayload = {
  redirect_to?: string | undefined;
};

function normalizePath(path: string): string {
  // Garante um formato consistente para construir URLs e chaves de cache.
  return path.startsWith("/") ? path : `/${path}`;
}

function buildCacheKey(path: string): string {
  // Usa apenas GET como chave de leitura cacheada no cliente.
  return `GET:${normalizePath(path)}`;
}

function buildInflightGetKey(url: string): string {
  return `GET:${url}`;
}

function resolveClientTimeZone(): string | null {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === "string" && timeZone.trim().length > 0
      ? timeZone.trim()
      : null;
  } catch {
    return null;
  }
}

/** Evita guardar `celebrate_level` no cache (só deve disparar modal uma vez). */
function stripEphemeralProgressionFields(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (record.celebrate_level === undefined) return data;
  const rest = { ...record };
  delete rest.celebrate_level;
  return rest;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  // Converte a resposta da API para JSON validando contrato e mensagens de erro.
  if (response.status === 204) {
    return null as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const rawPayload = await response.text();
  let payload: { error?: string | undefined } | T | null = null;

  if (rawPayload.trim().length > 0) {
    try {
      payload = JSON.parse(rawPayload) as { error?: string | undefined } | T;
    } catch {
      throw new ApiRequestError(502, "A API retornou uma resposta inválida. Verifique o deploy e os rewrites de /api.");
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Falha na requisição.";
    throw new ApiRequestError(response.status, message);
  }

  const isJsonResponse = contentType.includes("application/json") || contentType.includes("+json");
  if (!isJsonResponse || payload === null) {
    throw new ApiRequestError(502, "A API retornou uma resposta inválida. Verifique o deploy e os rewrites de /api.");
  }

  return payload as T;
}

async function handlePlanAccessRequired(response: Response): Promise<void> {
  // Redireciona o navegador quando o backend exige plano ativo para continuar.
  if (response.status !== 402 || typeof window === "undefined") return;

  const payload = (await response.clone().json().catch(() => null)) as PlanAccessRequiredPayload | null;
  const redirectTo = typeof payload?.redirect_to === "string" ? payload.redirect_to.trim() : "";
  if (!redirectTo) return;

  const normalizedRedirect = redirectTo.startsWith("/") ? redirectTo : `/${redirectTo}`;
  if (window.location.pathname === normalizedRedirect) return;

  window.location.assign(normalizedRedirect);
}

export async function api(path: string, options: ApiRequestOptions = {}) {
  // Wrapper padrao de fetch com cookies, timeout e suporte a cancelamento externo.
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
  if (!requestHeaders.has("X-FitLoot-Timezone")) {
    const clientTimeZone = resolveClientTimeZone();
    if (clientTimeZone) {
      requestHeaders.set("X-FitLoot-Timezone", clientTimeZone);
    }
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

  const executeRequest = async (): Promise<Response> => {
    const response = await fetch(url, {
      ...restOptions,
      method,
      credentials: "include",
      signal: controller.signal,
      headers: requestHeaders,
    });

    await handlePlanAccessRequired(response);
    return response;
  };

  try {
    const canDedupeGet = method === "GET" && !hasBody && !signal;
    if (!canDedupeGet) {
      return await executeRequest();
    }

    const inflightKey = buildInflightGetKey(url);
    const shared = inflightGetRequests.get(inflightKey);
    if (shared) {
      const response = await shared;
      return response.clone();
    }

    const started = executeRequest();
    inflightGetRequests.set(inflightKey, started);
    try {
      const response = await started;
      return response.clone();
    } finally {
      inflightGetRequests.delete(inflightKey);
    }
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
  // Le o snapshot atual do cache sem disparar nova requisicao.
  const cacheKey = buildCacheKey(path);
  const entry = requestCache.get(cacheKey);
  if (!entry || typeof entry.data === "undefined") return null;

  return {
    data: entry.data as T,
    stale: Date.now() - entry.timestamp >= ttlMs,
  };
}

export async function fetchJson<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  // Combina o wrapper de request com a validacao padrao de JSON.
  const response = await api(path, options);
  return parseJsonResponse<T>(response);
}

export async function fetchAndCacheJson<T>(path: string): Promise<T> {
  // Reutiliza requisicoes inflight e atualiza o cache consolidado ao final.
  const cacheKey = buildCacheKey(path);
  const entry = requestCache.get(cacheKey);

  if (entry?.inflight) {
    return entry.inflight as Promise<T>;
  }

  const inflight = fetchJson<T>(path)
    .then((data) => {
      const toCache =
        normalizePath(path) === "/api/progression" ? stripEphemeralProgressionFields(data) : data;
      requestCache.set(cacheKey, {
        data: toCache,
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
  // Prefetch falha em silencio para nao interferir na navegacao principal.
  try {
    await fetchAndCacheJson(path);
  } catch {
    // Prefetch failures are intentionally ignored to keep navigation non-blocking.
  }
}

export function clearJsonCache(path?: string): void {
  // Permite invalidar um recurso especifico ou todo o cache do cliente.
  if (!path) {
    requestCache.clear();
    return;
  }

  requestCache.delete(buildCacheKey(path));
}

export function writeCachedJson<T>(path: string, data: T): void {
  // Permite hidratar o cache do cliente com payloads autoritativos recebidos fora do GET principal.
  requestCache.set(buildCacheKey(path), {
    data,
    timestamp: Date.now(),
    inflight: null,
  });
}
