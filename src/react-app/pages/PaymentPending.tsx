import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import PaymentStatusPopup from "@/react-app/components/PaymentStatusPopup";
import LoadingBall from "@/react-app/components/LoadingBall";
import { useAuth } from "@/react-app/contexts/auth";
import { hasPlanAccess } from "@/react-app/services/authService";
import { api } from "@/react-app/utils/api";

type SubscriptionStatusPayload = {
  plan_id: "free" | "pro" | "annual" | "vip";
  plan_status: "pending" | "active" | "cancelled" | "failed" | "expired";
  payment_method: "none" | "card" | "pix";
  amount: number;
  checkout_url?: string | null | undefined;
};

const METHOD_HELP: Record<"card" | "pix", string> = {
  card: "A aprovação do cartão pode levar alguns instantes. Aguarde e clique em verificar status.",
  pix: "Conclua o pagamento no app do seu banco e depois clique em verificar status.",
};

export default function PaymentPending() {
  const { user, checkAuth, logout } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [lastAmount, setLastAmount] = useState<number | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [method, setMethod] = useState<"card" | "pix">("card");
  const [statusPopup, setStatusPopup] = useState<{
    title: string;
    message: string;
    tone: "success" | "warning" | "error";
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    if (hasPlanAccess(user)) {
      navigate(ROUTE_PATHS.home, { replace: true });
      return;
    }
    if (user.plan_status !== "pending") {
      navigate(ROUTE_PATHS.payment, { replace: true });
    }
  }, [navigate, user]);

  const methodHint = useMemo(() => METHOD_HELP[method], [method]);

  const handleExitAndReset = async () => {
    try {
      await api("/api/logout", { credentials: "include" });
    } catch {
      // ignore network issues and continue local reset
    } finally {
      logout();
      navigate(ROUTE_PATHS.login, { replace: true });
    }
  };

  const handleVerifyStatus = async () => {
    setChecking(true);
    try {
      const response = await api("/api/subscription/status");
      if (response.status === 401 || response.status === 403) {
        navigate(ROUTE_PATHS.app, { replace: true });
        return;
      }

      const payload = (await response.json().catch(() => null)) as SubscriptionStatusPayload | null;
      if (!response.ok || !payload) {
        setStatusPopup({
          title: "Falha na verificação",
          message: "Não foi possível consultar o status agora. Tente novamente.",
          tone: "error",
        });
        return;
      }

      if (payload.payment_method !== "none") {
        setMethod(payload.payment_method);
      }
      setLastAmount(Number.isFinite(payload.amount) ? payload.amount : null);
      setCheckoutUrl(typeof payload.checkout_url === "string" ? payload.checkout_url : null);

      if (payload.plan_id === "vip" || payload.plan_status === "active") {
        setStatusPopup({
          title: "Pagamento aprovado",
          message: "Seu acesso foi liberado. Redirecionando para o painel...",
          tone: "success",
        });
        await checkAuth();
        window.setTimeout(() => {
          navigate(ROUTE_PATHS.home, { replace: true });
        }, 1200);
        return;
      }

      if (payload.plan_status === "pending") {
        setStatusPopup({
          title: "Pagamento ainda pendente",
          message: "Recebemos sua solicitação, mas a aprovação ainda não foi confirmada.",
          tone: "warning",
        });
        return;
      }

      setStatusPopup({
        title: "Pagamento não aprovado",
        message: "Seu pagamento foi recusado ou cancelado. Você pode tentar novamente.",
        tone: "error",
      });
      window.setTimeout(() => {
        navigate(ROUTE_PATHS.payment, { replace: true });
      }, 1300);
    } catch {
      setStatusPopup({
        title: "Falha na verificação",
        message: "Erro de conexão ao consultar o pagamento.",
        tone: "error",
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 px-4 py-8">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/70 bg-white/85 p-6 shadow-xl backdrop-blur-xl md:p-8">
        <h1 className="text-2xl font-bold text-gray-900">Aguardando confirmação de pagamento</h1>
        <p className="mt-2 text-sm text-gray-600">
          Seu checkout foi iniciado e está em processamento. Assim que a operadora confirmar, seu acesso será liberado.
        </p>

        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {methodHint}
        </div>

        <ul className="mt-5 list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>Cartão: aprovação automática após análise da operadora.</li>
          <li>PIX: confirme o pagamento no banco antes de verificar.</li>
        </ul>

        {lastAmount !== null && (
          <p className="mt-4 text-sm font-semibold text-gray-800">
            Valor em processamento: {(lastAmount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            void handleVerifyStatus();
          }}
          disabled={checking}
          className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {checking ? (
            <span className="inline-flex items-center gap-2">
              <LoadingBall size="sm" />
              Verificando status
            </span>
          ) : (
            "Verificar status"
          )}
        </button>

        <button
          type="button"
          onClick={() => navigate(ROUTE_PATHS.payment)}
          className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Alterar pagamento
        </button>

        <button
          type="button"
          onClick={() => {
            void handleExitAndReset();
          }}
          className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 hover:bg-red-100"
        >
          Sair e começar do zero
        </button>

        {checkoutUrl && (
          <button
            type="button"
            onClick={() => window.open(checkoutUrl, "_blank", "noopener,noreferrer")}
            className="mt-3 w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            Abrir checkout
          </button>
        )}
      </div>

      <PaymentStatusPopup
        open={statusPopup !== null}
        title={statusPopup?.title ?? ""}
        message={statusPopup?.message ?? ""}
        tone={statusPopup?.tone ?? "warning"}
        onClose={() => setStatusPopup(null)}
      />
    </div>
  );
}
