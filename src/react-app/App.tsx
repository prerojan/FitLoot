import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from "react-router";
import { useState, useEffect, lazy, Suspense, useCallback } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import PageLoader from "@/react-app/components/PageLoader";
import LoadingBall from "@/react-app/components/LoadingBall";
import { ROUTE_PATHS, AUTHENTICATED_HINT_KEY } from "@/react-app/constants/auth";
import { AuthContext, useAuth } from "@/react-app/contexts/auth";
import { ThemeContext } from "@/react-app/contexts/theme";
import { useAuthBootstrap } from "@/react-app/hooks/useAuthBootstrap";
import type { User } from "@/react-app/types/auth";
import {
  DEFAULT_APP_THEME_MODE,
  applyAppThemeMode,
  persistAppThemeMode,
  type AppThemeMode,
} from "@/react-app/utils/appTheme";
import { applyProfileTheme } from "@/react-app/utils/theme";
import { clearJsonCache } from "@/react-app/utils/api";

const HomePage = lazy(() => import("@/react-app/pages/Home"));
const Onboarding = lazy(() => import("@/react-app/pages/Onboarding"));
const PaymentPending = lazy(() => import("@/react-app/pages/PaymentPending"));
const PaymentRequired = lazy(() => import("@/react-app/pages/PaymentRequired"));
const Dashboard = lazy(() => import("@/react-app/pages/Dashboard"));
const Profile = lazy(() => import("@/react-app/pages/Profile"));
const Shop = lazy(() => import("@/react-app/pages/Shop"));
const Ranking = lazy(() => import("@/react-app/pages/Ranking"));
const Arena = lazy(() => import("@/react-app/pages/Arena"));
const MiniGames = lazy(() => import("@/react-app/pages/MiniGames"));
const AIChat = lazy(() => import("@/react-app/pages/AIChat"));
const FoodAnalysis = lazy(() => import("@/react-app/pages/FoodAnalysis"));
const LandingPage = lazy(() => import("@/react-app/pages/Landing"));
const NotFoundPage = lazy(() => import("@/react-app/pages/NotFound"));

const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 px-6 pt-20">
        <div className="fl-card p-6 flex items-center justify-center">
          <LoadingBall size="md" />
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to={ROUTE_PATHS.login} replace />;
  return <>{children}</>;
};

const AppRoute = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 px-6 pt-20">
        <div className="fl-card p-6 flex items-center justify-center">
          <LoadingBall size="md" />
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to={ROUTE_PATHS.login} replace />;
  return <Navigate to={ROUTE_PATHS.home} replace />;
};

type InitialRedirectControllerProps = {
  user: User | null;
  loading: boolean;
  initialRedirectDone: boolean;
  onInitialRedirectHandled: () => void;
};

const InitialRedirectController = ({
  user,
  loading,
  initialRedirectDone,
  onInitialRedirectHandled,
}: InitialRedirectControllerProps) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || initialRedirectDone) return;

    onInitialRedirectHandled();
    if (user) {
      navigate(ROUTE_PATHS.home, { replace: true });
    }
  }, [initialRedirectDone, loading, navigate, onInitialRedirectHandled, user]);

  return null;
};

type AppProps = {
  initialThemeMode?: AppThemeMode;
};

export default function App({ initialThemeMode = DEFAULT_APP_THEME_MODE }: AppProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialRedirectDone, setInitialRedirectDone] = useState(false);
  const [themeMode, setThemeModeState] = useState<AppThemeMode>(initialThemeMode);

  const checkAuth = useAuthBootstrap({ setUser, setLoading });
  const markInitialRedirectHandled = useCallback(() => {
    setInitialRedirectDone(true);
  }, []);
  const setThemeMode = useCallback((mode: AppThemeMode) => {
    setThemeModeState(mode);
  }, []);
  const toggleThemeMode = useCallback(() => {
    setThemeModeState((currentMode) => (currentMode === "light" ? "dark" : "light"));
  }, []);

  const logout = () => {
    localStorage.removeItem(AUTHENTICATED_HINT_KEY);
    clearJsonCache();
    applyProfileTheme(null);
    setUser(null);
  };

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    applyAppThemeMode(themeMode);
    persistAppThemeMode(themeMode);
  }, [themeMode]);

  return (
    <AuthContext.Provider value={{ user, loading, checkAuth, logout }}>
      <Router>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path={ROUTE_PATHS.landing} element={<LandingPage />} />
            <Route path={ROUTE_PATHS.app} element={appRouteElement} />
            <Route path={ROUTE_PATHS.home} element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.onboarding} element={<Onboarding />} />
            <Route path={ROUTE_PATHS.checkout} element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.dashboard} element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.profile} element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.shop} element={<ProtectedRoute><Shop /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.ranking} element={<ProtectedRoute><Ranking /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.friends} element={<ProtectedRoute><Friends /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.minigames} element={<ProtectedRoute><MiniGames /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.aiChat} element={<ProtectedRoute><AIChat /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.foodAnalysis} element={<ProtectedRoute><FoodAnalysis /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.wildcard} element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthContext.Provider>
  );
}
