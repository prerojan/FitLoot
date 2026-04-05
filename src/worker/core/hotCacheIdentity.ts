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

function buildNormalizedPublicCacheDescriptor(path: string, url: URL): string | null {
  if (path !== "/api/auth/check-availability") {
    const normalizedSearch = url.searchParams.toString();
    return normalizedSearch.length > 0 ? `${path}?${normalizedSearch}` : path;
  }

  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const username = (url.searchParams.get("username") ?? "").trim().toLowerCase();
  if (!email && !username) {
    return null;
  }

  const normalizedQuery = new URLSearchParams();
  if (email) {
    normalizedQuery.set("email", email);
  }
  if (username) {
    normalizedQuery.set("username", username);
  }

  return `${path}?${normalizedQuery.toString()}`;
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

  const publicDescriptor = buildNormalizedPublicCacheDescriptor(input.path, url);
  if (!publicDescriptor) {
    return null;
  }
  const descriptorHash = await hashScopeValue(publicDescriptor);

  return {
    requestKey: `public:${descriptorHash}`,
    runtimeCacheKey: `public:${descriptorHash}`,
    runtimeScopeKey: `public:${input.path}`,
    requestClass: "public",
  };
}
