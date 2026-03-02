import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type WheelEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/App";
import { api } from "@/react-app/utils/api";
import { Button } from "@/react-app/components/ui/button";
import { Input } from "@/react-app/components/ui/input";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Dumbbell,
  FileText,
  Gauge,
  HeartPulse,
  Monitor,
  QrCode,
  Ruler,
  Shield,
  Target,
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

function ScrollPicker({ value, onChange, min, max, unit, label }: ScrollPickerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputStr, setInputStr] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  const clamped = Math.min(max, Math.max(min, value));
  const prevVal = clamped > min ? clamped - 1 : min;
  const nextVal = clamped < max ? clamped + 1 : max;

  useEffect(() => {
    setInputStr(String(clamped));
  }, [clamped]);

  useEffect(() => {
    if (isEditing && inputRef.current) inputRef.current.focus();
  }, [isEditing]);

  const handleBlur = () => {
    const n = parseInt(inputStr, 10);
    if (!Number.isFinite(n)) {
      setInputStr(String(clamped));
      setIsEditing(false);
      return;
    }

    const next = Math.min(max, Math.max(min, n));
    setInputStr(String(next));
    onChange(next);
    setIsEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleBlur();
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0 && clamped < max) onChange(clamped + 1);
    else if (e.deltaY > 0 && clamped > min) onChange(clamped - 1);
  };

  return (
    <div className="flex w-full flex-col items-center">
      <p className="mb-2 text-xs font-medium text-gray-500">{label}</p>
      <div
        className="w-full max-w-[154px] select-none rounded-2xl border border-emerald-100 bg-white/95 py-2 shadow-sm backdrop-blur"
        onWheel={handleWheel}
      >
        <button type="button" onClick={() => onChange(prevVal)} className="w-full py-1 text-sm text-gray-400 transition hover:text-gray-600">
          {prevVal} {unit}
        </button>
        <div className="flex items-center justify-center border-y border-emerald-100 py-3">
          {isEditing ? (
            <span className="flex items-center gap-1">
              <input
                ref={inputRef}
                type="number"
                min={min}
                max={max}
                value={inputStr}
                onChange={(e) => setInputStr(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="w-14 bg-transparent text-center text-2xl font-bold text-emerald-700 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="text-emerald-700">{unit}</span>
            </span>
          ) : (
            <button type="button" onClick={() => setIsEditing(true)} className="text-2xl font-bold text-emerald-700">
              {clamped}
              <span className="ml-1 text-lg font-medium">{unit}</span>
            </button>
          )}
        </div>
        <button type="button" onClick={() => onChange(nextVal)} className="w-full py-1 text-sm text-gray-400 transition hover:text-gray-600">
          {nextVal} {unit}
        </button>
      </div>
    </div>
  );
}

type CredentialsStep = {
  email: string;
  password: string;
  confirmPassword: string;
  name: string;
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
};

const INITIAL_CREDENTIALS: CredentialsStep = {
  email: "",
  password: "",
  confirmPassword: "",
  name: "",
};

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

const STEP_NAMES = ["Identidade", "Corpo", "Objetivos", "Condicionamento", "Plano e conta"] as const;

const STEP_ICONS = [UserRound, Ruler, Target, Activity, Shield];

type GoalValue = ProfileStep["main_goal"];

const GOAL_OPTIONS: { value: GoalValue; label: string; icon: typeof Target }[] = [
  { value: "perder_peso", label: "Perder peso", icon: Zap },
  { value: "ganhar_massa", label: "Ganhar massa muscular", icon: Dumbbell },
  { value: "resistencia", label: "Melhorar condicionamento", icon: Activity },
  { value: "saude_geral", label: "Saúde e qualidade de vida", icon: HeartPulse },
  { value: "calistenia", label: "Estética e definição", icon: Gauge },
];

const EQUIPMENT_OPTIONS: { id: string; label: string; icon: typeof Dumbbell }[] = [
  { id: "halteres", label: "Halteres", icon: Dumbbell },
  { id: "barra", label: "Barra", icon: Monitor },
  { id: "anilhas", label: "Anilhas", icon: Gauge },
  { id: "corda", label: "Corda", icon: Activity },
  { id: "elastico", label: "Elástico", icon: Zap },
  { id: "kettlebell", label: "Kettlebell", icon: Weight },
];

export default function Onboarding() {
  const { user, loading: authLoading, checkAuth } = useAuth();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(0);
  const [credentials, setCredentials] = useState(INITIAL_CREDENTIALS);
  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [selectedPlan, setSelectedPlan] = useState<"free" | "pro" | "annual">("free");
  const [paymentTab, setPaymentTab] = useState<"card" | "boleto" | "pix">("card");
  const [stepError, setStepError] = useState<string | null>(null);
  const [stepLoading, setStepLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedGoals, setSelectedGoals] = useState<GoalValue[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [planPeriod, setPlanPeriod] = useState<"monthly" | "yearly">("yearly");

  const totalSteps = 5;

  useEffect(() => {
    const email = sessionStorage.getItem("onboarding_email");
    if (email) {
      setCredentials((c) => ({ ...c, email }));
      sessionStorage.removeItem("onboarding_email");
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (user?.onboarding_completed === 1) navigate("/home");
  }, [authLoading, navigate, user]);

  const setCredential = (field: keyof CredentialsStep) => (e: ChangeEvent<HTMLInputElement>) => {
    setCredentials((c) => ({ ...c, [field]: e.target.value }));
  };

  const setProfileField =
    (field: keyof ProfileStep) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setProfile((p) => ({ ...p, [field]: e.target.value }));
    };

  const handleIdentityNext = (e: FormEvent) => {
    e.preventDefault();
    setStepError(null);

    if (!profile.full_name.trim() || !profile.username.trim() || profile.username.length < 3) {
      setStepError("Preencha nome completo e nome de usuário (mín. 3 caracteres).");
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

    if (!Number.isFinite(weight) || weight < 40 || weight > 200 || !Number.isFinite(height) || height < 140 || height > 220) {
      setStepError("Altura (140–220 cm) e peso (40–200 kg) devem estar no intervalo válido.");
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

    setProfile((p) => ({ ...p, main_goal: selectedGoals[0] ?? p.main_goal }));
    setCurrentStep(3);
  };

  const handleConditioningNext = (e: FormEvent) => {
    e.preventDefault();
    setStepError(null);

    const pushups = Number(profile.initial_pushups) || 0;
    const situps = Number(profile.initial_situps) || 0;
    const squats = Number(profile.initial_squats) || 0;

    if (pushups < 0 || situps < 0 || squats < 0) {
      setStepError("Valores dos contadores não podem ser negativos.");
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
      credentials.password !== credentials.confirmPassword ||
      !credentials.name.trim()
    ) {
      setStepError(
        credentials.password.length < 8
          ? "A senha deve ter pelo menos 8 caracteres"
          : credentials.password !== credentials.confirmPassword
            ? "As senhas não coincidem"
            : "Preencha e-mail, nome e senha.",
      );
      return;
    }

    setStepLoading(true);

    try {
      const registerRes = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: credentials.email, password: credentials.password, name: credentials.name.trim() }),
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
        setStepError("Conta criada. Faça login em /app");
        setStepLoading(false);
        return;
      }

      await checkAuth();

      const patchRes = await api("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ name: profile.full_name || credentials.name }),
      });

      if (!patchRes.ok) {
        setStepError("Erro ao atualizar perfil.");
        setStepLoading(false);
        return;
      }

      const equipmentStr = [...selectedEquipment, profile.equipment].filter(Boolean).join(", ");
      const mainGoal = selectedGoals.length > 0 ? selectedGoals[0] : profile.main_goal;

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
        setStepError((data as { error?: string }).error ?? "Erro ao salvar perfil.");
        setStepLoading(false);
        return;
      }

      const paymentMethod = selectedPlan === "free" ? "none" : paymentTab === "card" ? "card" : paymentTab === "boleto" ? "boleto" : "pix";
      const status = selectedPlan === "free" ? "active" : paymentTab === "card" ? "active" : "pending";

      const planRes = await api("/api/users/plan", {
        method: "POST",
        body: JSON.stringify({
          plan_id: selectedPlan,
          payment_method: paymentMethod as "none" | "card" | "boleto" | "pix",
          status: status as "active" | "pending",
        }),
      });

      if (!planRes.ok) {
        setStepError("Erro ao salvar plano.");
        setStepLoading(false);
        return;
      }

      await checkAuth();
      navigate("/home");
    } catch {
      setStepError("Não foi possível conectar ao servidor.");
    } finally {
      setStepLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
        <div className="text-emerald-600">Carregando...</div>
      </div>
    );
  }

  const progress = ((currentStep + 1) / totalSteps) * 100;
  const ActiveStepIcon = STEP_ICONS[currentStep] ?? Shield;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 px-4 py-8 pb-24">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur-lg">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
              <ActiveStepIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">Etapa {currentStep + 1} de {totalSteps}</p>
              <p className="text-xs text-gray-500">{STEP_NAMES[currentStep]}</p>
            </div>
            <p className="ml-auto text-xs font-semibold text-emerald-700">{Math.round(progress)}%</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/80">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="rounded-3xl border border-white/70 bg-white/80 p-6 shadow-xl backdrop-blur-xl md:p-8">
          {stepError && (
            <div className="mb-5 rounded-xl border border-red-400/30 bg-red-50 px-4 py-3 text-sm text-red-600">
              <div className="mb-2">{stepError}</div>
              {stepError.includes("já está cadastrado") && (
                <Button type="button" onClick={() => navigate("/app")} className="w-full">Fazer login</Button>
              )}
            </div>
          )}

          {currentStep === 0 && (
            <form onSubmit={handleIdentityNext} className="space-y-5 animate-stepIn">
              <div className="mb-2 text-center">
                <h2 className="text-2xl font-bold text-gray-900">Sua identidade</h2>
                <p className="mt-1 text-sm text-gray-600">Vamos configurar um perfil rápido para personalizar sua experiência.</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nome completo</label>
                <Input value={profile.full_name} onChange={setProfileField("full_name")} placeholder="Seu nome completo" className="rounded-xl border-2 border-gray-200 focus:border-emerald-500" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nome de usuário</label>
                <div className="flex rounded-xl border-2 border-gray-200 bg-white transition focus-within:border-emerald-500">
                  <span className="flex items-center pl-3 text-gray-400"><User className="h-4 w-4" /></span>
                  <Input value={profile.username} onChange={setProfileField("username")} placeholder="nome_de_usuario" minLength={3} className="border-0 focus-visible:ring-0" />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Gênero</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: "homem", label: "Masculino" },
                    { value: "mulher", label: "Feminino" },
                    { value: "outro", label: "Prefiro não dizer" },
                  ] as const).map((opt) => (
                    <button key={opt.value} type="button" onClick={() => setProfile((p) => ({ ...p, gender: opt.value }))} className={`rounded-xl border-2 px-3 py-3 text-sm font-medium transition ${profile.gender === opt.value ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-700 hover:border-emerald-200"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <ScrollPicker label="Idade" value={Math.min(80, Math.max(13, parseInt(profile.age, 10) || 25))} onChange={(v) => setProfile((p) => ({ ...p, age: String(v) }))} min={13} max={80} unit="anos" />

              <Button type="submit" size="lg" className="mt-6 w-full rounded-xl">Continuar <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </form>
          )}

          {currentStep === 1 && (
            <form onSubmit={handleBodyNext} className="space-y-6 animate-stepIn">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900">Medidas do corpo</h2>
                <p className="mt-1 text-sm text-gray-600">Isso nos ajuda a criar metas mais inteligentes para você.</p>
              </div>

              <div className="grid grid-cols-2 gap-6 justify-items-center">
                <ScrollPicker label="Altura" value={Math.min(220, Math.max(140, Number(profile.height) || 170))} onChange={(v) => setProfile((p) => ({ ...p, height: String(v) }))} min={140} max={220} unit="cm" />
                <ScrollPicker label="Peso" value={Math.min(200, Math.max(40, Number(profile.weight) || 70))} onChange={(v) => setProfile((p) => ({ ...p, weight: String(v) }))} min={40} max={200} unit="kg" />
              </div>

              <Button type="submit" size="lg" className="w-full rounded-xl">Continuar <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </form>
          )}

          {currentStep === 2 && (
            <form onSubmit={handleGoalsNext} className="space-y-5 animate-stepIn">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900">Objetivos</h2>
                <p className="mt-1 text-sm text-gray-600">Selecione os objetivos que melhor representam seu foco atual.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {GOAL_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = selectedGoals.includes(opt.value);
                  return (
                    <button key={opt.value} type="button" onClick={() => setSelectedGoals((prev) => (isSelected ? prev.filter((g) => g !== opt.value) : [...prev, opt.value]))} className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition ${isSelected ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-700 hover:border-emerald-200"}`}>
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Icon className="h-4 w-4" /></span>
                      <span className="flex-1">{opt.label}</span>
                      {isSelected && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    </button>
                  );
                })}
              </div>

              <Button type="submit" disabled={selectedGoals.length === 0} size="lg" className="w-full rounded-xl disabled:opacity-50">Continuar <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </form>
          )}

          {currentStep === 3 && (
            <form onSubmit={handleConditioningNext} className="space-y-6 animate-stepIn">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900">Condicionamento</h2>
                <p className="mt-1 text-sm text-gray-600">Um retrato rápido do seu nível atual.</p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([
                  { value: "sedentario", label: "Sedentário" },
                  { value: "iniciante", label: "Iniciante" },
                  { value: "intermediario", label: "Intermediário" },
                  { value: "avancado", label: "Avançado" },
                ] as const).map((c) => (
                  <button key={c.value} type="button" onClick={() => setProfile((p) => ({ ...p, initial_conditioning: c.value }))} className={`rounded-xl border-2 px-3 py-3 text-sm font-medium transition ${profile.initial_conditioning === c.value ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-700"}`}>
                    {c.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: "initial_pushups" as const, label: "Flexões" },
                  { key: "initial_situps" as const, label: "Abdominais" },
                  { key: "initial_squats" as const, label: "Agachamentos" },
                ].map(({ key, label }) => {
                  const val = Number(profile[key]) || 0;
                  return (
                    <div key={key} className="rounded-xl border border-gray-200 bg-white p-3 text-center">
                      <p className="mb-2 text-xs font-medium text-gray-600">{label}</p>
                      <div className="flex items-center justify-center gap-2">
                        <button type="button" onClick={() => setProfile((p) => ({ ...p, [key]: String(Math.max(0, val - 1)) }))} className="h-8 w-8 rounded-lg bg-gray-100 font-bold">−</button>
                        <span className="w-8 font-bold text-emerald-700">{val}</span>
                        <button type="button" onClick={() => setProfile((p) => ({ ...p, [key]: String(val + 1) }))} className="h-8 w-8 rounded-lg bg-gray-100 font-bold">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Lesões ou limitações (opcional)</label>
                <textarea value={profile.injuries} onChange={(e) => setProfile((p) => ({ ...p, injuries: e.target.value }))} placeholder="Ex: joelho, lombar..." rows={2} className="w-full resize-none rounded-xl border-2 border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-500" />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Equipamentos disponíveis</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {EQUIPMENT_OPTIONS.map((eq) => {
                    const Icon = eq.icon;
                    const isSelected = selectedEquipment.includes(eq.id);
                    return (
                      <button key={eq.id} type="button" onClick={() => setSelectedEquipment((prev) => (isSelected ? prev.filter((v) => v !== eq.id) : [...prev, eq.id]))} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm transition ${isSelected ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-700"}`}>
                        <Icon className="h-4 w-4" />
                        <span>{eq.label}</span>
                      </button>
                    );
                  })}
                </div>
                <Input value={profile.equipment} onChange={setProfileField("equipment")} placeholder="Outros equipamentos" className="mt-2 rounded-xl" />
              </div>

              <Button type="submit" size="lg" className="w-full rounded-xl">Continuar <ChevronRight className="ml-1 h-4 w-4" /></Button>
            </form>
          )}

          {currentStep === 4 && (
            <form onSubmit={handlePlanAndCredentialsSubmit} className="space-y-6 animate-stepIn">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900">Plano e conta</h2>
                <p className="mt-1 text-sm text-gray-600">Finalize seu acesso ao FitLoot em poucos passos.</p>
              </div>

              <div className="flex justify-center gap-2">
                <button type="button" onClick={() => setPlanPeriod("monthly")} className={`rounded-xl px-4 py-2 text-sm font-medium ${planPeriod === "monthly" ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-600"}`}>Mensal</button>
                <button type="button" onClick={() => setPlanPeriod("yearly")} className={`rounded-xl px-4 py-2 text-sm font-medium ${planPeriod === "yearly" ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-600"}`}>Anual</button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { id: "free" as const, name: "Free", price: "Grátis", color: "from-gray-400 to-gray-500", features: ["Missões diárias", "XP e níveis", "Ranking básico"], popular: false },
                  { id: "pro" as const, name: "Premium", price: planPeriod === "yearly" ? "R$ 82,50" : "R$ 99", color: "from-emerald-500 to-teal-600", features: ["Tudo do Free", "Scanner com IA", "Ranking global"], popular: true },
                  { id: "annual" as const, name: "Elite", price: planPeriod === "yearly" ? "R$ 124" : "R$ 149", color: "from-purple-500 to-pink-600", features: ["Tudo do Premium", "Planos de treino", "Suporte VIP"], popular: false },
                ].map((plan) => (
                  <button key={plan.id} type="button" onClick={() => setSelectedPlan(plan.id)} className={`relative rounded-2xl border-2 p-4 text-left transition ${selectedPlan === plan.id ? "border-emerald-500 bg-emerald-50" : "border-gray-200 bg-white"}`}>
                    {plan.popular && <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">Popular</span>}
                    <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${plan.color} text-white`}><Shield className="h-5 w-5" /></div>
                    <h4 className="font-bold text-gray-900">{plan.name}</h4>
                    <p className="mb-2 text-xl font-bold text-gray-900">{plan.price}</p>
                    <ul className="space-y-1">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-center gap-1.5 text-xs text-gray-700"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{f}</li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>

              <div className="space-y-3 border-t border-gray-200 pt-4">
                <h3 className="font-bold text-gray-900">Crie sua conta</h3>
                <Input type="email" value={credentials.email} onChange={setCredential("email")} placeholder="E-mail" required className="rounded-xl" />
                <div className="relative">
                  <Input type={showPassword ? "text" : "password"} value={credentials.password} onChange={setCredential("password")} placeholder="Senha (mín. 8)" minLength={8} required className="rounded-xl pr-10" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">ver</button>
                </div>
                <Input type={showPassword ? "text" : "password"} value={credentials.confirmPassword} onChange={setCredential("confirmPassword")} placeholder="Confirmar senha" required className="rounded-xl" />
                <Input type="text" value={credentials.name} onChange={setCredential("name")} placeholder="Nome" required className="rounded-xl" />
              </div>

              {(selectedPlan === "pro" || selectedPlan === "annual") && (
                <div className="space-y-3 border-t border-gray-200 pt-4">
                  <h3 className="font-bold text-gray-900">Pagamento</h3>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { tab: "card", label: "Cartão", icon: CreditCard },
                      { tab: "boleto", label: "Boleto", icon: FileText },
                      { tab: "pix", label: "PIX", icon: QrCode },
                    ] as const).map(({ tab, label, icon: Icon }) => (
                      <button key={tab} type="button" onClick={() => setPaymentTab(tab)} className={`flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 text-sm ${paymentTab === tab ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-700"}`}>
                        <Icon className="h-4 w-4" /> {label}
                      </button>
                    ))}
                  </div>

                  {paymentTab === "card" && (
                    <div className="space-y-2">
                      <Input placeholder="Número do cartão" className="rounded-xl" />
                      <Input placeholder="Nome no cartão" className="rounded-xl" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="Validade" className="rounded-xl" />
                        <Input placeholder="CVV" className="rounded-xl" />
                      </div>
                    </div>
                  )}

                  {paymentTab === "boleto" && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-600">
                      Linha digitável de demonstração gerada após confirmação.
                    </div>
                  )}

                  {paymentTab === "pix" && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-600">
                      QR Code de demonstração será exibido após criar a conta.
                    </div>
                  )}
                </div>
              )}

              <Button type="submit" disabled={stepLoading || !credentials.email || !credentials.password || credentials.password.length < 8 || credentials.password !== credentials.confirmPassword || !credentials.name.trim()} size="lg" className="w-full rounded-xl disabled:opacity-50">
                {stepLoading ? "Criando conta..." : "Criar conta e finalizar"}
                {!stepLoading && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}