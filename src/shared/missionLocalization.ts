import { repairKnownMojibakeString } from "./textEncoding";

const PHRASE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Full Body Calisthenics Circuit/gi, "Circuito de Calistenia de Corpo Inteiro"],
  [/Mobility\s*&\s*Recovery Circuit/gi, "Circuito de Mobilidade e Recupera\u00e7\u00e3o"],
  [/Upper Body Strength\s*&\s*Core/gi, "For\u00e7a de Membros Superiores e Core"],
  [/Lower Body Power/gi, "Pot\u00eancia de Membros Inferiores"],
  [/Core Control Circuit/gi, "Circuito de Controle do Core"],
  [/Air Squat/gi, "Agachamento Livre"],
  [/\bPush-?up\b/gi, "Flex\u00e3o"],
  [/\bPull-?up\b/gi, "Barra Fixa"],
  [/\bSit-?up\b/gi, "Abdominal"],
  [/\bCrunch(?:es)?\b/gi, "Abdominal"],
  [/\bPlank\b/gi, "Prancha"],
  [/\bBurpee\b/gi, "Burpee"],
  [/\bLunge\b/gi, "Avan\u00e7o"],
  [/\bWall Sit\b/gi, "Cadeira Isom\u00e9trica"],
  [/\bDead Hang\b/gi, "Suspens\u00e3o na Barra"],
  [/\bHollow Body\b/gi, "Hollow Body"],
  [/\bStretching\b/gi, "Alongamento"],
  [/\bMobility\b/gi, "Mobilidade"],
  [/\bRecovery\b/gi, "Recupera\u00e7\u00e3o"],
  [/\bStrength\b/gi, "For\u00e7a"],
  [/\bPower\b/gi, "Pot\u00eancia"],
  [/\bDistance\b/gi, "Dist\u00e2ncia"],
  [/\bConsistency\b/gi, "Consist\u00eancia"],
  [/\bStreak\b/gi, "Sequ\u00eancia"],
  [/\bWalk(?:ing)?\b/gi, "Caminhada"],
  [/\bRun(?:ning)?\b/gi, "Corrida"],
  [/\bUpper Body\b/gi, "Parte Superior"],
  [/\bLower Body\b/gi, "Parte Inferior"],
  [/\bFull Body\b/gi, "Corpo Inteiro"],
  [/\bDaily\b/gi, "Di\u00e1ria"],
  [/\bWeekly\b/gi, "Semanal"],
  [/\bMonthly\b/gi, "Mensal"],
  [/\bMission\b/gi, "Miss\u00e3o"],
  [/\bMissions\b/gi, "Miss\u00f5es"],
];

const ACCENT_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bMissao\b/g, "Miss\u00e3o"],
  [/\bmissao\b/g, "miss\u00e3o"],
  [/\bMissoes\b/g, "Miss\u00f5es"],
  [/\bmissoes\b/g, "miss\u00f5es"],
  [/\bDiaria\b/g, "Di\u00e1ria"],
  [/\bdiaria\b/g, "di\u00e1ria"],
  [/\bSeries\b/g, "S\u00e9ries"],
  [/\bseries\b/g, "s\u00e9ries"],
  [/\bSerie\b/g, "S\u00e9rie"],
  [/\bserie\b/g, "s\u00e9rie"],
  [/\bRepeticoes\b/g, "Repeti\u00e7\u00f5es"],
  [/\brepeticoes\b/g, "repeti\u00e7\u00f5es"],
  [/\bRespiracao\b/g, "Respira\u00e7\u00e3o"],
  [/\brespiracao\b/g, "respira\u00e7\u00e3o"],
  [/\bTecnica\b/g, "T\u00e9cnica"],
  [/\btecnica\b/g, "t\u00e9cnica"],
  [/\bAutomatico\b/g, "Autom\u00e1tico"],
  [/\bautomatico\b/g, "autom\u00e1tico"],
  [/\bAutomatica\b/g, "Autom\u00e1tica"],
  [/\bautomatica\b/g, "autom\u00e1tica"],
  [/\bConsistencia\b/g, "Consist\u00eancia"],
  [/\bconsistencia\b/g, "consist\u00eancia"],
  [/\bDistancia\b/g, "Dist\u00e2ncia"],
  [/\bdistancia\b/g, "dist\u00e2ncia"],
  [/\bMes\b/g, "M\u00eas"],
  [/\bmes\b/g, "m\u00eas"],
  [/\bGluteo\b/g, "Gl\u00fateo"],
  [/\bgluteo\b/g, "gl\u00fateo"],
  [/â€¢/g, "\u2022"],
];

function normalizeMissionTextBase(value: string): string {
  return repairKnownMojibakeString(value).replace(/\s+/g, " ").trim();
}

function normalizeForLookup(value: string): string {
  return normalizeMissionTextBase(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function capitalizeSentence(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function summarizeTaskLabel(label: string): string {
  const localized = localizeMissionText(label) ?? label;
  return localized
    .replace(/^Conclua\s+/i, "")
    .replace(/^Complete\s+/i, "")
    .replace(/^\d+\s+vezes\s+/i, "")
    .replace(/^\d+\s+miss(?:\u00f5es|oes)\s+di[a\u00e1]rias\s+de\s+/i, "")
    .replace(/^\d+\s+miss(?:\u00f5es|oes)\s+de\s+/i, "")
    .replace(/^miss(?:\u00e3o|ao)\s+di[a\u00e1]ria\s+/i, "")
    .trim();
}

export function localizeMissionText(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return value;
  }

  let localized = normalizeMissionTextBase(value);

  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    localized = localized.replace(pattern, replacement);
  }

  for (const [pattern, replacement] of ACCENT_REPLACEMENTS) {
    localized = localized.replace(pattern, replacement);
  }

  localized = localized
    .replace(/\s+:/g, ":")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  return localized;
}

export function localizeMissionTextArray(values: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => localizeMissionText(value) ?? "")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function buildMissionDisplayGoalFromTasks(
  labels: readonly string[],
  period: "weekly" | "monthly",
): string | null {
  const summarized = labels
    .map((label) => summarizeTaskLabel(label))
    .filter((label) => label.length > 0)
    .slice(0, 5);

  if (summarized.length === 0) return null;

  const joined = summarized.join(", ");
  return period === "weekly"
    ? `Conclua as miss\u00f5es di\u00e1rias compat\u00edveis de ${joined} nesta semana.`
    : `Conclua as miss\u00f5es di\u00e1rias compat\u00edveis de ${joined} ao longo deste m\u00eas.`;
}

export function inferMissionVisualTarget(value: string | null | undefined): string {
  const normalized = normalizeForLookup(String(value ?? ""));

  if (
    normalized.includes("core") ||
    normalized.includes("abdominal") ||
    normalized.includes("prancha") ||
    normalized.includes("plank") ||
    normalized.includes("hollow") ||
    normalized.includes("l-sit") ||
    normalized.includes("wall sit")
  ) {
    return "core";
  }

  if (
    normalized.includes("agach") ||
    normalized.includes("squat") ||
    normalized.includes("lunge") ||
    normalized.includes("avanco") ||
    normalized.includes("glute") ||
    normalized.includes("corrida") ||
    normalized.includes("run") ||
    normalized.includes("walk") ||
    normalized.includes("caminhada") ||
    normalized.includes("legs") ||
    normalized.includes("parte inferior")
  ) {
    return "legs";
  }

  if (
    normalized.includes("mobilidade") ||
    normalized.includes("mobility") ||
    normalized.includes("alongamento") ||
    normalized.includes("stretch") ||
    normalized.includes("yoga") ||
    normalized.includes("recovery") ||
    normalized.includes("recuperacao")
  ) {
    return "mobility";
  }

  if (
    normalized.includes("flexao") ||
    normalized.includes("push") ||
    normalized.includes("pull") ||
    normalized.includes("barra") ||
    normalized.includes("upper body") ||
    normalized.includes("parte superior") ||
    normalized.includes("peito") ||
    normalized.includes("costas") ||
    normalized.includes("ombro")
  ) {
    return "upper body";
  }

  return "full body";
}

function iconColorByTarget(target: string): { fill: string; accent: string } {
  const normalized = normalizeForLookup(target);
  if (normalized.includes("core")) {
    return { fill: "#d9f99d", accent: "#4d7c0f" };
  }
  if (normalized.includes("leg")) {
    return { fill: "#bfdbfe", accent: "#1d4ed8" };
  }
  if (normalized.includes("mobility")) {
    return { fill: "#fde68a", accent: "#b45309" };
  }
  if (normalized.includes("upper")) {
    return { fill: "#fecaca", accent: "#b91c1c" };
  }
  return { fill: "#e9d5ff", accent: "#7c3aed" };
}

export function normalizeMissionMediaUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();
  if (trimmed.length === 0) return null;
  if (
    lowered.startsWith("http://")
    || lowered.startsWith("https://")
    || lowered.startsWith("data:")
    || lowered.startsWith("blob:")
  ) {
    return trimmed;
  }

  const sanitized = trimmed.startsWith("./")
    ? trimmed.slice(2)
    : trimmed.startsWith("/")
      ? trimmed.slice(1)
      : trimmed;
  const sanitizedLower = sanitized.toLowerCase();
  const filename = sanitizedLower.split("?")[0] ?? sanitizedLower;
  const hasKnownExtension = [".gif", ".png", ".jpg", ".jpeg", ".webp", ".mp4"]
    .some((extension) => filename.endsWith(extension));
  if (sanitizedLower.startsWith("media/")) {
    return `https://static.exercisedb.dev/${encodeURI(sanitized)}`;
  }
  if (!sanitized.includes("/") && hasKnownExtension) {
    return `https://static.exercisedb.dev/media/${encodeURI(sanitized)}`;
  }

  return trimmed;
}

export function buildMissionFallbackMediaDataUrl(value: string | null | undefined): string {
  const target = inferMissionVisualTarget(value);
  const { fill, accent } = iconColorByTarget(target);
  const label = capitalizeSentence(localizeMissionText(target) ?? target);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180" role="img" aria-label="Miss\u00e3o FitLoot">
      <rect width="240" height="180" rx="24" fill="${fill}" />
      <circle cx="120" cy="48" r="22" fill="${accent}" opacity="0.92" />
      <rect x="104" y="72" width="32" height="54" rx="16" fill="${accent}" opacity="0.92" />
      <rect x="68" y="76" width="28" height="16" rx="8" fill="${accent}" opacity="0.92" />
      <rect x="144" y="76" width="28" height="16" rx="8" fill="${accent}" opacity="0.92" />
      <rect x="94" y="124" width="16" height="40" rx="8" fill="${accent}" opacity="0.92" />
      <rect x="130" y="124" width="16" height="40" rx="8" fill="${accent}" opacity="0.92" />
      <text x="120" y="156" text-anchor="middle" font-size="16" font-family="Arial, sans-serif" fill="${accent}">
        ${label}
      </text>
    </svg>
  `.replace(/\s+/g, " ").trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
