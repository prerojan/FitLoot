-- ===============================
-- FITLOOT FULL SCHEMA - CLOUDLFARE D1
-- ===============================

-- --------------------------
-- USER PROFILES
-- --------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  weight REAL,
  height REAL,
  initial_conditioning TEXT,
  injuries TEXT,
  equipment TEXT,
  main_goal TEXT,
  custom_color TEXT,
  custom_font TEXT,
  custom_border TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------
-- USER ATTRIBUTES
-- --------------------------
CREATE TABLE IF NOT EXISTS user_attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  strength INTEGER DEFAULT 0,
  constitution INTEGER DEFAULT 0,
  vitality INTEGER DEFAULT 0,
  dexterity INTEGER DEFAULT 0,
  focus INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------
-- USER PROGRESSION
-- --------------------------
CREATE TABLE IF NOT EXISTS user_progression (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  points INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0,
  last_activity_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------
-- SKILLS
-- --------------------------
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  description TEXT,
  calories_per_rep REAL,
  strength_gain INTEGER DEFAULT 0,
  constitution_gain INTEGER DEFAULT 0,
  vitality_gain INTEGER DEFAULT 0,
  dexterity_gain INTEGER DEFAULT 0,
  focus_gain INTEGER DEFAULT 0,
  required_level INTEGER DEFAULT 1,
  prerequisite_skill_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------
-- USER SKILLS
-- --------------------------
CREATE TABLE IF NOT EXISTS user_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  skill_id INTEGER NOT NULL,
  total_reps INTEGER DEFAULT 0,
  total_time INTEGER DEFAULT 0,
  best_reps INTEGER DEFAULT 0,
  unlocked_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_skill ON user_skills(skill_id);

-- --------------------------
-- MISSIONS
-- --------------------------
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  skill_id INTEGER,
  target_reps INTEGER,
  target_time INTEGER,
  xp_reward INTEGER NOT NULL,
  points_reward INTEGER NOT NULL,
  deadline TEXT,
  is_completed INTEGER DEFAULT 0,
  completed_at TEXT,
  verified_by_sensor INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_missions_user ON missions(user_id);
CREATE INDEX IF NOT EXISTS idx_missions_type ON missions(type);
CREATE INDEX IF NOT EXISTS idx_missions_completed ON missions(is_completed);

-- --------------------------
-- ACHIEVEMENTS
-- --------------------------
CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  rarity TEXT NOT NULL,
  icon TEXT,
  requirement_type TEXT NOT NULL,
  requirement_value INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------
-- USER ACHIEVEMENTS
-- --------------------------
CREATE TABLE IF NOT EXISTS user_achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  achievement_id INTEGER NOT NULL,
  unlocked_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);

-- --------------------------
-- TITLES
-- --------------------------
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rarity TEXT NOT NULL,
  requirement_type TEXT NOT NULL,
  requirement_value INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------
-- USER TITLES
-- --------------------------
CREATE TABLE IF NOT EXISTS user_titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  title_id INTEGER NOT NULL,
  is_active INTEGER DEFAULT 0,
  unlocked_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles(user_id);

-- --------------------------
-- FRIENDSHIPS
-- --------------------------
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  friend_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_user_id);

-- --------------------------
-- SHOP PARTNERS
-- --------------------------
CREATE TABLE IF NOT EXISTS shop_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  rating REAL DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------
-- SHOP PRODUCTS
-- --------------------------
CREATE TABLE IF NOT EXISTS shop_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  is_available INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shop_products_partner ON shop_products(partner_id);

-- --------------------------
-- COUPON ORDERS
-- --------------------------
CREATE TABLE IF NOT EXISTS coupon_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  points_spent INTEGER NOT NULL,
  qr_code TEXT NOT NULL,
  is_redeemed INTEGER DEFAULT 0,
  redeemed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coupon_orders_user ON coupon_orders(user_id);

-- --------------------------
-- FOOD DIARY
-- --------------------------
CREATE TABLE IF NOT EXISTS food_diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  food_name TEXT NOT NULL,
  calories INTEGER,
  meal_type TEXT,
  scanned_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_food_diary_user ON food_diary(user_id);

-- --------------------------
-- DAILY METRICS
-- --------------------------
CREATE TABLE IF NOT EXISTS daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  steps INTEGER DEFAULT 0,
  calories_burned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_user_date ON daily_metrics(user_id, date);

-- --------------------------
-- MINI GAMES
-- --------------------------
CREATE TABLE IF NOT EXISTS mini_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenger_user_id TEXT NOT NULL,
  challenged_user_id TEXT NOT NULL,
  skill_id INTEGER NOT NULL,
  target_reps INTEGER NOT NULL,
  status TEXT NOT NULL,
  winner_user_id TEXT,
  xp_reward INTEGER NOT NULL,
  points_reward INTEGER NOT NULL,
  deadline TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mini_games_challenger ON mini_games(challenger_user_id);
CREATE INDEX IF NOT EXISTS idx_mini_games_challenged ON mini_games(challenged_user_id);
