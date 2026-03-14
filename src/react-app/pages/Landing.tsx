import type { MouseEvent } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  Bolt,
  Brain,
  Check,
  ChevronRight,
  Dumbbell,
  Gamepad2,
  Gift,
  HeartPulse,
  MoonStar,
  QrCode,
  Shield,
  Sparkles,
  Star,
  SunMedium,
  Swords,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import { useTheme } from "@/react-app/contexts/theme";

type NavItem = {
  id: string;
  label: string;
};

type MetricItem = {
  value: string;
  label: string;
};

type AttributeItem = {
  icon: LucideIcon;
  title: string;
  description: string;
};

type FeatureItem = {
  icon: LucideIcon;
  title: string;
  description: string;
};

type PlanItem = {
  name: string;
  price: string;
  popular?: boolean;
  buttonLabel: string;
  features: string[];
};

type ReviewItem = {
  initials: string;
  name: string;
  role: string;
  content: string;
};

const navItems: NavItem[] = [
  { id: "atributos", label: "Atributos" },
  { id: "funcionalidades", label: "Funcionalidades" },
  { id: "planos", label: "Planos" },
  { id: "comunidade", label: "Comunidade" },
];

const metrics: MetricItem[] = [
  { value: "10K+", label: "Usuarios ativos" },
  { value: "2M+", label: "Calorias queimadas" },
  { value: "500k", label: "Loot boxes abertas" },
  { value: "Nivel 42", label: "Media global" },
];

const attributes: AttributeItem[] = [
  {
    icon: Dumbbell,
    title: "Forca",
    description:
      "Foque em treinos de hipertrofia e carga para elevar seu dano base e sua capacidade de carga no jogo.",
  },
  {
    icon: Bolt,
    title: "Agilidade",
    description:
      "Treinos funcionais e cardio explosivo aumentam sua esquiva e velocidade de ataque nas raids.",
  },
  {
    icon: HeartPulse,
    title: "Resistencia",
    description:
      "Aumente seu HP maximo atraves de treinos de longa duracao, respiracao e consistencia.",
  },
];

const features: FeatureItem[] = [
  {
    icon: Gamepad2,
    title: "Gamificacao Real",
    description: "Sistema de XP balanceado por IA para garantir que cada caloria conte para sua evolucao.",
  },
  {
    icon: Brain,
    title: "Missoes de IA",
    description: "Objetivos diarios gerados dinamicamente baseados no seu nivel de cansaco e historico.",
  },
  {
    icon: Zap,
    title: "Treinador Personalizado",
    description: "Um coach digital ajusta sua serie no meio do treino se detectar queda de performance.",
  },
  {
    icon: QrCode,
    title: "Nutri Scanner",
    description: "Aponte a camera e descubra instantaneamente os buffs e efeitos de cada refeicao.",
  },
  {
    icon: Shield,
    title: "Anti-Cheat System",
    description: "Validacao biometrica e GPS para garantir que ninguem consiga loot sem suar a camisa.",
  },
  {
    icon: Gift,
    title: "Loja de Recompensas",
    description: "Troque suas moedas virtuais por suplementos, equipamentos e mensalidades reais.",
  },
];

const comparisonRows = [
  { label: "Plano de Treino", common: "Generico / Estatico", fitloot: "IA Adaptativa 24/7" },
  { label: "Motivacao", common: "Depende de voce", fitloot: "Gamificacao Viciante" },
  { label: "Custo Mensal", common: "R$ 150 - R$ 300", fitloot: "A partir de R$ 49" },
  { label: "Cashback em Loja", common: "Nenhum", fitloot: "Ate 25% em Suplementos" },
];

const plans: PlanItem[] = [
  {
    name: "Basico",
    price: "R$ 49",
    buttonLabel: "Selecionar Plano",
    features: [
      "Missoes diarias",
      "Evolucao de atributos (FOR, CON, VIT, DES, FOCO)",
      "Sistema de XP e niveis",
      "Streaks e multiplicadores",
      "Ranking basico",
    ],
  },
  {
    name: "Premium",
    price: "R$ 99",
    popular: true,
    buttonLabel: "Dominar Agora",
    features: [
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
    name: "Elite",
    price: "R$ 149",
    buttonLabel: "Seja Lendario",
    features: [
      "Tudo do Premium",
      "Planos personalizados de treino",
      "Planos personalizados de nutricao",
      "Habilidades avancadas de calistenia",
      'Animacoes "novo nivel" premium',
      "Suporte VIP prioritario",
      "Personalizacao total do perfil",
    ],
  },
];

const reviews: ReviewItem[] = [
  {
    initials: "RM",
    name: "Ricardo M.",
    role: "Guerreiro Nivel 45",
    content: "Pela primeira vez na vida eu nao falto um treino. A vontade de subir de nivel e maior que a preguica.",
  },
  {
    initials: "AL",
    name: "Ana L.",
    role: "Maga Fitness Nivel 38",
    content: "O Nutri Scanner mudou meu jogo. Agora sei exatamente qual loot meu corpo precisa depois do treino.",
  },
  {
    initials: "KP",
    name: "Kadu P.",
    role: "Paladino Nivel 52",
    content: 'Troquei meus pontos por um kit de creatina e chegou em 3 dias. Funciona mesmo.',
  },
];

const footerNavigation = [
  { label: "App Mobile", type: "login" as const },
  { label: "Marketplace", target: "funcionalidades", type: "section" as const },
  { label: "Lideres de Rank", target: "comunidade", type: "section" as const },
  { label: "Raids Locais", target: "planos", type: "section" as const },
];

const footerSupport = [
  { label: "FAQ", target: "funcionalidades", type: "section" as const },
  { label: "Termos de Uso", type: "login" as const },
  { label: "Privacidade", type: "login" as const },
  { label: "Contato", target: "comunidade", type: "section" as const },
];

export default function Landing() {
  const navigate = useNavigate();
  const { themeMode, toggleThemeMode } = useTheme();

  const scrollToSection =
    (sectionId: string) =>
    (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
      event.preventDefault();
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    };

  const goToLogin = () => {
    navigate(ROUTE_PATHS.login);
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden text-[var(--fl-color-text)]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] opacity-90"
        style={{
          background:
            "radial-gradient(circle at 12% 14%, rgba(var(--fl-color-accent-rgb), 0.12), transparent 30%), radial-gradient(circle at 84% 12%, rgba(var(--app-secondary-color-rgb), 0.08), transparent 26%)",
        }}
      />

      <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--fl-border-soft)] bg-[color-mix(in_srgb,var(--fl-surface-strong)_88%,transparent)] backdrop-blur-2xl">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <div className="flex h-20 items-center justify-between gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="flex items-center gap-3 text-left"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(var(--fl-color-accent-rgb),0.14)] text-[var(--fl-color-accent)]">
                <Zap className="h-5 w-5" strokeWidth={2.3} />
              </span>
              <span className="fl-auth-display text-lg font-bold sm:text-xl">FitLoot</span>
            </button>

            <nav className="hidden items-center gap-8 lg:flex">
              {navItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={scrollToSection(item.id)}
                  className="text-xs font-bold tracking-[0.08em] text-[var(--fl-color-text)] transition hover:text-[var(--fl-color-accent)]"
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleThemeMode}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)] text-[var(--fl-color-text-muted)] transition hover:border-[var(--fl-border-strong)] hover:text-[var(--fl-color-text)]"
                aria-label={themeMode === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
                title={themeMode === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
              >
                {themeMode === "dark" ? <SunMedium className="h-5 w-5" /> : <MoonStar className="h-5 w-5" />}
              </button>

              <button
                type="button"
                onClick={goToLogin}
                className="inline-flex items-center justify-center rounded-full px-4 py-2.5 text-xs font-black text-[var(--fl-nav-item-active-text)] transition hover:-translate-y-0.5 sm:px-5 sm:py-3 sm:text-sm"
                style={{
                  background: "linear-gradient(135deg, var(--app-primary-color), var(--app-secondary-color))",
                  boxShadow: "0 18px 36px rgba(var(--fl-color-accent-rgb), 0.22)",
                }}
              >
                Comecar Agora
              </button>
            </div>
          </div>

          <nav className="flex gap-2 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={scrollToSection(item.id)}
                className="whitespace-nowrap rounded-full border border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)] px-4 py-2 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-[var(--fl-color-text-muted)] transition hover:border-[var(--fl-border-strong)] hover:text-[var(--fl-color-text)]"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="relative pt-36 sm:pt-40 lg:pt-28">
        <section className="relative overflow-hidden px-4 pb-14 pt-8 sm:px-6 lg:px-8 lg:pb-24 lg:pt-12">
          <div
            className="pointer-events-none absolute right-[-10rem] top-[-8rem] h-[28rem] w-[28rem] rounded-full blur-3xl"
            style={{ background: "rgba(var(--fl-color-accent-rgb), 0.16)" }}
          />
          <div
            className="pointer-events-none absolute left-[-6rem] top-[18rem] h-[20rem] w-[20rem] rounded-full blur-3xl"
            style={{ background: "rgba(var(--app-secondary-color-rgb), 0.12)" }}
          />

          <div className="mx-auto grid max-w-7xl items-center gap-8 md:gap-10 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="min-w-0 space-y-8">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--fl-auth-chip-border)] bg-[var(--fl-auth-chip-bg)] px-4 py-2 text-[0.72rem] font-bold uppercase tracking-[0.18em] text-[var(--fl-color-accent)]">
                <Sparkles className="h-4 w-4" />
                Sessao beta aberta
              </span>

              <div className="space-y-5">
                <h1 className="fl-auth-display text-4xl font-black leading-[0.94] sm:text-5xl xl:text-7xl">
                  Transforme esforco em{" "}
                  <span
                    className="bg-clip-text text-transparent"
                    style={{
                      backgroundImage: "linear-gradient(135deg, var(--app-primary-color), var(--app-secondary-color))",
                    }}
                  >
                    poder real
                  </span>
                  .
                </h1>

                <p className="max-w-2xl text-base leading-8 text-[var(--fl-color-text-muted)] sm:text-lg">
                  A plataforma que mistura treino, progressao e recompensas em um loop claro: voce treina,
                  sobe atributos, desbloqueia loot e volta melhor para a proxima missao.
                </p>
              </div>

              <div className="flex flex-col gap-4 sm:flex-row">
                <button
                  type="button"
                  onClick={goToLogin}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-xs font-black uppercase tracking-[0.18em] text-[#04100b] transition hover:-translate-y-0.5 sm:w-auto sm:px-7 sm:py-4 sm:text-sm"
                  style={{
                    background: "linear-gradient(135deg, var(--app-primary-color), var(--app-secondary-color))",
                    boxShadow: "0 20px 36px rgba(var(--fl-color-accent-rgb), 0.24)",
                  }}
                >
                  Baixar app
                  <ArrowRight className="h-4 w-4" />
                </button>

                <a
                  href="#funcionalidades"
                  onClick={scrollToSection("funcionalidades")}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--fl-border-strong)] bg-[var(--fl-surface-glass)] px-6 py-3.5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fl-color-text)] transition hover:-translate-y-0.5 sm:w-auto sm:px-7 sm:py-4 sm:text-sm"
                >
                  Ver arsenal
                  <ChevronRight className="h-4 w-4" />
                </a>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { icon: Trophy, label: "XP por treino", value: "Ate 5x mais recorrencia" },
                  { icon: Swords, label: "Eventos", value: "Raids e desafios semanais" },
                  { icon: Users, label: "Guilda", value: "Progressao compartilhada" },
                ].map((item) => {
                  const Icon = item.icon;

                  return (
                    <div
                      key={item.label}
                      className="rounded-[1.6rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)] p-5 backdrop-blur-xl"
                      style={{ boxShadow: "var(--fl-shadow-glass)" }}
                    >
                      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(var(--fl-color-accent-rgb),0.12)] text-[var(--fl-color-accent)]">
                        <Icon className="h-5 w-5" strokeWidth={2.2} />
                      </div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--fl-color-text-soft)]">
                        {item.label}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-[var(--fl-color-text)]">{item.value}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="relative min-w-0">
              <div
                className="mx-auto w-full max-w-[560px] overflow-hidden rounded-[2.2rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-strong)] p-3"
                style={{ boxShadow: "var(--fl-shadow-glass)" }}
              >
                <div className="relative overflow-hidden rounded-[1.8rem] border border-[var(--fl-border-soft)]">
                  <img
                    src="https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&q=60"
                    alt="Academia futurista FitLoot"
                    loading="lazy"
                    decoding="async"
                    className="h-[380px] w-full object-cover sm:h-[520px]"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,10,7,0.08),rgba(4,10,7,0.72))]" />

                  <div className="absolute left-5 top-5 rounded-full border border-white/10 bg-black/25 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white backdrop-blur-xl">
                    Avatar online
                  </div>

                  <div className="absolute bottom-3 left-3 right-3 rounded-[1.4rem] border border-white/10 bg-black/35 p-3 text-white backdrop-blur-xl sm:bottom-5 sm:left-5 sm:right-5 sm:rounded-[1.8rem] sm:p-5">
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-white/70 sm:text-[0.7rem] sm:tracking-[0.22em]">
                          Status do jogador
                        </p>
                        <p className="mt-1.5 text-xl font-black sm:mt-2 sm:text-2xl">LVL 42</p>
                      </div>
                      <span className="self-start rounded-full bg-[rgba(var(--fl-color-accent-rgb),0.22)] px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[var(--fl-color-accent)] sm:self-auto sm:px-3 sm:text-xs sm:tracking-[0.14em]">
                        Raid pronta
                      </span>
                    </div>

                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10 sm:mt-5 sm:h-2.5">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: "75%",
                          background: "linear-gradient(90deg, var(--app-primary-color), var(--app-secondary-color))",
                        }}
                      />
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-5 sm:gap-3">
                      {[
                        { label: "Forca", value: "FOR 88" },
                        { label: "Agilidade", value: "AGI 64" },
                        { label: "Resistencia", value: "RES 92" },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-center sm:rounded-2xl sm:p-3">
                          <p className="text-[0.52rem] font-bold uppercase tracking-[0.12em] text-white/55 sm:text-[0.65rem] sm:tracking-[0.16em]">
                            {stat.label}
                          </p>
                          <p className="mt-1.5 text-sm font-black text-[var(--fl-color-accent)] sm:mt-2 sm:text-lg">
                            {stat.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="absolute -bottom-6 -left-4 hidden rounded-[1.6rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)] p-4 backdrop-blur-xl md:block"
                style={{ boxShadow: "var(--fl-shadow-glass)" }}
              >
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-[var(--fl-color-text-soft)]">
                  Conversao
                </p>
                <p className="mt-2 text-2xl font-black text-[var(--fl-color-text)]">+31% em aderencia</p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="metricas"
          className="scroll-mt-40 border-y border-[var(--fl-border-soft)] bg-[color-mix(in_srgb,var(--fl-surface-muted)_78%,transparent)] px-4 py-9 sm:px-6 lg:scroll-mt-28 lg:px-8"
        >
          <div className="mx-auto grid max-w-[1280px] grid-cols-2 gap-y-8 md:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="text-center">
                <p className="text-3xl font-black text-[var(--fl-color-accent)] sm:text-4xl">{metric.value}</p>
                <p className="mt-3 text-[0.64rem] font-bold uppercase tracking-[0.2em] text-[var(--fl-color-text-soft)]">
                  {metric.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="atributos" className="scroll-mt-40 px-4 py-20 sm:px-6 lg:scroll-mt-28 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-[1280px]">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="fl-auth-display text-4xl font-black tracking-[-0.05em] sm:text-5xl">
                Domine Seus <span className="text-[var(--fl-color-accent)]">Atributos</span>
              </h2>
              <p className="mt-4 text-sm leading-7 text-[var(--fl-color-text-muted)] sm:text-base">
                Cada movimento seu impacta sua ficha de personagem em tempo real.
              </p>
            </div>

            <div className="mt-14 grid gap-6 md:grid-cols-2 md:[&>*:last-child]:col-span-2 lg:grid-cols-3 lg:[&>*:last-child]:col-span-1">
              {attributes.map((item, index) => {
                const Icon = item.icon;
                const isHighlighted = index === 1;

                return (
                  <article
                    key={item.title}
                    className="group rounded-[1.8rem] border p-8"
                    style={{
                      borderColor: isHighlighted
                        ? "rgba(var(--fl-color-accent-rgb), 0.34)"
                        : "var(--fl-border-soft)",
                      background:
                        "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-glass) 98%, transparent), color-mix(in srgb, var(--fl-surface-muted) 100%, transparent))",
                      boxShadow: isHighlighted
                        ? "0 0 0 1px rgba(var(--fl-color-accent-rgb), 0.1), 0 24px 54px rgba(0, 0, 0, 0.26)"
                        : "0 18px 42px rgba(0, 0, 0, 0.16)",
                    }}
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[rgba(var(--fl-color-accent-rgb),0.12)] text-[var(--fl-color-accent)]">
                      <Icon className="h-5 w-5" strokeWidth={2.2} />
                    </div>

                    <h3 className="mt-6 text-2xl font-black text-[var(--fl-color-text)]">{item.title}</h3>
                    <p className="mt-4 text-sm leading-7 text-[var(--fl-color-text-muted)]">{item.description}</p>

                    <a
                      href="#planos"
                      onClick={scrollToSection("planos")}
                      className="mt-6 inline-flex items-center gap-2 text-[0.72rem] font-black uppercase tracking-[0.16em] text-[var(--fl-color-accent)]"
                    >
                      Ver Progressao
                      <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section id="funcionalidades" className="scroll-mt-40 px-4 py-20 sm:px-6 lg:scroll-mt-28 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-[1280px]">
            <div className="max-w-3xl">
              <h2 className="fl-auth-display text-4xl font-black tracking-[-0.05em] sm:text-5xl">
                O Arsenal Tecnologico
              </h2>
              <p className="mt-4 text-sm leading-7 text-[var(--fl-color-text-muted)] sm:text-base">
                Funcionalidades desenhadas para atletas de elite e gamers hardcore.
              </p>
            </div>

            <div className="mt-14 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article
                    key={feature.title}
                    className="rounded-[1.6rem] border p-6"
                    style={{
                      borderColor: "var(--fl-border-soft)",
                      background:
                        "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-glass) 98%, transparent), color-mix(in srgb, var(--fl-surface-muted) 100%, transparent))",
                      boxShadow: "0 18px 42px rgba(0, 0, 0, 0.16)",
                    }}
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[rgba(var(--fl-color-accent-rgb),0.12)] text-[var(--fl-color-accent)]">
                      <Icon className="h-5 w-5" strokeWidth={2.2} />
                    </div>
                    <h3 className="mt-5 text-lg font-black text-[var(--fl-color-text)]">{feature.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-[var(--fl-color-text-muted)]">{feature.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="comparativo" className="scroll-mt-40 px-4 py-20 sm:px-6 lg:scroll-mt-28 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <h2 className="fl-auth-display text-4xl font-black tracking-[-0.05em] sm:text-5xl">
                Quanto Voce <span className="text-[var(--fl-color-accent)]">Economiza?</span>
              </h2>
              <p className="mt-4 text-sm leading-7 text-[var(--fl-color-text-muted)] sm:text-base">
                O investimento que se paga com saude e beneficios exclusivos.
              </p>
            </div>

            <div className="-mx-4 mt-12 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div
                className="min-w-[640px] overflow-hidden rounded-[1.9rem] border"
                style={{
                  borderColor: "var(--fl-border-soft)",
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-glass) 98%, transparent), color-mix(in srgb, var(--fl-surface-muted) 100%, transparent))",
                  boxShadow: "0 24px 54px rgba(0, 0, 0, 0.2)",
                }}
              >
                <div className="grid grid-cols-[1.2fr_1fr_1fr] bg-[rgba(var(--fl-color-accent-rgb),0.1)] text-[0.68rem] font-black uppercase tracking-[0.16em] text-[var(--fl-color-text)] sm:text-xs">
                  <div className="p-4 sm:p-6">Beneficio</div>
                  <div className="p-4 sm:p-6">Academia Comum</div>
                  <div className="p-4 text-[var(--fl-color-accent)] sm:p-6">FitLoot Elite</div>
                </div>

                <div className="divide-y divide-[var(--fl-border-soft)]">
                  {comparisonRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[1.2fr_1fr_1fr] text-xs sm:text-sm">
                      <div className="p-4 font-semibold text-[var(--fl-color-text)] sm:p-6">{row.label}</div>
                      <div className="p-4 text-[var(--fl-color-text-muted)] sm:p-6">{row.common}</div>
                      <div className="p-4 font-bold text-[var(--fl-color-accent)] sm:p-6">{row.fitloot}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="planos"
          className="scroll-mt-40 border-y border-[var(--fl-border-soft)] bg-[rgba(var(--fl-color-accent-rgb),0.05)] px-4 py-20 sm:px-6 lg:scroll-mt-28 lg:px-8 lg:py-24"
        >
          <div className="mx-auto max-w-[1280px]">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="fl-auth-display text-4xl font-black tracking-[-0.05em] sm:text-5xl">Planos de Batalha</h2>
              <p className="mt-4 text-sm leading-7 text-[var(--fl-color-text-muted)] sm:text-base">
                Escolha seu nivel de comprometimento.
              </p>
            </div>

            <div className="mt-14 grid gap-6 md:grid-cols-2 md:[&>*:last-child]:col-span-2 lg:grid-cols-3 lg:[&>*:last-child]:col-span-1">
              {plans.map((plan) => (
                <article
                  key={plan.name}
                  className={`relative mx-auto flex w-full max-w-md flex-col rounded-[1.9rem] border p-7 md:max-w-none ${
                    plan.popular ? "lg:-translate-y-2" : ""
                  }`}
                  style={{
                    borderColor: plan.popular ? "rgba(var(--fl-color-accent-rgb), 0.38)" : "var(--fl-border-soft)",
                    background: plan.popular
                      ? "linear-gradient(180deg, rgba(var(--fl-color-accent-rgb), 0.1), color-mix(in srgb, var(--fl-surface-strong) 100%, transparent))"
                      : "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-glass) 98%, transparent), color-mix(in srgb, var(--fl-surface-muted) 100%, transparent))",
                    boxShadow: plan.popular
                      ? "0 0 0 1px rgba(var(--fl-color-accent-rgb), 0.1), 0 28px 64px rgba(0, 0, 0, 0.28)"
                      : "0 20px 48px rgba(0, 0, 0, 0.18)",
                  }}
                >
                  {plan.popular ? (
                    <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--app-primary-color)] px-4 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.16em] text-[var(--fl-nav-item-active-text)]">
                      Mais Popular
                    </span>
                  ) : null}

                  <div className="flex-1">
                    <h3 className="text-xl font-black text-[var(--fl-color-text)]">{plan.name}</h3>
                    <div className="mt-3 flex items-end gap-1">
                      <span className="text-4xl font-black text-[var(--fl-color-accent)]">{plan.price}</span>
                      <span className="pb-1 text-sm text-[var(--fl-color-text-muted)]">/mes</span>
                    </div>

                    <div className="mt-7 space-y-3">
                      {plan.features.map((feature) => (
                        <div key={feature} className="flex items-start gap-3 text-sm text-[var(--fl-color-text-muted)]">
                          <span className="mt-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[rgba(var(--fl-color-accent-rgb),0.14)] text-[var(--fl-color-accent)]">
                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          </span>
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={goToLogin}
                    className={`mt-8 inline-flex w-full items-center justify-center rounded-full px-5 py-3.5 text-sm font-black transition hover:-translate-y-0.5 ${
                      plan.popular
                        ? "text-[var(--fl-nav-item-active-text)]"
                        : "border border-[var(--fl-border-strong)] bg-[var(--fl-surface-strong)] text-[var(--fl-color-text)]"
                    }`}
                    style={
                      plan.popular
                        ? {
                            background:
                              "linear-gradient(135deg, var(--app-primary-color), var(--app-secondary-color))",
                            boxShadow: "0 18px 36px rgba(var(--fl-color-accent-rgb), 0.24)",
                          }
                        : undefined
                    }
                  >
                    {plan.buttonLabel}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="comunidade" className="scroll-mt-40 px-4 py-20 sm:px-6 lg:scroll-mt-28 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-[1280px]">
            <div className="text-center">
              <h2 className="fl-auth-display text-4xl font-black tracking-[-0.05em] sm:text-5xl">
                Reviews de <span className="text-[var(--fl-color-accent)]">Elite</span>
              </h2>
            </div>

            <div className="mt-14 grid gap-6 md:grid-cols-2 md:[&>*:last-child]:col-span-2 lg:grid-cols-3 lg:[&>*:last-child]:col-span-1">
              {reviews.map((review) => (
                <article
                  key={review.name}
                  className="rounded-[1.7rem] border p-7"
                  style={{
                    borderColor: "var(--fl-border-soft)",
                    background:
                      "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-glass) 98%, transparent), color-mix(in srgb, var(--fl-surface-muted) 100%, transparent))",
                    boxShadow: "0 20px 46px rgba(0, 0, 0, 0.18)",
                  }}
                >
                  <div className="flex gap-1 text-[var(--fl-color-accent)]">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className="h-4.5 w-4.5 fill-current" />
                    ))}
                  </div>

                  <p className="mt-5 text-sm leading-7 text-[var(--fl-color-text)]">"{review.content}"</p>

                  <div className="mt-7 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(var(--fl-color-accent-rgb),0.14)] text-sm font-bold text-[var(--fl-color-accent)]">
                      {review.initials}
                    </div>
                    <div>
                      <p className="font-black text-[var(--fl-color-text)]">{review.name}</p>
                      <p className="text-xs text-[var(--fl-color-text-muted)]">{review.role}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--fl-border-soft)] bg-[color-mix(in_srgb,var(--fl-surface-strong)_100%,transparent)] px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1280px]">
          <div className="grid gap-12 md:grid-cols-4">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(var(--fl-color-accent-rgb),0.14)] text-[var(--fl-color-accent)]">
                  <Zap className="h-5 w-5" strokeWidth={2.3} />
                </span>
                <span className="fl-auth-display text-2xl font-bold">FitLoot</span>
              </div>

              <p className="mt-6 max-w-sm text-sm leading-7 text-[var(--fl-color-text-muted)]">
                Elevando o patamar do fitness atraves da tecnologia e diversao. Junte-se a maior guilda de saude do
                mundo.
              </p>

              <div className="mt-6 flex gap-3">
                {[Users, Trophy, Zap].map((Icon, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={goToLogin}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)] text-[var(--fl-color-text-muted)] transition hover:border-[var(--fl-border-strong)] hover:text-[var(--fl-color-accent)]"
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-[var(--fl-color-text)]">Navegacao</h3>
              <div className="mt-6 space-y-3">
                {footerNavigation.map((item) =>
                  item.type === "login" ? (
                    <button
                      key={item.label}
                      type="button"
                      onClick={goToLogin}
                      className="block text-sm text-[var(--fl-color-text-muted)] transition hover:text-[var(--fl-color-accent)]"
                    >
                      {item.label}
                    </button>
                  ) : (
                    <a
                      key={item.label}
                      href={`#${item.target}`}
                      onClick={scrollToSection(item.target)}
                      className="block text-sm text-[var(--fl-color-text-muted)] transition hover:text-[var(--fl-color-accent)]"
                    >
                      {item.label}
                    </a>
                  ),
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black text-[var(--fl-color-text)]">Suporte</h3>
              <div className="mt-6 space-y-3">
                {footerSupport.map((item) =>
                  item.type === "login" ? (
                    <button
                      key={item.label}
                      type="button"
                      onClick={goToLogin}
                      className="block text-sm text-[var(--fl-color-text-muted)] transition hover:text-[var(--fl-color-accent)]"
                    >
                      {item.label}
                    </button>
                  ) : (
                    <a
                      key={item.label}
                      href={`#${item.target}`}
                      onClick={scrollToSection(item.target)}
                      className="block text-sm text-[var(--fl-color-text-muted)] transition hover:text-[var(--fl-color-accent)]"
                    >
                      {item.label}
                    </a>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="mt-14 border-t border-[var(--fl-border-soft)] pt-6 text-xs text-[var(--fl-color-text-soft)]">
            (c) 2024 FitLoot. Todos os direitos reservados. Feito para quem nao aceita ser um NPC.
          </div>
        </div>
      </footer>
    </div>
  );
}
