import { ROUTE_PATHS } from "@/react-app/auth/constants";

export function reloadIntoAppEntry(): void {
  if (typeof window === "undefined") return;
  window.location.replace(ROUTE_PATHS.app);
}

export function scheduleReloadIntoAppEntry(delayMs: number): number | null {
  if (typeof window === "undefined") return null;
  return window.setTimeout(() => {
    reloadIntoAppEntry();
  }, Math.max(0, delayMs));
}
