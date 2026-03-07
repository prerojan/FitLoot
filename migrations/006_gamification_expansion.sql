-- Gamification expansion: skills progression, plans, events, richer titles/achievements

ALTER TABLE skills ADD COLUMN tier TEXT DEFAULT 'iniciante';
ALTER TABLE skills ADD COLUMN level_required INTEGER DEFAULT 1;
ALTER TABLE skills ADD COLUMN prerequisites TEXT DEFAULT '[]';
ALTER TABLE skills ADD COLUMN attribute_requirements TEXT DEFAULT '{}';
ALTER TABLE skills ADD COLUMN unlock_message TEXT;

ALTER TABLE user_skills ADD COLUMN status TEXT DEFAULT 'locked';
ALTER TABLE user_skills ADD COLUMN current_stage INTEGER DEFAULT 0;

ALTER TABLE titles ADD COLUMN description TEXT;
ALTER TABLE titles ADD COLUMN reference TEXT;
ALTER TABLE titles ADD COLUMN unlock_condition TEXT;
ALTER TABLE user_titles ADD COLUMN is_equipped INTEGER DEFAULT 0;

ALTER TABLE achievements ADD COLUMN category TEXT DEFAULT 'geral';
ALTER TABLE achievements ADD COLUMN color TEXT DEFAULT '#9CA3AF';
ALTER TABLE achievements ADD COLUMN secret INTEGER DEFAULT 0;
ALTER TABLE achievements ADD COLUMN condition TEXT;
ALTER TABLE achievements ADD COLUMN reference TEXT;

ALTER TABLE user_achievements ADD COLUMN progress_current INTEGER DEFAULT 0;
ALTER TABLE user_achievements ADD COLUMN progress_required INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS skill_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL,
  stage_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  level_required INTEGER DEFAULT 1,
  exercise_reference TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(skill_id, stage_number)
);

CREATE TABLE IF NOT EXISTS user_training_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  main_goal TEXT,
  conditioning TEXT,
  training_frequency INTEGER DEFAULT 4,
  equipment TEXT,
  injuries TEXT,
  weekly_plan_json TEXT NOT NULL,
  progression_notes TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_event_counters (
  user_id TEXT PRIMARY KEY,
  missions_completed INTEGER DEFAULT 0,
  missions_failed INTEGER DEFAULT 0,
  consecutive_days_completed INTEGER DEFAULT 0,
  longest_consecutive_days INTEGER DEFAULT 0,
  chat_messages INTEGER DEFAULT 0,
  repeated_message_streak INTEGER DEFAULT 0,
  last_chat_message TEXT,
  skills_unlocked INTEGER DEFAULT 0,
  minigames_played INTEGER DEFAULT 0,
  minigames_won INTEGER DEFAULT 0,
  minigame_win_streak INTEGER DEFAULT 0,
  mission_refuse_count_today INTEGER DEFAULT 0,
  mission_refuse_date TEXT,
  streak_loss_count INTEGER DEFAULT 0,
  app_last_open_at TEXT,
  app_open_gap_days INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_skill_stages_skill ON skill_stages(skill_id);
CREATE INDEX IF NOT EXISTS idx_user_event_log_user ON user_event_log(user_id);
CREATE INDEX IF NOT EXISTS idx_achievements_secret ON achievements(secret);
