import { useState, useEffect, useRef, type FC, type FormEvent, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import {
  Zap,
  Mail,
  ArrowRight,
  Shield,
  Trophy,
  Target,
  Sparkles,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { api } from "@/react-app/utils/api";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import LoadingBall from "@/react-app/components/LoadingBall";

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
      setSuccessMessage("Conta criada com sucesso! Faça login para continuar.");
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

      // Após login, atualiza contexto global e redireciona
      localStorage.setItem("fitloot_authenticated_hint", "1");
      await checkAuth();
      navigate("/app", { replace: true });
    } catch {
      setError("Não foi possível conectar ao servidor");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decorativo */}
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=960&q=40')] bg-cover bg-center opacity-5" />

      {/* Elementos decorativos flutuantes */}
      <div className="absolute top-20 left-10 w-20 h-20 bg-emerald-200 rounded-full blur-3xl opacity-50 animate-pulse" />
      <div
        className="absolute bottom-20 right-10 w-32 h-32 bg-teal-200 rounded-full blur-3xl opacity-50 animate-pulse"
        style={{ animationDelay: "700ms" }}
      />
      <div
        className="absolute top-1/2 left-1/4 w-24 h-24 bg-cyan-200 rounded-full blur-3xl opacity-50 animate-pulse"
        style={{ animationDelay: "1000ms" }}
      />

      <div className="relative w-full max-w-6xl grid md:grid-cols-2 gap-8 items-center">
        {/* Painel Esquerdo - Informações */}
        <div className="hidden md:block space-y-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Zap className="w-10 h-10 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="fl-title-page text-4xl">
                Fit<span className="text-emerald-500">Loot</span>
              </h1>
              <p className="text-gray-600">Transforme treinos em conquistas</p>
            </div>
          </div>

          <div className="space-y-6">
            <h2 className="fl-title-page leading-tight">
              Entre e comece a{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-500">
                evoluir hoje
              </span>
            </h2>

            <div className="space-y-4">
              {[
                { icon: Trophy, text: "Ganhe XP e suba de nível com cada treino" },
                { icon: Target, text: "Complete missões e desbloqueie conquistas" },
                { icon: Sparkles, text: "Troque pontos por cupons fitness reais" },
                { icon: Shield, text: "Sistema anti-trapaça com validação por sensores" },
              ].map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={idx}
                    className="fl-card-soft flex items-center gap-4 p-4 hover:shadow-lg transition-all"
                  >
                    <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-white" strokeWidth={2} />
                    </div>
                    <p className="text-gray-700 font-medium">{item.text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-6">
            {[
              { value: "10K+", label: "Usuários" },
              { value: "500K+", label: "Missões" },
              { value: "95%", label: "Sucesso" },
            ].map((stat, idx) => (
              <div
                key={idx}
                className="fl-card-soft text-center p-4"
              >
                <div className="text-2xl font-bold text-emerald-600">{stat.value}</div>
                <div className="text-sm text-gray-600">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Painel Direito - Formulário de Login */}
        <div className="relative">
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl p-8 md:p-10 border border-white/20">
            {/* Logo mobile */}
            <div className="md:hidden flex items-center gap-3 mb-8 justify-center">
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
                <Zap className="w-7 h-7 text-white" strokeWidth={2.5} />
              </div>
              <h1 className="fl-title-page">
                Fit<span className="text-emerald-500">Loot</span>
              </h1>
            </div>

            <div className="text-center mb-6">
              <h3 className="fl-title-section md:text-3xl mb-2">
                Bem-vindo de volta! 👋
              </h3>
              <p className="text-gray-600">Entre para continuar sua jornada épica</p>
            </div>

            {successMessage && (
              <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 text-sm">
                {successMessage}
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm space-y-2">
                <p>{error}</p>
                {userNotFound && (
                  <button
                    type="button"
                    onClick={goToOnboarding}
                    className="fl-btn-primary mt-2 w-full py-2 rounded-xl"
                  >
                    Criar minha conta
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {/* Campo de Email */}
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  type="email"
                  placeholder="seu@email.com"
                  value={form.email}
                  onChange={handleChange("email")}
                  autoComplete="email"
                  required
                  className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-gray-200 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 transition-all text-base"
                />
              </div>

              {/* Campo de Senha */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Senha
                </label>

                <div className="relative">
                  <Input
                    ref={passwordRef}
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={form.password}
                    onChange={handleChange("password")}
                    autoComplete="current-password"
                    required
                    className="w-full pr-12 py-4 rounded-2xl border-2 border-gray-200 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 transition-all text-base"
                  />

                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      setShowPassword((p) => !p);
                      e.currentTarget.blur();
                      // opcional: mantém o cursor no input após clicar no olho
                      passwordRef.current?.focus();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-400 transition hover:bg-gray-50 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading || !form.email || !form.password}
                className="fl-btn-primary w-full py-4 rounded-2xl text-base shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <LoadingBall size="sm" />
                    Entrando
                  </span>
                ) : (
                  <>
                    Entrar
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </>
                )}
              </Button>
            </form>

            {/* Footer */}
            <div className="mt-8 text-center">
              <p className="text-sm text-gray-600">
                Não tem uma conta?{" "}
                <button
                  type="button"
                  onClick={goToOnboarding}
                  className="font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
                >
                  Criar conta
                </button>
              </p>

              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-500">
                <Check className="w-4 h-4 text-emerald-500" />
                <span>7 dias grátis • Cancele quando quiser</span>
              </div>
            </div>

            {/* Trust indicators */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-center gap-6 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <Shield className="w-4 h-4 text-emerald-500" />
                  <span>Seguro</span>
                </div>
                <div className="flex items-center gap-1">
                  <Zap className="w-4 h-4 text-emerald-500" />
                  <span>Rápido</span>
                </div>
                <div className="flex items-center gap-1">
                  <Trophy className="w-4 h-4 text-emerald-500" />
                  <span>10K+ usuários</span>
                </div>
              </div>
            </div>
          </div>

          {/* Badge flutuante */}
          <div className="absolute -top-4 -right-4 bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-6 py-3 rounded-full shadow-xl transform rotate-12 hidden md:block">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              <span className="font-bold text-sm">7 dias grátis!</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
