import { useEffect, useRef, useState, type ChangeEvent, type FC, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Mail,
  Shield,
  Sparkles,
  Target,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/react-app/contexts/auth";
import LoadingBall from "@/react-app/components/LoadingBall";
import { api } from "@/react-app/utils/api";

type LoginForm = {
  email: string;
  password: string;
};

type ApiError = {
  error: string;
  code?: string | undefined;
};

type HeroFeature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const HERO_FEATURES: HeroFeature[] = [
  {
    icon: Trophy,
    title: "XP que vira progresso real",
    description: "Cada treino alimenta niveis, streaks e recompensas dentro do app.",
  },
  {
    icon: Target,
    title: "Missoes com direcao clara",
    description: "Objetivos diarios e semanais mantem o foco sem perder a pegada de jogo.",
  },
  {
    icon: Sparkles,
    title: "Recompensas que puxam voce",
    description: "Cupons, evolucao visual e senso de conquista para sustentar o habito.",
  },
];

const HERO_STATS = [
  { value: "10K+", label: "atletas ativos" },
  { value: "500K+", label: "missoes concluidas" },
  { value: "95%", label: "taxa de adesao" },
];

const Home: FC = () => {
  const navigate = useNavigate();
  const { checkAuth } = useAuth();

  const [form, setForm] = useState<LoginForm>({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [userNotFound, setUserNotFound] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("registered") === "true") {
      setSuccessMessage("Conta criada com sucesso! Faca login para continuar.");
    }
  }, []);

  const goToOnboarding = () => {
    if (form.email) sessionStorage.setItem("onboarding_email", form.email);
    navigate("/onboarding");
  };

  const handleChange =
    (field: keyof LoginForm) =>
      (e: ChangeEvent<HTMLInputElement>) => {
        setForm((prev) => ({ ...prev, [field]: e.target.value }));
      };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setUserNotFound(false);
    setIsLoading(true);

    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ApiError | null;

        if (res.status === 404 && data?.code === "USER_NOT_FOUND") {
          setError(data?.error ?? "Nenhuma conta encontrada com esse e-mail.");
          setUserNotFound(true);
          return;
        }

        if (res.status === 401) {
          setError("Email ou senha incorretos.");
          return;
        }

        setError(data?.error ?? "Erro ao fazer login");
        return;
      }

      localStorage.setItem("fitloot_authenticated_hint", "1");
      await checkAuth();
      navigate("/app", { replace: true });
    } catch {
      setError("Nao foi possivel conectar ao servidor");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fl-auth-page">
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="px-5 pt-5 md:px-8 md:pt-8">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[rgba(var(--fl-color-accent-rgb),0.14)] shadow-[0_0_24px_rgba(var(--fl-color-accent-rgb),0.16)]">
                <Zap className="h-6 w-6 text-[var(--fl-color-accent)]" strokeWidth={2.3} />
              </div>
              <div>
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--fl-color-accent)]">
                  Fitness RPG
                </p>
                <h1 className="fl-auth-display text-xl font-bold md:text-2xl">FitLoot</h1>
              </div>
            </div>

            <div className="hidden rounded-full border border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)] px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--fl-color-text-muted)] sm:flex">
              Login FitLoot
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 pb-10 pt-6 md:px-8 md:pb-12 md:pt-8">
          <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.05fr_minmax(0,0.95fr)]">
            <section className="hidden lg:block">
              <div className="fl-auth-hero-panel rounded-[2rem] p-8 xl:p-10">
                <div className="relative z-10 flex h-full flex-col justify-between gap-10">
                  <div className="space-y-6">
                    <span className="fl-auth-chip">
                      <Shield className="h-4 w-4" />
                      Arena de evolucao
                    </span>

                    <div className="space-y-4">
                      <h2 className="fl-auth-display max-w-xl text-5xl font-bold leading-[1.02] xl:text-6xl">
                        Entre e suba de nivel na vida real.
                      </h2>
                      <p className="max-w-xl text-base leading-7 text-[var(--fl-color-text-muted)] xl:text-lg">
                        O redesign do login agora puxa a linguagem da Arena: superfices fortes,
                        brilho de acento e leitura mais objetiva para colocar o usuario em jogo logo de cara.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div className="grid gap-3 xl:grid-cols-3">
                      {HERO_FEATURES.map(({ icon: Icon, title, description }) => (
                        <article
                          key={title}
                          className="fl-auth-feature-card rounded-[1.6rem] p-5"
                        >
                          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(var(--fl-color-accent-rgb),0.14)] text-[var(--fl-color-accent)]">
                            <Icon className="h-5 w-5" />
                          </div>
                          <h3 className="mb-2 text-sm font-semibold text-[var(--fl-color-text)]">
                            {title}
                          </h3>
                          <p className="text-sm leading-6 text-[var(--fl-color-text-muted)]">
                            {description}
                          </p>
                        </article>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {HERO_STATS.map((stat) => (
                        <div
                          key={stat.label}
                          className="fl-auth-stat-card rounded-[1.4rem] px-4 py-5 text-center"
                        >
                          <p className="fl-auth-display text-2xl font-bold text-[var(--fl-color-accent)]">
                            {stat.value}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--fl-color-text-soft)]">
                            {stat.label}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="fl-auth-panel rounded-[2rem] p-6 md:p-8 lg:p-10">
              <div className="space-y-8">
                <div className="space-y-5 lg:hidden">
                  <span className="fl-auth-chip">
                    <Shield className="h-4 w-4" />
                    Arena de evolucao
                  </span>
                  <div className="space-y-3">
                    <h2 className="fl-auth-display text-4xl font-bold leading-none">
                      Entre para continuar sua jornada.
                    </h2>
                    <p className="text-sm leading-6 text-[var(--fl-color-text-muted)]">
                      Visual novo, mesma autenticacao e mesmo fluxo. Tudo continua 100% funcional.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {HERO_STATS.map((stat) => (
                      <div
                        key={stat.label}
                        className="fl-auth-stat-card rounded-[1.25rem] px-3 py-4 text-center"
                      >
                        <p className="text-lg font-bold text-[var(--fl-color-accent)]">{stat.value}</p>
                        <p className="mt-1 text-[0.6rem] uppercase tracking-[0.16em] text-[var(--fl-color-text-soft)]">
                          {stat.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <p className="text-[0.72rem] font-bold uppercase tracking-[0.2em] text-[var(--fl-color-accent)]">
                      Login
                    </p>
                    <h3 className="fl-auth-display text-3xl font-bold">Bem-vindo de volta</h3>
                    <p className="text-sm leading-6 text-[var(--fl-color-text-muted)]">
                      Acesse sua conta para retomar missoes, streaks e recompensas.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--fl-color-text-soft)]">
                    <span className="inline-flex items-center gap-2">
                      <Shield className="h-4 w-4 text-[var(--fl-color-accent)]" />
                      Sessao segura
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Zap className="h-4 w-4 text-[var(--fl-color-accent)]" />
                      Entrada instantanea
                    </span>
                  </div>
                </div>

                {successMessage && (
                  <div className="fl-auth-message fl-auth-message-success">
                    {successMessage}
                  </div>
                )}

                {error && (
                  <div className="fl-auth-message fl-auth-message-error space-y-3">
                    <p>{error}</p>
                    {userNotFound && (
                      <button
                        type="button"
                        onClick={goToOnboarding}
                        className="fl-auth-submit text-sm"
                      >
                        Criar minha conta
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}

                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                  <div className="space-y-2">
                    <label
                      htmlFor="login-email"
                      className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--fl-color-text-soft)]"
                    >
                      Email
                    </label>
                    <div className="fl-auth-input-wrap">
                      <Mail className="fl-auth-icon h-5 w-5" />
                      <input
                        id="login-email"
                        type="email"
                        placeholder="seu@email.com"
                        value={form.email}
                        onChange={handleChange("email")}
                        autoComplete="email"
                        required
                        className="fl-auth-input"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="login-password"
                      className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--fl-color-text-soft)]"
                    >
                      Senha
                    </label>
                    <div className="fl-auth-input-wrap">
                      <Shield className="fl-auth-icon h-5 w-5" />
                      <input
                        ref={passwordRef}
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={form.password}
                        onChange={handleChange("password")}
                        autoComplete="current-password"
                        required
                        className="fl-auth-input"
                      />
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          setShowPassword((currentValue) => !currentValue);
                          e.currentTarget.blur();
                          passwordRef.current?.focus();
                        }}
                        className="rounded-full p-2 text-[var(--fl-color-text-muted)] transition hover:bg-white/5 hover:text-[var(--fl-color-text)] focus:outline-none"
                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      >
                        {showPassword ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || !form.email || !form.password}
                    className="fl-auth-submit"
                  >
                    {isLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <LoadingBall size="sm" />
                        Entrando
                      </span>
                    ) : (
                      <>
                        Inicializar sessao
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="space-y-5 border-t border-[var(--fl-border-soft)] pt-6">
                  <div className="flex items-center justify-between gap-3 rounded-[1.35rem] border border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)] px-4 py-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--fl-color-text)]">
                        Ainda nao tem uma conta?
                      </p>
                      <p className="text-sm text-[var(--fl-color-text-muted)]">
                        Crie seu perfil e entre no onboarding sem perder o email preenchido.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={goToOnboarding}
                      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--fl-auth-chip-border)] bg-[var(--fl-auth-chip-bg)] px-4 py-2 text-sm font-semibold text-[var(--fl-color-accent)] transition hover:opacity-85"
                    >
                      Criar conta
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fl-color-text-soft)]">
                    <span className="inline-flex items-center gap-2">
                      <Check className="h-4 w-4 text-[var(--fl-color-accent)]" />
                      7 dias gratis
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Check className="h-4 w-4 text-[var(--fl-color-accent)]" />
                      Cancele quando quiser
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Home;
