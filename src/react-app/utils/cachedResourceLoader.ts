import { fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";

export type CachedResourceSnapshot<T> = {
  path: string;
  cached: { data: T; stale: boolean } | null;
  hasCached: boolean;
  stale: boolean;
};

export function hydrateCachedResource<T>(
  path: string,
  apply: (payload: T) => void,
  ttlMs?: number,
): CachedResourceSnapshot<T> {
  const cached = typeof ttlMs === "number" ? readCachedJson<T>(path, ttlMs) : readCachedJson<T>(path);
  if (cached) {
    apply(cached.data);
  }

  return {
    path,
    cached,
    hasCached: Boolean(cached),
    stale: Boolean(cached?.stale),
  };
}

export function shouldRefreshCachedResource(
  snapshot: Pick<CachedResourceSnapshot<unknown>, "hasCached" | "stale">,
  force = false,
): boolean {
  return force || !snapshot.hasCached || snapshot.stale;
}

export async function refreshCachedResource<T>(
  path: string,
  apply: (payload: T) => void,
): Promise<T> {
  const payload = await fetchAndCacheJson<T>(path);
  apply(payload);
  return payload;
}
