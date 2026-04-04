import type { NavigateFunction, NavigateOptions } from "react-router";
import { hasProtectedRouteChunk, preloadProtectedRoute } from "@/react-app/routes/lazyPages";
import { getHostContext } from "@/react-app/services/runtime/hostRuntime";

export const OFFLINE_ROUTE_BLOCKED_EVENT = "fitloot:offline-route-blocked";

type OfflineRouteBlockedDetail = {
  path: string;
};

export type ProtectedNavigationResult =
  | { status: "navigated" }
  | { status: "blocked_offline" };

function normalizeRoutePath(path: string): string {
  const [pathname] = path.split(/[?#]/, 1);
  return pathname || path;
}

function dispatchOfflineRouteBlocked(path: string): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<OfflineRouteBlockedDetail>(OFFLINE_ROUTE_BLOCKED_EVENT, {
      detail: { path },
    }),
  );
}

export async function navigateProtectedRoute(
  navigate: NavigateFunction,
  path: string,
  options?: NavigateOptions,
): Promise<ProtectedNavigationResult> {
  const normalizedPath = normalizeRoutePath(path);
  const preload = preloadProtectedRoute(normalizedPath);
  const hostContext = getHostContext();

  if (!preload || hostContext.webMode === "bundled") {
    navigate(path, options);
    return { status: "navigated" };
  }

  if (!hostContext.networkOnline && !hasProtectedRouteChunk(normalizedPath)) {
    dispatchOfflineRouteBlocked(normalizedPath);
    return { status: "blocked_offline" };
  }

  try {
    await preload;
  } catch (error) {
    const currentHostContext = getHostContext();
    if (!currentHostContext.networkOnline && !hasProtectedRouteChunk(normalizedPath)) {
      dispatchOfflineRouteBlocked(normalizedPath);
      return { status: "blocked_offline" };
    }

    throw error;
  }

  navigate(path, options);
  return { status: "navigated" };
}
