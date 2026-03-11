import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api } from "@/react-app/utils/api";
import { useAuth } from "@/react-app/App";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import { AuthThemeHeader, useAuthColorScheme } from "@/react-app/components/AuthThemeHeader";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  QrCode,
  Shield,
  Sparkles,
} from "lucide-react";

const FIELD_WRAP = "fl-auth-input-shell min-h-[3.5rem] rounded-[1.3rem]";
const FIELD_INPUT =
  "h-full w-full !border-0 !bg-transparent !p-0 text-base text-[var(--fl-auth-ink)] !shadow-none !ring-0 " +
  "placeholder:text-[var(--fl-auth-subtle)] focus-visible:!ring-0 focus-visible:!ring-offset-0";

const PLAN_OPTIONS = [
  { id: "free" as const, name: "Basico", price: "R$ 49/mes", color: "from-slate-500 to-slate-700", features: ["Missoes diarias", "XP e niveis", "Ranking"] },
  { id: "pro" as const, name: "Premium", price: "R$ 99/mes", color: "from-emerald-500 to-teal-600", features: ["Tudo do Basico", "Scanner com IA", "Ranking global"], popular: true },
  { id: "annual" as const, name: "Elite", price: "R$ 149/mes", color: "from-teal-500 to-cyan-600", features: ["Tudo do Premium", "Planos de treino", "Suporte VIP"] },
] as const;

function Field({
  label,
  leftIcon,
  children,
}: {
  label: string;
  leftIcon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">
        {label}
      </label>
      <div className={FIELD_WRAP}>
        {leftIcon ? <span className="text-[var(--fl-auth-subtle)]">{leftIcon}</span> : null}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export default function Checkout() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { colorScheme, toggleColorScheme } = useAuthColorScheme();

  const [selectedPlan, setSelectedPlan] = useState<"free" | "pro" | "annual">("free");
  const [paymentTab, setPaymentTab] = useState<"card" | "pix">("card");
  const [stepLoading, setStepLoading] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const selectedPlanData = PLAN_OPTIONS.find((plan) => plan.id === selectedPlan) ?? PLAN_OPTIONS[0];
  const heroName = user?.name.trim().split(" ")[0] || "Voce";

  const handleCheckoutSubmit = async () => {
    setStepError(null);
    setStepLoading(true);

    try {
      const paymentMethod = paymentTab === "card" ? "card" : "pix";
      const status = paymentTab === "card" ? "active" : "pending";

      const response = await api("/api/users/plan", {
        method: "POST",
        body: JSON.stringify({
          plan_id: selectedPlan,
          payment_method: paymentMethod as "card" | "pix",
          status: status as "active" | "pending",
        }),
      });

      if (!response.ok) {
        setStepError("Erro ao salvar plano.");
        return;
      }

      navigate("/home");
    } catch {
      setStepError("Nao foi possivel conectar ao servidor.");
    } finally {
      setStepLoading(false);
    }
  };

  return (
    <div className="fl-auth-page fl-auth-funnel-page">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-[var(--fl-auth-primary-soft)] blur-3xl" />
        <div className="absolute right-[-4rem] top-[18%] h-96 w-96 rounded-full bg-[var(--fl-auth-secondary-soft)] blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/3 h-72 w-72 rounded-full bg-[var(--fl-auth-primary-soft)] blur-3xl" />
      </div>

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <AuthThemeHeader colorScheme={colorScheme} onToggleColorScheme={toggleColorScheme} />

        <div className="flex flex-1 items-center justify-center py-4 lg:py-8">
          <div className="fl-auth-shell">
            <aside className="fl-auth-panel fl-auth-hero order-1 rounded-[2rem] p-6 sm:p-8 lg:p-10">
              <div className="hidden h-full flex-col justify-between lg:flex">
                <div className="space-y-6">
                  <span className="fl-auth-pill w-fit">
                    <Sparkles className="h-3.5 w-3.5" />
                    Checkout
                  </span>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[var(--app-primary-color)]">Etapa separada</p>
                    <h1 className="mt-3 max-w-[12ch] text-5xl font-bold leading-[1.02] tracking-tight xl:text-6xl">Escolha seu plano.</h1>
                    <p className="mt-4 max-w-xl text-base leading-7 text-[var(--fl-auth-muted)] xl:text-lg">{heroName}, o onboarding terminou. Agora o checkout cuida sozinho da assinatura e do pagamento.</p>
                  </div>
                  <div className="space-y-3">
                    {[
                      { title: "Checkout separado", text: "Plano e pagamento nao ficam mais misturados ao onboarding." },
                      { title: "Mesmo visual", text: "A tela reaproveita o mesmo shell, header e tokens visuais." },
                      { title: "Fechamento rapido", text: "Cartao aprova como ativo e PIX segue como pendente, igual ao fluxo anterior." },
                    ].map((item) => (
                      <article key={item.title} className="fl-auth-option rounded-[1.5rem] p-4" data-selected="false">
                        <p className="text-lg font-semibold">{item.title}</p>
                        <p className="mt-1 text-sm leading-6 text-[var(--fl-auth-muted)]">{item.text}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </aside>

            <main className="fl-auth-panel order-2 rounded-[2rem] p-5 sm:p-7 lg:p-8">
              <div className="space-y-6 animate-authStepEnter">
                <div className="space-y-3 lg:hidden">
                  <span className="fl-auth-pill w-fit">
                    <Sparkles className="h-3.5 w-3.5" />
                    Checkout
                  </span>
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Escolha o plano e conclua.</h1>
                    <p className="mt-2 text-sm leading-6 text-[var(--fl-auth-muted)]">O onboarding terminou e a cobranca segue separada aqui.</p>
                  </div>
                </div>

                {stepError ? (
                  <div className="space-y-3 rounded-[1.35rem] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                    <p>{stepError}</p>
                  </div>
                ) : null}

                <section className="space-y-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">Plano</p>
                      <h2 className="text-3xl font-bold tracking-tight">Escolha sua assinatura.</h2>
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">premium cards</p>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-3">
                    {PLAN_OPTIONS.map((plan) => (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setSelectedPlan(plan.id)}
                        className="fl-auth-plan-card relative rounded-[1.6rem] p-5 text-left transition"
                        data-selected={selectedPlan === plan.id}
                      >
                        {"popular" in plan && plan.popular ? (
                          <span className="fl-auth-pill absolute right-4 top-4" data-selected="true">
                            recomendado
                          </span>
                        ) : null}

                        <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${plan.color} text-white shadow-lg`}>
                          <Shield className="h-5 w-5" strokeWidth={2.1} />
                        </div>

                        <div className="space-y-2">
                          <p className="text-xl font-bold">{plan.name}</p>
                          <p className="text-3xl font-bold tracking-tight">{plan.price}</p>
                        </div>

                        <div className="mt-5 space-y-2">
                          {plan.features.map((feature) => (
                            <div key={feature} className="flex items-center gap-2 text-sm text-[var(--fl-auth-muted)]">
                              <CheckCircle2 className="h-4 w-4 text-[var(--app-primary-color)]" />
                              <span>{feature}</span>
                            </div>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="space-y-4 border-t border-[var(--fl-auth-card-border)] pt-5">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">Pagamento</p>
                      <h3 className="text-2xl font-bold tracking-tight">Ative {selectedPlanData.name} do seu jeito.</h3>
                    </div>
                    {selectedPlan !== "free" ? (
                      <span className="fl-auth-pill" data-selected="true">
                        {selectedPlanData.price}
                      </span>
                    ) : null}
                  </div>

                  {selectedPlan === "free" ? (
                    <div className="fl-auth-option rounded-[1.4rem] p-4" data-selected="false">
                      <p className="font-semibold">Nenhum pagamento necessario no plano Basico.</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--fl-auth-muted)]">O checkout ainda registra a escolha do plano, mas sem exigir dados de cobranca aqui.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {([
                          { tab: "card", label: "Cartao", icon: CreditCard },
                          { tab: "pix", label: "PIX", icon: QrCode },
                        ] as const).map(({ tab, label, icon: Icon }) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setPaymentTab(tab)}
                            className="fl-auth-pill"
                            data-selected={paymentTab === tab}
                          >
                            <Icon className="h-4 w-4" />
                            {label}
                          </button>
                        ))}
                      </div>

                      {paymentTab === "card" ? (
                        <div className="grid gap-4">
                          <Field label="Numero do cartao" leftIcon={<CreditCard className="h-4 w-4" />}>
                            <Input placeholder="0000 0000 0000 0000" className={FIELD_INPUT} />
                          </Field>
                          <Field label="Nome no cartao">
                            <Input placeholder="Como aparece no cartao" className={FIELD_INPUT} />
                          </Field>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Validade">
                              <Input placeholder="MM/AA" className={FIELD_INPUT} />
                            </Field>
                            <Field label="CVV">
                              <Input placeholder="000" className={FIELD_INPUT} />
                            </Field>
                          </div>
                        </div>
                      ) : (
                        <div className="fl-auth-option rounded-[1.4rem] p-4 text-center" data-selected="false">
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--fl-auth-primary-soft)] text-[var(--app-primary-color)]">
                            <QrCode className="h-5 w-5" strokeWidth={2.2} />
                          </div>
                          <p className="mt-3 font-semibold">O QR Code demonstrativo aparece apos confirmar.</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--fl-auth-muted)]">A logica atual continua marcando PIX como pendente e cartao como ativo.</p>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <Button
                  type="button"
                  onClick={handleCheckoutSubmit}
                  disabled={stepLoading}
                  size="lg"
                  className="fl-auth-cta h-14 w-full rounded-[1.15rem] text-base font-semibold disabled:opacity-50"
                >
                  {stepLoading ? "Finalizando..." : "Finalizar assinatura"}
                  {!stepLoading ? <ArrowRight className="h-4 w-4" /> : null}
                </Button>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
