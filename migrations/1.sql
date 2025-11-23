
-- Tabela de perfis de usuário (estende MochaUser)
CREATE TABLE user_profiles (
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de atributos físicos
CREATE TABLE user_attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  strength INTEGER DEFAULT 0,
  constitution INTEGER DEFAULT 0,
  vitality INTEGER DEFAULT 0,
  dexterity INTEGER DEFAULT 0,
  focus INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de progressão do usuário
CREATE TABLE user_progression (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  points INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0,
  last_activity_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de habilidades disponíveis
CREATE TABLE skills (
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de habilidades desbloqueadas pelo usuário
CREATE TABLE user_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  skill_id INTEGER NOT NULL,
  total_reps INTEGER DEFAULT 0,
  total_time INTEGER DEFAULT 0,
  best_reps INTEGER DEFAULT 0,
  unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_skills_user ON user_skills(user_id);
CREATE INDEX idx_user_skills_skill ON user_skills(skill_id);

-- Tabela de missões
CREATE TABLE missions (
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
  deadline TIMESTAMP,
  is_completed BOOLEAN DEFAULT 0,
  completed_at TIMESTAMP,
  verified_by_sensor BOOLEAN DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_missions_user ON missions(user_id);
CREATE INDEX idx_missions_type ON missions(type);
CREATE INDEX idx_missions_completed ON missions(is_completed);

-- Tabela de conquistas
CREATE TABLE achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  rarity TEXT NOT NULL,
  icon TEXT,
  requirement_type TEXT NOT NULL,
  requirement_value INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de conquistas do usuário
CREATE TABLE user_achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  achievement_id INTEGER NOT NULL,
  unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_achievements_user ON user_achievements(user_id);

-- Tabela de títulos
CREATE TABLE titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rarity TEXT NOT NULL,
  requirement_type TEXT NOT NULL,
  requirement_value INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de títulos do usuário
CREATE TABLE user_titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  title_id INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT 0,
  unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_titles_user ON user_titles(user_id);

-- Tabela de amigos
CREATE TABLE friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  friend_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_friendships_user ON friendships(user_id);
CREATE INDEX idx_friendships_friend ON friendships(friend_user_id);

-- Tabela de parceiros da loja
CREATE TABLE shop_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  rating REAL DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de produtos da loja
CREATE TABLE shop_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  is_available BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shop_products_partner ON shop_products(partner_id);

-- Tabela de pedidos de cupons
CREATE TABLE coupon_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  points_spent INTEGER NOT NULL,
  qr_code TEXT NOT NULL,
  is_redeemed BOOLEAN DEFAULT 0,
  redeemed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_coupon_orders_user ON coupon_orders(user_id);

-- Tabela de diário alimentar
CREATE TABLE food_diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  food_name TEXT NOT NULL,
  calories INTEGER,
  meal_type TEXT,
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_food_diary_user ON food_diary(user_id);

-- Tabela de métricas diárias
CREATE TABLE daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  steps INTEGER DEFAULT 0,
  calories_burned INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_daily_metrics_user_date ON daily_metrics(user_id, date);

-- Tabela de mini games
CREATE TABLE mini_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenger_user_id TEXT NOT NULL,
  challenged_user_id TEXT NOT NULL,
  skill_id INTEGER NOT NULL,
  target_reps INTEGER NOT NULL,
  status TEXT NOT NULL,
  winner_user_id TEXT,
  xp_reward INTEGER NOT NULL,
  points_reward INTEGER NOT NULL,
  deadline TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mini_games_challenger ON mini_games(challenger_user_id);
CREATE INDEX idx_mini_games_challenged ON mini_games(challenged_user_id);
