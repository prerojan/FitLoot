import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router";
import { useState, useEffect, createContext, useContext } from "react";
import HomePage from "@/react-app/pages/Home";
import Onboarding from "@/react-app/pages/Onboarding";
import Dashboard from "@/react-app/pages/Dashboard";
import Profile from "@/react-app/pages/Profile";
import Shop from "@/react-app/pages/Shop";
import Ranking from "@/react-app/pages/Ranking";
import LandingPage from "@/react-app/pages/Landing";
import Friends from "@/react-app/pages/Friends";
import MiniGames from "@/react-app/pages/MiniGames";
import AIChat from "@/react-app/pages/AIChat";
import { api } from "@/react-app/utils/api";


export interface User {
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

export const useAuth = (): AuthContextType => useContext(AuthContext);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center">
        <div className="text-emerald-600 text-xl">Carregando...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/app" replace />;
  }

  if (user.onboarding_completed !== 1) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const response = await api('/api/users/me');

      if (response.ok) {
        const userData = (await response.json()) as Partial<User>;
        const normalizedUser: User = {
          id: userData.id ?? "",
          email: userData.email ?? "",
          name: userData.name ?? "",
          onboarding_completed: Number(userData.onboarding_completed ?? 0),
          ...(typeof userData.avatar_url === "string" ? { avatar_url: userData.avatar_url } : {}),
        };
        setUser(normalizedUser);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setUser(null);
  } finally {
    setLoading(false);
  }
  };


  const isOnboardingCompleted = user?.onboarding_completed === 1;
  const logout = () => {
    setUser(null);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, checkAuth, logout }}>
      <Router>
        <Routes>
          {/* Landing page pública */}
          <Route path="/" element={<LandingPage />} />

          {/* Página de login: só redireciona quando loading terminou */}
          <Route path="/app" element={
            loading
              ? (
                  <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center">
                    <div className="text-emerald-600 text-xl">Carregando...</div>
                  </div>
                )
              : user
              ? <Navigate to={user.onboarding_completed ? "/home" : "/onboarding"} replace />
                : isOnboardingCompleted
                  ? <Navigate to="/home" replace />
                  : <HomePage />
          } />

          {/* Rotas protegidas */}
          <Route path="/home" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/shop" element={<ProtectedRoute><Shop /></ProtectedRoute>} />
          <Route path="/ranking" element={<ProtectedRoute><Ranking /></ProtectedRoute>} />
          <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
          <Route path="/minigames" element={<ProtectedRoute><MiniGames /></ProtectedRoute>} />
          <Route path="/ai-chat" element={<ProtectedRoute><AIChat /></ProtectedRoute>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthContext.Provider>
  );
}