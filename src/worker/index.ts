import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  OnboardingRequestSchema,
  CompleteMissionRequestSchema,
  FoodScanRequestSchema,
  UpdateDailyMetricsRequestSchema,
  MiniGameChallengeRequestSchema,
  MiniGameCompleteRequestSchema,
  AiChatRequestSchema,
  AiAnalyzeFoodRequestSchema,
  AuthRegisterRequestSchema,
  LoginRequestSchema,
  UserPlanRequestSchema,
  UpdateMeRequestSchema,
  ConditioningLevel,
  MissionMetricType,
  CircuitTask,
} from "../shared/types";
import {
  MISSION_LIMITS,
  classifyMission,
  formatMissionGoal,
  getMissionMetricType,
  metricUnitByType,
} from "../constants/missionMetrics";
import { assertString, safeGet } from "../utils/typeHelpers";
import { toStatusCode } from "./httpHelpers";
import { processDailyResetForAllUsers } from "./services/dailyReset";
import { enrichExercise } from "./services/exerciseEnrichment";

// Tipo do usuÃƒÂ¡rio autenticado
interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | undefined;
  onboarding_completed: number;
}

// Context type para Hono
type AppContext = {
  Bindings: Env;
  Variables: {
    user: AuthUser;
  };
};


let cachedSchemaState: { ready: boolean; checkedAt: number } | null = null;
let catalogInitCheckedAt = 0;
const SCHEMA_CACHE_TTL_MS = 10_000;
const CATALOG_CACHE_TTL_MS = 60_000;

async function hasCoreSchema(db: D1Database) {
  const now = Date.now();
  if (cachedSchemaState && now - cachedSchemaState.checkedAt < SCHEMA_CACHE_TTL_MS) {
    return cachedSchemaState.ready;
  }

  try {
    const result = await db.prepare(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name IN ('users', 'sessions')`
    ).first<{ count: number }>();

    const ready = Number(result?.count ?? 0) >= 2;
    cachedSchemaState = { ready, checkedAt: now };
    return ready;
  } catch (error) {
    console.error('[schema-check]', error);
    cachedSchemaState = { ready: false, checkedAt: now };
    return false;
  }
}

function databaseNotInitializedResponse(c: import("hono").Context<AppContext>) {
  return c.json(
    {
      error: 'Banco local nÃƒÂ£o inicializado. Execute as migrations D1 antes de usar a API.',
      code: 'DB_NOT_INITIALIZED',
    },
    503
  );
}

async function ensureCatalogReady(db: D1Database) {
  const now = Date.now();
  if (now - catalogInitCheckedAt < CATALOG_CACHE_TTL_MS) return;
  await ensureGamificationCatalog(db);
  catalogInitCheckedAt = now;
}

// Middleware de autenticaÃƒÂ§ÃƒÂ£o prÃƒÂ³prio
function parseCookieHeader(cookieHeader: string | undefined) {
  if (!cookieHeader) return new Map<string, string>();

  const pairs = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) return null;
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!key) return null;
      return [key, value] as const;
    })
    .filter((pair): pair is readonly [string, string] => pair !== null);

  return new Map<string, string>(pairs);
}

function getSessionIdFromCookieHeader(cookieHeader: string | undefined) {
  const sessionCookie = parseCookieHeader(cookieHeader).get("session_id");
  if (!sessionCookie) return null;

  try {
    return decodeURIComponent(sessionCookie);
  } catch {
    return sessionCookie;
  }
}

type UserAuthRecord = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  onboarding_completed: number;
};

function isMissingOnboardingCompletedColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("onboarding_completed") && message.includes("no such column");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isMissingSchemaError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

function schemaMismatchResponse(c: import("hono").Context<AppContext>) {
  return c.json(
    {
      error: "Banco local desatualizado para esta funcionalidade.",
      code: "DB_SCHEMA_MISMATCH",
    },
    503
  );
}

function internalErrorResponse(c: import("hono").Context<AppContext>) {
  return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
}

async function getUserAuthRecordById(db: D1Database, userId: string): Promise<UserAuthRecord | null> {
  try {
    const userRecord = await db
      .prepare("SELECT id, email, name, avatar_url, COALESCE(onboarding_completed, 0) as onboarding_completed FROM users WHERE id = ?")
      .bind(userId)
      .first<{ id: string; email: string; name: string; avatar_url: string | null; onboarding_completed: number }>();

    if (!userRecord) return null;

    return {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      avatar_url: userRecord.avatar_url,
      onboarding_completed: Number(userRecord.onboarding_completed) === 1 ? 1 : 0,
    };
  } catch (error) {
    if (!isMissingOnboardingCompletedColumnError(error)) {
      throw error;
    }

    const fallbackRecord = await db
      .prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?")
      .bind(userId)
      .first<{ id: string; email: string; name: string; avatar_url: string | null }>();

    if (!fallbackRecord) return null;

    return {
      id: fallbackRecord.id,
      email: fallbackRecord.email,
      name: fallbackRecord.name,
      avatar_url: fallbackRecord.avatar_url,
      onboarding_completed: 0,
    };
  }
}

async function authMiddleware(
  c: import("hono").Context<{ Bindings: Env; Variables: { user: AuthUser } }>,
  next: () => Promise<void>
) {
  const schemaReady = await hasCoreSchema(c.env.fitloot_db);
  if (!schemaReady) {
    return databaseNotInitializedResponse(c);
  }

  try {
    await ensureCatalogReady(c.env.fitloot_db);
  } catch (error) {
    console.error("[authMiddleware][ensureCatalogReady] Falha ao inicializar catÃƒÂ¡logo de gamificaÃƒÂ§ÃƒÂ£o", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));

    if (!sessionId) {
      return c.json({ error: "Unauthorized", code: "SESSION_COOKIE_MISSING" }, 401);
    }

    const session = await c.env.fitloot_db
      .prepare('SELECT id, user_id FROM sessions WHERE id = ? AND expires_at > datetime("now")')
      .bind(sessionId)
      .first<{ id: string; user_id: string }>();

    if (!session) {
      return c.json({ error: "Unauthorized", code: "SESSION_INVALID" }, 401);
    }

    const userRecord = await getUserAuthRecordById(c.env.fitloot_db, session.user_id);

    if (!userRecord) {
      return c.json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado", code: "USER_NOT_FOUND" }, 404);
    }

    (c as import("hono").Context<AppContext>).set("user", {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      avatar_url: userRecord.avatar_url ?? undefined,
      onboarding_completed: userRecord.onboarding_completed,
    });

    try {
      await ensureUserCounterRow(c.env.fitloot_db, userRecord.id);
    } catch (counterError) {
      console.error("[authMiddleware][ensureUserCounterRow]", {
        message: counterError instanceof Error ? counterError.message : String(counterError),
        userId: userRecord.id,
      });
    }

    try {
      await expirePendingMissionsAndUpdateStreak(c.env.fitloot_db, userRecord.id);
    } catch (streakError) {
      console.error("[authMiddleware][expirePendingMissionsAndUpdateStreak]", {
        message: streakError instanceof Error ? streakError.message : String(streakError),
        userId: userRecord.id,
      });
    }

    await next();
  } catch (error) {
    console.error("[authMiddleware]", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
  }
}

// ---------- ENV TYPES ----------
export interface Env {
  fitloot_db: D1Database;
  ASSETS: Fetcher;
  HF_TOKEN: string;
  USDA_API_KEY: string;
  RAPID_API_KEY?: string | undefined;
  RAPID_API_HOST?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  EXERCISE_DB_KEY?: string | undefined;
  API_NINJAS_KEY?: string | undefined;
  GYMFIT_API_KEY?: string | undefined;
  FRONTEND_ORIGIN?: string | undefined;
  FRONTEND_ORIGINS?: string | undefined;
}
// --------------------------------


const app = new Hono<AppContext>();

app.onError((error, c) => {
  console.error("[worker][unhandled]", {
    path: c.req.path,
    method: c.req.method,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return c.json({ error: "Erro interno", code: "INTERNAL_ERROR" }, 500);
});
type SkillSeed = {
  name: string;
  category: string;
  difficulty: string;
  tier: "iniciante" | "intermediario" | "avancado" | "calistenico";
  requiredLevel: number;
  description: string;
  unlockMessage: string;
  prerequisites?: string[] | undefined;
  attributeRequirements?: Record<string, number>;
};

type SkillStageSeed = {
  skillName: string;
  stageNumber: number;
  name: string;
  description: string;
  levelRequired: number;
  exerciseReference: string;
};

const localExercisePool: ExerciseRef[] = [
  { name: "Push-up", muscle: "chest", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Air Squat", muscle: "legs", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Plank", muscle: "core", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Glute Bridge", muscle: "glutes", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Burpee", muscle: "full body", equipment: "bodyweight", difficulty: "intermediate" },
  { name: "Pike Push-up", muscle: "shoulders", equipment: "bodyweight", difficulty: "intermediate" },
  { name: "Lunge", muscle: "legs", equipment: "bodyweight", difficulty: "beginner" },
  { name: "Superman Hold", muscle: "back", equipment: "bodyweight", difficulty: "beginner" },
];

const coreSkillSeeds: SkillSeed[] = [
  { name: "FlexÃƒÂ£o", category: "peito", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Empurrar horizontal com peso corporal", unlockMessage: "FlexÃƒÂ£o desbloqueada." },
  { name: "Agachamento", category: "pernas", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Base para forÃƒÂ§a de membros inferiores", unlockMessage: "Agachamento desbloqueado." },
  { name: "Abdominal", category: "core", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Fortalecimento de core", unlockMessage: "Abdominal desbloqueado." },
  { name: "Prancha", category: "core", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Isometria de core", unlockMessage: "Prancha desbloqueada." },
  { name: "Barra Fixa", category: "costas", difficulty: "intermediario", tier: "intermediario", requiredLevel: 5, description: "Puxada vertical", unlockMessage: "Barra fixa disponÃƒÂ­vel." },
  { name: "Dips", category: "triceps", difficulty: "intermediario", tier: "intermediario", requiredLevel: 7, description: "Empurrar em barras paralelas", unlockMessage: "Dips desbloqueado." },
  { name: "Handstand", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 6, description: "ProgressÃƒÂ£o de equilÃƒÂ­brio invertido", unlockMessage: "Inicie sua jornada no handstand.", prerequisites: ["Prancha"], attributeRequirements: { strength: 20, dexterity: 20 } },
  { name: "Front Lever", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 10, description: "Alavanca frontal", unlockMessage: "Front Lever desbloqueado.", prerequisites: ["Barra Fixa"], attributeRequirements: { strength: 30 } },
  { name: "Back Lever", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 10, description: "Alavanca posterior", unlockMessage: "Back Lever desbloqueado.", prerequisites: ["Barra Fixa"], attributeRequirements: { strength: 30 } },
  { name: "Planche", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 12, description: "SustentaÃƒÂ§ÃƒÂ£o horizontal", unlockMessage: "Planche desbloqueada.", prerequisites: ["Dips"], attributeRequirements: { strength: 38 } },
  { name: "Human Flag", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 14, description: "Bandeira humana", unlockMessage: "Human Flag desbloqueada.", attributeRequirements: { strength: 42, dexterity: 30 } },
  { name: "Muscle Up", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 11, description: "TransiÃƒÂ§ÃƒÂ£o de barra", unlockMessage: "Muscle Up desbloqueado.", prerequisites: ["Barra Fixa", "Dips"], attributeRequirements: { strength: 36 } },
  { name: "Pistol Squat", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 9, description: "Agachamento unilateral", unlockMessage: "Pistol Squat desbloqueado.", prerequisites: ["Agachamento"], attributeRequirements: { vitality: 28 } },
  { name: "Dragon Flag", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 13, description: "Core avanÃƒÂ§ado", unlockMessage: "Dragon Flag desbloqueada.", prerequisites: ["Abdominal"], attributeRequirements: { strength: 34, focus: 24 } },
  { name: "L-Sit", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 8, description: "SustentaÃƒÂ§ÃƒÂ£o em L", unlockMessage: "L-Sit desbloqueado.", prerequisites: ["Prancha"], attributeRequirements: { strength: 24, focus: 18 } },
  { name: "Crow Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 6, description: "EquilÃƒÂ­brio em braÃƒÂ§os", unlockMessage: "Crow Pose desbloqueada.", attributeRequirements: { focus: 18, dexterity: 18 } },
  { name: "Headstand", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 8, description: "Invertida na cabeÃƒÂ§a", unlockMessage: "Headstand desbloqueada.", attributeRequirements: { strength: 22, focus: 22 } },
  { name: "Wheel Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 9, description: "Ponte avanÃƒÂ§ada", unlockMessage: "Wheel Pose desbloqueada.", attributeRequirements: { vitality: 20 } },
  { name: "Firefly Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 11, description: "EquilÃƒÂ­brio avanÃƒÂ§ado", unlockMessage: "Firefly Pose desbloqueada.", attributeRequirements: { strength: 28, focus: 22 } },
  { name: "Eight Angle Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 12, description: "TorÃƒÂ§ÃƒÂ£o com braÃƒÂ§os", unlockMessage: "Eight Angle Pose desbloqueada.", attributeRequirements: { dexterity: 30, focus: 24 } },
  { name: "Scorpion Pose", category: "yoga", difficulty: "calistenia", tier: "calistenico", requiredLevel: 15, description: "Invertida avanÃƒÂ§ada", unlockMessage: "Scorpion Pose desbloqueada.", attributeRequirements: { strength: 35, dexterity: 32 } },
];

const stageProgressionSeed: SkillStageSeed[] = [
  ["Handstand", ["Quadruped Rocking", "Hollow Body", "Crow Pose", "Wall Walk", "How to Bail out of a Handstand", "Handstand completo"]],
  ["Front Lever", ["Scapula Pull", "Tuck Front Lever", "Advanced Tuck Lever", "One Leg Front Lever", "Straddle Front Lever", "Front Lever completo"]],
  ["Back Lever", ["Skin the Cat", "German Hang", "Tuck Back Lever", "Advanced Tuck Back Lever", "Straddle Back Lever", "Back Lever completo"]],
  ["Planche", ["Planche Lean", "Frog Stand", "Tuck Planche", "Advanced Tuck Planche", "Straddle Planche", "Planche completa"]],
  ["Human Flag", ["Side Plank", "Vertical Flag Hold", "Tuck Human Flag", "One Leg Flag", "Straddle Flag", "Human Flag completa"]],
  ["Muscle Up", ["Explosive Pull-up", "Chest to Bar", "Transition Drill", "Band Assisted Muscle Up", "Negative Muscle Up", "Muscle Up completo"]],
  ["Pistol Squat", ["Box Pistol", "Assisted Pistol", "Counterbalance Pistol", "Slow Eccentric Pistol", "Partial ROM Pistol", "Pistol Squat completo"]],
  ["Dragon Flag", ["Hollow Hold", "Reverse Crunch", "Dragon Flag Negativa", "Half Dragon Flag", "Strict Dragon Flag", "Dragon Flag completa"]],
  ["L-Sit", ["Seated Compression", "Tuck Sit", "One Leg L-Sit", "Alternating L-Sit", "V-Sit Prep", "L-Sit completo"]],
  ["Crow Pose", ["Core Engagement Basics", "Wrist Strengthening", "Squat Hold Balance", "Tripod Head Balance", "Crow Pose completo"]],
  ["Headstand", ["Neck and Shoulder Strengthening", "Dolphin Pose", "Supported Headstand (wall)", "Headstand Balance", "Freestanding Headstand"]],
  ["Wheel Pose", ["Bridge Prep", "Thoracic Mobility", "Wheel Assist", "Wheel Hold", "Wheel Pose completa"]],
  ["Firefly Pose", ["Hamstring Prep", "Arm Balance Prep", "Tuck Firefly", "Firefly Hold", "Firefly Pose completa"]],
  ["Eight Angle Pose", ["Twist Prep", "Leg Lock Drill", "Eight Angle Assisted", "Eight Angle Hold", "Eight Angle Pose completa"]],
  ["Scorpion Pose", ["Forearm Stand Prep", "Backbend Mobility", "Wall Scorpion", "Scorpion Balance", "Scorpion Pose completa"]],
]
  .flatMap(([skillName, stages], idxSkill) => (stages as string[]).map((name, idx) => ({
    skillName: String(skillName),
    stageNumber: idx + 1,
    name,
    description: `ProgressÃƒÂ£o ${idx + 1} de ${skillName}`,
    levelRequired: 4 + idx * 2 + idxSkill % 2,
    exerciseReference: name,
  })));

const titleSeeds = [
  { name: "Recruta", description: "Primeiros passos", reference: "RPG", unlock_condition: "level:1", rarity: "Comum" },
  { name: "Guerreiro do Core", description: "NÃƒÂ­vel 5", reference: "Calistenia", unlock_condition: "level:5", rarity: "Comum" },
  { name: "Veterano de Ferro", description: "NÃƒÂ­vel 10", reference: "MusculaÃƒÂ§ÃƒÂ£o", unlock_condition: "level:10", rarity: "Incomum" },
  { name: "LÃƒÂ¢mina Afiada", description: "NÃƒÂ­vel 15", reference: "AÃƒÂ§ÃƒÂ£o", unlock_condition: "level:15", rarity: "Raro" },
  { name: "Mestre do Peso Corporal", description: "NÃƒÂ­vel 20", reference: "Calistenia", unlock_condition: "level:20", rarity: "Raro" },
  { name: "O ÃƒÅ¡ltimo de NÃƒÂ³s", description: "NÃƒÂ­vel 30", reference: "TLOU", unlock_condition: "level:30", rarity: "MÃƒÂ­tico" },
  { name: "LendÃƒÂ¡rio", description: "NÃƒÂ­vel 50", reference: "RPG", unlock_condition: "level:50", rarity: "MÃƒÂ­tico" },
  { name: "O Equilibrista", description: "Handstand completo", reference: "Calistenia", unlock_condition: "skill:Handstand:6", rarity: "Raro" },
  { name: "Acima de Todos", description: "Muscle Up completo", reference: "Calistenia", unlock_condition: "skill:Muscle Up:6", rarity: "Raro" },
  { name: "ForÃƒÂ§a Gravitacional", description: "Planche completa", reference: "Calistenia", unlock_condition: "skill:Planche:6", rarity: "MÃƒÂ­tico" },
  { name: "Bandeira Humana", description: "Human Flag completa", reference: "Calistenia", unlock_condition: "skill:Human Flag:6", rarity: "MÃƒÂ­tico" },
  { name: "Suspenso no Tempo", description: "Front Lever completo", reference: "Calistenia", unlock_condition: "skill:Front Lever:6", rarity: "Raro" },
  { name: "Shoto Style", description: "ReferÃƒÂªncia Street Fighter", reference: "Street Fighter", unlock_condition: "missions:120", rarity: "Incomum" },
  { name: "Iron Fist", description: "ReferÃƒÂªncia Tekken", reference: "Tekken", unlock_condition: "strength:80", rarity: "Raro" },
  { name: "King of Iron Body", description: "ReferÃƒÂªncia jogos de luta", reference: "Fighting Games", unlock_condition: "level:35", rarity: "MÃƒÂ­tico" },
  { name: "300", description: "300 treinos completados", reference: "Filme 300", unlock_condition: "missions:300", rarity: "MÃƒÂ­tico" },
  { name: "Rocky", description: "30 dias de streak", reference: "Rocky", unlock_condition: "streak:30", rarity: "Raro" },
  { name: "Predador", description: "CaÃƒÂ§a semanal concluÃƒÂ­da", reference: "Predador", unlock_condition: "weekly:1", rarity: "Incomum" },
  { name: "Chosen Undead", description: "Falhou e insistiu", reference: "Dark Souls", unlock_condition: "failures:10", rarity: "Secreto" },
  { name: "The Witcher", description: "Contrato semanal", reference: "The Witcher", unlock_condition: "weekly:5", rarity: "Raro" },
  { name: "Demon Slayer", description: "5 habilidades desbloqueadas", reference: "Anime", unlock_condition: "skills:5", rarity: "Raro" },
  { name: "Hollow", description: "Perdeu sequÃƒÂªncia 3x", reference: "Hollow Knight", unlock_condition: "streak_loss:3", rarity: "Secreto" },
];

const achievementSeeds = [
  { name: "Primeiro Passo", description: "Completar a primeira missÃƒÂ£o", category: "missoes", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "missions_completed>=1", icon: "Ã°Å¸â€˜Â£", reference: "" },
  { name: "Aquecendo", description: "Completar 7 missÃƒÂµes", category: "missoes", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "missions_completed>=7", icon: "Ã°Å¸â€Â¥", reference: "" },
  { name: "Rotina Formada", description: "Completar 30 missÃƒÂµes", category: "missoes", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "missions_completed>=30", icon: "Ã°Å¸â€œâ€¦", reference: "" },
  { name: "Sem Desculpas", description: "5 dias seguidos", category: "missoes", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=5", icon: "Ã¢Å“â€¦", reference: "" },
  { name: "MÃƒÂ¡quina", description: "Completar 100 missÃƒÂµes", category: "missoes", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "missions_completed>=100", icon: "Ã¢Å¡â„¢Ã¯Â¸Â", reference: "" },
  { name: "ImparÃƒÂ¡vel", description: "30 dias consecutivos", category: "missoes", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=30", icon: "Ã°Å¸ÂÆ’", reference: "" },
  { name: "Lenda Viva", description: "365 missÃƒÂµes", category: "missoes", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "missions_completed>=365", icon: "Ã°Å¸â€˜â€˜", reference: "" },
  { name: "Primeira Conversa", description: "Primeira mensagem no FitBot", category: "chat", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "chat_messages>=1", icon: "Ã°Å¸â€™Â¬", reference: "" },
  { name: "Curioso", description: "50 perguntas ao FitBot", category: "chat", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "chat_messages>=50", icon: "Ã°Å¸Â¤â€", reference: "" },
  { name: "Aprendiz Dedicado", description: "200 interaÃƒÂ§ÃƒÂµes no chat", category: "chat", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "chat_messages>=200", icon: "Ã°Å¸Â§Â ", reference: "" },
  { name: "Eco", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "chat", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "repeat_message_streak>=5", icon: "Ã°Å¸Å’â‚¬", reference: "" },
  { name: "Na Disputa", description: "Entrar no top 100", category: "ranking", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "ranking<=100", icon: "Ã°Å¸Â¥â€°", reference: "" },
  { name: "Elite", description: "Entrar no top 10", category: "ranking", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "ranking<=10", icon: "Ã°Å¸Â¥Ë†", reference: "" },
  { name: "O Escolhido", description: "AlcanÃƒÂ§ar #1", category: "ranking", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "ranking==1", icon: "Ã°Å¸Â¥â€¡", reference: "" },
  { name: "Ghost", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "ranking", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "top10_no_friends", icon: "Ã°Å¸â€˜Â¤", reference: "" },
  { name: "Primeiros Voos", description: "Primeira etapa do Handstand", category: "habilidades", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "skill_stage:Handstand>=1", icon: "Ã°Å¸â€¢Å Ã¯Â¸Â", reference: "" },
  { name: "Mestre do EquilÃƒÂ­brio", description: "Handstand completo", category: "habilidades", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "skill_stage:Handstand>=6", icon: "Ã°Å¸Â¤Â¸", reference: "" },
  { name: "Kalista", description: "Todas as skills calistÃƒÂªnicas", category: "habilidades", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "all_calisthenics", icon: "Ã¢Å¡â€Ã¯Â¸Â", reference: "" },
  { name: "Jogador", description: "Primeiro minigame", category: "minigames", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "minigames_played>=1", icon: "Ã°Å¸Å½Â®", reference: "" },
  { name: "Competidor", description: "Vencer 10 minigames", category: "minigames", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "minigames_won>=10", icon: "Ã°Å¸Ââ€¦", reference: "" },
  { name: "ImbatÃƒÂ­vel", description: "50 vitÃƒÂ³rias seguidas", category: "minigames", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "minigame_win_streak>=50", icon: "Ã°Å¸â€Â¥", reference: "" },
  { name: "Mestre ArtesÃƒÂ£o", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "craft_master", icon: "Ã°Å¸â€ºÂ Ã¯Â¸Â", reference: "Hollow Knight" },
  { name: "InsÃƒÂ´nia", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "mission_2am_4am", icon: "Ã°Å¸Å’â„¢", reference: "" },
  { name: "Fantasma", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "open_gap6_complete_day7", icon: "Ã°Å¸â€˜Â»", reference: "" },
  { name: "Conversa de Louco", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "chat_session_100", icon: "Ã°Å¸Â¤Â¯", reference: "" },
  { name: "Glitch", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "report_bug_chat", icon: "Ã°Å¸ÂÅ¾", reference: "" },
  { name: "Aquecendo o Motor", description: "3 dias seguidos", category: "streak", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "streak>=3", icon: "Ã°Å¸â€Â¥", reference: "" },
  { name: "Semana Completa", description: "7 dias seguidos", category: "streak", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "streak>=7", icon: "Ã°Å¸â€œâ€ ", reference: "" },
  { name: "Ritmo Certo", description: "14 dias seguidos", category: "streak", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=14", icon: "Ã°Å¸Å¸Â¢", reference: "" },
  { name: "Sem Parar", description: "21 dias seguidos", category: "streak", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=21", icon: "Ã°Å¸ÂÆ’", reference: "" },
  { name: "MÃƒÂªs de Ferro", description: "30 dias seguidos", category: "streak", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=30", icon: "Ã°Å¸â€™Âª", reference: "" },
  { name: "Disciplina Absurda", description: "60 dias seguidos", category: "streak", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=60", icon: "Ã°Å¸Â§Â±", reference: "" },
  { name: "InabalÃƒÂ¡vel", description: "100 dias seguidos", category: "streak", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "streak>=100", icon: "Ã°Å¸â€ºÂ¡Ã¯Â¸Â", reference: "" },
  { name: "Um Ano de Dor", description: "365 dias seguidos", category: "streak", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "streak>=365", icon: "Ã°Å¸â€œâ€º", reference: "" },
  { name: "Acontece", description: "Quebrar streak pela primeira vez", category: "streak_break", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "streak_break>=1", icon: "Ã°Å¸â€™Â¥", reference: "" },
  { name: "Voltar ÃƒÂ© DifÃƒÂ­cil", description: "Quebrar streak de 30+", category: "streak_break", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak_break>=30", icon: "Ã¢â€ Â©Ã¯Â¸Â", reference: "" },
  { name: "Tudo Ruiu", description: "Quebrar streak de 100+", category: "streak_break", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak_break>=100", icon: "Ã°Å¸Å’ÂªÃ¯Â¸Â", reference: "" },
  { name: "A Queda Ãƒâ€°pica", description: "Quebrar streak de 365+", category: "streak_break", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "streak_break>=365", icon: "Ã°Å¸â€¢Â³Ã¯Â¸Â", reference: "" },
  { name: "Tudo pela Streak", description: "Manter streak com 1 missÃƒÂ£o em 7 dias", category: "streak_minimal", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "minimal_streak>=7", icon: "1Ã¯Â¸ÂÃ¢Æ’Â£", reference: "" },
  { name: "O Minimalista", description: "Manter streak com 1 missÃƒÂ£o em 30 dias", category: "streak_minimal", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "minimal_streak>=30", icon: "Ã°Å¸Â§Â©", reference: "" },
  { name: "Engenharia de Streak", description: "Manter streak com 1 missÃƒÂ£o em 100 dias", category: "streak_minimal", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "minimal_streak>=100", icon: "Ã¢Å¡â„¢Ã¯Â¸Â", reference: "" },
  { name: "A Arte da PreguiÃƒÂ§a", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "streak_minimal", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "single_mission_30", icon: "Ã°Å¸ËœÂ´", reference: "" },
  { name: "De Volta ao Jogo", description: "Reconstruir para 7 dias", category: "streak_rebuild", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "rebuild>=7", icon: "Ã°Å¸â€Â", reference: "" },
  { name: "FÃƒÂªnix", description: "Quebrar 30+ e reconstruir 30+", category: "streak_rebuild", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "rebuild_from30", icon: "Ã°Å¸Â¦â€¦", reference: "" },
  { name: "Lenda Resiliente", description: "Quebrar 100+ e reconstruir 100+", category: "streak_rebuild", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "rebuild_from100", icon: "Ã°Å¸Â§Â¬", reference: "" },
  { name: "Por um Fio", description: "ÃƒÅ¡ltimos 5 minutos 5x", category: "timing", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "timing_last5m>=5", icon: "Ã¢ÂÂ³", reference: "" },
  { name: "Especialista em Timing", description: "ÃƒÅ¡ltimos 5 minutos 20x", category: "timing", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "timing_last5m>=20", icon: "Ã°Å¸Å½Â¯", reference: "" },
  { name: "MissÃƒÂ£o ÃƒÂ s 23:59", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "timing", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "timing_2355_streak>=7", icon: "Ã°Å¸â€¢â€º", reference: "" },
  { name: "404 Not Found", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "route_not_found", icon: "Ã¢Ââ€œ", reference: "" },
  { name: "Hoje NÃƒÂ£o", description: "Falhar 1 missÃƒÂ£o da meta", category: "meta_fail", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_fail>=1", icon: "Ã°Å¸â„¢Æ’", reference: "" },
  { name: "AmanhÃƒÂ£ Eu ComeÃƒÂ§o", description: "Falhar 3 missÃƒÂµes da meta em dias diferentes", category: "meta_fail", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_fail_days>=3", icon: "Ã°Å¸â€œâ€ ", reference: "" },
  { name: "Meta? Que Meta?", description: "Falhar 5 missÃƒÂµes da meta", category: "meta_fail", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_fail>=5", icon: "Ã°Å¸Å½Â¯", reference: "" },
  { name: "Plano de Mentira", description: "Falhar 15 missÃƒÂµes da meta", category: "meta_fail", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_fail>=15", icon: "Ã°Å¸Â§Â¾", reference: "" },
  { name: "Autobiotagem", description: "Falhar 30 missÃƒÂµes da meta", category: "meta_fail", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_fail>=30", icon: "Ã°Å¸Â§Â¨", reference: "" },
  { name: "Speedrun do Fracasso", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_fail", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "goal_fail_7d", icon: "Ã°Å¸ÂÂ´", reference: "" },
  { name: "No Caminho Certo", description: "7 missÃƒÂµes da meta concluÃƒÂ­das", category: "meta_done", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "goal_done>=7", icon: "Ã¢Å¾Â¡Ã¯Â¸Â", reference: "" },
  { name: "Focado", description: "30 missÃƒÂµes da meta concluÃƒÂ­das", category: "meta_done", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_done>=30", icon: "Ã°Å¸Å½Â¯", reference: "" },
  { name: "Sem Desvios", description: "7 dias sem falhar missÃƒÂ£o da meta", category: "meta_done", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_nofail>=7", icon: "Ã°Å¸Â§Â­", reference: "" },
  { name: "Comprometido", description: "100 missÃƒÂµes da meta concluÃƒÂ­das", category: "meta_done", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_done>=100", icon: "Ã°Å¸â€œÅ’", reference: "" },
  { name: "Olho no Alvo", description: "30 dias sem falhar missÃƒÂ£o da meta", category: "meta_done", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_nofail>=30", icon: "Ã°Å¸â€˜ÂÃ¯Â¸Â", reference: "" },
  { name: "ObsessÃƒÂ£o SaudÃƒÂ¡vel", description: "365 missÃƒÂµes da meta", category: "meta_done", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_done>=365", icon: "Ã°Å¸Â§Â ", reference: "" },
  { name: "InabalÃƒÂ¡vel no PropÃƒÂ³sito", description: "100 dias sem falhar missÃƒÂ£o da meta", category: "meta_done", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_nofail>=100", icon: "Ã°Å¸â€ºÂ¡Ã¯Â¸Â", reference: "" },
  { name: "A Meta era Essa?", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_change", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "goal_return_30", icon: "Ã°Å¸â€â€ž", reference: "" },
  { name: "Primeiro Resultado", description: "10% da meta", category: "meta_progress", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "goal_progress>=10", icon: "Ã°Å¸â€Å¸", reference: "" },
  { name: "Meio Caminho", description: "50% da meta", category: "meta_progress", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_progress>=50", icon: "5Ã¯Â¸ÂÃ¢Æ’Â£0Ã¯Â¸ÂÃ¢Æ’Â£", reference: "" },
  { name: "Quase LÃƒÂ¡", description: "90% da meta", category: "meta_progress", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_progress>=90", icon: "9Ã¯Â¸ÂÃ¢Æ’Â£0Ã¯Â¸ÂÃ¢Æ’Â£", reference: "" },
  { name: "Meta Batida", description: "100% da meta", category: "meta_progress", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_progress>=100", icon: "Ã°Å¸â€™Â¯", reference: "" },
  { name: "AlÃƒÂ©m da Meta", description: "120% da meta", category: "meta_progress", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "goal_progress>=120", icon: "Ã°Å¸Å¡â‚¬", reference: "" },
  { name: "Overachiever", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_progress", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "goal_half_time", icon: "Ã¢Å¡Â¡", reference: "" },
  { name: "Novo CapÃƒÂ­tulo", description: "Primeira troca de meta", category: "meta_change", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "goal_change>=1", icon: "Ã°Å¸â€œâ€“", reference: "" },
  { name: "Indefinido", description: "3 trocas de meta", category: "meta_change", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "goal_change>=3", icon: "Ã°Å¸Â§Â­", reference: "" },
  { name: "A Jornada ÃƒÂ© o Destino", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_change", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "all_goals_done", icon: "Ã°Å¸â€”ÂºÃ¯Â¸Â", reference: "" },
  { name: "Dupla AmeaÃƒÂ§a", description: "Streak 30 + meta perfeita", category: "meta_combo", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "combo30", icon: "Ã¢Å¡â€Ã¯Â¸Â", reference: "" },
  { name: "MÃƒÂ¡quina de Resultados", description: "Streak 100 + meta perfeita", category: "meta_combo", rarity: "MÃƒÂ­tico", color: "#EF4444", secret: 0, condition: "combo100", icon: "Ã°Å¸ÂÂ­", reference: "" },
  { name: "PerfeiÃƒÂ§ÃƒÂ£o", description: "CondiÃƒÂ§ÃƒÂ£o secreta", category: "meta_combo", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "combo30_all", icon: "Ã¢Å“Â¨", reference: "" },
];

function conditioningOrder(level: ConditioningLevel): number {
  return { sedentario: 0, iniciante: 1, intermediario: 2, avancado: 3 }[level] ?? 0;
}

function skillTierOrder(tier: string): number {
  return { iniciante: 1, intermediario: 2, avancado: 3, calistenico: 4 }[tier as keyof Record<string, number>] ?? 1;
}

async function ensureGamificationCatalog(db: D1Database) {
  for (const skill of coreSkillSeeds) {
    await db.prepare(`INSERT INTO skills (name, category, difficulty, description, calories_per_rep, strength_gain, constitution_gain, vitality_gain, dexterity_gain, focus_gain, required_level, tier, level_required, prerequisites, attribute_requirements, unlock_message, updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM skills WHERE name = ?)`)
      .bind(skill.name, skill.category, skill.difficulty, skill.description, 0.5, 1, 1, 1, 1, 1, skill.requiredLevel, skill.tier, skill.requiredLevel, JSON.stringify(skill.prerequisites ?? []), JSON.stringify(skill.attributeRequirements ?? {}), skill.unlockMessage, skill.name)
      .run();
  }

  for (const stage of stageProgressionSeed) {
    const skill = await db.prepare("SELECT id FROM skills WHERE name = ?").bind(stage.skillName).first<{ id: number }>();
    if (!skill?.id) continue;
    await db.prepare(`INSERT INTO skill_stages (skill_id, stage_number, name, description, level_required, exercise_reference, updated_at)
      SELECT ?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM skill_stages WHERE skill_id = ? AND stage_number = ?)`)
      .bind(skill.id, stage.stageNumber, stage.name, stage.description, stage.levelRequired, stage.exerciseReference, skill.id, stage.stageNumber)
      .run();
  }

  for (const achievement of achievementSeeds) {
    await db.prepare(`INSERT INTO achievements (name, description, rarity, icon, requirement_type, requirement_value, category, color, secret, condition, reference, updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM achievements WHERE name = ?)`)
      .bind(achievement.name, achievement.description, achievement.rarity, achievement.icon, "event", 1, achievement.category, achievement.color, achievement.secret, achievement.condition, achievement.reference, achievement.name)
      .run();
  }

  for (const title of titleSeeds) {
    await db.prepare(`INSERT INTO titles (name, rarity, requirement_type, requirement_value, description, reference, unlock_condition, updated_at)
      SELECT ?,?,?,?,?,?,?, datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM titles WHERE name = ?)`)
      .bind(title.name, title.rarity, "event", 1, title.description, title.reference, title.unlock_condition, title.name)
      .run();
  }
}

async function ensureUserCounterRow(db: D1Database, userId: string) {
  await db.prepare(`INSERT OR IGNORE INTO user_event_counters (user_id, updated_at) VALUES (?, datetime('now'))`).bind(userId).run();
}

async function expirePendingMissionsAndUpdateStreak(db: D1Database, userId: string) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

  let expired: { results: Array<{ id: number }> } = { results: [] };
  try {
    expired = await db.prepare(
      `SELECT id FROM missions WHERE user_id = ? AND is_completed = 0 AND COALESCE(status,'pending') = 'pending' AND deadline IS NOT NULL AND date(deadline) < date('now')`
    ).bind(userId).all<{ id: number }>();
  } catch {
    // status column may not exist before latest migration
    return;
  }

  for (const mission of expired.results) {
    await db.prepare("UPDATE missions SET status = 'failed', updated_at = datetime('now') WHERE id = ?").bind(mission.id).run();
    await onMissionFailed(db, userId, mission.id);
  }

  const progression = await db.prepare("SELECT current_streak, best_streak, last_activity_date FROM user_progression WHERE user_id = ?").bind(userId).first<{ current_streak: number; best_streak: number; last_activity_date: string | null }>();

  const completedToday = await db.prepare(
    `SELECT COUNT(*) as c FROM missions WHERE user_id = ? AND is_completed = 1 AND date(completed_at) = ?`
  ).bind(userId, today).first<{ c: number }>();

  const completedYesterday = await db.prepare(
    `SELECT COUNT(*) as c, MAX(completed_at) as last_time FROM missions WHERE user_id = ? AND is_completed = 1 AND date(completed_at) = ?`
  ).bind(userId, yesterday).first<{ c: number; last_time: string | null }>();

  const currentStreak = Number(progression?.current_streak ?? 0);
  const lastActivity = progression?.last_activity_date;

  if (lastActivity && lastActivity < yesterday && currentStreak > 0) {
    await onStreakBroken(db, userId, currentStreak);
    await db.prepare("UPDATE user_progression SET current_streak = 0, updated_at = datetime('now') WHERE user_id = ?").bind(userId).run();
  }

  if (Number(completedYesterday?.c ?? 0) > 0 && lastActivity !== yesterday) {
    const previousBest = Number(progression?.best_streak ?? 0);
    const rebuilt = currentStreak + 1;
    await db.prepare(`UPDATE user_progression SET current_streak = ?, best_streak = MAX(COALESCE(best_streak,0), ?), last_activity_date = ?, updated_at = datetime('now') WHERE user_id = ?`)
      .bind(rebuilt, rebuilt, yesterday, userId).run();
    await onStreakContinued(db, userId, rebuilt, Number(completedYesterday?.c ?? 0), completedYesterday?.last_time ?? undefined);
    await onStreakRebuilt(db, userId, rebuilt, previousBest);
  }

  if (Number(completedToday?.c ?? 0) > 0) {
    const refreshed = await db.prepare("SELECT current_streak FROM user_progression WHERE user_id = ?").bind(userId).first<{ current_streak: number }>();
    await onStreakContinued(db, userId, Number(refreshed?.current_streak ?? 0), Number(completedToday?.c ?? 0));
  }
}

async function logUserEvent(db: D1Database, userId: string, eventType: string, payload: Record<string, unknown>) {
  await db.prepare(`INSERT INTO user_event_log (user_id, event_type, payload_json) VALUES (?, ?, ?)`)
    .bind(userId, eventType, JSON.stringify(payload)).run();
}

async function unlockTitleIfNeeded(db: D1Database, userId: string, titleName: string) {
  const title = await db.prepare("SELECT id FROM titles WHERE name = ?").bind(titleName).first<{ id: number }>();
  if (!title?.id) return;
  await db.prepare(`INSERT OR IGNORE INTO user_titles (user_id, title_id, unlocked_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`)
    .bind(userId, title.id).run();
}

async function unlockAchievementIfNeeded(db: D1Database, userId: string, achievementName: string, progressCurrent = 1, progressRequired = 1) {
  const achievement = await db.prepare("SELECT id FROM achievements WHERE name = ?").bind(achievementName).first<{ id: number }>();
  if (!achievement?.id) return;
  await db.prepare(`INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at, progress_current, progress_required, updated_at)
    VALUES (?, ?, datetime('now'), ?, ?, datetime('now'))`)
    .bind(userId, achievement.id, progressCurrent, progressRequired).run();
}

async function evaluateMissionAchievementsAndTitles(db: D1Database, userId: string) {
  const counters = await db.prepare("SELECT * FROM user_event_counters WHERE user_id = ?").bind(userId).first<Record<string, unknown>>();
  const missionsCompleted = Number(counters?.missions_completed ?? 0);
  const consecutiveDays = Number(counters?.consecutive_days_completed ?? 0);

  if (missionsCompleted >= 1) await unlockAchievementIfNeeded(db, userId, "Primeiro Passo", missionsCompleted, 1);
  if (missionsCompleted >= 7) await unlockAchievementIfNeeded(db, userId, "Aquecendo", missionsCompleted, 7);
  if (missionsCompleted >= 30) await unlockAchievementIfNeeded(db, userId, "Rotina Formada", missionsCompleted, 30);
  if (missionsCompleted >= 100) await unlockAchievementIfNeeded(db, userId, "MÃƒÂ¡quina", missionsCompleted, 100);
  if (missionsCompleted >= 365) await unlockAchievementIfNeeded(db, userId, "Lenda Viva", missionsCompleted, 365);
  if (consecutiveDays >= 5) await unlockAchievementIfNeeded(db, userId, "Sem Desculpas", consecutiveDays, 5);
  if (consecutiveDays >= 30) {
    await unlockAchievementIfNeeded(db, userId, "ImparÃƒÂ¡vel", consecutiveDays, 30);
    await unlockTitleIfNeeded(db, userId, "Rocky");
  }
  if (missionsCompleted >= 300) await unlockTitleIfNeeded(db, userId, "300");
  if (missionsCompleted >= 120) await unlockTitleIfNeeded(db, userId, "Shoto Style");
}

async function evaluateChatAchievements(db: D1Database, userId: string) {
  const counters = await db.prepare("SELECT chat_messages, repeated_message_streak FROM user_event_counters WHERE user_id = ?")
    .bind(userId).first<{ chat_messages: number; repeated_message_streak: number }>();
  const total = Number(counters?.chat_messages ?? 0);
  const repeat = Number(counters?.repeated_message_streak ?? 0);

  if (total >= 1) await unlockAchievementIfNeeded(db, userId, "Primeira Conversa", total, 1);
  if (total >= 50) await unlockAchievementIfNeeded(db, userId, "Curioso", total, 50);
  if (total >= 200) await unlockAchievementIfNeeded(db, userId, "Aprendiz Dedicado", total, 200);
  if (repeat >= 5) await unlockAchievementIfNeeded(db, userId, "Eco", repeat, 5);
}

async function evaluateLevelTitles(db: D1Database, userId: string, level: number) {
  const byLevel: Array<[number, string]> = [
    [1, "Recruta"], [5, "Guerreiro do Core"], [10, "Veterano de Ferro"], [15, "LÃƒÂ¢mina Afiada"],
    [20, "Mestre do Peso Corporal"], [30, "O ÃƒÅ¡ltimo de NÃƒÂ³s"], [50, "LendÃƒÂ¡rio"],
  ];
  for (const [threshold, name] of byLevel) {
    if (level >= threshold) await unlockTitleIfNeeded(db, userId, name);
  }
}

async function onStreakContinued(db: D1Database, userId: string, streakDays: number, missionsCompletedToday: number, lastMissionDate?: string | undefined) {
  await logUserEvent(db, userId, "onStreakContinued", { streakDays, missionsCompletedToday });

  const milestones: Array<[number, string]> = [
    [3, "Aquecendo o Motor"], [7, "Semana Completa"], [14, "Ritmo Certo"], [21, "Sem Parar"],
    [30, "MÃƒÂªs de Ferro"], [60, "Disciplina Absurda"], [100, "InabalÃƒÂ¡vel"], [365, "Um Ano de Dor"],
  ];
  for (const [value, name] of milestones) {
    if (streakDays >= value) await unlockAchievementIfNeeded(db, userId, name, streakDays, value);
  }

  if (missionsCompletedToday === 1) {
    await db.prepare(`UPDATE user_event_counters
      SET minimal_streak_days = COALESCE(minimal_streak_days,0)+1,
          single_mission_days_streak = COALESCE(single_mission_days_streak,0)+1,
          updated_at = datetime('now')
      WHERE user_id = ?`).bind(userId).run();
  } else if (missionsCompletedToday > 1) {
    await db.prepare(`UPDATE user_event_counters
      SET single_mission_days_streak = 0,
          updated_at = datetime('now')
      WHERE user_id = ?`).bind(userId).run();
  }

  const counters = await db.prepare(`SELECT minimal_streak_days, single_mission_days_streak, timing_last5m_count, timing_2355_streak FROM user_event_counters WHERE user_id = ?`)
    .bind(userId).first<{ minimal_streak_days: number; single_mission_days_streak: number; timing_last5m_count: number; timing_2355_streak: number }>();
  const minimal = Number(counters?.minimal_streak_days ?? 0);
  const singleStreak = Number(counters?.single_mission_days_streak ?? 0);
  if (minimal >= 7) await unlockAchievementIfNeeded(db, userId, "Tudo pela Streak", minimal, 7);
  if (minimal >= 30) await unlockAchievementIfNeeded(db, userId, "O Minimalista", minimal, 30);
  if (minimal >= 100) await unlockAchievementIfNeeded(db, userId, "Engenharia de Streak", minimal, 100);
  if (singleStreak >= 30) await unlockAchievementIfNeeded(db, userId, "A Arte da PreguiÃƒÂ§a", singleStreak, 30);

  if (lastMissionDate) {
    const d = new Date(lastMissionDate);
    const h = d.getHours();
    const m = d.getMinutes();
    if (h === 23 && m >= 55) {
      await db.prepare(`UPDATE user_event_counters SET timing_last5m_count = COALESCE(timing_last5m_count,0)+1, timing_2355_streak = COALESCE(timing_2355_streak,0)+1, updated_at=datetime('now') WHERE user_id = ?`)
        .bind(userId).run();
      const t = await db.prepare(`SELECT timing_last5m_count, timing_2355_streak FROM user_event_counters WHERE user_id = ?`).bind(userId).first<{ timing_last5m_count: number; timing_2355_streak: number }>();
      if (Number(t?.timing_last5m_count ?? 0) >= 5) await unlockAchievementIfNeeded(db, userId, "Por um Fio", Number(t?.timing_last5m_count ?? 0), 5);
      if (Number(t?.timing_last5m_count ?? 0) >= 20) await unlockAchievementIfNeeded(db, userId, "Especialista em Timing", Number(t?.timing_last5m_count ?? 0), 20);
      if (Number(t?.timing_2355_streak ?? 0) >= 7) await unlockAchievementIfNeeded(db, userId, "MissÃƒÂ£o ÃƒÂ s 23:59", Number(t?.timing_2355_streak ?? 0), 7);
    } else {
      await db.prepare(`UPDATE user_event_counters SET timing_2355_streak = 0, updated_at=datetime('now') WHERE user_id = ?`).bind(userId).run();
    }
  }
}

async function onStreakBroken(db: D1Database, userId: string, streakDaysBefore: number) {
  await logUserEvent(db, userId, "onStreakBroken", { streakDaysBefore });
  await db.prepare(`UPDATE user_event_counters
    SET streak_loss_count = COALESCE(streak_loss_count,0)+1,
        last_streak_break_size = ?,
        single_mission_days_streak = 0,
        updated_at = datetime('now')
    WHERE user_id = ?`).bind(streakDaysBefore, userId).run();

  if (streakDaysBefore >= 1) await unlockAchievementIfNeeded(db, userId, "Acontece", streakDaysBefore, 1);
  if (streakDaysBefore >= 30) await unlockAchievementIfNeeded(db, userId, "Voltar ÃƒÂ© DifÃƒÂ­cil", streakDaysBefore, 30);
  if (streakDaysBefore >= 100) await unlockAchievementIfNeeded(db, userId, "Tudo Ruiu", streakDaysBefore, 100);
  if (streakDaysBefore >= 365) await unlockAchievementIfNeeded(db, userId, "A Queda Ãƒâ€°pica", streakDaysBefore, 365);
}

async function onStreakRebuilt(db: D1Database, userId: string, newStreakDays: number, previousBestStreak: number) {
  await logUserEvent(db, userId, "onStreakRebuilt", { newStreakDays, previousBestStreak });
  if (newStreakDays >= 7) await unlockAchievementIfNeeded(db, userId, "De Volta ao Jogo", newStreakDays, 7);
  if (previousBestStreak >= 30 && newStreakDays >= 30) await unlockAchievementIfNeeded(db, userId, "FÃƒÂªnix", newStreakDays, 30);
  if (previousBestStreak >= 100 && newStreakDays >= 100) await unlockAchievementIfNeeded(db, userId, "Lenda Resiliente", newStreakDays, 100);
}

async function onMissionFailed(db: D1Database, userId: string, missionId: number) {
  await logUserEvent(db, userId, "onMissionFailed", { missionId });
  await db.prepare(`UPDATE user_event_counters SET missions_failed = COALESCE(missions_failed,0)+1, updated_at=datetime('now') WHERE user_id = ?`).bind(userId).run();
  await checkMissionRelevance(userId, missionId, db, 'failed');
}

type GoalMissionRelevance = {
  isGoalRelevant: boolean;
  missionGroup: string;
  missionType: string;
  userGoal: string;
};

async function ensureGoalStatsRow(db: D1Database, userId: string, goal: string | null) {
  await db.prepare(`INSERT OR IGNORE INTO user_goal_stats (user_id, original_goal, current_goal, updated_at) VALUES (?, ?, ?, datetime('now'))`)
    .bind(userId, goal ?? 'saude_geral', goal ?? 'saude_geral').run();
}

async function getMissionContext(db: D1Database, missionId: number) {
  return db.prepare(
    `SELECT m.id, m.type, m.title, m.description, s.category as skill_category
      FROM missions m
      LEFT JOIN skills s ON s.id = m.skill_id
      WHERE m.id = ?`
  ).bind(missionId).first<{ id: number; type: string; title: string; description: string | null; skill_category: string | null }>();
}

function isMissionRelevantToGoal(missionGroup: string, missionType: string, userGoal: string) {
  const group = missionGroup.toLowerCase();
  if (userGoal === 'ganhar_massa') return ['peito','costas','pernas','ombro','triceps','biceps'].some((g) => group.includes(g)) || missionType !== 'daily';
  if (userGoal === 'perder_peso') return ['full','core','cardio','mobilidade'].some((g) => group.includes(g)) || missionType === 'daily';
  if (userGoal === 'resistencia') return ['core','pernas','cardio'].some((g) => group.includes(g)) || missionType !== 'monthly';
  if (userGoal === 'calistenia') return ['calistenia','core','yoga'].some((g) => group.includes(g));
  return true;
}

async function checkMissionRelevance(userId: string, missionId: number, db: D1Database, mode: 'failed' | 'completed'): Promise<GoalMissionRelevance> {
  const [mission, profile] = await Promise.all([
    getMissionContext(db, missionId),
    db.prepare("SELECT main_goal FROM user_profiles WHERE user_id = ?").bind(userId).first<{ main_goal: string | null }>(),
  ]);

  const userGoal = profile?.main_goal ?? 'saude_geral';
  await ensureGoalStatsRow(db, userId, userGoal);

  const missionGroup = String(mission?.skill_category ?? mission?.title ?? mission?.description ?? 'geral');
  const missionType = String(mission?.type ?? 'daily');
  const isGoalRelevant = isMissionRelevantToGoal(missionGroup, missionType, userGoal);

  if (!isGoalRelevant) return { isGoalRelevant, missionGroup, missionType, userGoal };

  const today = new Date().toISOString().split('T')[0];
  const stats = await db.prepare("SELECT * FROM user_goal_stats WHERE user_id = ?").bind(userId).first<Record<string, unknown>>();

  if (mode === 'failed') {
    const sameDay = String(stats?.goal_fail_last_day ?? '') === today;
    const failCount = Number(stats?.goal_fail_count ?? 0) + 1;
    const distinctDays = Number(stats?.goal_fail_distinct_days ?? 0) + (sameDay ? 0 : 1);
    const consecutiveFailDays = sameDay ? Number(stats?.goal_fail_consecutive_days ?? 0) : Number(stats?.goal_fail_consecutive_days ?? 0) + 1;
    await db.prepare(`UPDATE user_goal_stats SET goal_fail_count = ?, goal_fail_distinct_days = ?, goal_fail_last_day = ?, goal_fail_consecutive_days = ?, updated_at = datetime('now') WHERE user_id = ?`)
      .bind(failCount, distinctDays, today, consecutiveFailDays, userId).run();
    await onGoalMissionFailed(db, userId, failCount, distinctDays, consecutiveFailDays);
  } else {
    const sameDay = String(stats?.goal_completed_last_day ?? '') === today;
    const completedCount = Number(stats?.goal_completed_count ?? 0) + 1;
    const completedConsecutive = sameDay ? Number(stats?.goal_completed_consecutive_days ?? 0) : Number(stats?.goal_completed_consecutive_days ?? 0) + 1;
    const noFailStreak = sameDay ? Number(stats?.goal_no_fail_streak_days ?? 0) : Number(stats?.goal_no_fail_streak_days ?? 0) + 1;
    await db.prepare(`UPDATE user_goal_stats SET goal_completed_count = ?, goal_completed_last_day = ?, goal_completed_consecutive_days = ?, goal_no_fail_streak_days = ?,
      missions_after_return = CASE WHEN returned_to_original_count > 0 AND current_goal = original_goal THEN COALESCE(missions_after_return,0) + 1 ELSE missions_after_return END,
      updated_at = datetime('now') WHERE user_id = ?`)
      .bind(completedCount, today, completedConsecutive, noFailStreak, userId).run();
    const returnedStats = await db.prepare("SELECT missions_after_return, returned_to_original_count FROM user_goal_stats WHERE user_id = ?").bind(userId).first<{ missions_after_return: number; returned_to_original_count: number }>();
    if (Number(returnedStats?.returned_to_original_count ?? 0) > 0 && Number(returnedStats?.missions_after_return ?? 0) >= 30) {
      await unlockAchievementIfNeeded(db, userId, 'A Meta era Essa?', Number(returnedStats?.missions_after_return ?? 0), 30);
    }
    await onGoalMissionCompleted(db, userId, completedCount, completedConsecutive, noFailStreak);
  }

  return { isGoalRelevant, missionGroup, missionType, userGoal };
}

async function onGoalMissionFailed(db: D1Database, userId: string, failCount: number, distinctDays: number, consecutiveFailDays: number) {
  await logUserEvent(db, userId, 'onGoalMissionFailed', { failCount, distinctDays, consecutiveFailDays });
  if (failCount >= 1) await unlockAchievementIfNeeded(db, userId, 'Hoje NÃƒÂ£o', failCount, 1);
  if (distinctDays >= 3) await unlockAchievementIfNeeded(db, userId, 'AmanhÃƒÂ£ Eu ComeÃƒÂ§o', distinctDays, 3);
  if (failCount >= 5) await unlockAchievementIfNeeded(db, userId, 'Meta? Que Meta?', failCount, 5);
  if (failCount >= 15) await unlockAchievementIfNeeded(db, userId, 'Plano de Mentira', failCount, 15);
  if (failCount >= 30) await unlockAchievementIfNeeded(db, userId, 'Autobiotagem', failCount, 30);
  if (consecutiveFailDays >= 7) await unlockAchievementIfNeeded(db, userId, 'Speedrun do Fracasso', consecutiveFailDays, 7);
}

async function onGoalMissionCompleted(db: D1Database, userId: string, completedCount: number, consecutiveDays: number, noFailStreak: number) {
  await logUserEvent(db, userId, 'onGoalMissionCompleted', { completedCount, consecutiveDays, noFailStreak });
  if (completedCount >= 7) await unlockAchievementIfNeeded(db, userId, 'No Caminho Certo', completedCount, 7);
  if (completedCount >= 30) await unlockAchievementIfNeeded(db, userId, 'Focado', completedCount, 30);
  if (completedCount >= 100) await unlockAchievementIfNeeded(db, userId, 'Comprometido', completedCount, 100);
  if (completedCount >= 365) await unlockAchievementIfNeeded(db, userId, 'ObsessÃƒÂ£o SaudÃƒÂ¡vel', completedCount, 365);
  if (consecutiveDays >= 7) await unlockAchievementIfNeeded(db, userId, 'Sem Desvios', consecutiveDays, 7);
  if (consecutiveDays >= 30) await unlockAchievementIfNeeded(db, userId, 'Olho no Alvo', consecutiveDays, 30);
  if (noFailStreak >= 100) await unlockAchievementIfNeeded(db, userId, 'InabalÃƒÂ¡vel no PropÃƒÂ³sito', noFailStreak, 100);

  const streak = await db.prepare("SELECT current_streak FROM user_progression WHERE user_id = ?").bind(userId).first<{ current_streak: number }>();
  if (Number(streak?.current_streak ?? 0) >= 30 && noFailStreak >= 30) await unlockAchievementIfNeeded(db, userId, 'Dupla AmeaÃƒÂ§a', 30, 30);
  if (Number(streak?.current_streak ?? 0) >= 100 && noFailStreak >= 100) await unlockAchievementIfNeeded(db, userId, 'MÃƒÂ¡quina de Resultados', 100, 100);
}

async function onGoalProgress(db: D1Database, userId: string, progressPercent: number) {
  await logUserEvent(db, userId, 'onGoalProgress', { progressPercent });
  if (progressPercent >= 10) await unlockAchievementIfNeeded(db, userId, 'Primeiro Resultado', progressPercent, 10);
  if (progressPercent >= 50) await unlockAchievementIfNeeded(db, userId, 'Meio Caminho', progressPercent, 50);
  if (progressPercent >= 90) await unlockAchievementIfNeeded(db, userId, 'Quase LÃƒÂ¡', progressPercent, 90);
  if (progressPercent >= 100) await unlockAchievementIfNeeded(db, userId, 'Meta Batida', progressPercent, 100);
  if (progressPercent >= 120) await unlockAchievementIfNeeded(db, userId, 'AlÃƒÂ©m da Meta', progressPercent, 120);
}

async function onGoalChanged(db: D1Database, userId: string, oldGoal: string, newGoal: string, changeCount: number) {
  await logUserEvent(db, userId, 'onGoalChanged', { oldGoal, newGoal, changeCount });
  if (changeCount >= 1) await unlockAchievementIfNeeded(db, userId, 'Novo CapÃƒÂ­tulo', changeCount, 1);
  if (changeCount >= 3) await unlockAchievementIfNeeded(db, userId, 'Indefinido', changeCount, 3);
}

async function onMissionComplete(db: D1Database, userId: string, missionId: number) {
  await logUserEvent(db, userId, "onMissionComplete", { missionId });
  await evaluateMissionAchievementsAndTitles(db, userId);
}

async function onLevelUp(db: D1Database, userId: string, newLevel: number) {
  await logUserEvent(db, userId, "onLevelUp", { newLevel });
  await evaluateLevelTitles(db, userId, newLevel);
}

async function onChatMessage(db: D1Database, userId: string, messageCount: number) {
  await logUserEvent(db, userId, "onChatMessage", { messageCount });
  await evaluateChatAchievements(db, userId);
}

async function onSkillUnlocked(db: D1Database, userId: string, skillId: number) {
  await logUserEvent(db, userId, "onSkillUnlocked", { skillId });
  const skill = await db.prepare("SELECT name, tier FROM skills WHERE id = ?").bind(skillId).first<{ name: string; tier: string }>();
  const count = await db.prepare("SELECT COUNT(*) as c FROM user_skills WHERE user_id = ?").bind(userId).first<{ c: number }>();
  const unlockedCount = Number(count?.c ?? 0);
  if (unlockedCount >= 5) await unlockTitleIfNeeded(db, userId, "Demon Slayer");

  if (skill?.name === "Handstand") {
    await unlockAchievementIfNeeded(db, userId, "Primeiros Voos", 1, 1);
  }

  const calisthenics = await db.prepare(
    `SELECT COUNT(*) as c FROM user_skills us INNER JOIN skills s ON s.id = us.skill_id WHERE us.user_id = ? AND s.tier = 'calistenico'`
  ).bind(userId).first<{ c: number }>();
  if (Number(calisthenics?.c ?? 0) >= 9) {
    await unlockAchievementIfNeeded(db, userId, "Kalista", Number(calisthenics?.c ?? 0), 9);
  }
}

async function onRankingUpdate(db: D1Database, userId: string, position: number) {
  await logUserEvent(db, userId, "onRankingUpdate", { position });
}

async function onFriendAdded(db: D1Database, userId: string) {
  await logUserEvent(db, userId, "onFriendAdded", {});
  const [rankData, friendsCount] = await Promise.all([
    db.prepare(`SELECT COUNT(*) + 1 as position FROM user_progression WHERE (level > (SELECT level FROM user_progression WHERE user_id = ?) OR (level = (SELECT level FROM user_progression WHERE user_id = ?) AND xp > (SELECT xp FROM user_progression WHERE user_id = ?)))`)
      .bind(userId, userId, userId).first<{ position: number }>(),
    db.prepare(`SELECT COUNT(*) as c FROM friendships WHERE user_id = ? OR friend_id = ? OR friend_user_id = ?`).bind(userId, userId, userId).first<{ c: number }>(),
  ]);
  if (Number(rankData?.position ?? 999) <= 10 && Number(friendsCount?.c ?? 0) === 0) {
    await unlockAchievementIfNeeded(db, userId, "Ghost", 1, 1);
  }
}

async function onProfileCustomization(db: D1Database, userId: string, customizations: Record<string, unknown>) {
  await logUserEvent(db, userId, "onProfileCustomization", customizations);
}

async function onAppOpen(db: D1Database, userId: string, timestamp: string) {
  await ensureUserCounterRow(db, userId);
  const current = await db.prepare("SELECT app_last_open_at FROM user_event_counters WHERE user_id = ?").bind(userId).first<{ app_last_open_at: string | null }>();
  const previous = current?.app_last_open_at ? new Date(current.app_last_open_at).getTime() : Date.now();
  const now = new Date(timestamp).getTime();
  const gapDays = Math.max(0, Math.floor((now - previous) / 86400000));
  await db.prepare(`UPDATE user_event_counters SET app_last_open_at = ?, app_open_gap_days = ?, updated_at = datetime('now') WHERE user_id = ?`)
    .bind(timestamp, gapDays, userId).run();
  await logUserEvent(db, userId, "onAppOpen", { gapDays, timestamp });

  const hour = new Date(timestamp).getHours();
  if (hour >= 2 && hour < 4) {
    await unlockAchievementIfNeeded(db, userId, "InsÃƒÂ´nia", 1, 1);
  }

  if (gapDays >= 6) {
    const missionToday = await db.prepare(`SELECT COUNT(*) as c FROM missions WHERE user_id = ? AND is_completed = 1 AND date(completed_at) = date('now')`).bind(userId).first<{ c: number }>();
    if (Number(missionToday?.c ?? 0) >= 1) {
      await unlockAchievementIfNeeded(db, userId, "Fantasma", Number(gapDays), 7);
    }
  }
}

async function buildInitialTrainingPlan(mainGoal: string | null | undefined, conditioning: ConditioningLevel, equipment: string | null | undefined, injuries: string | null | undefined) {
  const restDay = conditioning === "avancado" ? "domingo" : "quarta";
  const weekly = {
    segunda: { focus: "push", muscles: ["chest", "shoulders", "triceps"], intensity: "moderada" },
    terca: { focus: "legs", muscles: ["legs", "glutes", "core"], intensity: "moderada" },
    quarta: { focus: "rest", muscles: ["mobility", "stretching"], intensity: "leve" },
    quinta: { focus: "pull", muscles: ["back", "biceps", "core"], intensity: "moderada" },
    sexta: { focus: mainGoal === "calistenia" ? "skill" : "conditioning", muscles: ["full body"], intensity: "moderada" },
    sabado: { focus: "recovery", muscles: ["mobility", "core"], intensity: "leve" },
    domingo: { focus: restDay === "domingo" ? "rest" : "optional", muscles: ["walk", "stretching"], intensity: "leve" },
  };

  return {
    goal: mainGoal ?? "saude_geral",
    conditioning,
    equipment: equipment ?? "",
    injuries: injuries ?? "",
    rest_days: [restDay],
    weekly,
    progression: "Primeiras 4 semanas com progressÃƒÂ£o linear de volume e tÃƒÂ©cnica.",
  };
}

async function upsertTrainingPlan(db: D1Database, userId: string, plan: Record<string, unknown>, mainGoal: string | null, conditioning: ConditioningLevel, equipment: string | null, injuries: string | null) {
  await db.prepare(`INSERT INTO user_training_plans (user_id, main_goal, conditioning, training_frequency, equipment, injuries, weekly_plan_json, progression_notes, updated_at)
    VALUES (?, ?, ?, 4, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      main_goal=excluded.main_goal,
      conditioning=excluded.conditioning,
      equipment=excluded.equipment,
      injuries=excluded.injuries,
      weekly_plan_json=excluded.weekly_plan_json,
      progression_notes=excluded.progression_notes,
      updated_at=datetime('now')`)
    .bind(userId, mainGoal, conditioning, equipment ?? "", injuries ?? "", JSON.stringify(plan), "progressÃƒÂ£o de base")
    .run();
}

async function tryUnlockSkillsForLevel(db: D1Database, userId: string, level: number) {
  const [profile, attrs] = await Promise.all([
    db.prepare("SELECT initial_conditioning FROM user_profiles WHERE user_id = ?").bind(userId).first<{ initial_conditioning: ConditioningLevel }>(),
    db.prepare("SELECT strength, constitution, vitality, dexterity, focus FROM user_attributes WHERE user_id = ?").bind(userId).first<Record<string, number>>(),
  ]);
  const conditioning = (profile?.initial_conditioning ?? "iniciante") as ConditioningLevel;

  const candidates = await db.prepare(
    `SELECT id, name, tier, level_required, prerequisites, attribute_requirements FROM skills
      WHERE COALESCE(level_required, required_level) <= ?
      AND id NOT IN (SELECT skill_id FROM user_skills WHERE user_id = ?)`
  ).bind(level, userId).all<{ id: number; name: string; tier: string; level_required: number; prerequisites?: string | undefined; attribute_requirements?: string | undefined }>();

  for (const skill of candidates.results) {
    if (skillTierOrder(skill.tier) > conditioningOrder(conditioning) + 1) continue;
    const prereqNames = JSON.parse(skill.prerequisites || "[]") as string[];
    let hasPrereq = true;
    for (const prereq of prereqNames) {
      const row = await db.prepare(`SELECT 1 FROM user_skills us INNER JOIN skills s ON s.id = us.skill_id WHERE us.user_id = ? AND s.name = ?`).bind(userId, prereq).first();
      if (!row) {
        hasPrereq = false;
        break;
      }
    }
    if (!hasPrereq) continue;

    const req = JSON.parse(skill.attribute_requirements || "{}") as Record<string, number>;
    const attributesOk = Object.entries(req).every(([key, value]) => Number(attrs?.[key] ?? 0) >= Number(value));
    if (!attributesOk) continue;

    await db.prepare(`INSERT OR IGNORE INTO user_skills (user_id, skill_id, status, current_stage, total_reps, total_time, best_reps, unlocked_at, updated_at)
      VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`).bind(userId, skill.id).run();
    await db.prepare(`UPDATE user_event_counters SET skills_unlocked = COALESCE(skills_unlocked,0)+1, updated_at=datetime('now') WHERE user_id = ?`).bind(userId).run();
    await onSkillUnlocked(db, userId, skill.id);
  }
}

app.get("/favicon.ico", (c) => {
  return c.body(new Uint8Array(), {
    status: 200,
    headers: {
      "Content-Type": "image/x-icon",
    },
  });
});

app.use("*", async (c, next) => {
  const origin = resolveCorsOrigin(c.req.header("Origin"), new URL(c.req.url), c.env);
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
  }
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Vary", "Origin");

  if (c.req.method === "OPTIONS") {
    if (!origin) {
      return c.newResponse("", {
        status: 403,
      });
    }
    return c.newResponse("", {
      status: 204,
    });
  }

  await next();
});

// Helper: Gera cookie com configuraÃƒÂ§ÃƒÂµes corretas
export function generateCookie(sessionId: string) {
  return `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=2592000`;
}



// Helpers de senha (PBKDF2)
const encoder = new TextEncoder();

async function deriveKeyFromPassword(password: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  return keyMaterial;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const keyMaterial = await deriveKeyFromPassword(password);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 60_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return toHex(derivedBits);
}

// Auth endpoints (e-mail/senha)
app.post(
  "/api/auth/register",
  zValidator("json", AuthRegisterRequestSchema),
  async (c) => {
    const schemaReady = await hasCoreSchema(c.env.fitloot_db);
    if (!schemaReady) return databaseNotInitializedResponse(c);

    try {
      const data = c.req.valid("json");

      const existing = await c.env.fitloot_db
        .prepare("SELECT id FROM users WHERE email = ?")
        .bind(data.email)
        .first();

      if (existing) {
        return c.json({ error: "E-mail jÃƒÂ¡ cadastrado" }, 409);
      }

      const userId = crypto.randomUUID();
      const salt = crypto.randomUUID();
      const passwordHash = await hashPassword(data.password, salt);

      await c.env.fitloot_db
        .prepare(
          "INSERT INTO users (id, email, name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(userId, data.email, data.name ?? "", passwordHash, salt)
        .run();

      return c.json({ success: true }, 201);
    } catch (error) {
      console.error("[register]", error);
      return c.json(
        { error: "Erro interno ao criar usuÃƒÂ¡rio", code: "INTERNAL_ERROR" },
        500
      );
    }
  }
);

app.get("/api/auth/check-availability", async (c) => {
  const emailQuery = (c.req.query("email") || "").trim().toLowerCase();
  const usernameQuery = (c.req.query("username") || "").trim();

  if (!emailQuery && !usernameQuery) {
    return c.json({
      emailAvailable: null,
      usernameAvailable: null,
      message: "Informe email e/ou username para validaÃƒÂ§ÃƒÂ£o.",
    }, 400);
  }

  try {
    const [emailExisting, usernameExisting] = await Promise.all([
      emailQuery
        ? c.env.fitloot_db.prepare("SELECT id FROM users WHERE lower(email) = ?").bind(emailQuery).first<{ id: string }>()
        : Promise.resolve(null),
      usernameQuery
        ? c.env.fitloot_db.prepare("SELECT id FROM user_profiles WHERE username = ?").bind(usernameQuery).first<{ id: string }>()
        : Promise.resolve(null),
    ]);

    return c.json({
      emailAvailable: emailQuery ? !emailExisting : null,
      usernameAvailable: usernameQuery ? !usernameExisting : null,
    });
  } catch (error) {
    console.error("[check-availability]", error);
    return c.json({ error: "Falha ao validar disponibilidade." }, 500);
  }
});

app.post(
  "/api/auth/login",
  zValidator("json", LoginRequestSchema),
  async (c) => {
    const schemaReady = await hasCoreSchema(c.env.fitloot_db);
    if (!schemaReady) return databaseNotInitializedResponse(c);

    const data = c.req.valid("json");

    const userRow = await c.env.fitloot_db
      .prepare(
        "SELECT id, password_hash, password_salt FROM users WHERE email = ?"
      )
      .bind(data.email)
      .first<{
        id: string;
        password_hash: string | null;
        password_salt: string | null;
      }>();

    if (!userRow) {
      return c.json(
        { error: "Nenhuma conta encontrada com esse e-mail.", code: "USER_NOT_FOUND" },
        404
      );
    }

    if (!userRow.password_hash || !userRow.password_salt) {
      return c.json({ error: "Credenciais invÃƒÂ¡lidas" }, 401);
    }

    const computed = await hashPassword(data.password, userRow.password_salt);
    if (computed !== userRow.password_hash) {
      return c.json({ error: "Credenciais invÃƒÂ¡lidas" }, 401);
    }

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    await c.env.fitloot_db
      .prepare(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
      )
      .bind(sessionId, userRow.id, expiresAt)
      .run();

    const cookie = generateCookie(sessionId);
    c.header("Set-Cookie", cookie);

    return c.json({ success: true }, 200);
  }
);

app.get("/api/users/me", authMiddleware, async (c) => {
  const user = c.get("user");

  try {
    if (!user?.id) {
      return c.json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado", code: "USER_NOT_FOUND" }, 404);
    }

    const userRecord = await getUserAuthRecordById(c.env.fitloot_db, user.id);

    if (!userRecord) {
      return c.json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado", code: "USER_NOT_FOUND" }, 404);
    }

    return c.json({
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      avatar_url: userRecord.avatar_url ?? undefined,
      onboarding_completed: userRecord.onboarding_completed,
    });
  } catch (err) {
    console.error("[/api/users/me] Erro interno:", {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      userId: user?.id,
    });

    if (isMissingSchemaError(err)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/app/open", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const timestamp = new Date().toISOString();
    await onAppOpen(c.env.fitloot_db, user.id, timestamp);
    return c.json({ success: true });
  } catch (error) {
    console.error("[/api/app/open]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return c.json({ success: true, degraded: true }, 200);
    }

    return internalErrorResponse(c);
  }
});

app.post('/api/events/route-not-found', authMiddleware, async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    await logUserEvent(c.env.fitloot_db, user.id, 'onRouteNotFound', {});
    await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, '404 Not Found', 1, 1);
    return c.json({ success: true });
  } catch (error) {
    console.error("[/api/events/route-not-found]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return c.json({ success: true, degraded: true }, 200);
    }

    return internalErrorResponse(c);
  }
});

app.patch(
  "/api/users/me",
  authMiddleware,
  zValidator("json", UpdateMeRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const data = c.req.valid("json");

    if (data.name !== undefined) {
      await c.env.fitloot_db
        .prepare("UPDATE users SET name = ? WHERE id = ?")
        .bind(data.name, user.id)
        .run();
    }
    if (data.photo_url !== undefined) {
      await c.env.fitloot_db
        .prepare("UPDATE users SET avatar_url = ? WHERE id = ?")
        .bind(data.photo_url || null, user.id)
        .run();
    }

    await onProfileCustomization(c.env.fitloot_db, user.id, {
      name_changed: data.name !== undefined,
      photo_changed: data.photo_url !== undefined,
    });

    const updated = await c.env.fitloot_db
      .prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?")
      .bind(user.id)
      .first();
    return c.json(updated ?? c.get("user"));
  }
);

app.post(
  "/api/users/plan",
  authMiddleware,
  zValidator("json", UserPlanRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const data = c.req.valid("json");

    try {
      await c.env.fitloot_db
        .prepare("UPDATE users SET plan_id = ?, plan_status = ?, onboarding_completed = 1 WHERE id = ?")
        .bind(data.plan_id, data.status, user.id)
        .run();
    } catch (error) {
      if (!isMissingOnboardingCompletedColumnError(error)) {
        throw error;
      }

      await c.env.fitloot_db
        .prepare("UPDATE users SET plan_id = ?, plan_status = ? WHERE id = ?")
        .bind(data.plan_id, data.status, user.id)
        .run();
    }

    const updated = await getUserAuthRecordById(c.env.fitloot_db, user.id);
    return c.json(updated ?? c.get("user"));
  }
);

app.get("/api/logout", async (c) => {
  const sessionId = getSessionIdFromCookieHeader(c.req.header("Cookie"));

  if (sessionId) {
    await c.env.fitloot_db
      .prepare("DELETE FROM sessions WHERE id = ?")
      .bind(sessionId)
      .run();
  }

  c.header(
    "Set-Cookie",
    "session_id=; Path=/; HttpOnly; Max-Age=0; Secure; SameSite=None"
  );

  return c.json({ success: true });
});


// User profile endpoints
app.get("/api/profile", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const profile = await c.env.fitloot_db.prepare(
      "SELECT * FROM user_profiles WHERE user_id = ?"
    ).bind(user.id).first();

    if (!profile) {
      return c.json({ error: "Perfil n?o encontrado", code: "PROFILE_NOT_FOUND" }, 404);
    }

    return c.json(profile);
  } catch (error) {
    console.error("[/api/profile]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/profile/customization", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const customPrimaryColor = typeof body.custom_primary_color === 'string' ? body.custom_primary_color : null;
  const customSecondaryColor = typeof body.custom_secondary_color === 'string' ? body.custom_secondary_color : null;
  const customBackgroundType = typeof body.custom_background_type === 'string' ? body.custom_background_type : null;
  const customBackgroundValue = typeof body.custom_background_value === 'string' ? body.custom_background_value : null;
  const customFont = typeof body.custom_font === 'string' ? body.custom_font : null;
  const customTitleId = Number.isFinite(Number(body.custom_title_id)) ? Number(body.custom_title_id) : null;
  const showcasedAchievements = Array.isArray(body.showcased_achievements) ? JSON.stringify(body.showcased_achievements) : null;

  await c.env.fitloot_db.prepare(
    `UPDATE user_profiles SET
      custom_primary_color = COALESCE(?, custom_primary_color),
      custom_secondary_color = COALESCE(?, custom_secondary_color),
      custom_background_type = COALESCE(?, custom_background_type),
      custom_background_value = COALESCE(?, custom_background_value),
      custom_font = COALESCE(?, custom_font),
      custom_title_id = COALESCE(?, custom_title_id),
      showcased_achievements = COALESCE(?, showcased_achievements),
      updated_at = datetime('now')
      WHERE user_id = ?`
  ).bind(customPrimaryColor, customSecondaryColor, customBackgroundType, customBackgroundValue, customFont, customTitleId, showcasedAchievements, user.id).run();

  await onProfileCustomization(c.env.fitloot_db, user.id, {
    custom_primary_color: customPrimaryColor,
    custom_secondary_color: customSecondaryColor,
    custom_background_type: customBackgroundType,
    custom_background_value: customBackgroundValue,
    custom_font: customFont,
    custom_title_id: customTitleId,
    showcased_achievements: showcasedAchievements,
  });

  const done = [customPrimaryColor, customSecondaryColor, customBackgroundType, customBackgroundValue, customFont, customTitleId, showcasedAchievements]
    .every((v) => v !== null && v !== undefined && v !== "");
  if (done) {
    await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, "Mestre ArtesÃƒÂ£o", 1, 1);
  }

  const profile = await c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first();
  return c.json({ success: true, profile });
});

app.post("/api/profile/skill-focus", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { active_skill_focus?: string | undefined };
  const focus = body.active_skill_focus === 'yoga' ? 'yoga' : 'calistenia';
  await c.env.fitloot_db.prepare("UPDATE user_profiles SET active_skill_focus = ?, updated_at = datetime('now') WHERE user_id = ?")
    .bind(focus, user.id).run();

  return c.json({ success: true, active_skill_focus: focus });
});

app.post("/api/profile/goal", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { main_goal?: string | undefined };
  const newGoal = String(body.main_goal ?? '').trim();
  if (!newGoal) return c.json({ error: 'main_goal obrigatÃƒÂ³rio' }, 400);

  const current = await c.env.fitloot_db.prepare("SELECT main_goal FROM user_profiles WHERE user_id = ?").bind(user.id).first<{ main_goal: string | null }>();
  const oldGoal = current?.main_goal ?? 'saude_geral';

  await c.env.fitloot_db.prepare("UPDATE user_profiles SET main_goal = ?, updated_at = datetime('now') WHERE user_id = ?").bind(newGoal, user.id).run();
  await ensureGoalStatsRow(c.env.fitloot_db, user.id, newGoal);

  const stats = await c.env.fitloot_db.prepare("SELECT goal_change_count, original_goal, completed_goals FROM user_goal_stats WHERE user_id = ?").bind(user.id).first<{ goal_change_count: number; original_goal: string; completed_goals: string | null }>();
  const changeCount = Number(stats?.goal_change_count ?? 0) + (oldGoal !== newGoal ? 1 : 0);
  const completedGoals = new Set<string>(JSON.parse(stats?.completed_goals || '[]'));
  if (oldGoal) completedGoals.add(oldGoal);

  let returned = 0;
  if ((stats?.original_goal ?? oldGoal) === newGoal && oldGoal !== newGoal) {
    returned = 1;
  }

  await c.env.fitloot_db.prepare(`UPDATE user_goal_stats SET current_goal = ?, goal_change_count = ?, completed_goals = ?, returned_to_original_count = COALESCE(returned_to_original_count,0) + ?, missions_after_return = CASE WHEN ? = 1 THEN 0 ELSE missions_after_return END, updated_at = datetime('now') WHERE user_id = ?`)
    .bind(newGoal, changeCount, JSON.stringify(Array.from(completedGoals)), returned, returned, user.id).run();

  await onGoalChanged(c.env.fitloot_db, user.id, oldGoal, newGoal, changeCount);
  if (completedGoals.size >= 5) await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'A Jornada ÃƒÂ© o Destino', completedGoals.size, 5);

  return c.json({ success: true, old_goal: oldGoal, new_goal: newGoal, change_count: changeCount });
});

app.post("/api/onboarding", authMiddleware, zValidator("json", OnboardingRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const data = c.req.valid("json");
  await ensureGamificationCatalog(c.env.fitloot_db);

  // Check if username exists
  const existingUsername = await c.env.fitloot_db.prepare(
    "SELECT id FROM user_profiles WHERE username = ?"
  ).bind(data.username).first();

  if (existingUsername) {
    return c.json({ error: "Username already taken" }, 400);
  }

  // Calculate initial attributes based on conditioning
  let initialAttrs = { strength: 10, constitution: 10, vitality: 10, dexterity: 10, focus: 10 };
  if (data.initial_conditioning === 'iniciante') {
    initialAttrs = { strength: 15, constitution: 15, vitality: 15, dexterity: 12, focus: 12 };
  } else if (data.initial_conditioning === 'intermediario') {
    initialAttrs = { strength: 25, constitution: 25, vitality: 25, dexterity: 20, focus: 20 };
  } else if (data.initial_conditioning === 'avancado') {
    initialAttrs = { strength: 40, constitution: 40, vitality: 40, dexterity: 35, focus: 35 };
  }

  // Add bonus based on initial reps
  initialAttrs.strength += Math.floor(data.initial_pushups / 5);
  initialAttrs.constitution += Math.floor(data.initial_situps / 5);
  initialAttrs.vitality += Math.floor(data.initial_squats / 5);

  // Create profile
  await c.env.fitloot_db.prepare(
    `INSERT INTO user_profiles (user_id, username, full_name, weight, height, initial_conditioning, injuries, equipment, main_goal, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(user.id, data.username, data.full_name, data.weight, data.height, data.initial_conditioning, data.injuries || '', data.equipment || '', data.main_goal).run();

  // Create attributes
  await c.env.fitloot_db.prepare(
    `INSERT INTO user_attributes (user_id, strength, constitution, vitality, dexterity, focus, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(user.id, initialAttrs.strength, initialAttrs.constitution, initialAttrs.vitality, initialAttrs.dexterity, initialAttrs.focus).run();

  // Create progression
  await c.env.fitloot_db.prepare(
    `INSERT INTO user_progression (user_id, xp, level, points, current_streak, best_streak, updated_at)
    VALUES (?, 0, 1, 0, 0, 0, datetime('now'))`
  ).bind(user.id).run();

  const conditioning = data.initial_conditioning as ConditioningLevel;
  const maxTier = conditioningOrder(conditioning);

  const initialSkills = await c.env.fitloot_db.prepare(
    `SELECT id, tier, level_required FROM skills`
  ).all<{ id: number; tier: string; level_required: number }>();

  for (const skill of initialSkills.results) {
    if (skillTierOrder(skill.tier) <= Math.max(1, maxTier) && Number(skill.level_required ?? 1) <= 1) {
      await c.env.fitloot_db.prepare(
        `INSERT OR IGNORE INTO user_skills (user_id, skill_id, status, current_stage, total_reps, total_time, best_reps, unlocked_at, updated_at)
        VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`
      ).bind(user.id, skill.id).run();
    }
  }

  const plan = await buildInitialTrainingPlan(data.main_goal, conditioning, data.equipment ?? null, data.injuries ?? null);
  await upsertTrainingPlan(c.env.fitloot_db, user.id, plan, data.main_goal, conditioning, data.equipment ?? null, data.injuries ?? null);
  await ensureGoalStatsRow(c.env.fitloot_db, user.id, data.main_goal);
  await ensureUserCounterRow(c.env.fitloot_db, user.id);
  await logUserEvent(c.env.fitloot_db, user.id, 'onboarding_completed', { conditioning, main_goal: data.main_goal });
  await evaluateLevelTitles(c.env.fitloot_db, user.id, 1);

  // Create initial daily missions
  await ensurePeriodicMissions(c.env, c.env.fitloot_db, user.id);

  return c.json({ success: true, plan_created: true }, 201);
});

// Progression endpoints
app.get("/api/progression", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    let progression = await c.env.fitloot_db.prepare(
      "SELECT * FROM user_progression WHERE user_id = ?"
    ).bind(user.id).first<Record<string, unknown>>();

    if (!progression) {
      await c.env.fitloot_db.prepare(
        `INSERT INTO user_progression (user_id, xp, level, points, current_streak, best_streak, updated_at)
        VALUES (?, 0, 1, 0, 0, 0, datetime('now'))`
      ).bind(user.id).run();

      progression = await c.env.fitloot_db.prepare(
        "SELECT * FROM user_progression WHERE user_id = ?"
      ).bind(user.id).first<Record<string, unknown>>();
    }

    if (!progression) {
      return c.json({ error: "Progress?o n?o encontrada", code: "PROGRESSION_NOT_FOUND" }, 404);
    }

    return c.json(progression);
  } catch (error) {
    console.error("[/api/progression]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.get("/api/attributes", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const attributes = await c.env.fitloot_db.prepare(
    "SELECT * FROM user_attributes WHERE user_id = ?"
  ).bind(user.id).first();

  return c.json(attributes);
});

// Skills endpoints
app.get("/api/skills", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const userSkills = await c.env.fitloot_db.prepare(
  `SELECT s.*, us.total_reps, us.total_time, us.best_reps, us.unlocked_at, us.status, us.current_stage,
      (SELECT COUNT(*) FROM skill_stages ss WHERE ss.skill_id = s.id) as total_stages
    FROM skills s
    INNER JOIN user_skills us ON s.id = us.skill_id
    WHERE us.user_id = ?
    ORDER BY COALESCE(s.level_required, s.required_level), s.id`
  ).bind(user.id).all();

  return c.json(userSkills.results);
});

app.get("/api/skills/available", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const progression = await c.env.fitloot_db.prepare(
    "SELECT level FROM user_progression WHERE user_id = ?"
  ).bind(user.id).first();

  const availableSkills = await c.env.fitloot_db.prepare(
    `SELECT s.* FROM skills s
    WHERE COALESCE(s.level_required, s.required_level) <= ?
    AND s.id NOT IN (SELECT skill_id FROM user_skills WHERE user_id = ?)
    ORDER BY COALESCE(s.level_required, s.required_level), s.id`
  ).bind(progression?.level || 1, user.id).all();

  return c.json(availableSkills.results);
});

app.post("/api/skills/:id/stage/complete", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const skillId = Number(c.req.param("id"));
  if (!Number.isFinite(skillId)) return c.json({ error: "Invalid skill" }, 400);

  const [progression, skillProgress] = await Promise.all([
    c.env.fitloot_db.prepare("SELECT level FROM user_progression WHERE user_id = ?").bind(user.id).first<{ level: number }>(),
    c.env.fitloot_db.prepare("SELECT current_stage FROM user_skills WHERE user_id = ? AND skill_id = ?").bind(user.id, skillId).first<{ current_stage: number }>(),
  ]);

  if (!skillProgress) return c.json({ error: "Skill not unlocked" }, 404);

  const nextStage = Number(skillProgress.current_stage ?? 0) + 1;
  const stageData = await c.env.fitloot_db.prepare(
    "SELECT * FROM skill_stages WHERE skill_id = ? AND stage_number = ?"
  ).bind(skillId, nextStage).first<{ level_required: number; stage_number: number }>();

  if (!stageData) return c.json({ error: "No next stage" }, 400);
  if (Number(progression?.level ?? 1) < Number(stageData.level_required ?? 1)) {
    return c.json({ error: "NÃƒÂ­vel insuficiente para esta etapa" }, 400);
  }

  await c.env.fitloot_db.prepare(
    "UPDATE user_skills SET current_stage = ?, status = 'in_progress', updated_at = datetime('now') WHERE user_id = ? AND skill_id = ?"
  ).bind(nextStage, user.id, skillId).run();

  if (nextStage >= 6) {
    await c.env.fitloot_db.prepare(
      "UPDATE user_skills SET status = 'unlocked', updated_at = datetime('now') WHERE user_id = ? AND skill_id = ?"
    ).bind(user.id, skillId).run();

    const skill = await c.env.fitloot_db.prepare("SELECT name FROM skills WHERE id = ?").bind(skillId).first<{ name: string }>();
    const titleBySkill: Record<string, string> = {
      Handstand: "O Equilibrista",
      "Muscle Up": "Acima de Todos",
      Planche: "ForÃƒÂ§a Gravitacional",
      "Human Flag": "Bandeira Humana",
      "Front Lever": "Suspenso no Tempo",
    };
    const title = titleBySkill[skill?.name ?? ""];
    if (title) await unlockTitleIfNeeded(c.env.fitloot_db, user.id, title);

    if (skill?.name === "Handstand") {
      await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, "Mestre do EquilÃƒÂ­brio", 6, 6);
    }
  }

  return c.json({ success: true, current_stage: nextStage });
});

// Missions endpoints
function parseMissionArrayField(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((item): item is string => typeof item === "string");
  }
  if (typeof rawValue !== "string") return [];
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseCircuitTaskField(rawValue: unknown): CircuitTask[] {
  const parseValue = (value: unknown): CircuitTask[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((task): CircuitTask | null => {
        if (typeof task !== "object" || task === null) return null;
        const record = task as Record<string, unknown>;
        if (typeof record.id !== "string" || typeof record.label !== "string" || typeof record.mission_type !== "string") {
          return null;
        }
        const requiredCount = Number(record.required_count ?? 0);
        const currentCount = Number(record.current_count ?? 0);
        return {
          id: record.id,
          label: record.label,
          mission_type: record.mission_type,
          required_count: requiredCount > 0 ? requiredCount : 1,
          current_count: currentCount >= 0 ? currentCount : 0,
          completed: Boolean(record.completed),
        };
      })
      .filter((task): task is CircuitTask => task !== null);
  };

  if (Array.isArray(rawValue)) {
    return parseValue(rawValue);
  }
  if (typeof rawValue !== "string") return [];
  try {
    return parseValue(JSON.parse(rawValue) as unknown);
  } catch {
    return [];
  }
}

function normalizeMissionMetricType(rawType: unknown, rawTargetTime: unknown): MissionMetricType {
  if (
    rawType === "repetitions" ||
    rawType === "duration_seconds" ||
    rawType === "sets_reps" ||
    rawType === "steps" ||
    rawType === "distance_meters" ||
    rawType === "duration_minutes" ||
    rawType === "circuit_tasks"
  ) {
    return rawType;
  }

  const targetTime = Number(rawTargetTime ?? 0);
  if (targetTime > 0) return "duration_seconds";
  return "repetitions";
}

function normalizeMissionRow(rawMission: Record<string, unknown>) {
  const metricType = normalizeMissionMetricType(rawMission.metric_type, rawMission.target_time);
  const targetReps = Number(rawMission.target_reps ?? 0);
  const targetTime = Number(rawMission.target_time ?? 0);
  const metricValue = Number(rawMission.metric_value ?? (metricType === "duration_seconds" ? targetTime : targetReps));
  const metricUnit = typeof rawMission.metric_unit === "string" && rawMission.metric_unit.length > 0
    ? rawMission.metric_unit
    : metricUnitByType(metricType);

  return {
    ...rawMission,
    metric_type: metricType,
    metric_value: metricValue > 0 ? metricValue : 1,
    metric_unit: metricUnit,
    sets: rawMission.sets === null || rawMission.sets === undefined ? null : Number(rawMission.sets),
    rest_seconds: rawMission.rest_seconds === null || rawMission.rest_seconds === undefined ? null : Number(rawMission.rest_seconds),
    instructions: parseMissionArrayField(rawMission.instructions_json),
    muscle_groups: parseMissionArrayField(rawMission.muscle_groups_json),
    attributes_benefited: parseMissionArrayField(rawMission.attributes_benefited_json),
    safety_tips: parseMissionArrayField(rawMission.safety_tips_json),
    circuit_tasks: parseCircuitTaskField(rawMission.circuit_tasks_json),
    exercise_type: typeof rawMission.exercise_type === "string" ? rawMission.exercise_type : "forca",
    body_area: rawMission.body_area === "upper" || rawMission.body_area === "lower" || rawMission.body_area === "core" || rawMission.body_area === "full_body"
      ? rawMission.body_area
      : "full_body",
    duration_estimate_minutes: Number(rawMission.duration_estimate_minutes ?? 10),
    exercise_category: typeof rawMission.exercise_category === "string" ? rawMission.exercise_category : "default",
    difficulty_level: typeof rawMission.difficulty_level === "string" ? rawMission.difficulty_level : undefined,
    video_url: typeof rawMission.video_url === "string" ? rawMission.video_url : null,
    thumbnail_url: typeof rawMission.thumbnail_url === "string" ? rawMission.thumbnail_url : null,
    mission_origin: rawMission.mission_origin === "ai" ? "ai" : "regular",
  };
}

function normalizeMatchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function missionMatchesTask(completedMission: Record<string, unknown>, task: CircuitTask): boolean {
  const taskKey = normalizeMatchText(task.mission_type);
  const title = normalizeMatchText(String(completedMission.title ?? ""));
  const description = normalizeMatchText(String(completedMission.description ?? ""));
  const exerciseCategory = normalizeMatchText(String(completedMission.exercise_category ?? ""));
  const metricType = normalizeMatchText(String(completedMission.metric_type ?? ""));
  const muscleGroups = parseMissionArrayField(completedMission.muscle_groups_json).map((item) => normalizeMatchText(item));

  const corpus = [title, description, exerciseCategory, metricType, ...muscleGroups].join(" ");
  return corpus.includes(taskKey);
}

async function grantCircuitRewards(db: D1Database, userId: string, missionRow: Record<string, unknown>) {
  const xpReward = Number(missionRow.xp_reward ?? 0);
  const pointsReward = Number(missionRow.points_reward ?? 0);

  if (xpReward <= 0 && pointsReward <= 0) return;

  await db.prepare(
    `UPDATE user_progression
       SET xp = COALESCE(xp, 0) + ?, points = COALESCE(points, 0) + ?, updated_at = datetime('now')
     WHERE user_id = ?`
  ).bind(xpReward, pointsReward, userId).run();
}

async function updateCircuitProgress(userId: string, completedMission: Record<string, unknown>, db: D1Database) {
  const circuits = await db.prepare(
    `SELECT * FROM missions
      WHERE user_id = ?
        AND type = 'weekly'
        AND metric_type = 'circuit_tasks'
        AND is_completed = 0
        AND (deadline IS NULL OR deadline > datetime('now'))`
  ).bind(userId).all<Record<string, unknown>>();

  for (const circuit of circuits.results) {
    const tasks = parseCircuitTaskField(circuit.circuit_tasks_json);
    if (tasks.length === 0) continue;

    let changed = false;
    for (const task of tasks) {
      if (task.completed) continue;
      if (!missionMatchesTask(completedMission, task)) continue;

      task.current_count += 1;
      if (task.current_count >= task.required_count) {
        task.completed = true;
      }
      changed = true;
    }

    if (!changed) continue;

    const allCompleted = tasks.every((task) => task.completed);

    await db.prepare(
      `UPDATE missions
         SET circuit_tasks_json = ?, metric_value = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(JSON.stringify(tasks), tasks.filter((task) => task.completed).length, circuit.id).run();

    if (allCompleted) {
      await db.prepare(
        `UPDATE missions
           SET is_completed = 1, status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND is_completed = 0`
      ).bind(circuit.id).run();

      await grantCircuitRewards(db, userId, circuit);
      await onMissionComplete(db, userId, Number(circuit.id));
    }
  }
}

app.get("/api/missions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    await ensurePeriodicMissions(c.env, c.env.fitloot_db, user.id);

    let missions;
    try {
      missions = await c.env.fitloot_db.prepare(
        `SELECT m.*, s.name as skill_name FROM missions m
        LEFT JOIN skills s ON m.skill_id = s.id
        WHERE m.user_id = ?
        AND (
          m.is_completed = 1
          OR (m.is_completed = 0 AND (m.deadline IS NULL OR m.deadline > datetime('now')))
          OR (COALESCE(m.status,'pending') = 'failed' AND date(m.updated_at) >= date('now', '-3 day'))
        )
        ORDER BY CASE m.type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 ELSE 4 END, m.created_at DESC`
      ).bind(user.id).all();
    } catch (statusQueryError) {
      const message = getErrorMessage(statusQueryError).toLowerCase();
      const missingStatusColumn = message.includes("no such column") && message.includes("status");
      if (!missingStatusColumn) {
        throw statusQueryError;
      }

      missions = await c.env.fitloot_db.prepare(
        `SELECT m.*, s.name as skill_name FROM missions m
        LEFT JOIN skills s ON m.skill_id = s.id
        WHERE m.user_id = ?
        AND (
          m.is_completed = 1
          OR (m.is_completed = 0 AND (m.deadline IS NULL OR m.deadline > datetime('now')))
        )
        ORDER BY CASE m.type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 ELSE 4 END, m.created_at DESC`
      ).bind(user.id).all();
    }

    const missionList = Array.isArray(missions.results) ? missions.results : [];
    const normalized = missionList.map((row) => normalizeMissionRow(row as Record<string, unknown>));
    return c.json(normalized);
  } catch (error) {
    console.error("[/api/missions]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/missions/complete", authMiddleware, zValidator("json", CompleteMissionRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const data = c.req.valid("json");
  const completedMetricValue = Number(data.metric_completed ?? data.reps_completed ?? data.time_completed ?? 0);

  const mission = await c.env.fitloot_db.prepare(
    "SELECT * FROM missions WHERE id = ? AND user_id = ? AND is_completed = 0"
  ).bind(data.mission_id, user.id).first();

  if (!mission) {
    return c.json({ error: "Mission not found" }, 404);
  }

  // Update mission
  await c.env.fitloot_db.prepare(
  `UPDATE missions SET is_completed = 1, status = 'completed', completed_at = datetime('now'), 
    verified_by_sensor = ?, updated_at = datetime('now')
    WHERE id = ?`
  ).bind(data.sensor_verified ? 1 : 0, data.mission_id).run();

  // Get current streak and progression
  const progression = await c.env.fitloot_db.prepare(
    "SELECT * FROM user_progression WHERE user_id = ?"
  ).bind(user.id).first();

  const today = assertString(safeGet(new Date().toISOString().split('T'), 0));
  let streakMultiplier = 1;
  let newStreak = Number(progression?.current_streak || 0);
  
  if (progression?.last_activity_date !== today) {
    const yesterday = assertString(safeGet(new Date(Date.now() - 86400000).toISOString().split('T'), 0));
    newStreak = 1;
    
    if (progression?.last_activity_date === yesterday) {
      newStreak = Number(progression?.current_streak || 0) + 1;
    }
    
    streakMultiplier = 1 + (newStreak * 0.1);
    
    await c.env.fitloot_db.prepare(
    `UPDATE user_progression SET current_streak = ?, best_streak = MAX(best_streak, ?), 
      last_activity_date = ?, updated_at = datetime('now')
      WHERE user_id = ?`
    ).bind(newStreak, newStreak, today, user.id).run();
  } else {
    streakMultiplier = 1 + (Number(progression?.current_streak || 0) * 0.1);
  }

  // Award XP and points
  const xpGained = Math.floor(Number(mission.xp_reward || 0) * streakMultiplier);
  const pointsGained = Number(mission.points_reward || 0);

  await c.env.fitloot_db.prepare(
    `UPDATE user_progression SET xp = COALESCE(xp, 0) + ?, points = COALESCE(points, 0) + ?, updated_at = datetime('now')
    WHERE user_id = ?`
  ).bind(xpGained, pointsGained, user.id).run();

  // Check for level up
  const updatedProgression = await c.env.fitloot_db.prepare(
    "SELECT * FROM user_progression WHERE user_id = ?"
  ).bind(user.id).first();

  const currentXp = Number(updatedProgression?.xp || 0);
  const currentLevel = Number(updatedProgression?.level || 1);
  const xpForNextLevel = currentLevel * 100;
  let leveledUp = false;

  if (currentXp >= xpForNextLevel) {
    await c.env.fitloot_db.prepare(
      `UPDATE user_progression SET level = COALESCE(level, 1) + 1, xp = COALESCE(xp, 0) - ?, points = COALESCE(points, 0) + 100, updated_at = datetime('now')
      WHERE user_id = ?`
    ).bind(xpForNextLevel, user.id).run();
    leveledUp = true;
    const afterLevel = await c.env.fitloot_db.prepare("SELECT level FROM user_progression WHERE user_id = ?").bind(user.id).first<{ level: number }>();
    const newLevel = Number(afterLevel?.level ?? currentLevel + 1);
    await onLevelUp(c.env.fitloot_db, user.id, newLevel);
    await tryUnlockSkillsForLevel(c.env.fitloot_db, user.id, newLevel);
  }

  await ensureUserCounterRow(c.env.fitloot_db, user.id);
  const currentHour = new Date().getHours();
  await c.env.fitloot_db.prepare(
    `UPDATE user_event_counters
      SET missions_completed = COALESCE(missions_completed, 0) + 1,
          consecutive_days_completed = ?,
          longest_consecutive_days = MAX(COALESCE(longest_consecutive_days, 0), ?),
          updated_at = datetime('now')
      WHERE user_id = ?`
  ).bind(newStreak, newStreak, user.id).run();
  await logUserEvent(c.env.fitloot_db, user.id, 'mission_complete', {
    missionId: mission.id,
    period: mission.type,
    xpGained,
    pointsGained,
    hour: currentHour,
    leveledUp,
  });
  const completedToday = await c.env.fitloot_db.prepare("SELECT COUNT(*) as c FROM missions WHERE user_id = ? AND is_completed = 1 AND date(completed_at) = date('now')").bind(user.id).first<{ c: number }>();
  await onStreakContinued(c.env.fitloot_db, user.id, newStreak, Number(completedToday?.c ?? 1), new Date().toISOString());
  await onMissionComplete(c.env.fitloot_db, user.id, Number(mission.id));
  await updateCircuitProgress(user.id, mission as Record<string, unknown>, c.env.fitloot_db);
  const relevance = await checkMissionRelevance(user.id, Number(mission.id), c.env.fitloot_db, 'completed');
  if (relevance.isGoalRelevant) {
    const gs = await c.env.fitloot_db.prepare("SELECT goal_completed_count FROM user_goal_stats WHERE user_id = ?").bind(user.id).first<{ goal_completed_count: number }>();
    const progressPercent = Math.min(200, Math.floor((Number(gs?.goal_completed_count ?? 0) / 100) * 100));
    await c.env.fitloot_db.prepare("UPDATE user_goal_stats SET goal_progress_percent = ?, updated_at = datetime('now') WHERE user_id = ?").bind(progressPercent, user.id).run();
    await onGoalProgress(c.env.fitloot_db, user.id, progressPercent);
  }
  if (currentHour >= 2 && currentHour < 4) {
    await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'InsÃƒÂ´nia', 1, 1);
  }

  const missionRecord = mission as Record<string, unknown>;
  const missionMetricType = normalizeMissionMetricType(
    missionRecord.metric_type,
    missionRecord.target_time
  );
  const repsForSkill = missionMetricType === "repetitions" || missionMetricType === "sets_reps"
    ? completedMetricValue
    : 0;
  const timeForSkill = missionMetricType === "duration_seconds"
    ? completedMetricValue
    : missionMetricType === "duration_minutes"
      ? completedMetricValue * 60
      : 0;

  // Update skill stats if applicable
  if (mission.skill_id && (repsForSkill > 0 || timeForSkill > 0)) {
    await c.env.fitloot_db.prepare(
    `UPDATE user_skills SET total_reps = total_reps + ?, total_time = total_time + ?, best_reps = MAX(best_reps, ?), updated_at = datetime('now')
      WHERE user_id = ? AND skill_id = ?`
    ).bind(repsForSkill, timeForSkill, repsForSkill, user.id, mission.skill_id).run();

    // Update attributes based on skill
    const skill = await c.env.fitloot_db.prepare(
      "SELECT * FROM skills WHERE id = ?"
    ).bind(mission.skill_id).first();

    if (skill) {
      await c.env.fitloot_db.prepare(
      `UPDATE user_attributes SET 
        strength = strength + ?, constitution = constitution + ?, 
        vitality = vitality + ?, dexterity = dexterity + ?, 
        focus = focus + ?, updated_at = datetime('now')
        WHERE user_id = ?`
      ).bind(
        skill.strength_gain, skill.constitution_gain,
        skill.vitality_gain, skill.dexterity_gain,
        skill.focus_gain, user.id
      ).run();
    }
  }

  return c.json({ 
    success: true, 
    xpGained, 
    pointsGained, 
    leveledUp,
    streakMultiplier: streakMultiplier.toFixed(1)
  });
});

// Achievements and titles
app.get("/api/achievements", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const achievements = await c.env.fitloot_db.prepare(
  `SELECT a.*, ua.unlocked_at, ua.progress_current, ua.progress_required,
    CASE WHEN ua.id IS NOT NULL THEN 1 ELSE 0 END as unlocked
    FROM achievements a
    LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?
    ORDER BY a.secret ASC, a.rarity, a.id`
  ).bind(user.id).all<Record<string, unknown>>();

  const mapped = achievements.results.map((achievement) => {
    const unlocked = Number(achievement.unlocked ?? 0) === 1;
    const isSecret = Number(achievement.secret ?? 0) === 1;
    if (isSecret && !unlocked) {
      return {
        ...achievement,
        name: "?",
        description: "Conquista secreta",
        condition: null,
        icon: "Ã¢Ââ€œ",
      };
    }
    return achievement;
  });

  return c.json(mapped);
});

app.get("/api/titles", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const titles = await c.env.fitloot_db.prepare(
      `SELECT t.*, ut.is_active, ut.unlocked_at,
      CASE WHEN ut.id IS NOT NULL THEN 1 ELSE 0 END as unlocked
      FROM titles t
      LEFT JOIN user_titles ut ON t.id = ut.title_id AND ut.user_id = ?
      ORDER BY t.rarity, t.id`
    ).bind(user.id).all();

    return c.json(Array.isArray(titles.results) ? titles.results : []);
  } catch (error) {
    console.error("[/api/titles]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/titles/:id/activate", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const titleId = parseInt(c.req.param("id"));

  // Deactivate all titles
  await c.env.fitloot_db.prepare(
    "UPDATE user_titles SET is_active = 0, is_equipped = 0 WHERE user_id = ?"
  ).bind(user.id).run();

  // Activate selected title
  await c.env.fitloot_db.prepare(
    "UPDATE user_titles SET is_active = 1, is_equipped = 1, updated_at = datetime('now') WHERE user_id = ? AND title_id = ?"
  ).bind(user.id, titleId).run();

  return c.json({ success: true });
});

// Shop endpoints
app.get("/api/shop/products", authMiddleware, async (c) => {
  const products = await c.env.fitloot_db.prepare(
    `SELECT p.*, sp.name as partner_name, sp.logo_url as partner_logo
    FROM shop_products p
    INNER JOIN shop_partners sp ON p.partner_id = sp.id
    WHERE p.is_available = 1
    ORDER BY p.category, p.points_cost`
  ).all();

  return c.json(products.results);
});

app.post("/api/shop/purchase/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const productId = parseInt(c.req.param("id"));

  const product = await c.env.fitloot_db.prepare(
    "SELECT * FROM shop_products WHERE id = ? AND is_available = 1"
  ).bind(productId).first();

  if (!product) {
    return c.json({ error: "Product not found" }, 404);
  }

  const progression = await c.env.fitloot_db.prepare(
    "SELECT points FROM user_progression WHERE user_id = ?"
  ).bind(user.id).first();

  if (Number(progression?.points || 0) < Number(product.points_cost || 0)) {
    return c.json({ error: "Insufficient points" }, 400);
  }

  // Deduct points
  await c.env.fitloot_db.prepare(
    "UPDATE user_progression SET points = points - ?, updated_at = datetime('now') WHERE user_id = ?"
  ).bind(product.points_cost, user.id).run();

  // Generate QR code
  const qrCode = `FITLOOT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Create order
  await c.env.fitloot_db.prepare(
    `INSERT INTO coupon_orders (user_id, product_id, points_spent, qr_code, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(user.id, productId, product.points_cost, qrCode).run();

  return c.json({ success: true, qr_code: qrCode });
});

app.get("/api/shop/orders", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const orders = await c.env.fitloot_db.prepare(
    `SELECT co.*, p.name as product_name, p.image_url
    FROM coupon_orders co
    INNER JOIN shop_products p ON co.product_id = p.id
    WHERE co.user_id = ?
    ORDER BY co.created_at DESC`
  ).bind(user.id).all();

  return c.json(orders.results);
});

// Daily metrics
app.get("/api/metrics/today", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const today = assertString(safeGet(new Date().toISOString().split('T'), 0));

    let metrics = await c.env.fitloot_db.prepare(
      "SELECT * FROM daily_metrics WHERE user_id = ? AND date = ?"
    ).bind(user.id, today).first();

    if (!metrics) {
      await c.env.fitloot_db.prepare(
        `INSERT INTO daily_metrics (user_id, date, steps, calories_burned, updated_at)
        VALUES (?, ?, 0, 0, datetime('now'))`
      ).bind(user.id, today).run();

      metrics = await c.env.fitloot_db.prepare(
        "SELECT * FROM daily_metrics WHERE user_id = ? AND date = ?"
      ).bind(user.id, today).first();
    }

    return c.json(metrics ?? { user_id: user.id, date: today, steps: 0, calories_burned: 0 });
  } catch (error) {
    console.error("[/api/metrics/today]", {
      message: getErrorMessage(error),
      userId: user.id,
    });

    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

app.post("/api/metrics/update", authMiddleware, zValidator("json", UpdateDailyMetricsRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const data = c.req.valid("json");
  const today = assertString(safeGet(new Date().toISOString().split('T'), 0));

  await c.env.fitloot_db.prepare(
    `INSERT INTO daily_metrics (user_id, date, steps, calories_burned, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, date) DO UPDATE SET
    steps = ?, calories_burned = ?, updated_at = datetime('now')`
  ).bind(user.id, today, data.steps, data.calories_burned, data.steps, data.calories_burned).run();

  return c.json({ success: true });
});

// Food diary
app.post("/api/food/scan", authMiddleware, zValidator("json", FoodScanRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const data = c.req.valid("json");

  await c.env.fitloot_db.prepare(
    `INSERT INTO food_diary (user_id, food_name, calories, meal_type, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(user.id, data.food_name, data.calories || 0, data.meal_type || 'lanche').run();

  return c.json({ success: true });
});

app.get("/api/food/today", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const today = assertString(safeGet(new Date().toISOString().split('T'), 0));

  const foods = await c.env.fitloot_db.prepare(
    `SELECT * FROM food_diary 
    WHERE user_id = ? AND DATE(scanned_at) = ?
    ORDER BY scanned_at DESC`
  ).bind(user.id, today).all();

  return c.json(foods.results);
});

// Ranking
app.get("/api/ranking/global", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const ranking = await c.env.fitloot_db.prepare(
    `SELECT up.user_id, up.username, up.full_name, pr.level, pr.xp, pr.current_streak, pr.points
    FROM user_profiles up
    INNER JOIN user_progression pr ON up.user_id = pr.user_id
    ORDER BY pr.level DESC, pr.xp DESC
    LIMIT 100`
  ).all<{ user_id: string }>();

  const position = ranking.results.findIndex((row) => row.user_id === user.id) + 1;
  if (position > 0) {
    await ensureUserCounterRow(c.env.fitloot_db, user.id);
    await onRankingUpdate(c.env.fitloot_db, user.id, position);
    if (position <= 100) await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'Na Disputa', 100 - position + 1, 100);
    if (position <= 10) await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'Elite', 10 - position + 1, 10);
    if (position === 1) await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'O Escolhido', 1, 1);
  }

  return c.json(ranking.results.map((row) => {
    const sanitized = { ...(row as Record<string, unknown>) };
    delete sanitized.user_id;
    return sanitized;
  }));
});

// Friends endpoints
app.get("/api/friends/search", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const username = (c.req.query("username") ?? "").trim();
  if (username.length < 3) return c.json([]);

  const users = await c.env.fitloot_db.prepare(
    `SELECT up.user_id, up.username, up.full_name, pr.level, pr.xp
      FROM user_profiles up
      INNER JOIN user_progression pr ON up.user_id = pr.user_id
      WHERE up.user_id != ? AND up.username LIKE ?
      LIMIT 20`
  ).bind(user.id, `%${username}%`).all();

  return c.json(users.results);
});

app.get("/api/users/search", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 3) return c.json([]);
  const users = await c.env.fitloot_db.prepare(
    `SELECT up.user_id, up.username, up.full_name, pr.level, pr.xp
      FROM user_profiles up
      INNER JOIN user_progression pr ON up.user_id = pr.user_id
      WHERE up.user_id != ? AND up.username LIKE ?
      LIMIT 20`
  ).bind(user.id, `%${q}%`).all();
  return c.json(users.results);
});

app.post("/api/friends/request", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { username?: string | undefined; friend_user_id?: string | undefined };
  const username = String(body.username ?? "").trim();
  let targetUserId = String(body.friend_user_id ?? "").trim();

  if (!targetUserId) {
    if (!username) return c.json({ error: "username ÃƒÂ© obrigatÃƒÂ³rio" }, 400);
    const target = await c.env.fitloot_db.prepare("SELECT user_id FROM user_profiles WHERE username = ?").bind(username).first<{ user_id: string }>();
    if (!target?.user_id) return c.json({ error: "UsuÃƒÂ¡rio nÃƒÂ£o encontrado" }, 404);
    targetUserId = target.user_id;
  }

  if (targetUserId === user.id) return c.json({ error: "NÃƒÂ£o ÃƒÂ© possÃƒÂ­vel adicionar a si mesmo" }, 400);

  const existingFriend = await c.env.fitloot_db.prepare(
    `SELECT id FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`
  ).bind(user.id, targetUserId, targetUserId, user.id).first();
  if (existingFriend) return c.json({ error: "JÃƒÂ¡ sÃƒÂ£o amigos" }, 400);

  const existingReq = await c.env.fitloot_db.prepare(
    `SELECT id FROM friend_requests WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) AND status = 'pending'`
  ).bind(user.id, targetUserId, targetUserId, user.id).first();
  if (existingReq) return c.json({ error: "SolicitaÃƒÂ§ÃƒÂ£o pendente" }, 400);

  await c.env.fitloot_db.prepare(
    `INSERT INTO friend_requests (from_user_id, to_user_id, status, updated_at) VALUES (?, ?, 'pending', datetime('now'))`
  ).bind(user.id, targetUserId).run();

  return c.json({ success: true }, 201);
});

app.post("/api/friends/accept", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { request_id?: number | undefined };
  const requestId = Number(body.request_id);
  if (!requestId) return c.json({ error: "request_id obrigatÃƒÂ³rio" }, 400);

  const request = await c.env.fitloot_db.prepare(
    `SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`
  ).bind(requestId, user.id).first<{ id: number; from_user_id: string; to_user_id: string }>();
  if (!request) return c.json({ error: "SolicitaÃƒÂ§ÃƒÂ£o nÃƒÂ£o encontrada" }, 404);

  await c.env.fitloot_db.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").bind(requestId).run();
  await c.env.fitloot_db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))")
    .bind(request.from_user_id, request.to_user_id).run();
  await c.env.fitloot_db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))")
    .bind(request.to_user_id, request.from_user_id).run();

  await onFriendAdded(c.env.fitloot_db, request.to_user_id);
  await onFriendAdded(c.env.fitloot_db, request.from_user_id);

  return c.json({ success: true });
});

app.post("/api/friends/reject", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => ({})) as { request_id?: number | undefined };
  const requestId = Number(body.request_id);
  if (!requestId) return c.json({ error: "request_id obrigatÃƒÂ³rio" }, 400);

  await c.env.fitloot_db.prepare(
    `UPDATE friend_requests SET status = 'rejected', updated_at = datetime('now') WHERE id = ? AND to_user_id = ?`
  ).bind(requestId, user.id).run();

  return c.json({ success: true });
});

app.delete("/api/friends/:friendId", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const friendId = c.req.param("friendId");
  await c.env.fitloot_db.prepare(`DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`)
    .bind(user.id, friendId, friendId, user.id).run();
  return c.json({ success: true });
});

app.get("/api/friends", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const friends = await c.env.fitloot_db.prepare(
    `SELECT f.id, f.friend_id as friend_user_id, up.username as friend_username,
      up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
      pr.current_streak as friend_streak
    FROM friendships f
    INNER JOIN user_profiles up ON f.friend_id = up.user_id
    INNER JOIN user_progression pr ON f.friend_id = pr.user_id
    WHERE f.user_id = ?
    ORDER BY friend_level DESC, friend_xp DESC`
  ).bind(user.id).all();

  return c.json(friends.results);
});

app.get("/api/friends/requests", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const requests = await c.env.fitloot_db.prepare(
    `SELECT fr.id, fr.from_user_id as friend_user_id, up.username as friend_username,
      up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
      pr.current_streak as friend_streak, fr.created_at
    FROM friend_requests fr
    INNER JOIN user_profiles up ON fr.from_user_id = up.user_id
    INNER JOIN user_progression pr ON fr.from_user_id = pr.user_id
    WHERE fr.to_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC`
  ).bind(user.id).all();

  return c.json(requests.results);
});

// legacy aliases
app.get("/api/friends/list", authMiddleware, async (c) => app.fetch(new Request(new URL('/api/friends', c.req.url).toString(), { method: 'GET', headers: c.req.raw.headers }), c.env, c.executionCtx));
app.post("/api/friends/:id/accept", authMiddleware, async (c) => app.fetch(new Request(new URL('/api/friends/accept', c.req.url).toString(), { method: 'POST', headers: c.req.raw.headers, body: JSON.stringify({ request_id: Number(c.req.param('id')) }) }), c.env, c.executionCtx));
app.post("/api/friends/:id/reject", authMiddleware, async (c) => app.fetch(new Request(new URL('/api/friends/reject', c.req.url).toString(), { method: 'POST', headers: c.req.raw.headers, body: JSON.stringify({ request_id: Number(c.req.param('id')) }) }), c.env, c.executionCtx));

async function registerMiniGameResult(db: D1Database, userId: string, didWin: boolean) {
  await ensureUserCounterRow(db, userId);

  await db.prepare(
    `UPDATE user_event_counters
      SET minigames_played = COALESCE(minigames_played, 0) + 1,
          minigames_won = COALESCE(minigames_won, 0) + ?,
          minigame_win_streak = CASE
            WHEN ? = 1 THEN COALESCE(minigame_win_streak, 0) + 1
            ELSE 0
          END,
          updated_at = datetime('now')
      WHERE user_id = ?`
  ).bind(didWin ? 1 : 0, didWin ? 1 : 0, userId).run();

  const counters = await db.prepare(
    "SELECT minigames_played, minigames_won, minigame_win_streak FROM user_event_counters WHERE user_id = ?"
  ).bind(userId).first<{ minigames_played: number; minigames_won: number; minigame_win_streak: number }>();

  const played = Number(counters?.minigames_played ?? 0);
  const won = Number(counters?.minigames_won ?? 0);
  const winStreak = Number(counters?.minigame_win_streak ?? 0);

  if (played >= 1) {
    await unlockAchievementIfNeeded(db, userId, "Jogador", played, 1);
  }
  if (won >= 10) {
    await unlockAchievementIfNeeded(db, userId, "Competidor", won, 10);
  }
  if (winStreak >= 50) {
    await unlockAchievementIfNeeded(db, userId, "ImbatÃ­vel", winStreak, 50);
  }
}
// Mini-games endpoints
app.post("/api/mini-games/challenge", authMiddleware, zValidator("json", MiniGameChallengeRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const data = c.req.valid("json");

  let challengedUserId = data.challenged_user_id;

  // If random opponent, find a random user with similar level
  if (data.opponent_type === 'random') {
    const progression = await c.env.fitloot_db.prepare(
      "SELECT level FROM user_progression WHERE user_id = ?"
    ).bind(user.id).first();

    const level = Number(progression?.level || 1);
    const minLevel = Math.max(1, level - 5);
    const maxLevel = level + 5;

    const randomUser = await c.env.fitloot_db.prepare(
      `SELECT user_id FROM user_progression 
      WHERE user_id != ? AND level BETWEEN ? AND ?
      ORDER BY RANDOM()
      LIMIT 1`
    ).bind(user.id, minLevel, maxLevel).first();

    if (!randomUser) {
      return c.json({ error: "No suitable opponent found" }, 404);
    }

    challengedUserId = randomUser.user_id as string;
  }

  if (!challengedUserId) {
    return c.json({ error: "Opponent not specified" }, 400);
  }

  if (challengedUserId === user.id) {
    return c.json({ error: "Cannot challenge yourself" }, 400);
  }

  const [targetUser, skill] = await Promise.all([
    c.env.fitloot_db.prepare("SELECT user_id FROM user_profiles WHERE user_id = ?").bind(challengedUserId).first<{ user_id: string }>(),
    c.env.fitloot_db.prepare("SELECT id FROM skills WHERE id = ?").bind(data.skill_id).first<{ id: number }>(),
  ]);

  if (!targetUser) {
    return c.json({ error: "Opponent not found" }, 404);
  }

  if (!skill) {
    return c.json({ error: "Skill not found" }, 404);
  }

  const existingGame = await c.env.fitloot_db.prepare(
    `SELECT id FROM mini_games
      WHERE skill_id = ?
      AND status IN ('pending', 'active')
      AND ((challenger_user_id = ? AND challenged_user_id = ?) OR (challenger_user_id = ? AND challenged_user_id = ?))`
  ).bind(data.skill_id, user.id, challengedUserId, challengedUserId, user.id).first<{ id: number }>();

  if (existingGame?.id) {
    return c.json({ error: "Existing challenge in progress" }, 409);
  }

  // Calculate rewards based on difficulty
  const xpReward = data.target_reps * 5;
  const pointsReward = data.target_reps;
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  await c.env.fitloot_db.prepare(
    `INSERT INTO mini_games (challenger_user_id, challenged_user_id, skill_id, 
    target_reps, status, xp_reward, points_reward, deadline, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, datetime('now'))`
  ).bind(user.id, challengedUserId, data.skill_id, data.target_reps, xpReward, pointsReward, deadline).run();

  return c.json({ success: true }, 201);
});

app.get("/api/mini-games/active", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const games = await c.env.fitloot_db.prepare(
    `SELECT mg.*, 
    s.name as skill_name,
    up1.username as challenger_username,
    up2.username as challenged_username
    FROM mini_games mg
    INNER JOIN skills s ON mg.skill_id = s.id
    INNER JOIN user_profiles up1 ON mg.challenger_user_id = up1.user_id
    INNER JOIN user_profiles up2 ON mg.challenged_user_id = up2.user_id
    WHERE (mg.challenger_user_id = ? OR mg.challenged_user_id = ?)
    ORDER BY 
      CASE mg.status 
        WHEN 'active' THEN 1 
        WHEN 'pending' THEN 2 
        ELSE 3 
      END,
      mg.created_at DESC`
  ).bind(user.id, user.id).all();

  return c.json(games.results);
});

app.post("/api/mini-games/:id/accept", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const gameId = Number(c.req.param("id"));
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return c.json({ error: "Invalid game id" }, 400);
  }

  const accepted = await c.env.fitloot_db.prepare(
    `UPDATE mini_games SET status = 'active', updated_at = datetime('now')
      WHERE id = ? AND challenged_user_id = ? AND status = 'pending'`
  ).bind(gameId, user.id).run();

  const changes = Number((accepted as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (changes === 0) {
    return c.json({ error: "Game not found" }, 404);
  }

  return c.json({ success: true });
});

app.post("/api/mini-games/:id/complete", authMiddleware, zValidator("json", MiniGameCompleteRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const gameId = Number(c.req.param("id"));
  if (!Number.isInteger(gameId) || gameId <= 0) {
    return c.json({ error: "Invalid game id" }, 400);
  }

  const data = c.req.valid("json");

  const game = await c.env.fitloot_db.prepare(
    `SELECT id, challenger_user_id, challenged_user_id, target_reps, xp_reward, points_reward
      FROM mini_games
      WHERE id = ? AND status = 'active'`
  ).bind(gameId).first<{
    id: number;
    challenger_user_id: string;
    challenged_user_id: string;
    target_reps: number;
    xp_reward: number;
    points_reward: number;
  }>();

  if (!game) {
    return c.json({ error: "Game not found" }, 404);
  }

  const isParticipant = game.challenger_user_id === user.id || game.challenged_user_id === user.id;
  if (!isParticipant) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (Number(data.reps_completed) < Number(game.target_reps ?? 0)) {
    return c.json({ error: "Target reps not reached" }, 400);
  }

  const winnerUserId = user.id;
  const loserUserId = winnerUserId === game.challenger_user_id ? game.challenged_user_id : game.challenger_user_id;

  const completeUpdate = await c.env.fitloot_db.prepare(
    `UPDATE mini_games
      SET status = 'completed', winner_user_id = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'active'`
  ).bind(winnerUserId, gameId).run();

  const completeChanges = Number((completeUpdate as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (completeChanges === 0) {
    return c.json({ error: "Game already completed" }, 409);
  }

  const winnerXp = Number(game.xp_reward ?? 0);
  const winnerPoints = Number(game.points_reward ?? 0);
  const loserXp = Math.floor(winnerXp / 2);
  const loserPoints = Math.floor(winnerPoints / 2);

  await Promise.all([
    c.env.fitloot_db.prepare(
      `UPDATE user_progression SET xp = COALESCE(xp, 0) + ?, points = COALESCE(points, 0) + ?, updated_at = datetime('now')
        WHERE user_id = ?`
    ).bind(winnerXp, winnerPoints, winnerUserId).run(),
    c.env.fitloot_db.prepare(
      `UPDATE user_progression SET xp = COALESCE(xp, 0) + ?, points = COALESCE(points, 0) + ?, updated_at = datetime('now')
        WHERE user_id = ?`
    ).bind(loserXp, loserPoints, loserUserId).run(),
    registerMiniGameResult(c.env.fitloot_db, winnerUserId, true),
    registerMiniGameResult(c.env.fitloot_db, loserUserId, false),
    logUserEvent(c.env.fitloot_db, winnerUserId, "onMiniGameComplete", {
      gameId,
      won: true,
      reps_completed: data.reps_completed,
      time_seconds: data.time_seconds,
    }),
    logUserEvent(c.env.fitloot_db, loserUserId, "onMiniGameComplete", {
      gameId,
      won: false,
      reps_completed: data.reps_completed,
      time_seconds: data.time_seconds,
    }),
  ]);

  return c.json({
    success: true,
    winner: winnerUserId,
    xp_gained: winnerXp,
    points_gained: winnerPoints,
  });
});

type MissionPeriod = "daily" | "weekly" | "monthly";
type MissionExerciseCategory =
  | "plank"
  | "isometric"
  | "walk"
  | "run"
  | "yoga"
  | "stretching"
  | "mobility"
  | "strength"
  | "cardio_circuit"
  | "default";
type MissionExerciseType = "forca" | "cardio" | "flexibilidade" | "equilibrio";
type MissionBodyArea = "upper" | "lower" | "core" | "full_body";

type MissionPayload = {
  title: string;
  description: string;
  metric_type: MissionMetricType;
  metric_value: number;
  metric_unit: string;
  sets: number | null;
  rest_seconds: number | null;
  instructions: string[];
  image_url: string | null;
  muscle_groups: string[];
  exercise_type: MissionExerciseType;
  body_area: MissionBodyArea;
  attributes_benefited: string[];
  xp_reward: number;
  points_reward: number;
  duration_estimate_minutes: number;
  exercise_category: MissionExerciseCategory;
  mission_origin: "regular" | "ai";
  circuit_tasks: CircuitTask[];
  safety_tips: string[];
  difficulty_level: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  target_reps: number | null;
  target_time: number | null;
};

type ExerciseRef = {
  name: string;
  muscle: string;
  equipment?: string | undefined;
  difficulty?: string | undefined;
  instructions?: string | undefined;
  image_url?: string | undefined;
  body_part?: string | undefined;
};

const METRIC_TYPE_MAP: Record<MissionExerciseCategory, MissionMetricType> = {
  plank: "duration_seconds",
  isometric: "duration_seconds",
  walk: "steps",
  run: "distance_meters",
  yoga: "duration_minutes",
  stretching: "duration_minutes",
  mobility: "duration_minutes",
  strength: "sets_reps",
  cardio_circuit: "circuit_tasks",
  default: "sets_reps",
};

function futureIsoForPeriod(period: MissionPeriod) {
  const now = Date.now();
  const durations: Record<MissionPeriod, number> = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  };

  return new Date(now + durations[period]).toISOString();
}

function normalizeExerciseCategory(name: string, muscle: string): MissionExerciseCategory {
  const text = `${name} ${muscle}`.toLowerCase();

  if (text.includes("plank") || text.includes("prancha")) return "plank";
  if (text.includes("hold") || text.includes("isometric") || text.includes("isometr")) return "isometric";
  if (text.includes("walk") || text.includes("caminha") || text.includes("step")) return "walk";
  if (text.includes("run") || text.includes("corrid") || text.includes("jog") || text.includes("sprint") || text.includes("cicl")) return "run";
  if (text.includes("yoga") || text.includes("pose")) return "yoga";
  if (text.includes("stretch") || text.includes("along")) return "stretching";
  if (text.includes("mobility") || text.includes("mobilidade")) return "mobility";
  if (text.includes("circuit") || text.includes("circuito") || text.includes("hiit")) return "cardio_circuit";
  if (text.includes("push") || text.includes("squat") || text.includes("lunge") || text.includes("pull") || text.includes("press")) return "strength";
  return "default";
}

function inferExerciseType(category: MissionExerciseCategory): MissionExerciseType {
  if (category === "run" || category === "walk" || category === "cardio_circuit") return "cardio";
  if (category === "yoga" || category === "stretching" || category === "mobility") return "flexibilidade";
  if (category === "plank" || category === "isometric") return "equilibrio";
  return "forca";
}

function inferBodyArea(muscle: string): MissionBodyArea {
  const value = muscle.toLowerCase();
  if (value.includes("core") || value.includes("abs")) return "core";
  if (value.includes("leg") || value.includes("glute") || value.includes("calf")) return "lower";
  if (value.includes("chest") || value.includes("back") || value.includes("shoulder") || value.includes("arm") || value.includes("triceps") || value.includes("biceps")) return "upper";
  return "full_body";
}

function inferAttributes(category: MissionExerciseCategory): string[] {
  if (category === "run" || category === "walk") return ["resistencia", "cardio", "consistencia"];
  if (category === "yoga" || category === "stretching" || category === "mobility") return ["mobilidade", "flexibilidade", "controle"];
  if (category === "plank" || category === "isometric") return ["estabilidade", "core", "foco"];
  if (category === "cardio_circuit") return ["resistencia", "agilidade", "cardio"];
  return ["forca", "resistencia", "potencia"];
}

function missionConfigByPeriod(period: MissionPeriod) {
  if (period === "weekly") {
    return {
      amount: MISSION_LIMITS.weekly,
      xp: 170,
      points: 50,
      titlePrefix: "Missao Semanal",
    };
  }

  if (period === "monthly") {
    return {
      amount: MISSION_LIMITS.monthly,
      xp: 420,
      points: 130,
      titlePrefix: "Missao Mensal",
    };
  }

  return {
    amount: MISSION_LIMITS.daily,
    xp: 65,
    points: 14,
    titlePrefix: "Missao Diaria",
  };
}

function metricValueByPeriod(metricType: MissionMetricType, period: MissionPeriod) {
  const table: Record<MissionMetricType, Record<MissionPeriod, number>> = {
    repetitions: { daily: 30, weekly: 180, monthly: 680 },
    duration_seconds: { daily: 90, weekly: 480, monthly: 1800 },
    sets_reps: { daily: 36, weekly: 220, monthly: 760 },
    steps: { daily: 8000, weekly: 45000, monthly: 180000 },
    distance_meters: { daily: 2000, weekly: 12000, monthly: 50000 },
    duration_minutes: { daily: 15, weekly: 45, monthly: 180 },
    circuit_tasks: { daily: 3, weekly: 4, monthly: 5 },
  };
  return table[metricType][period];
}

function inferSets(metricType: MissionMetricType, period: MissionPeriod): number | null {
  if (metricType === "duration_seconds") {
    if (period === "daily") return 3;
    if (period === "weekly") return 6;
    return 10;
  }
  if (metricType === "sets_reps") {
    if (period === "daily") return 3;
    if (period === "weekly") return 5;
    return 8;
  }
  return null;
}

function inferRestSeconds(metricType: MissionMetricType): number | null {
  if (metricType === "duration_seconds" || metricType === "sets_reps") return 60;
  return null;
}

function buildCircuitTasks(exerciseName: string, period: MissionPeriod): CircuitTask[] {
  const lower = exerciseName.toLowerCase();
  const baseRequired = period === "weekly" ? 5 : period === "monthly" ? 7 : 3;
  const fullBodyRequired = period === "weekly" ? 3 : baseRequired;

  const toTask = (missionType: string, label: string, requiredCount = baseRequired): CircuitTask => ({
    id: crypto.randomUUID(),
    label,
    mission_type: missionType,
    required_count: requiredCount,
    current_count: 0,
    completed: false,
  });

  if (lower.includes("upper body")) {
    return [
      toTask("push-up", "Completar 5 missoes de Flexao"),
      toTask("pull-up", "Completar 5 missoes de Barra"),
      toTask("abdominal", "Completar 5 missoes de Abdominal"),
      toTask("plank", "Completar 5 missoes de Prancha"),
    ];
  }

  if (lower.includes("lower body")) {
    return [
      toTask("squat", "Completar 5 missoes de Agachamento"),
      toTask("lunge", "Completar 5 missoes de Avanco"),
      toTask("glute", "Completar 5 missoes de Gluteo"),
      toTask("run", "Completar 3 missoes de Corrida", 3),
    ];
  }

  if (lower.includes("core")) {
    return [
      toTask("abdominal", "Completar 5 missoes de Abdominal"),
      toTask("plank", "Completar 5 missoes de Prancha"),
      toTask("hollow body", "Completar 5 missoes de Hollow Body"),
      toTask("wall sit", "Completar 5 missoes de Wall Sit"),
    ];
  }

  return [
    toTask("push-up", "Completar 3 missoes de Flexao", fullBodyRequired),
    toTask("squat", "Completar 3 missoes de Agachamento", fullBodyRequired),
    toTask("abdominal", "Completar 3 missoes de Abdominal", fullBodyRequired),
    toTask("plank", "Completar 3 missoes de Prancha", fullBodyRequired),
    toTask("burpee", "Completar 3 missoes de Burpee", fullBodyRequired),
  ];
}

function weeklyCircuitNameFromFocus(dayFocus: string, muscle: string): string {
  const combined = `${dayFocus} ${muscle}`.toLowerCase();
  if (combined.includes("upper")) return "Upper Body Circuit";
  if (combined.includes("lower")) return "Lower Body Circuit";
  if (combined.includes("core")) return "Core Circuit";
  return "Full Body Circuit";
}

function buildMissionDescription(exerciseName: string, metricType: MissionMetricType, metricValue: number, sets: number | null): string {
  const goalText = formatMissionGoal(metricType, metricValue, sets ?? undefined);
  if (metricType === "circuit_tasks") {
    return `Conclua o circuito semanal ${exerciseName}. O progresso das tarefas atualiza automaticamente ao completar missoes diarias.`;
  }
  if (metricType === "duration_seconds" && sets) {
    const secondsPerSet = Math.max(10, Math.floor(metricValue / sets));
    return `Execute ${sets} series de ${exerciseName}, mantendo ${secondsPerSet} segundos por serie.`;
  }
  if (metricType === "sets_reps" && sets) {
    const repsPerSet = Math.max(4, Math.floor(metricValue / sets));
    return `Complete ${sets} series de ${repsPerSet} repeticoes de ${exerciseName} com boa tecnica.`;
  }
  if (metricType === "steps") {
    return `Acumule ${metricValue.toLocaleString("pt-BR")} passos no dia usando caminhada ativa.`;
  }
  if (metricType === "distance_meters") {
    const km = (metricValue / 1000).toFixed(metricValue >= 1000 ? 1 : 0);
    return `Cubra ${km} km de corrida ou trote em ritmo constante.`;
  }
  if (metricType === "duration_minutes") {
    return `Realize ${metricValue} minutos de ${exerciseName} mantendo respiracao e postura.`;
  }
  return `Cumpra a meta de ${goalText} em ${exerciseName} com controle total do movimento.`;
}

function buildMissionInstructions(exerciseName: string, metricType: MissionMetricType, sets: number | null, restSeconds: number | null, apiInstruction?: string | undefined): string[] {
  const instructions: string[] = [
    `Prepare o corpo e ajuste a postura para ${exerciseName}.`,
  ];

  if (metricType === "circuit_tasks") {
    return [
      "Conclua as tarefas listadas ao longo da semana.",
      "Cada tarefa avanca automaticamente ao completar missoes diarias relacionadas.",
      "Mantenha consistencia nos dias de treino para fechar 100% do circuito.",
      "Ao completar todas as tarefas, a missao semanal libera recompensas automaticamente.",
    ];
  }

  if (apiInstruction) {
    instructions.push(apiInstruction.slice(0, 180));
  }

  if (metricType === "duration_seconds" || metricType === "duration_minutes") {
    instructions.push("Mantenha respiracao constante durante toda a execucao.");
  }

  if (metricType === "sets_reps" || metricType === "repetitions") {
    instructions.push("Execute cada repeticao com amplitude segura e controle.");
  }

  if (sets && restSeconds) {
    instructions.push(`Siga ${sets} series com ${restSeconds} segundos de descanso entre elas.`);
  }

  instructions.push("Interrompa imediatamente se sentir dor aguda ou tontura.");
  return instructions.slice(0, 5);
}

function buildMissionPayload(params: {
  period: MissionPeriod;
  titlePrefix: string;
  exerciseName: string;
  muscle: string;
  imageUrl?: string | undefined;
  videoUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  instruction?: string | undefined;
  safetyTips?: string[] | undefined;
  difficultyLevel?: string | undefined;
  missionOrigin?: "regular" | "ai" | undefined;
  xp: number;
  points: number;
  forceCategory?: MissionExerciseCategory | undefined;
}): MissionPayload {
  let category = params.forceCategory ?? normalizeExerciseCategory(params.exerciseName, params.muscle);
  let metricType = METRIC_TYPE_MAP[category] ?? getMissionMetricType(params.exerciseName);

  if (params.period !== "weekly" && metricType === "circuit_tasks") {
    metricType = "sets_reps";
    category = "strength";
  }

  const metricValue = metricValueByPeriod(metricType, params.period);
  const metricUnit = metricUnitByType(metricType);
  const sets = metricType === "circuit_tasks" ? null : inferSets(metricType, params.period);
  const restSeconds = metricType === "circuit_tasks" ? null : inferRestSeconds(metricType);
  const bodyArea = inferBodyArea(params.muscle);
  const exerciseType = inferExerciseType(category);
  const attributes = inferAttributes(category);
  const instructions = buildMissionInstructions(params.exerciseName, metricType, sets, restSeconds, params.instruction);
  const circuitTasks = metricType === "circuit_tasks" ? buildCircuitTasks(params.exerciseName, params.period) : [];

  const targetReps = metricType === "duration_seconds" || metricType === "duration_minutes" || metricType === "circuit_tasks" ? null : metricValue;
  const targetTime = metricType === "duration_seconds"
    ? metricValue
    : metricType === "duration_minutes"
      ? metricValue * 60
      : null;

  return {
    title: `${params.titlePrefix}: ${params.exerciseName}`,
    description: buildMissionDescription(params.exerciseName, metricType, metricValue, sets),
    metric_type: metricType,
    metric_value: metricValue,
    metric_unit: metricUnit,
    sets,
    rest_seconds: restSeconds,
    instructions,
    image_url: params.imageUrl ?? null,
    muscle_groups: [params.muscle],
    exercise_type: exerciseType,
    body_area: bodyArea,
    attributes_benefited: attributes,
    xp_reward: params.xp,
    points_reward: params.points,
    duration_estimate_minutes: metricType === "duration_seconds"
      ? Math.max(3, Math.ceil(metricValue / 60))
      : metricType === "duration_minutes"
        ? metricValue
        : metricType === "circuit_tasks"
          ? 45
          : Math.max(8, Math.floor(metricValue / 4)),
    exercise_category: category,
    mission_origin: params.missionOrigin ?? "regular",
    circuit_tasks: circuitTasks,
    safety_tips: Array.isArray(params.safetyTips) ? params.safetyTips : ["Mantenha postura segura e interrompa em caso de dor aguda."],
    difficulty_level: params.difficultyLevel ?? null,
    video_url: params.videoUrl ?? null,
    thumbnail_url: params.thumbnailUrl ?? null,
    target_reps: targetReps,
    target_time: targetTime,
  };
}

async function insertMission(db: D1Database, userId: string, period: MissionPeriod, deadline: string, mission: MissionPayload, skillId: number | null) {
  await db.prepare(
    `INSERT INTO missions (
      user_id, type, title, description, skill_id, target_reps, target_time, xp_reward, points_reward, deadline,
      metric_type, metric_value, metric_unit, sets, rest_seconds, instructions_json, image_url, muscle_groups_json,
      exercise_type, body_area, attributes_benefited_json, duration_estimate_minutes, exercise_category,
      mission_origin, circuit_tasks_json, safety_tips_json, difficulty_level, video_url, thumbnail_url, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(
    userId,
    period,
    mission.title,
    mission.description,
    skillId,
    mission.target_reps,
    mission.target_time,
    mission.xp_reward,
    mission.points_reward,
    deadline,
    mission.metric_type,
    mission.metric_value,
    mission.metric_unit,
    mission.sets,
    mission.rest_seconds,
    JSON.stringify(mission.instructions),
    mission.image_url,
    JSON.stringify(mission.muscle_groups),
    mission.exercise_type,
    mission.body_area,
    JSON.stringify(mission.attributes_benefited),
    mission.duration_estimate_minutes,
    mission.exercise_category,
    mission.mission_origin,
    JSON.stringify(mission.circuit_tasks),
    JSON.stringify(mission.safety_tips),
    mission.difficulty_level,
    mission.video_url,
    mission.thumbnail_url
  ).run();
}

async function fetchExerciseDbExercises(env: Env, muscle: string, equipment: string): Promise<ExerciseRef[]> {
  if (!env.RAPID_API_KEY) throw new Error("rapidapi-key-missing");
  const data = await fetchJsonWithTimeout<Array<Record<string, unknown>>>(
    `https://exercisedb.p.rapidapi.com/exercises/target/${encodeURIComponent(muscle)}?limit=8`,
    {
      headers: {
        "X-RapidAPI-Key": env.RAPID_API_KEY,
        "X-RapidAPI-Host": "exercisedb.p.rapidapi.com",
      },
    },
    8000
  );
  return data.map((item) => ({
    name: String(item.name ?? "Exercicio funcional"),
    muscle: String(item.target ?? muscle),
    equipment: String(item.equipment ?? (equipment || "bodyweight")),
    difficulty: "intermediate",
    instructions: Array.isArray(item.instructions) ? String(item.instructions[0] ?? "") : "",
    image_url: typeof item.gifUrl === "string" ? item.gifUrl : undefined,
    body_part: typeof item.bodyPart === "string" ? item.bodyPart : undefined,
  }));
}

async function fetchApiNinjasExercises(env: Env, muscle: string): Promise<ExerciseRef[]> {
  if (!env.RAPID_API_KEY) throw new Error("rapidapi-key-missing");
  const data = await fetchJsonWithTimeout<Array<Record<string, unknown>>>(
    `https://exercises-by-api-ninjas.p.rapidapi.com/v1/exercises?muscle=${encodeURIComponent(muscle)}`,
    {
      headers: {
        "X-RapidAPI-Key": env.RAPID_API_KEY,
        "X-RapidAPI-Host": "exercises-by-api-ninjas.p.rapidapi.com",
      },
    },
    8000
  );
  return data.slice(0, 8).map((item) => ({
    name: String(item.name ?? "Exercicio funcional"),
    muscle: String(item.muscle ?? muscle),
    equipment: String(item.equipment ?? "bodyweight"),
    difficulty: String(item.difficulty ?? "beginner"),
    instructions: String(item.instructions ?? ""),
  }));
}

async function fetchGymFitExercises(env: Env, muscle: string): Promise<ExerciseRef[]> {
  if (!env.RAPID_API_KEY) throw new Error("rapidapi-key-missing");
  const data = await fetchJsonWithTimeout<{ exercises?: Array<Record<string, unknown>> }>(
    `https://gym-fit.p.rapidapi.com/exercises?muscle=${encodeURIComponent(muscle)}`,
    {
      headers: {
        "X-RapidAPI-Key": env.RAPID_API_KEY,
        "X-RapidAPI-Host": "gym-fit.p.rapidapi.com",
      },
    },
    8000
  );
  return (data.exercises ?? []).slice(0, 8).map((item) => ({
    name: String(item.name ?? "Exercicio funcional"),
    muscle: String(item.muscle ?? muscle),
    equipment: String(item.equipment ?? "bodyweight"),
    difficulty: String(item.level ?? "beginner"),
    instructions: String(item.instructions ?? ""),
    image_url: typeof item.image_url === "string" ? item.image_url : undefined,
  }));
}

function pickLocalExercises(muscle: string): ExerciseRef[] {
  return localExercisePool.filter((ex) => ex.muscle.includes(muscle) || muscle === "full body" || muscle === "mobility");
}

async function resolveExercisesWithFallback(env: Env, muscle: string, equipment: string): Promise<{ source: string; exercises: ExerciseRef[] }> {
  try {
    const ex = await fetchExerciseDbExercises(env, muscle, equipment);
    if (ex.length > 0) return { source: "exercise_db", exercises: ex };
  } catch (error) {
    console.warn("[exercise-db]", error);
  }

  try {
    const ex = await fetchApiNinjasExercises(env, muscle);
    if (ex.length > 0) return { source: "api_ninjas", exercises: ex };
  } catch (error) {
    console.warn("[api-ninjas]", error);
  }

  try {
    const ex = await fetchGymFitExercises(env, muscle);
    if (ex.length > 0) return { source: "gym_fit", exercises: ex };
  } catch (error) {
    console.warn("[gym-fit]", error);
  }

  return { source: "local_pool", exercises: pickLocalExercises(muscle) };
}

function getWeekdayPtBr(now = new Date()) {
  return ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][now.getDay()];
}

function fallbackMissionsForPeriod(period: MissionPeriod, titlePrefix: string, xp: number, points: number): MissionPayload[] {
  if (period === "weekly") {
    return [
      buildMissionPayload({
        period,
        titlePrefix,
        exerciseName: "Circuito Funcional Completo",
        muscle: "full body",
        xp,
        points,
        forceCategory: "cardio_circuit",
      }),
      buildMissionPayload({
        period,
        titlePrefix,
        exerciseName: "Meta de Caminhada Semanal",
        muscle: "legs",
        xp,
        points,
        forceCategory: "walk",
      }),
      buildMissionPayload({
        period,
        titlePrefix,
        exerciseName: "Core Progressivo Semanal",
        muscle: "core",
        xp,
        points,
        forceCategory: "plank",
      }),
    ];
  }

  if (period === "monthly") {
    return [
      buildMissionPayload({
        period,
        titlePrefix,
        exerciseName: "Volume Mensal de Forca",
        muscle: "full body",
        xp,
        points,
        forceCategory: "strength",
      }),
      buildMissionPayload({
        period,
        titlePrefix,
        exerciseName: "Consistencia Cardio Mensal",
        muscle: "legs",
        xp,
        points,
        forceCategory: "run",
      }),
    ];
  }

  return [
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Prancha Isometrica",
      muscle: "core",
      xp,
      points,
      forceCategory: "plank",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Caminhada Ativa",
      muscle: "legs",
      xp,
      points,
      forceCategory: "walk",
    }),
    buildMissionPayload({
      period,
      titlePrefix,
      exerciseName: "Agachamento Livre",
      muscle: "legs",
      xp,
      points,
      forceCategory: "strength",
    }),
  ];
}

type ExerciseInstructionPayload = {
  instructions: string[];
  musclesAffected: string[];
  attributesBenefited: string[];
  safetyTips: string[];
  difficultyLevel: string;
};

async function getExerciseInstructionsFromAI(
  exerciseName: string,
  metricType: MissionMetricType,
  conditioningLevel: string,
  env: Env
): Promise<ExerciseInstructionPayload> {
  const fallback: ExerciseInstructionPayload = {
    instructions: [
      `Prepare-se para executar ${exerciseName} com postura segura.`,
      "Mantenha ritmo constante e respiracao controlada durante toda a execucao.",
      "Respeite a tecnica e interrompa em caso de dor aguda.",
    ],
    musclesAffected: [],
    attributesBenefited: [],
    safetyTips: ["Mantenha alinhamento corporal e evite compensacoes."],
    difficultyLevel: "iniciante",
  };

  if (!env.HF_TOKEN) return fallback;

  const prompt = [
    `Exercicio: ${exerciseName}`,
    `Nivel do usuario: ${conditioningLevel}`,
    `Tipo de metrica: ${metricType}`,
    "",
    "Responda APENAS em JSON valido:",
    "{",
    '  "instructions": ["passo 1", "passo 2"],',
    '  "musclesAffected": ["musculo"],',
    '  "attributesBenefited": ["forca"],',
    '  "safetyTips": ["dica"],',
    '  "difficultyLevel": "iniciante|intermediario|avancado"',
    "}",
  ].join("\n");

  try {
    const completion = await fetchJsonWithTimeout<{ choices?: Array<{ message?: { content?: string | undefined } }> }>(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.HF_TOKEN}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b:groq",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
          response_format: { type: "json_object" },
        }),
      },
      timeoutMsByService.huggingface
    );

    const rawContent = safeGet(completion.choices ?? [], 0)?.message?.content ?? "";
    const parsed = JSON.parse(rawContent) as Partial<ExerciseInstructionPayload>;
    return {
      instructions: Array.isArray(parsed.instructions) && parsed.instructions.length > 0
        ? parsed.instructions.map((item) => String(item)).slice(0, 6)
        : fallback.instructions,
      musclesAffected: Array.isArray(parsed.musclesAffected)
        ? parsed.musclesAffected.map((item) => String(item)).slice(0, 6)
        : fallback.musclesAffected,
      attributesBenefited: Array.isArray(parsed.attributesBenefited)
        ? parsed.attributesBenefited.map((item) => String(item)).slice(0, 6)
        : fallback.attributesBenefited,
      safetyTips: Array.isArray(parsed.safetyTips) && parsed.safetyTips.length > 0
        ? parsed.safetyTips.map((item) => String(item)).slice(0, 4)
        : fallback.safetyTips,
      difficultyLevel: typeof parsed.difficultyLevel === "string" && parsed.difficultyLevel.length > 0
        ? parsed.difficultyLevel
        : fallback.difficultyLevel,
    };
  } catch {
    return fallback;
  }
}

async function createMissionsForPeriod(env: Env, db: D1Database, userId: string, period: MissionPeriod, requestedAmount?: number) {
  const profile = await db.prepare("SELECT active_skill_focus, initial_conditioning FROM user_profiles WHERE user_id = ?")
    .bind(userId)
    .first<{ active_skill_focus: string | null; initial_conditioning: string | null }>();
  const activeFocus = profile?.active_skill_focus === "yoga" ? "yoga" : "calistenia";
  const conditioning = normalizeConditioning(profile?.initial_conditioning);

  const userSkillsResult = await db.prepare(
    "SELECT us.skill_id, us.current_stage, s.name, s.category, s.tier FROM user_skills us INNER JOIN skills s ON s.id = us.skill_id WHERE us.user_id = ? AND COALESCE(us.status,'unlocked') != 'locked'"
  ).bind(userId).all<{ skill_id: number; current_stage: number; name: string; category: string; tier: string }>();

  const userSkills = userSkillsResult.results.filter((skill) => {
    if (activeFocus === "yoga") return skill.category === "yoga" || skill.category === "core";
    return skill.category !== "yoga";
  });

  const config = missionConfigByPeriod(period);
  const targetAmount = Math.max(1, Math.min(requestedAmount ?? config.amount, MISSION_LIMITS[period]));
  const deadline = futureIsoForPeriod(period);

  if (userSkills.length === 0) {
    console.warn(`[missions] usuario ${userId} sem skills para gerar ${period}`);
    const fallback = fallbackMissionsForPeriod(period, config.titlePrefix, config.xp, config.points).slice(0, targetAmount);
    for (const mission of fallback) {
      await insertMission(db, userId, period, deadline, mission, null);
    }
    return;
  }

  const planRow = await db.prepare("SELECT weekly_plan_json, equipment FROM user_training_plans WHERE user_id = ?").bind(userId).first<{ weekly_plan_json: string; equipment: string }>();
  const weekday = getWeekdayPtBr();
  const parsedPlan = planRow?.weekly_plan_json ? JSON.parse(planRow.weekly_plan_json) as Record<string, unknown> : {};
  const dayPlan = (parsedPlan.weekly as Record<string, { focus?: string | undefined; muscles?: string[] | undefined }> | undefined)?.[weekday];
  const dayFocus = dayPlan?.focus ?? "full body";
  const muscles = dayPlan?.muscles ?? ["full body"];
  const isRestDay = dayFocus === "rest";

  const muscle = isRestDay ? "mobility" : String(muscles[0] ?? "full body");
  const exerciseResult = await resolveExercisesWithFallback(env, muscle, planRow?.equipment ?? "bodyweight");

  const shouldIncludeWeeklyCircuit = period === "weekly";
  const reservedCircuitSlots = shouldIncludeWeeklyCircuit ? 1 : 0;
  const remainingSlots = Math.max(0, targetAmount - reservedCircuitSlots);
  const plannedCount = remainingSlots > 0 ? Math.max(1, Math.ceil(remainingSlots * 0.7)) : 0;
  const variationCount = Math.max(0, remainingSlots - plannedCount);

  const planned = exerciseResult.exercises.slice(0, plannedCount);
  const randomSkills = [...userSkills].sort(() => Math.random() - 0.5).slice(0, Math.max(variationCount, 1));
  const missionsToInsert: Array<{ payload: MissionPayload; skillId: number | null }> = [];

  if (shouldIncludeWeeklyCircuit) {
    const circuitPayload = buildMissionPayload({
      period,
      titlePrefix: config.titlePrefix,
      exerciseName: weeklyCircuitNameFromFocus(dayFocus, muscle),
      muscle: "full body",
      xp: config.xp,
      points: config.points,
      forceCategory: "cardio_circuit",
    });
    missionsToInsert.push({ payload: circuitPayload, skillId: null });
  }

  const plannedPayloads = await Promise.all(
    planned.map(async (ex) => {
      const enriched = await enrichExercise(ex.name, env).catch(() => null);
      const metricHint = getMissionMetricType(enriched?.name ?? ex.name);
      const aiContext = await getExerciseInstructionsFromAI(
        enriched?.name ?? ex.name,
        metricHint,
        conditioning,
        env
      );
      const primaryInstruction = safeGet(enriched?.instructions ?? [], 0) ?? ex.instructions ?? safeGet(aiContext.instructions, 0);
      const imageUrl = enriched?.gifUrl ?? enriched?.imageUrl ?? enriched?.thumbnailUrl ?? ex.image_url;

      const payload = buildMissionPayload({
        period,
        titlePrefix: config.titlePrefix,
        exerciseName: enriched?.name ?? ex.name,
        muscle: enriched?.target ?? ex.muscle,
        imageUrl,
        videoUrl: enriched?.videoUrl ?? undefined,
        thumbnailUrl: enriched?.thumbnailUrl ?? undefined,
        instruction: primaryInstruction,
        safetyTips: aiContext.safetyTips,
        difficultyLevel: aiContext.difficultyLevel,
        xp: isRestDay ? Math.floor(config.xp * 0.7) : config.xp,
        points: isRestDay ? Math.floor(config.points * 0.7) : config.points,
        forceCategory: isRestDay ? "mobility" : undefined,
      });

      if (aiContext.instructions.length > 0) {
        payload.instructions = aiContext.instructions.slice(0, 6);
      }
      if (aiContext.musclesAffected.length > 0) {
        payload.muscle_groups = aiContext.musclesAffected.slice(0, 6);
      } else if ((enriched?.secondaryMuscles?.length ?? 0) > 0) {
        payload.muscle_groups = (enriched?.secondaryMuscles ?? []).slice(0, 6);
      }
      if (aiContext.attributesBenefited.length > 0) {
        payload.attributes_benefited = aiContext.attributesBenefited.slice(0, 6);
      }

      return payload;
    })
  );

  for (const payload of plannedPayloads) {
    missionsToInsert.push({ payload, skillId: null });
  }

  for (const skill of randomSkills.slice(0, variationCount)) {
    const payload = buildMissionPayload({
      period,
      titlePrefix: config.titlePrefix,
      exerciseName: skill.name,
      muscle: skill.category,
      xp: config.xp,
      points: config.points,
    });
    missionsToInsert.push({ payload, skillId: skill.skill_id });
  }

  for (const entry of missionsToInsert.slice(0, targetAmount)) {
    await insertMission(db, userId, period, deadline, entry.payload, entry.skillId);
  }
}

async function ensurePeriodicMissions(env: Env, db: D1Database, userId: string) {
  const periods: MissionPeriod[] = ["daily", "weekly", "monthly"];

  for (const period of periods) {
    const existing = await db.prepare(
      `SELECT COUNT(*) as count FROM missions
       WHERE user_id = ? AND type = ? AND is_completed = 0
       AND COALESCE(mission_origin, 'regular') = 'regular'
       AND (deadline IS NULL OR deadline > datetime('now'))`
    ).bind(userId, period).first<{ count: number }>();

    const existingCount = Number(existing?.count ?? 0);
    const missingCount = Math.max(0, MISSION_LIMITS[period] - existingCount);
    if (missingCount > 0) {
      await createMissionsForPeriod(env, db, userId, period, missingCount);
    }
  }
}

// AI-powered endpoints

type ApiErrorCode =
  | "SERVICE_NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE"
  | "RATE_LIMITED";

class ApiIntegrationError extends Error {
  code: ApiErrorCode;
  status: number;

  constructor(code: ApiErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_CALLS = 20;
const timeoutMsByService = {
  huggingface: 12000,
  usda: 8000,
  rapidapi: 8000,
} as const;

const requestRateMap = new Map<string, number[]>();

function enforceRateLimit(key: string) {
  const now = Date.now();
  const hits = requestRateMap.get(key) ?? [];
  const validHits = hits.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (validHits.length >= RATE_LIMIT_MAX_CALLS) {
    throw new ApiIntegrationError("RATE_LIMITED", 429, "Muitas requisiÃƒÂ§ÃƒÂµes externas. Tente novamente em instantes.");
  }
  validHits.push(now);
  requestRateMap.set(key, validHits);
}

function toFriendlyErrorResponse(error: unknown) {
  if (error instanceof ApiIntegrationError) {
    return {
      status: error.status,
      payload: {
        error: error.message,
        code: error.code,
      },
    };
  }
  return {
    status: 500,
    payload: {
      error: "ServiÃƒÂ§o temporariamente indisponÃƒÂ­vel. Tente novamente em alguns instantes.",
      code: "UPSTREAM_ERROR" satisfies ApiErrorCode,
    },
  };
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.status === 401 || response.status === 403) {
      throw new ApiIntegrationError("AUTH_FAILED", 502, "Falha de autenticaÃƒÂ§ÃƒÂ£o com serviÃƒÂ§o externo.");
    }
    if (!response.ok) {
      throw new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar serviÃƒÂ§o externo.");
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiIntegrationError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new ApiIntegrationError("TIMEOUT", 504, "Tempo de resposta excedido em serviÃƒÂ§o externo.");
    }
    throw new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar serviÃƒÂ§o externo.");
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAIChat(
  c: import("hono").Context<AppContext>,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1000,
  jsonMode = false
) {
  if (!c.env.HF_TOKEN) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "Hugging Face nÃƒÂ£o configurada.");
  }
  enforceRateLimit(`huggingface:${c.get("user")?.id ?? "anon"}`);
  return fetchJsonWithTimeout<OpenAIChatCompletionResponse>(
    "https://router.huggingface.co/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${c.env.HF_TOKEN}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b:groq",
        messages,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    },
    timeoutMsByService.huggingface
  );
}

type USDAResponse = {
  foods?: Array<{
    description?: string | undefined;
    foodNutrients?: Array<{ nutrientName?: string | undefined; value?: number | undefined }>;
  }>;
};

type RapidApiNutritionResponse = Array<{
  name?: string | undefined;
  calories?: number | undefined;
  protein_g?: number | undefined;
  carbohydrates_total_g?: number | undefined;
  fat_total_g?: number | undefined;
}>;

async function searchFoodOnUSDA(c: import("hono").Context<AppContext>, query: string) {
  if (!c.env.USDA_API_KEY) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "USDA nÃƒÂ£o configurada.");
  }
  enforceRateLimit(`usda:${c.get("user")?.id ?? "anon"}`);
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", c.env.USDA_API_KEY);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", "1");
  return fetchJsonWithTimeout<USDAResponse>(url.toString(), { method: "GET" }, timeoutMsByService.usda);
}

async function searchFoodOnRapidApi(c: import("hono").Context<AppContext>, query: string) {
  if (!c.env.RAPID_API_KEY) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "RapidAPI nÃƒÂ£o configurada.");
  }
  const host = c.env.RAPID_API_HOST || "nutrition-by-api-ninjas.p.rapidapi.com";
  enforceRateLimit(`rapidapi:${c.get("user")?.id ?? "anon"}`);
  const url = `https://${host}/v1/nutrition?query=${encodeURIComponent(query)}`;
  return fetchJsonWithTimeout<RapidApiNutritionResponse>(
    url,
    {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": c.env.RAPID_API_KEY,
        "X-RapidAPI-Host": host,
      },
    },
    timeoutMsByService.rapidapi
  );
}

function parseNutritionFromOcrLabel(text: string) {
  if (!text) return null;

  const normalize = (value?: string | undefined) => (value ? Number(value.replace(",", ".")) : null);
  const kcal = normalize(safeGet(text.match(/(\d+[.,]?\d*)\s*kcal/i) ?? [], 1));
  const kJ = normalize(safeGet(text.match(/(\d+[.,]?\d*)\s*kj/i) ?? [], 1));
  const protein = normalize(safeGet(text.match(/prote[iÃƒÂ­]n[aa]s?[^\d]*(\d+[.,]?\d*)\s*g/i) ?? [], 1));
  const carbs = normalize(safeGet(text.match(/carboidratos?[^\d]*(\d+[.,]?\d*)\s*g/i) ?? [], 1));
  const fats = normalize(safeGet(text.match(/gorduras?(?:\s+totais?)?[^\d]*(\d+[.,]?\d*)\s*g/i) ?? [], 1));

  if ([kcal, kJ, protein, carbs, fats].every((item) => item === null)) {
    return null;
  }

  return {
    calories: kcal,
    energy_kj: kJ,
    protein,
    carbs,
    fats,
  };
}

type MissionDraft = {
  title?: string | undefined;
  description?: string | undefined;
  skill_name?: string | undefined;
  muscle?: string | undefined;
  exercise_category?: MissionExerciseCategory | undefined;
  metric_value?: number | undefined;
  sets?: number | undefined;
  rest_seconds?: number | undefined;
  instructions?: string[] | undefined;
  image_url?: string | undefined;
  xp_reward?: number | undefined;
  points_reward?: number | undefined;
};

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | undefined;
    };
  }>;
}

function normalizeConditioning(value: unknown): ConditioningLevel {
  if (value === "sedentario" || value === "iniciante" || value === "intermediario" || value === "avancado") {
    return value;
  }
  return "iniciante";
}

function toSafeString(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function toPositiveInt(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : fallback;
}

function xpByConditioning(conditioning: ConditioningLevel): number {
  if (conditioning === "avancado") return 95;
  if (conditioning === "intermediario") return 75;
  if (conditioning === "sedentario") return 35;
  return 55;
}

function pointsByConditioning(conditioning: ConditioningLevel): number {
  if (conditioning === "avancado") return 24;
  if (conditioning === "intermediario") return 18;
  if (conditioning === "sedentario") return 8;
  return 12;
}

function sanitizeMissionDraft(raw: MissionDraft, conditioning: ConditioningLevel, index: number): MissionPayload {
  const baseTitle = `Missao Diaria ${index + 1}`;
  const exerciseName = toSafeString(raw.skill_name ?? raw.title, baseTitle);
  const muscle = toSafeString(raw.muscle, "full body");
  const forcedCategory = raw.exercise_category ?? normalizeExerciseCategory(exerciseName, muscle);

  const payload = buildMissionPayload({
    period: "daily",
    titlePrefix: "Missao Diaria",
    exerciseName,
    muscle,
    imageUrl: raw.image_url,
    missionOrigin: "ai",
    xp: toPositiveInt(raw.xp_reward, xpByConditioning(conditioning)),
    points: toPositiveInt(raw.points_reward, pointsByConditioning(conditioning)),
    forceCategory: forcedCategory,
  });

  const safeMetricValue = payload.metric_type === "duration_minutes"
    ? Math.min(toPositiveInt(raw.metric_value, payload.metric_value), 25)
    : toPositiveInt(raw.metric_value, payload.metric_value);
  const safeSets = raw.sets ? Math.max(1, raw.sets) : payload.sets;
  const safeRest = raw.rest_seconds ? Math.max(15, raw.rest_seconds) : payload.rest_seconds;

  return {
    ...payload,
    title: toSafeString(raw.title, payload.title),
    description: toSafeString(raw.description, buildMissionDescription(exerciseName, payload.metric_type, safeMetricValue, safeSets)),
    metric_value: safeMetricValue,
    sets: safeSets,
    rest_seconds: safeRest,
    target_reps: payload.metric_type === "duration_seconds" || payload.metric_type === "duration_minutes" ? null : safeMetricValue,
    target_time: payload.metric_type === "duration_seconds" ? safeMetricValue : payload.metric_type === "duration_minutes" ? safeMetricValue * 60 : null,
    instructions: Array.isArray(raw.instructions) && raw.instructions.length > 0
      ? raw.instructions.map((item) => toSafeString(item, "")).filter((item) => item.length > 0).slice(0, 5)
      : payload.instructions,
  };
}

// Fallback generator para missoes baseadas em condicionamento
async function generateFallbackMissions(
  conditioning: ConditioningLevel = "iniciante",
  skills: Array<{ name: string; category?: string | undefined }> = []
): Promise<MissionPayload[]> {
  if (skills.length === 0) {
    return fallbackMissionsForPeriod("daily", "Missao Diaria", xpByConditioning(conditioning), pointsByConditioning(conditioning))
      .map((mission) => ({ ...mission, mission_origin: "ai" }));
  }

  return skills.slice(0, 3).map((skill, index) =>
    sanitizeMissionDraft(
      {
        title: `Missao Diaria: ${skill.name}`,
        skill_name: skill.name,
        muscle: skill.category ?? "full body",
      },
      conditioning,
      index
    )
  );
}
// 1. Generate personalized missions using AI (70/30 com fallback robusto)
app.post("/api/ai/generate-missions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const requestBody = await c.req.json().catch(() => ({})) as { conditioning?: unknown };

    const [profile, skills] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>(),
      c.env.fitloot_db.prepare(
        "SELECT s.* FROM skills s\n        INNER JOIN user_skills us ON s.id = us.skill_id\n        WHERE us.user_id = ?"
      ).bind(user.id).all<{ id: number; name: string; category?: string | undefined }>(),
    ]);

    const conditioning = normalizeConditioning(requestBody.conditioning ?? profile?.initial_conditioning);
    const skillRows = skills.results as Array<{ id: number; name: string; category?: string | undefined }>;

    const baseMissions = await generateFallbackMissions(conditioning, skillRows);

    let aiMissions: MissionPayload[] = [];
    let fallback = false;
    let error: string | null = null;

    try {
      const aiPrompt = [
        "Gere duas missoes fitness especificas para hoje e responda JSON com a chave missions (array).",
        "Cada missao deve conter: title, description, skill_name, muscle, exercise_category.",
        "Categorias permitidas: plank, isometric, walk, run, yoga, stretching, mobility, strength, cardio_circuit.",
        "Condicionamento: " + conditioning,
        "Objetivo: " + String(profile?.main_goal ?? "saude_geral"),
        "Lesoes: " + String(profile?.injuries ?? "nenhuma"),
        "Equipamentos: " + String(profile?.equipment ?? "nenhum"),
      ].join("\n");

      const openaiData = await callOpenAIChat(c, [{ role: "user", content: aiPrompt }], 800, true);

      const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as { missions?: MissionDraft[] };
      const parsedMissions = Array.isArray(parsed.missions) ? parsed.missions : [];
      aiMissions = parsedMissions.slice(0, 2).map((mission, index) =>
        sanitizeMissionDraft(mission, conditioning, index + 3)
      );
    } catch (aiError) {
      error = "Falha na IA";
      fallback = true;
      console.error("[/api/ai/generate-missions][ai]", {
        message: getErrorMessage(aiError),
        userId: user.id,
      });
    }

    const totalMissions = [...baseMissions.slice(0, 3), ...aiMissions.slice(0, 2)].slice(0, 5);
    const aiMissionEntries = totalMissions.map((mission) => {
      const missionPeriod: MissionPeriod =
        mission.metric_type === "circuit_tasks" ||
        classifyMission(mission.title, mission.duration_estimate_minutes) === "weekly"
          ? "weekly"
          : "daily";
      return {
        period: missionPeriod,
        deadline: futureIsoForPeriod(missionPeriod),
        mission: {
          ...mission,
          mission_origin: "ai" as const,
        },
      };
    });

    for (const entry of aiMissionEntries) {
      const mission = entry.mission;
      const missionSkillName = toSafeString(mission.title, "").toLowerCase();
      const skill = missionSkillName
        ? skillRows.find((skillRow) => skillRow.name.toLowerCase().includes(missionSkillName))
        : null;

      await insertMission(
        c.env.fitloot_db,
        user.id,
        entry.period,
        entry.deadline,
        entry.mission,
        skill?.id ?? null,
      );
    }

    return c.json({
      success: true,
      missions: aiMissionEntries.map((entry) => ({ ...entry.mission, type: entry.period })),
      fallback,
      error,
    });
  } catch (routeError) {
    console.error("[/api/ai/generate-missions]", {
      message: getErrorMessage(routeError),
      userId: user.id,
    });

    if (isMissingSchemaError(routeError)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

// 2. AI Fitness Chatbot
app.post("/api/ai/chat", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const raw = await c.req.json();
    const parsed = AiChatRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
    }
    const { message: userMessage, history: conversationHistory = [], mode = "suporte", session_count } = parsed.data;

    await ensureUserCounterRow(c.env.fitloot_db, user.id);
    const currentCounter = await c.env.fitloot_db.prepare("SELECT chat_messages, repeated_message_streak, last_chat_message FROM user_event_counters WHERE user_id = ?")
      .bind(user.id).first<{ chat_messages: number; repeated_message_streak: number; last_chat_message: string | null }>();
    const sameMessage = (currentCounter?.last_chat_message ?? "") === userMessage;
    const nextRepeat = sameMessage ? Number(currentCounter?.repeated_message_streak ?? 0) + 1 : 1;
    await c.env.fitloot_db.prepare(
      `UPDATE user_event_counters SET
        chat_messages = COALESCE(chat_messages, 0) + 1,
        repeated_message_streak = ?,
        last_chat_message = ?,
        updated_at = datetime('now')
      WHERE user_id = ?`
    ).bind(nextRepeat, userMessage, user.id).run();
    await logUserEvent(c.env.fitloot_db, user.id, 'chat_message', { size: userMessage.length, repeated: sameMessage });
    await onChatMessage(c.env.fitloot_db, user.id, Number(session_count ?? (Number(currentCounter?.chat_messages ?? 0) + 1)));
    if (Number(session_count ?? 0) >= 100) {
      await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, "Conversa de Louco", Number(session_count), 100);
    }

    const [profile, progression, attributes] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(user.id).first(),
    ]);

    const systemPrompt = `VocÃƒÂª ÃƒÂ© o assistente oficial do app FitBot.
Sua funÃƒÂ§ÃƒÂ£o ÃƒÂ© responder de forma ÃƒÂºtil, natural, objetiva e agradÃƒÂ¡vel, ajudando o usuÃƒÂ¡rio com treino, evoluÃƒÂ§ÃƒÂ£o fÃƒÂ­sica, hÃƒÂ¡bitos, alimentaÃƒÂ§ÃƒÂ£o e uso do app.

REGRAS DE COMPORTAMENTO

1. TOM DE VOZ
- Fale de forma humana, natural, clara e amigÃƒÂ¡vel.
- Seja acolhedor, mas sem exagero.
- Evite linguagem robÃƒÂ³tica.
- Evite parecer um coach caricato ou motivacional demais.
- Evite excesso de entusiasmo, emojis e frases decoradas.

2. OBJETIVIDADE
- Responda exatamente o que o usuÃƒÂ¡rio pediu.
- NÃƒÂ£o acrescente explicaÃƒÂ§ÃƒÂµes longas sem necessidade.
- NÃƒÂ£o desvie do assunto.
- NÃƒÂ£o invente contexto extra.
- Se a pergunta for simples, responda de forma simples.

3. PERSONALIZAÃƒâ€¡ÃƒÆ’O
- Personalize a resposta quando isso realmente agregar valor.
- Use o nome do usuÃƒÂ¡rio com moderaÃƒÂ§ÃƒÂ£o.
- Nunca repita o nome do usuÃƒÂ¡rio em toda mensagem.
- SÃƒÂ³ use o nome em momentos especÃƒÂ­ficos: primeira saudaÃƒÂ§ÃƒÂ£o, incentivo pontual, contexto em que a personalizaÃƒÂ§ÃƒÂ£o melhora a experiÃƒÂªncia.
- Na maior parte do tempo, responda sem citar o nome.

4. ESTILO DE RESPOSTA
- Prefira respostas curtas ou mÃƒÂ©dias.
- SÃƒÂ³ faÃƒÂ§a respostas longas quando o usuÃƒÂ¡rio pedir detalhes.
- Evite introduÃƒÂ§ÃƒÂµes desnecessÃƒÂ¡rias.
- VÃƒÂ¡ direto ao ponto.
- Organize a resposta com clareza.
- Quando ÃƒÂºtil, divida em etapas simples.

5. PROIBIÃƒâ€¡Ãƒâ€¢ES DE ESTILO
- NÃƒÂ£o use frases como "Estou aqui pronto para ajudar vocÃƒÂª a evoluir", "Vamos nessa rumo ao seu objetivo", "bora ganhar XP", "estou aqui para te acompanhar nessa jornada".
- NÃƒÂ£o transforme toda resposta em mensagem motivacional.
- NÃƒÂ£o tente ser engraÃƒÂ§ado o tempo todo.
- NÃƒÂ£o use o nome do usuÃƒÂ¡rio repetidamente.
- NÃƒÂ£o enfeite respostas com texto desnecessÃƒÂ¡rio.

6. QUANDO O USUÃƒÂRIO MANDAR MENSAGEM CONFUSA
- PeÃƒÂ§a esclarecimento de forma curta e natural.
- Tom: "NÃƒÂ£o entendi muito bem. Me explica de outro jeito?" ou "Pode reformular? Quero te responder certo."
- NÃƒÂ£o faÃƒÂ§a textos longos para dizer que nÃƒÂ£o entendeu.

7. QUANDO O USUÃƒÂRIO FIZER PERGUNTA DIRETA
- Responda diretamente, sem introduÃƒÂ§ÃƒÂ£o.

8. QUANDO O USUÃƒÂRIO PEDIR AJUDA PRÃƒÂTICA
- Entregue aÃƒÂ§ÃƒÂ£o concreta: treino, ajuste de rotina, sugestÃƒÂ£o alimentar, explicaÃƒÂ§ÃƒÂ£o objetiva.
- Menos fala inspiracional, mais utilidade.

9. QUANDO NÃƒÆ’O SOUBER OU FALTAR CONTEXTO
- Admita de forma simples e peÃƒÂ§a apenas a informaÃƒÂ§ÃƒÂ£o necessÃƒÂ¡ria.
- NÃƒÂ£o invente.

10. FORMATO IDEAL
- Pergunta simples -> resposta curta
- Pergunta pratica -> resposta objetiva com passos
- Pergunta complexa -> resposta clara, sem enrolacao
- Duvida emocional -> resposta acolhedora, mas sobria

11. REGRA FINAL
Antes de responder, avalie: Estou respondendo exatamente o que foi pedido? Estou sendo mais longo do que preciso? Estou usando o nome sem necessidade? Estou parecendo natural ou teatral? Se estiver teatral ou motivacional demais, simplifique.

INSTRUÃƒâ€¡Ãƒâ€¢ES EXTRAS DE ESTILO
- NÃƒÂ£o use mais de 1 emoji por resposta, e apenas quando combinar naturalmente.
- Responda primeiro, explique depois se necessÃƒÂ¡rio.
- Se a pergunta for curta, a resposta tambÃƒÂ©m deve ser curta.
- Se o usuÃƒÂ¡rio estiver irritado ou impaciente, seja ainda mais direto.
- NUNCA use markdown na resposta. NÃƒÂ£o use **, *, |, #, ---, tabelas ou qualquer sÃƒÂ­mbolo de formataÃƒÂ§ÃƒÂ£o. Escreva em texto puro e natural.

Contexto do usuÃƒÂ¡rio:
- Nome: ${profile?.full_name}
- NÃƒÂ­vel: ${progression?.level}
- XP: ${progression?.xp}
- Streak: ${progression?.current_streak} dias
- Objetivo: ${profile?.main_goal}
- Condicionamento: ${profile?.initial_conditioning}
- ForÃƒÂ§a: ${attributes?.strength}
- Modo: ${mode}`;

    const openaiData = await callOpenAIChat(c, [
      { role: "system", content: systemPrompt },
      ...conversationHistory.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: "user", content: userMessage },
    ]);

    const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "";
    return c.json({ message: content });
  } catch (error) {
    console.error("[ai-chat]", error);
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});

// 3. AI Recommendations Engine
app.get("/api/ai/recommendations", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const [profile, progression, attributes, skills, completedMissions] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare(`
        SELECT s.*, us.total_reps, us.best_reps 
        FROM skills s
        INNER JOIN user_skills us ON s.id = us.skill_id
        WHERE us.user_id = ?
        ORDER BY us.total_reps DESC
      `).bind(user.id).all(),
      c.env.fitloot_db.prepare(`
        SELECT COUNT(*) as count 
        FROM missions 
        WHERE user_id = ? AND is_completed = 1
      `).bind(user.id).first(),
    ]);

    const prompt = `Analise este perfil fitness gamificado e gere recomendaÃƒÂ§ÃƒÂµes personalizadas em JSON.
NÃƒÂ­vel: ${progression?.level}
XP: ${progression?.xp}
MissÃƒÂµes completas: ${completedMissions?.count}
Streak: ${progression?.current_streak}
Objetivo: ${profile?.main_goal}
Atributos: forÃƒÂ§a ${attributes?.strength}, constituiÃƒÂ§ÃƒÂ£o ${attributes?.constitution}, vitalidade ${attributes?.vitality}, destreza ${attributes?.dexterity}, foco ${attributes?.focus}
Skills: ${(skills.results as Array<{ name: string; total_reps: number }>).slice(0, 5).map((s) => `${s.name}:${s.total_reps}`).join(",")}`;

    const openaiData = await callOpenAIChat(c, [{ role: "user", content: prompt }], 1000, true);
    const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "{}";
    const recommendations = JSON.parse(content);

    return c.json({
      success: true,
      recommendations,
      user_stats: {
        level: progression?.level,
        total_missions: completedMissions?.count,
        streak: progression?.current_streak,
      },
    });
  } catch (error) {
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});

// 4. AI workout suggestions
app.get("/api/ai/workout-suggestions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const [profile, progression, metrics] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM daily_metrics WHERE user_id = ? ORDER BY date DESC LIMIT 1").bind(user.id).first(),
    ]);

    const prompt = `Sugira treino em JSON com workout_type, duration_minutes, intensity, exercises e motivation. Contexto: nÃƒÂ­vel ${progression?.level}, objetivo ${profile?.main_goal}, passos ${metrics?.steps || 0}, calorias ${metrics?.calories_burned || 0}.`;

    const openaiData = await callOpenAIChat(c, [{ role: "user", content: prompt }], 900, true);
    const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "{}";
    const workout = JSON.parse(content) as Record<string, unknown>;

    return c.json({
      success: true,
      workout,
    });
  } catch (error) {
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});

type IdentifiedFoodItem = {
  food_name: string;
  portion_description?: string | undefined;
  portion_multiplier?: number | undefined;
};

function isIdentifiedFoodItem(item: unknown): item is IdentifiedFoodItem {
  if (!item || typeof item !== "object") return false;
  const value = item as { food_name?: unknown };
  return typeof value.food_name === "string" && value.food_name.trim().length > 0;
}

// 5. Food analysis pipeline (MediaPipe client detection + USDA + RapidAPI fallback + AI estimate)
app.post("/api/ai/analyze-food", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const raw = await c.req.json();
    const parsed = AiAnalyzeFoodRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
    }

    const { food_description, identified_items = [], ocr_text } = parsed.data;
    let items: IdentifiedFoodItem[] = identified_items.filter(isIdentifiedFoodItem);

    if (items.length === 0 && food_description) {
      const identifyPrompt = `Analise a refeiÃƒÂ§ÃƒÂ£o e responda APENAS em JSON no formato {"items":[{"food_name":"","portion_description":"","portion_multiplier":1}]}.
Contexto textual: ${food_description || "nÃƒÂ£o informado"}
Texto OCR do rÃƒÂ³tulo: ${ocr_text || "nÃƒÂ£o identificado"}.`;
      const aiData = await callOpenAIChat(c, [{ role: "user", content: identifyPrompt }], 700, true);
      const aiContent = safeGet(aiData.choices ?? [], 0)?.message?.content ?? "{}";
      const identified = JSON.parse(aiContent) as {
        items?: Array<{ food_name?: string | undefined; portion_description?: string | undefined; portion_multiplier?: number | undefined }>;
      };
      items = (identified.items ?? []).filter(isIdentifiedFoodItem);
    }

    const ocrNutrition = parseNutritionFromOcrLabel(ocr_text ?? "");

    if (items.length === 0 && !ocrNutrition) {
      throw new ApiIntegrationError("INVALID_RESPONSE", 422, "NÃƒÂ£o foi possÃƒÂ­vel identificar alimentos na imagem. Tente novamente com outra foto.");
    }

    const analyzedItems: Array<{
      food_name: string;
      portion_description: string;
      calories: number | null;
      protein: number | null;
      carbs: number | null;
      fats: number | null;
      energy_kj: number | null;
      source: "usda" | "rapidapi" | "estimate" | "ocr_label";
      warning?: string | undefined;
    }> = [];

    for (const item of items) {
      const query = assertString(item.food_name).trim();
      if (!query) {
        continue;
      }
      const multiplier = Number(item.portion_multiplier ?? 1);

      try {
        const usda = await searchFoodOnUSDA(c, query);
        const first = safeGet(usda.foods ?? [], 0);
        if (!first) throw new Error("not-found");
        const nutrients = first.foodNutrients ?? [];
        const byName = (name: string) => nutrients.find((n) => n.nutrientName?.toLowerCase() === name.toLowerCase())?.value ?? null;

        const calories = byName("Energy");
        const protein = byName("Protein");
        const carbs = byName("Carbohydrate, by difference");
        const fats = byName("Total lipid (fat)");

        analyzedItems.push({
          food_name: query,
          portion_description: item.portion_description || "porÃƒÂ§ÃƒÂ£o estimada",
          calories: calories !== null ? Math.round(calories * multiplier) : null,
          energy_kj: calories !== null ? Math.round(calories * 4.184 * multiplier) : null,
          protein: protein !== null ? Number((protein * multiplier).toFixed(1)) : null,
          carbs: carbs !== null ? Number((carbs * multiplier).toFixed(1)) : null,
          fats: fats !== null ? Number((fats * multiplier).toFixed(1)) : null,
          source: "usda",
        });
      } catch (itemError) {
        console.warn(`[analyze-food][usda-fallback] ${query}`, itemError);
        try {
          const rapidResult = await searchFoodOnRapidApi(c, query);
          const firstRapid = safeGet(rapidResult ?? [], 0);
          if (!firstRapid) {
            throw new Error("rapidapi-not-found");
          }

          const rapidCalories = Number(firstRapid.calories ?? 0);
          const rapidProtein = Number(firstRapid.protein_g ?? 0);
          const rapidCarbs = Number(firstRapid.carbohydrates_total_g ?? 0);
          const rapidFats = Number(firstRapid.fat_total_g ?? 0);

          analyzedItems.push({
            food_name: query,
            portion_description: item.portion_description || "porÃƒÂ§ÃƒÂ£o estimada",
            calories: Number.isFinite(rapidCalories) ? Math.round(rapidCalories * multiplier) : null,
            energy_kj: Number.isFinite(rapidCalories) ? Math.round(rapidCalories * 4.184 * multiplier) : null,
            protein: Number.isFinite(rapidProtein) ? Number((rapidProtein * multiplier).toFixed(1)) : null,
            carbs: Number.isFinite(rapidCarbs) ? Number((rapidCarbs * multiplier).toFixed(1)) : null,
            fats: Number.isFinite(rapidFats) ? Number((rapidFats * multiplier).toFixed(1)) : null,
            source: "rapidapi",
            warning: "Alimento nÃƒÂ£o encontrado no USDA. Valores retornados pela RapidAPI.",
          });
        } catch (rapidError) {
          console.warn(`[analyze-food][rapidapi-fallback] ${query}`, rapidError);
          const estimatePrompt = `Estime APENAS JSON com calories, protein, carbs, fats para ${query} (${item.portion_description || "porÃƒÂ§ÃƒÂ£o mÃƒÂ©dia"}).`;
          const fallbackData = await callOpenAIChat(c, [{ role: "user", content: estimatePrompt }], 350, true);
          const estimate = JSON.parse(safeGet(fallbackData.choices ?? [], 0)?.message?.content ?? "{}") as {
            calories?: number | undefined;
            protein?: number | undefined;
            carbs?: number | undefined;
            fats?: number | undefined;
          };

          analyzedItems.push({
            food_name: query,
            portion_description: item.portion_description || "porÃƒÂ§ÃƒÂ£o estimada",
            calories: estimate.calories ?? null,
            energy_kj: estimate.calories ? Math.round(estimate.calories * 4.184) : null,
            protein: estimate.protein ?? null,
            carbs: estimate.carbs ?? null,
            fats: estimate.fats ?? null,
            source: "estimate",
            warning: "Alimento nÃƒÂ£o encontrado no USDA/RapidAPI. Valores estimados por IA.",
          });
        }
      }
    }

    if (ocrNutrition) {
      analyzedItems.push({
        food_name: "RÃƒÂ³tulo identificado",
        portion_description: "dados extraÃƒÂ­dos do rÃƒÂ³tulo",
        calories: ocrNutrition.calories,
        energy_kj: ocrNutrition.energy_kj,
        protein: ocrNutrition.protein,
        carbs: ocrNutrition.carbs,
        fats: ocrNutrition.fats,
        source: "ocr_label",
      });
    }

    const totals = analyzedItems.reduce(
      (acc, item) => {
        acc.calories += item.calories ?? 0;
        acc.energy_kj += item.energy_kj ?? 0;
        acc.protein += item.protein ?? 0;
        acc.carbs += item.carbs ?? 0;
        acc.fats += item.fats ?? 0;
        return acc;
      },
      { calories: 0, energy_kj: 0, protein: 0, carbs: 0, fats: 0 }
    );

    const macroTotal = totals.protein + totals.carbs + totals.fats;
    const percentages = {
      protein: macroTotal > 0 ? Number(((totals.protein / macroTotal) * 100).toFixed(1)) : 0,
      carbs: macroTotal > 0 ? Number(((totals.carbs / macroTotal) * 100).toFixed(1)) : 0,
      fats: macroTotal > 0 ? Number(((totals.fats / macroTotal) * 100).toFixed(1)) : 0,
    };

    return c.json({
      success: true,
      ocr_text: ocr_text || undefined,
      items: analyzedItems,
      totals: {
        calories: Math.round(totals.calories),
        energy_kj: Math.round(totals.energy_kj),
        protein: Number(totals.protein.toFixed(1)),
        carbs: Number(totals.carbs.toFixed(1)),
        fats: Number(totals.fats.toFixed(1)),
        macro_percentages: percentages,
      },
      has_estimates: analyzedItems.some((item) => item.source !== "usda"),
      estimation_warning: analyzedItems.some((item) => item.source === "estimate")
        ? "Alguns alimentos nÃƒÂ£o foram encontrados no USDA/RapidAPI e foram estimados por IA."
        : undefined,
    });
  } catch (error) {
    console.error("[analyze-food]", error);
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});


app.get("/health", async (c) => {
  const host = new URL(c.req.url).hostname;
  const schemaReady = await hasCoreSchema(c.env.fitloot_db);
  const environment = host === "localhost" || host === "127.0.0.1" ? "local" : "production";

  return c.json({
    ok: true,
    timestamp: new Date().toISOString(),
    hasHuggingFace: Boolean(c.env.HF_TOKEN),
    hasOpenAI: false,
    hasUSDA: Boolean(c.env.USDA_API_KEY),
    hasRapidAPI: Boolean(c.env.RAPID_API_KEY),
    hasVision: false,
    hasDB: Boolean(c.env.fitloot_db),
    hasCoreSchema: schemaReady,
    environment,
  });
});

async function processDailyReset(env: Env) {
  await processDailyResetForAllUsers({
    db: env.fitloot_db,
    processUser: async (userId) => {
      await ensureUserCounterRow(env.fitloot_db, userId);
      await expirePendingMissionsAndUpdateStreak(env.fitloot_db, userId);
    },
  });
}

// 6. Healthchecks for external services
app.get("/api/health/external", authMiddleware, async (c) => {
  return c.json({
    huggingface: Boolean(c.env.HF_TOKEN),
    openai: false,
    usda: Boolean(c.env.USDA_API_KEY),
    rapidapi: Boolean(c.env.RAPID_API_KEY),
    google_vision: false,
    anthropic: Boolean(c.env.ANTHROPIC_API_KEY),
  });
});

app.get("/api/health/openai", authMiddleware, async (c) => c.json({ ok: false, deprecated: true }));
app.get("/api/health/huggingface", authMiddleware, async (c) => c.json({ ok: Boolean(c.env.HF_TOKEN) }));
app.get("/api/health/usda", authMiddleware, async (c) => c.json({ ok: Boolean(c.env.USDA_API_KEY) }));
app.get("/api/health/rapidapi", authMiddleware, async (c) => c.json({ ok: Boolean(c.env.RAPID_API_KEY) }));
app.get("/api/health/vision", authMiddleware, async (c) => c.json({ ok: false, deprecated: true }));

// -----------------------------
// SPA fallback (APENAS apÃƒÂ³s todas as rotas /api/* definidas)
// -----------------------------
app.get("*", async (c, next) => {
  // Se for rota API, passa adiante para as rotas definidas
  if (c.req.path.startsWith("/api")) {
    return next();
  }

  try {
    // c.req ÃƒÂ© um Request vÃƒÂ¡lido para passar ao binding ASSETS
    return await c.env.ASSETS.fetch(c.req.raw);
  } catch {
    // se falhar, passa para prÃƒÂ³ximos handlers (ou 404)
    return next();
  }
});


export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processDailyReset(env));
  },
};
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "https://fitloot.vercel.app",
  "https://fitloot-worker.suportefitloot.workers.dev",
];

function buildAllowedOrigins(env: Env) {
  const configuredOrigins = [env.FRONTEND_ORIGIN, env.FRONTEND_ORIGINS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
}

function resolveCorsOrigin(requestOrigin: string | undefined, requestUrl: URL, env: Env) {
  const allowedOrigins = buildAllowedOrigins(env);

  if (!requestOrigin) {
    return requestUrl.origin;
  }

  return allowedOrigins.has(requestOrigin) ? requestOrigin : null;
}


