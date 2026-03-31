import type { Context } from "hono";

import type { AppContext, Env } from "./types";

const CORS_ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const DEFAULT_CORS_ALLOW_HEADERS = "Content-Type, Authorization";
const CORS_PREFLIGHT_MAX_AGE_SECONDS = "86400";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "https://fitloot.vercel.app",
  "https://fitloot-worker.suportefitloot.workers.dev",
];

const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  "https://fitloot-*.vercel.app",
];

// Resolve os headers liberados no preflight a partir da requisicao atual.
export function resolveCorsAllowHeaders(requestHeaders: Headers): string {
  const requestedHeaders = requestHeaders.get("Access-Control-Request-Headers");
  return requestedHeaders && requestedHeaders.trim().length > 0
    ? requestedHeaders
    : DEFAULT_CORS_ALLOW_HEADERS;
}

function mergeVaryHeader(existingValue: string | null, nextValues: string[]): string {
  const merged = new Set(
    (existingValue ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  for (const value of nextValues) {
    merged.add(value);
  }

  return Array.from(merged).join(", ");
}

// Aplica a mesma politica de CORS no contexto Hono durante o roteamento.
export function applyCorsHeadersToContext(
  c: Context<AppContext>,
  origin: string | null,
  allowHeaders: string,
) {
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
  }

  c.header("Access-Control-Allow-Headers", allowHeaders);
  c.header("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  c.header("Access-Control-Max-Age", CORS_PREFLIGHT_MAX_AGE_SECONDS);
  c.header(
    "Vary",
    mergeVaryHeader(c.res.headers.get("Vary"), [
      "Origin",
      "Access-Control-Request-Headers",
      "Access-Control-Request-Method",
    ]),
  );
}

// Replica a politica de CORS para respostas construidas manualmente.
export function applyCorsHeadersToResponseHeaders(
  headers: Headers,
  origin: string | null,
  allowHeaders: string,
) {
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  headers.set("Access-Control-Allow-Headers", allowHeaders);
  headers.set("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  headers.set("Access-Control-Max-Age", CORS_PREFLIGHT_MAX_AGE_SECONDS);
  headers.set(
    "Vary",
    mergeVaryHeader(headers.get("Vary"), [
      "Origin",
      "Access-Control-Request-Headers",
      "Access-Control-Request-Method",
    ]),
  );
}

function wildcardPatternToRegExp(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed.includes("*")) return null;

  const escaped = trimmed
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp(`^${escaped}$`);
}

function buildAllowedOrigins(env: Env) {
  const configuredOrigins = [env.FRONTEND_ORIGIN, env.FRONTEND_ORIGINS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const exactOrigins = new Set<string>([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...configuredOrigins.filter((origin) => !origin.includes("*")),
  ]);
  const wildcardPatterns = [
    ...DEFAULT_ALLOWED_ORIGIN_PATTERNS,
    ...configuredOrigins.filter((origin) => origin.includes("*")),
  ]
    .map((pattern) => wildcardPatternToRegExp(pattern))
    .filter((pattern): pattern is RegExp => pattern !== null);

  return { exactOrigins, wildcardPatterns };
}

// Resolve a origem permitida para CORS usando allowlist exata e curingas.
export function resolveCorsOrigin(requestOrigin: string | undefined, env: Env) {
  const { exactOrigins, wildcardPatterns } = buildAllowedOrigins(env);

  if (!requestOrigin) {
    return null;
  }

  if (exactOrigins.has(requestOrigin)) {
    return requestOrigin;
  }

  return wildcardPatterns.some((pattern) => pattern.test(requestOrigin))
    ? requestOrigin
    : null;
}
