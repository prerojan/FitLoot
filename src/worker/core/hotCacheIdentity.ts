import { getSessionIdFromCookieHeader } from "./sessionAuth";

const PUBLIC_HOT_CACHEABLE_PATHS = new Set<string>([
  "/api/auth/check-availability",
]);

const publicScopeHashes = new Map<string, string>();

export type HotCacheRequestIdentity = {
  requestKey: string;
  runtimeCacheKey: string;
  runtimeScopeKey: string | null;
  requestClass: "authenticated" | "public";
};

async function hashScopeValue(rawValue: string): Promise<string> {
  const cached = publicScopeHashes.get(rawValue);
  if (cached) {
    return cached;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawValue),
  );
  const hash = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  publicScopeHashes.set(rawValue, hash);
  return hash;
}

export function isPublicHotCacheablePath(path: string): boolean {
  return PUBLIC_HOT_CACHEABLE_PATHS.has(path);
}

export async function resolveHotCacheRequestIdentity(input: {
  path: string;
  url: string;
  cookieHeader?: string | undefined;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}): Promise<HotCacheRequestIdentity | null> {
  const sessionId = getSessionIdFromCookieHeader(input.cookieHeader);
  const url = new URL(input.url);

  if (sessionId) {
    const key = `${sessionId}:${input.path}:${url.search}`;
    return {
      requestKey: key,
      runtimeCacheKey: key,
      runtimeScopeKey: sessionId,
      requestClass: "authenticated",
    };
  }

  if (!isPublicHotCacheablePath(input.path)) {
    return null;
  }

  const ipAddress = (input.ipAddress ?? "").trim() || "unknown";
  const userAgent = (input.userAgent ?? "").trim();
  const actorSignature = `${ipAddress}|${userAgent}`;
  const scopeHash = await hashScopeValue(actorSignature);
  const runtimePathHash = await hashScopeValue(`${scopeHash}|${input.path}|${url.search}`);

  return {
    requestKey: `anon:${ipAddress}:${userAgent}:${input.path}:${url.search}`,
    runtimeCacheKey: `anon:${runtimePathHash}`,
    runtimeScopeKey: `anon:${scopeHash}`,
    requestClass: "public",
  };
}
