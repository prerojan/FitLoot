import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  OnboardingRequestSchema,
  CompleteMissionRequestSchema,
  FoodScanRequestSchema,
  UpdateDailyMetricsRequestSchema,
  FriendRequestSchema,
  MiniGameChallengeRequestSchema,
  MiniGameCompleteRequestSchema,
  AiChatRequestSchema,
  AiAnalyzeFoodRequestSchema,
  AuthRegisterRequestSchema,
  LoginRequestSchema,
  UserPlanRequestSchema,
  UpdateMeRequestSchema,
} from "../shared/types";
import { assertString, safeGet } from "../utils/typeHelpers";
import { toStatusCode } from "./httpHelpers";

// Tipo do usuário autenticado
interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
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
      error: 'Banco local não inicializado. Execute as migrations D1 antes de usar a API.',
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

// Middleware de autenticação próprio
async function authMiddleware(
  c: import("hono").Context<{ Bindings: Env; Variables: { user: AuthUser } }>,
  next: () => Promise<void>
) {
  const schemaReady = await hasCoreSchema(c.env.fitloot_db);
  if (!schemaReady) {
    return databaseNotInitializedResponse(c);
  }

  await ensureCatalogReady(c.env.fitloot_db);

  const sessionId = safeGet(c.req.header('Cookie')?.match(/session_id=([^;]+)/) ?? [], 1);

  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const session = await c.env.fitloot_db.prepare(
    'SELECT s.id as session_id, s.user_id, s.expires_at, u.email, u.name, u.avatar_url, COALESCE(u.onboarding_completed, 0) as onboarding_completed FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime("now")'
  ).bind(sessionId).first();

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  (c as import("hono").Context<AppContext>).set("user", {
    id: session.user_id as string,
    email: session.email as string,
    name: session.name as string,
    avatar_url: session.avatar_url as string | undefined,
    onboarding_completed: Number(session.onboarding_completed) === 1 ? 1 : 0,
  });

  await next();
}

// ---------- ENV TYPES ----------
export interface Env {
  fitloot_db: D1Database;
  ASSETS: Fetcher;
  HF_TOKEN: string;
  USDA_API_KEY: string;
  RAPID_API_KEY?: string;
  RAPID_API_HOST?: string;
  ANTHROPIC_API_KEY?: string;
  EXERCISE_DB_KEY?: string;
  API_NINJAS_KEY?: string;
  GYMFIT_API_KEY?: string;
}
// --------------------------------


const app = new Hono<AppContext>();


type ConditioningLevel = "sedentario" | "iniciante" | "intermediario" | "avancado";

type ExerciseRef = { name: string; muscle: string; equipment?: string; difficulty?: string; instructions?: string };

type SkillSeed = {
  name: string;
  category: string;
  difficulty: string;
  tier: "iniciante" | "intermediario" | "avancado" | "calistenico";
  requiredLevel: number;
  description: string;
  unlockMessage: string;
  prerequisites?: string[];
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
  { name: "Flexão", category: "peito", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Empurrar horizontal com peso corporal", unlockMessage: "Flexão desbloqueada." },
  { name: "Agachamento", category: "pernas", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Base para força de membros inferiores", unlockMessage: "Agachamento desbloqueado." },
  { name: "Abdominal", category: "core", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Fortalecimento de core", unlockMessage: "Abdominal desbloqueado." },
  { name: "Prancha", category: "core", difficulty: "basico", tier: "iniciante", requiredLevel: 1, description: "Isometria de core", unlockMessage: "Prancha desbloqueada." },
  { name: "Barra Fixa", category: "costas", difficulty: "intermediario", tier: "intermediario", requiredLevel: 5, description: "Puxada vertical", unlockMessage: "Barra fixa disponível." },
  { name: "Dips", category: "triceps", difficulty: "intermediario", tier: "intermediario", requiredLevel: 7, description: "Empurrar em barras paralelas", unlockMessage: "Dips desbloqueado." },
  { name: "Handstand", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 6, description: "Progressão de equilíbrio invertido", unlockMessage: "Inicie sua jornada no handstand.", prerequisites: ["Prancha"], attributeRequirements: { strength: 20, dexterity: 20 } },
  { name: "Front Lever", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 10, description: "Alavanca frontal", unlockMessage: "Front Lever desbloqueado.", prerequisites: ["Barra Fixa"], attributeRequirements: { strength: 30 } },
  { name: "Back Lever", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 10, description: "Alavanca posterior", unlockMessage: "Back Lever desbloqueado.", prerequisites: ["Barra Fixa"], attributeRequirements: { strength: 30 } },
  { name: "Planche", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 12, description: "Sustentação horizontal", unlockMessage: "Planche desbloqueada.", prerequisites: ["Dips"], attributeRequirements: { strength: 38 } },
  { name: "Human Flag", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 14, description: "Bandeira humana", unlockMessage: "Human Flag desbloqueada.", attributeRequirements: { strength: 42, dexterity: 30 } },
  { name: "Muscle Up", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 11, description: "Transição de barra", unlockMessage: "Muscle Up desbloqueado.", prerequisites: ["Barra Fixa", "Dips"], attributeRequirements: { strength: 36 } },
  { name: "Pistol Squat", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 9, description: "Agachamento unilateral", unlockMessage: "Pistol Squat desbloqueado.", prerequisites: ["Agachamento"], attributeRequirements: { vitality: 28 } },
  { name: "Dragon Flag", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 13, description: "Core avançado", unlockMessage: "Dragon Flag desbloqueada.", prerequisites: ["Abdominal"], attributeRequirements: { strength: 34, focus: 24 } },
  { name: "L-Sit", category: "calistenia", difficulty: "calistenia", tier: "calistenico", requiredLevel: 8, description: "Sustentação em L", unlockMessage: "L-Sit desbloqueado.", prerequisites: ["Prancha"], attributeRequirements: { strength: 24, focus: 18 } },
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
]
  .flatMap(([skillName, stages], idxSkill) => (stages as string[]).map((name, idx) => ({
    skillName: String(skillName),
    stageNumber: idx + 1,
    name,
    description: `Progressão ${idx + 1} de ${skillName}`,
    levelRequired: 4 + idx * 2 + idxSkill % 2,
    exerciseReference: name,
  })));

const titleSeeds = [
  { name: "Recruta", description: "Primeiros passos", reference: "RPG", unlock_condition: "level:1", rarity: "Comum" },
  { name: "Guerreiro do Core", description: "Nível 5", reference: "Calistenia", unlock_condition: "level:5", rarity: "Comum" },
  { name: "Veterano de Ferro", description: "Nível 10", reference: "Musculação", unlock_condition: "level:10", rarity: "Incomum" },
  { name: "Lâmina Afiada", description: "Nível 15", reference: "Ação", unlock_condition: "level:15", rarity: "Raro" },
  { name: "Mestre do Peso Corporal", description: "Nível 20", reference: "Calistenia", unlock_condition: "level:20", rarity: "Raro" },
  { name: "O Último de Nós", description: "Nível 30", reference: "TLOU", unlock_condition: "level:30", rarity: "Mítico" },
  { name: "Lendário", description: "Nível 50", reference: "RPG", unlock_condition: "level:50", rarity: "Mítico" },
  { name: "O Equilibrista", description: "Handstand completo", reference: "Calistenia", unlock_condition: "skill:Handstand:6", rarity: "Raro" },
  { name: "Acima de Todos", description: "Muscle Up completo", reference: "Calistenia", unlock_condition: "skill:Muscle Up:6", rarity: "Raro" },
  { name: "Força Gravitacional", description: "Planche completa", reference: "Calistenia", unlock_condition: "skill:Planche:6", rarity: "Mítico" },
  { name: "Bandeira Humana", description: "Human Flag completa", reference: "Calistenia", unlock_condition: "skill:Human Flag:6", rarity: "Mítico" },
  { name: "Suspenso no Tempo", description: "Front Lever completo", reference: "Calistenia", unlock_condition: "skill:Front Lever:6", rarity: "Raro" },
  { name: "Shoto Style", description: "Referência Street Fighter", reference: "Street Fighter", unlock_condition: "missions:120", rarity: "Incomum" },
  { name: "Iron Fist", description: "Referência Tekken", reference: "Tekken", unlock_condition: "strength:80", rarity: "Raro" },
  { name: "King of Iron Body", description: "Referência jogos de luta", reference: "Fighting Games", unlock_condition: "level:35", rarity: "Mítico" },
  { name: "300", description: "300 treinos completados", reference: "Filme 300", unlock_condition: "missions:300", rarity: "Mítico" },
  { name: "Rocky", description: "30 dias de streak", reference: "Rocky", unlock_condition: "streak:30", rarity: "Raro" },
  { name: "Predador", description: "Caça semanal concluída", reference: "Predador", unlock_condition: "weekly:1", rarity: "Incomum" },
  { name: "Chosen Undead", description: "Falhou e insistiu", reference: "Dark Souls", unlock_condition: "failures:10", rarity: "Secreto" },
  { name: "The Witcher", description: "Contrato semanal", reference: "The Witcher", unlock_condition: "weekly:5", rarity: "Raro" },
  { name: "Demon Slayer", description: "5 habilidades desbloqueadas", reference: "Anime", unlock_condition: "skills:5", rarity: "Raro" },
  { name: "Hollow", description: "Perdeu sequência 3x", reference: "Hollow Knight", unlock_condition: "streak_loss:3", rarity: "Secreto" },
];

const achievementSeeds = [
  { name: "Primeiro Passo", description: "Completar a primeira missão", category: "missoes", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "missions_completed>=1", icon: "👣", reference: "" },
  { name: "Aquecendo", description: "Completar 7 missões", category: "missoes", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "missions_completed>=7", icon: "🔥", reference: "" },
  { name: "Rotina Formada", description: "Completar 30 missões", category: "missoes", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "missions_completed>=30", icon: "📅", reference: "" },
  { name: "Sem Desculpas", description: "5 dias seguidos", category: "missoes", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "streak>=5", icon: "✅", reference: "" },
  { name: "Máquina", description: "Completar 100 missões", category: "missoes", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "missions_completed>=100", icon: "⚙️", reference: "" },
  { name: "Imparável", description: "30 dias consecutivos", category: "missoes", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "streak>=30", icon: "🏃", reference: "" },
  { name: "Lenda Viva", description: "365 missões", category: "missoes", rarity: "Mítico", color: "#EF4444", secret: 0, condition: "missions_completed>=365", icon: "👑", reference: "" },
  { name: "Primeira Conversa", description: "Primeira mensagem no FitBot", category: "chat", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "chat_messages>=1", icon: "💬", reference: "" },
  { name: "Curioso", description: "50 perguntas ao FitBot", category: "chat", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "chat_messages>=50", icon: "🤔", reference: "" },
  { name: "Aprendiz Dedicado", description: "200 interações no chat", category: "chat", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "chat_messages>=200", icon: "🧠", reference: "" },
  { name: "Eco", description: "Condição secreta", category: "chat", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "repeat_message_streak>=5", icon: "🌀", reference: "" },
  { name: "Na Disputa", description: "Entrar no top 100", category: "ranking", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "ranking<=100", icon: "🥉", reference: "" },
  { name: "Elite", description: "Entrar no top 10", category: "ranking", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "ranking<=10", icon: "🥈", reference: "" },
  { name: "O Escolhido", description: "Alcançar #1", category: "ranking", rarity: "Mítico", color: "#EF4444", secret: 0, condition: "ranking==1", icon: "🥇", reference: "" },
  { name: "Ghost", description: "Condição secreta", category: "ranking", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "top10_no_friends", icon: "👤", reference: "" },
  { name: "Primeiros Voos", description: "Primeira etapa do Handstand", category: "habilidades", rarity: "Incomum", color: "#22C55E", secret: 0, condition: "skill_stage:Handstand>=1", icon: "🕊️", reference: "" },
  { name: "Mestre do Equilíbrio", description: "Handstand completo", category: "habilidades", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "skill_stage:Handstand>=6", icon: "🤸", reference: "" },
  { name: "Kalista", description: "Todas as skills calistênicas", category: "habilidades", rarity: "Mítico", color: "#EF4444", secret: 0, condition: "all_calisthenics", icon: "⚔️", reference: "" },
  { name: "Jogador", description: "Primeiro minigame", category: "minigames", rarity: "Comum", color: "#D1D5DB", secret: 0, condition: "minigames_played>=1", icon: "🎮", reference: "" },
  { name: "Competidor", description: "Vencer 10 minigames", category: "minigames", rarity: "Raro", color: "#3B82F6", secret: 0, condition: "minigames_won>=10", icon: "🏅", reference: "" },
  { name: "Imbatível", description: "50 vitórias seguidas", category: "minigames", rarity: "Mítico", color: "#EF4444", secret: 0, condition: "minigame_win_streak>=50", icon: "🔥", reference: "" },
  { name: "Mestre Artesão", description: "Condição secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "craft_master", icon: "🛠️", reference: "Hollow Knight" },
  { name: "Insônia", description: "Condição secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "mission_2am_4am", icon: "🌙", reference: "" },
  { name: "Fantasma", description: "Condição secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "open_gap6_complete_day7", icon: "👻", reference: "" },
  { name: "Conversa de Louco", description: "Condição secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "chat_session_100", icon: "🤯", reference: "" },
  { name: "Glitch", description: "Condição secreta", category: "secreta", rarity: "Secreto", color: "#F59E0B", secret: 1, condition: "report_bug_chat", icon: "🐞", reference: "" },
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
  if (missionsCompleted >= 100) await unlockAchievementIfNeeded(db, userId, "Máquina", missionsCompleted, 100);
  if (missionsCompleted >= 365) await unlockAchievementIfNeeded(db, userId, "Lenda Viva", missionsCompleted, 365);
  if (consecutiveDays >= 5) await unlockAchievementIfNeeded(db, userId, "Sem Desculpas", consecutiveDays, 5);
  if (consecutiveDays >= 30) {
    await unlockAchievementIfNeeded(db, userId, "Imparável", consecutiveDays, 30);
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
    [1, "Recruta"], [5, "Guerreiro do Core"], [10, "Veterano de Ferro"], [15, "Lâmina Afiada"],
    [20, "Mestre do Peso Corporal"], [30, "O Último de Nós"], [50, "Lendário"],
  ];
  for (const [threshold, name] of byLevel) {
    if (level >= threshold) await unlockTitleIfNeeded(db, userId, name);
  }
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
    progression: "Primeiras 4 semanas com progressão linear de volume e técnica.",
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
    .bind(userId, mainGoal, conditioning, equipment ?? "", injuries ?? "", JSON.stringify(plan), "progressão de base")
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
  ).bind(level, userId).all<{ id: number; name: string; tier: string; level_required: number; prerequisites?: string; attribute_requirements?: string }>();

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
  const origin = c.req.header("Origin") || "";

  c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Headers", "Content-Type, Cookie, Authorization");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

  if (c.req.method === "OPTIONS") {
    return c.newResponse("", {
      status: 204,
    });
  }

  await next();
});

// Helper: Gera cookie com configurações corretas
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
        return c.json({ error: "E-mail já cadastrado" }, 409);
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
        { error: "Erro interno ao criar usuário", code: "INTERNAL_ERROR" },
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
      message: "Informe email e/ou username para validação.",
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
      return c.json({ error: "Credenciais inválidas" }, 401);
    }

    const computed = await hashPassword(data.password, userRow.password_salt);
    if (computed !== userRow.password_hash) {
      return c.json({ error: "Credenciais inválidas" }, 401);
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
  return c.json(c.get("user"));
});

app.post("/api/app/open", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const timestamp = new Date().toISOString();
  await onAppOpen(c.env.fitloot_db, user.id, timestamp);
  return c.json({ success: true });
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

    await c.env.fitloot_db
      .prepare("UPDATE users SET plan_id = ?, plan_status = ?, onboarding_completed = 1 WHERE id = ?")
      .bind(data.plan_id, data.status, user.id)
      .run();

    const updated = await c.env.fitloot_db
      .prepare("SELECT id, email, name, avatar_url, COALESCE(onboarding_completed, 0) as onboarding_completed FROM users WHERE id = ?")
      .bind(user.id)
      .first();
    return c.json(updated ?? c.get("user"));
  }
);

app.get("/api/logout", async (c) => {
  const sessionId = safeGet(c.req.header("Cookie")?.match(/session_id=([^;]+)/) ?? [], 1);

  if (sessionId) {
    await c.env.fitloot_db
      .prepare("DELETE FROM sessions WHERE id = ?")
      .bind(sessionId)
      .run();
  }

  // Apaga o cookie corretamente
  c.header(
    "Set-Cookie",
    "session_id=; Path=/; HttpOnly; Max-Age=0; Secure; SameSite=None"
  );

  return c.redirect("/");
});


// User profile endpoints
app.get("/api/profile", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const profile = await c.env.fitloot_db.prepare(
    "SELECT * FROM user_profiles WHERE user_id = ?"
  ).bind(user.id).first();

  return c.json(profile);
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
  
  const progression = await c.env.fitloot_db.prepare(
    "SELECT * FROM user_progression WHERE user_id = ?"
  ).bind(user.id).first();

  return c.json(progression);
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
    return c.json({ error: "Nível insuficiente para esta etapa" }, 400);
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
      Planche: "Força Gravitacional",
      "Human Flag": "Bandeira Humana",
      "Front Lever": "Suspenso no Tempo",
    };
    const title = titleBySkill[skill?.name ?? ""];
    if (title) await unlockTitleIfNeeded(c.env.fitloot_db, user.id, title);

    if (skill?.name === "Handstand") {
      await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, "Mestre do Equilíbrio", 6, 6);
    }
  }

  return c.json({ success: true, current_stage: nextStage });
});

// Missions endpoints
app.get("/api/missions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  await ensurePeriodicMissions(c.env, c.env.fitloot_db, user.id);

  const missions = await c.env.fitloot_db.prepare(
    `SELECT m.*, s.name as skill_name FROM missions m
    LEFT JOIN skills s ON m.skill_id = s.id
    WHERE m.user_id = ? AND m.is_completed = 0
    AND (m.deadline IS NULL OR m.deadline > datetime('now'))
    ORDER BY CASE m.type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 ELSE 4 END, m.created_at`
  ).bind(user.id).all();

  return c.json(missions.results);
});

app.post("/api/missions/complete", authMiddleware, zValidator("json", CompleteMissionRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const data = c.req.valid("json");

  const mission = await c.env.fitloot_db.prepare(
    "SELECT * FROM missions WHERE id = ? AND user_id = ? AND is_completed = 0"
  ).bind(data.mission_id, user.id).first();

  if (!mission) {
    return c.json({ error: "Mission not found" }, 404);
  }

  // Update mission
  await c.env.fitloot_db.prepare(
  `UPDATE missions SET is_completed = 1, completed_at = datetime('now'), 
    verified_by_sensor = ?, updated_at = datetime('now')
    WHERE id = ?`
  ).bind(data.sensor_verified ? 1 : 0, data.mission_id).run();

  // Get current streak and progression
  const progression = await c.env.fitloot_db.prepare(
    "SELECT * FROM user_progression WHERE user_id = ?"
  ).bind(user.id).first();

  const today = assertString(safeGet(new Date().toISOString().split('T'), 0));
  let streakMultiplier = 1;
  
  if (progression?.last_activity_date !== today) {
    const yesterday = assertString(safeGet(new Date(Date.now() - 86400000).toISOString().split('T'), 0));
    let newStreak = 1;
    
    if (progression?.last_activity_date === yesterday) {
      newStreak = Number(progression.current_streak || 0) + 1;
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
  await onMissionComplete(c.env.fitloot_db, user.id, Number(mission.id));
  if (currentHour >= 2 && currentHour < 4) {
    await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, 'Insônia', 1, 1);
  }

  // Update skill stats if applicable
  if (mission.skill_id && data.reps_completed) {
    await c.env.fitloot_db.prepare(
    `UPDATE user_skills SET total_reps = total_reps + ?, best_reps = MAX(best_reps, ?), updated_at = datetime('now')
      WHERE user_id = ? AND skill_id = ?`
    ).bind(data.reps_completed, data.reps_completed, user.id, mission.skill_id).run();

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
        icon: "❓",
      };
    }
    return achievement;
  });

  return c.json(mapped);
});

app.get("/api/titles", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const titles = await c.env.fitloot_db.prepare(
    `SELECT t.*, ut.is_active, ut.unlocked_at,
    CASE WHEN ut.id IS NOT NULL THEN 1 ELSE 0 END as unlocked
    FROM titles t
    LEFT JOIN user_titles ut ON t.id = ut.title_id AND ut.user_id = ?
    ORDER BY t.rarity, t.id`
  ).bind(user.id).all();

  return c.json(titles.results);
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

  return c.json(metrics);
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

  return c.json(ranking.results.map((row) => { const { user_id, ...rest } = row as Record<string, unknown>; return rest; }));
});

// Friends endpoints
app.get("/api/users/search", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const query = c.req.query("q");
  if (!query || query.length < 3) {
    return c.json([]);
  }

  const users = await c.env.fitloot_db.prepare(
  `SELECT up.user_id, up.username, up.full_name, pr.level, pr.xp
    FROM user_profiles up
    INNER JOIN user_progression pr ON up.user_id = pr.user_id
    WHERE up.user_id != ? AND up.username LIKE ?
    LIMIT 20`
  ).bind(user.id, `%${query}%`).all();

  return c.json(users.results);
});

app.post("/api/friends/request", authMiddleware, zValidator("json", FriendRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const data = c.req.valid("json");

  // Check if friendship already exists
  const existing = await c.env.fitloot_db.prepare(
  `SELECT id FROM friendships 
    WHERE (user_id = ? AND friend_user_id = ?) 
    OR (user_id = ? AND friend_user_id = ?)`
  ).bind(user.id, data.friend_user_id, data.friend_user_id, user.id).first();

  if (existing) {
    return c.json({ error: "Friendship already exists" }, 400);
  }

  await c.env.fitloot_db.prepare(
    `INSERT INTO friendships (user_id, friend_user_id, status, updated_at)
    VALUES (?, ?, 'pending', datetime('now'))`
  ).bind(user.id, data.friend_user_id).run();

  return c.json({ success: true }, 201);
});

app.get("/api/friends/requests", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const requests = await c.env.fitloot_db.prepare(
    `SELECT f.id, f.user_id as friend_user_id, up.username as friend_username, 
    up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
    pr.current_streak as friend_streak
    FROM friendships f
    INNER JOIN user_profiles up ON f.user_id = up.user_id
    INNER JOIN user_progression pr ON f.user_id = pr.user_id
    WHERE f.friend_user_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC`
  ).bind(user.id).all();

  return c.json(requests.results);
});

app.post("/api/friends/:id/accept", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const requestId = parseInt(c.req.param("id"));

  await c.env.fitloot_db.prepare(
    `UPDATE friendships SET status = 'accepted', updated_at = datetime('now') 
    WHERE id = ? AND friend_user_id = ?`
  ).bind(requestId, user.id).run();

  return c.json({ success: true });
});

app.post("/api/friends/:id/reject", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const requestId = parseInt(c.req.param("id"));

  await c.env.fitloot_db.prepare(
    "DELETE FROM friendships WHERE id = ? AND friend_user_id = ?"
  ).bind(requestId, user.id).run();

  return c.json({ success: true });
});

app.get("/api/friends/list", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const friends = await c.env.fitloot_db.prepare(
    `SELECT f.id, f.friend_user_id, up.username as friend_username, 
    up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
    pr.current_streak as friend_streak
    FROM friendships f
    INNER JOIN user_profiles up ON f.friend_user_id = up.user_id
    INNER JOIN user_progression pr ON f.friend_user_id = pr.user_id
    WHERE f.user_id = ? AND f.status = 'accepted'
    
    UNION
    
    SELECT f.id, f.user_id as friend_user_id, up.username as friend_username,
    up.full_name as friend_full_name, pr.level as friend_level, pr.xp as friend_xp,
    pr.current_streak as friend_streak
    FROM friendships f
    INNER JOIN user_profiles up ON f.user_id = up.user_id
    INNER JOIN user_progression pr ON f.user_id = pr.user_id
    WHERE f.friend_user_id = ? AND f.status = 'accepted'
    
    ORDER BY friend_level DESC`
  ).bind(user.id, user.id).all();

  return c.json(friends.results);
});

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
  
  const gameId = parseInt(c.req.param("id"));

  await c.env.fitloot_db.prepare(
  `UPDATE mini_games SET status = 'active', updated_at = datetime('now')
    WHERE id = ? AND challenged_user_id = ? AND status = 'pending'`
  ).bind(gameId, user.id).run();

  return c.json({ success: true });
});

app.post("/api/mini-games/:id/complete", authMiddleware, zValidator("json", MiniGameCompleteRequestSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  const gameId = parseInt(c.req.param("id"));
  // Note: Request data validation ensures proper format, but current implementation doesn't use performance metrics
  c.req.valid("json");

  const game = await c.env.fitloot_db.prepare(
    "SELECT * FROM mini_games WHERE id = ? AND status = 'active'"
  ).bind(gameId).first();

  if (!game) {
    return c.json({ error: "Game not found" }, 404);
  }

  // Simplified implementation - in production would compare both players' performance
  const isChallenger = game.challenger_user_id === user.id;

  // Determine winner (simplified - just based on who completed more reps faster)
  // In real implementation, would wait for both players and compare
  const winnerUserId = user.id;
  const loserUserId = isChallenger ? game.challenged_user_id : game.challenger_user_id;

  // Award XP and points
  const winnerXp = Number(game.xp_reward || 0);
  const winnerPoints = Number(game.points_reward || 0);
  const loserXp = Math.floor(winnerXp / 2);
  const loserPoints = Math.floor(winnerPoints / 2);

  await c.env.fitloot_db.prepare(
  `UPDATE user_progression SET xp = xp + ?, points = points + ?, updated_at = datetime('now')
    WHERE user_id = ?`
  ).bind(winnerXp, winnerPoints, winnerUserId).run();

  await c.env.fitloot_db.prepare(
  `UPDATE user_progression SET xp = xp + ?, points = points + ?, updated_at = datetime('now')
    WHERE user_id = ?`
  ).bind(loserXp, loserPoints, loserUserId).run();

  // Update game status
  await c.env.fitloot_db.prepare(
  `UPDATE mini_games SET status = 'completed', winner_user_id = ?, updated_at = datetime('now')
    WHERE id = ?`
  ).bind(winnerUserId, gameId).run();

  return c.json({ 
    success: true, 
    winner: winnerUserId,
    xp_gained: winnerXp,
    points_gained: winnerPoints
  });
});

type MissionPeriod = "daily" | "weekly" | "monthly";

function futureIsoForPeriod(period: MissionPeriod) {
  const now = Date.now();
  const durations: Record<MissionPeriod, number> = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  };

  return new Date(now + durations[period]).toISOString();
}

async function fetchExerciseDbExercises(env: Env, muscle: string, equipment: string): Promise<ExerciseRef[]> {
  if (!env.EXERCISE_DB_KEY) throw new Error("exercise-db-key-missing");
  const data = await fetchJsonWithTimeout<Array<Record<string, unknown>>>(
    `https://exercisedb.p.rapidapi.com/exercises/target/${encodeURIComponent(muscle)}?limit=8`,
    {
      headers: {
        "X-RapidAPI-Key": env.EXERCISE_DB_KEY,
        "X-RapidAPI-Host": "exercisedb.p.rapidapi.com",
      },
    },
    8000
  );
  return data.map((item) => ({
    name: String(item.name ?? "Exercício"),
    muscle: String(item.target ?? muscle),
    equipment: String(item.equipment ?? equipment || "bodyweight"),
    difficulty: "intermediate",
    instructions: Array.isArray(item.instructions) ? String(item.instructions[0] ?? "") : "",
  }));
}

async function fetchApiNinjasExercises(env: Env, muscle: string): Promise<ExerciseRef[]> {
  if (!env.API_NINJAS_KEY) throw new Error("api-ninjas-key-missing");
  const data = await fetchJsonWithTimeout<Array<Record<string, unknown>>>(
    `https://api.api-ninjas.com/v1/exercises?muscle=${encodeURIComponent(muscle)}`,
    {
      headers: {
        "X-Api-Key": env.API_NINJAS_KEY,
      },
    },
    8000
  );
  return data.slice(0, 8).map((item) => ({
    name: String(item.name ?? "Exercício"),
    muscle: String(item.muscle ?? muscle),
    equipment: String(item.equipment ?? "bodyweight"),
    difficulty: String(item.difficulty ?? "beginner"),
    instructions: String(item.instructions ?? ""),
  }));
}

async function fetchGymFitExercises(env: Env, muscle: string): Promise<ExerciseRef[]> {
  if (!env.GYMFIT_API_KEY) throw new Error("gymfit-key-missing");
  const data = await fetchJsonWithTimeout<{ exercises?: Array<Record<string, unknown>> }>(
    `https://gym-fit.p.rapidapi.com/exercises?muscle=${encodeURIComponent(muscle)}`,
    {
      headers: {
        "X-RapidAPI-Key": env.GYMFIT_API_KEY,
        "X-RapidAPI-Host": "gym-fit.p.rapidapi.com",
      },
    },
    8000
  );
  return (data.exercises ?? []).slice(0, 8).map((item) => ({
    name: String(item.name ?? "Exercício"),
    muscle: String(item.muscle ?? muscle),
    equipment: String(item.equipment ?? "bodyweight"),
    difficulty: String(item.level ?? "beginner"),
    instructions: String(item.instructions ?? ""),
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

function missionConfigByPeriod(period: MissionPeriod) {
  if (period === "weekly") {
    return {
      amount: 2,
      reps: 120,
      xp: 180,
      points: 55,
      titlePrefix: "Missão Semanal",
    };
  }

  if (period === "monthly") {
    return {
      amount: 1,
      reps: 450,
      xp: 480,
      points: 150,
      titlePrefix: "Missão Mensal",
    };
  }

  return {
    amount: 3,
    reps: 20,
    xp: 50,
    points: 10,
    titlePrefix: "Missão Diária",
  };
}

async function createMissionsForPeriod(env: Env, db: D1Database, userId: string, period: MissionPeriod) {
  const userSkills = await db.prepare(
    "SELECT us.skill_id, us.current_stage, s.name, s.category, s.tier FROM user_skills us INNER JOIN skills s ON s.id = us.skill_id WHERE us.user_id = ? AND COALESCE(us.status,'unlocked') != 'locked'"
  ).bind(userId).all<{ skill_id: number; current_stage: number; name: string; category: string; tier: string }>();

  const config = missionConfigByPeriod(period);
  const deadline = futureIsoForPeriod(period);

  if (userSkills.results.length === 0) {
    console.warn(`[missions] usuário ${userId} sem skills para gerar ${period}`);
    const fallback = ["Mobilidade de quadril", "Caminhada leve", "Alongamento de coluna"].slice(0, config.amount);
    for (const label of fallback) {
      await db.prepare(`INSERT INTO missions (user_id, type, title, description, target_reps, xp_reward, points_reward, deadline, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
        .bind(userId, period, `${config.titlePrefix}: ${label}`, `Missão de fallback para manter consistência: ${label}.`, config.reps, config.xp, config.points, deadline)
        .run();
    }
    return;
  }

  const planRow = await db.prepare("SELECT weekly_plan_json, equipment FROM user_training_plans WHERE user_id = ?").bind(userId).first<{ weekly_plan_json: string; equipment: string }>();
  const weekday = getWeekdayPtBr();
  const parsedPlan = planRow?.weekly_plan_json ? JSON.parse(planRow.weekly_plan_json) as Record<string, unknown> : {};
  const dayPlan = (parsedPlan.weekly as Record<string, { focus?: string; muscles?: string[] }> | undefined)?.[weekday];
  const dayFocus = dayPlan?.focus ?? "full body";
  const muscles = dayPlan?.muscles ?? ["full body"];
  const isRestDay = dayFocus === "rest";

  const muscle = isRestDay ? "mobility" : String(muscles[0] ?? "full body");
  const exerciseResult = await resolveExercisesWithFallback(env, muscle, planRow?.equipment ?? "bodyweight");

  const plannedCount = Math.max(1, Math.ceil(config.amount * 0.7));
  const variationCount = Math.max(0, config.amount - plannedCount);

  const planned = exerciseResult.exercises.slice(0, plannedCount);
  const randomSkills = [...userSkills.results].sort(() => Math.random() - 0.5).slice(0, Math.max(variationCount, 1));

  for (const ex of planned) {
    await db.prepare(`INSERT INTO missions (user_id, type, title, description, target_reps, xp_reward, points_reward, deadline, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .bind(
        userId,
        period,
        `${config.titlePrefix}: ${ex.name}`,
        isRestDay
          ? `Dia de recuperação: execute ${ex.name} com foco em mobilidade e técnica.`
          : `Treino do dia (${muscle}) usando ${exerciseResult.source}: ${ex.name}.`,
        isRestDay ? Math.max(8, Math.floor(config.reps * 0.4)) : config.reps,
        isRestDay ? Math.floor(config.xp * 0.6) : config.xp,
        isRestDay ? Math.floor(config.points * 0.6) : config.points,
        deadline
      ).run();
  }

  for (const skill of randomSkills.slice(0, variationCount)) {
    await db.prepare(`INSERT INTO missions (user_id, type, title, description, skill_id, target_reps, xp_reward, points_reward, deadline, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .bind(
        userId,
        period,
        `${config.titlePrefix}: ${skill.name}`,
        `Variação inteligente (30%): complemente com ${skill.name}, respeitando seu plano principal.`,
        skill.skill_id,
        config.reps,
        config.xp,
        config.points,
        deadline
      ).run();
  }
}

async function ensurePeriodicMissions(env: Env, db: D1Database, userId: string) {
  const periods: MissionPeriod[] = ["daily", "weekly", "monthly"];

  for (const period of periods) {
    const existing = await db.prepare(
      `SELECT COUNT(*) as count FROM missions
       WHERE user_id = ? AND type = ? AND is_completed = 0
       AND (deadline IS NULL OR deadline > datetime('now'))`
    ).bind(userId, period).first<{ count: number }>();

    if (Number(existing?.count ?? 0) === 0) {
      await createMissionsForPeriod(env, db, userId, period);
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
    throw new ApiIntegrationError("RATE_LIMITED", 429, "Muitas requisições externas. Tente novamente em instantes.");
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
      error: "Serviço temporariamente indisponível. Tente novamente em alguns instantes.",
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
      throw new ApiIntegrationError("AUTH_FAILED", 502, "Falha de autenticação com serviço externo.");
    }
    if (!response.ok) {
      throw new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar serviço externo.");
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiIntegrationError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new ApiIntegrationError("TIMEOUT", 504, "Tempo de resposta excedido em serviço externo.");
    }
    throw new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar serviço externo.");
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
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "Hugging Face não configurada.");
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
    description?: string;
    foodNutrients?: Array<{ nutrientName?: string; value?: number }>;
  }>;
};

type RapidApiNutritionResponse = Array<{
  name?: string;
  calories?: number;
  protein_g?: number;
  carbohydrates_total_g?: number;
  fat_total_g?: number;
}>;

async function searchFoodOnUSDA(c: import("hono").Context<AppContext>, query: string) {
  if (!c.env.USDA_API_KEY) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "USDA não configurada.");
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
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "RapidAPI não configurada.");
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

  const normalize = (value?: string) => (value ? Number(value.replace(",", ".")) : null);
  const kcal = normalize(safeGet(text.match(/(\d+[\.,]?\d*)\s*kcal/i) ?? [], 1));
  const kJ = normalize(safeGet(text.match(/(\d+[\.,]?\d*)\s*kj/i) ?? [], 1));
  const protein = normalize(safeGet(text.match(/prote[ií]n[aa]s?[^\d]*(\d+[\.,]?\d*)\s*g/i) ?? [], 1));
  const carbs = normalize(safeGet(text.match(/carboidratos?[^\d]*(\d+[\.,]?\d*)\s*g/i) ?? [], 1));
  const fats = normalize(safeGet(text.match(/gorduras?(?:\s+totais?)?[^\d]*(\d+[\.,]?\d*)\s*g/i) ?? [], 1));

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

type ConditioningLevel = "sedentario" | "iniciante" | "intermediario" | "avancado";

type MissionDraft = {
  title: string;
  description: string;
  skill_name: string;
  target_reps: number;
  xp_reward: number;
  points_reward: number;
  difficulty: string;
  type?: string;
  skill?: string;
};

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function normalizeConditioning(value: unknown): ConditioningLevel {
  if (value === "sedentario" || value === "iniciante" || value === "intermediario" || value === "avancado") {
    return value;
  }
  return "iniciante";
}

// Fallback generator para missões baseadas em condicionamento
async function generateFallbackMissions(
  conditioning: ConditioningLevel = "iniciante",
  skills: Array<{ name: string }> = []
): Promise<MissionDraft[]> {
  const volumeMap: Record<ConditioningLevel, number> = {
    sedentario: 10,
    iniciante: 20,
    intermediario: 30,
    avancado: 50,
  };
  const xpMap: Record<ConditioningLevel, number> = {
    sedentario: 20,
    iniciante: 40,
    intermediario: 60,
    avancado: 100,
  };
  const pointsMap: Record<ConditioningLevel, number> = {
    sedentario: 5,
    iniciante: 10,
    intermediario: 15,
    avancado: 25,
  };
  const diffMap: Record<ConditioningLevel, string> = {
    sedentario: "easy",
    iniciante: "easy",
    intermediario: "medium",
    avancado: "hard",
  };

  const fallbackSkills = skills.length > 0
    ? skills
    : [{ name: "Flexão" }, { name: "Agachamento" }, { name: "Prancha" }];

  return fallbackSkills.slice(0, 3).map((skill) => ({
    title: `Missão ${skill.name}`,
    description: `Complete ${volumeMap[conditioning]} repetições de ${skill.name}`,
    skill_name: skill.name,
    target_reps: volumeMap[conditioning],
    xp_reward: xpMap[conditioning],
    points_reward: pointsMap[conditioning],
    difficulty: diffMap[conditioning],
    type: "diaria",
  }));
}

// 1. Generate personalized missions using AI (70/30 com fallback robusto)
app.post("/api/ai/generate-missions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const requestBody = await c.req.json().catch(() => ({})) as { conditioning?: unknown };

  const [profile, skills] = await Promise.all([
    c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
    c.env.fitloot_db.prepare(`
      SELECT s.* FROM skills s
      INNER JOIN user_skills us ON s.id = us.skill_id
      WHERE us.user_id = ?
    `).bind(user.id).all(),
  ]);

  const conditioning = normalizeConditioning(requestBody.conditioning ?? profile?.initial_conditioning);
  const skillRows = skills.results as Array<{ id: number; name: string }>;

  const baseMissions = await generateFallbackMissions(conditioning, skillRows);

  let aiMissions: MissionDraft[] = [];
  let fallback = false;
  let error: string | null = null;

  try {
    const openaiData = await callOpenAIChat(c, [{
      role: "user",
      content: `Gere duas missões fitness para o perfil abaixo e responda JSON com a chave missions (array).
Condicionamento: ${conditioning}
Objetivo: ${profile?.main_goal}
Lesões: ${profile?.injuries || "nenhuma"}
Equipamentos: ${profile?.equipment || "nenhum"}`,
    }], 800, true);

    const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { missions?: MissionDraft[] };
    aiMissions = parsed.missions ?? [];
  } catch (err) {
    error = "Falha na IA";
    fallback = true;
    console.error("[generate-missions]", err);
  }

  const totalMissions = [...baseMissions.slice(0, 3), ...aiMissions.slice(0, 2)];

  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  for (const mission of totalMissions) {
    const missionSkillName = (mission.skill_name || mission.skill || "").trim().toLowerCase();
    const skill = missionSkillName
      ? skillRows.find((s) => s.name.toLowerCase().includes(missionSkillName))
      : null;

    await c.env.fitloot_db.prepare(
      `INSERT INTO missions (user_id, type, title, description, skill_id, target_reps, xp_reward, points_reward, deadline, updated_at)
        VALUES (?, 'daily', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      user.id,
      mission.title,
      mission.description,
      skill?.id || null,
      mission.target_reps,
      mission.xp_reward,
      mission.points_reward,
      tomorrow
    ).run();
  }

  return c.json({ success: true, missions: totalMissions, fallback, error });
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
    const { message: userMessage, history: conversationHistory = [], mode = "suporte" } = parsed.data;

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
    await onChatMessage(c.env.fitloot_db, user.id, Number(currentCounter?.chat_messages ?? 0) + 1);

    const [profile, progression, attributes] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(user.id).first(),
    ]);

    const systemPrompt = `Você é o assistente oficial do app FitBot.
Sua função é responder de forma útil, natural, objetiva e agradável, ajudando o usuário com treino, evolução física, hábitos, alimentação e uso do app.

REGRAS DE COMPORTAMENTO

1. TOM DE VOZ
- Fale de forma humana, natural, clara e amigável.
- Seja acolhedor, mas sem exagero.
- Evite linguagem robótica.
- Evite parecer um coach caricato ou motivacional demais.
- Evite excesso de entusiasmo, emojis e frases decoradas.

2. OBJETIVIDADE
- Responda exatamente o que o usuário pediu.
- Não acrescente explicações longas sem necessidade.
- Não desvie do assunto.
- Não invente contexto extra.
- Se a pergunta for simples, responda de forma simples.

3. PERSONALIZAÇÃO
- Personalize a resposta quando isso realmente agregar valor.
- Use o nome do usuário com moderação.
- Nunca repita o nome do usuário em toda mensagem.
- Só use o nome em momentos específicos: primeira saudação, incentivo pontual, contexto em que a personalização melhora a experiência.
- Na maior parte do tempo, responda sem citar o nome.

4. ESTILO DE RESPOSTA
- Prefira respostas curtas ou médias.
- Só faça respostas longas quando o usuário pedir detalhes.
- Evite introduções desnecessárias.
- Vá direto ao ponto.
- Organize a resposta com clareza.
- Quando útil, divida em etapas simples.

5. PROIBIÇÕES DE ESTILO
- Não use frases como "Estou aqui pronto para ajudar você a evoluir", "Vamos nessa rumo ao seu objetivo", "bora ganhar XP", "estou aqui para te acompanhar nessa jornada".
- Não transforme toda resposta em mensagem motivacional.
- Não tente ser engraçado o tempo todo.
- Não use o nome do usuário repetidamente.
- Não enfeite respostas com texto desnecessário.

6. QUANDO O USUÁRIO MANDAR MENSAGEM CONFUSA
- Peça esclarecimento de forma curta e natural.
- Tom: "Não entendi muito bem. Me explica de outro jeito?" ou "Pode reformular? Quero te responder certo."
- Não faça textos longos para dizer que não entendeu.

7. QUANDO O USUÁRIO FIZER PERGUNTA DIRETA
- Responda diretamente, sem introdução.

8. QUANDO O USUÁRIO PEDIR AJUDA PRÁTICA
- Entregue ação concreta: treino, ajuste de rotina, sugestão alimentar, explicação objetiva.
- Menos fala inspiracional, mais utilidade.

9. QUANDO NÃO SOUBER OU FALTAR CONTEXTO
- Admita de forma simples e peça apenas a informação necessária.
- Não invente.

10. FORMATO IDEAL
- Pergunta simples → resposta curta
- Pergunta prática → resposta objetiva com passos
- Pergunta complexa → resposta clara, sem enrolação
- Dúvida emocional → resposta acolhedora, mas sóbria

11. REGRA FINAL
Antes de responder, avalie: Estou respondendo exatamente o que foi pedido? Estou sendo mais longo do que preciso? Estou usando o nome sem necessidade? Estou parecendo natural ou teatral? Se estiver teatral ou motivacional demais, simplifique.

INSTRUÇÕES EXTRAS DE ESTILO
- Não use mais de 1 emoji por resposta, e apenas quando combinar naturalmente.
- Responda primeiro, explique depois se necessário.
- Se a pergunta for curta, a resposta também deve ser curta.
- Se o usuário estiver irritado ou impaciente, seja ainda mais direto.
- NUNCA use markdown na resposta. Não use **, *, |, #, ---, tabelas ou qualquer símbolo de formatação. Escreva em texto puro e natural.

Contexto do usuário:
- Nome: ${profile?.full_name}
- Nível: ${progression?.level}
- XP: ${progression?.xp}
- Streak: ${progression?.current_streak} dias
- Objetivo: ${profile?.main_goal}
- Condicionamento: ${profile?.initial_conditioning}
- Força: ${attributes?.strength}
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

    const prompt = `Analise este perfil fitness gamificado e gere recomendações personalizadas em JSON.
Nível: ${progression?.level}
XP: ${progression?.xp}
Missões completas: ${completedMissions?.count}
Streak: ${progression?.current_streak}
Objetivo: ${profile?.main_goal}
Atributos: força ${attributes?.strength}, constituição ${attributes?.constitution}, vitalidade ${attributes?.vitality}, destreza ${attributes?.dexterity}, foco ${attributes?.focus}
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

    const prompt = `Sugira treino em JSON com workout_type, duration_minutes, intensity, exercises e motivation. Contexto: nível ${progression?.level}, objetivo ${profile?.main_goal}, passos ${metrics?.steps || 0}, calorias ${metrics?.calories_burned || 0}.`;

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
  portion_description?: string;
  portion_multiplier?: number;
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
      const identifyPrompt = `Analise a refeição e responda APENAS em JSON no formato {"items":[{"food_name":"","portion_description":"","portion_multiplier":1}]}.
Contexto textual: ${food_description || "não informado"}
Texto OCR do rótulo: ${ocr_text || "não identificado"}.`;
      const aiData = await callOpenAIChat(c, [{ role: "user", content: identifyPrompt }], 700, true);
      const aiContent = safeGet(aiData.choices ?? [], 0)?.message?.content ?? "{}";
      const identified = JSON.parse(aiContent) as {
        items?: Array<{ food_name?: string; portion_description?: string; portion_multiplier?: number }>;
      };
      items = (identified.items ?? []).filter(isIdentifiedFoodItem);
    }

    const ocrNutrition = parseNutritionFromOcrLabel(ocr_text ?? "");

    if (items.length === 0 && !ocrNutrition) {
      throw new ApiIntegrationError("INVALID_RESPONSE", 422, "Não foi possível identificar alimentos na imagem. Tente novamente com outra foto.");
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
      warning?: string;
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
          portion_description: item.portion_description || "porção estimada",
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
            portion_description: item.portion_description || "porção estimada",
            calories: Number.isFinite(rapidCalories) ? Math.round(rapidCalories * multiplier) : null,
            energy_kj: Number.isFinite(rapidCalories) ? Math.round(rapidCalories * 4.184 * multiplier) : null,
            protein: Number.isFinite(rapidProtein) ? Number((rapidProtein * multiplier).toFixed(1)) : null,
            carbs: Number.isFinite(rapidCarbs) ? Number((rapidCarbs * multiplier).toFixed(1)) : null,
            fats: Number.isFinite(rapidFats) ? Number((rapidFats * multiplier).toFixed(1)) : null,
            source: "rapidapi",
            warning: "Alimento não encontrado no USDA. Valores retornados pela RapidAPI.",
          });
        } catch (rapidError) {
          console.warn(`[analyze-food][rapidapi-fallback] ${query}`, rapidError);
          const estimatePrompt = `Estime APENAS JSON com calories, protein, carbs, fats para ${query} (${item.portion_description || "porção média"}).`;
          const fallbackData = await callOpenAIChat(c, [{ role: "user", content: estimatePrompt }], 350, true);
          const estimate = JSON.parse(safeGet(fallbackData.choices ?? [], 0)?.message?.content ?? "{}") as {
            calories?: number;
            protein?: number;
            carbs?: number;
            fats?: number;
          };

          analyzedItems.push({
            food_name: query,
            portion_description: item.portion_description || "porção estimada",
            calories: estimate.calories ?? null,
            energy_kj: estimate.calories ? Math.round(estimate.calories * 4.184) : null,
            protein: estimate.protein ?? null,
            carbs: estimate.carbs ?? null,
            fats: estimate.fats ?? null,
            source: "estimate",
            warning: "Alimento não encontrado no USDA/RapidAPI. Valores estimados por IA.",
          });
        }
      }
    }

    if (ocrNutrition) {
      analyzedItems.push({
        food_name: "Rótulo identificado",
        portion_description: "dados extraídos do rótulo",
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
        ? "Alguns alimentos não foram encontrados no USDA/RapidAPI e foram estimados por IA."
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
// SPA fallback (APENAS após todas as rotas /api/* definidas)
// -----------------------------
app.get("*", async (c, next) => {
  // Se for rota API, passa adiante para as rotas definidas
  if (c.req.path.startsWith("/api")) {
    return next();
  }

  try {
    // c.req é um Request válido para passar ao binding ASSETS
    return await c.env.ASSETS.fetch(c.req.raw);
  } catch (err) {
    // se falhar, passa para próximos handlers (ou 404)
    return next();
  }
});


export default app;
