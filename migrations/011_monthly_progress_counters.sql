-- Dedicated counters for monthly broad-goal missions.
-- Keeps rolling monthly totals decoupled from mission rows.
CREATE TABLE IF NOT EXISTS user_monthly_counters (
  user_id TEXT NOT NULL,
  month_key TEXT NOT NULL,
  missions_completed INTEGER NOT NULL DEFAULT 0,
  distance_meters INTEGER NOT NULL DEFAULT 0,
  streak_days INTEGER NOT NULL DEFAULT 0,
  weekly_circuits_completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, month_key)
);
