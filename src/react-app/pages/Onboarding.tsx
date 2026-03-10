
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { useNavigate } from "react-router";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import { useAuth } from "@/react-app/contexts/auth";
import PaymentStatusPopup from "@/react-app/components/PaymentStatusPopup";
import PageLoader from "@/react-app/components/PageLoader";
import LoadingBall from "@/react-app/components/LoadingBall";
import { resolveAuthenticatedStartRoute } from "@/react-app/services/authService";
import { api } from "@/react-app/utils/api";
import { safeGet } from "@/utils/typeHelpers";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Dumbbell,
  Eye,
  EyeOff,
  Gauge,
  HeartPulse,
  Monitor,
  QrCode,
  Shield,
  Sparkles,
  Target,
  User,
  UserRound,
  Weight,
  Zap,
  type LucideIcon,
} from "lucide-react";

type TouchSliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  unit: string;
  step?: number;
  hint?: string;
};

type CredentialsStep = {
  email: string;
  password: string;
  confirmPassword: string;
};

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
  training_frequency: string;
};

type PaymentTab = "card" | "pix";

type CardPaymentForm = {
  number: string;
  holderName: string;
  expiry: string;
  cvv: string;
};

type CheckoutResult = {
  checkout_status?: "pending" | "vip_active" | undefined;
  message?: string | undefined;
  amount?: number | undefined;
  checkout_url?: string | null | undefined;
};

type GoalValue = ProfileStep["main_goal"];
type PlanId = "free" | "pro" | "annual";
type ExerciseKey = "initial_pushups" | "initial_situps" | "initial_squats";
type PhysicalSubStep = "conditioning" | "capacity" | "injuries" | "equipment" | "frequency";

type AvailabilityState = {
  status: "idle" | "checking" | "available" | "unavailable" | "invalid";
  message?: string | undefined;
};

type SidebarCard = {
  title: string;
  description: string;
  icon: LucideIcon;
};

type SidebarMeta = {
  title: string;
  subtitle: string;
  chips: string[];
  cards: SidebarCard[];
  footer?: string;
};

const FIELD_WRAP =
  "flex h-11 items-center rounded-xl border-2 border-gray-200 bg-white px-3 transition " +
  "[&:has(input:focus)]:border-emerald-500 " +
  "[&:has(input:focus)]:ring-2 " +
  "[&:has(input:focus)]:ring-emerald-500/20";

const FIELD_INPUT =
  "h-full w-full !border-0 !bg-transparent !p-0 !shadow-none !ring-0 " +
  "focus-visible:!ring-0 focus-visible:!ring-offset-0";

const FIELD_TEXTAREA =
  "w-full resize-none !border-0 !bg-transparent !p-0 text-sm outline-none !shadow-none !ring-0 " +
  "focus-visible:!ring-0 focus-visible:!ring-offset-0";

const INITIAL_CREDENTIALS: CredentialsStep = {
  email: "",
  password: "",
  confirmPassword: "",
};

const INITIAL_PROFILE: ProfileStep = {
  username: "",
  full_name: "",
  weight: "70",
  height: "170",
  initial_conditioning: "iniciante",
  initial_pushups: "12",
  initial_situps: "13",
  initial_squats: "11",
  injuries: "",
  equipment: "",
  main_goal: "saude_geral",
  gender: "homem",
  age: "25",
  training_frequency: "4",
};

const INITIAL_CARD_PAYMENT: CardPaymentForm = {
  number: "",
  holderName: "",
  expiry: "",
  cvv: "",
};

const STEP_NAMES = [
  "Objetivo",
  "Perfil físico",
  "Plano personalizado",
  "Criação de conta",
  "Plano e pagamento",
] as const;

const STEP_ICONS: LucideIcon[] = [Target, Activity, Sparkles, UserRound, Shield];

const PHYSICAL_SUB_STEPS: PhysicalSubStep[] = ["conditioning", "capacity", "injuries", "equipment", "frequency"];

const PHYSICAL_SUB_META: Record<PhysicalSubStep, { label: string; title: string; subtitle: string }> = {
  conditioning: {
    label: "2.1",
    title: "Condicionamento atual",
    subtitle: "Escolha seu nível e ajuste medidas de referência.",
  },
  capacity: {
    label: "2.3",
    title: "Capacidade por exercício base",
    subtitle: "Toque nos números laterais ou deslize para ajustar.",
  },
  injuries: {
    label: "2.5",
    title: "Lesões e restrições",
    subtitle: "Marque o que devemos considerar na montagem do treino.",
  },
  equipment: {
    label: "2.7",
    title: "Equipamentos disponíveis",
    subtitle: "Selecione tudo o que você tem hoje para treinar.",
  },
  frequency: {
    label: "2.9",
    title: "Frequência semanal",
    subtitle: "Defina quantos dias por semana você pretende treinar.",
  },
};

const GOAL_OPTIONS: { value: GoalValue; label: string; description: string; icon: LucideIcon }[] = [
  {
    value: "perder_peso",
    label: "Perder peso",
    description: "Queimar gordura com progressão segura e consistente.",
    icon: Zap,
  },
  {
    value: "ganhar_massa",
    label: "Ganhar massa muscular",
    description: "Aumentar volume com foco em força e hipertrofia.",
    icon: Dumbbell,
  },
  {
    value: "resistencia",
    label: "Melhorar condicionamento",
    description: "Aumentar fôlego e resistência para o dia a dia.",
    icon: Activity,
  },
  {
    value: "saude_geral",
    label: "Saúde e qualidade de vida",
    description: "Treinos sustentáveis para bem-estar no longo prazo.",
    icon: HeartPulse,
  },
  {
    value: "calistenia",
    label: "Estética e definição",
    description: "Performance corporal com foco em controle e forma.",
    icon: Gauge,
  },
];

const CONDITIONING_OPTIONS: {
  value: ProfileStep["initial_conditioning"];
  label: string;
  description: string;
}[] = [
  {
    value: "sedentario",
    label: "Sedentário",
    description: "Está retomando hábitos e precisa de adaptação gradual.",
  },
  {
    value: "iniciante",
    label: "Iniciante",
    description: "Consegue treinar com base leve e progressão simples.",
  },
  {
    value: "intermediario",
    label: "Intermediário",
    description: "Tem rotina ativa e tolera blocos com maior volume.",
  },
  {
    value: "avancado",
    label: "Avançado",
    description: "Mantém alto desempenho e busca refinamento técnico.",
  },
];

const EXERCISE_OPTIONS: { key: ExerciseKey; label: string }[] = [
  { key: "initial_pushups", label: "Flexões" },
  { key: "initial_squats", label: "Agachamentos" },
  { key: "initial_situps", label: "Abdominais" },
];

const INJURY_OPTIONS: { id: string; label: string }[] = [
  { id: "joelho", label: "Joelho" },
  { id: "lombar", label: "Lombar" },
  { id: "ombro", label: "Ombro" },
  { id: "cervical", label: "Cervical" },
  { id: "quadril", label: "Quadril" },
  { id: "tornozelo", label: "Tornozelo" },
  { id: "punho", label: "Punho" },
  { id: "cardiaco", label: "Restrição cardíaca" },
];

const EQUIPMENT_OPTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "halteres", label: "Halteres", icon: Dumbbell },
  { id: "barra", label: "Barra", icon: Monitor },
  { id: "anilhas", label: "Anilhas", icon: Gauge },
  { id: "corda", label: "Corda", icon: Activity },
  { id: "elastico", label: "Elástico", icon: Zap },
  { id: "kettlebell", label: "Kettlebell", icon: Weight },
];

const PLAN_OPTIONS: {
  id: PlanId;
  name: string;
  price: string;
  amountCents: number;
  color: string;
  features: string[];
  popular?: boolean;
}[] = [
  {
    id: "free",
    name: "Básico",
    price: "R$ 49/mês",
    amountCents: 4900,
    color: "from-gray-500 to-gray-600",
    features: ["Missões diárias", "XP e níveis", "Ranking"],
  },
  {
    id: "pro",
    name: "Premium",
    price: "R$ 99/mês",
    amountCents: 9900,
    color: "from-emerald-500 to-teal-600",
    features: ["Tudo do Básico", "Scanner com IA", "Ranking global"],
    popular: true,
  },
  {
    id: "annual",
    name: "Elite",
    price: "R$ 149/mês",
    amountCents: 14900,
    color: "from-cyan-500 to-blue-600",
    features: ["Tudo do Premium", "Planos de treino", "Suporte prioritário"],
  },
];

const RECOMMENDED_PLAN_BY_GOAL: Record<GoalValue, PlanId> = {
  perder_peso: "pro",
  ganhar_massa: "annual",
  resistencia: "pro",
  calistenia: "annual",
  saude_geral: "free",
};

function Field({
  label,
  leftIcon,
  rightSlot,
  children,
}: {
  label: string;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <div className={`${FIELD_WRAP} ${rightSlot ? "pr-2" : ""}`}>
        {leftIcon ? <span className="mr-2 flex items-center text-gray-400">{leftIcon}</span> : null}
        <div className="flex-1">{children}</div>
        {rightSlot ? <div className="ml-2 flex items-center">{rightSlot}</div> : null}
      </div>
    </div>
  );
}

function TouchSlider({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  step = 1,
  hint,
}: TouchSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const clampedValue = Math.max(min, Math.min(max, value));
  const percentage = max === min ? 0 : ((clampedValue - min) / (max - min)) * 100;

  const clamp = useCallback(
    (nextValue: number) => {
      return Math.max(min, Math.min(max, nextValue));
    },
    [max, min],
  );

  const updateByClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;

      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = min + ratio * (max - min);
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(snapped));
    },
    [clamp, max, min, onChange, step],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) return;
      updateByClientX(event.clientX);
    };

    const handleMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!draggingRef.current) return;
      const firstTouch = event.touches[0];
      if (!firstTouch) return;
      event.preventDefault();
      updateByClientX(firstTouch.clientX);
    };

    const handleTouchEnd = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [updateByClientX]);

  const startTouchDrag = (event: ReactTouchEvent<HTMLDivElement>) => {
    const firstTouch = event.touches[0];
    if (!firstTouch) return;
    draggingRef.current = true;
    setIsDragging(true);
    updateByClientX(firstTouch.clientX);
    event.preventDefault();
  };

  const startMouseDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    setIsDragging(true);
    updateByClientX(event.clientX);
  };

  const onSliderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(clamp(clampedValue + step));
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(clamp(clampedValue - step));
    }
  };

  return (
    <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{label}</p>
        <p className="text-xl font-extrabold text-emerald-700">
          {clampedValue}
          <span className="ml-1 text-sm font-semibold text-emerald-600">{unit}</span>
        </p>
      </div>

      <div
        ref={trackRef}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={clampedValue}
        tabIndex={0}
        onKeyDown={onSliderKeyDown}
        onMouseDown={startMouseDrag}
        onTouchStart={startTouchDrag}
        className="relative h-12 touch-none select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-emerald-100" />
        <div
          className="absolute left-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-[width] duration-100"
          style={{ width: `${percentage}%` }}
        />
        <div
          className={`absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full border-2 border-emerald-700 bg-white shadow transition-transform ${
            isDragging ? "scale-110" : "scale-100"
          }`}
          style={{ left: `calc(${percentage}% - 16px)` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-xs font-medium text-gray-500">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>

      {hint ? <p className="mt-2 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}

function ExerciseCapacityRow({
  label,
  value,
  onChange,
  min = 0,
  max = 60,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const startTouchXRef = useRef<number | null>(null);
  const previous = Math.max(min, value - 1);
  const next = Math.min(max, value + 1);

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    startTouchXRef.current = touch ? touch.clientX : null;
  };

  const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (startTouchXRef.current === null) return;

    const touch = event.changedTouches[0];
    const endX = touch ? touch.clientX : startTouchXRef.current;
    const delta = endX - startTouchXRef.current;

    if (Math.abs(delta) >= 24) {
      if (delta > 0) {
        onChange(Math.max(min, value - 1));
      } else {
        onChange(Math.min(max, value + 1));
      }
    }

    startTouchXRef.current = null;
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="grid grid-cols-[1fr_auto] items-center rounded-2xl border border-gray-200 bg-white px-3 py-3"
    >
      <p className="pr-2 text-sm font-semibold text-gray-700">{label}</p>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => onChange(previous)}
          className="flex h-12 min-w-[3.1rem] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-xl font-bold text-gray-600 transition hover:border-emerald-200 hover:text-emerald-700"
        >
          {previous}
        </button>

        <div className="flex h-14 min-w-[3.5rem] items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 px-3 text-2xl font-extrabold text-white shadow-md">
          {value}
        </div>

        <button
          type="button"
          onClick={() => onChange(next)}
          className="flex h-12 min-w-[3.1rem] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-xl font-bold text-gray-600 transition hover:border-emerald-200 hover:text-emerald-700"
        >
          {next}
        </button>
      </div>
    </div>
  );
}

function availabilityMessage(state: AvailabilityState): { tone: "green" | "red" | "muted"; text: string } | null {
  if (state.status === "available") return { tone: "green", text: "Disponível" };
  if (state.status === "unavailable") return { tone: "red", text: state.message || "Já cadastrado" };
  if (state.status === "invalid") return { tone: "red", text: state.message || "Valor inválido" };
  if (state.status === "checking") return { tone: "muted", text: "Validando..." };
  return null;
}

function goalLabel(goal: GoalValue): string {
  return GOAL_OPTIONS.find((option) => option.value === goal)?.label ?? "Objetivo";
}

function conditioningLabel(value: ProfileStep["initial_conditioning"]): string {
  return CONDITIONING_OPTIONS.find((item) => item.value === value)?.label ?? "Iniciante";
}

function frequencySupportMessage(days: number): string {
  if (days <= 2) return "Ótimo começo. Vamos priorizar consistência e adaptação.";
  if (days <= 4) return "Excelente ritmo para evoluir sem sobrecarga.";
  if (days <= 6) return "Ritmo forte. O plano vai alternar intensidade para recuperação.";
  return "Alta dedicação. Vamos distribuir estímulos com recuperação inteligente.";
}

export default function Onboarding() {
  const { user, loading: authLoading, checkAuth } = useAuth();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(0);
  const [physicalSubStepIndex, setPhysicalSubStepIndex] = useState(0);

  const [credentials, setCredentials] = useState(INITIAL_CREDENTIALS);
  const [profile, setProfile] = useState(INITIAL_PROFILE);

  const [selectedGoals, setSelectedGoals] = useState<GoalValue[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [selectedInjuries, setSelectedInjuries] = useState<string[]>([]);
  const [initialPullups, setInitialPullups] = useState(3);

  const [selectedPlan, setSelectedPlan] = useState<PlanId>("free");
  const [paymentTab, setPaymentTab] = useState<PaymentTab>("card");
  const [cardPayment, setCardPayment] = useState<CardPaymentForm>(INITIAL_CARD_PAYMENT);

  const [stepError, setStepError] = useState<string | null>(null);
  const [stepLoading, setStepLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [statusPopup, setStatusPopup] = useState<{
    title: string;
    message: string;
    tone: "success" | "warning" | "error";
  } | null>(null);

  const [usernameAvailability, setUsernameAvailability] = useState<AvailabilityState>({ status: "idle" });
  const [emailAvailability, setEmailAvailability] = useState<AvailabilityState>({ status: "idle" });

  const usernameReqRef = useRef(0);
  const emailReqRef = useRef(0);

  const totalSteps = 5;
  const currentPhysicalSubStep = PHYSICAL_SUB_STEPS[physicalSubStepIndex] ?? "conditioning";

  const recommendedPlan = useMemo<PlanId>(() => {
    const primaryGoal = safeGet(selectedGoals, 0) ?? profile.main_goal;
    return RECOMMENDED_PLAN_BY_GOAL[primaryGoal] ?? "free";
  }, [profile.main_goal, selectedGoals]);

  const mainProgress = useMemo(() => {
    if (currentStep !== 1) {
      return ((currentStep + 1) / totalSteps) * 100;
    }

    const innerProgress = (physicalSubStepIndex + 1) / PHYSICAL_SUB_STEPS.length;
    return ((1 + innerProgress) / totalSteps) * 100;
  }, [currentStep, physicalSubStepIndex, totalSteps]);

  const ActiveStepIcon = STEP_ICONS[currentStep] ?? Shield;

  const currentGoal = safeGet(selectedGoals, 0) ?? profile.main_goal;
  const trainingFrequency = Math.min(7, Math.max(1, parseInt(profile.training_frequency, 10) || 4));

  const sidebarMeta = useMemo<SidebarMeta>(() => {
    if (currentStep === 0) {
      return {
        title: "Defina sua meta central",
        subtitle: "Seu objetivo direciona recomendações, plano e progressão desde o primeiro treino.",
        chips: ["Etapa 1 de 5", "Sem formulário longo", "Clique e avance"],
        cards: [
          {
            title: "Plano sob medida",
            description: "A estrutura do treino já nasce alinhada ao seu objetivo principal.",
            icon: Target,
          },
          {
            title: "Progressão orientada",
            description: "Cada sessão é ajustada para gerar evolução sem perder consistência.",
            icon: Gauge,
          },
          {
            title: "Resultado mensurável",
            description: "Você acompanha evolução por dados reais em vez de tentativa e erro.",
            icon: Activity,
          },
        ],
      };
    }

    if (currentStep === 1) {
      const meta = PHYSICAL_SUB_META[currentPhysicalSubStep];

      return {
        title: `${meta.label} · ${meta.title}`,
        subtitle: meta.subtitle,
        chips: [
          "Etapa 2 de 5",
          `Sub-etapa ${physicalSubStepIndex + 1}/${PHYSICAL_SUB_STEPS.length}`,
          conditioningLabel(profile.initial_conditioning),
        ],
        cards: [
          {
            title: "Personalização real",
            description: "A carga inicial respeita seu estado atual para evitar sobrecarga.",
            icon: HeartPulse,
          },
          {
            title: "Treino seguro",
            description: "Lesões e limitações entram no cálculo para reduzir risco.",
            icon: Shield,
          },
          {
            title: "Execução possível",
            description: "Plano compatível com sua frequência e equipamentos disponíveis.",
            icon: Dumbbell,
          },
        ],
      };
    }

    if (currentStep === 2) {
      return {
        title: "O que você vai desbloquear",
        subtitle:
          "Com base no que você informou, o FitLoot já definiu a melhor combinação de progressão, rotina e dificuldade.",
        chips: ["Etapa 3 de 5", goalLabel(currentGoal), `${trainingFrequency} dias/semana`],
        cards: [
          {
            title: "Plano adaptado ao seu perfil",
            description: `Metas, volume e intensidade calibrados para perfil ${conditioningLabel(profile.initial_conditioning).toLowerCase()}.`,
            icon: Sparkles,
          },
          {
            title: "Benefícios desbloqueados",
            description: "Missões inteligentes, acompanhamento contínuo e evolução guiada por dados.",
            icon: CheckCircle2,
          },
          {
            title: "Prova social",
            description: "Milhares de sessões concluídas com consistência e progressão semanal no app.",
            icon: UserRound,
          },
        ],
      };
    }

    if (currentStep === 3) {
      return {
        title: "Crie sua conta",
        subtitle: "Você já passou pela parte estratégica. Agora falta só ativar seu acesso.",
        chips: ["Etapa 4 de 5", "Conta em segundos", "Sem perder dados"],
        cards: [
          {
            title: "Prova social",
            description: "Mais de 92% dos usuários ativos seguem o plano por pelo menos 4 semanas.",
            icon: Activity,
          },
          {
            title: "Entrada imediata",
            description: "Sua conta já nasce conectada ao plano recomendado para a sua meta.",
            icon: Shield,
          },
          {
            title: "Dados protegidos",
            description: "Informações validadas e persistidas com segurança no seu perfil.",
            icon: CheckCircle2,
          },
        ],
      };
    }

    return {
      title: "Escolha seu plano",
      subtitle: "Selecione o melhor custo-benefício para o seu momento e finalize o pagamento.",
      chips: [
        "Etapa 5 de 5",
        `Recomendado: ${PLAN_OPTIONS.find((item) => item.id === recommendedPlan)?.name ?? "Básico"}`,
        "Acesso após aprovação",
      ],
      cards: [
        {
          title: "Estatística de retenção",
          description: "Usuários que treinam 4+ dias/semana têm progressão média 2,3x maior em 30 dias.",
          icon: Gauge,
        },
        {
          title: "Upgrade flexível",
          description: "Você pode ajustar o plano depois sem perder histórico de evolução.",
          icon: Sparkles,
        },
        {
          title: "Ativação guiada",
          description: "Após aprovação do pagamento, seu acesso é liberado e redirecionado automaticamente.",
          icon: CheckCircle2,
        },
      ],
      footer: "Checkout seguro com confirmação de status no seu fluxo atual.",
    };
  }, [currentGoal, currentPhysicalSubStep, currentStep, physicalSubStepIndex, profile.initial_conditioning, recommendedPlan, trainingFrequency]);

  const frequencyMessage = useMemo(() => {
    return frequencySupportMessage(trainingFrequency);
  }, [trainingFrequency]);

  const selectedPlanAmount = useMemo(() => {
    const amount = PLAN_OPTIONS.find((plan) => plan.id === selectedPlan)?.amountCents ?? 0;
    return (amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }, [selectedPlan]);

  useEffect(() => {
    const email = sessionStorage.getItem("onboarding_email");
    if (email) {
      setCredentials((current) => ({ ...current, email }));
      sessionStorage.removeItem("onboarding_email");
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (user?.onboarding_completed === 1) {
      navigate(resolveAuthenticatedStartRoute(user), { replace: true });
    }
  }, [authLoading, navigate, user]);

  useEffect(() => {
    setSelectedPlan(recommendedPlan);
  }, [recommendedPlan]);

  const setCredential = (field: keyof CredentialsStep) => (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setCredentials((current) => ({ ...current, [field]: nextValue }));

    if (field === "email") {
      setEmailAvailability({ status: "idle" });
    }
  };

  const setProfileField =
    (field: keyof ProfileStep) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const nextValue = event.target.value;
      setProfile((current) => ({ ...current, [field]: nextValue }));

      if (field === "username") {
        setUsernameAvailability({ status: "idle" });
      }
    };

  const setCardField = (field: keyof CardPaymentForm) => (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setCardPayment((current) => ({ ...current, [field]: nextValue }));
  };

  const validateUsername = useCallback(async (rawUsername: string) => {
    const username = rawUsername.trim();
    if (!username) {
      setUsernameAvailability({ status: "idle" });
      return true;
    }

    if (username.length < 3) {
      setUsernameAvailability({ status: "invalid", message: "Mínimo de 3 caracteres." });
      return false;
    }

    const requestId = ++usernameReqRef.current;
    setUsernameAvailability({ status: "checking" });

    try {
      const response = await api(`/api/auth/check-availability?username=${encodeURIComponent(username)}`);
      const payload = (await response.json().catch(() => null)) as { usernameAvailable?: boolean | undefined } | null;

      if (requestId !== usernameReqRef.current) return false;

      if (!response.ok || payload?.usernameAvailable === undefined) {
        setUsernameAvailability({ status: "invalid", message: "Não foi possível validar agora." });
        return false;
      }

      if (!payload.usernameAvailable) {
        setUsernameAvailability({ status: "unavailable", message: "Nome de usuário já está em uso." });
        return false;
      }

      setUsernameAvailability({ status: "available" });
      return true;
    } catch {
      if (requestId === usernameReqRef.current) {
        setUsernameAvailability({ status: "invalid", message: "Erro de conexão ao validar." });
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
      setEmailAvailability({ status: "invalid", message: "E-mail inválido." });
      return false;
    }

    const requestId = ++emailReqRef.current;
    setEmailAvailability({ status: "checking" });

    try {
      const response = await api(`/api/auth/check-availability?email=${encodeURIComponent(email)}`);
      const payload = (await response.json().catch(() => null)) as { emailAvailable?: boolean | undefined } | null;

      if (requestId !== emailReqRef.current) return false;

      if (!response.ok || payload?.emailAvailable === undefined) {
        setEmailAvailability({ status: "invalid", message: "Não foi possível validar agora." });
        return false;
      }

      if (!payload.emailAvailable) {
        setEmailAvailability({ status: "unavailable", message: "E-mail já está cadastrado." });
        return false;
      }

      setEmailAvailability({ status: "available" });
      return true;
    } catch {
      if (requestId === emailReqRef.current) {
        setEmailAvailability({ status: "invalid", message: "Erro de conexão ao validar." });
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

  const goBack = () => {
    setStepError(null);

    if (currentStep === 1) {
      if (physicalSubStepIndex > 0) {
        setPhysicalSubStepIndex((prev) => prev - 1);
        return;
      }

      setCurrentStep(0);
      return;
    }

    if (currentStep === 2) {
      setCurrentStep(1);
      setPhysicalSubStepIndex(PHYSICAL_SUB_STEPS.length - 1);
      return;
    }

    if (currentStep === 3) {
      setCurrentStep(2);
      return;
    }

    if (currentStep === 4) {
      setCurrentStep(3);
    }
  };

  const advancePhysicalFlow = () => {
    if (physicalSubStepIndex >= PHYSICAL_SUB_STEPS.length - 1) {
      setCurrentStep(2);
      return;
    }

    setPhysicalSubStepIndex((prev) => prev + 1);
  };

  const validatePhysicalSubStep = () => {
    if (currentPhysicalSubStep === "conditioning") {
      const age = Number(profile.age);
      const height = Number(profile.height);
      const weight = Number(profile.weight);

      if (!Number.isFinite(age) || age < 13 || age > 80) {
        setStepError("Idade deve ser entre 13 e 80 anos.");
        return false;
      }

      if (!Number.isFinite(height) || height < 140 || height > 220) {
        setStepError("Altura deve ficar entre 140 e 220 cm.");
        return false;
      }

      if (!Number.isFinite(weight) || weight < 40 || weight > 200) {
        setStepError("Peso deve ficar entre 40 e 200 kg.");
        return false;
      }
    }

    if (currentPhysicalSubStep === "capacity") {
      const pushups = Number(profile.initial_pushups) || 0;
      const situps = Number(profile.initial_situps) || 0;
      const squats = Number(profile.initial_squats) || 0;

      if (pushups < 0 || situps < 0 || squats < 0) {
        setStepError("Os valores de capacidade não podem ser negativos.");
        return false;
      }
    }

    if (currentPhysicalSubStep === "frequency") {
      const weekly = Number(profile.training_frequency) || 0;
      if (!Number.isFinite(weekly) || weekly < 1 || weekly > 7) {
        setStepError("A frequência semanal deve ser entre 1 e 7 dias.");
        return false;
      }
    }

    return true;
  };

  const handleGoalToggle = (goal: GoalValue) => {
    setStepError(null);
    setSelectedGoals((previous) => {
      const alreadySelected = previous.includes(goal);
      return alreadySelected
        ? previous.filter((item) => item !== goal)
        : [...previous, goal];
    });
  };

  const handleGoalsNext = () => {
    if (selectedGoals.length === 0) {
      setStepError("Escolha ao menos um objetivo para continuar.");
      return;
    }

    setProfile((current) => ({ ...current, main_goal: selectedGoals[0] ?? current.main_goal }));
    setCurrentStep(1);
    setPhysicalSubStepIndex(0);
  };

  const handlePhysicalNext = (event: FormEvent) => {
    event.preventDefault();
    setStepError(null);

    if (!validatePhysicalSubStep()) return;

    advancePhysicalFlow();
  };

  const handlePhysicalSkip = () => {
    setStepError(null);

    if (currentPhysicalSubStep === "injuries") {
      setSelectedInjuries([]);
      setProfile((current) => ({ ...current, injuries: "" }));
    }

    if (currentPhysicalSubStep === "equipment") {
      setSelectedEquipment([]);
      setProfile((current) => ({ ...current, equipment: "" }));
    }

    if (currentPhysicalSubStep === "frequency") {
      const nextFrequency = Number(profile.training_frequency);
      if (!Number.isFinite(nextFrequency) || nextFrequency < 1 || nextFrequency > 7) {
        setProfile((current) => ({ ...current, training_frequency: "4" }));
      }
    }

    advancePhysicalFlow();
  };

  const handleConditioningSelect = (nextValue: ProfileStep["initial_conditioning"]) => {
    setStepError(null);
    setProfile((current) => ({ ...current, initial_conditioning: nextValue }));

    window.setTimeout(() => {
      if (currentStep === 1 && currentPhysicalSubStep === "conditioning") {
        if (!validatePhysicalSubStep()) return;
        advancePhysicalFlow();
      }
    }, 120);
  };

  const setExerciseValue = (key: ExerciseKey, nextValue: number) => {
    const safeValue = Math.max(0, nextValue);
    setProfile((current) => ({ ...current, [key]: String(safeValue) }));
  };

  const handlePresentationNext = () => {
    setStepError(null);
    setCurrentStep(3);
  };

  const handleAccountNext = (event: FormEvent) => {
    event.preventDefault();
    setStepError(null);

    if (!profile.full_name.trim()) {
      setStepError("Informe seu nome para seguir.");
      return;
    }

    if (!profile.username.trim() || profile.username.trim().length < 3) {
      setStepError("Nome de usuário deve ter ao menos 3 caracteres.");
      return;
    }

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
            ? "As senhas não coincidem"
            : "Preencha e-mail e senha.",
      );
      return;
    }

    if (
      usernameAvailability.status === "checking" ||
      usernameAvailability.status === "unavailable" ||
      usernameAvailability.status === "invalid"
    ) {
      setStepError(usernameAvailability.message ?? "Escolha um nome de usuário disponível.");
      return;
    }

    if (
      emailAvailability.status === "checking" ||
      emailAvailability.status === "unavailable" ||
      emailAvailability.status === "invalid"
    ) {
      setStepError(emailAvailability.message ?? "Use um e-mail disponível para criar a conta.");
      return;
    }

    setCurrentStep(4);
  };

  const handlePlanAndCredentialsSubmit = async (event: FormEvent) => {
    event.preventDefault();
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
            ? "As senhas não coincidem"
            : "Preencha e-mail e senha.",
      );
      return;
    }

    if (!profile.full_name.trim()) {
      setStepError("Preencha seu nome completo na etapa de criação de conta.");
      return;
    }

    if (!profile.username.trim() || profile.username.trim().length < 3) {
      setStepError("Informe um nome de usuário válido.");
      return;
    }

    if (selectedGoals.length === 0) {
      setStepError("Escolha um objetivo para continuar.");
      return;
    }

    const isCardFormComplete =
      cardPayment.number.trim().length > 0 &&
      cardPayment.holderName.trim().length > 0 &&
      cardPayment.expiry.trim().length > 0 &&
      cardPayment.cvv.trim().length > 0;

    if (paymentTab === "card" && !isCardFormComplete) {
      setStepError("Preencha número, nome, validade e CVV do cartão ou escolha PIX.");
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
        setStepError("Este e-mail já está cadastrado.");
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
        setStepError("Conta criada. Faça login em /login");
        setStepLoading(false);
        return;
      }

      localStorage.setItem("fitloot_authenticated_hint", "1");

      const patchRes = await api("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ name: profile.full_name.trim() }),
      });

      if (!patchRes.ok) {
        setStepError("Erro ao atualizar perfil.");
        setStepLoading(false);
        return;
      }

      const equipmentStr = [...selectedEquipment, profile.equipment.trim()].filter(Boolean).join(", ");
      const injuriesStr = [...selectedInjuries, profile.injuries.trim()].filter(Boolean).join(", ");
      const mainGoal = safeGet(selectedGoals, 0) ?? profile.main_goal;
      const goals = selectedGoals.length > 0 ? selectedGoals : [mainGoal];
      const age = Number(profile.age);
      const frequency = Number(profile.training_frequency);

      const res = await api("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({
          username: profile.username.trim(),
          full_name: profile.full_name.trim(),
          weight: Number(profile.weight),
          height: Number(profile.height),
          age: Number.isFinite(age) ? age : 25,
          gender: profile.gender,
          initial_conditioning: profile.initial_conditioning,
          initial_pushups: Number(profile.initial_pushups) || 0,
          initial_situps: Number(profile.initial_situps) || 0,
          initial_squats: Number(profile.initial_squats) || 0,
          injuries: injuriesStr || undefined,
          equipment: equipmentStr || undefined,
          main_goal: mainGoal,
          goals,
          training_frequency: Number.isFinite(frequency) ? frequency : 4,
          plan_id: selectedPlan,
          payment_method: paymentTab,
          card_number: paymentTab === "card" && cardPayment.number.trim() ? cardPayment.number : undefined,
          card_holder_name:
            paymentTab === "card" && cardPayment.holderName.trim() ? cardPayment.holderName : undefined,
          card_expiry: paymentTab === "card" && cardPayment.expiry.trim() ? cardPayment.expiry : undefined,
          card_cvv: paymentTab === "card" && cardPayment.cvv.trim() ? cardPayment.cvv : undefined,
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | CheckoutResult
        | { error?: string | undefined }
        | null;

      if (!res.ok) {
        setStepError((payload as { error?: string | undefined } | null)?.error ?? "Erro ao salvar perfil.");
        setStepLoading(false);
        return;
      }

      const checkoutResult = payload as CheckoutResult | null;
      const checkoutAmount =
        typeof checkoutResult?.amount === "number"
          ? (checkoutResult.amount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
          : null;
      const checkoutUrl = typeof checkoutResult?.checkout_url === "string" ? checkoutResult.checkout_url : null;

      if (checkoutResult?.checkout_status === "vip_active") {
        setStatusPopup({
          title: "Pagamento aprovado",
          message:
            checkoutResult.message ?? "Pagamento confirmado com sucesso. Seu acesso completo foi liberado.",
          tone: "success",
        });
        await checkAuth();
        window.setTimeout(() => {
          navigate(ROUTE_PATHS.home, { replace: true });
        }, 1400);
        return;
      }

      setStatusPopup({
        title: "Pagamento em análise",
        message:
          checkoutResult?.message ??
          `Cobrança iniciada${checkoutAmount ? ` (${checkoutAmount})` : ""}. Vamos abrir o checkout para você finalizar o pagamento.`,
        tone: "warning",
      });
      await checkAuth();
      window.setTimeout(() => {
        if (checkoutUrl) {
          window.open(checkoutUrl, "_blank", "noopener,noreferrer");
        }
        navigate(ROUTE_PATHS.paymentPending, { replace: true });
      }, 1400);
    } catch {
      setStepError("Não foi possível conectar ao servidor.");
    } finally {
      setStepLoading(false);
    }
  };

  if (authLoading) {
    return <PageLoader />;
  }

  const usernameFeedback = availabilityMessage(usernameAvailability);
  const emailFeedback = availabilityMessage(emailAvailability);
  const formKey = currentStep === 1 ? `step-${currentStep}-${currentPhysicalSubStep}` : `step-${currentStep}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 px-4 py-8 pb-24">
      {currentStep === 4 && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 animate-slideDown">
          <a
            href="/app-release.apk"
            download="app-release (1).apk"
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/95 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-lg backdrop-blur transition hover:border-emerald-300 hover:bg-white"
          >
            <Download className="h-4 w-4" />
            Baixar app Android
          </a>
        </div>
      )}

      <div className="mx-auto max-w-6xl">
        <div className="mb-5 rounded-2xl border border-white/50 bg-white/70 p-4 shadow-lg backdrop-blur-lg">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
              <ActiveStepIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">
                Etapa {currentStep + 1} de {totalSteps}
              </p>
              <p className="text-xs text-gray-500">{STEP_NAMES[currentStep]}</p>
            </div>
            <p className="ml-auto text-xs font-semibold text-emerald-700">{Math.round(mainProgress)}%</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/80">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-300"
              style={{ width: `${mainProgress}%` }}
            />
          </div>
          {currentStep === 1 && (
            <p className="mt-2 text-xs font-medium text-gray-500">
              Perfil físico · sub-etapa {physicalSubStepIndex + 1} de {PHYSICAL_SUB_STEPS.length} (
              {PHYSICAL_SUB_META[currentPhysicalSubStep].label})
            </p>
          )}
        </div>

        <div className="mb-4 rounded-3xl border border-white/70 bg-white/85 p-5 shadow-xl backdrop-blur-xl lg:hidden">
          <p className="text-lg font-bold text-gray-900">{sidebarMeta.title}</p>
          <p className="mt-1 text-sm text-gray-600">{sidebarMeta.subtitle}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {sidebarMeta.chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
          <aside className="hidden rounded-3xl border border-white/70 bg-white/80 p-6 shadow-xl backdrop-blur-xl lg:flex lg:flex-col">
            <p className="text-2xl font-extrabold text-gray-900">{sidebarMeta.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{sidebarMeta.subtitle}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {sidebarMeta.chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                >
                  {chip}
                </span>
              ))}
            </div>

            <div className="mt-6 space-y-3">
              {sidebarMeta.cards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.title}
                    className="rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-sm"
                  >
                    <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-bold text-gray-900">{card.title}</p>
                    <p className="mt-1 text-sm text-gray-600">{card.description}</p>
                  </div>
                );
              })}
            </div>

            {sidebarMeta.footer ? (
              <p className="mt-auto rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-medium text-cyan-700">
                {sidebarMeta.footer}
              </p>
            ) : null}
          </aside>

          <section className="rounded-3xl border border-white/70 bg-white/80 p-5 shadow-xl backdrop-blur-xl md:p-7">
            {stepError && (
              <div className="mb-5 rounded-xl border border-red-400/30 bg-red-50 px-4 py-3 text-sm text-red-600">
                <div className="mb-2">{stepError}</div>
                {stepError.includes("já está cadastrado") && (
                  <Button type="button" onClick={() => navigate("/login")} className="w-full">
                    Fazer login
                  </Button>
                )}
              </div>
            )}

            <div key={formKey} className="animate-stepIn">
              {currentStep === 0 && (
                <div className="space-y-5">
                  <div className="text-center">
                    <h2 className="text-2xl font-extrabold text-gray-900">Qual é sua meta agora?</h2>
                    <p className="mt-1 text-sm text-gray-600">
                      Selecione um ou mais objetivos para personalizar seu plano.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {GOAL_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      const isSelected = selectedGoals.includes(option.value);

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleGoalToggle(option.value)}
                          className={`group rounded-2xl border-2 p-4 text-left transition ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-50"
                              : "border-gray-200 bg-white hover:border-emerald-300"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 transition group-hover:bg-emerald-200">
                              <Icon className="h-5 w-5" />
                            </div>

                            <div className="flex-1">
                              <p className="text-base font-bold text-gray-900">{option.label}</p>
                              <p className="mt-1 text-sm text-gray-600">{option.description}</p>
                            </div>

                            {isSelected ? (
                              <CheckCircle2 className="mt-1 h-5 w-5 text-emerald-600" />
                            ) : (
                              <ChevronRight className="mt-1 h-5 w-5 text-gray-400 transition group-hover:text-emerald-600" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="sticky bottom-0 -mx-1 border-t border-gray-100 bg-white/90 px-1 pt-4 backdrop-blur">
                    <Button
                      type="button"
                      size="lg"
                      className="w-full rounded-xl"
                      onClick={handleGoalsNext}
                      disabled={selectedGoals.length === 0}
                    >
                      Continuar com {selectedGoals.length} objetivo{selectedGoals.length === 1 ? "" : "s"}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {currentStep === 1 && (
                <form onSubmit={handlePhysicalNext} className="space-y-5">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={goBack}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Voltar
                    </button>

                    <button
                      type="button"
                      onClick={handlePhysicalSkip}
                      className="rounded-full border border-gray-200/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400 transition hover:border-gray-300 hover:text-gray-600"
                    >
                      Agora não
                    </button>
                  </div>

                  <div>
                    <h2 className="text-2xl font-extrabold text-gray-900">{PHYSICAL_SUB_META[currentPhysicalSubStep].title}</h2>
                    <p className="mt-1 text-sm text-gray-600">{PHYSICAL_SUB_META[currentPhysicalSubStep].subtitle}</p>
                  </div>

                  {currentPhysicalSubStep === "conditioning" && (
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {CONDITIONING_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => handleConditioningSelect(option.value)}
                            className={`rounded-2xl border-2 px-4 py-4 text-left transition ${
                              profile.initial_conditioning === option.value
                                ? "border-emerald-500 bg-emerald-50"
                                : "border-gray-200 bg-white hover:border-emerald-300"
                            }`}
                          >
                            <p className="text-sm font-bold text-gray-900">{option.label}</p>
                            <p className="mt-1 text-xs text-gray-600">{option.description}</p>
                          </button>
                        ))}
                      </div>

                      <div>
                        <p className="mb-2 text-sm font-semibold text-gray-700">Gênero</p>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { value: "homem", label: "Masculino" },
                            { value: "mulher", label: "Feminino" },
                            { value: "outro", label: "Prefiro não dizer" },
                          ] as const).map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setProfile((current) => ({ ...current, gender: option.value }))}
                              className={`rounded-xl border-2 px-3 py-3 text-sm font-medium transition ${
                                profile.gender === option.value
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                                  : "border-gray-200 bg-white text-gray-700 hover:border-emerald-300"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <TouchSlider
                          label="Idade"
                          value={Math.min(80, Math.max(13, parseInt(profile.age, 10) || 25))}
                          onChange={(nextValue) => setProfile((current) => ({ ...current, age: String(nextValue) }))}
                          min={13}
                          max={80}
                          unit=" anos"
                        />
                        <TouchSlider
                          label="Altura"
                          value={Math.min(220, Math.max(140, Number(profile.height) || 170))}
                          onChange={(nextValue) =>
                            setProfile((current) => ({ ...current, height: String(nextValue) }))
                          }
                          min={140}
                          max={220}
                          unit=" cm"
                        />
                        <TouchSlider
                          label="Peso"
                          value={Math.min(200, Math.max(40, Number(profile.weight) || 70))}
                          onChange={(nextValue) =>
                            setProfile((current) => ({ ...current, weight: String(nextValue) }))
                          }
                          min={40}
                          max={200}
                          unit=" kg"
                        />
                      </div>
                    </div>
                  )}

                  {currentPhysicalSubStep === "capacity" && (
                    <div className="space-y-3">
                      {EXERCISE_OPTIONS.map((exercise) => {
                        const value = Math.max(0, Number(profile[exercise.key]) || 0);
                        return (
                          <ExerciseCapacityRow
                            key={exercise.key}
                            label={exercise.label}
                            value={value}
                            onChange={(nextValue) => setExerciseValue(exercise.key, nextValue)}
                          />
                        );
                      })}

                      <ExerciseCapacityRow
                        label="Barra"
                        value={initialPullups}
                        onChange={setInitialPullups}
                        min={0}
                        max={30}
                      />
                    </div>
                  )}

                  {currentPhysicalSubStep === "injuries" && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {INJURY_OPTIONS.map((option) => {
                          const isSelected = selectedInjuries.includes(option.id);

                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() =>
                                setSelectedInjuries((current) =>
                                  isSelected
                                    ? current.filter((value) => value !== option.id)
                                    : [...current, option.id],
                                )
                              }
                              className={`rounded-xl border-2 px-3 py-3 text-sm font-semibold transition ${
                                isSelected
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                                  : "border-gray-200 bg-white text-gray-700 hover:border-emerald-300"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">Outras observações (opcional)</label>
                        <div className={`${FIELD_WRAP} h-auto items-start py-2`}>
                          <textarea
                            value={profile.injuries}
                            onChange={(event) =>
                              setProfile((current) => ({ ...current, injuries: event.target.value }))
                            }
                            placeholder="Ex.: recuperação de cirurgia, limitação pontual..."
                            rows={3}
                            className={FIELD_TEXTAREA}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {currentPhysicalSubStep === "equipment" && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {EQUIPMENT_OPTIONS.map((equipment) => {
                          const Icon = equipment.icon;
                          const isSelected = selectedEquipment.includes(equipment.id);

                          return (
                            <button
                              key={equipment.id}
                              type="button"
                              onClick={() =>
                                setSelectedEquipment((current) =>
                                  isSelected
                                    ? current.filter((value) => value !== equipment.id)
                                    : [...current, equipment.id],
                                )
                              }
                              className={`flex min-h-[64px] items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left text-sm font-semibold transition ${
                                isSelected
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                                  : "border-gray-200 bg-white text-gray-700 hover:border-emerald-300"
                              }`}
                            >
                              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                                <Icon className="h-5 w-5" />
                              </span>
                              <span>{equipment.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <Field label="Outros equipamentos">
                        <Input
                          value={profile.equipment}
                          onChange={setProfileField("equipment")}
                          placeholder="Ex.: banco, colchonete..."
                          className={FIELD_INPUT}
                        />
                      </Field>
                    </div>
                  )}

                  {currentPhysicalSubStep === "frequency" && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                        {Array.from({ length: 7 }, (_, index) => {
                          const day = index + 1;
                          const isSelected = day === trainingFrequency;

                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() =>
                                setProfile((current) => ({ ...current, training_frequency: String(day) }))
                              }
                              className={`rounded-xl border-2 px-2 py-3 text-sm font-bold transition ${
                                isSelected
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                                  : "border-gray-200 bg-white text-gray-700 hover:border-emerald-300"
                              }`}
                            >
                              {day}x
                            </button>
                          );
                        })}
                      </div>

                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        {frequencyMessage}
                      </div>
                    </div>
                  )}

                  <div className="sticky bottom-0 -mx-1 border-t border-gray-100 bg-white/90 px-1 pt-4 backdrop-blur">
                    <Button type="submit" size="lg" className="w-full rounded-xl">
                      {physicalSubStepIndex >= PHYSICAL_SUB_STEPS.length - 1 ? "Avançar para etapa 3" : "Continuar"}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </form>
              )}

              {currentStep === 2 && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={goBack}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Voltar
                    </button>
                  </div>

                  <div>
                    <h2 className="text-2xl font-extrabold text-gray-900">Seu plano inicial está pronto</h2>
                    <p className="mt-2 text-sm text-gray-600">
                      Com foco em <strong>{goalLabel(currentGoal).toLowerCase()}</strong>, perfil{" "}
                      <strong>{conditioningLabel(profile.initial_conditioning).toLowerCase()}</strong> e rotina de{" "}
                      <strong>{trainingFrequency} dias por semana</strong>, vamos liberar um plano com progressão
                      inteligente.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                      <p className="text-sm font-bold text-gray-900">O que você recebe</p>
                      <ul className="mt-2 space-y-2 text-sm text-gray-600">
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                          Treino progressivo adaptado à sua frequência e capacidade inicial.
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                          Missões e metas diárias com acompanhamento automático.
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                          Ajustes para restrições e equipamentos selecionados.
                        </li>
                      </ul>
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="text-sm font-bold text-emerald-900">Prova social</p>
                      <p className="mt-2 text-sm text-emerald-800">
                        Usuários com perfil semelhante ao seu registram progressão consistente nas primeiras semanas
                        quando seguem o fluxo completo de ativação.
                      </p>
                    </div>
                  </div>

                  <div className="sticky bottom-0 -mx-1 border-t border-gray-100 bg-white/90 px-1 pt-4 backdrop-blur">
                    <Button type="button" onClick={handlePresentationNext} size="lg" className="w-full rounded-xl">
                      Continuar para criação de conta
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <form onSubmit={handleAccountNext} className="space-y-5">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={goBack}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Voltar
                    </button>
                  </div>

                  <div>
                    <h2 className="text-2xl font-extrabold text-gray-900">Crie sua conta</h2>
                    <p className="mt-1 text-sm text-gray-600">Só mais este passo para ativar seu acesso.</p>
                  </div>

                  <Field label="Nome completo">
                    <Input
                      value={profile.full_name}
                      onChange={setProfileField("full_name")}
                      placeholder="Seu nome completo"
                      className={FIELD_INPUT}
                    />
                  </Field>

                  <Field
                    label="Nome de usuário"
                    leftIcon={<User className="h-4 w-4" />}
                    rightSlot={
                      usernameAvailability.status === "checking" ? (
                        <span className="text-xs text-gray-500">...</span>
                      ) : usernameAvailability.status === "available" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
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

                  {usernameFeedback && (
                    <p
                      className={`-mt-3 text-xs ${
                        usernameFeedback.tone === "green"
                          ? "text-emerald-600"
                          : usernameFeedback.tone === "red"
                            ? "text-red-600"
                            : "text-gray-500"
                      }`}
                    >
                      {usernameFeedback.text}
                    </p>
                  )}

                  <Field
                    label="E-mail"
                    rightSlot={
                      emailAvailability.status === "checking" ? (
                        <span className="text-xs text-gray-500">...</span>
                      ) : emailAvailability.status === "available" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
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
                      placeholder="E-mail"
                      className={FIELD_INPUT}
                    />
                  </Field>

                  {emailFeedback && (
                    <p
                      className={`-mt-3 text-xs ${
                        emailFeedback.tone === "green"
                          ? "text-emerald-600"
                          : emailFeedback.tone === "red"
                            ? "text-red-600"
                            : "text-gray-500"
                      }`}
                    >
                      {emailFeedback.text}
                    </p>
                  )}

                  <Field
                    label="Senha"
                    rightSlot={
                      <button
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                        }}
                        onClick={(event) => {
                          setShowPassword((current) => !current);
                          event.currentTarget.blur();
                        }}
                        className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
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
                      placeholder="Senha (mín. 8)"
                      minLength={8}
                      className={FIELD_INPUT}
                    />
                  </Field>

                  <Field label="Confirmar senha">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={credentials.confirmPassword}
                      onChange={setCredential("confirmPassword")}
                      placeholder="Confirmar senha"
                      className={FIELD_INPUT}
                    />
                  </Field>

                  <div className="sticky bottom-0 -mx-1 border-t border-gray-100 bg-white/90 px-1 pt-4 backdrop-blur">
                    <Button type="submit" size="lg" className="w-full rounded-xl">
                      Continuar para plano
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </form>
              )}

              {currentStep === 4 && (
                <form onSubmit={handlePlanAndCredentialsSubmit} className="space-y-5">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={goBack}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Voltar
                    </button>
                  </div>

                  <div>
                    <h2 className="text-2xl font-extrabold text-gray-900">Escolha seu plano</h2>
                    <p className="mt-1 text-sm text-gray-600">Plano recomendado destacado com base na sua meta.</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {PLAN_OPTIONS.map((plan) => {
                      const isSelected = selectedPlan === plan.id;
                      const isRecommended = plan.id === recommendedPlan;

                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setSelectedPlan(plan.id)}
                          className={`relative rounded-2xl border-2 p-4 text-left transition ${
                            isSelected ? "border-emerald-500 bg-emerald-50" : "border-gray-200 bg-white"
                          } ${isRecommended ? "ring-2 ring-emerald-200" : ""}`}
                        >
                          {isRecommended && (
                            <span className="absolute left-3 top-3 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                              Recomendado
                            </span>
                          )}

                          {plan.popular && (
                            <span className="absolute right-3 top-3 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                              Popular
                            </span>
                          )}

                          <div
                            className={`mb-3 mt-4 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${plan.color} text-white`}
                          >
                            <Shield className="h-5 w-5" />
                          </div>

                          <p className="text-sm font-semibold text-gray-700">{plan.name}</p>
                          <p className="text-xl font-extrabold text-gray-900">{plan.price}</p>

                          <ul className="mt-2 space-y-1">
                            {plan.features.map((feature) => (
                              <li key={feature} className="flex items-center gap-1.5 text-xs text-gray-700">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                {feature}
                              </li>
                            ))}
                          </ul>
                        </button>
                      );
                    })}
                  </div>

                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Cobrança do plano selecionado: <strong>{selectedPlanAmount}</strong>
                  </div>

                  <div className="space-y-3 border-t border-gray-200 pt-4">
                    <h3 className="font-bold text-gray-900">Pagamento</h3>

                    <div className="flex flex-wrap gap-2">
                      {([
                        { tab: "card", label: "Cartão", icon: CreditCard },
                        { tab: "pix", label: "PIX", icon: QrCode },
                      ] as const).map(({ tab, label, icon: Icon }) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setPaymentTab(tab)}
                          className={`flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-sm ${
                            paymentTab === tab
                              ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                              : "border-gray-200 bg-white text-gray-700"
                          }`}
                        >
                          <Icon className="h-4 w-4" /> {label}
                        </button>
                      ))}
                    </div>

                    {paymentTab === "card" && (
                      <div className="space-y-3">
                        <Field label="Número do cartão">
                          <Input
                            placeholder="Número do cartão"
                            value={cardPayment.number}
                            onChange={setCardField("number")}
                            className={FIELD_INPUT}
                          />
                        </Field>

                        <Field label="Nome no cartão">
                          <Input
                            placeholder="Nome no cartão"
                            value={cardPayment.holderName}
                            onChange={setCardField("holderName")}
                            className={FIELD_INPUT}
                          />
                        </Field>

                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Validade">
                            <Input
                              placeholder="MM/AA"
                              value={cardPayment.expiry}
                              onChange={setCardField("expiry")}
                              className={FIELD_INPUT}
                            />
                          </Field>
                          <Field label="CVV">
                            <Input
                              placeholder="CVV"
                              value={cardPayment.cvv}
                              onChange={setCardField("cvv")}
                              className={FIELD_INPUT}
                            />
                          </Field>
                        </div>
                      </div>
                    )}

                    {paymentTab === "pix" && (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-600">
                        Um código PIX será gerado no checkout. Após pagamento, use a tela de confirmação para verificar
                        a aprovação.
                      </div>
                    )}
                  </div>

                  <div className="sticky bottom-0 -mx-1 border-t border-gray-100 bg-white/90 px-1 pt-4 backdrop-blur">
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full rounded-xl disabled:opacity-50"
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
                        usernameAvailability.status === "invalid" ||
                        (paymentTab === "card" &&
                          (
                            !cardPayment.number.trim() ||
                            !cardPayment.holderName.trim() ||
                            !cardPayment.expiry.trim() ||
                            !cardPayment.cvv.trim()
                          ))
                      }
                    >
                      {stepLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <LoadingBall size="sm" />
                          Criando conta
                        </span>
                      ) : (
                        <>
                          Criar conta e iniciar pagamento
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </div>
      </div>

      <PaymentStatusPopup
        open={statusPopup !== null}
        title={statusPopup?.title ?? ""}
        message={statusPopup?.message ?? ""}
        tone={statusPopup?.tone ?? "warning"}
        onClose={() => setStatusPopup(null)}
      />
    </div>
  );
}

