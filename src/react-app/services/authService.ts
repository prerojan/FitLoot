import { api } from "@/react-app/utils/api";
import { AUTHENTICATED_HINT_KEY, ROUTE_PATHS } from "@/react-app/constants/auth";
import type { User } from "@/react-app/types/auth";

export async function fetchCurrentUser(): Promise<User | null> {
  const response = await api("/api/users/me");
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem(AUTHENTICATED_HINT_KEY);
    return null;
  }
  if (!response.ok) return null;
  return (await response.json()) as User;
}

export async function notifyAppOpen(): Promise<void> {
  await api("/api/app/open", { method: "POST" });
}

type IdleDeadlineLike = {
  timeRemaining: () => number;
};

type IdleCallbackHandle = number;
type IdleCallbackFn = (deadline: IdleDeadlineLike) => void;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleCallbackFn, options?: { timeout: number }) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

export function prefetchCoreRoutes(): void {
  const loadCoreRoutes = () => {
    void Promise.all([
      import(`@/react-app/pages/Dashboard`),
      import(`@/react-app/pages/Profile`),
      import(`@/react-app/pages/Arena`),
    ]);
  };

  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === "function") {
    idleWindow.requestIdleCallback(() => {
      loadCoreRoutes();
    }, { timeout: 1500 });
    return;
  }

  window.setTimeout(() => {
    loadCoreRoutes();
  }, 900);
}

export function hasPlanAccess(user: User): boolean {
  return user.onboarding_completed === 1 && (user.plan_id === "vip" || user.plan_status === "active");
}

export function resolveAuthenticatedStartRoute(user: User): string {
  if (hasPlanAccess(user)) return ROUTE_PATHS.home;
  return ROUTE_PATHS.checkout;
}
