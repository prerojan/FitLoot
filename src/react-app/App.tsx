import { BrowserRouter as Router, Routes, Route } from "react-router";
import { AuthProvider } from "@getmocha/users-service/react";
import HomePage from "@/react-app/pages/Home";
import AuthCallback from "@/react-app/pages/AuthCallback";
import Onboarding from "@/react-app/pages/Onboarding";
import Dashboard from "@/react-app/pages/Dashboard";
import Profile from "@/react-app/pages/Profile";
import Shop from "@/react-app/pages/Shop";
import Ranking from "@/react-app/pages/Ranking";
import LandingPage from "@/react-app/pages/Landing";
import Friends from "@/react-app/pages/Friends";
import MiniGames from "@/react-app/pages/MiniGames";

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/app" element={<HomePage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/ranking" element={<Ranking />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/minigames" element={<MiniGames />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
