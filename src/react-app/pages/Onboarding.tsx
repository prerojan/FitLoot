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
import AppLoader from "@/react-app/components/AppLoader";
import { AuthThemeHeader } from "@/react-app/components/AuthThemeHeader";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import { useAuth } from "@/react-app/contexts/auth";
import { useTheme } from "@/react-app/contexts/theme";
import { resolveAuthenticatedStartRoute } from "@/react-app/services/authService";
import { api } from "@/react-app/utils/api";
import { saveOnboardingDraft } from "@/react-app/utils/onboardingDraft";
import { Input } from "@/react-app/components/ui/input";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Dumbbell,
  Flame,
  Gauge,
  HeartHandshake,
  HeartPulse,
  Monitor,
  Minus,
  Scale,
  Shield,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Plus,
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
  description?: string;
};

const FIELD_WRAP = "fl-onboarding-input-shell";
const FIELD_INPUT =
  "h-full w-full !border-0 !bg-transparent !p-0 text-base text-[var(--fl-onboarding-ink)] !shadow-none !ring-0 " +
  "placeholder:text-[var(--fl-onboarding-subtle)] focus-visible:!ring-0 focus-visible:!ring-offset-0";
const FIELD_TEXTAREA =
  "w-full resize-none !border-0 !bg-transparent !p-0 text-sm text-[var(--fl-onboarding-ink)] outline-none !shadow-none !ring-0 " +
  "placeholder:text-[var(--fl-onboarding-subtle)] focus-visible:!ring-0 focus-visible:!ring-offset-0";

const TOTAL_STEPS = 13;
const PLAN_PREVIEW_LOADING_MS = 7400;

function Field({
  label,
  hint,
  leftIcon,
  rightSlot,
  invalid = false,
  children,
}: {
  label: string;
  hint?: string;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--fl-onboarding-subtle)]">
          {label}
        </label>
        {hint ? <span className="text-xs text-[var(--fl-onboarding-subtle)]">{hint}</span> : null}
      </div>
      <div className={`${FIELD_WRAP}${invalid ? " is-invalid" : ""}`}>
        {leftIcon ? <span className="text-[var(--fl-onboarding-subtle)]">{leftIcon}</span> : null}
        <div className="min-w-0 flex-1">{children}</div>
        {rightSlot ? <div className="flex items-center">{rightSlot}</div> : null}
      </div>
    </div>
  );
}

const STEP_META = [
  { eyebrow: "Gancho emocional", label: "Etapa 01/13" },
  { eyebrow: "Selecao de objetivo", label: "Etapa 02/13" },
  { eyebrow: "Nivel atual", label: "Etapa 03/13" },
  { eyebrow: "Genero", label: "Etapa 04/13" },
  { eyebrow: "Idade", label: "Etapa 05/13" },
  { eyebrow: "Altura", label: "Etapa 06/13" },
  { eyebrow: "Peso", label: "Etapa 07/13" },
  { eyebrow: "Capacidade inicial", label: "Etapa 08/13" },
  { eyebrow: "Limitacoes", label: "Etapa 09/13" },
  { eyebrow: "Equipamentos", label: "Etapa 10/13" },
  { eyebrow: "Rotina semanal", label: "Etapa 11/13" },
  { eyebrow: "Plano pronto", label: "Etapa 12/13" },
  { eyebrow: "Criacao da conta", label: "Etapa 13/13" },
] as const;

function StepIntro({
  step,
  title,
  description,
}: {
  step: number;
  title: ReactNode;
  description: string;
}) {
  const meta = STEP_META[step] ?? {
    eyebrow: "Etapa",
    label: `Etapa ${String(step + 1).padStart(2, "0")}`,
  };
  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--app-primary-color)]">
            {meta.eyebrow}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--fl-onboarding-subtle)]">
            {meta.label}
          </span>
        </div>
        <div className="fl-onboarding-progress-track">
          <div className="fl-onboarding-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="space-y-3">
        <h1 className="fl-onboarding-title">{title}</h1>
        <p className="fl-onboarding-subtitle">{description}</p>
      </div>
    </div>
  );
}

function PrimaryButton({
  label,
  type = "button",
  disabled,
  onClick,
}: {
  label: string;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="fl-onboarding-primary-button"
    >
      <span>{label}</span>
      <ArrowRight className="h-5 w-5" />
    </button>
  );
}

function SecondaryButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="fl-onboarding-secondary-button">
      {label}
    </button>
  );
}

function StatusMessage({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div className="fl-onboarding-error">
      <p>{message}</p>
    </div>
  );
}

function ScrollPicker({ value, onChange, min, max, unit, label }: ScrollPickerProps) {
  const dragRef = useRef<{
    mouseActive: boolean;
    touchId: number | null;
    startY: number;
    startValue: number;
  }>({
    mouseActive: false,
    touchId: null,
    startY: 0,
    startValue: value,
  });
  const clamped = Math.min(max, Math.max(min, value));
  const visibleValues = [-2, -1, 0, 1, 2].map((offset) => {
    const nextValue = clamped + offset;
    return {
      offset,
      value: nextValue >= min && nextValue <= max ? nextValue : null,
    };
  });

  const updateFromClientY = useCallback(
    (clientY: number) => {
      const delta = dragRef.current.startY - clientY;
      const nextValue = Math.round(dragRef.current.startValue + delta / 36);
      onChange(Math.min(max, Math.max(min, nextValue)));
    },
    [max, min, onChange],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragRef.current.mouseActive) return;
      updateFromClientY(event.clientY);
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
  }, [updateFromClientY]);

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    dragRef.current.mouseActive = true;
    dragRef.current.startY = event.clientY;
    dragRef.current.startValue = clamped;
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    dragRef.current.touchId = touch.identifier;
    dragRef.current.startY = touch.clientY;
    dragRef.current.startValue = clamped;
  };

  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const activeTouch = Array.from(event.changedTouches).find(
      (touch) => touch.identifier === dragRef.current.touchId,
    );
    if (!activeTouch) return;
    updateFromClientY(activeTouch.clientY);
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
    <div className="fl-onboarding-slider-card">
      <div
        className="fl-onboarding-wheel-shell fl-onboarding-slider-shell"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="fl-onboarding-wheel-frame" aria-hidden="true" />

        <div className="fl-onboarding-wheel-ruler is-left" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => (
            <span key={`left-${index}`} className={index % 4 === 0 ? "is-major" : ""} />
          ))}
        </div>

        <div className="fl-onboarding-wheel-ruler is-right" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => (
            <span key={`right-${index}`} className={index % 4 === 0 ? "is-major" : ""} />
          ))}
        </div>

        <div className="fl-onboarding-wheel-values touch-none select-none">
          {visibleValues.map((item) => {
            const isActive = item.offset === 0;
            const isAdjacent = Math.abs(item.offset) === 1;
            return (
              <button
                key={`${label}-${item.offset}`}
                type="button"
                onClick={() => {
                  if (item.value !== null) onChange(item.value);
                }}
                disabled={item.value === null}
                className={`fl-onboarding-wheel-value ${isActive ? "is-active" : ""} ${isAdjacent ? "is-adjacent" : ""} ${item.value === null ? "is-empty" : ""}`}
              >
                <span className="fl-onboarding-wheel-number-shell">
                  <span className="fl-onboarding-wheel-number">{item.value ?? ""}</span>
                </span>
                {isActive ? <small className="fl-onboarding-wheel-unit">{unit}</small> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExerciseValueRow({
  label,
  badge,
  icon,
  value,
  onChange,
}: {
  label: string;
  badge: string;
  icon: ReactNode;
  value: number;
  onChange: (value: number) => void;
}) {
  const safeValue = Math.max(0, value);

  return (
    <div className="fl-onboarding-capacity-card">
      <div className="fl-onboarding-capacity-meta">
        <p className="text-lg font-bold text-[var(--fl-onboarding-ink)]">{label}</p>
        <span className="fl-onboarding-capacity-badge">{badge}</span>
      </div>

      <div className="fl-onboarding-capacity-input">
        <div className="fl-onboarding-capacity-icon">{icon}</div>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={String(safeValue)}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
          className="fl-onboarding-capacity-value"
          aria-label={label}
        />

        <div className="fl-onboarding-capacity-stepper">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, safeValue - 1))}
            className="fl-onboarding-capacity-stepper-button"
            aria-label={`Diminuir ${label}`}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onChange(safeValue + 1)}
            className="fl-onboarding-capacity-stepper-button"
            aria-label={`Aumentar ${label}`}
          >
            <Plus className="h-4 w-4" />
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
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INITIAL_PROFILE: ProfileStep = {
  username: "",
  full_name: "",
  weight: "70",
  height: "170",
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
const GENDER_OPTIONS = [
  {
    value: "homem" as const,
    label: "Masculino",
    description: "Plano otimizado para homens.",
    icon: UserRound,
  },
  {
    value: "mulher" as const,
    label: "Feminino",
    description: "Plano otimizado para mulheres.",
    icon: HeartPulse,
  },
  {
    value: "outro" as const,
    label: "Prefiro nao dizer",
    description: "Plano neutro e balanceado.",
    icon: Sparkles,
  },
];
const GOAL_OPTIONS = [
  {
    value: "perder_peso" as const,
    label: "Perda de gordura",
    description: "Circuitos mais dinamicos para acelerar o gasto calorico.",
    icon: Flame,
  },
  {
    value: "ganhar_massa" as const,
    label: "Hipertrofia",
    description: "Progressao de forca e construcao muscular com mais volume.",
    icon: Dumbbell,
  },
  {
    value: "resistencia" as const,
    label: "Resistencia",
    description: "Mais folego, ritmo e recuperacao para treinar com constancia.",
    icon: Activity,
  },
  {
    value: "saude_geral" as const,
    label: "Manutencao",
    description: "Movimento diario e bem-estar com plano equilibrado.",
    icon: HeartPulse,
  },
  {
    value: "calistenia" as const,
    label: "Estetica",
    description: "Controle corporal, definicao e presenca fisica mais forte.",
    icon: Gauge,
  },
];
const CONDITIONING_OPTIONS = [
  {
    value: "sedentario" as const,
    label: "Sedentario",
    description: "Quer um recomeco seguro, leve e progressivo.",
    icon: HeartHandshake,
  },
  {
    value: "iniciante" as const,
    label: "Iniciante",
    description: "Precisa de estrutura simples para criar consistencia.",
    icon: Zap,
  },
  {
    value: "intermediario" as const,
    label: "Intermediario",
    description: "Ja tolera mais volume e consegue acelerar a progressao.",
    icon: TrendingUp,
  },
  {
    value: "avancado" as const,
    label: "Avancado",
    description: "Busca intensidade alta e metas mais agressivas.",
    icon: Shield,
  },
];
const EQUIPMENT_OPTIONS = [
  { id: "halteres", label: "Halteres", icon: Dumbbell },
  { id: "barra", label: "Barra", icon: Monitor },
  { id: "anilhas", label: "Anilhas", icon: Scale },
  { id: "corda", label: "Corda", icon: Activity },
  { id: "elastico", label: "Elastico", icon: Zap },
  { id: "kettlebell", label: "Peso russo", icon: Weight },
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

function splitCatalogValues(
  value: string,
  catalog: readonly { id: string }[],
): { selected: string[]; notes: string } {
  const catalogIds = new Set(catalog.map((item) => item.id));
  const selected: string[] = [];
  const notes: string[] = [];

  for (const token of parseDelimitedValues(value)) {
    const normalizedToken = token.toLowerCase();
    if (catalogIds.has(normalizedToken)) {
      selected.push(normalizedToken);
    } else {
      notes.push(token);
    }
  }

  return { selected, notes: notes.join(", ") };
}

function mergeCatalogValues(selected: string[], notes: string) {
  return [...selected, ...parseDelimitedValues(notes)].join(", ");
}

function toneClass(tone: "green" | "red" | "muted") {
  if (tone === "green") return "text-emerald-400";
  if (tone === "red") return "text-red-400";
  return "text-[var(--fl-onboarding-subtle)]";
}

function frequencyMessage(days: number) {
  if (days <= 2) {
    return "Plano leve e realista para criar consistencia sem estourar sua rotina.";
  }
  if (days <= 4) {
    return "Volume equilibrado para progredir sem comprometer a recuperacao.";
  }
  if (days <= 6) {
    return "Estrutura forte para evoluir rapido com distribuicao inteligente dos treinos.";
  }
  return "Rotina intensa para quem quer viver o jogo todos os dias com progressao maxima.";
}

function getPasswordMismatchMessage(password: string, confirmPassword: string): string | null {
  if (!password && !confirmPassword) return null;
  if (password === confirmPassword) return null;
  return "As senhas nao coincidem";
}

function goalPlanCopy(goal: ProfileStep["main_goal"]) {
  switch (goal) {
    case "perder_peso":
      return "missoes de gasto calorico, streaks de constancia e marcos de perda de gordura";
    case "ganhar_massa":
      return "blocos de forca, metas de progressao e recompensas por consistencia de volume";
    case "resistencia":
      return "desafios de ritmo, condicionamento e recuperacao cada vez mais forte";
    case "calistenia":
      return "desbloqueios de controle corporal, definicao e progressao tecnica";
    default:
      return "uma rotina equilibrada com missoes diarias, progresso e recompensas de bem-estar";
  }
}

function conditioningPlanCopy(conditioning: ProfileStep["initial_conditioning"]) {
  switch (conditioning) {
    case "sedentario":
      return "com um inicio leve para criar confianca desde a primeira semana";
    case "iniciante":
      return "com uma progressao simples e segura para os primeiros ganhos";
    case "intermediario":
      return "aproveitando sua base atual para acelerar a evolucao com controle";
    default:
      return "com intensidade alta sem perder consistencia nem controle";
  }
}

function conditioningPlanNarrative(conditioning: ProfileStep["initial_conditioning"]) {
  switch (conditioning) {
    case "sedentario":
      return "comecar leve e ganhar confianca desde a primeira semana";
    case "iniciante":
      return "guiar seus primeiros ganhos com uma estrutura simples e segura";
    case "intermediario":
      return "aproveitar sua base atual e acelerar a evolucao com controle";
    default:
      return "manter intensidade alta sem abrir mao de consistencia nem controle";
  }
}
export default function Onboarding() {
  const { user, loading: authLoading, checkAuth } = useAuth();
  const navigate = useNavigate();
  const { themeMode, toggleThemeMode } = useTheme();

  const [currentStep, setCurrentStep] = useState(0);
  const [credentials, setCredentials] = useState(INITIAL_CREDENTIALS);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [weeklyFrequency, setWeeklyFrequency] = useState(3);
  const [isGeneratingPlanPreview, setIsGeneratingPlanPreview] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [stepLoading, setStepLoading] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [usernameAvailability, setUsernameAvailability] = useState<AvailabilityState>({ status: "idle" });
  const [emailAvailability, setEmailAvailability] = useState<AvailabilityState>({ status: "idle" });

  const usernameReqRef = useRef(0);
  const emailReqRef = useRef(0);
  const planPreviewTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const email = sessionStorage.getItem("onboarding_email");
    if (email) {
      setCredentials((currentCredentials) => ({ ...currentCredentials, email }));
      sessionStorage.removeItem("onboarding_email");
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    navigate(resolveAuthenticatedStartRoute(user), { replace: true });
  }, [authLoading, navigate, user]);

  useEffect(() => {
    return () => {
      if (planPreviewTimerRef.current !== null) {
        window.clearTimeout(planPreviewTimerRef.current);
      }
    };
  }, []);

  const setCredential = (field: keyof CredentialsStep) => (e: ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;

    setCredentials((currentCredentials) => {
      return { ...currentCredentials, [field]: nextValue };
    });

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
      const response = await api(`/api/auth/check-availability?username=${encodeURIComponent(username)}`, {
        timeoutMs: 8_000,
      });
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

    if (!EMAIL_REGEX.test(email)) {
      setEmailAvailability({ status: "invalid", message: "E-mail invalido." });
      return false;
    }

    const requestId = ++emailReqRef.current;
    setEmailAvailability({ status: "checking" });

    try {
      const response = await api(`/api/auth/check-availability?email=${encodeURIComponent(email)}`, {
        timeoutMs: 8_000,
      });
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

  const advanceToStep = useCallback((nextStep: number) => {
    setStepError(null);
    setIsGeneratingPlanPreview(false);
    setCurrentStep(nextStep);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const handleWeeklyFrequencyContinue = useCallback(() => {
    setStepError(null);
    setIsGeneratingPlanPreview(true);

    if (planPreviewTimerRef.current !== null) {
      window.clearTimeout(planPreviewTimerRef.current);
    }

    planPreviewTimerRef.current = window.setTimeout(() => {
      planPreviewTimerRef.current = null;
      setIsGeneratingPlanPreview(false);
      advanceToStep(11);
    }, PLAN_PREVIEW_LOADING_MS);

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [advanceToStep]);

  const handleGoalSelection = (goal: GoalValue) => {
    setProfile((currentProfile) => ({ ...currentProfile, main_goal: goal }));
    advanceToStep(2);
  };

  const handleConditioningSelection = (conditioning: ProfileStep["initial_conditioning"]) => {
    const suggestedFrequency =
      conditioning === "sedentario" ? 2 : conditioning === "iniciante" ? 3 : conditioning === "intermediario" ? 4 : 5;

    setProfile((currentProfile) => ({
      ...currentProfile,
      initial_conditioning: conditioning,
    }));
    setWeeklyFrequency(suggestedFrequency);
    advanceToStep(3);
  };

  const handleCapacityContinue = () => {
    setStepError(null);

    const age = Number(profile.age);
    const height = Number(profile.height);
    const weight = Number(profile.weight);
    const pushups = Number(profile.initial_pushups) || 0;
    const situps = Number(profile.initial_situps) || 0;
    const squats = Number(profile.initial_squats) || 0;

    if (!Number.isFinite(age) || age < 13 || age > 80) {
      setStepError("Idade deve ser entre 13 e 80 anos.");
      return;
    }

    if (!Number.isFinite(height) || height < 140 || height > 220) {
      setStepError("Altura deve ficar entre 140 e 220 cm.");
      return;
    }

    if (!Number.isFinite(weight) || weight < 40 || weight > 200) {
      setStepError("Peso deve ficar entre 40 e 200 kg.");
      return;
    }

    if (pushups < 0 || situps < 0 || squats < 0) {
      setStepError("Os valores de capacidade nao podem ser negativos.");
      return;
    }

    advanceToStep(8);
  };

  const handleAccountSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStepError(null);

    const trimmedFullName = profile.full_name.trim();
    const trimmedUsername = profile.username.trim();
    const normalizedEmail = credentials.email.trim().toLowerCase();
    const currentPasswordMismatchError = getPasswordMismatchMessage(
      credentials.password,
      credentials.confirmPassword,
    );

    if (
      !normalizedEmail ||
      !credentials.password ||
      credentials.password.length < 8 ||
      currentPasswordMismatchError
    ) {
      setStepError(
        credentials.password.length < 8
          ? "A senha deve ter pelo menos 8 caracteres"
          : currentPasswordMismatchError
            ? "As senhas nao coincidem"
            : "Preencha e-mail e senha.",
      );
      return;
    }

    if (!trimmedFullName) {
      setStepError("Preencha seu nome completo na etapa de Identidade.");
      return;
    }

    if (trimmedUsername.length < 3) {
      setStepError("O nome de usuario deve ter pelo menos 3 caracteres.");
      return;
    }

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setStepError("Informe um e-mail valido.");
      return;
    }

    setStepLoading(true);

    try {
      const [isEmailAvailable, isUsernameAvailable] = await Promise.all([
        validateEmail(normalizedEmail),
        validateUsername(trimmedUsername),
      ]);

      if (!isEmailAvailable) {
        setStepError("Use um e-mail disponivel para criar a conta.");
        return;
      }

      if (!isUsernameAvailable) {
        setStepError("Use um nome de usuario disponivel para criar a conta.");
        return;
      }

      const registerRes = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: normalizedEmail,
          password: credentials.password,
          name: trimmedFullName,
        }),
      });

      if (registerRes.status === 409) {
        setStepError("Este e-mail ja esta cadastrado.");
        return;
      }
      if (!registerRes.ok) {
        setStepError("Erro ao criar conta.");
        return;
      }

      const loginRes = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail, password: credentials.password }),
      });

      if (!loginRes.ok) {
        setStepError("Conta criada. Faca login em /app");
        return;
      }

      localStorage.setItem("fitloot_authenticated_hint", "1");
      await checkAuth();

      const patchRes = await api("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ name: trimmedFullName }),
      });

      if (!patchRes.ok) {
        setStepError("Erro ao atualizar perfil.");
        return;
      }

      saveOnboardingDraft({
        username: trimmedUsername,
        full_name: trimmedFullName,
        weight: profile.weight,
        height: profile.height,
        age: profile.age,
        gender: profile.gender,
        initial_conditioning: profile.initial_conditioning,
        initial_pushups: profile.initial_pushups,
        initial_situps: profile.initial_situps,
        initial_squats: profile.initial_squats,
        injuries: profile.injuries,
        equipment: profile.equipment,
        main_goal: profile.main_goal,
        weeklyFrequency,
        selectedEquipment,
      });

      navigate(ROUTE_PATHS.checkout, { replace: true });
    } catch {
      setStepError("Nao foi possivel conectar ao servidor.");
    } finally {
      setStepLoading(false);
    }
  };

  const toggleInjurySelection = (injuryId: string) => {
    setProfile((currentProfile) => {
      const { selected, notes } = splitCatalogValues(currentProfile.injuries, INJURY_OPTIONS);
      const nextSelected = selected.includes(injuryId)
        ? selected.filter((item) => item !== injuryId)
        : [...selected, injuryId];

      return {
        ...currentProfile,
        injuries: mergeCatalogValues(nextSelected, notes),
      };
    });
  };

  const setInjuryNotes = (notes: string) => {
    setProfile((currentProfile) => {
      const { selected } = splitCatalogValues(currentProfile.injuries, INJURY_OPTIONS);
      return {
        ...currentProfile,
        injuries: mergeCatalogValues(selected, notes),
      };
    });
  };

  const selectedGoal = GOAL_OPTIONS.find((option) => option.value === profile.main_goal) ?? {
    value: "saude_geral" as const,
    label: "Manutencao",
    description: "Movimento diario e bem-estar com plano equilibrado.",
    icon: HeartPulse,
  };
  const selectedConditioning =
    CONDITIONING_OPTIONS.find((option) => option.value === profile.initial_conditioning) ?? {
      value: "iniciante" as const,
      label: "Iniciante",
      description: "Precisa de estrutura simples para criar consistencia.",
      icon: Zap,
    };
  const conditioningLabel = selectedConditioning.label;
  const heroName = profile.full_name.trim().split(" ")[0] || "Voce";
  const { selected: injuryTokens, notes: injuryNotes } = splitCatalogValues(profile.injuries, INJURY_OPTIONS);
  const usernameStatusMessage = availabilityMessage(usernameAvailability);
  const emailStatusMessage = availabilityMessage(emailAvailability);
  const isExistingAccountError = stepError?.includes("cadastrado") ?? false;
  const trimmedFullName = profile.full_name.trim();
  const trimmedUsername = profile.username.trim();
  const normalizedEmail = credentials.email.trim().toLowerCase();
  const isPasswordValid = credentials.password.length >= 8;
  const hasStartedPassword = credentials.password.length > 0;
  const hasStartedConfirmPassword = credentials.confirmPassword.length > 0;
  const isEmailFormatValid = normalizedEmail.length > 0 && EMAIL_REGEX.test(normalizedEmail);
  const isUsernameFormatValid = trimmedUsername.length >= 3;
  const passwordMismatchError = getPasswordMismatchMessage(
    credentials.password,
    credentials.confirmPassword,
  );
  const hasPasswordMismatch = passwordMismatchError !== null;
  const isConfirmPasswordInvalid = hasStartedConfirmPassword && hasPasswordMismatch;
  const passwordFeedback: { tone: "green" | "red"; text: string } | null = hasStartedPassword
    ? {
        tone: isPasswordValid ? "green" : "red",
        text: isPasswordValid ? "Senha valida" : "Minimo de 8 caracteres",
      }
    : null;
  const confirmPasswordFeedback: { tone: "green" | "red"; text: string } | null = hasStartedConfirmPassword
    ? {
        tone: hasPasswordMismatch ? "red" : "green",
        text: hasPasswordMismatch ? "As senhas nao coincidem" : "Senhas coincidem",
      }
    : null;
  const planHighlights = [
    {
      icon: Target,
      title: "Missoes desbloqueadas",
      text: `Vamos ativar ${goalPlanCopy(profile.main_goal)} logo nas primeiras semanas.`,
    },
    {
      icon: TrendingUp,
      title: "Progressao realista",
      text: `Seu nivel atual entra no plano ${conditioningPlanCopy(profile.initial_conditioning)}.`,
    },
    {
      icon: CalendarDays,
      title: "Rotina que encaixa",
      text: `A estrutura inicial considera ${weeklyFrequency} ${weeklyFrequency === 1 ? "dia" : "dias"} por semana para manter aderencia.`,
    },
  ];
  const accountSubmitDisabled =
    stepLoading ||
    !trimmedFullName ||
    !isUsernameFormatValid ||
    !isEmailFormatValid ||
    !isPasswordValid ||
    hasPasswordMismatch;

  let stepContent: ReactNode;

  if (currentStep === 0) {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={0}
          title={
            <>
              Transforme seu treino em <span className="text-[var(--app-primary-color)]">um jogo.</span>
            </>
          }
          description="O FitLoot mistura treino, progresso e recompensa para fazer sua rotina render mais e parecer mais viciante."
        />

        <div className="space-y-4 pt-4">
          <PrimaryButton label="Comecar" onClick={() => advanceToStep(1)} />
          <p className="fl-onboarding-helper-copy">Sem formulario agora. Primeiro montamos o seu caminho ideal.</p>
        </div>
      </section>
    );
  } else if (currentStep === 1) {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={1}
          title={
            <>
              Qual e o seu <span className="text-[var(--app-primary-color)]">objetivo?</span>
            </>
          }
          description="Toque em uma opcao e a jornada continua na hora. O FitLoot ja comeca a se ajustar a voce."
        />

        <div className="space-y-3">
          {GOAL_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = profile.main_goal === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleGoalSelection(option.value)}
                className={`fl-onboarding-option-card ${isSelected ? "is-selected" : ""}`}
              >
                <div className="fl-onboarding-option-icon">
                  <Icon className="h-6 w-6" strokeWidth={2.1} />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-lg font-bold text-[var(--fl-onboarding-ink)]">{option.label}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--fl-onboarding-muted)]">{option.description}</p>
                </div>
                <span className={`fl-onboarding-radio-indicator ${isSelected ? "is-active" : ""}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <p className="fl-onboarding-helper-copy">Selecionar uma opcao ja avanca para a proxima tela.</p>
      </section>
    );
  } else if (currentStep === 2) {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={2}
          title={
            <>
              Qual e o seu <span className="text-[var(--app-primary-color)]">nivel hoje?</span>
            </>
          }
          description="Escolha a descricao que mais combina com sua realidade atual. Um toque e o suficiente para seguir."
        />

        <div className="space-y-3">
          {CONDITIONING_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = profile.initial_conditioning === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleConditioningSelection(option.value)}
                className={`fl-onboarding-option-card ${isSelected ? "is-selected" : ""}`}
              >
                <div className="fl-onboarding-option-icon">
                  <Icon className="h-6 w-6" strokeWidth={2.1} />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-lg font-bold text-[var(--fl-onboarding-ink)]">{option.label}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--fl-onboarding-muted)]">{option.description}</p>
                </div>
                <span className={`fl-onboarding-radio-indicator ${isSelected ? "is-active" : ""}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <p className="fl-onboarding-helper-copy">Toque para continuar e calibrar a intensidade do plano.</p>
      </section>
    );
  } else if (currentStep === 3) {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={3}
          title={
            <>
              Qual o seu <span className="text-[var(--app-primary-color)]">genero?</span>
            </>
          }
          description="Isso ajuda a calibrar o plano inicial com um contexto mais adequado, mantendo o fluxo simples e direto."
        />

        <div className="space-y-3">
          {GENDER_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = profile.gender === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setProfile((currentProfile) => ({ ...currentProfile, gender: option.value }))}
                className={`fl-onboarding-option-card ${isSelected ? "is-selected" : ""}`}
              >
                <div className="fl-onboarding-option-icon">
                  <Icon className="h-5 w-5" strokeWidth={2.1} />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-lg font-bold text-[var(--fl-onboarding-ink)]">{option.label}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--fl-onboarding-muted)]">
                    {option.description}
                  </p>
                </div>
                <span className={`fl-onboarding-radio-indicator ${isSelected ? "is-active" : ""}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <div className="grid gap-3">
          <PrimaryButton label="Continuar" onClick={() => advanceToStep(4)} />
          <SecondaryButton label="Voltar" onClick={() => advanceToStep(2)} />
        </div>
      </section>
    );
  } else if (currentStep === 4) {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={4}
          title={
            <>
              Quantos <span className="text-[var(--app-primary-color)]">anos</span> voce tem?
            </>
          }
          description="A idade ajuda a ajustar intensidade, recuperacao e ritmo de progressao desde a primeira semana."
        />

        <ScrollPicker
          label="Idade"
          description="Deslize para escolher sua idade real. O plano fica mais preciso e continua 100% custom."
          value={Number(profile.age) || 25}
          onChange={(nextValue) =>
            setProfile((currentProfile) => ({ ...currentProfile, age: String(nextValue) }))
          }
          min={13}
          max={80}
          unit="anos"
        />

        <div className="grid gap-3">
          <PrimaryButton label="Continuar" onClick={() => advanceToStep(5)} />
          <SecondaryButton label="Voltar" onClick={() => advanceToStep(3)} />
        </div>
      </section>
    );
  } else if (currentStep === 5) {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={5}
          title={
            <>
              Qual e a sua <span className="text-[var(--app-primary-color)]">altura?</span>
            </>
          }
          description="Esse dado entra na calibragem do seu perfil fisico e ajuda a deixar o plano mais coerente."
        />

        <ScrollPicker
          label="Altura"
          description="Use o seletor vertical para ajustar com toque customizado, sem usar range nativo."
          value={Number(profile.height) || 170}
          onChange={(nextValue) =>
            setProfile((currentProfile) => ({ ...currentProfile, height: String(nextValue) }))
          }
          min={140}
          max={220}
          unit="cm"
        />

        <div className="grid gap-3">
          <PrimaryButton label="Continuar" onClick={() => advanceToStep(6)} />
          <SecondaryButton label="Voltar" onClick={() => advanceToStep(4)} />
        </div>
      </section>
    );
  } else if (currentStep === 6) {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={6}
          title={
            <>
              Qual e o seu <span className="text-[var(--app-primary-color)]">peso?</span>
            </>
          }
          description="Com esse ajuste, a personalizacao do plano nasce mais proxima da sua realidade atual."
        />

        <ScrollPicker
          label="Peso"
          description="Ajuste em quilos com o mesmo seletor vertical do fluxo para manter consistencia e toque fluido."
          value={Number(profile.weight) || 70}
          onChange={(nextValue) =>
            setProfile((currentProfile) => ({ ...currentProfile, weight: String(nextValue) }))
          }
          min={40}
          max={200}
          unit="kg"
        />

        <div className="grid gap-3">
          <PrimaryButton label="Continuar" onClick={() => advanceToStep(7)} />
          <SecondaryButton label="Voltar" onClick={() => advanceToStep(5)} />
        </div>
      </section>
    );
  } else if (currentStep === 7) {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={7}
          title={
            <>
              O que voce consegue fazer <span className="text-[var(--app-primary-color)]">hoje?</span>
            </>
          }
          description="Agora sim medimos sua capacidade base por exercicio para que o plano inicial nao comece nem leve demais nem pesado demais."
        />

        <div className="fl-onboarding-badge-row">
          <span className="fl-onboarding-chip">{GENDER_OPTIONS.find((option) => option.value === profile.gender)?.label ?? "Perfil"}</span>
          <span className="fl-onboarding-chip">{profile.height} cm</span>
          <span className="fl-onboarding-chip">{profile.weight} kg</span>
        </div>

        <div className="space-y-4">
          <ExerciseValueRow
            label="Flexoes"
            badge="Superior"
            icon={<Dumbbell className="h-5 w-5" strokeWidth={2.2} />}
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
            badge="Tronco"
            icon={<Flame className="h-5 w-5" strokeWidth={2.2} />}
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
            badge="Pernas"
            icon={<Weight className="h-5 w-5" strokeWidth={2.2} />}
            value={Number(profile.initial_squats) || 0}
            onChange={(nextValue) =>
              setProfile((currentProfile) => ({
                ...currentProfile,
                initial_squats: String(nextValue),
              }))
            }
          />
        </div>

        <div className="fl-onboarding-sticky-footer grid gap-3">
          <PrimaryButton label="Continuar" onClick={handleCapacityContinue} />
          <SecondaryButton label="Voltar" onClick={() => advanceToStep(6)} />
        </div>
      </section>
    );
  } else if (currentStep === 8) {
    stepContent = (
      <section className="space-y-8">
        <div className="flex justify-end">
          <button type="button" onClick={() => advanceToStep(9)} className="fl-onboarding-skip-button">
            Pular
          </button>
        </div>

        <StepIntro
          step={8}
          title={
            <>
              Alguma <span className="text-[var(--app-primary-color)]">limitacao?</span>
            </>
          }
          description="Selecione lesoes ou restricoes que precisam ser respeitadas. Se nao houver nada, marque nenhuma e siga."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setProfile((currentProfile) => ({ ...currentProfile, injuries: "" }))}
            className={`fl-onboarding-chip-card ${injuryTokens.length === 0 && !injuryNotes ? "is-active" : ""}`}
          >
            Nenhuma
          </button>
          {INJURY_OPTIONS.map((injury) => (
            <button
              key={injury.id}
              type="button"
              onClick={() => toggleInjurySelection(injury.id)}
              className={`fl-onboarding-chip-card ${injuryTokens.includes(injury.id) ? "is-active" : ""}`}
            >
              {injury.label}
            </button>
          ))}
        </div>

        <Field label="Observacoes extras" hint="Opcional">
          <textarea
            value={injuryNotes}
            onChange={(event) => setInjuryNotes(event.target.value)}
            placeholder="Ex: dor lombar ao flexionar, sensibilidade no ombro..."
            rows={3}
            className={FIELD_TEXTAREA}
          />
        </Field>

        <div className="grid gap-3">
          <PrimaryButton label="Continuar" onClick={() => advanceToStep(9)} />
          <SecondaryButton label="Voltar" onClick={() => advanceToStep(7)} />
        </div>
      </section>
    );
  } else if (currentStep === 9) {
    stepContent = (
      <section className="space-y-8">
        <div className="flex justify-end">
          <button type="button" onClick={() => advanceToStep(10)} className="fl-onboarding-skip-button">
            Pular
          </button>
        </div>

        <StepIntro
          step={9}
          title={
            <>
              O que voce tem <span className="text-[var(--app-primary-color)]">disponivel?</span>
            </>
          }
          description="Monte o setup do seu plano com os equipamentos que ja estao por perto. Se quiser, complemente com itens extras."
        />

        <div className="grid gap-3 sm:grid-cols-2">
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
                className={`fl-onboarding-option-card ${isSelected ? "is-selected" : ""}`}
              >
                <div className="fl-onboarding-option-icon">
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-lg font-bold text-[var(--fl-onboarding-ink)]">{equipmentOption.label}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--fl-onboarding-muted)]">
                    Entra no calculo do seu plano inicial.
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <Field label="Outros equipamentos" hint="Opcional">
          <Input
            value={profile.equipment}
            onChange={setProfileField("equipment")}
            placeholder="Ex: banco, colchonete, paralelas..."
            className={FIELD_INPUT}
          />
        </Field>

        <div className="grid gap-3">
          <PrimaryButton label="Continuar" onClick={() => advanceToStep(10)} />
          <SecondaryButton label="Voltar" onClick={() => advanceToStep(8)} />
        </div>
      </section>
    );
  } else if (currentStep === 10) {
    if (isGeneratingPlanPreview) {
      stepContent = (
        <section className="space-y-8">
          <StepIntro
            step={10}
            title={
              <>
                Gerando seu <span className="text-[var(--app-primary-color)]">plano.</span>
              </>
            }
            description="Estamos organizando a estrutura inicial com base na sua frequencia semanal."
          />

          <div className="fl-onboarding-surface-card flex min-h-[320px] flex-col items-center justify-center gap-5 text-center">
            <AppLoader size="lg" />
            <div className="space-y-2">
              <p className="text-lg font-bold text-[var(--fl-onboarding-ink)]">
                Gerando seu plano personalizado...
              </p>
              <p className="text-sm leading-6 text-[var(--fl-onboarding-muted)]">
                Em instantes voce vai ver como a sua rotina se transforma em progresso.
              </p>
            </div>
          </div>
        </section>
      );
    } else {
      stepContent = (
        <section className="space-y-8">
          <StepIntro
            step={10}
            title={
              <>
                Quantos dias por <span className="text-[var(--app-primary-color)]">semana?</span>
              </>
            }
            description="Escolha sua frequencia real. O plano vai nascer com isso em mente para manter aderencia desde o comeco."
          />

          <ScrollPicker
            label="Frequencia semanal"
            description="Use o mesmo gesto do seletor de idade para ajustar uma rotina que voce realmente consegue sustentar."
            value={weeklyFrequency}
            onChange={setWeeklyFrequency}
            min={1}
            max={7}
            unit="dias"
          />

          <div className="fl-onboarding-surface-card">
            <div className="flex items-start gap-4">
              <div className="fl-onboarding-feature-icon">
                <CalendarDays className="h-5 w-5" strokeWidth={2.2} />
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--fl-onboarding-ink)]">
                  {weeklyFrequency} {weeklyFrequency === 1 ? "dia" : "dias"} por semana
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--fl-onboarding-muted)]">
                  {frequencyMessage(weeklyFrequency)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <PrimaryButton label="Continuar" onClick={handleWeeklyFrequencyContinue} />
            <SecondaryButton label="Voltar" onClick={() => advanceToStep(9)} />
          </div>
        </section>
      );
    }
  } else if (currentStep === 11) {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={11}
          title={
            <>
              Seu plano esta <span className="text-[var(--app-primary-color)]">pronto.</span>
            </>
          }
          description="Antes de criar sua conta, voce ja consegue visualizar como o plano vai se adaptar ao seu objetivo e ao seu ritmo."
        />

        <div className="fl-onboarding-hero-panel space-y-5">
          <div className="fl-onboarding-badge-row">
            <span className="fl-onboarding-chip">{selectedGoal.label}</span>
            <span className="fl-onboarding-chip">{conditioningLabel}</span>
            <span className="fl-onboarding-chip">{weeklyFrequency}x por semana</span>
          </div>

          <div>
            <h2 className="fl-onboarding-section-title">
              {heroName}, seu plano vai combinar {selectedGoal.label.toLowerCase()} com uma progressao {conditioningLabel.toLowerCase()}.
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--fl-onboarding-muted)]">
              Nas proximas semanas, voce vai desbloquear {goalPlanCopy(profile.main_goal)}. O ritmo inicial foi pensado para {conditioningPlanNarrative(profile.initial_conditioning)} e respeitar sua rotina de {weeklyFrequency} {weeklyFrequency === 1 ? "dia" : "dias"} por semana.
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {planHighlights.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="fl-onboarding-surface-card">
                <div className="flex items-start gap-4">
                  <div className="fl-onboarding-feature-icon">
                    <Icon className="h-5 w-5" strokeWidth={2.2} />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-[var(--fl-onboarding-ink)]">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--fl-onboarding-muted)]">{item.text}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="fl-onboarding-surface-card">
          <div className="flex items-center gap-1 text-[var(--app-primary-color)]">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star key={index} className="h-4 w-4 fill-current" strokeWidth={1.8} />
            ))}
          </div>
          <p className="mt-4 text-lg font-bold text-[var(--fl-onboarding-ink)]">4.9/5 de satisfacao nas primeiras semanas</p>
          <p className="mt-2 text-sm leading-6 text-[var(--fl-onboarding-muted)]">
            Prova social, senso de progresso e missoes curtas ajudam o usuario a continuar mesmo nos dias mais corridos.
          </p>
        </div>

        <div className="grid gap-3">
          <PrimaryButton label="Criar minha conta" onClick={() => advanceToStep(12)} />
          <SecondaryButton label="Voltar" onClick={() => advanceToStep(10)} />
        </div>
      </section>
    );
  } else {
    stepContent = (
      <section className="space-y-8">
        <StepIntro
          step={12}
          title={
            <>
              Crie sua <span className="text-[var(--app-primary-color)]">conta.</span>
            </>
          }
          description="Ultimo passo: informe seus dados de acesso. A tela de pagamento abre em seguida, de forma separada."
        />

        <form onSubmit={handleAccountSubmit} className="space-y-6">
          <Field label="Nome completo">
            <Input
              value={profile.full_name}
              onChange={setProfileField("full_name")}
              placeholder="Seu nome completo"
              className={FIELD_INPUT}
            />
          </Field>

          <div className="space-y-2">
            <Field label="Nome de usuario">
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
              <p className={`text-sm ${toneClass(usernameStatusMessage.tone)}`}>{usernameStatusMessage.text}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Field label="Email">
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
              <p className={`text-sm ${toneClass(emailStatusMessage.tone)}`}>{emailStatusMessage.text}</p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Field label="Senha">
                <Input
                  type="password"
                  value={credentials.password}
                  onChange={setCredential("password")}
                  placeholder="Senha segura"
                  minLength={8}
                  className={FIELD_INPUT}
                />
              </Field>
              {passwordFeedback ? (
                <p className={`text-sm ${toneClass(passwordFeedback.tone)}`}>{passwordFeedback.text}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Field label="Confirmar senha" invalid={isConfirmPasswordInvalid}>
                <Input
                  type="password"
                  value={credentials.confirmPassword}
                  onChange={setCredential("confirmPassword")}
                  placeholder="Repita a senha"
                  aria-invalid={isConfirmPasswordInvalid}
                  className={FIELD_INPUT}
                />
              </Field>
              {confirmPasswordFeedback ? (
                <p className={`text-sm ${toneClass(confirmPasswordFeedback.tone)}`}>
                  {confirmPasswordFeedback.text}
                </p>
              ) : null}
            </div>
          </div>

          {isExistingAccountError ? (
            <button
              type="button"
              onClick={() => navigate(ROUTE_PATHS.app)}
              className="fl-onboarding-secondary-button"
            >
              Fazer login
            </button>
          ) : null}

          <PrimaryButton
            type="submit"
            disabled={accountSubmitDisabled}
            label={stepLoading ? "Criando conta..." : "Criar conta e ir para o pagamento"}
          />
          <SecondaryButton label="Voltar" onClick={() => advanceToStep(11)} />
        </form>
      </section>
    );
  }

  return (
    <div className="fl-auth-page fl-auth-funnel-page">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-20 top-12 h-72 w-72 rounded-full bg-[var(--fl-auth-primary-soft)] blur-3xl" />
        <div className="absolute right-[-6rem] top-[14%] h-[28rem] w-[28rem] rounded-full bg-[var(--fl-auth-secondary-soft)] blur-[130px]" />
        <div className="absolute bottom-[-8rem] left-1/3 h-80 w-80 rounded-full bg-[var(--fl-auth-primary-soft)] blur-[120px]" />
      </div>

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <AuthThemeHeader colorScheme={themeMode} onToggleColorScheme={toggleThemeMode} />

        <main className="relative z-10 flex flex-1 flex-col items-center justify-start px-0 pb-12 pt-6">
          <div className="w-full max-w-[540px]">
            {stepError ? (
              <div className="mb-6">
                <StatusMessage message={stepError} />
              </div>
            ) : null}

            <div key={currentStep} className="animate-authStepEnter">
              {stepContent}
            </div>
          </div>
        </main>

        <footer className="hidden justify-center pb-8 text-[10px] font-bold uppercase tracking-[0.34em] text-[var(--fl-onboarding-subtle)] md:flex">
          <div className="flex items-center gap-6">
            <span>Precisao</span>
            <span>•</span>
            <span>Progresso</span>
            <span>•</span>
            <span>Recompensas</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
