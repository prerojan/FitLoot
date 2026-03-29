import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/auth/context";
import { PENDING_404_ACHIEVEMENT_KEY, ROUTE_PATHS } from "@/react-app/auth/constants";
import { triggerRouteNotFoundAchievement } from "@/react-app/services/achievementService";

export default function NotFound() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Concede a conquista de rota perdida ou agenda a entrega para depois do login.
  useEffect(() => {
    if (user) {
      void triggerRouteNotFoundAchievement().catch(() => undefined);
      return;
    }
    localStorage.setItem(PENDING_404_ACHIEVEMENT_KEY, "1");
  }, [user]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center p-6">
      {/* Cartao de recuperacao para sair da rota invalida sem perder contexto. */}
      <div className="max-w-md w-full bg-white/90 backdrop-blur rounded-3xl shadow-xl p-8 text-center space-y-4">
        <div className="text-6xl">404</div>
        <h1 className="text-2xl font-bold text-gray-900">Ops, página perdida</h1>
        <p className="text-gray-600">Essa rota não existe no FitLoot. Bora voltar para a aventura principal?</p>
        <button
          type="button"
          onClick={() => navigate(user ? ROUTE_PATHS.home : ROUTE_PATHS.app)}
          className="fl-btn-primary w-full rounded-xl py-3"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}
