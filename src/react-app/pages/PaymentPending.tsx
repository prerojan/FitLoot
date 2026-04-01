import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import PaymentStatusPopup from "@/react-app/components/PaymentStatusPopup";
import LoadingBall from "@/react-app/components/LoadingBall";
import { ROUTE_PATHS } from "@/react-app/auth/constants";
import { useAuth } from "@/react-app/auth/context";
import { hasPlanAccess } from "@/react-app/services/authService";
import { api } from "@/react-app/utils/api";
import {
  completeActivationAndReturnToLogin,
  resolveActivationCompletionCopy,
} from "@/react-app/utils/activationCompletion";
import { clearOnboardingDraft } from "@/react-app/utils/onboardingDraft";

type PaymentMethod = "none" | "card" | "pix";

type SubscriptionStatusPayload = {
  plan_id: "basic" | "pro" | "annual" | "vip";
  plan_status: "pending" | "active" | "cancelled" | "failed" | "expired";
  payment_method: PaymentMethod;
  amount: number;
  has_access?: boolean | undefined;
  checkout_url?: string | null | undefined;
};

type VerifyStatusOptions = {
  silent?: boolean;
  resetBackoff?: boolean;
};

const STATUS_BACKOFF_SCHEDULE_MS = [5_000, 8_000, 12_000, 18_000, 30_000, 45_000] as const;

const METHOD_HELP: Record<Exclude<PaymentMethod, "none">, string> = {
  card: "A aprovacao do cartao pode levar alguns instantes. Voce pode aguardar a verificacao automatica ou conferir manualmente.",
  pix: "Conclua o pagamento no app do seu banco. Assim que a Cakto confirmar o PIX, seu acesso sera liberado.",
};

function formatAmount(amountInCents: number | null): string | null {
  if (amountInCents === null || !Number.isFinite(amountInCents)) return null;
  return (amountInCents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export default function PaymentPending() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const pollTimerRef = useRef<number | null>(null);
  const pollAttemptRef = useRef(0);
  const verifyStatusRef = useRef<(options?: VerifyStatusOptions) => Promise<void>>(async () => undefined);

  const [checking, setChecking] = useState(false);
  const [autoChecking, setAutoChecking] = useState(false);
  const [lastAmount, setLastAmount] = useState<number | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [activationCompletionInProgress, setActivationCompletionInProgress] = useState(false);
  const [statusPopup, setStatusPopup] = useState<{
    title: string;
    message: string;
    badge?: string;
    tone: "success" | "warning" | "error";
    actionLabel?: string;
    onAction?: (() => void) | undefined;
  } | null>(null);

  const clearScheduledPoll = useCallback(() => {
    // Cancela o timer atual antes de reagendar qualquer consulta.
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const scheduleNextPoll = useCallback(() => {
    // Aplica backoff progressivo entre as verificacoes automaticas.
    clearScheduledPoll();
    const delayIndex = Math.min(pollAttemptRef.current, STATUS_BACKOFF_SCHEDULE_MS.length - 1);
    const delay = STATUS_BACKOFF_SCHEDULE_MS[delayIndex];
    pollAttemptRef.current = Math.min(pollAttemptRef.current + 1, STATUS_BACKOFF_SCHEDULE_MS.length - 1);
    pollTimerRef.current = window.setTimeout(() => {
      void verifyStatusRef.current({ silent: true });
    }, delay);
  }, [clearScheduledPoll]);

  useEffect(() => {
    if (!user) return;
    if (activationCompletionInProgress || activationConfirmed) return;
    if (hasPlanAccess(user)) {
      clearScheduledPoll();
      clearOnboardingDraft();
      navigate(ROUTE_PATHS.home, { replace: true });
      return;
    }
    if (user.plan_status !== "pending") {
      clearScheduledPoll();
      navigate(ROUTE_PATHS.checkout, { replace: true });
    }
  }, [activationCompletionInProgress, activationConfirmed, clearScheduledPoll, navigate, user]);

  const methodHint = useMemo(() => {
    return method === "none" ? METHOD_HELP.card : METHOD_HELP[method];
  }, [method]);

  const handleExitAndReset = async () => {
    clearScheduledPoll();
    try {
      await api("/api/logout");
    } catch {
      // Ignora falhas de rede e segue com o reset local.
    } finally {
      clearOnboardingDraft();
      logout();
      navigate(ROUTE_PATHS.login, { replace: true });
    }
  };

  const finalizeActivatedAccess = useCallback(
    async (options?: { skipDelay?: boolean }) => {
      const completionCopy = resolveActivationCompletionCopy({
        origin: user?.onboarding_completed === 1 ? "checkout" : "onboarding",
        outcome: "paid",
      });

      setActivationConfirmed(true);
      setActivationCompletionInProgress(true);
      setStatusPopup({
        title: completionCopy.localTitle,
        message: completionCopy.localMessage,
        tone: "success",
        ...(completionCopy.loginNotice.badge ? { badge: completionCopy.loginNotice.badge } : {}),
      });

      const completionResult = await completeActivationAndReturnToLogin({
        navigate,
        logout,
        notice: completionCopy.loginNotice,
        onBeforeLogout: clearScheduledPoll,
        preLogoutDelayMs: options?.skipDelay ? 0 : undefined,
      });

      if (completionResult.ok) {
        return;
      }

      setActivationCompletionInProgress(false);
      setStatusPopup({
        title: completionCopy.localTitle,
        message: completionResult.errorMessage,
        tone: "error",
        actionLabel: "Tentar encerrar sessao novamente",
        onAction: () => {
          void finalizeActivatedAccess({ skipDelay: true });
        },
        ...(completionCopy.loginNotice.badge ? { badge: completionCopy.loginNotice.badge } : {}),
      });
    },
    [clearScheduledPoll, logout, navigate, user?.onboarding_completed],
  );

  const verifyStatus = useCallback(async (options: VerifyStatusOptions = {}) => {
    // Consulta o status atual da assinatura e decide o proximo passo.
    const silent = options.silent === true;
    if (options.resetBackoff) {
      pollAttemptRef.current = 0;
    }

    clearScheduledPoll();
    if (silent) {
      setAutoChecking(true);
    } else {
      setChecking(true);
    }

    try {
      const response = await api("/api/subscription/status");
      if (response.status === 401 || response.status === 403) {
        navigate(ROUTE_PATHS.app, { replace: true });
        return;
      }

      const payload = (await response.json().catch(() => null)) as SubscriptionStatusPayload | null;
      if (!response.ok || !payload) {
        scheduleNextPoll();
        if (!silent) {
          setStatusPopup({
            title: "Falha na verificacao",
            message: "Nao foi possivel consultar o status agora. Vamos tentar novamente em instantes.",
            tone: "error",
          });
        }
        return;
      }

      if (payload.payment_method !== "none") {
        setMethod(payload.payment_method);
      }
      setLastAmount(Number.isFinite(payload.amount) ? payload.amount : null);
      setCheckoutUrl(typeof payload.checkout_url === "string" ? payload.checkout_url : null);

      if (payload.has_access) {
        await finalizeActivatedAccess({ skipDelay: silent });
        return;
      }

      if (payload.plan_status === "pending") {
        scheduleNextPoll();
        if (!silent) {
          setStatusPopup({
            title: "Pagamento ainda pendente",
            message: "Recebemos sua solicitacao e vamos continuar verificando a aprovacao automaticamente.",
            tone: "warning",
          });
        }
        return;
      }

      clearScheduledPoll();
      setStatusPopup({
        title: "Pagamento nao aprovado",
        message: "Seu pagamento foi recusado, cancelado ou expirou. Voce pode tentar novamente.",
        tone: "error",
      });
      window.setTimeout(() => {
        navigate(ROUTE_PATHS.checkout, { replace: true });
      }, 1300);
    } catch {
      scheduleNextPoll();
      if (!silent) {
        setStatusPopup({
          title: "Falha na verificacao",
          message: "Erro de conexao ao consultar o pagamento. Vamos tentar novamente automaticamente.",
          tone: "error",
        });
      }
    } finally {
      if (silent) {
        setAutoChecking(false);
      } else {
        setChecking(false);
      }
    }
  }, [clearScheduledPoll, finalizeActivatedAccess, navigate, scheduleNextPoll]);

  useEffect(() => {
    // Mantem a referencia atualizada para o polling reagendado.
    verifyStatusRef.current = verifyStatus;
  }, [verifyStatus]);

  useEffect(() => {
    // Inicia o polling automatico apenas enquanto o pagamento estiver pendente.
    if (!user || user.plan_status !== "pending" || activationCompletionInProgress || activationConfirmed) {
      clearScheduledPoll();
      return;
    }

    pollAttemptRef.current = 0;
    void verifyStatus({ silent: true, resetBackoff: true });

    return () => {
      clearScheduledPoll();
    };
  }, [activationCompletionInProgress, activationConfirmed, clearScheduledPoll, user, verifyStatus]);

  const formattedAmount = useMemo(() => formatAmount(lastAmount), [lastAmount]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 px-4 py-8">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/70 bg-white/85 p-6 shadow-xl backdrop-blur-xl md:p-8">
        {/* Status principal e instrucoes do pagamento em andamento. */}
        <h1 className="text-2xl font-bold text-gray-900">Aguardando confirmacao do pagamento</h1>
        <p className="mt-2 text-sm text-gray-600">
          Seu checkout foi iniciado e o sistema esta consultando a Cakto com backoff para liberar o acesso assim que o pagamento for aprovado.
        </p>

        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {methodHint}
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
          {(autoChecking || checking) ? <LoadingBall size="sm" /> : null}
          <span>
            {checking
              ? "Conferindo status manualmente..."
              : autoChecking
                ? "Verificacao automatica em andamento..."
                : "Verificacao automatica ativa com intervalo progressivo."}
          </span>
        </div>

        <ul className="mt-5 list-disc space-y-2 pl-5 text-sm text-gray-700">
          <li>Cartao: a aprovacao depende da analise da operadora.</li>
          <li>PIX: confirme o pagamento no banco para acelerar a liberacao.</li>
        </ul>

        {formattedAmount ? (
          <p className="mt-4 text-sm font-semibold text-gray-800">
            Valor em processamento: {formattedAmount}
          </p>
        ) : null}

        {/* Acoes manuais de verificacao, retorno e reabertura do checkout. */}
        <button
          type="button"
          onClick={() => {
            if (activationConfirmed && !activationCompletionInProgress) {
              void finalizeActivatedAccess({ skipDelay: true });
              return;
            }
            void verifyStatus({ resetBackoff: true });
          }}
          disabled={checking || activationCompletionInProgress}
          className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {activationCompletionInProgress ? (
            <span className="inline-flex items-center gap-2">
              <LoadingBall size="sm" />
              Encerrando sessao para ir ao login
            </span>
          ) : activationConfirmed ? (
            "Tentar encerrar sessao novamente"
          ) : checking ? (
            <span className="inline-flex items-center gap-2">
              <LoadingBall size="sm" />
              Verificando status
            </span>
          ) : (
            "Verificar status agora"
          )}
        </button>

        <button
          type="button"
          onClick={() => navigate(ROUTE_PATHS.payment)}
          disabled={activationConfirmed || activationCompletionInProgress}
          className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Alterar pagamento
        </button>

        <button
          type="button"
          onClick={() => {
            void handleExitAndReset();
          }}
          disabled={activationConfirmed || activationCompletionInProgress}
          className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 hover:bg-red-100"
        >
          Sair e comecar do zero
        </button>

        {checkoutUrl ? (
          <button
            type="button"
            onClick={() => window.open(checkoutUrl, "_blank", "noopener,noreferrer")}
            disabled={activationConfirmed || activationCompletionInProgress}
            className="mt-3 w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            Abrir checkout novamente
          </button>
        ) : null}
      </div>

      {/* Popup de feedback para mudancas de status. */}
      <PaymentStatusPopup
        open={statusPopup !== null}
        title={statusPopup?.title ?? ""}
        message={statusPopup?.message ?? ""}
        badge={statusPopup?.badge}
        tone={statusPopup?.tone ?? "warning"}
        actionLabel={statusPopup?.actionLabel}
        onAction={statusPopup?.onAction}
        onClose={() => setStatusPopup(null)}
      />
    </div>
  );
}
