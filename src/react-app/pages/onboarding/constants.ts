import type { CredentialsStep, ProfileStep } from "./types";

export const FIELD_WRAP = "fl-onboarding-input-shell";
export const FIELD_INPUT =
  "h-full w-full !border-0 !bg-transparent !p-0 text-base text-[var(--fl-onboarding-ink)] !shadow-none !ring-0 " +
  "placeholder:text-[var(--fl-onboarding-subtle)] focus-visible:!ring-0 focus-visible:!ring-offset-0";
export const FIELD_TEXTAREA =
  "w-full resize-none !border-0 !bg-transparent !p-0 text-sm text-[var(--fl-onboarding-ink)] outline-none !shadow-none !ring-0 " +
  "placeholder:text-[var(--fl-onboarding-subtle)] focus-visible:!ring-0 focus-visible:!ring-offset-0";

export const TOTAL_STEPS = 13;
export const PLAN_PREVIEW_LOADING_MS = 7400;

export const STEP_META = [
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

export const INITIAL_CREDENTIALS: CredentialsStep = { email: "", password: "", confirmPassword: "" };
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const INITIAL_PROFILE: ProfileStep = {
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
