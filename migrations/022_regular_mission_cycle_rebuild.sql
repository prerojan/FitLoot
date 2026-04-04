ALTER TABLE user_profiles ADD COLUMN timezone TEXT;

ALTER TABLE missions ADD COLUMN cycle_date TEXT;

UPDATE missions
SET cycle_date = CASE type
  WHEN 'monthly' THEN COALESCE(substr(created_at, 1, 7) || '-01', date('now', 'start of month'))
  WHEN 'weekly' THEN COALESCE(
    date(created_at, printf('-%d days', (CAST(strftime('%w', created_at) AS INTEGER) + 6) % 7)),
    date('now', 'weekday 1', '-7 days')
  )
  ELSE COALESCE(substr(created_at, 1, 10), date('now'))
END
WHERE cycle_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_missions_user_type_cycle_origin_completed
ON missions(user_id, type, mission_origin, cycle_date, is_completed);

CREATE TABLE IF NOT EXISTS maintenance_jobs (
  job_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  cursor TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
