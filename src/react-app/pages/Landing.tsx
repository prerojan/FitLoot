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

type FeatureItem = {
  icon: LucideIcon;
  title: string;
  description: string;
};

type AttributeItem = {
  icon: LucideIcon;
  title: string;
  description: string;
  stat: string;
};

type PlanItem = {
  name: string;
  price: string;
  subtitle: string;
  popular?: boolean;
  features: string[];
};

type ReviewItem = {
  initials: string;
  name: string;
  role: string;
  content: string;
};

const navItems: NavItem[] = [
  { id: "metricas", label: "Metricas" },
  { id: "atributos", label: "Atributos" },
  { id: "funcionalidades", label: "Arsenal" },
  { id: "comparativo", label: "Comparativo" },
  { id: "planos", label: "Planos" },
  { id: "reviews", label: "Reviews" },
];

const metrics: MetricItem[] = [
  { value: "10K+", label: "Usuarios ativos" },
  { value: "2M+", label: "Calorias queimadas" },
  { value: "500K+", label: "Loot boxes abertas" },
  { value: "Nivel 42", label: "Media global" },
];

const attributes: AttributeItem[] = [
  {
    icon: Dumbbell,
    title: "Forca",
    description: "Treinos de carga aumentam dano base, capacidade de carga e presenca nas raids.",
    stat: "FOR 88",
  },
  {
    icon: Bolt,
    title: "Agilidade",
    description: "Cardio explosivo e treino funcional ampliam esquiva, velocidade e mobilidade.",
    stat: "AGI 64",
  },
  {
    icon: HeartPulse,
    title: "Resistencia",
    description: "Sessoes longas elevam HP maximo, recuperacao e consistencia em missoes longas.",
    stat: "RES 92",
  },
];

const features: FeatureItem[] = [
  {
    icon: Gamepad2,
    title: "Gamificacao real",
    description: "Cada treino gera XP balanceado com recompensas e progressao clara para manter ritmo.",
  },
  {
    icon: Brain,
    title: "Missoes com IA",
    description: "Objetivos diarios ajustados ao seu historico, fadiga e meta atual.",
  },
  {
    icon: Sparkles,
    title: "Coach dinamico",
    description: "Sugestoes instantaneas para carga, descanso e intensidade durante o treino.",
  },
  {
    icon: QrCode,
    title: "Nutri scanner",
    description: "Leitura rapida de refeicoes com feedback de buffs, macros e recuperacao.",
  },
  {
    icon: Shield,
    title: "Anti cheat",
    description: "Validacao de atividade para garantir que recompensa venha de esforco real.",
  },
  {
    icon: Gift,
    title: "Loja de recompensas",
    description: "Troque moedas por beneficios reais, descontos e itens especiais do ecossistema.",
  },
];

const plans: PlanItem[] = [
  {
    name: "Basico",
    price: "R$ 49",
    subtitle: "Entrada na guilda com progresso essencial.",
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
    subtitle: "Plano mais escolhido para subir de nivel sem travar.",
    popular: true,
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
    subtitle: "Camada maxima para quem quer performance e status.",
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
    role: "Guerreiro nivel 45",
    content: "Pela primeira vez eu nao falho treino. A vontade de subir de nivel venceu a preguica.",
  },
  {
    initials: "AL",
    name: "Ana L.",
    role: "Maga fitness nivel 38",
    content: "O scanner nutricional virou parte da minha rotina. Agora eu sei qual loot meu corpo precisa.",
  },
  {
    initials: "KP",
    name: "Kadu P.",
    role: "Paladino nivel 52",
    content: "Troquei pontos por creatina e desconto em equipamento. O loop de recompensa funciona mesmo.",
  },
];

const comparisonRows = [
  { label: "Plano de treino", common: "Generico e estatico", fitloot: "IA adaptativa 24/7" },
  { label: "Motivacao", common: "Depende so de voce", fitloot: "Loop de missao, ranking e reward" },
  { label: "Custo mensal", common: "R$ 150 a R$ 300", fitloot: "A partir de R$ 49" },
  { label: "Cashback e perks", common: "Nenhum", fitloot: "Ate 25% em parceiros" },
];

export default function Landing() {
  const navigate = useNavigate();
  const { themeMode, toggleThemeMode } = useTheme();

  const scrollToSection =
    (sectionId: string) =>
    (event: MouseEvent<HTMLAnchorElement>) => {
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
    <div className="min-h-screen text-[var(--fl-color-text)]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)] backdrop-blur-2xl">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="flex items-center gap-3 text-left"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--fl-border-soft)] bg-[rgba(var(--fl-color-accent-rgb),0.14)] shadow-[0_0_24px_rgba(var(--fl-color-accent-rgb),0.16)]">
                <Zap className="h-6 w-6 text-[var(--fl-color-accent)]" strokeWidth={2.3} />
              </span>
              <span>
                <span className="block text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[var(--fl-color-accent)]">
                  Fitness RPG
                </span>
                <span className="fl-auth-display block text-xl font-bold sm:text-2xl">FitLoot</span>
              </span>
            </button>

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
                className="hidden rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-[#04100b] transition hover:-translate-y-0.5 sm:inline-flex sm:items-center sm:gap-2"
                style={{
                  background: "linear-gradient(135deg, var(--app-primary-color), var(--app-secondary-color))",
                  boxShadow: "0 18px 32px rgba(var(--fl-color-accent-rgb), 0.22)",
                }}
              >
                Comecar agora
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 md:mt-5 md:justify-center">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={scrollToSection(item.id)}
                className="whitespace-nowrap rounded-full border border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)] px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[var(--fl-color-text-muted)] transition hover:border-[var(--fl-border-strong)] hover:text-[var(--fl-color-text)]"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="pt-40 sm:pt-36">
        <section className="relative overflow-hidden px-4 pb-14 pt-8 sm:px-6 lg:px-8 lg:pb-24 lg:pt-12">
          <div
            className="pointer-events-none absolute right-[-10rem] top-[-8rem] h-[28rem] w-[28rem] rounded-full blur-3xl"
            style={{ background: "rgba(var(--fl-color-accent-rgb), 0.16)" }}
          />
          <div
            className="pointer-events-none absolute left-[-6rem] top-[18rem] h-[20rem] w-[20rem] rounded-full blur-3xl"
            style={{ background: "rgba(var(--app-secondary-color-rgb), 0.12)" }}
          />

          <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="space-y-8">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--fl-auth-chip-border)] bg-[var(--fl-auth-chip-bg)] px-4 py-2 text-[0.72rem] font-bold uppercase tracking-[0.18em] text-[var(--fl-color-accent)]">
                <Sparkles className="h-4 w-4" />
                Sessao beta aberta
              </span>

              <div className="space-y-5">
                <h1 className="fl-auth-display text-5xl font-black leading-[0.94] sm:text-6xl xl:text-7xl">
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
                  className="inline-flex items-center justify-center gap-2 rounded-full px-7 py-4 text-sm font-black uppercase tracking-[0.18em] text-[#04100b] transition hover:-translate-y-0.5"
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
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--fl-border-strong)] bg-[var(--fl-surface-glass)] px-7 py-4 text-sm font-bold uppercase tracking-[0.14em] text-[var(--fl-color-text)] transition hover:-translate-y-0.5"
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

            <div className="relative">
              <div
                className="overflow-hidden rounded-[2.2rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-strong)] p-3"
                style={{ boxShadow: "var(--fl-shadow-glass)" }}
              >
                <div className="relative overflow-hidden rounded-[1.8rem] border border-[var(--fl-border-soft)]">
                  <img
                    src="https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&q=60"
                    alt="Academia futurista FitLoot"
                    loading="lazy"
                    decoding="async"
                    className="h-[520px] w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,10,7,0.08),rgba(4,10,7,0.72))]" />

                  <div className="absolute left-5 top-5 rounded-full border border-white/10 bg-black/25 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white backdrop-blur-xl">
                    Avatar online
                  </div>

                  <div className="absolute bottom-5 left-5 right-5 rounded-[1.8rem] border border-white/10 bg-black/35 p-5 text-white backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-white/70">
                          Status do jogador
                        </p>
                        <p className="mt-2 text-2xl font-black">LVL 42</p>
                      </div>
                      <span className="rounded-full bg-[rgba(var(--fl-color-accent-rgb),0.22)] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fl-color-accent)]">
                        Raid pronta
                      </span>
                    </div>

                    <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: "75%",
                          background: "linear-gradient(90deg, var(--app-primary-color), var(--app-secondary-color))",
                        }}
                      />
                    </div>

                    <div className="mt-5 grid grid-cols-3 gap-3">
                      {attributes.map((item) => (
                        <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
                          <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-white/55">
                            {item.title}
                          </p>
                          <p className="mt-2 text-lg font-black text-[var(--fl-color-accent)]">{item.stat}</p>
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

        <section id="metricas" className="scroll-mt-40 border-y border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)]/80 px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-4">
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-[1.6rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)] p-6 text-center backdrop-blur-xl"
                style={{ boxShadow: "var(--fl-shadow-glass)" }}
              >
                <p className="text-3xl font-black text-[var(--fl-color-accent)] sm:text-4xl">{metric.value}</p>
                <p className="mt-3 text-[0.78rem] font-bold uppercase tracking-[0.18em] text-[var(--fl-color-text-soft)]">
                  {metric.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="atributos" className="scroll-mt-40 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--fl-color-accent)]">Atributos</p>
              <h2 className="fl-auth-display mt-4 text-4xl font-black tracking-tight sm:text-5xl">
                Domine sua ficha em tempo real.
              </h2>
              <p className="mt-4 text-base leading-8 text-[var(--fl-color-text-muted)]">
                Cada bloco de treino alimenta uma estatistica do avatar. O feedback visual deixa claro como o
                treino da vida real muda seu desempenho no ecossistema FitLoot.
              </p>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {attributes.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="group relative overflow-hidden rounded-[2rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)] p-8 backdrop-blur-xl transition hover:-translate-y-1 hover:border-[var(--fl-border-strong)]"
                    style={{ boxShadow: "var(--fl-shadow-glass)" }}
                  >
                    <div
                      className="absolute right-[-4rem] top-[-4rem] h-40 w-40 rounded-full blur-3xl transition group-hover:opacity-100"
                      style={{ background: "rgba(var(--fl-color-accent-rgb), 0.18)" }}
                    />
                    <div className="relative">
                      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-[1.3rem] bg-[rgba(var(--fl-color-accent-rgb),0.12)] text-[var(--fl-color-accent)]">
                        <Icon className="h-7 w-7" strokeWidth={2.1} />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-2xl font-black text-[var(--fl-color-text)]">{item.title}</h3>
                        <span className="rounded-full border border-[rgba(var(--fl-color-accent-rgb),0.25)] bg-[rgba(var(--fl-color-accent-rgb),0.1)] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fl-color-accent)]">
                          {item.stat}
                        </span>
                      </div>
                      <p className="mt-4 leading-8 text-[var(--fl-color-text-muted)]">{item.description}</p>
                      <a
                        href="#planos"
                        onClick={scrollToSection("planos")}
                        className="mt-6 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-[var(--fl-color-accent)]"
                      >
                        Ver progressao
                        <ChevronRight className="h-4 w-4" />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="funcionalidades" className="scroll-mt-40 border-y border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)]/70 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--fl-color-accent)]">Funcionalidades</p>
                <h2 className="fl-auth-display mt-4 text-4xl font-black tracking-tight sm:text-5xl">
                  O arsenal tecnologico da sua evolucao.
                </h2>
              </div>
              <p className="max-w-2xl text-base leading-8 text-[var(--fl-color-text-muted)]">
                O produto combina IA, mecanicas de jogo e reward design para transformar consistencia em
                progressao concreta.
              </p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article
                    key={feature.title}
                    className="rounded-[1.8rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)] p-7 backdrop-blur-xl transition hover:-translate-y-1 hover:border-[var(--fl-border-strong)]"
                    style={{ boxShadow: "var(--fl-shadow-glass)" }}
                  >
                    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[1.2rem] bg-[rgba(var(--fl-color-accent-rgb),0.12)] text-[var(--fl-color-accent)]">
                      <Icon className="h-7 w-7" strokeWidth={2.1} />
                    </div>
                    <h3 className="text-2xl font-black text-[var(--fl-color-text)]">{feature.title}</h3>
                    <p className="mt-4 leading-8 text-[var(--fl-color-text-muted)]">{feature.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="comparativo" className="scroll-mt-40 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--fl-color-accent)]">Comparativo</p>
              <h2 className="fl-auth-display mt-4 text-4xl font-black tracking-tight sm:text-5xl">
                Quanto voce economiza com a stack certa.
              </h2>
              <p className="mt-4 text-base leading-8 text-[var(--fl-color-text-muted)]">
                O app substitui friccao por progresso visivel e concentra treino, motivacao e beneficios em uma
                unica assinatura.
              </p>
            </div>

            <div
              className="mt-12 overflow-hidden rounded-[2rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)] backdrop-blur-xl"
              style={{ boxShadow: "var(--fl-shadow-glass)" }}
            >
              <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-[var(--fl-border-soft)] bg-[rgba(var(--fl-color-accent-rgb),0.08)] text-sm font-bold uppercase tracking-[0.16em] text-[var(--fl-color-text)]">
                <div className="p-5 sm:p-6">Beneficio</div>
                <div className="p-5 sm:p-6">Academia comum</div>
                <div className="p-5 text-[var(--fl-color-accent)] sm:p-6">FitLoot Elite</div>
              </div>

              <div className="divide-y divide-[var(--fl-border-soft)]">
                {comparisonRows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[1.2fr_1fr_1fr] text-sm sm:text-base">
                    <div className="p-5 font-semibold text-[var(--fl-color-text)] sm:p-6">{row.label}</div>
                    <div className="p-5 text-[var(--fl-color-text-muted)] sm:p-6">{row.common}</div>
                    <div className="p-5 font-bold text-[var(--fl-color-accent)] sm:p-6">{row.fitloot}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="planos" className="scroll-mt-40 relative px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div
            className="pointer-events-none absolute inset-x-0 top-12 mx-auto h-[26rem] max-w-6xl rounded-[3rem] blur-3xl"
            style={{ background: "rgba(var(--fl-color-accent-rgb), 0.1)" }}
          />

          <div className="relative mx-auto max-w-7xl">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--fl-color-accent)]">Planos</p>
              <h2 className="fl-auth-display mt-4 text-4xl font-black tracking-tight sm:text-5xl">
                Escolha seu plano de batalha.
              </h2>
              <p className="mt-4 text-base leading-8 text-[var(--fl-color-text-muted)]">
                Todos os CTAs de entrada levam voce para o login. Depois disso, o app libera a jornada de
                onboarding e o acesso certo para o seu momento.
              </p>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {plans.map((plan) => (
                <article
                  key={plan.name}
                  className={`relative flex flex-col rounded-[2rem] border p-8 backdrop-blur-xl ${
                    plan.popular
                      ? "border-[rgba(var(--fl-color-accent-rgb),0.32)] bg-[rgba(var(--fl-color-accent-rgb),0.09)]"
                      : "border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)]"
                  }`}
                  style={{ boxShadow: "var(--fl-shadow-glass)" }}
                >
                  {plan.popular ? (
                    <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--app-primary-color)] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#04100b]">
                      Mais popular
                    </span>
                  ) : null}

                  <div className="flex-1">
                    <h3 className="text-2xl font-black text-[var(--fl-color-text)]">{plan.name}</h3>
                    <div className="mt-4 flex items-end gap-2">
                      <span className="text-4xl font-black text-[var(--fl-color-accent)]">{plan.price}</span>
                      <span className="pb-1 text-sm text-[var(--fl-color-text-muted)]">/mes</span>
                    </div>
                    <p className="mt-3 leading-7 text-[var(--fl-color-text-muted)]">{plan.subtitle}</p>

                    <div className="mt-6 space-y-3">
                      {plan.features.map((feature) => (
                        <div key={feature} className="flex items-start gap-3 text-sm text-[var(--fl-color-text-muted)]">
                          <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(var(--fl-color-accent-rgb),0.14)] text-[var(--fl-color-accent)]">
                            <Check className="h-3.5 w-3.5" strokeWidth={2.8} />
                          </span>
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={goToLogin}
                    className={`mt-8 inline-flex items-center justify-center gap-2 rounded-full px-6 py-4 text-sm font-black uppercase tracking-[0.16em] transition hover:-translate-y-0.5 ${
                      plan.popular
                        ? "text-[#04100b]"
                        : "border border-[var(--fl-border-strong)] bg-[var(--fl-surface-strong)] text-[var(--fl-color-text)]"
                    }`}
                    style={
                      plan.popular
                        ? {
                            background: "linear-gradient(135deg, var(--app-primary-color), var(--app-secondary-color))",
                            boxShadow: "0 18px 32px rgba(var(--fl-color-accent-rgb), 0.24)",
                          }
                        : undefined
                    }
                  >
                    {plan.popular ? "Dominar agora" : "Selecionar plano"}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="reviews" className="scroll-mt-40 border-t border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)]/70 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--fl-color-accent)]">Reviews</p>
              <h2 className="fl-auth-display mt-4 text-4xl font-black tracking-tight sm:text-5xl">
                Reviews de elite da comunidade.
              </h2>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {reviews.map((review) => (
                <article
                  key={review.name}
                  className="rounded-[1.9rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)] p-8 backdrop-blur-xl"
                  style={{ boxShadow: "var(--fl-shadow-glass)" }}
                >
                  <div className="flex gap-1 text-[var(--fl-color-accent)]">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className="h-5 w-5 fill-current" />
                    ))}
                  </div>
                  <p className="mt-6 text-lg leading-8 text-[var(--fl-color-text)]">"{review.content}"</p>
                  <div className="mt-8 flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(var(--fl-color-accent-rgb),0.14)] font-bold text-[var(--fl-color-accent)]">
                      {review.initials}
                    </div>
                    <div>
                      <p className="font-black text-[var(--fl-color-text)]">{review.name}</p>
                      <p className="text-sm text-[var(--fl-color-text-muted)]">{review.role}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--fl-border-soft)] bg-[var(--fl-surface-strong)] px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--fl-border-soft)] bg-[rgba(var(--fl-color-accent-rgb),0.14)] shadow-[0_0_24px_rgba(var(--fl-color-accent-rgb),0.16)]">
                  <Zap className="h-6 w-6 text-[var(--fl-color-accent)]" strokeWidth={2.3} />
                </span>
                <div>
                  <p className="fl-auth-display text-2xl font-black">FitLoot</p>
                  <p className="text-sm text-[var(--fl-color-text-muted)]">Treino, progresso e recompensas</p>
                </div>
              </div>

              <p className="max-w-md leading-8 text-[var(--fl-color-text-muted)]">
                A proposta da landing e simples: mostrar a progressao, levar para o login e deixar o restante da
                jornada acontecer no produto certo.
              </p>

              <button
                type="button"
                onClick={goToLogin}
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-[#04100b] transition hover:-translate-y-0.5"
                style={{
                  background: "linear-gradient(135deg, var(--app-primary-color), var(--app-secondary-color))",
                  boxShadow: "0 18px 32px rgba(var(--fl-color-accent-rgb), 0.2)",
                }}
              >
                Entrar no app
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[var(--fl-color-text)]">Navegacao</h3>
              <div className="mt-5 space-y-3">
                {navItems.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={scrollToSection(item.id)}
                    className="block text-sm text-[var(--fl-color-text-muted)] transition hover:text-[var(--fl-color-accent)]"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[var(--fl-color-text)]">Suporte</h3>
              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={goToLogin}
                  className="block text-sm text-[var(--fl-color-text-muted)] transition hover:text-[var(--fl-color-accent)]"
                >
                  Login
                </button>
                <a
                  href="#comparativo"
                  onClick={scrollToSection("comparativo")}
                  className="block text-sm text-[var(--fl-color-text-muted)] transition hover:text-[var(--fl-color-accent)]"
                >
                  Planos e beneficios
                </a>
                <a
                  href="#reviews"
                  onClick={scrollToSection("reviews")}
                  className="block text-sm text-[var(--fl-color-text-muted)] transition hover:text-[var(--fl-color-accent)]"
                >
                  Feedback da comunidade
                </a>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[var(--fl-color-text)]">Redes</h3>
              <div className="mt-5 flex flex-wrap gap-3">
                {[
                  { icon: Users, label: "Guilda" },
                  { icon: Trophy, label: "Ranking" },
                  { icon: Sparkles, label: "Eventos" },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={goToLogin}
                      className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--fl-border-soft)] bg-[var(--fl-surface-glass)] text-[var(--fl-color-text-muted)] transition hover:border-[var(--fl-border-strong)] hover:text-[var(--fl-color-accent)]"
                      title={item.label}
                      aria-label={item.label}
                    >
                      <Icon className="h-5 w-5" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-12 border-t border-[var(--fl-border-soft)] pt-6 text-sm text-[var(--fl-color-text-soft)]">
            (c) 2024 FitLoot. Todos os direitos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
