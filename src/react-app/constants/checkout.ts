export type CheckoutPlanId = "basic" | "pro" | "annual";
export type BillingCycle = "monthly" | "annual";
export type CheckoutPaymentMethod = "card" | "pix";

export const ANNUAL_DISCOUNT_RATE = 0.1;

export const CHECKOUT_PLANS = [
  {
    id: "basic" as const,
    name: "Basico",
    monthlyPriceCents: 4900,
    checkoutUrl: "https://pay.cakto.com.br/gwr6dcu",
    recommended: false,
    benefits: [
      "Missoes diarias",
      "Evolucao de atributos",
      "Sistema de XP e niveis",
      "Streaks e multiplicadores",
      "Ranking basico",
    ],
  },
  {
    id: "pro" as const,
    name: "Premium",
    monthlyPriceCents: 9900,
    checkoutUrl: "https://pay.cakto.com.br/m955o3f",
    recommended: true,
    benefits: [
      "Tudo do Basico",
      "Missoes semanais e mensais",
      "Scanner de alimentos com IA",
      "Ranking global e local",
      "Loja de cupons fitness",
      "Sistema de amigos",
      "Mini-games e desafios",
    ],
  },
  {
    id: "annual" as const,
    name: "Elite",
    monthlyPriceCents: 14900,
    checkoutUrl: "https://pay.cakto.com.br/k9c5935",
    recommended: false,
    benefits: [
      "Tudo do Premium",
      "Planos personalizados de treino",
      "Planos personalizados de nutricao",
      "Habilidades avancadas de calistenia",
      "Animacoes premium de progressao",
      "Suporte VIP prioritario",
      "Personalizacao total do perfil",
    ],
  },
] as const;

export const CHECKOUT_PLAN_DISPLAY_ORDER: CheckoutPlanId[] = ["basic", "annual", "pro"];

export function getCheckoutPlan(planId: CheckoutPlanId) {
  return CHECKOUT_PLANS.find((plan) => plan.id === planId) ?? CHECKOUT_PLANS[0];
}

export function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function getPlanPricing(planId: CheckoutPlanId, billingCycle: BillingCycle) {
  const plan = getCheckoutPlan(planId);
  const annualBaseTotalCents = plan.monthlyPriceCents * 12;
  const annualDiscountedTotalCents = Math.round(annualBaseTotalCents * (1 - ANNUAL_DISCOUNT_RATE));
  const annualDiscountedMonthlyCents = Math.round(annualDiscountedTotalCents / 12);
  const annualSavingsCents = annualBaseTotalCents - annualDiscountedTotalCents;

  return {
    plan,
    billingCycle,
    monthlyPriceCents: plan.monthlyPriceCents,
    annualBaseTotalCents,
    annualDiscountedTotalCents,
    annualDiscountedMonthlyCents,
    annualSavingsCents,
    priceLabel:
      billingCycle === "monthly"
        ? `${formatCurrency(plan.monthlyPriceCents)}/mes`
        : `${formatCurrency(annualDiscountedMonthlyCents)}/mes`,
  };
}
