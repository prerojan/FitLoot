import { useCallback } from "react";

import {
  AUTHENTICATED_HINT_KEY,
  PENDING_404_ACHIEVEMENT_KEY,
  ROUTE_PATHS,
} from "../constants";
import type { User } from "../types";
import { triggerRouteNotFoundAchievement } from "../../services/achievementService";
import {
  fetchCurrentUser,
  hasPlanAccess,
  notifyAppOpen,
  prefetchCoreRoutes,
} from "../../services/authService";
import { fetchProfileTheme } from "../../services/profileService";
import { applyProfileTheme } from "../../theme/profileTheme";

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
  return useCallback(async () => {
    try {
      if (!shouldProbeCurrentSession()) {
        applyProfileTheme(null);
        setUser(null);
        return;
      }

      const user = await fetchCurrentUser();
      if (!user) {
        localStorage.removeItem(AUTHENTICATED_HINT_KEY);
        applyProfileTheme(null);
        setUser(null);
        return;
      }

      localStorage.setItem(AUTHENTICATED_HINT_KEY, "1");

      setUser(user);
      if (user.onboarding_completed === 1 && hasPlanAccess(user)) {
        const profile = await fetchProfileTheme().catch(() => null);
        applyProfileTheme(profile);
        prefetchCoreRoutes();
      } else {
        applyProfileTheme(null);
      }
      void notifyAppOpen().catch(() => undefined);

      const pending404 = localStorage.getItem(PENDING_404_ACHIEVEMENT_KEY) === "1";
      if (pending404) {
        void triggerRouteNotFoundAchievement().finally(() => {
          localStorage.removeItem(PENDING_404_ACHIEVEMENT_KEY);
        });
      }
    } catch {
      localStorage.removeItem(AUTHENTICATED_HINT_KEY);
      applyProfileTheme(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [setLoading, setUser]);
}
