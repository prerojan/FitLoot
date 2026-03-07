import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/App";
import { api } from "@/react-app/utils/api";

export default function NotFound() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      api('/api/events/route-not-found', { method: 'POST' }).catch(() => {});
    } else {
      localStorage.setItem('fitloot_pending_404_achievement', '1');
    }
  }, [user]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white/90 backdrop-blur rounded-3xl shadow-xl p-8 text-center space-y-4">
        <div className="text-6xl">404</div>
        <h1 className="text-2xl font-bold text-gray-900">Ops, página perdida</h1>
        <p className="text-gray-600">Essa rota não existe no FitLoot. Bora voltar para a aventura principal?</p>
        <button
          onClick={() => navigate(user ? '/home' : '/app')}
          className="fl-btn-primary w-full rounded-xl py-3"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}
