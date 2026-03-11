import { useEffect, useRef, useState, type ChangeEvent, type FC, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Mail,
  MoonStar,
  Shield,
  SunMedium,
  Zap,
} from "lucide-react";
import { useAuth } from "@/react-app/contexts/auth";
import { useTheme } from "@/react-app/contexts/theme";
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

const Home: FC = () => {
  const navigate = useNavigate();
  const { checkAuth } = useAuth();
  const { themeMode, toggleThemeMode } = useTheme();

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

            <button
              type="button"
              onClick={toggleThemeMode}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--fl-border-soft)] bg-[var(--fl-surface-muted)] text-[var(--fl-color-text-muted)] transition hover:border-[var(--fl-border-strong)] hover:text-[var(--fl-color-text)]"
              aria-label={themeMode === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
              title={themeMode === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
            >
              {themeMode === "dark" ? <SunMedium className="h-5 w-5" /> : <MoonStar className="h-5 w-5" />}
            </button>
          </div>
        </header>

        <main className="flex-1 px-5 pb-10 pt-6 md:px-8 md:pb-12 md:pt-8">
          <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[1.02fr_minmax(0,0.92fr)]">
            <section className="hidden lg:block">
              <div className="fl-auth-hero-panel rounded-[1.5rem] p-7 xl:p-8">
                <div className="absolute inset-0">
                  <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&q=55')] bg-cover bg-center opacity-60" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10" />
                </div>

                <div className="relative z-10 flex min-h-[540px] flex-col justify-end gap-7">
                  <div className="space-y-4">
                    <span className="fl-auth-chip">
                      <Shield className="h-4 w-4" />
                      Arena de evolucao
                    </span>

                    <div className="space-y-3">
                      <h2 className="fl-auth-display max-w-xl text-5xl font-bold leading-[1.02] xl:text-6xl">
                        Entre e{" "}
                        <span className="italic text-[var(--fl-color-accent)]">suba de nivel</span>{" "}
                        na vida real.
                      </h2>
                      <p className="max-w-md text-base leading-7 text-white/78 xl:text-lg">
                        Transforme exercicios em conquistas epicas com XP.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="fl-auth-panel rounded-[1.5rem] p-5 md:p-6 lg:p-7">
              <div className="space-y-6">
                <div className="space-y-4 lg:hidden">
                  <span className="fl-auth-chip">
                    <Shield className="h-4 w-4" />
                    Arena de evolucao
                  </span>

                  <div className="space-y-2">
                    <h2 className="fl-auth-display text-4xl font-bold leading-[1.02]">
                      Entre e{" "}
                      <span className="italic text-[var(--fl-color-accent)]">suba de nivel</span>{" "}
                      na vida real.
                    </h2>
                    <p className="text-sm leading-6 text-[var(--fl-color-text-muted)]">
                      Transforme exercicios em conquistas epicas com XP.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="space-y-2">
                    <p className="text-[0.72rem] font-bold uppercase tracking-[0.2em] text-[var(--fl-color-accent)]">
                      Login
                    </p>
                    <h3 className="fl-auth-display text-3xl font-bold">Bem-vindo de volta</h3>
                    <p className="text-sm leading-6 text-[var(--fl-color-text-muted)]">
                      Acesse sua conta para retomar missoes, streaks e recompensas.
                    </p>
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
                        placeholder="********"
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

                <div className="space-y-4 border-t border-[var(--fl-border-soft)] pt-5 text-center">
                  <p className="text-sm text-[var(--fl-color-text-muted)]">
                    Nao tem uma conta?{" "}
                    <button
                      type="button"
                      onClick={goToOnboarding}
                      className="fl-auth-inline-link"
                    >
                      Criar conta
                    </button>
                  </p>

                  <div className="inline-flex items-center gap-2 rounded-full border border-[var(--fl-auth-chip-border)] bg-[var(--fl-auth-chip-bg)] px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--fl-color-text-soft)]">
                    <Check className="h-4 w-4 text-[var(--fl-color-accent)]" />
                    7 dias gratis - Cancele quando quiser
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
