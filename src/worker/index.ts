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
const SCHEMA_CACHE_TTL_MS = 10_000;

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

// Middleware de autenticação próprio
async function authMiddleware(
  c: import("hono").Context<{ Bindings: Env; Variables: { user: AuthUser } }>,
  next: () => Promise<void>
) {
  const schemaReady = await hasCoreSchema(c.env.fitloot_db);
  if (!schemaReady) {
    return databaseNotInitializedResponse(c);
  }

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
  OPENAI_API_KEY: string;
  USDA_API_KEY: string;
  GOOGLE_CLOUD_VISION_KEY: string;
  ANTHROPIC_API_KEY?: string;
}
// --------------------------------


const app = new Hono<AppContext>();


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

  // Unlock basic skills
  const basicSkills = await c.env.fitloot_db.prepare(
    "SELECT id FROM skills WHERE required_level = 1"
  ).all();

  for (const skill of basicSkills.results) {
    await c.env.fitloot_db.prepare(
      `INSERT INTO user_skills (user_id, skill_id, total_reps, total_time, best_reps, updated_at)
      VALUES (?, ?, 0, 0, 0, datetime('now'))`
    ).bind(user.id, skill.id).run();
  }

  // Create initial daily missions
  await ensurePeriodicMissions(c.env.fitloot_db, user.id);

  return c.json({ success: true }, 201);
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
  `SELECT s.*, us.total_reps, us.total_time, us.best_reps, us.unlocked_at
    FROM skills s
    INNER JOIN user_skills us ON s.id = us.skill_id
    WHERE us.user_id = ?
    ORDER BY s.required_level, s.id`
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
    WHERE s.required_level <= ?
    AND s.id NOT IN (SELECT skill_id FROM user_skills WHERE user_id = ?)
    ORDER BY s.required_level, s.id`
  ).bind(progression?.level || 1, user.id).all();

  return c.json(availableSkills.results);
});

// Missions endpoints
app.get("/api/missions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  
  await ensurePeriodicMissions(c.env.fitloot_db, user.id);

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
  `SELECT a.*, ua.unlocked_at, 
    CASE WHEN ua.id IS NOT NULL THEN 1 ELSE 0 END as unlocked
    FROM achievements a
    LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?
    ORDER BY a.rarity, a.id`
  ).bind(user.id).all();

  return c.json(achievements.results);
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
    "UPDATE user_titles SET is_active = 0 WHERE user_id = ?"
  ).bind(user.id).run();

  // Activate selected title
  await c.env.fitloot_db.prepare(
    "UPDATE user_titles SET is_active = 1, updated_at = datetime('now') WHERE user_id = ? AND title_id = ?"
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
  const ranking = await c.env.fitloot_db.prepare(
    `SELECT up.username, up.full_name, pr.level, pr.xp, pr.current_streak, pr.points
    FROM user_profiles up
    INNER JOIN user_progression pr ON up.user_id = pr.user_id
    ORDER BY pr.level DESC, pr.xp DESC
    LIMIT 100`
  ).all();

  return c.json(ranking.results);
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

async function createMissionsForPeriod(db: D1Database, userId: string, period: MissionPeriod) {
  const userSkills = await db.prepare(
    "SELECT skill_id FROM user_skills WHERE user_id = ?"
  ).bind(userId).all<{ skill_id: number }>();

  if (userSkills.results.length === 0) {
    console.warn(`[missions] usuário ${userId} sem skills para gerar ${period}`);
    return;
  }

  const config = missionConfigByPeriod(period);
  const skillIds = userSkills.results.map((skill) => Number(skill.skill_id));
  const randomized = [...skillIds].sort(() => 0.5 - Math.random()).slice(0, config.amount);
  const deadline = futureIsoForPeriod(period);

  for (const skillId of randomized) {
    const skill = await db.prepare("SELECT id, name FROM skills WHERE id = ?").bind(skillId).first<{ id: number; name: string }>();
    if (!skill) continue;

    await db.prepare(
      `INSERT INTO missions (user_id, type, title, description, skill_id, target_reps, xp_reward, points_reward, deadline, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      userId,
      period,
      `${config.titlePrefix}: ${skill.name}`,
      `Execute ${config.reps} repetições de ${skill.name} até o prazo da missão.`,
      skill.id,
      config.reps,
      config.xp,
      config.points,
      deadline
    ).run();
  }
}

async function ensurePeriodicMissions(db: D1Database, userId: string) {
  const periods: MissionPeriod[] = ["daily", "weekly", "monthly"];

  for (const period of periods) {
    const existing = await db.prepare(
      `SELECT COUNT(*) as count FROM missions
       WHERE user_id = ? AND type = ? AND is_completed = 0
       AND (deadline IS NULL OR deadline > datetime('now'))`
    ).bind(userId, period).first<{ count: number }>();

    if (Number(existing?.count ?? 0) === 0) {
      await createMissionsForPeriod(db, userId, period);
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
  openai: 12000,
  usda: 8000,
  vision: 8000,
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
  if (!c.env.OPENAI_API_KEY) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "OpenAI não configurada.");
  }
  enforceRateLimit(`openai:${c.get("user")?.id ?? "anon"}`);
  return fetchJsonWithTimeout<OpenAIChatCompletionResponse>(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${c.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    },
    timeoutMsByService.openai
  );
}

type USDAResponse = {
  foods?: Array<{
    description?: string;
    foodNutrients?: Array<{ nutrientName?: string; value?: number }>;
  }>;
};

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

type VisionResponse = {
  responses?: Array<{
    fullTextAnnotation?: { text?: string };
  }>;
};

async function extractLabelTextWithVision(c: import("hono").Context<AppContext>, imageBase64: string) {
  if (!c.env.GOOGLE_CLOUD_VISION_KEY) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "Google Vision não configurada.");
  }
  enforceRateLimit(`vision:${c.get("user")?.id ?? "anon"}`);
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${c.env.GOOGLE_CLOUD_VISION_KEY}`;
  const body = {
    requests: [{
      image: { content: imageBase64 },
      features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
    }],
  };
  const data = await fetchJsonWithTimeout<VisionResponse>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMsByService.vision);
  return safeGet(data.responses ?? [], 0)?.fullTextAnnotation?.text ?? "";
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

  return skills.slice(0, 3).map((skill) => ({
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

  const [profile, skills] = await Promise.all([
    c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
    c.env.fitloot_db.prepare(`
      SELECT s.* FROM skills s
      INNER JOIN user_skills us ON s.id = us.skill_id
      WHERE us.user_id = ?
    `).bind(user.id).all(),
  ]);

  const conditioning = normalizeConditioning(profile?.initial_conditioning);
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

    const [profile, progression, attributes] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(user.id).first(),
    ]);

    const systemPrompt = `Você é o FitBot, um assistente fitness virtual motivador e especializado em gamificação. 

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

// 5. Food analysis pipeline (OpenAI Vision + OCR + USDA + fallback)
app.post("/api/ai/analyze-food", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const raw = await c.req.json();
    const parsed = AiAnalyzeFoodRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
    }

    const { food_description, image_base64 } = parsed.data;
    let visionText = "";
    if (image_base64) {
      visionText = await extractLabelTextWithVision(c, image_base64);
    }

    const identifyPrompt = `Analise a refeição e responda APENAS em JSON no formato {"items":[{"food_name":"","portion_description":"","portion_multiplier":1}]}.
Contexto textual: ${food_description || "não informado"}
Texto OCR do rótulo: ${visionText || "não identificado"}.`;
    const aiData = await callOpenAIChat(c, [{ role: "user", content: identifyPrompt }], 700, true);
    const aiContent = safeGet(aiData.choices ?? [], 0)?.message?.content ?? "{}";
    const identified = JSON.parse(aiContent) as {
      items?: Array<{ food_name?: string; portion_description?: string; portion_multiplier?: number }>;
    };

    const ocrNutrition = parseNutritionFromOcrLabel(visionText);
    const items = (identified.items ?? []).filter((item) => item.food_name && item.food_name.trim().length > 0);

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
      source: "usda" | "estimate" | "ocr_label";
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
          warning: "Alimento não encontrado no USDA. Valores estimados por IA.",
        });
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
      ocr_text: visionText || undefined,
      items: analyzedItems,
      totals: {
        calories: Math.round(totals.calories),
        energy_kj: Math.round(totals.energy_kj),
        protein: Number(totals.protein.toFixed(1)),
        carbs: Number(totals.carbs.toFixed(1)),
        fats: Number(totals.fats.toFixed(1)),
        macro_percentages: percentages,
      },
      has_estimates: analyzedItems.some((item) => item.source === "estimate"),
      estimation_warning: analyzedItems.some((item) => item.source === "estimate")
        ? "Alguns alimentos não foram encontrados no USDA e foram estimados por IA."
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
    hasOpenAI: Boolean(c.env.OPENAI_API_KEY),
    hasUSDA: Boolean(c.env.USDA_API_KEY),
    hasVision: Boolean(c.env.GOOGLE_CLOUD_VISION_KEY),
    hasDB: Boolean(c.env.fitloot_db),
    hasCoreSchema: schemaReady,
    environment,
  });
});

// 6. Healthchecks for external services
app.get("/api/health/external", authMiddleware, async (c) => {
  return c.json({
    openai: Boolean(c.env.OPENAI_API_KEY),
    usda: Boolean(c.env.USDA_API_KEY),
    google_vision: Boolean(c.env.GOOGLE_CLOUD_VISION_KEY),
    anthropic: Boolean(c.env.ANTHROPIC_API_KEY),
  });
});

app.get("/api/health/openai", authMiddleware, async (c) => c.json({ ok: Boolean(c.env.OPENAI_API_KEY) }));
app.get("/api/health/usda", authMiddleware, async (c) => c.json({ ok: Boolean(c.env.USDA_API_KEY) }));
app.get("/api/health/vision", authMiddleware, async (c) => c.json({ ok: Boolean(c.env.GOOGLE_CLOUD_VISION_KEY) }));

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
