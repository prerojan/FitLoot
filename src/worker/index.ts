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
  AuthRegisterRequestSchema,
  LoginRequestSchema,
  UserPlanRequestSchema,
  UpdateMeRequestSchema,
} from "../shared/types";



// Tipos para a API do Claude
interface ClaudeResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

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

// Middleware de autenticação próprio
async function authMiddleware(
  c: import("hono").Context<{ Bindings: Env; Variables: { user: AuthUser } }>,
  next: () => Promise<void>
) {
  const sessionId = c.req.header('Cookie')?.match(/session_id=([^;]+)/)?.[1];

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
  const sessionId = c.req.header("Cookie")?.match(/session_id=([^;]+)/)?.[1];

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
  await createDailyMissions(c.env.fitloot_db, user.id);

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
  
  const missions = await c.env.fitloot_db.prepare(
    `SELECT m.*, s.name as skill_name FROM missions m
    LEFT JOIN skills s ON m.skill_id = s.id
    WHERE m.user_id = ? AND m.is_completed = 0
    ORDER BY m.type, m.created_at`
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

  const today = new Date().toISOString().split('T')[0];
  let streakMultiplier = 1;
  
  if (progression?.last_activity_date !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
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
  
  const today = new Date().toISOString().split('T')[0];
  
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
  const today = new Date().toISOString().split('T')[0];

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
  
  const today = new Date().toISOString().split('T')[0];

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

// Helper function to create daily missions
async function createDailyMissions(db: D1Database, userId: string) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString();

  // Get user's unlocked skills
  const userSkills = await db.prepare(
    "SELECT skill_id FROM user_skills WHERE user_id = ?"
  ).bind(userId).all();

  if (userSkills.results.length === 0) return;

  // Create 3 daily missions
  const skillIds = userSkills.results.map(s => s.skill_id);
  const randomSkills = skillIds.sort(() => 0.5 - Math.random()).slice(0, 3);

  for (const skillId of randomSkills) {
    const skill = await db.prepare(
      "SELECT * FROM skills WHERE id = ?"
    ).bind(skillId).first();

    if (skill) {
      await db.prepare(
      `INSERT INTO missions (user_id, type, title, description, skill_id, target_reps, xp_reward, points_reward, deadline, updated_at)
        VALUES (?, 'daily', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        userId,
        'daily',
        `Complete ${20} ${skill.name}`,
        `Execute ${20} repetições de ${skill.name}`,
        skillId,
        20,
        50,
        10,
        tomorrow
      ).run();
    }
  }
}

// AI-powered endpoints

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

  const conditioning = (profile?.initial_conditioning ?? "iniciante") as ConditioningLevel;
  const skillRows = skills.results as Array<{ id: number; name: string }>;

  const baseMissions = await generateFallbackMissions(conditioning, skillRows);

  let aiMissions: MissionDraft[] = [];
  let fallback = false;
  let error: string | null = null;

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${c.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: `Gere 2 missões fitness desafiadoras e alcançáveis para um usuário com condicionamento ${conditioning}, objetivo ${profile?.main_goal}, lesões: ${profile?.injuries || "nenhuma"}, equipamentos: ${profile?.equipment || "nenhum"}. Responda em JSON estruturado.` }],
        max_tokens: 800,
      }),
    });

    if (!openaiRes.ok) {
      throw new Error("OpenAI indisponível");
    }

    const openaiData = (await openaiRes.json()) as OpenAIChatCompletionResponse;
    const content = openaiData.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { missions?: MissionDraft[] };
      aiMissions = parsed.missions ?? [];
    }
  } catch (_err) {
    error = "Falha na IA";
    fallback = true;
  }

  const totalMissions = [...baseMissions.slice(0, 3), ...aiMissions.slice(0, 2)];

  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  for (const mission of totalMissions) {
    const missionSkillName = (mission.skill_name || mission.skill || "").toLowerCase();
    const skill = skillRows.find((s) => s.name.toLowerCase().includes(missionSkillName));

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

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${c.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationHistory.map((msg) => ({ role: msg.role, content: msg.content })),
          { role: "user", content: userMessage },
        ],
        max_tokens: 1000,
      }),
    });

    if (!openaiRes.ok) throw new Error("AI API error");

    const openaiData = (await openaiRes.json()) as OpenAIChatCompletionResponse;
    const content = openaiData.choices?.[0]?.message?.content ?? "";
    return c.json({ message: content });
  } catch (error) {
    console.error("AI chat error:", error);
    return c.json({ message: "Desculpe, tive um problema ao processar sua mensagem. Tente novamente!", error: "IA indisponível", fallback: true });
  }
});

// 3. AI Recommendations Engine
app.get("/api/ai/recommendations", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "AI not configured" }, 503);

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

    const prompt = `Analise este perfil fitness gamificado e gere recomendações personalizadas.

DADOS DO USUÁRIO:
Nível: ${progression?.level}
XP Total: ${progression?.xp}
Missões Completas: ${completedMissions?.count}
Streak Atual: ${progression?.current_streak} dias
Objetivo: ${profile?.main_goal}

ATRIBUTOS:
Força: ${attributes?.strength}
Constituição: ${attributes?.constitution}
Vitalidade: ${attributes?.vitality}
Destreza: ${attributes?.dexterity}
Foco: ${attributes?.focus}

SKILLS MAIS USADAS:
${(skills.results as Array<{ name: string; total_reps: number }>).slice(0, 5).map((s) => `${s.name}: ${s.total_reps} reps`).join("\n")}

Analise e responda APENAS com JSON:
{
  "next_skill_recommendation": {
    "name": "nome da skill",
    "reason": "por que o usuário deve focar nisso"
  },
  "weak_attribute": {
    "name": "nome do atributo mais fraco",
    "suggestion": "como melhorar"
  },
  "training_focus": {
    "type": "tipo de treino recomendado",
    "reason": "justificativa baseada no objetivo"
  },
  "motivation_message": "mensagem motivadora personalizada"
}`;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": c.env.ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiResponse.ok) {
      throw new Error("AI API error");
    }

    const aiData = await aiResponse.json() as ClaudeResponse;
    const content = aiData.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid AI response format");
    }

    const recommendations = JSON.parse(jsonMatch[0]);

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
    console.error("Recommendations error:", error);
    return c.json({ error: "Failed to generate recommendations" }, 500);
  }
});

// 4. AI workout suggestions
app.get("/api/ai/workout-suggestions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "AI not configured" }, 503);

  try {
    const [profile, progression, metrics] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM daily_metrics WHERE user_id = ? ORDER BY date DESC LIMIT 1").bind(user.id).first(),
    ]);

    const prompt = `Baseado nestes dados de hoje, sugira um treino:

Usuário: Nível ${progression?.level}
Objetivo: ${profile?.main_goal}
Atividade hoje: ${metrics?.steps || 0} passos, ${metrics?.calories_burned || 0} calorias

Responda APENAS com JSON:
{
  "workout_type": "tipo de treino ideal para agora",
  "duration_minutes": número,
  "intensity": "low|medium|high",
  "exercises": ["exercício 1", "exercício 2", "exercício 3"],
  "motivation": "mensagem motivadora"
}`;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": c.env.ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiResponse.ok) {
      throw new Error("AI API error");
    }

    const aiData = await aiResponse.json() as ClaudeResponse;
    const content = aiData.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid AI response format");
    }

    const workout = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return c.json({
      success: true,
      workout,
    });
  } catch (error) {
    console.error("Workout suggestions error:", error);
    return c.json({ error: "Failed to generate workout suggestions" }, 500);
  }
});

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
