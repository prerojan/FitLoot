import { BrowserRouter, HashRouter } from "react-router";
import { useState, useEffect, Suspense, useCallback } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { clearPersistedAuthenticatedUserState } from "@/react-app/auth/clientStateCleanup";
import { AuthContext } from "@/react-app/auth/context";
import { AppChromeContext } from "@/react-app/contexts/appChrome";
import { ThemeContext } from "@/react-app/contexts/theme";
import { useAuthBootstrap } from "@/react-app/auth/hooks/useAuthBootstrap";
import {
  DEFAULT_APP_THEME_MODE,
  applyAppThemeMode,
  persistAppThemeMode,
  type AppThemeMode,
} from "@/react-app/theme/appTheme";
import type { User } from "@/react-app/auth/types";
import { startPresenceHeartbeat } from "@/react-app/services/presenceService";
import { getHostContext } from "@/react-app/services/runtime/hostRuntime";
import { offlineSyncService } from "@/react-app/services/runtime/offlineSyncService";
import { OFFLINE_ROUTE_BLOCKED_EVENT } from "@/react-app/services/appNavigation";
import AppRoutes from "./routes/AppRoutes";
import RouteLoader from "./routes/RouteLoader";

type AppProps = {
  initialThemeMode?: AppThemeMode;
};

export default function App({ initialThemeMode = DEFAULT_APP_THEME_MODE }: AppProps) {
  const hostContext = getHostContext();
  const RouterComponent = hostContext.webMode === "bundled" ? HashRouter : BrowserRouter;
  const shouldRenderVercelTelemetry = hostContext.platform !== "android";
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [themeMode, setThemeModeState] = useState<AppThemeMode>(initialThemeMode);
  const [missionDetailsOpen, setMissionDetailsOpen] = useState(false);
  const [missionExecutionOpen, setMissionExecutionOpen] = useState(false);
  const [offlineRouteBlocked, setOfflineRouteBlocked] = useState(false);

  const checkAuth = useAuthBootstrap({ setUser, setLoading });
  const setThemeMode = useCallback((mode: AppThemeMode) => {
    setThemeModeState(mode);
  }, []);
  const toggleThemeMode = useCallback(() => {
    setThemeModeState((currentMode) => (currentMode === "light" ? "dark" : "light"));
  }, []);

  const logout = useCallback(() => {
    clearPersistedAuthenticatedUserState();
    setUser(null);
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    offlineSyncService.start();
  }, []);

  useEffect(() => {
    applyAppThemeMode(themeMode);
    persistAppThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!user?.id) return;
    return startPresenceHeartbeat();
  }, [user, user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let timeoutId = 0;
    const handleOfflineRouteBlocked = () => {
      setOfflineRouteBlocked(true);
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setOfflineRouteBlocked(false);
      }, 3200);
    };

    window.addEventListener(OFFLINE_ROUTE_BLOCKED_EVENT, handleOfflineRouteBlocked as EventListener);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(OFFLINE_ROUTE_BLOCKED_EVENT, handleOfflineRouteBlocked as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const root = document.documentElement;
    let timeoutId = 0;

    const revealScrollbars = () => {
      root.classList.add("fl-scrollbars-active");
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        root.classList.remove("fl-scrollbars-active");
      }, 900);
    };

    document.addEventListener("scroll", revealScrollbars, { capture: true, passive: true });
    window.addEventListener("wheel", revealScrollbars, { passive: true });
    window.addEventListener("touchmove", revealScrollbars, { passive: true });

    return () => {
      window.clearTimeout(timeoutId);
      root.classList.remove("fl-scrollbars-active");
      document.removeEventListener("scroll", revealScrollbars, true);
      window.removeEventListener("wheel", revealScrollbars);
      window.removeEventListener("touchmove", revealScrollbars);
    };
  }, []);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, toggleThemeMode }}>
      <AppChromeContext.Provider
        value={{
          missionDetailsOpen,
          missionExecutionOpen,
          setMissionDetailsOpen,
          setMissionExecutionOpen,
        }}
      >
        <AuthContext.Provider value={{ user, loading, checkAuth, logout }}>
          <RouterComponent>
            <Suspense fallback={<RouteLoader />}>
              <AppRoutes />
            </Suspense>

            {shouldRenderVercelTelemetry ? <Analytics /> : null}
            {shouldRenderVercelTelemetry ? <SpeedInsights /> : null}
          </RouterComponent>
          {offlineRouteBlocked ? (
            <div className="fl-z-toast fixed inset-x-0 bottom-24 flex justify-center px-4 md:bottom-6">
              <div
                className="rounded-full border px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.14em] shadow-xl"
                style={{
                  borderColor: "color-mix(in srgb, #f59e0b 28%, transparent)",
                  background: "color-mix(in srgb, var(--fl-surface-strong) 94%, transparent)",
                  color: "var(--fl-color-text)",
                }}
              >
                Sem internet para abrir esta tela agora.
              </div>
            </div>
          ) : null}
        </AuthContext.Provider>
      </AppChromeContext.Provider>
    </ThemeContext.Provider>
  );
}
