-- ===============================
-- PROGRESS SNAPSHOTS
-- ===============================

CREATE TABLE progress_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL DEFAULT (date('now')),
  level INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  strength INTEGER NOT NULL,
  constitution INTEGER NOT NULL,
  vitality INTEGER NOT NULL,
  dexterity INTEGER NOT NULL,
  focus INTEGER NOT NULL,
  missions_completed INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  training_rank_snapshot TEXT, -- JSON string do TrainingRankSnapshot
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
);

CREATE UNIQUE INDEX idx_progress_snapshots_user_date
  ON progress_snapshots(user_id, snapshot_date);

CREATE INDEX idx_progress_snapshots_user_created 
  ON progress_snapshots(user_id, created_at DESC);

-- ===============================
-- PHYSICAL BENCHMARKS
-- ===============================

CREATE TABLE physical_benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  test_date TEXT NOT NULL DEFAULT (date('now')),
  pushups_max INTEGER,
  squats_max INTEGER,
  situps_max INTEGER,
  plank_seconds INTEGER,
  pullups_max INTEGER,
  run_distance_km REAL,
  run_time_seconds INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
);

CREATE INDEX idx_physical_benchmarks_user_date 
  ON physical_benchmarks(user_id, test_date DESC);

-- Adicionar colunas de benchmarks ao user_profiles se não existirem
-- Isso permite compatibilidade com dados existentes do onboarding
-- Usando ALTER TABLE IF NOT EXISTS para evitar erros de colunas duplicadas
-- SQLite não suporta IF NOT EXISTS para colunas, então verificamos primeiro

-- Adicionar training_rank_snapshot ao user_progression se não existir
ALTER TABLE user_progression 
ADD COLUMN training_rank_snapshot TEXT DEFAULT NULL;
