import { useCallback, useRef } from "react";

import {
  AUTHENTICATED_HINT_KEY,
  PENDING_404_ACHIEVEMENT_KEY,
  ROUTE_PATHS,
} from "../constants";
import { clearPersistedAuthenticatedUserState } from "../clientStateCleanup";
import type { User } from "../types";
import { triggerRouteNotFoundAchievement } from "../../services/achievementService";
import {
  fetchAuthBootstrap,
  fetchCurrentUser,
  hasPlanAccess,
  prefetchCoreRoutes,
  scheduleAppOpenNotification,
} from "../../services/authService";
import { applyProfileTheme } from "../../theme/profileTheme";
import { readCachedJson, writeCachedJson } from "../../utils/api";

interface UseAuthBootstrapParams {
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

const AUTH_BOOTSTRAP_PROTECTED_PATHS = new Set<string>([
  ROUTE_PATHS.app,
  ROUTE_PATHS.payment,
  ROUTE_PATHS.paymentPending,
  ROUTE_PATHS.checkout,
  ROUTE_PATHS.home,
  ROUTE_PATHS.dashboard,
  ROUTE_PATHS.profile,
  ROUTE_PATHS.shop,
  ROUTE_PATHS.ranking,
  ROUTE_PATHS.minigames,
  ROUTE_PATHS.aiChat,
  ROUTE_PATHS.foodAnalysis,
]);

function shouldProbeCurrentSession(): boolean {
  // Evita chamadas desnecessarias fora das rotas protegidas quando nao ha hint local.
  if (typeof window === "undefined") return true;

  const hasAuthenticatedHint = localStorage.getItem(AUTHENTICATED_HINT_KEY) === "1";
  if (hasAuthenticatedHint) return true;

  return AUTH_BOOTSTRAP_PROTECTED_PATHS.has(window.location.pathname);
}

// Canonical auth bootstrap hook that restores session and applies profile theme.
export function useAuthBootstrap({
  setUser,
  setLoading,
}: UseAuthBootstrapParams) {
  const inflightBootstrapRef = useRef<Promise<void> | null>(null);

  return useCallback(async () => {
    if (inflightBootstrapRef.current) {
      return inflightBootstrapRef.current;
    }

    const bootstrapTask = (async () => {
      let restoredFromCache = false;

      const hydrateCachedSession = (): void => {
        if (typeof window === "undefined") return;
        if (localStorage.getItem(AUTHENTICATED_HINT_KEY) !== "1") return;

        const cachedUser = readCachedJson<User>("/api/users/me", 5 * 60_000);
        if (!cachedUser?.data?.id) return;

        restoredFromCache = true;
        setUser(cachedUser.data);

        const cachedProfile = readCachedJson<Record<string, unknown>>(
          "/api/profile",
          5 * 60_000,
        );
        if (cachedProfile?.data) {
          applyProfileTheme(cachedProfile.data);
        }

        setLoading(false);
      };

      try {
        hydrateCachedSession();

        // Encerra cedo quando nao faz sentido consultar a sessao atual.
        if (!shouldProbeCurrentSession()) {
          applyProfileTheme(null);
          setUser(null);
          return;
        }

        // Restaura sessao e bootstrap principal em uma unica ida ao backend.
        const bootstrapResult = await fetchAuthBootstrap();
        if (bootstrapResult.state === "unauthorized") {
          clearPersistedAuthenticatedUserState();
          setUser(null);
          return;
        }

        if (bootstrapResult.state !== "ok") {
          if (restoredFromCache) {
            return;
          }

          const fallbackUser = await fetchCurrentUser();
          if (!fallbackUser) {
            clearPersistedAuthenticatedUserState();
            setUser(null);
            return;
          }

          localStorage.setItem(AUTHENTICATED_HINT_KEY, "1");
          setUser(fallbackUser);
          applyProfileTheme(null);
          scheduleAppOpenNotification();
          return;
        }

        const bootstrap = bootstrapResult.payload;
        const user = bootstrap.user;

        localStorage.setItem(AUTHENTICATED_HINT_KEY, "1");
        setUser(user);

        if (bootstrap.profile) {
          applyProfileTheme(bootstrap.profile);
          writeCachedJson("/api/profile", bootstrap.profile);
        } else if (bootstrap.profile_theme) {
          applyProfileTheme(bootstrap.profile_theme);
        } else {
          applyProfileTheme(null);
        }

        if (bootstrap.progression) {
          writeCachedJson("/api/progression", bootstrap.progression);
        }
        writeCachedJson("/api/users/me", user);

        if (user.onboarding_completed === 1 && hasPlanAccess(user)) {
          prefetchCoreRoutes();
        }
        scheduleAppOpenNotification();

        // Entrega a conquista 404 pendente assim que a sessao volta a existir.
        const pending404 =
          localStorage.getItem(PENDING_404_ACHIEVEMENT_KEY) === "1";
        if (pending404) {
          void triggerRouteNotFoundAchievement().finally(() => {
            localStorage.removeItem(PENDING_404_ACHIEVEMENT_KEY);
          });
        }
      } catch {
        if (restoredFromCache) {
          return;
        }
        clearPersistedAuthenticatedUserState();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })().finally(() => {
      inflightBootstrapRef.current = null;
    });

    inflightBootstrapRef.current = bootstrapTask;
    return bootstrapTask;
  }, [setLoading, setUser]);
}
