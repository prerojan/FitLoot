import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CreditCard,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import BillingCycleSwitch from "@/react-app/components/BillingCycleSwitch";
import { AuthThemeHeader } from "@/react-app/components/AuthThemeHeader";
import { Input } from "@/react-app/components/ui/input";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import {
  CHECKOUT_PLAN_DISPLAY_ORDER,
  CHECKOUT_PLANS,
  formatCurrency,
  getCheckoutPlan,
  getPlanPricing,
  type BillingCycle,
  type CheckoutPaymentMethod,
  type CheckoutPlanId,
} from "@/react-app/constants/checkout";
import { useAuth } from "@/react-app/contexts/auth";
import { useTheme } from "@/react-app/contexts/theme";
import { hasPlanAccess } from "@/react-app/services/authService";
import { api } from "@/react-app/utils/api";
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  type OnboardingDraft,
} from "@/react-app/utils/onboardingDraft";

type CheckoutFlowResponse = {
  checkout_status?: "pending" | "vip_active" | undefined;
  plan_status?: "pending" | "active" | "cancelled" | "failed" | "expired" | undefined;
  checkout_url?: string | null | undefined;
  message?: string | undefined;
  error?: string | undefined;
};

function buildOnboardingCheckoutPayload(
  draft: OnboardingDraft,
  planId: CheckoutPlanId,
  paymentMethod: CheckoutPaymentMethod,
  cardCvv: string,
) {
  const equipment = [...draft.selectedEquipment, draft.equipment].filter(Boolean).join(", ");

  return {
    username: draft.username.trim(),
    full_name: draft.full_name.trim(),
    weight: Number(draft.weight),
    height: Number(draft.height),
    age: Number(draft.age),
    gender: draft.gender,
    initial_conditioning: draft.initial_conditioning,
    initial_pushups: Number(draft.initial_pushups) || 0,
    initial_situps: Number(draft.initial_situps) || 0,
    initial_squats: Number(draft.initial_squats) || 0,
    injuries: draft.injuries || undefined,
    equipment: equipment || undefined,
    main_goal: draft.main_goal,
    goals: [draft.main_goal],
    training_frequency: draft.weeklyFrequency,
    plan_id: planId,
    payment_method: paymentMethod,
    card_cvv: paymentMethod === "card" && cardCvv.trim() ? cardCvv.trim() : undefined,
  };
}

function hasStartedCheckoutFlow(user: {
  plan_id: "basic" | "pro" | "annual" | "vip";
  plan_status: "pending" | "active" | "cancelled" | "failed" | "expired";
  payment_method: "none" | "card" | "pix";
} | null): boolean {
  if (!user) return false;
  return user.plan_status === "pending" || user.plan_id !== "basic" || user.payment_method !== "none";
}

function PlanCard({
  planId,
  selected,
  billingCycle,
  onSelect,
}: {
  planId: CheckoutPlanId;
  selected: boolean;
  billingCycle: BillingCycle;
  onSelect: (planId: CheckoutPlanId) => void;
}) {
  const { plan, monthlyPriceCents, annualDiscountedMonthlyCents, annualDiscountedTotalCents, annualSavingsCents } =
    getPlanPricing(planId, billingCycle);

  return (
    <button
      type="button"
      onClick={() => onSelect(planId)}
      className={`relative rounded-[2rem] border p-6 text-left transition ${
        selected
          ? "border-[var(--app-primary-color)] bg-[rgba(var(--fl-color-accent-rgb),0.12)] shadow-[0_24px_64px_-32px_rgba(16,185,129,0.8)]"
          : "border-[var(--fl-auth-card-border)] bg-[var(--fl-auth-panel)]"
      }`}
    >
      {plan.recommended ? (
        <span className="absolute right-5 top-5 rounded-full bg-[var(--app-primary-color)] px-4 py-1 text-[10px] font-bold uppercase tracking-[0.26em] text-black">
          Mais popular
        </span>
      ) : null}

      <div className="space-y-4">
        <div>
          <p className={`text-3xl font-bold tracking-tight ${selected ? "text-[var(--app-primary-color)]" : "text-[var(--fl-auth-ink)]"}`}>
            {plan.name}
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {billingCycle === "annual" ? (
              <>
                <span className="text-sm text-[var(--fl-auth-subtle)] line-through">{formatCurrency(monthlyPriceCents)}/mes</span>
                <span className="text-4xl font-black text-[var(--fl-auth-ink)]">{formatCurrency(annualDiscountedMonthlyCents)}</span>
                <span className="pb-1 text-lg text-[var(--fl-auth-subtle)]">/mes</span>
              </>
            ) : (
              <>
                <span className="text-4xl font-black text-[var(--fl-auth-ink)]">{formatCurrency(monthlyPriceCents)}</span>
                <span className="pb-1 text-lg text-[var(--fl-auth-subtle)]">/mes</span>
              </>
            )}
          </div>
          {billingCycle === "annual" ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-[var(--app-primary-color)]/45 bg-[rgba(var(--fl-color-accent-rgb),0.12)] px-3 py-1 text-xs font-semibold text-[var(--app-primary-color)]">
                  10% OFF
                </span>
                <span className="rounded-full bg-[var(--app-primary-color)] px-3 py-1 text-xs font-bold text-black">
                  1 mes gratis
                </span>
              </div>
              <p className="text-sm text-[var(--app-primary-color)]">
                {formatCurrency(annualDiscountedTotalCents)}/ano com economia total de {formatCurrency(annualSavingsCents)}.
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 border-t border-[var(--fl-auth-card-border)] pt-5">
          {plan.benefits.map((benefit) => (
            <div key={benefit} className="flex items-start gap-3 text-sm text-[var(--fl-auth-muted)]">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(var(--fl-color-accent-rgb),0.14)] text-[var(--app-primary-color)]">
                <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
              </span>
              <span>{benefit}</span>
            </div>
          ))}
        </div>
      </div>
    </button>
  );
}

export default function Checkout() {
  const navigate = useNavigate();
  const { user, checkAuth, logout } = useAuth();
  const { themeMode, toggleThemeMode } = useTheme();
  const requiresOnboardingCheckout = user ? !hasStartedCheckoutFlow(user) && user.onboarding_completed !== 1 : false;
  const [planId, setPlanId] = useState<CheckoutPlanId>(
    requiresOnboardingCheckout
      ? "pro"
      : user?.plan_id === "basic" || user?.plan_id === "pro" || user?.plan_id === "annual"
        ? user.plan_id
        : "pro",
  );
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>("pix");
  const [cardCvv, setCardCvv] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onboardingDraft = useMemo(() => loadOnboardingDraft(), []);

  const selectedPlan = useMemo(() => getCheckoutPlan(planId), [planId]);
  const pricing = useMemo(() => getPlanPricing(planId, billingCycle), [planId, billingCycle]);
  const checkoutPlansInDisplayOrder = useMemo(
    () =>
      CHECKOUT_PLAN_DISPLAY_ORDER
        .map((currentPlanId) => CHECKOUT_PLANS.find((plan) => plan.id === currentPlanId))
        .filter((plan): plan is (typeof CHECKOUT_PLANS)[number] => Boolean(plan)),
    [],
  );

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

  useEffect(() => {
    if (requiresOnboardingCheckout && !onboardingDraft) {
      setError("Nao encontramos os dados do onboarding. Saia e recomece a criacao da conta.");
    }
  }, [onboardingDraft, requiresOnboardingCheckout]);

  const handleLogoutAndReset = async () => {
    try {
      await api("/api/logout");
    } catch {
      // Local cleanup still needs to happen.
    } finally {
      clearOnboardingDraft();
      logout();
      navigate(ROUTE_PATHS.login, { replace: true });
    }
  };

  const handleCheckout = async () => {
    setError(null);

    if (requiresOnboardingCheckout && !onboardingDraft) {
      setError("Nao encontramos os dados do onboarding. Saia e recomece a criacao da conta.");
      return;
    }

    const checkoutWindow = window.open("about:blank", "_blank");
    if (checkoutWindow) {
      try {
        checkoutWindow.opener = null;
      } catch {
        // Browsers may block access to opener assignment.
      }
    }

    setLoading(true);
    try {
      const endpoint = requiresOnboardingCheckout ? "/api/onboarding" : "/api/checkout/start";
      const payloadBody = requiresOnboardingCheckout && onboardingDraft
        ? buildOnboardingCheckoutPayload(onboardingDraft, planId, paymentMethod, cardCvv)
        : {
            plan_id: planId,
            payment_method: paymentMethod,
            card_cvv: paymentMethod === "card" && cardCvv.trim() ? cardCvv.trim() : undefined,
          };

      const response = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payloadBody),
      });

      if (response.status === 401 || response.status === 403) {
        if (checkoutWindow && !checkoutWindow.closed) {
          checkoutWindow.close();
        }
        navigate(ROUTE_PATHS.app, { replace: true });
        return;
      }

      const payload = (await response.json().catch(() => null)) as CheckoutFlowResponse | null;
      if (!response.ok) {
        if (checkoutWindow && !checkoutWindow.closed) {
          checkoutWindow.close();
        }
        setError(payload?.error ?? "Nao foi possivel iniciar o checkout.");
        return;
      }

      if (requiresOnboardingCheckout) {
        clearOnboardingDraft();
      }

      await checkAuth();

      if (payload?.checkout_status === "vip_active" || payload?.plan_status === "active") {
        if (checkoutWindow && !checkoutWindow.closed) {
          checkoutWindow.close();
        }
        navigate(ROUTE_PATHS.home, { replace: true });
        return;
      }

      const checkoutUrl =
        (typeof payload?.checkout_url === "string" && payload.checkout_url) ||
        selectedPlan.checkoutUrl;

      if (checkoutUrl) {
        if (checkoutWindow && !checkoutWindow.closed) {
          checkoutWindow.location.replace(checkoutUrl);
        } else {
          window.location.assign(checkoutUrl);
          return;
        }
      }

      navigate(ROUTE_PATHS.paymentPending, { replace: true });
    } catch {
      if (checkoutWindow && !checkoutWindow.closed) {
        checkoutWindow.close();
      }
      setError("Erro de conexao ao iniciar o checkout.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fl-auth-page fl-auth-funnel-page">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-[var(--fl-auth-primary-soft)] blur-3xl" />
        <div className="absolute right-[-4rem] top-[18%] h-96 w-96 rounded-full bg-[var(--fl-auth-secondary-soft)] blur-3xl" />
        <div className="absolute bottom-[-10rem] left-1/3 h-80 w-80 rounded-full bg-[var(--fl-auth-primary-soft)] blur-[120px]" />
      </div>

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <AuthThemeHeader colorScheme={themeMode} onToggleColorScheme={toggleThemeMode} />

        <main className="flex flex-1 items-center justify-center py-4 lg:py-8">
          <div className="w-full rounded-[2.4rem] border border-[var(--fl-auth-card-border)] bg-[var(--fl-auth-panel)] p-6 shadow-[0_32px_90px_-48px_rgba(16,185,129,0.45)] sm:p-8 lg:p-10">
            <div className="mx-auto max-w-5xl space-y-8">
              <div className="space-y-5 text-center">
                <span className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--app-primary-color)]/35 bg-[rgba(var(--fl-color-accent-rgb),0.12)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.26em] text-[var(--app-primary-color)]">
                  <Sparkles className="h-4 w-4" />
                  Escolha seu plano de batalha
                </span>
                <div className="space-y-3">
                  <h1 className="text-4xl font-black tracking-tight text-[var(--fl-auth-ink)] sm:text-5xl lg:text-6xl">
                    Escolha o plano que acompanha sua evolucao.
                  </h1>
                  <p className="mx-auto max-w-3xl text-base leading-7 text-[var(--fl-auth-muted)] sm:text-lg">
                    {requiresOnboardingCheckout
                      ? "Sua conta ja foi criada. Agora escolha o plano, o modo de cobranca e finalize com PIX ou cartao."
                      : "Escolha o nivel, o modo de cobranca e finalize com PIX ou cartao."}
                  </p>
                </div>
              </div>

              <div className="flex justify-center">
                <BillingCycleSwitch value={billingCycle} onChange={setBillingCycle} />
              </div>

              <div className="grid gap-5 lg:grid-cols-3">
                {checkoutPlansInDisplayOrder.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    planId={plan.id}
                    selected={planId === plan.id}
                    billingCycle={billingCycle}
                    onSelect={setPlanId}
                  />
                ))}
              </div>

              <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                <div className="rounded-[2rem] border border-[var(--fl-auth-card-border)] bg-[var(--fl-auth-surface)] p-6">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">
                      Metodo de pagamento
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {([
                        { id: "pix", label: "PIX", description: "5% de desconto no provedor e fluxo simples.", icon: QrCode },
                        { id: "card", label: "Cartao de credito", description: "Parcelamento e aprovacao via operadora.", icon: CreditCard },
                      ] as const).map((option) => {
                        const Icon = option.icon;
                        const active = paymentMethod === option.id;

                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setPaymentMethod(option.id)}
                            className={`rounded-[1.5rem] border p-4 text-left transition ${
                              active
                                ? "border-[var(--app-primary-color)] bg-[rgba(var(--fl-color-accent-rgb),0.12)]"
                                : "border-[var(--fl-auth-card-border)] bg-transparent"
                            }`}
                          >
                            <div className="flex items-start gap-4">
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(var(--fl-color-accent-rgb),0.14)] text-[var(--app-primary-color)]">
                                <Icon className="h-5 w-5" strokeWidth={2.2} />
                              </div>
                              <div className="space-y-1">
                                <p className="font-bold text-[var(--fl-auth-ink)]">{option.label}</p>
                                <p className="text-sm leading-6 text-[var(--fl-auth-muted)]">{option.description}</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div className="rounded-[1.5rem] border border-[var(--fl-auth-card-border)] bg-[rgba(var(--fl-color-accent-rgb),0.08)] p-5 text-sm text-[var(--fl-auth-muted)]">
                      {paymentMethod === "pix"
                        ? "O checkout Cakto sera aberto com o plano selecionado para concluir o PIX fora do app."
                        : "O checkout Cakto sera aberto com o plano selecionado para concluir o pagamento com cartao fora do app."}
                    </div>

                    {paymentMethod === "card" ? (
                      <label className="block space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--fl-auth-subtle)]">
                          CVV opcional
                        </span>
                        <Input
                          value={cardCvv}
                          onChange={(event) => setCardCvv(event.target.value)}
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={32}
                          placeholder="***"
                          className="h-12 rounded-[1.2rem] border-[var(--fl-auth-card-border)] bg-[var(--fl-auth-panel)] px-4 text-[var(--fl-auth-ink)] placeholder:text-[var(--fl-auth-subtle)]"
                        />
                      </label>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-[2rem] border border-[var(--fl-auth-card-border)] bg-[var(--fl-auth-surface)] p-6">
                  <div className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">
                      Resumo
                    </p>
                    <div>
                      <p className="text-3xl font-black text-[var(--fl-auth-ink)]">{selectedPlan.name}</p>
                      <p className="mt-2 text-sm text-[var(--fl-auth-muted)]">
                        {billingCycle === "annual"
                          ? `${formatCurrency(pricing.annualDiscountedTotalCents)} cobrados no anual`
                          : `${formatCurrency(pricing.monthlyPriceCents)} cobrados por mes`}
                      </p>
                    </div>

                    <div className="rounded-[1.4rem] border border-[var(--fl-auth-card-border)] bg-[var(--fl-auth-panel)] p-4">
                      <div className="flex items-center justify-between text-sm text-[var(--fl-auth-muted)]">
                        <span>Modo</span>
                        <span className="font-semibold text-[var(--fl-auth-ink)]">
                          {billingCycle === "annual" ? "Anual com desconto" : "Mensal"}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-sm text-[var(--fl-auth-muted)]">
                        <span>Metodo</span>
                        <span className="font-semibold text-[var(--fl-auth-ink)]">
                          {paymentMethod === "pix" ? "PIX" : "Cartao"}
                        </span>
                      </div>
                      {billingCycle === "annual" ? (
                        <div className="mt-3 flex items-center justify-between text-sm text-[var(--fl-auth-muted)]">
                          <span>Economia anual</span>
                          <span className="font-semibold text-[var(--app-primary-color)]">
                            {formatCurrency(pricing.annualSavingsCents)}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {error ? (
                      <div className="rounded-[1.2rem] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
                        {error}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => {
                        void handleCheckout();
                      }}
                      disabled={loading || (requiresOnboardingCheckout && !onboardingDraft)}
                      className="flex h-14 w-full items-center justify-center gap-2 rounded-[1.2rem] bg-[var(--app-primary-color)] px-5 text-base font-black text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading
                        ? "Abrindo checkout..."
                        : requiresOnboardingCheckout
                          ? "Concluir onboarding e abrir checkout"
                          : "Continuar para o checkout"}
                      {!loading ? <ArrowRight className="h-4 w-4" /> : null}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void handleLogoutAndReset();
                      }}
                      className="w-full rounded-[1.2rem] border border-red-300/35 px-5 py-3 text-sm font-semibold text-red-400 transition hover:bg-red-500/10"
                    >
                      Sair e recomecar
                    </button>

                    <div className="grid gap-3 text-xs text-[var(--fl-auth-muted)] sm:grid-cols-3">
                      {[
                        { icon: LockKeyhole, label: "SSL criptografado" },
                        { icon: ShieldCheck, label: "Checkout seguro" },
                        { icon: BadgeCheck, label: "Satisfacao garantida" },
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <div key={item.label} className="flex items-center gap-2 rounded-full border border-[var(--fl-auth-card-border)] px-3 py-2">
                            <Icon className="h-4 w-4 text-[var(--app-primary-color)]" />
                            <span>{item.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
