import { useCallback } from "react";
import { AUTHENTICATED_HINT_KEY, PENDING_404_ACHIEVEMENT_KEY } from "@/react-app/constants/auth";
import { triggerRouteNotFoundAchievement } from "@/react-app/services/achievementService";
import { fetchCurrentUser, notifyAppOpen } from "@/react-app/services/authService";
import { fetchProfileTheme } from "@/react-app/services/profileService";
import type { User } from "@/react-app/types/auth";
import { applyProfileTheme } from "@/react-app/utils/theme";

interface UseAuthBootstrapParams {
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export function useAuthBootstrap({ setUser, setLoading }: UseAuthBootstrapParams) {
  return useCallback(async () => {
    const hasSessionHint = localStorage.getItem(AUTHENTICATED_HINT_KEY) === "1";
    if (!hasSessionHint) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const user = await fetchCurrentUser();
      if (!user) {
        setUser(null);
        return;
      }

      setUser(user);
      void notifyAppOpen().catch(() => undefined);

      const pending404 = localStorage.getItem(PENDING_404_ACHIEVEMENT_KEY) === "1";
      if (pending404) {
        void triggerRouteNotFoundAchievement().finally(() => {
          localStorage.removeItem(PENDING_404_ACHIEVEMENT_KEY);
        });
      }

      void fetchProfileTheme()
        .then((profile) => {
          applyProfileTheme(profile);
        })
        .catch(() => undefined);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [setLoading, setUser]);
}
