import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  OnboardingRequestSchema,
  CompleteMissionRequestSchema,
  FoodScanRequestSchema,
  UpdateDailyMetricsRequestSchema,
  FriendRequestSchema,
  MiniGameChallengeRequestSchema,
  MiniGameCompleteRequestSchema
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
}

// Context type para Hono
type AppContext = {
  Bindings: Env;
  Variables: {
    user: AuthUser;
  };
};

// ---------- TIPOS DO GOOGLE ----------
interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}
// ------------------------------------


// Middleware de autenticação próprio
async function authMiddleware(c: any, next: any) {
  const sessionId = c.req.header('Cookie')?.match(/session_id=([^;]+)/)?.[1];

  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const session = await c.env.fitloot_db.prepare(
    'SELECT s.id as session_id, s.user_id, s.expires_at, u.email, u.name, u.avatar_url FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime("now")'
  ).bind(sessionId).first();

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', {
    id: session.user_id,
    email: session.email,
    name: session.name,
    avatar_url: session.avatar_url
  });

  await next();
}

// ---------- ENV TYPES ----------
export interface Env {
  fitloot_db: D1Database;            // D1 Database
  ASSETS: Fetcher;           // Static assets binding
  GOOGLE_CLIENT_ID: string;  // OAuth config
  GOOGLE_CLIENT_SECRET: string;
  // R2_BUCKET?: R2Bucket;    // Se for usar R2 depois
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



// Auth endpoints
app.get("/api/auth/google", (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) {
    return c.json({ error: "Server configuration error" }, 500);
  }

  const url = new URL(c.req.url);
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent");

  return c.redirect(googleAuthUrl.toString());
});


app.get("/api/auth/google/callback", async (c) => {
  const code = c.req.query("code");

  if (!code) {
    return c.redirect("/app?error=no_code");
  }

  try {
    const url = new URL(c.req.url);
    const origin = url.origin;
    const redirectUri = `${origin}/api/auth/google/callback`;

    // Troca código por token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

    if (!tokens.access_token) {
      return c.redirect("/app?error=token_failed");
    }

    // Busca informações do usuário no Google
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const googleUser = (await userResponse.json()) as GoogleUserInfo;

    // Busca ou cria usuário
    let user = await c.env.fitloot_db
      .prepare("SELECT * FROM users WHERE google_id = ?")
      .bind(googleUser.id)
      .first();

    if (!user) {
      const newUserId = crypto.randomUUID();

      await c.env.fitloot_db
        .prepare(
          "INSERT INTO users (id, email, name, google_id, avatar_url) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(
          newUserId,
          googleUser.email,
          googleUser.name,
          googleUser.id,
          googleUser.picture
        )
        .run();

      user = await c.env.fitloot_db
        .prepare("SELECT * FROM users WHERE google_id = ?")
        .bind(googleUser.id)
        .first();
    }

    // Cria sessão
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await c.env.fitloot_db
      .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(sessionId, user.id, expiresAt)
      .run();

    // Define cookie com configurações corretas
    const cookie = generateCookie(sessionId);
    c.header("Set-Cookie", cookie);

    // Redireciona para o frontend
    const frontendCallback = `${origin}/auth/callback`;
    return c.redirect(frontendCallback);

  } catch (err) {
    return c.redirect("/app?error=auth_failed");
  }
});


app.get("/api/users/me", authMiddleware, async (c) => {
  return c.json(c.get("user"));
});

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

// ====================================
// ADICIONE ESTAS ROTAS AO SEU src/worker/index.ts
// Cole após as rotas existentes, antes do "export default app"
// ====================================

// AI-powered endpoints

// 1. Generate personalized missions using AI
app.post("/api/ai/generate-missions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    // Get user data for personalization
    const [profile, progression, attributes, skills] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare(`
        SELECT s.* FROM skills s
        INNER JOIN user_skills us ON s.id = us.skill_id
        WHERE us.user_id = ?
      `).bind(user.id).all(),
    ]);

    // Build AI prompt with user context
    const prompt = `Você é um personal trainer virtual especializado em gamificação fitness. 

Perfil do usuário:
- Nome: ${profile?.full_name}
- Nível: ${progression?.level}
- Objetivo: ${profile?.main_goal}
- Condicionamento: ${profile?.initial_conditioning}
- Equipamentos: ${profile?.equipment || "nenhum"}
- Lesões: ${profile?.injuries || "nenhuma"}

Atributos atuais:
- Força: ${attributes?.strength}
- Constituição: ${attributes?.constitution}
- Vitalidade: ${attributes?.vitality}
- Destreza: ${attributes?.dexterity}
- Foco: ${attributes?.focus}

Skills desbloqueadas: ${skills.results.map((s: any) => s.name).join(", ")}

Crie 5 missões diárias DESAFIADORAS mas ALCANÇÁVEIS para este usuário. As missões devem:
1. Ser progressivas e adequadas ao nível atual
2. Variar entre diferentes tipos de exercício
3. Considerar os equipamentos disponíveis
4. Evitar áreas com lesões
5. Focar no objetivo principal

Responda APENAS com um JSON no formato:
{
  "missions": [
    {
      "title": "título curto",
      "description": "descrição motivadora",
      "skill_name": "nome da skill",
      "target_reps": número,
      "xp_reward": número,
      "points_reward": número,
      "difficulty": "easy|medium|hard"
    }
  ]
}`;

    // Call Claude API
    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiResponse.ok) {
      throw new Error("AI API error");
    }

    const aiData = await aiResponse.json() as ClaudeResponse;;
    const content = aiData.content[0].text;
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid AI response format");
    }
    
    const missionsData = JSON.parse(jsonMatch[0]);
    
    // Insert missions into database
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    
    for (const mission of missionsData.missions) {
      // Find skill ID by name
      const skill = skills.results.find((s: any) => 
        s.name.toLowerCase().includes(mission.skill_name.toLowerCase())
      );
      
      await c.env.fitloot_db.prepare(`
        INSERT INTO missions (user_id, type, title, description, skill_id, target_reps, xp_reward, points_reward, deadline, updated_at)
        VALUES (?, 'daily', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
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

    return c.json({ 
      success: true, 
      missions: missionsData.missions,
      message: "Missões geradas com IA!"
    });

  } catch (error) {
    console.error("AI generation error:", error);
    return c.json({ error: "Failed to generate missions" }, 500);
  }
});

// 2. AI Fitness Chatbot
app.post("/api/ai/chat", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const body = await c.req.json();
    const userMessage = body.message;
    const conversationHistory = body.history || [];

    if (!userMessage) {
      return c.json({ error: "Message required" }, 400);
    }

    // Get user context
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

Atributos:
- Força: ${attributes?.strength}
- Constituição: ${attributes?.constitution}
- Vitalidade: ${attributes?.vitality}
- Destreza: ${attributes?.dexterity}
- Foco: ${attributes?.focus}

Sua missão:
1. Seja motivador e use linguagem de RPG/games
2. Forneça dicas práticas de treino
3. Responda dúvidas sobre exercícios
4. Ajude o usuário a atingir suas metas
5. Seja conciso (máximo 3 parágrafos)
6. Use emojis relevantes 💪🔥⚡

Responda em português brasileiro de forma amigável e motivadora!`;

    // Build messages array
    const messages = [
      ...conversationHistory,
      { role: "user", content: userMessage }
    ];

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: messages,
      }),
    });

    if (!aiResponse.ok) {
      throw new Error("AI API error");
    }

    const aiData = await aiResponse.json() as ClaudeResponse;;
    const botResponse = aiData.content[0].text;

    return c.json({ 
      success: true,
      message: botResponse,
      user_level: progression?.level,
      user_xp: progression?.xp
    });

  } catch (error) {
    console.error("Chatbot error:", error);
    return c.json({ error: "Failed to process message" }, 500);
  }
});

// 3. AI Recommendations Engine
app.get("/api/ai/recommendations", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    // Get comprehensive user data
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
${skills.results.slice(0, 5).map((s: any) => `${s.name}: ${s.total_reps} reps`).join("\n")}

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

    const aiData = await aiResponse.json() as ClaudeResponse;;
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
        streak: progression?.current_streak
      }
    });

  } catch (error) {
    console.error("Recommendations error:", error);
    return c.json({ error: "Failed to generate recommendations" }, 500);
  }
});

// 4. AI Food Analysis (Enhanced)
app.post("/api/ai/analyze-food", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const body = await c.req.json();
    const { food_description, image_base64 } = body;

    if (!food_description && !image_base64) {
      return c.json({ error: "Food description or image required" }, 400);
    }

    let prompt = "";
    let messages: any[] = [];

    if (image_base64) {
      // Image-based analysis
      prompt = `Analise esta imagem de comida e retorne APENAS um JSON com:
{
  "food_name": "nome do alimento",
  "calories": número estimado de calorias,
  "protein": gramas de proteína,
  "carbs": gramas de carboidratos,
  "fats": gramas de gordura,
  "healthy_score": número de 1-10,
  "suggestions": "sugestões para tornar mais saudável"
}`;

      messages = [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: image_base64
            }
          },
          { type: "text", text: prompt }
        ]
      }];
    } else {
      // Text-based analysis
      prompt = `Analise este alimento: "${food_description}"

Retorne APENAS um JSON com:
{
  "food_name": "nome do alimento",
  "calories": número estimado de calorias,
  "protein": gramas de proteína,
  "carbs": gramas de carboidratos,
  "fats": gramas de gordura,
  "healthy_score": número de 1-10,
  "suggestions": "sugestões para tornar mais saudável ou alternativas"
}`;

      messages = [{ role: "user", content: prompt }];
    }

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: messages,
      }),
    });

    if (!aiResponse.ok) {
      throw new Error("AI API error");
    }

    const aiData = await aiResponse.json() as ClaudeResponse;;
    const content = aiData.content[0].text;
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid AI response format");
    }
    
    const foodData = JSON.parse(jsonMatch[0]);

    // Save to food diary
    await c.env.fitloot_db.prepare(`
      INSERT INTO food_diary (user_id, food_name, calories, meal_type, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).bind(
      user.id,
      foodData.food_name,
      foodData.calories,
      'lanche'
    ).run();

    return c.json({ 
      success: true,
      food_data: foodData
    });

  } catch (error) {
    console.error("Food analysis error:", error);
    return c.json({ error: "Failed to analyze food" }, 500);
  }
});

// Helper: Get AI-powered workout suggestions based on user state
app.get("/api/ai/workout-suggestions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const [profile, progression, metrics] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare(`
        SELECT * FROM daily_metrics 
        WHERE user_id = ? AND date = ?
      `).bind(user.id, new Date().toISOString().split('T')[0]).first(),
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

    const aiData = await aiResponse.json() as ClaudeResponse;;
    const content = aiData.content[0].text;
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid AI response format");
    }
    
    const workout = JSON.parse(jsonMatch[0]);

    return c.json({ 
      success: true,
      workout
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
