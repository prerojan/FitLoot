import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router";
import { useState, useEffect, createContext, useContext, lazy, Suspense } from "react";
import HomePage from "@/react-app/pages/Home";
import Onboarding from "@/react-app/pages/Onboarding";
import LandingPage from "@/react-app/pages/Landing";
import { api } from "@/react-app/utils/api";
import PageLoader from "@/react-app/components/PageLoader";

const Dashboard = lazy(() => import("@/react-app/pages/Dashboard"));
const Profile = lazy(() => import("@/react-app/pages/Profile"));
const Shop = lazy(() => import("@/react-app/pages/Shop"));
const Ranking = lazy(() => import("@/react-app/pages/Ranking"));
const Friends = lazy(() => import("@/react-app/pages/Friends"));
const MiniGames = lazy(() => import("@/react-app/pages/MiniGames"));
const AIChat = lazy(() => import("@/react-app/pages/AIChat"));
const FoodAnalysis = lazy(() => import("@/react-app/pages/FoodAnalysis"));
const NotFoundPage = lazy(() => import("@/react-app/pages/NotFound"));

interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  onboarding_completed: number;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  checkAuth: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  checkAuth: async () => { },
  logout: () => { },
});

export const useAuth = () => useContext(AuthContext);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/app" replace />;
  if (user.onboarding_completed !== 1) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    const hasSessionHint = localStorage.getItem("fitloot_authenticated_hint") === "1";
    if (!hasSessionHint) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const response = await api('/api/users/me');
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        api('/api/app/open', { method: 'POST' }).catch(() => {});
        const pending404 = localStorage.getItem('fitloot_pending_404_achievement') === '1';
        if (pending404) {
          api('/api/events/route-not-found', { method: 'POST' }).finally(() => localStorage.removeItem('fitloot_pending_404_achievement'));
        }

        api('/api/profile').then((r) => r.json()).then((profile) => {
          const root = document.documentElement;
          root.classList.remove(...Array.from(root.classList).filter((c) => c.startsWith('theme-primary-') || c.startsWith('theme-secondary-') || c.startsWith('font-title-')));
          if (profile?.custom_primary_color) root.classList.add(`theme-primary-${String(profile.custom_primary_color)}`);
          if (profile?.custom_secondary_color) root.classList.add(`theme-secondary-${String(profile.custom_secondary_color)}`);
          if (profile?.custom_font) root.classList.add(`font-title-${String(profile.custom_font)}`);
          if (profile?.custom_background_type === 'image' && profile?.custom_background_value) {
            root.style.setProperty('--app-bg-image', `url(${String(profile.custom_background_value)})`);
          } else if (profile?.custom_background_type === 'color' && profile?.custom_background_value) {
            root.style.setProperty('--app-bg-color', String(profile.custom_background_value));
          }
        }).catch(() => {});
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("fitloot_authenticated_hint");
    setUser(null);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    void import("@/react-app/pages/Dashboard");
    void import("@/react-app/pages/Profile");
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, checkAuth, logout }}>
      <Router>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/app" element={loading ? <PageLoader /> : user ? <Navigate to={user.onboarding_completed === 1 ? "/home" : "/onboarding"} replace /> : <HomePage />} />
            <Route path="/home" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/shop" element={<ProtectedRoute><Shop /></ProtectedRoute>} />
            <Route path="/ranking" element={<ProtectedRoute><Ranking /></ProtectedRoute>} />
            <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
            <Route path="/minigames" element={<ProtectedRoute><MiniGames /></ProtectedRoute>} />
            <Route path="/ai-chat" element={<ProtectedRoute><AIChat /></ProtectedRoute>} />
            <Route path="/food-analysis" element={<ProtectedRoute><FoodAnalysis /></ProtectedRoute>} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthContext.Provider>
  );
}
