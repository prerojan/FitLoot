import { api } from "@/react-app/utils/api";
import { AUTHENTICATED_HINT_KEY, ROUTE_PATHS } from "@/react-app/auth/constants";
import type { User } from "@/react-app/auth/types";
import type { UserProfileTheme } from "@/react-app/types/profile";
import type { UserProfile, UserProgression } from "@/shared/types";
import { preloadProtectedRoute } from "@/react-app/routes/lazyPages";

export type AuthBootstrapPayload = {
  user: User;
  profile: UserProfile | null;
  profile_theme: UserProfileTheme | null;
  progression: UserProgression | null;
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
type NetworkInformationLike = {
  effectiveType?: string | undefined;
  saveData?: boolean | undefined;
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleCallbackFn, options?: { timeout: number }) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
  navigator: Navigator & {
    connection?: NetworkInformationLike | undefined;
  };
};

const PRIMARY_PROTECTED_PREFETCH_PATHS = [
  ROUTE_PATHS.home,
  ROUTE_PATHS.profile,
  ROUTE_PATHS.friends,
  ROUTE_PATHS.ranking,
  ROUTE_PATHS.minigames,
] as const;

const SECONDARY_PROTECTED_PREFETCH_PATHS = [
  ROUTE_PATHS.shop,
  ROUTE_PATHS.aiChat,
  ROUTE_PATHS.foodAnalysis,
  ROUTE_PATHS.achievements,
  ROUTE_PATHS.titles,
  ROUTE_PATHS.healthTest,
] as const;

function preloadProtectedRoutes(paths: readonly string[]): void {
  void Promise.allSettled(paths.map((path) => preloadProtectedRoute(path)));
}

function shouldPreloadSecondaryRoutes(win: IdleWindow): boolean {
  const connection = win.navigator.connection;
  if (!connection) {
    return true;
  }

  if (connection.saveData) {
    return false;
  }

  const effectiveType = String(connection.effectiveType ?? "").toLowerCase();
  return effectiveType !== "slow-2g" && effectiveType !== "2g";
}

function scheduleIdlePreload(
  idleWindow: IdleWindow,
  paths: readonly string[],
  options: {
    idleTimeout: number;
    fallbackDelay: number;
  },
): void {
  if (typeof idleWindow.requestIdleCallback === "function") {
    idleWindow.requestIdleCallback(() => {
      preloadProtectedRoutes(paths);
    }, { timeout: options.idleTimeout });
    return;
  }

  window.setTimeout(() => {
    preloadProtectedRoutes(paths);
  }, options.fallbackDelay);
}

export function prefetchCoreRoutes(): void {
  // Aquece primeiro apenas as rotas mais provaveis para evitar burst de chunks
  // logo apos o bootstrap, e deixa o restante para um segundo passe em rede boa.
  const idleWindow = window as IdleWindow;
  scheduleIdlePreload(idleWindow, PRIMARY_PROTECTED_PREFETCH_PATHS, {
    idleTimeout: 1200,
    fallbackDelay: 700,
  });

  if (!shouldPreloadSecondaryRoutes(idleWindow)) {
    return;
  }

  scheduleIdlePreload(idleWindow, SECONDARY_PROTECTED_PREFETCH_PATHS, {
    idleTimeout: 3200,
    fallbackDelay: 2400,
  });
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
