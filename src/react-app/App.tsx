import { BrowserRouter as Router } from "react-router";
import { useState, useEffect, Suspense, useCallback } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { AUTHENTICATED_HINT_KEY } from "@/react-app/auth/constants";
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
import { applyProfileTheme } from "@/react-app/theme/profileTheme";
import { clearJsonCache } from "@/react-app/utils/api";
import type { User } from "@/react-app/auth/types";
import AppRoutes from "./routes/AppRoutes";
import RouteLoader from "./routes/RouteLoader";

type AppProps = {
  initialThemeMode?: AppThemeMode;
};

export default function App({ initialThemeMode = DEFAULT_APP_THEME_MODE }: AppProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [themeMode, setThemeModeState] = useState<AppThemeMode>(initialThemeMode);
  const [missionDetailsOpen, setMissionDetailsOpen] = useState(false);
  const [missionExecutionOpen, setMissionExecutionOpen] = useState(false);

  const checkAuth = useAuthBootstrap({ setUser, setLoading });
  const setThemeMode = useCallback((mode: AppThemeMode) => {
    setThemeModeState(mode);
  }, []);
  const toggleThemeMode = useCallback(() => {
    setThemeModeState((currentMode) => (currentMode === "light" ? "dark" : "light"));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTHENTICATED_HINT_KEY);
    clearJsonCache();
    applyProfileTheme(null);
    setUser(null);
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    applyAppThemeMode(themeMode);
    persistAppThemeMode(themeMode);
  }, [themeMode]);

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
          <Router>
            <Suspense fallback={<RouteLoader />}>
              <AppRoutes />
            </Suspense>

            <Analytics />
            <SpeedInsights />
          </Router>
        </AuthContext.Provider>
      </AppChromeContext.Provider>
    </ThemeContext.Provider>
  );
}
