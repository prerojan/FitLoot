import type { AvailabilityState, ProfileStep } from "./types";

export function availabilityMessage(state: AvailabilityState): { tone: "green" | "red" | "muted"; text: string } | null {
  if (state.status === "available") return { tone: "green", text: "Disponivel" };
  if (state.status === "unavailable") return { tone: "red", text: state.message || "Ja cadastrado" };
  if (state.status === "invalid") return { tone: "red", text: state.message || "Valor invalido" };
  if (state.status === "checking") return { tone: "muted", text: "Validando..." };
  return null;
}

export function parseDelimitedValues(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function splitCatalogValues(
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

export function mergeCatalogValues(selected: string[], notes: string) {
  return [...selected, ...parseDelimitedValues(notes)].join(", ");
}

export function toneClass(tone: "green" | "red" | "muted") {
  if (tone === "green") return "text-emerald-400";
  if (tone === "red") return "text-red-400";
  return "text-[var(--fl-onboarding-subtle)]";
}

export function frequencyMessage(days: number) {
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

export function getPasswordMismatchMessage(password: string, confirmPassword: string): string | null {
  if (!password && !confirmPassword) return null;
  if (password === confirmPassword) return null;
  return "As senhas nao coincidem";
}

export function goalPlanCopy(goal: ProfileStep["main_goal"]) {
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

export function conditioningPlanCopy(conditioning: ProfileStep["initial_conditioning"]) {
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

export function conditioningPlanNarrative(conditioning: ProfileStep["initial_conditioning"]) {
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
