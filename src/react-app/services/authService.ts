import { api } from "@/react-app/utils/api";
import { AUTHENTICATED_HINT_KEY, ROUTE_PATHS } from "@/react-app/auth/constants";
import type { User } from "@/react-app/auth/types";
import type { UserProfileTheme } from "@/react-app/types/profile";
import { preloadProtectedRoute } from "@/react-app/routes/lazyPages";

export type AuthBootstrapPayload = {
  user: User;
  profile_theme: UserProfileTheme | null;
  progression: Record<string, unknown> | null;
  app_open_degraded?: boolean | undefined;
};

export async function fetchAuthBootstrap(): Promise<AuthBootstrapPayload | null> {
  // Consolida a carga inicial de autenticacao em uma unica requisicao.
  const response = await api("/api/app/bootstrap");
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem(AUTHENTICATED_HINT_KEY);
    return null;
  }
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    return null;
  }

  return ((await response.json().catch(() => null)) as AuthBootstrapPayload | null) ?? null;
}

export async function fetchCurrentUser(): Promise<User | null> {
  // Resolve a sessao atual sem propagar excecoes para os consumidores.
  const response = await api("/api/users/me");
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem(AUTHENTICATED_HINT_KEY);
    return null;
  }
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    return null;
  }
  return ((await response.json().catch(() => null)) as User | null) ?? null;
}

export async function notifyAppOpen(): Promise<void> {
  // Notifica a abertura da app para contadores e rotinas do backend.
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
  // On Android remote mode the WebView depends on network-delivered chunks.
  // Preloading every authenticated route reduces the chance of URL-only
  // navigations when connectivity drops after the dashboard is already open.
  const loadCoreRoutes = () => {
    void Promise.allSettled([
      ROUTE_PATHS.home,
      ROUTE_PATHS.profile,
      ROUTE_PATHS.minigames,
      ROUTE_PATHS.friends,
      ROUTE_PATHS.shop,
      ROUTE_PATHS.ranking,
      ROUTE_PATHS.aiChat,
      ROUTE_PATHS.foodAnalysis,
      ROUTE_PATHS.achievements,
      ROUTE_PATHS.titles,
      ROUTE_PATHS.healthTest,
    ].map((path) => preloadProtectedRoute(path)));
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
  // Centraliza a regra minima de acesso ao fluxo completo da app.
  return user.onboarding_completed === 1 && (user.plan_id === "vip" || user.plan_status === "active");
}

export function resolveAuthenticatedStartRoute(user: User): string {
  // Escolhe o primeiro destino valido apos a restauracao da sessao.
  if (hasPlanAccess(user)) return ROUTE_PATHS.home;
  return ROUTE_PATHS.checkout;
}
