import { api, resolveApiRequestUrl } from "@/react-app/utils/api";
import { ROUTE_PATHS } from "@/react-app/auth/constants";
import { clearPersistedAuthenticatedUserState } from "@/react-app/auth/clientStateCleanup";
import type { User } from "@/react-app/auth/types";
import type { UserProfileTheme } from "@/react-app/types/profile";
import type { UserProfile, UserProgression } from "@/shared/types";
import { preloadProtectedRoute } from "@/react-app/routes/lazyPages";
import { getHostContext } from "@/react-app/services/runtime/hostRuntime";

export type AuthBootstrapPayload = {
  user: User;
  profile: UserProfile | null;
  profile_theme: UserProfileTheme | null;
  progression: UserProgression | null;
  app_open_degraded?: boolean | undefined;
};

export type AuthBootstrapResult =
  | { state: "ok"; payload: AuthBootstrapPayload }
  | { state: "unauthorized" }
  | { state: "unavailable" };

const APP_OPEN_MIN_INTERVAL_MS = 45_000;
let lastAppOpenSentAt = 0;

function canUseSameOriginBeaconTransport(requestUrl: string): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  if (typeof navigator.sendBeacon !== "function") {
    return false;
  }

  try {
    const resolvedUrl = new URL(requestUrl, window.location.origin);
    return resolvedUrl.origin === window.location.origin;
  } catch {
    return false;
  }
}

async function isMissingUserResponse(response: Response): Promise<boolean> {
  if (response.status !== 404) {
    return false;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    return false;
  }

  const payload = (await response.clone().json().catch(() => null)) as
    | { code?: string | undefined }
    | null;
  return payload?.code === "USER_NOT_FOUND";
}

export async function fetchAuthBootstrap(): Promise<AuthBootstrapResult> {
  // Consolida a carga inicial de autenticacao em uma unica requisicao.
  const response = await api("/api/app/bootstrap", {
    orchestrationKey: "auth:bootstrap",
    orchestrationPolicy: "join",
    requestClass: "foreground",
  });
  if (
    response.status === 401 ||
    response.status === 403 ||
    (await isMissingUserResponse(response))
  ) {
    clearPersistedAuthenticatedUserState();
    return { state: "unauthorized" };
  }
  if (!response.ok) {
    return { state: "unavailable" };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    return { state: "unavailable" };
  }

  const payload = ((await response.json().catch(() => null)) as AuthBootstrapPayload | null) ?? null;
  return payload ? { state: "ok", payload } : { state: "unavailable" };
}

export async function fetchCurrentUser(): Promise<User | null> {
  // Resolve a sessao atual sem propagar excecoes para os consumidores.
  const response = await api("/api/users/me", {
    orchestrationKey: "auth:current-user",
    orchestrationPolicy: "join",
    requestClass: "foreground",
  });
  if (
    response.status === 401 ||
    response.status === 403 ||
    (await isMissingUserResponse(response))
  ) {
    clearPersistedAuthenticatedUserState();
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
  const now = Date.now();
  if (now - lastAppOpenSentAt < APP_OPEN_MIN_INTERVAL_MS) {
    return;
  }

  const requestUrl = resolveApiRequestUrl("/api/app/open");
  lastAppOpenSentAt = now;

  if (canUseSameOriginBeaconTransport(requestUrl)) {
    const beaconSent = navigator.sendBeacon(
      requestUrl,
      new Blob(["{}"], { type: "application/json" }),
    );
    if (beaconSent) {
      return;
    }
  }

  return api("/api/app/open", {
    method: "POST",
    keepalive: true,
    body: "{}",
    timeoutMs: 10_000,
    orchestrationKey: "auth:app-open",
    orchestrationPolicy: "join",
    requestClass: "background",
  })
    .then(() => undefined)
    .catch((error) => {
      lastAppOpenSentAt = 0;
      throw error;
    });
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
  ROUTE_PATHS.profile,
  ROUTE_PATHS.friends,
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
  const hostContext = getHostContext();
  if (hostContext.platform === "android") {
    return false;
  }

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
  const hostContext = getHostContext();
  if (hostContext.platform === "android") {
    return;
  }

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
