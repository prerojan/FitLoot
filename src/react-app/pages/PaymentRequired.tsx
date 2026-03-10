import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import PaymentStatusPopup from "@/react-app/components/PaymentStatusPopup";
import LoadingBall from "@/react-app/components/LoadingBall";
import { useAuth } from "@/react-app/contexts/auth";
import { hasPlanAccess } from "@/react-app/services/authService";
import { api } from "@/react-app/utils/api";

type PublicPlanId = "free" | "pro" | "annual";
type PaymentTab = "card" | "pix";

type CardPaymentForm = {
  number: string;
  holderName: string;
  expiry: string;
  cvv: string;
};

type CheckoutStartPayload = {
  checkout_status?: "pending" | "vip_active" | undefined;
  message?: string | undefined;
  amount?: number | undefined;
  checkout_url?: string | null | undefined;
};

const PLAN_OPTIONS = [
  { id: "free" as const, name: "Básico", amountCents: 4900 },
  { id: "pro" as const, name: "Premium", amountCents: 9900 },
  { id: "annual" as const, name: "Elite", amountCents: 14900 },
];

export default function PaymentRequired() {
  const { user, checkAuth, logout } = useAuth();
  const navigate = useNavigate();
  const initialPlan: PublicPlanId =
    user?.plan_id === "free" || user?.plan_id === "pro" || user?.plan_id === "annual" ? user.plan_id : "free";

  const [planId, setPlanId] = useState<PublicPlanId>(initialPlan);
  const [paymentTab, setPaymentTab] = useState<PaymentTab>("card");
  const [cardPayment, setCardPayment] = useState<CardPaymentForm>({
    number: "",
    holderName: "",
    expiry: "",
    cvv: "",
  });
  const [loading, setLoading] = useState(false);
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
    if (user.plan_status === "pending") {
      navigate(ROUTE_PATHS.paymentPending, { replace: true });
    }
  }, [navigate, user]);

  const retryHint = useMemo(() => {
    if (user?.plan_status === "failed") {
      return "Pagamento recusado. Atualize os dados e tente novamente.";
    }
    if (user?.plan_status === "cancelled") {
      return "Seu plano foi cancelado. Inicie um novo checkout para liberar o acesso.";
    }
    if (user?.plan_status === "expired") {
      return "Seu plano expirou. Inicie um novo checkout para continuar.";
    }
    return "Seu acesso está bloqueado até a confirmação de um pagamento ativo.";
  }, [user?.plan_status]);

  const selectedAmount = useMemo(
    () => PLAN_OPTIONS.find((plan) => plan.id === planId)?.amountCents ?? 0,
    [planId]
  );

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

  const handleRetryCheckout = async () => {
    if (paymentTab === "card" && !cardPayment.cvv.trim()) {
      setStatusPopup({
        title: "CVV obrigatório",
        message: "Informe o CVV para continuar com cartão.",
        tone: "warning",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await api("/api/checkout/start", {
        method: "POST",
        body: JSON.stringify({
          plan_id: planId,
          payment_method: paymentTab,
          card_number: paymentTab === "card" && cardPayment.number.trim() ? cardPayment.number : undefined,
          card_holder_name: paymentTab === "card" && cardPayment.holderName.trim() ? cardPayment.holderName : undefined,
          card_expiry: paymentTab === "card" && cardPayment.expiry.trim() ? cardPayment.expiry : undefined,
          card_cvv: paymentTab === "card" && cardPayment.cvv.trim() ? cardPayment.cvv : undefined,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate(ROUTE_PATHS.app, { replace: true });
        return;
      }

      const payload = (await response.json().catch(() => null)) as CheckoutStartPayload | { error?: string | undefined } | null;
      if (!response.ok) {
        setStatusPopup({
          title: "Falha ao iniciar pagamento",
          message: (payload as { error?: string | undefined } | null)?.error ?? "Não foi possível iniciar o checkout.",
          tone: "error",
        });
        return;
      }

      const checkout = payload as CheckoutStartPayload | null;
      const checkoutUrl = typeof checkout?.checkout_url === "string" ? checkout.checkout_url : null;
      if (checkout?.checkout_status === "vip_active") {
        setStatusPopup({
          title: "Pagamento aprovado",
          message: checkout.message ?? "Acesso liberado. Redirecionando para o painel...",
          tone: "success",
        });
        await checkAuth();
        window.setTimeout(() => {
          navigate(ROUTE_PATHS.home, { replace: true });
        }, 1200);
        return;
      }

      setStatusPopup({
        title: "Pagamento iniciado",
        message:
          checkout?.message ??
          `Cobrança iniciada (${(selectedAmount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). Vamos abrir o checkout para finalizar o pagamento.`,
        tone: "warning",
      });
      await checkAuth();
      window.setTimeout(() => {
        if (checkoutUrl) {
          window.open(checkoutUrl, "_blank", "noopener,noreferrer");
        }
        navigate(ROUTE_PATHS.paymentPending, { replace: true });
      }, 1200);
    } catch {
      setStatusPopup({
        title: "Falha ao iniciar pagamento",
        message: "Erro de conexão. Tente novamente.",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 px-4 py-8">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/70 bg-white/85 p-6 shadow-xl backdrop-blur-xl md:p-8">
        <h1 className="text-2xl font-bold text-gray-900">Pagamento necessário</h1>
        <p className="mt-2 text-sm text-gray-600">{retryHint}</p>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {PLAN_OPTIONS.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setPlanId(plan.id)}
              className={`rounded-xl border-2 px-4 py-3 text-left text-sm ${
                planId === plan.id ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-700"
              }`}
            >
              <p className="font-bold">{plan.name}</p>
              <p>{(plan.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Cobrança desta tentativa: {(selectedAmount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {([
            { id: "card", label: "Cartão" },
            { id: "pix", label: "PIX" },
          ] as const).map((method) => (
            <button
              key={method.id}
              type="button"
              onClick={() => setPaymentTab(method.id)}
              className={`rounded-xl border-2 px-3 py-2 text-sm ${
                paymentTab === method.id
                  ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                  : "border-gray-200 bg-white text-gray-700"
              }`}
            >
              {method.label}
            </button>
          ))}
        </div>

        {paymentTab === "card" && (
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Número do cartão</label>
              <input
                type="text"
                value={cardPayment.number}
                onChange={(event) => setCardPayment((current) => ({ ...current, number: event.target.value }))}
                placeholder="Número do cartão"
                className="h-11 w-full rounded-xl border-2 border-gray-200 bg-white px-3 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Nome no cartão</label>
              <input
                type="text"
                value={cardPayment.holderName}
                onChange={(event) => setCardPayment((current) => ({ ...current, holderName: event.target.value }))}
                placeholder="Nome no cartão"
                className="h-11 w-full rounded-xl border-2 border-gray-200 bg-white px-3 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Validade</label>
                <input
                  type="text"
                  value={cardPayment.expiry}
                  onChange={(event) => setCardPayment((current) => ({ ...current, expiry: event.target.value }))}
                  placeholder="MM/AA"
                  className="h-11 w-full rounded-xl border-2 border-gray-200 bg-white px-3 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">CVV</label>
                <input
                  type="text"
                  value={cardPayment.cvv}
                  onChange={(event) => setCardPayment((current) => ({ ...current, cvv: event.target.value }))}
                  placeholder="CVV"
                  className="h-11 w-full rounded-xl border-2 border-gray-200 bg-white px-3 text-sm outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            void handleRetryCheckout();
          }}
          disabled={loading}
          className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <LoadingBall size="sm" />
              Iniciando checkout
            </span>
          ) : (
            "Tentar novamente"
          )}
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
