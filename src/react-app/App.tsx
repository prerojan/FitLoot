import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router";
import { useState, useEffect, lazy, Suspense, useCallback, type ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import PageLoader from "./constants/components/PageLoader";
import { ROUTE_PATHS, AUTHENTICATED_HINT_KEY } from "@/react-app/constants/auth";
import { AuthContext, useAuth } from "@/react-app/contexts/auth";
import { AppChromeContext } from "@/react-app/contexts/appChrome";
import { ThemeContext } from "@/react-app/contexts/theme";
import { useAuthBootstrap } from "@/react-app/hooks/useAuthBootstrap";
import {
  DEFAULT_APP_THEME_MODE,
  applyAppThemeMode,
  persistAppThemeMode,
  type AppThemeMode,
} from "@/react-app/utils/appTheme";
import { applyProfileTheme } from "@/react-app/utils/theme";
import { clearJsonCache } from "@/react-app/utils/api";
import { hasPlanAccess, resolveAuthenticatedStartRoute } from "@/react-app/services/authService";
import type { User } from "@/react-app/types/auth";

const HomePage = lazy(() => import("@/react-app/pages/Home"));
const Onboarding = lazy(() => import("@/react-app/pages/Onboarding"));
const Checkout = lazy(() => import("@/react-app/pages/Checkout"));
const PaymentPending = lazy(() => import("@/react-app/pages/PaymentPending"));
const Dashboard = lazy(() => import("@/react-app/pages/Dashboard"));
const Profile = lazy(() => import("@/react-app/pages/Profile"));
const Titles = lazy(() => import("@/react-app/pages/Titles"));
const Friends = lazy(() => import("@/react-app/pages/Friends"));
const Shop = lazy(() => import("@/react-app/pages/Shop"));
const Ranking = lazy(() => import("@/react-app/pages/Ranking"));
const MiniGames = lazy(() => import("@/react-app/pages/MiniGames"));
const AIChat = lazy(() => import("@/react-app/pages/AIChat"));
const Achievements = lazy(() => import("@/react-app/pages/Achievements"));
const FoodAnalysis = lazy(() => import("@/react-app/pages/FoodAnalysis"));

const LandingPage = lazy(() => import("@/react-app/pages/Landing"));
const NotFoundPage = lazy(() => import("@/react-app/pages/NotFound"));

const BILLING_ROUTE_PATHS = new Set<string>([
  ROUTE_PATHS.payment,
  ROUTE_PATHS.paymentPending,
  ROUTE_PATHS.checkout,
]);

function RouteLoader() {
  return <PageLoader />;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoader />;
  }

  if (!user) {
    return <Navigate to={ROUTE_PATHS.login} replace />;
  }

  if (!hasPlanAccess(user) && !BILLING_ROUTE_PATHS.has(location.pathname)) {
    return <Navigate to={ROUTE_PATHS.checkout} replace />;
  }

  return <>{children}</>;
}

function PublicAuthRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <RouteLoader />;
  }

  if (user) {
    return <Navigate to={resolveAuthenticatedStartRoute(user)} replace />;
  }

  return <>{children}</>;
}

function AppEntryRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <RouteLoader />;
  }

  if (!user) {
    return <Navigate to={ROUTE_PATHS.login} replace />;
  }

  return <Navigate to={resolveAuthenticatedStartRoute(user)} replace />;
}

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
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path={ROUTE_PATHS.landing} element={<LandingPage />} />
                <Route path={ROUTE_PATHS.publicLanding} element={<LandingPage />} />
                <Route
                  path={ROUTE_PATHS.login}
                  element={
                    <PublicAuthRoute>
                      <HomePage />
                    </PublicAuthRoute>
                  }
                />
                <Route path={ROUTE_PATHS.app} element={<AppEntryRoute />} />
                <Route path={ROUTE_PATHS.onboarding} element={<Onboarding />} />
                <Route
                  path={ROUTE_PATHS.payment}
                  element={
                    <ProtectedRoute>
                      <Checkout />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.paymentPending}
                  element={
                    <ProtectedRoute>
                      <PaymentPending />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.checkout}
                  element={
                    <ProtectedRoute>
                      <Checkout />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.home}
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.dashboard}
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.profile}
                  element={
                    <ProtectedRoute>
                      <Profile />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.titles}
                  element={
                    <ProtectedRoute>
                      <Titles />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.friends}
                  element={
                    <ProtectedRoute>
                      <Friends />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.shop}
                  element={
                    <ProtectedRoute>
                      <Shop />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.ranking}
                  element={
                    <ProtectedRoute>
                      <Ranking />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.achievements}
                  element={
                    <ProtectedRoute>
                      <Achievements />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.minigames}
                  element={
                    <ProtectedRoute>
                      <MiniGames />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.aiChat}
                  element={
                    <ProtectedRoute>
                      <AIChat />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTE_PATHS.foodAnalysis}
                  element={
                    <ProtectedRoute>
                      <FoodAnalysis />
                    </ProtectedRoute>
                  }
                />
                <Route path={ROUTE_PATHS.wildcard} element={<NotFoundPage />} />
              </Routes>
            </Suspense>

            <Analytics />
            <SpeedInsights />
          </Router>
        </AuthContext.Provider>
      </AppChromeContext.Provider>
    </ThemeContext.Provider>
  );
}
