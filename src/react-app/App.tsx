import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router";
import { useState, useEffect, createContext, useContext, lazy, Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import PageLoader from "@/react-app/components/PageLoader";
import LoadingBall from "@/react-app/components/LoadingBall";
import { ROUTE_PATHS, AUTHENTICATED_HINT_KEY } from "@/react-app/constants/auth";
import { useAuthBootstrap } from "@/react-app/hooks/useAuthBootstrap";
import { prefetchCoreRoutes, resolveAuthenticatedStartRoute } from "@/react-app/services/authService";
import type { AuthContextType, User } from "@/react-app/types/auth";
import { applyProfileTheme } from "@/react-app/utils/theme";
import { clearJsonCache } from "@/react-app/utils/api";

const HomePage = lazy(() => import("@/react-app/pages/Home"));
const LandingPage = lazy(() => import("@/react-app/pages/Landing"));
const Onboarding = lazy(() => import("@/react-app/pages/Onboarding"));
const Dashboard = lazy(() => import("@/react-app/pages/Dashboard"));
const Profile = lazy(() => import("@/react-app/pages/Profile"));
const Shop = lazy(() => import("@/react-app/pages/Shop"));
const Ranking = lazy(() => import("@/react-app/pages/Ranking"));
const Arena = lazy(() => import("@/react-app/pages/Arena"));
const MiniGames = lazy(() => import("@/react-app/pages/MiniGames"));
const AIChat = lazy(() => import("@/react-app/pages/AIChat"));
const FoodAnalysis = lazy(() => import("@/react-app/pages/FoodAnalysis"));
const NotFoundPage = lazy(() => import("@/react-app/pages/NotFound"));

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  checkAuth: async () => {
    return undefined;
  },
  logout: () => {
    return undefined;
  },
});

export const useAuth = () => useContext(AuthContext);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
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
  if (!user) return <Navigate to={ROUTE_PATHS.app} replace />;
  if (user.onboarding_completed !== 1) return <Navigate to={ROUTE_PATHS.onboarding} replace />;
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useAuthBootstrap({ setUser, setLoading });

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
    prefetchCoreRoutes();
  }, []);

  const appRouteElement = user ? (
    <Navigate to={resolveAuthenticatedStartRoute(user)} replace />
  ) : (
    <HomePage />
  );

  return (
    <AuthContext.Provider value={{ user, loading, checkAuth, logout }}>
      <Router>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path={ROUTE_PATHS.landing} element={<LandingPage />} />
            <Route path={ROUTE_PATHS.app} element={appRouteElement} />
            <Route path={ROUTE_PATHS.home} element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.onboarding} element={<Onboarding />} />
            <Route path={ROUTE_PATHS.dashboard} element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.profile} element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.shop} element={<ProtectedRoute><Shop /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.ranking} element={<ProtectedRoute><Ranking /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.friends} element={<ProtectedRoute><Arena /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.minigames} element={<ProtectedRoute><MiniGames /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.aiChat} element={<ProtectedRoute><AIChat /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.foodAnalysis} element={<ProtectedRoute><FoodAnalysis /></ProtectedRoute>} />
            <Route path={ROUTE_PATHS.wildcard} element={<NotFoundPage />} />
          </Routes>
        </Suspense>
        <Analytics />
        <SpeedInsights />
      </Router>
    </AuthContext.Provider>
  );
}
