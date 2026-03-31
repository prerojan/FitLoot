import { useEffect, useMemo, useRef, useState } from "react";
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
import LoadingBall from "@/react-app/components/LoadingBall";
import PaymentStatusPopup from "@/react-app/components/PaymentStatusPopup";
import { AuthThemeHeader } from "@/react-app/theme/AuthThemeHeader";
import { Input } from "@/react-app/components/ui/input";
import { ROUTE_PATHS } from "@/react-app/auth/constants";
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
import { useAuth } from "@/react-app/auth/context";
import { useTheme } from "@/react-app/contexts/theme";
import { hasPlanAccess } from "@/react-app/services/authService";
import { api } from "@/react-app/utils/api";
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  type OnboardingDraft,
} from "@/react-app/utils/onboardingDraft";
import { queueActivationNotice } from "@/react-app/utils/activationNotice";

type CheckoutFlowResponse = {
  checkout_status?: "pending" | "vip_active" | undefined;
  plan_status?: "pending" | "active" | "cancelled" | "failed" | "expired" | undefined;
  checkout_url?: string | null | undefined;
  message?: string | undefined;
  error?: string | undefined;
};

type PromoCodeEffect =
  | "activate_vip"
  | "discount_percent"
  | "discount_fixed"
  | "free_months"
  | "unlock_feature";

type PromoValidationStatus = "idle" | "loading" | "valid" | "invalid";

type PromoValidationResponse = {
  valid?: boolean | undefined;
  description?: string | undefined;
  effect?: PromoCodeEffect | undefined;
  effect_value?: string | null | undefined;
  message?: string | undefined;
};

type PromoValidationResult = {
  code: string;
  description: string;
  effect: PromoCodeEffect;
  effectValue: string | null;
  benefitLabel: string;
};

function normalizePromoCode(value: string): string {
  return value.trim();
}

function buildPromoBenefitLabel(effect: PromoCodeEffect, effectValue: string | null | undefined): string {
  const normalizedValue = typeof effectValue === "string" ? effectValue.trim() : "";

  switch (effect) {
    case "activate_vip":
      return "Ativa o plano VIP imediatamente.";
    case "discount_percent":
      return normalizedValue ? `${normalizedValue}% de desconto no checkout.` : "Desconto percentual aplicado ao checkout.";
    case "discount_fixed":
      return normalizedValue ? `Desconto fixo de ${normalizedValue} aplicado ao checkout.` : "Desconto fixo aplicado ao checkout.";
    case "free_months":
      return normalizedValue ? `${normalizedValue} mes(es) gratis liberado(s) no beneficio.` : "Meses gratis liberados no beneficio.";
    case "unlock_feature":
      return normalizedValue ? `Recurso desbloqueado: ${normalizedValue}.` : "Recurso especial desbloqueado.";
    default:
      return "Beneficio promocional validado.";
  }
}

function isVipPromoValidationMatch(
  normalizedPromoCode: string,
  promoValidationStatus: PromoValidationStatus,
  promoValidationResult: PromoValidationResult | null,
  validatedCode: string,
): boolean {
  return (
    normalizedPromoCode.length > 0 &&
    promoValidationStatus === "valid" &&
    promoValidationResult?.effect === "activate_vip" &&
    validatedCode === normalizedPromoCode
  );
}

function buildOnboardingCheckoutPayload(
  draft: OnboardingDraft,
  planId: CheckoutPlanId,
  paymentMethod: CheckoutPaymentMethod,
  promoCode: string,
) {
  // Reaproveita os dados do onboarding para iniciar o checkout final.
  const equipment = [...draft.selectedEquipment, draft.equipment].filter(Boolean).join(", ");
  const normalizedPromoCode = normalizePromoCode(promoCode);

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
    promo_code: normalizedPromoCode || undefined,
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
  const vipRedirectTimerRef = useRef<number | null>(null);
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
  const [promoCode, setPromoCode] = useState("");
  const [promoValidationStatus, setPromoValidationStatus] = useState<PromoValidationStatus>("idle");
  const [promoValidationResult, setPromoValidationResult] = useState<PromoValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vipActivationInProgress, setVipActivationInProgress] = useState(false);
  const [statusPopup, setStatusPopup] = useState<{
    title: string;
    message: string;
    badge?: string;
    tone: "success" | "warning" | "error";
  } | null>(null);
  const [onboardingDraft, setOnboardingDraft] = useState<OnboardingDraft | null>(() => loadOnboardingDraft());
  const promoValidationRequestIdRef = useRef(0);
  const promoValidationCodeRef = useRef("");
  const promoValidationPromiseRef = useRef<Promise<PromoValidationResult | null> | null>(null);

  const selectedPlan = useMemo(() => getCheckoutPlan(planId), [planId]);
  const pricing = useMemo(() => getPlanPricing(planId, billingCycle), [planId, billingCycle]);
  const checkoutPlansInDisplayOrder = useMemo(
    () =>
      CHECKOUT_PLAN_DISPLAY_ORDER
        .map((currentPlanId) => CHECKOUT_PLANS.find((plan) => plan.id === currentPlanId))
        .filter((plan): plan is (typeof CHECKOUT_PLANS)[number] => Boolean(plan)),
    [],
  );
  const normalizedPromoCode = normalizePromoCode(promoCode);
  const isVipPromoValidated = isVipPromoValidationMatch(
    normalizedPromoCode,
    promoValidationStatus,
    promoValidationResult,
    promoValidationCodeRef.current,
  );

  useEffect(() => {
    // Redireciona usuarios que ja possuem acesso ou pagamento pendente.
    if (!user) return;
    if (vipActivationInProgress) return;
    if (hasPlanAccess(user)) {
      clearOnboardingDraft();
      setOnboardingDraft(null);
      navigate(ROUTE_PATHS.home, { replace: true });
      return;
    }
    if (user.plan_status === "pending") {
      navigate(ROUTE_PATHS.paymentPending, { replace: true });
    }
  }, [navigate, user, vipActivationInProgress]);

  useEffect(() => {
    return () => {
      if (vipRedirectTimerRef.current !== null) {
        window.clearTimeout(vipRedirectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!requiresOnboardingCheckout) return;

    const refreshDraft = () => {
      setOnboardingDraft(loadOnboardingDraft());
    };

    refreshDraft();
    window.addEventListener("focus", refreshDraft);
    window.addEventListener("storage", refreshDraft);

    return () => {
      window.removeEventListener("focus", refreshDraft);
      window.removeEventListener("storage", refreshDraft);
    };
  }, [requiresOnboardingCheckout]);

  useEffect(() => {
    if (!requiresOnboardingCheckout) return;

    if (!onboardingDraft) {
      setError("Nao encontramos os dados do onboarding. Saia e recomece a criacao da conta.");
      return;
    }

    setError((currentError) =>
      currentError === "Nao encontramos os dados do onboarding. Saia e recomece a criacao da conta."
        ? null
        : currentError,
    );
  }, [onboardingDraft, requiresOnboardingCheckout]);

  const handleLogoutAndReset = async () => {
    try {
      await api("/api/logout");
    } catch {
      // A limpeza local ainda precisa acontecer.
    } finally {
      clearOnboardingDraft();
      setOnboardingDraft(null);
      logout();
      navigate(ROUTE_PATHS.login, { replace: true });
    }
  };

  const resetPromoValidationState = () => {
    setPromoValidationStatus("idle");
    setPromoValidationResult(null);
    promoValidationCodeRef.current = "";
    promoValidationPromiseRef.current = null;
  };

  const validatePromoCode = async (
    rawCode = promoCode,
    options?: { force?: boolean },
  ): Promise<PromoValidationResult | null> => {
    // Valida e memoriza o ultimo codigo promocional consultado.
    const normalizedCode = normalizePromoCode(rawCode);

    if (!normalizedCode) {
      resetPromoValidationState();
      return null;
    }

    if (!options?.force && promoValidationCodeRef.current === normalizedCode) {
      if (promoValidationStatus === "valid") {
        return promoValidationResult;
      }
      if (promoValidationStatus === "invalid") {
        return null;
      }
      if (promoValidationStatus === "loading" && promoValidationPromiseRef.current) {
        return promoValidationPromiseRef.current;
      }
    }

    promoValidationCodeRef.current = normalizedCode;
    setPromoValidationStatus("loading");
    setPromoValidationResult(null);

    const requestId = ++promoValidationRequestIdRef.current;
    const validationPromise = (async () => {
      try {
        const response = await api("/api/promo/validate", {
          method: "POST",
          body: JSON.stringify({ code: normalizedCode }),
        });
        const payload = (await response.json().catch(() => null)) as PromoValidationResponse | null;
        const promoDescription = typeof payload?.description === "string" ? payload.description.trim() : "";
        const promoEffect = payload?.effect;
        const isValidResponse =
          response.ok &&
          payload?.valid === true &&
          promoDescription.length > 0 &&
          typeof promoEffect === "string";

        if (requestId !== promoValidationRequestIdRef.current) {
          return isValidResponse
            ? {
                code: normalizedCode,
                description: promoDescription,
                effect: promoEffect,
                effectValue: typeof payload.effect_value === "string" ? payload.effect_value : null,
                benefitLabel: buildPromoBenefitLabel(promoEffect, payload.effect_value),
              }
            : null;
        }

        if (isValidResponse) {
          const result: PromoValidationResult = {
            code: normalizedCode,
            description: promoDescription,
            effect: promoEffect,
            effectValue: typeof payload.effect_value === "string" ? payload.effect_value : null,
            benefitLabel: buildPromoBenefitLabel(promoEffect, payload.effect_value),
          };
          setPromoValidationStatus("valid");
          setPromoValidationResult(result);
          return result;
        }

        setPromoValidationStatus("invalid");
        setPromoValidationResult(null);
        return null;
      } catch {
        if (requestId === promoValidationRequestIdRef.current) {
          setPromoValidationStatus("invalid");
          setPromoValidationResult(null);
        }
        return null;
      } finally {
        if (requestId === promoValidationRequestIdRef.current) {
          promoValidationPromiseRef.current = null;
        }
      }
    })();

    promoValidationPromiseRef.current = validationPromise;
    return validationPromise;
  };

  const handleCheckout = async () => {
    setError(null);
    const currentOnboardingDraft = requiresOnboardingCheckout ? loadOnboardingDraft() : null;

    if (requiresOnboardingCheckout) {
      setOnboardingDraft(currentOnboardingDraft);
    }

    if (requiresOnboardingCheckout && !currentOnboardingDraft) {
      setError("Nao encontramos os dados do onboarding. Saia e recomece a criacao da conta.");
      return;
    }

    const normalizedPromoCodeForRequest = normalizePromoCode(promoCode);
    let shouldActivateVipFlow = false;

    if (normalizedPromoCodeForRequest) {
      const promoValidation = await validatePromoCode(normalizedPromoCodeForRequest, {
        force: promoValidationStatus !== "valid" || promoValidationCodeRef.current !== normalizedPromoCodeForRequest,
      });

      if (!promoValidation) {
        return;
      }
      shouldActivateVipFlow = promoValidation.effect === "activate_vip";
    }

    setLoading(true);
    try {
      const completeVipActivation = async (message?: string) => {
        const activationTitle = requiresOnboardingCheckout
          ? "Conta criada com sucesso"
          : "VIP ativado com sucesso";
        const activationMessage =
          message ??
          (requiresOnboardingCheckout
            ? "Sua conta foi criada e o VIP foi ativado. Voce sera direcionado para a Home."
            : "Seu VIP foi ativado. Voce sera direcionado para a Home.");

        clearOnboardingDraft();
        setOnboardingDraft(null);
        setVipActivationInProgress(true);
        setStatusPopup({
          title: activationTitle,
          message: activationMessage,
          badge: "VIP ativo",
          tone: "success",
        });
        queueActivationNotice({
          title: activationTitle,
          message: activationMessage,
          badge: "VIP ativo",
          tone: "success",
        });
        await checkAuth();
        if (vipRedirectTimerRef.current !== null) {
          window.clearTimeout(vipRedirectTimerRef.current);
        }
        vipRedirectTimerRef.current = window.setTimeout(() => {
          setVipActivationInProgress(false);
          navigate(ROUTE_PATHS.home, { replace: true });
        }, 1500);
      };

      const endpoint = requiresOnboardingCheckout ? "/api/onboarding" : "/api/checkout/start";
      const payloadBody = requiresOnboardingCheckout && currentOnboardingDraft
        ? buildOnboardingCheckoutPayload(currentOnboardingDraft, planId, paymentMethod, normalizedPromoCodeForRequest)
        : {
            plan_id: planId,
            payment_method: paymentMethod,
            promo_code: normalizedPromoCodeForRequest || undefined,
          };

      const response = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payloadBody),
      });

      if (response.status === 401 || response.status === 403) {
        navigate(ROUTE_PATHS.app, { replace: true });
        return;
      }

      const payload = (await response.json().catch(() => null)) as CheckoutFlowResponse | null;
      if (!response.ok) {
        setError(payload?.error ?? "Nao foi possivel iniciar o checkout.");
        return;
      }

      if (payload?.checkout_status === "vip_active") {
        await completeVipActivation(payload?.message);
        return;
      }

      if (shouldActivateVipFlow) {
        if (payload?.plan_status === "active") {
          await completeVipActivation("Plano VIP ativado. Voce sera direcionado para a Home.");
          return;
        }
        setError("Codigo VIP validado, mas a ativacao nao foi concluida. Tente novamente.");
        return;
      }

      await checkAuth();

      if (payload?.plan_status === "active") {
        clearOnboardingDraft();
        setOnboardingDraft(null);
        navigate(ROUTE_PATHS.home, { replace: true });
        return;
      }

      const checkoutUrl =
        (typeof payload?.checkout_url === "string" && payload.checkout_url) ||
        selectedPlan.checkoutUrl;

      if (!checkoutUrl) {
        setError("Nao foi possivel obter a URL de checkout da Cakto.");
        return;
      }

      window.location.assign(checkoutUrl);
    } catch {
      setError(
        shouldActivateVipFlow
          ? "Nao foi possivel confirmar a ativacao VIP agora. Se necessario, acesse /home e faca login para continuar."
          : "Erro de conexao ao iniciar o checkout.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fl-auth-page fl-auth-funnel-page">
      {/* Backdrop tematico do checkout. */}
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
              {/* Introducao do plano e contexto do fluxo. */}
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

              {/* Seletor de ciclo de cobranca. */}
              <div className="flex justify-center">
                <BillingCycleSwitch value={billingCycle} onChange={setBillingCycle} />
              </div>

              {/* Grade de planos disponiveis. */}
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

              {/* Blocos de pagamento, promocao e resumo final. */}
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
                    {/* Contexto do metodo e validacao do codigo promocional. */}
                    <div className="rounded-[1.5rem] border border-[var(--fl-auth-card-border)] bg-[rgba(var(--fl-color-accent-rgb),0.08)] p-5 text-sm text-[var(--fl-auth-muted)]">
                      {isVipPromoValidated
                        ? "Codigo VIP validado: o checkout da Cakto sera ignorado e sua conta sera ativada automaticamente."
                        : paymentMethod === "pix"
                          ? "O checkout Cakto sera aberto com o plano selecionado para concluir o PIX fora do app."
                          : "O checkout Cakto sera aberto com o plano selecionado para concluir o pagamento com cartao fora do app."}
                    </div>

                    <div className="space-y-3">
                      <label className="block space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--fl-auth-subtle)]">
                            Código Promocional
                          </span>
                          <span className="text-xs text-[var(--fl-auth-subtle)]">Opcional</span>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <Input
                            value={promoCode}
                            onBlur={() => {
                              void validatePromoCode();
                            }}
                            onChange={(event) => {
                              const nextPromoCode = event.target.value;
                              const normalizedNextPromoCode = normalizePromoCode(nextPromoCode);

                              setPromoCode(nextPromoCode);

                              if (!normalizedNextPromoCode) {
                                resetPromoValidationState();
                                return;
                              }

                              if (normalizedNextPromoCode !== promoValidationCodeRef.current) {
                                setPromoValidationStatus("idle");
                                setPromoValidationResult(null);
                              }
                            }}
                            type="text"
                            autoComplete="off"
                            maxLength={128}
                            placeholder="Insira seu código"
                            className="h-12 rounded-[1.2rem] border-[var(--fl-auth-input-border)] bg-[var(--fl-auth-input-bg)] px-4 text-[var(--fl-auth-ink)] placeholder:text-[var(--fl-auth-subtle)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void validatePromoCode(promoCode, { force: true });
                            }}
                            disabled={promoValidationStatus === "loading"}
                            className="h-12 rounded-[1.2rem] border border-[var(--fl-auth-card-border)] px-5 text-sm font-semibold text-[var(--fl-auth-ink)] transition hover:bg-[rgba(var(--fl-color-accent-rgb),0.08)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Aplicar
                          </button>
                        </div>
                      </label>

                      {promoValidationStatus === "loading" ? (
                        <div className="flex items-center gap-2 text-sm text-[var(--fl-auth-muted)]">
                          <LoadingBall size="sm" />
                          <span>Validando código...</span>
                        </div>
                      ) : null}

                      {promoValidationStatus === "valid" && promoValidationResult ? (
                        <div className="rounded-[1.2rem] border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                          <p className="font-semibold">{promoValidationResult.description}</p>
                          <p className="mt-1 text-emerald-300">{promoValidationResult.benefitLabel}</p>
                          {promoValidationResult.effect === "activate_vip" ? (
                            <span className="mt-2 inline-flex rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                              VIP ativo imediato
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {promoValidationStatus === "invalid" ? (
                        <p className="text-sm text-red-500">Código inválido</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="rounded-[2rem] border border-[var(--fl-auth-card-border)] bg-[var(--fl-auth-surface)] p-6">
                  <div className="space-y-4">
                    {/* Resumo final antes de abrir o checkout externo. */}
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
                        ? isVipPromoValidated
                          ? "Ativando VIP..."
                          : "Abrindo checkout..."
                        : isVipPromoValidated
                          ? requiresOnboardingCheckout
                            ? "Concluir onboarding e ativar VIP"
                            : "Ativar VIP e ir para Home"
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
      <PaymentStatusPopup
        open={statusPopup !== null}
        title={statusPopup?.title ?? ""}
        message={statusPopup?.message ?? ""}
        badge={statusPopup?.badge}
        tone={statusPopup?.tone ?? "warning"}
        onClose={() => setStatusPopup(null)}
      />
    </div>
  );
}
