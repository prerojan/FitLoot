-- Scheduler idempotency + goal achievements counters

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_goal_stats (
  user_id TEXT PRIMARY KEY,
  goal_fail_count INTEGER DEFAULT 0,
  goal_fail_distinct_days INTEGER DEFAULT 0,
  goal_fail_last_day TEXT,
  goal_fail_consecutive_days INTEGER DEFAULT 0,
  goal_completed_count INTEGER DEFAULT 0,
  goal_completed_consecutive_days INTEGER DEFAULT 0,
  goal_completed_last_day TEXT,
  goal_no_fail_streak_days INTEGER DEFAULT 0,
  goal_progress_percent INTEGER DEFAULT 0,
  goal_change_count INTEGER DEFAULT 0,
  original_goal TEXT,
  current_goal TEXT,
  returned_to_original_count INTEGER DEFAULT 0,
  missions_after_return INTEGER DEFAULT 0,
  completed_goals TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_state_key ON app_state(key);
