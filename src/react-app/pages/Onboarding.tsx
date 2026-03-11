import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/App";
import { api } from "@/react-app/utils/api";
import { safeGet } from "@/utils/typeHelpers";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import { AuthThemeHeader, useAuthColorScheme } from "@/react-app/components/AuthThemeHeader";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  Dumbbell,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  HeartHandshake,
  HeartPulse,
  Lock,
  Mail,
  Monitor,
  Ruler,
  Scale,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  User,
  UserRound,
  Weight,
  Zap,
} from "lucide-react";

type ScrollPickerProps = {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  unit: string;
  label: string;
};

const FIELD_WRAP = "fl-auth-input-shell min-h-[3.5rem] rounded-[1.3rem]";
const FIELD_INPUT =
  "h-full w-full !border-0 !bg-transparent !p-0 text-base text-[var(--fl-auth-ink)] !shadow-none !ring-0 " +
  "placeholder:text-[var(--fl-auth-subtle)] focus-visible:!ring-0 focus-visible:!ring-offset-0";
const FIELD_TEXTAREA =
  "w-full resize-none !border-0 !bg-transparent !p-0 text-sm text-[var(--fl-auth-ink)] outline-none !shadow-none !ring-0 " +
  "placeholder:text-[var(--fl-auth-subtle)] focus-visible:!ring-0 focus-visible:!ring-offset-0";

function Field({
  label,
  hint,
  leftIcon,
  rightSlot,
  children,
}: {
  label: string;
  hint?: string;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">
          {label}
        </label>
        {hint ? <span className="text-xs text-[var(--fl-auth-subtle)]">{hint}</span> : null}
      </div>
      <div className={FIELD_WRAP}>
        {leftIcon ? <span className="text-[var(--fl-auth-subtle)]">{leftIcon}</span> : null}
        <div className="min-w-0 flex-1">{children}</div>
        {rightSlot ? <div className="flex items-center">{rightSlot}</div> : null}
      </div>
    </div>
  );
}

function ScrollPicker({ value, onChange, min, max, unit, label }: ScrollPickerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mouseActive: boolean; touchId: number | null }>({
    mouseActive: false,
    touchId: null,
  });
  const clamped = Math.min(max, Math.max(min, value));
  const percentage = max === min ? 0 : ((clamped - min) / (max - min)) * 100;

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const boundedRatio = Math.min(1, Math.max(0, ratio));
      const nextValue = Math.round(min + boundedRatio * (max - min));
      onChange(Math.min(max, Math.max(min, nextValue)));
    },
    [max, min, onChange],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragRef.current.mouseActive) return;
      updateFromClientX(event.clientX);
    };
    const handleMouseUp = () => {
      dragRef.current.mouseActive = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [updateFromClientX]);

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    dragRef.current.mouseActive = true;
    updateFromClientX(event.clientX);
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    dragRef.current.touchId = touch.identifier;
    updateFromClientX(touch.clientX);
  };

  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const activeTouch = Array.from(event.changedTouches).find(
      (touch) => touch.identifier === dragRef.current.touchId,
    );
    if (!activeTouch) return;
    updateFromClientX(activeTouch.clientX);
    event.preventDefault();
  };

  const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const activeTouch = Array.from(event.changedTouches).find(
      (touch) => touch.identifier === dragRef.current.touchId,
    );
    if (!activeTouch) return;
    dragRef.current.touchId = null;
  };

  return (
    <div className="fl-auth-substep rounded-[1.6rem] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--fl-auth-subtle)]">
            {label}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--fl-auth-muted)]">
            Deslize com o dedo para ajustar sem usar o controle nativo.
          </p>
        </div>
        <div className="rounded-[1.35rem] bg-[var(--fl-auth-card-selected)] px-4 py-3 text-right">
          <p className="text-3xl font-bold leading-none text-[var(--fl-auth-ink)] sm:text-4xl">
            {clamped}
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.28em] text-[var(--fl-auth-subtle)]">
            {unit}
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        <div
          ref={trackRef}
          className="relative h-12 touch-none select-none"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[var(--fl-auth-track)]" />
          <div
            className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
            style={{ width: `${percentage}%` }}
          />
          <div
            className="absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border-4 border-white bg-[var(--app-primary-color)] shadow-[0_0_24px_color-mix(in_srgb,var(--app-primary-color)_38%,transparent)]"
            style={{ left: `calc(${percentage}% - 12px)` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">
          <button type="button" onClick={() => onChange(Math.max(min, clamped - 1))}>
            {min} {unit}
          </button>
          <span>Deslize</span>
          <button type="button" onClick={() => onChange(Math.min(max, clamped + 1))}>
            {max} {unit}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExerciseValueRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const safeValue = Math.max(0, value);
  return (
    <div className="fl-auth-option rounded-[1.4rem] p-4" data-selected="false">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-base font-semibold">{label}</p>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--fl-auth-subtle)]">
            Toque nos valores laterais para ajustar
          </p>
        </div>
        <div className="grid min-w-[220px] grid-cols-3 gap-2 text-center">
          <button type="button" onClick={() => onChange(Math.max(0, safeValue - 1))} className="fl-auth-ghost-button rounded-[1rem] px-3 py-3 text-lg font-semibold transition">
            {Math.max(0, safeValue - 1)}
          </button>
          <button type="button" className="rounded-[1rem] bg-[var(--fl-auth-card-selected)] px-3 py-3 text-2xl font-bold text-[var(--app-primary-color)] shadow-[0_12px_30px_color-mix(in_srgb,var(--app-primary-color)_12%,transparent)]">
            {safeValue}
          </button>
          <button type="button" onClick={() => onChange(safeValue + 1)} className="fl-auth-ghost-button rounded-[1rem] px-3 py-3 text-lg font-semibold transition">
            {safeValue + 1}
          </button>
        </div>
      </div>
    </div>
  );
}

type CredentialsStep = { email: string; password: string; confirmPassword: string };
type ProfileStep = {
  username: string;
  full_name: string;
  weight: string;
  height: string;
  initial_conditioning: "sedentario" | "iniciante" | "intermediario" | "avancado";
  initial_pushups: string;
  initial_situps: string;
  initial_squats: string;
  injuries: string;
  equipment: string;
  main_goal: "perder_peso" | "ganhar_massa" | "resistencia" | "calistenia" | "saude_geral";
  gender: "homem" | "mulher" | "outro";
  age: string;
};
type GoalValue = ProfileStep["main_goal"];
type AvailabilityState = {
  status: "idle" | "checking" | "available" | "unavailable" | "invalid";
  message?: string | undefined;
};

const INITIAL_CREDENTIALS: CredentialsStep = { email: "", password: "", confirmPassword: "" };
const INITIAL_PROFILE: ProfileStep = {
  username: "",
  full_name: "",
  weight: "",
  height: "",
  initial_conditioning: "iniciante",
  initial_pushups: "0",
  initial_situps: "0",
  initial_squats: "0",
  injuries: "",
  equipment: "",
  main_goal: "saude_geral",
  gender: "homem",
  age: "25",
};
const STEP_NAMES = ["Identidade", "Perfil fisico", "Objetivo", "Capacidade", "Conta"] as const;
const STEP_ICONS = [UserRound, Ruler, Target, Activity, Shield];
const GOAL_OPTIONS = [
  { value: "perder_peso" as const, label: "Perder peso", description: "Circuitos mais dinamicos para acelerar gasto calorico.", icon: Flame },
  { value: "ganhar_massa" as const, label: "Ganhar massa muscular", description: "Foco em progressao de forca e construcao muscular.", icon: Dumbbell },
  { value: "resistencia" as const, label: "Melhorar condicionamento", description: "Treinos para ganhar folego, ritmo e recuperacao.", icon: Activity },
  { value: "saude_geral" as const, label: "Saude e qualidade de vida", description: "Plano equilibrado para movimento diario e bem-estar.", icon: HeartPulse },
  { value: "calistenia" as const, label: "Estetica e definicao", description: "Combina controle corporal, presenca visual e definicao.", icon: Gauge },
];
const CONDITIONING_OPTIONS = [
  { value: "sedentario" as const, label: "Sedentario", description: "Comeco seguro e progressivo.", icon: HeartHandshake },
  { value: "iniciante" as const, label: "Iniciante", description: "Quer estrutura guiada e previsivel.", icon: Zap },
  { value: "intermediario" as const, label: "Intermediario", description: "Tolera mais volume e ritmo.", icon: TrendingUp },
  { value: "avancado" as const, label: "Avancado", description: "Busca intensidade, variacao e metas mais altas.", icon: Shield },
];
const EQUIPMENT_OPTIONS = [
  { id: "halteres", label: "Halteres", icon: Dumbbell },
  { id: "barra", label: "Barra", icon: Monitor },
  { id: "anilhas", label: "Anilhas", icon: Scale },
  { id: "corda", label: "Corda", icon: Activity },
  { id: "elastico", label: "Elastico", icon: Zap },
  { id: "kettlebell", label: "Kettlebell", icon: Weight },
] as const;
const INJURY_OPTIONS = [
  { id: "joelho", label: "Joelho" },
  { id: "lombar", label: "Lombar" },
  { id: "ombro", label: "Ombro" },
  { id: "punho", label: "Punho" },
  { id: "tornozelo", label: "Tornozelo" },
  { id: "quadril", label: "Quadril" },
] as const;

function availabilityMessage(state: AvailabilityState): { tone: "green" | "red" | "muted"; text: string } | null {
  if (state.status === "available") return { tone: "green", text: "Disponivel" };
  if (state.status === "unavailable") return { tone: "red", text: state.message || "Ja cadastrado" };
  if (state.status === "invalid") return { tone: "red", text: state.message || "Valor invalido" };
  if (state.status === "checking") return { tone: "muted", text: "Validando..." };
  return null;
}

function parseDelimitedValues(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toneClass(tone: "green" | "red" | "muted") {
  if (tone === "green") return "text-emerald-500";
  if (tone === "red") return "text-red-500";
  return "text-[var(--fl-auth-subtle)]";
}
export default function Onboarding() {
  const { user, loading: authLoading, checkAuth } = useAuth();
  const navigate = useNavigate();
  const { colorScheme, toggleColorScheme } = useAuthColorScheme();

  const [currentStep, setCurrentStep] = useState(0);
  const [credentials, setCredentials] = useState(INITIAL_CREDENTIALS);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [stepError, setStepError] = useState<string | null>(null);
  const [stepLoading, setStepLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedGoals, setSelectedGoals] = useState<GoalValue[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [usernameAvailability, setUsernameAvailability] = useState<AvailabilityState>({ status: "idle" });
  const [emailAvailability, setEmailAvailability] = useState<AvailabilityState>({ status: "idle" });

  const usernameReqRef = useRef(0);
  const emailReqRef = useRef(0);
  const checkoutRedirectRef = useRef(false);
  const conditioningSectionRefs = useRef<Array<HTMLElement | null>>([]);
  const conditioningSubmitRef = useRef<HTMLButtonElement | null>(null);

  const totalSteps = 5;

  useEffect(() => {
    const email = sessionStorage.getItem("onboarding_email");
    if (email) {
      setCredentials((currentCredentials) => ({ ...currentCredentials, email }));
      sessionStorage.removeItem("onboarding_email");
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (user?.onboarding_completed === 1 && !checkoutRedirectRef.current) navigate("/home");
  }, [authLoading, navigate, user]);

  const setCredential = (field: keyof CredentialsStep) => (e: ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    setCredentials((currentCredentials) => ({ ...currentCredentials, [field]: nextValue }));
    if (field === "email") {
      setEmailAvailability({ status: "idle" });
    }
  };

  const setProfileField =
    (field: keyof ProfileStep) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const nextValue = e.target.value;
      setProfile((currentProfile) => ({ ...currentProfile, [field]: nextValue }));
      if (field === "username") {
        setUsernameAvailability({ status: "idle" });
      }
    };

  const validateUsername = useCallback(async (rawUsername: string) => {
    const username = rawUsername.trim();
    if (!username) {
      setUsernameAvailability({ status: "idle" });
      return true;
    }
    if (username.length < 3) {
      setUsernameAvailability({ status: "invalid", message: "Minimo de 3 caracteres." });
      return false;
    }

    const requestId = ++usernameReqRef.current;
    setUsernameAvailability({ status: "checking" });

    try {
      const response = await api(`/api/auth/check-availability?username=${encodeURIComponent(username)}`);
      const payload = (await response.json().catch(() => null)) as { usernameAvailable?: boolean | undefined } | null;

      if (requestId !== usernameReqRef.current) return false;
      if (!response.ok || payload?.usernameAvailable === undefined) {
        setUsernameAvailability({ status: "invalid", message: "Nao foi possivel validar agora." });
        return false;
      }
      if (!payload.usernameAvailable) {
        setUsernameAvailability({ status: "unavailable", message: "Nome de usuario ja esta em uso." });
        return false;
      }

      setUsernameAvailability({ status: "available" });
      return true;
    } catch {
      if (requestId === usernameReqRef.current) {
        setUsernameAvailability({ status: "invalid", message: "Erro de conexao ao validar." });
      }
      return false;
    }
  }, []);

  const validateEmail = useCallback(async (rawEmail: string) => {
    const email = rawEmail.trim().toLowerCase();
    if (!email) {
      setEmailAvailability({ status: "idle" });
      return true;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setEmailAvailability({ status: "invalid", message: "E-mail invalido." });
      return false;
    }

    const requestId = ++emailReqRef.current;
    setEmailAvailability({ status: "checking" });

    try {
      const response = await api(`/api/auth/check-availability?email=${encodeURIComponent(email)}`);
      const payload = (await response.json().catch(() => null)) as { emailAvailable?: boolean | undefined } | null;

      if (requestId !== emailReqRef.current) return false;
      if (!response.ok || payload?.emailAvailable === undefined) {
        setEmailAvailability({ status: "invalid", message: "Nao foi possivel validar agora." });
        return false;
      }
      if (!payload.emailAvailable) {
        setEmailAvailability({ status: "unavailable", message: "E-mail ja esta cadastrado." });
        return false;
      }

      setEmailAvailability({ status: "available" });
      return true;
    } catch {
      if (requestId === emailReqRef.current) {
        setEmailAvailability({ status: "invalid", message: "Erro de conexao ao validar." });
      }
      return false;
    }
  }, []);

  useEffect(() => {
    const username = profile.username.trim();
    if (!username) {
      setUsernameAvailability({ status: "idle" });
      return;
    }
    const timer = setTimeout(() => {
      void validateUsername(username);
    }, 600);
    return () => clearTimeout(timer);
  }, [profile.username, validateUsername]);

  useEffect(() => {
    const email = credentials.email.trim();
    if (!email) {
      setEmailAvailability({ status: "idle" });
      return;
    }
    const timer = setTimeout(() => {
      void validateEmail(email);
    }, 600);
    return () => clearTimeout(timer);
  }, [credentials.email, validateEmail]);

  const handleIdentityNext = (e: FormEvent) => {
    e.preventDefault();
    setStepError(null);

    if (!profile.full_name.trim() || !profile.username.trim() || profile.username.length < 3) {
      setStepError("Preencha nome completo e nome de usuario (min. 3 caracteres).");
      return;
    }
    if (
      usernameAvailability.status === "checking" ||
      usernameAvailability.status === "unavailable" ||
      usernameAvailability.status === "invalid"
    ) {
      setStepError(usernameAvailability.message ?? "Escolha um nome de usuario disponivel.");
      return;
    }

    const ageNum = parseInt(profile.age, 10);
    if (!Number.isFinite(ageNum) || ageNum < 13 || ageNum > 80) {
      setStepError("Idade deve ser entre 13 e 80 anos.");
      return;
    }

    setCurrentStep(1);
  };

  const handleBodyNext = (e: FormEvent) => {
    e.preventDefault();
    setStepError(null);

    const weight = Number(profile.weight);
    const height = Number(profile.height);

    if (
      !Number.isFinite(weight) ||
      weight < 40 ||
      weight > 200 ||
      !Number.isFinite(height) ||
      height < 140 ||
      height > 220
    ) {
      setStepError("Altura (140-220 cm) e peso (40-200 kg) devem estar no intervalo valido.");
      return;
    }

    setCurrentStep(2);
  };

  const handleGoalsNext = (e: FormEvent) => {
    e.preventDefault();
    setStepError(null);

    if (selectedGoals.length === 0) {
      setStepError("Escolha pelo menos um objetivo.");
      return;
    }

    setProfile((currentProfile) => ({
      ...currentProfile,
      main_goal: safeGet(selectedGoals, 0) ?? currentProfile.main_goal,
    }));
    setCurrentStep(3);
  };

  const handleConditioningNext = (e: FormEvent) => {
    e.preventDefault();
    setStepError(null);

    const pushups = Number(profile.initial_pushups) || 0;
    const situps = Number(profile.initial_situps) || 0;
    const squats = Number(profile.initial_squats) || 0;

    if (pushups < 0 || situps < 0 || squats < 0) {
      setStepError("Valores dos contadores nao podem ser negativos.");
      return;
    }

    setCurrentStep(4);
  };
  const handlePlanAndCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStepError(null);

    if (
      !credentials.email ||
      !credentials.password ||
      credentials.password.length < 8 ||
      credentials.password !== credentials.confirmPassword
    ) {
      setStepError(
        credentials.password.length < 8
          ? "A senha deve ter pelo menos 8 caracteres"
          : credentials.password !== credentials.confirmPassword
            ? "As senhas nao coincidem"
            : "Preencha e-mail e senha.",
      );
      return;
    }

    if (!profile.full_name.trim()) {
      setStepError("Preencha seu nome completo na etapa de Identidade.");
      return;
    }

    if (
      emailAvailability.status === "checking" ||
      emailAvailability.status === "unavailable" ||
      emailAvailability.status === "invalid"
    ) {
      setStepError(emailAvailability.message ?? "Use um e-mail disponivel para criar a conta.");
      return;
    }

    setStepLoading(true);

    try {
      const registerRes = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
          name: profile.full_name.trim(),
        }),
      });

      if (registerRes.status === 409) {
        setStepError("Este e-mail ja esta cadastrado.");
        setStepLoading(false);
        return;
      }
      if (!registerRes.ok) {
        setStepError("Erro ao criar conta.");
        setStepLoading(false);
        return;
      }

      const loginRes = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      });

      if (!loginRes.ok) {
        setStepError("Conta criada. Faca login em /app");
        setStepLoading(false);
        return;
      }

      localStorage.setItem("fitloot_authenticated_hint", "1");
      await checkAuth();

      const patchRes = await api("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ name: profile.full_name.trim() }),
      });

      if (!patchRes.ok) {
        setStepError("Erro ao atualizar perfil.");
        setStepLoading(false);
        return;
      }

      const equipmentStr = [...selectedEquipment, profile.equipment].filter(Boolean).join(", ");
      const mainGoal = safeGet(selectedGoals, 0) ?? profile.main_goal;

      const res = await api("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({
          username: profile.username.trim(),
          full_name: profile.full_name.trim(),
          weight: Number(profile.weight),
          height: Number(profile.height),
          initial_conditioning: profile.initial_conditioning,
          initial_pushups: Number(profile.initial_pushups) || 0,
          initial_situps: Number(profile.initial_situps) || 0,
          initial_squats: Number(profile.initial_squats) || 0,
          injuries: profile.injuries || undefined,
          equipment: equipmentStr || undefined,
          main_goal: mainGoal,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStepError((data as { error?: string | undefined }).error ?? "Erro ao salvar perfil.");
        setStepLoading(false);
        return;
      }

      checkoutRedirectRef.current = true;
      await checkAuth();
      navigate("/checkout");
    } catch {
      setStepError("Nao foi possivel conectar ao servidor.");
    } finally {
      setStepLoading(false);
    }
  };

  const toggleInjurySelection = (injuryId: string) => {
    setProfile((currentProfile) => {
      const existing = new Set(parseDelimitedValues(currentProfile.injuries.toLowerCase()));
      if (existing.has(injuryId)) existing.delete(injuryId);
      else existing.add(injuryId);
      return { ...currentProfile, injuries: Array.from(existing).join(", ") };
    });
  };

  const scrollToConditioningSection = (index: number) => {
    const targetNode =
      index >= conditioningSectionRefs.current.length
        ? conditioningSubmitRef.current
        : conditioningSectionRefs.current[index];
    targetNode?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (authLoading) {
    return (
      <div className="fl-auth-page fl-auth-funnel-page">
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
          <AuthThemeHeader colorScheme={colorScheme} onToggleColorScheme={toggleColorScheme} />
          <div className="flex flex-1 items-center justify-center">
            <div className="fl-auth-panel rounded-[2rem] px-6 py-12 text-center">
              <div className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--app-primary-color)]">
                Carregando onboarding
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const progress = ((currentStep + 1) / totalSteps) * 100;
  const ActiveStepIcon = STEP_ICONS[currentStep] ?? Shield;
  const activeGoals = selectedGoals.length > 0 ? selectedGoals : [profile.main_goal];
  const activeGoalLabels = activeGoals
    .map((goal) => GOAL_OPTIONS.find((option) => option.value === goal)?.label)
    .filter(Boolean) as string[];
  const conditioningLabel =
    ({ sedentario: "Sedentario", iniciante: "Iniciante", intermediario: "Intermediario", avancado: "Avancado" } as const)[profile.initial_conditioning];
  const heroName = profile.full_name.trim().split(" ")[0] || "Voce";
  const injuryTokens = parseDelimitedValues(profile.injuries.toLowerCase());
  const usernameStatusMessage = availabilityMessage(usernameAvailability);
  const emailStatusMessage = availabilityMessage(emailAvailability);
  const cadenceSuggestion =
    profile.initial_conditioning === "sedentario"
      ? { focus: "2x / semana", text: "Comece com sessoes curtas para construir consistencia sem sobrecarga." }
      : profile.initial_conditioning === "iniciante"
        ? { focus: "3x / semana", text: "Uma rotina moderada ajuda a ganhar ritmo e manter recuperacao." }
        : profile.initial_conditioning === "intermediario"
          ? { focus: "4x / semana", text: "Voce ja tolera mais volume, entao a progressao pode acelerar." }
          : { focus: "5x / semana", text: "Intensidade alta com distribuicao inteligente para sustentar performance." };

  return (
    <div className="fl-auth-page fl-auth-funnel-page">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-[var(--fl-auth-primary-soft)] blur-3xl" />
        <div className="absolute right-[-4rem] top-[18%] h-96 w-96 rounded-full bg-[var(--fl-auth-secondary-soft)] blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/3 h-72 w-72 rounded-full bg-[var(--fl-auth-primary-soft)] blur-3xl" />
      </div>

      {currentStep === 4 && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center px-4 animate-slideDown lg:top-6 lg:justify-end lg:px-8">
          <a href="/app-release.apk" download="app-release (1).apk" className="pointer-events-auto fl-auth-pill rounded-full px-4 py-2 text-[11px] tracking-[0.18em]">
            <Download className="h-4 w-4" />
            Baixar app Android
          </a>
        </div>
      )}

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <AuthThemeHeader colorScheme={colorScheme} onToggleColorScheme={toggleColorScheme} />
        <div className="flex flex-1 items-center justify-center py-4 lg:py-8">
          <div className="fl-auth-shell">
            <aside className="fl-auth-panel fl-auth-hero order-1 rounded-[2rem] p-6 sm:p-8 lg:p-10">
              <div className="space-y-4 lg:hidden">
                <div className="flex items-center justify-between gap-4">
                  <span className="fl-auth-pill"><ActiveStepIcon className="h-3.5 w-3.5" />Etapa {currentStep + 1}/{totalSteps}</span>
                  <span className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">{Math.round(progress)}%</span>
                </div>
                <div className="fl-auth-progress-track"><div className="fl-auth-progress-fill" style={{ width: `${progress}%` }} /></div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[var(--app-primary-color)]">{STEP_NAMES[currentStep]}</p>
                  <h1 className="mt-2 text-3xl font-bold tracking-tight">{currentStep === 2 ? "Escolha seu objetivo." : currentStep === 4 ? "Sua conta esta quase pronta." : "Configure sua jornada."}</h1>
                  <p className="mt-2 text-sm leading-6 text-[var(--fl-auth-muted)]">{heroName}, os mesmos dados e validacoes agora aparecem dentro do mesmo shell visual do login.</p>
                </div>
              </div>

              <div className="hidden h-full flex-col justify-between lg:flex">
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4">
                    <span className="fl-auth-pill"><ActiveStepIcon className="h-3.5 w-3.5" />Step {String(currentStep + 1).padStart(2, "0")}/{String(totalSteps).padStart(2, "0")}</span>
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">{Math.round(progress)}%</span>
                  </div>
                  <div className="fl-auth-progress-track"><div className="fl-auth-progress-fill" style={{ width: `${progress}%` }} /></div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[var(--app-primary-color)]">{STEP_NAMES[currentStep]}</p>
                    <h1 className="mt-3 max-w-[12ch] text-5xl font-bold leading-[1.02] tracking-tight xl:text-6xl">{currentStep === 2 ? "Escolha seu objetivo." : currentStep === 3 ? "Mapeie sua capacidade." : currentStep === 4 ? "Sua conta esta quase pronta." : "Configure sua jornada."}</h1>
                    <p className="mt-4 max-w-xl text-base leading-7 text-[var(--fl-auth-muted)] xl:text-lg">O onboarding agora acompanha o login com o mesmo header, o mesmo toggle de tema e a mesma linguagem de cards, botoes e tipografia.</p>
                  </div>
                  <div className="space-y-3">
                    {[
                      { icon: Sparkles, title: "Visual continuo", text: "Logo e toggle ficam na mesma posicao do login redesenhado." },
                      { icon: Target, title: "Foco atual", text: activeGoalLabels.length > 0 ? activeGoalLabels.join(" • ") : "Objetivo ainda nao definido" },
                      { icon: Activity, title: "Condicionamento", text: conditioningLabel },
                    ].map((item) => {
                      const Icon = item.icon;
                      return (
                        <article key={item.title} className="fl-auth-option rounded-[1.5rem] p-4" data-selected="false">
                          <div className="flex items-start gap-4">
                            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--fl-auth-primary-soft)] text-[var(--app-primary-color)]"><Icon className="h-5 w-5" strokeWidth={2.2} /></div>
                            <div className="space-y-1"><h2 className="text-lg font-semibold">{item.title}</h2><p className="text-sm leading-6 text-[var(--fl-auth-muted)]">{item.text}</p></div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: activeGoalLabels.length > 0 ? activeGoalLabels.length : 0, label: "Objetivos" },
                    { value: profile.height || "170", label: "Altura" },
                    { value: profile.age || "25", label: "Idade" },
                  ].map((item) => (
                    <div key={item.label} className="fl-auth-option rounded-[1.35rem] p-4 text-center" data-selected="false">
                      <p className="text-xl font-bold text-[var(--app-primary-color)]">{item.value}</p>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--fl-auth-subtle)]">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            <main className="fl-auth-panel order-2 rounded-[2rem] p-5 sm:p-7 lg:p-8">
              {stepError && (
                <div className="mb-5 space-y-3 rounded-[1.35rem] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                  <p>{stepError}</p>
                  {stepError.includes("ja esta cadastrado") && <Button type="button" onClick={() => navigate("/app")} className="w-full">Fazer login</Button>}
                </div>
              )}
              {currentStep === 0 && (
                <form onSubmit={handleIdentityNext} className="space-y-6 animate-authStepEnter">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--app-primary-color)]">Identidade inicial</p>
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Configure a base do seu perfil.</h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--fl-auth-muted)]">Os mesmos campos continuam sendo coletados, agora com hierarquia visual mais forte e leitura mais clara em qualquer tema.</p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Nome completo" leftIcon={<UserRound className="h-4 w-4" />}>
                      <Input value={profile.full_name} onChange={setProfileField("full_name")} placeholder="Seu nome completo" className={FIELD_INPUT} />
                    </Field>

                    <div className="space-y-2">
                      <Field
                        label="Nome de usuario"
                        leftIcon={<User className="h-4 w-4" />}
                        rightSlot={
                          usernameAvailability.status === "checking" ? (
                            <span className="text-xs text-[var(--fl-auth-subtle)]">...</span>
                          ) : usernameAvailability.status === "available" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : null
                        }
                      >
                        <Input value={profile.username} onChange={setProfileField("username")} onBlur={() => { void validateUsername(profile.username); }} placeholder="nome_de_usuario" minLength={3} className={FIELD_INPUT} />
                      </Field>
                      {availabilityMessage(usernameAvailability) && <p className={`text-xs ${toneClass(availabilityMessage(usernameAvailability)?.tone ?? "muted")}`}>{availabilityMessage(usernameAvailability)?.text}</p>}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3">
                      <label className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">Genero</label>
                      <p className="mt-2 text-sm leading-6 text-[var(--fl-auth-muted)]">Esse dado ajuda a calibrar o plano inicial sem mexer na logica existente.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {([
                        { value: "homem", label: "Masculino", icon: Shield },
                        { value: "mulher", label: "Feminino", icon: Sparkles },
                        { value: "outro", label: "Prefiro nao dizer", icon: HeartHandshake },
                      ] as const).map((option) => {
                        const Icon = option.icon;
                        return (
                          <button key={option.value} type="button" onClick={() => setProfile((currentProfile) => ({ ...currentProfile, gender: option.value }))} className="fl-auth-option rounded-[1.4rem] px-4 py-4 text-left transition" data-selected={profile.gender === option.value}>
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--fl-auth-primary-soft)] text-[var(--app-primary-color)]"><Icon className="h-4 w-4" strokeWidth={2.2} /></div>
                              <div><p className="font-semibold">{option.label}</p><p className="text-xs uppercase tracking-[0.22em] text-[var(--fl-auth-subtle)]">Selecao ativa</p></div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <ScrollPicker label="Idade" value={Math.min(80, Math.max(13, parseInt(profile.age, 10) || 25))} onChange={(nextValue) => setProfile((currentProfile) => ({ ...currentProfile, age: String(nextValue) }))} min={13} max={80} unit="anos" />

                  <Button type="submit" size="lg" className="fl-auth-cta h-14 w-full rounded-[1.15rem] text-base font-semibold disabled:opacity-50" disabled={usernameAvailability.status === "checking" || usernameAvailability.status === "unavailable" || usernameAvailability.status === "invalid"}>
                    Continuar
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </form>
              )}

              {currentStep === 1 && (
                <form onSubmit={handleBodyNext} className="space-y-6 animate-authStepEnter">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--app-primary-color)]">Perfil fisico</p>
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ajuste altura e peso com o dedo.</h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--fl-auth-muted)]">A etapa continua validando os mesmos intervalos de antes, agora com sliders customizados para toque.</p>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <ScrollPicker label="Altura" value={Math.min(220, Math.max(140, Number(profile.height) || 170))} onChange={(nextValue) => setProfile((currentProfile) => ({ ...currentProfile, height: String(nextValue) }))} min={140} max={220} unit="cm" />
                    <ScrollPicker label="Peso" value={Math.min(200, Math.max(40, Number(profile.weight) || 70))} onChange={(nextValue) => setProfile((currentProfile) => ({ ...currentProfile, weight: String(nextValue) }))} min={40} max={200} unit="kg" />
                  </div>

                  <div className="fl-auth-option rounded-[1.45rem] p-4" data-selected="false">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--fl-auth-primary-soft)] text-[var(--app-primary-color)]"><Scale className="h-4 w-4" strokeWidth={2.2} /></div>
                      <div><p className="font-semibold">Faixa ativa</p><p className="text-sm text-[var(--fl-auth-muted)]">Altura entre 140-220 cm e peso entre 40-200 kg continuam sendo a regra.</p></div>
                    </div>
                  </div>

                  <Button type="submit" size="lg" className="fl-auth-cta h-14 w-full rounded-[1.15rem] text-base font-semibold">
                    Continuar
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </form>
              )}

              {currentStep === 2 && (
                <form onSubmit={handleGoalsNext} className="space-y-6 animate-authStepEnter">
                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--app-primary-color)]">Objective selection</p>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">escolha um ou mais</p>
                    </div>
                    <div>
                      <h2 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Escolha seu <span className="text-[var(--app-primary-color)]">objetivo.</span></h2>
                      <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--fl-auth-muted)] sm:text-base">As opcoes continuam alimentando o mesmo estado atual, mas com cards grandes e legibilidade mais proxima da referencia visual.</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {GOAL_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      const isSelected = selectedGoals.includes(option.value);
                      return (
                        <button key={option.value} type="button" onClick={() => setSelectedGoals((currentGoals) => isSelected ? currentGoals.filter((goal) => goal !== option.value) : [...currentGoals, option.value])} className="fl-auth-option flex w-full items-center gap-4 rounded-[1.55rem] px-5 py-5 text-left transition" data-selected={isSelected}>
                          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--fl-auth-primary-soft)] text-[var(--app-primary-color)]"><Icon className="h-5 w-5" strokeWidth={2.2} /></div>
                          <div className="min-w-0 flex-1"><p className="text-lg font-semibold sm:text-xl">{option.label}</p><p className="mt-1 text-sm leading-6 text-[var(--fl-auth-muted)]">{option.description}</p></div>
                          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/5">{isSelected ? <CheckCircle2 className="h-5 w-5 text-[var(--app-primary-color)]" /> : <span className="h-3 w-3 rounded-full border border-[var(--fl-auth-subtle)]" />}</div>
                        </button>
                      );
                    })}
                  </div>

                  <Button type="submit" disabled={selectedGoals.length === 0} size="lg" className="fl-auth-cta h-14 w-full rounded-[1.15rem] text-base font-semibold disabled:opacity-50">
                    Continuar
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </form>
              )}

              {currentStep === 3 && (
                <form onSubmit={handleConditioningNext} className="space-y-6 animate-authStepEnter">
                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--app-primary-color)]">Perfil fisico detalhado</p>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">sub-etapas 2.1 a 2.9</p>
                    </div>
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Mapeie sua capacidade atual.</h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--fl-auth-muted)]">As mesmas informacoes continuam indo para o mesmo payload, mas agora organizadas em blocos claros, com progresso e acoes de toque mais legiveis.</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[
                      { code: "2.1", label: "Condicionamento" },
                      { code: "2.3", label: "Exercicios" },
                      { code: "2.5", label: "Lesoes" },
                      { code: "2.7", label: "Equipamentos" },
                      { code: "2.9", label: "Cadencia" },
                    ].map((item, index) => (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => scrollToConditioningSection(index)}
                        className="fl-auth-pill"
                      >
                        <span>{item.code}</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>

                  <section
                    ref={(node) => {
                      conditioningSectionRefs.current[0] = node;
                    }}
                    className="fl-auth-substep rounded-[1.7rem] p-5 sm:p-6"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--app-primary-color)]">Sub-etapa 2.1</p>
                        <h3 className="text-2xl font-bold tracking-tight">Condicionamento atual</h3>
                        <p className="text-sm leading-6 text-[var(--fl-auth-muted)]">Escolha a base que mais representa seu momento fisico.</p>
                      </div>
                      <button type="button" onClick={() => scrollToConditioningSection(1)} className="fl-auth-skip">
                        Pular
                      </button>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {CONDITIONING_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              setProfile((currentProfile) => ({
                                ...currentProfile,
                                initial_conditioning: option.value,
                              }))
                            }
                            className="fl-auth-option rounded-[1.45rem] p-4 text-left transition"
                            data-selected={profile.initial_conditioning === option.value}
                          >
                            <div className="flex items-start gap-4">
                              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--fl-auth-primary-soft)] text-[var(--app-primary-color)]">
                                <Icon className="h-5 w-5" strokeWidth={2.2} />
                              </div>
                              <div className="space-y-1">
                                <p className="text-lg font-semibold">{option.label}</p>
                                <p className="text-sm leading-6 text-[var(--fl-auth-muted)]">{option.description}</p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section
                    ref={(node) => {
                      conditioningSectionRefs.current[1] = node;
                    }}
                    className="fl-auth-substep rounded-[1.7rem] p-5 sm:p-6"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--app-primary-color)]">Sub-etapa 2.3</p>
                        <h3 className="text-2xl font-bold tracking-tight">Capacidade inicial</h3>
                        <p className="text-sm leading-6 text-[var(--fl-auth-muted)]">Cada linha mostra tres valores, com o valor central em destaque e suporte a toque nos laterais.</p>
                      </div>
                      <button type="button" onClick={() => scrollToConditioningSection(2)} className="fl-auth-skip">
                        Pular
                      </button>
                    </div>

                    <div className="mt-5 space-y-3">
                      <ExerciseValueRow
                        label="Flexoes"
                        value={Number(profile.initial_pushups) || 0}
                        onChange={(nextValue) =>
                          setProfile((currentProfile) => ({
                            ...currentProfile,
                            initial_pushups: String(nextValue),
                          }))
                        }
                      />
                      <ExerciseValueRow
                        label="Abdominais"
                        value={Number(profile.initial_situps) || 0}
                        onChange={(nextValue) =>
                          setProfile((currentProfile) => ({
                            ...currentProfile,
                            initial_situps: String(nextValue),
                          }))
                        }
                      />
                      <ExerciseValueRow
                        label="Agachamentos"
                        value={Number(profile.initial_squats) || 0}
                        onChange={(nextValue) =>
                          setProfile((currentProfile) => ({
                            ...currentProfile,
                            initial_squats: String(nextValue),
                          }))
                        }
                      />
                    </div>
                  </section>

                  <section
                    ref={(node) => {
                      conditioningSectionRefs.current[2] = node;
                    }}
                    className="fl-auth-substep rounded-[1.7rem] p-5 sm:p-6"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--app-primary-color)]">Sub-etapa 2.5</p>
                        <h3 className="text-2xl font-bold tracking-tight">Lesoes e limitacoes</h3>
                        <p className="text-sm leading-6 text-[var(--fl-auth-muted)]">Use a grade para selecao multipla e complemente com observacoes livres se precisar.</p>
                      </div>
                      <button type="button" onClick={() => scrollToConditioningSection(3)} className="fl-auth-skip">
                        Pular
                      </button>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {INJURY_OPTIONS.map((injury) => {
                        const isSelected = injuryTokens.includes(injury.id);
                        return (
                          <button
                            key={injury.id}
                            type="button"
                            onClick={() => toggleInjurySelection(injury.id)}
                            className="fl-auth-option rounded-[1.2rem] px-4 py-3 text-left transition"
                            data-selected={isSelected}
                          >
                            <span className="text-sm font-semibold">{injury.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4">
                      <Field label="Observacoes adicionais" hint="Opcional">
                        <textarea
                          value={profile.injuries}
                          onChange={(event) =>
                            setProfile((currentProfile) => ({
                              ...currentProfile,
                              injuries: event.target.value,
                            }))
                          }
                          placeholder="Ex: incomodo no joelho ao descer escadas, lombar sensivel..."
                          rows={3}
                          className={FIELD_TEXTAREA}
                        />
                      </Field>
                    </div>
                  </section>

                  <section
                    ref={(node) => {
                      conditioningSectionRefs.current[3] = node;
                    }}
                    className="fl-auth-substep rounded-[1.7rem] p-5 sm:p-6"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--app-primary-color)]">Sub-etapa 2.7</p>
                        <h3 className="text-2xl font-bold tracking-tight">Equipamentos disponiveis</h3>
                        <p className="text-sm leading-6 text-[var(--fl-auth-muted)]">Selecao multipla em grade, mantendo o campo livre para itens extras que nao aparecem na lista.</p>
                      </div>
                      <button type="button" onClick={() => scrollToConditioningSection(4)} className="fl-auth-skip">
                        Pular
                      </button>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {EQUIPMENT_OPTIONS.map((equipmentOption) => {
                        const Icon = equipmentOption.icon;
                        const isSelected = selectedEquipment.includes(equipmentOption.id);
                        return (
                          <button
                            key={equipmentOption.id}
                            type="button"
                            onClick={() =>
                              setSelectedEquipment((currentEquipment) =>
                                isSelected
                                  ? currentEquipment.filter((item) => item !== equipmentOption.id)
                                  : [...currentEquipment, equipmentOption.id],
                              )
                            }
                            className="fl-auth-option rounded-[1.2rem] px-4 py-4 text-left transition"
                            data-selected={isSelected}
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--fl-auth-primary-soft)] text-[var(--app-primary-color)]">
                                <Icon className="h-4 w-4" strokeWidth={2.2} />
                              </div>
                              <span className="font-semibold">{equipmentOption.label}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4">
                      <Field label="Outros equipamentos" hint="Opcional">
                        <Input
                          value={profile.equipment}
                          onChange={setProfileField("equipment")}
                          placeholder="Ex: banco, colchonete, paralelas..."
                          className={FIELD_INPUT}
                        />
                      </Field>
                    </div>
                  </section>

                  <section
                    ref={(node) => {
                      conditioningSectionRefs.current[4] = node;
                    }}
                    className="fl-auth-substep rounded-[1.7rem] p-5 sm:p-6"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--app-primary-color)]">Sub-etapa 2.9</p>
                        <h3 className="text-2xl font-bold tracking-tight">Cadencia semanal sugerida</h3>
                        <p className="text-sm leading-6 text-[var(--fl-auth-muted)]">Sem alterar o payload atual, a interface mostra uma recomendacao dinamica baseada no condicionamento escolhido.</p>
                      </div>
                      <button type="button" onClick={() => conditioningSubmitRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="fl-auth-skip">
                        Pular
                      </button>
                    </div>

                    <div className="mt-5 space-y-4">
                      <div className="grid gap-3 sm:grid-cols-4">
                        {[
                          "2x / semana",
                          "3x / semana",
                          "4x / semana",
                          "5x / semana",
                        ].map((slot) => (
                          <div
                            key={slot}
                            className="fl-auth-option rounded-[1.2rem] px-4 py-4 text-center"
                            data-selected={cadenceSuggestion.focus === slot}
                          >
                            <p className="text-sm font-semibold">{slot}</p>
                          </div>
                        ))}
                      </div>
                      <div className="fl-auth-option rounded-[1.35rem] p-4" data-selected="true">
                        <p className="text-lg font-semibold text-[var(--app-primary-color)]">{cadenceSuggestion.focus}</p>
                        <p className="mt-2 text-sm leading-6 text-[var(--fl-auth-muted)]">{cadenceSuggestion.text}</p>
                      </div>
                    </div>
                  </section>

                  <Button
                    ref={conditioningSubmitRef}
                    type="submit"
                    size="lg"
                    className="fl-auth-cta h-14 w-full rounded-[1.15rem] text-base font-semibold"
                  >
                    Continuar
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </form>
              )}

              {currentStep === 4 && (
                <form onSubmit={handlePlanAndCredentialsSubmit} className="space-y-6 animate-authStepEnter">
                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--app-primary-color)]">Criacao da conta</p>
                      <span className="fl-auth-pill">
                        <Shield className="h-3.5 w-3.5" />
                        pronto para finalizar
                      </span>
                    </div>
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Finalize sua conta e siga para o checkout.</h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--fl-auth-muted)]">O onboarding termina aqui com a criacao da conta. A escolha de plano e o pagamento seguem em uma tela separada.</p>
                    </div>
                  </div>

                  <section className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                    <div className="fl-auth-option rounded-[1.6rem] p-5" data-selected="true">
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--fl-auth-primary-soft)] text-[var(--app-primary-color)]">
                          <Sparkles className="h-5 w-5" strokeWidth={2.2} />
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--app-primary-color)]">Resumo do funil</p>
                          <h3 className="text-2xl font-bold tracking-tight">{heroName}, sua jornada inicial ja foi configurada.</h3>
                          <p className="text-sm leading-6 text-[var(--fl-auth-muted)]">Objetivo, condicionamento, capacidade, equipamentos e limitacoes ja estao prontos para alimentar o plano. O proximo passo e apenas concluir a conta e seguir para o checkout.</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                      {[
                        { icon: CheckCircle2, title: "Validacao em tempo real", text: "Username e e-mail seguem com feedback visual imediato." },
                        { icon: TrendingUp, title: "Dados preservados", text: "Nada do que foi preenchido no onboarding se perde ao seguir para o checkout." },
                        { icon: Shield, title: "Checkout separado", text: "Plano e pagamento saem do onboarding e seguem em uma rota propria." },
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <article key={item.title} className="fl-auth-option rounded-[1.35rem] p-4" data-selected="false">
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--fl-auth-primary-soft)] text-[var(--app-primary-color)]">
                                <Icon className="h-4 w-4" strokeWidth={2.2} />
                              </div>
                              <div>
                                <p className="font-semibold">{item.title}</p>
                                <p className="mt-1 text-sm leading-6 text-[var(--fl-auth-muted)]">{item.text}</p>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>

                  <section className="space-y-4 border-t border-[var(--fl-auth-card-border)] pt-5">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--fl-auth-subtle)]">Criacao de conta</p>
                      <h3 className="text-2xl font-bold tracking-tight">Revise seus dados e finalize o acesso.</h3>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Nome completo" leftIcon={<UserRound className="h-4 w-4" />}>
                        <Input
                          value={profile.full_name}
                          onChange={setProfileField("full_name")}
                          placeholder="Seu nome completo"
                          className={FIELD_INPUT}
                        />
                      </Field>

                      <div className="space-y-2">
                        <Field
                          label="Nome de usuario"
                          leftIcon={<User className="h-4 w-4" />}
                          rightSlot={
                            usernameAvailability.status === "checking" ? (
                              <span className="text-xs text-[var(--fl-auth-subtle)]">...</span>
                            ) : usernameAvailability.status === "available" ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : null
                          }
                        >
                          <Input
                            value={profile.username}
                            onChange={setProfileField("username")}
                            onBlur={() => {
                              void validateUsername(profile.username);
                            }}
                            placeholder="nome_de_usuario"
                            minLength={3}
                            className={FIELD_INPUT}
                          />
                        </Field>
                        {usernameStatusMessage ? (
                          <p className={`text-xs ${toneClass(usernameStatusMessage.tone)}`}>{usernameStatusMessage.text}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Field
                        label="Email"
                        leftIcon={<Mail className="h-4 w-4" />}
                        rightSlot={
                          emailAvailability.status === "checking" ? (
                            <span className="text-xs text-[var(--fl-auth-subtle)]">...</span>
                          ) : emailAvailability.status === "available" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : null
                        }
                      >
                        <Input
                          type="email"
                          value={credentials.email}
                          onChange={setCredential("email")}
                          onBlur={() => {
                            void validateEmail(credentials.email);
                          }}
                          placeholder="seu@email.com"
                          className={FIELD_INPUT}
                        />
                      </Field>
                      {emailStatusMessage ? (
                        <p className={`text-xs ${toneClass(emailStatusMessage.tone)}`}>{emailStatusMessage.text}</p>
                      ) : null}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field
                        label="Senha"
                        leftIcon={<Lock className="h-4 w-4" />}
                        hint="minimo 8 caracteres"
                        rightSlot={
                          <button
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                            }}
                            onClick={() => setShowPassword((currentValue) => !currentValue)}
                            className="rounded-full p-2 text-[var(--fl-auth-subtle)] transition hover:bg-white/10 hover:text-[var(--fl-auth-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                            title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                          >
                            {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </button>
                        }
                      >
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={credentials.password}
                          onChange={setCredential("password")}
                          placeholder="Senha segura"
                          minLength={8}
                          className={FIELD_INPUT}
                        />
                      </Field>

                      <Field label="Confirmar senha" leftIcon={<Lock className="h-4 w-4" />}>
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={credentials.confirmPassword}
                          onChange={setCredential("confirmPassword")}
                          placeholder="Repita a senha"
                          className={FIELD_INPUT}
                        />
                      </Field>
                    </div>
                  </section>

                  <div className="fl-auth-option rounded-[1.45rem] p-4" data-selected="false">
                    <p className="font-semibold">Proximo passo: checkout separado.</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--fl-auth-muted)]">Depois de criar a conta, o funil segue para `/checkout`, onde a escolha do plano e o pagamento continuam sem misturar a cobranca ao onboarding.</p>
                  </div>

                  <Button
                    type="submit"
                    disabled={
                      stepLoading ||
                      !credentials.email ||
                      !credentials.password ||
                      credentials.password.length < 8 ||
                      credentials.password !== credentials.confirmPassword ||
                      emailAvailability.status === "checking" ||
                      emailAvailability.status === "unavailable" ||
                      emailAvailability.status === "invalid" ||
                      usernameAvailability.status === "checking" ||
                      usernameAvailability.status === "unavailable" ||
                      usernameAvailability.status === "invalid"
                    }
                    size="lg"
                    className="fl-auth-cta h-14 w-full rounded-[1.15rem] text-base font-semibold disabled:opacity-50"
                  >
                    {stepLoading ? "Criando conta..." : "Criar conta e ir para checkout"}
                    {!stepLoading ? <ArrowRight className="h-4 w-4" /> : null}
                  </Button>
                </form>
              )}
            </main>
          </div>
        </div>

        <footer className="hidden justify-center pb-6 text-[10px] font-semibold uppercase tracking-[0.42em] text-[var(--fl-auth-subtle)] lg:flex">
          Precision • Progression • Rewards
        </footer>
      </div>
    </div>
  );
}
