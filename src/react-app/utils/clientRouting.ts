import { getHostContext } from "@/react-app/services/runtime/hostRuntime";

function normalizeRoutePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function resolveHashRoutePath(hash: string): string | null {
  const normalizedHash = hash.trim();
  if (!normalizedHash.startsWith("#")) {
    return null;
  }

  const routeFragment = normalizedHash.slice(1);
  if (!routeFragment) {
    return null;
  }

  const [pathname] = routeFragment.split(/[?#]/, 1);
  if (!pathname) {
    return null;
  }

  return normalizeRoutePath(pathname);
}

export function resolveCurrentClientPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  const hostContext = getHostContext();
  if (hostContext.webMode === "bundled") {
    return (
      resolveHashRoutePath(window.location.hash) ??
      normalizeRoutePath(window.location.pathname)
    );
  }

  return normalizeRoutePath(window.location.pathname);
}

export function resolveClientRouteUrl(path: string): string {
  const normalizedPath = normalizeRoutePath(path);
  if (typeof window === "undefined") {
    return normalizedPath;
  }

  const hostContext = getHostContext();
  if (hostContext.webMode !== "bundled") {
    return normalizedPath;
  }

  const currentUrl = new URL(window.location.href);
  currentUrl.hash = `#${normalizedPath}`;
  return currentUrl.toString();
}
