ALTER TABLE user_profiles ADD COLUMN initial_pushups INTEGER DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN initial_situps INTEGER DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN initial_squats INTEGER DEFAULT 0;

ALTER TABLE missions ADD COLUMN goal TEXT;
ALTER TABLE missions ADD COLUMN is_ai_special INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS mission_subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_mission_id INTEGER NOT NULL,
  mission_type TEXT NOT NULL DEFAULT 'daily',
  subtask_title TEXT NOT NULL,
  compatibility_key TEXT NOT NULL,
  compatibility_terms_json TEXT NOT NULL DEFAULT '[]',
  required_count INTEGER NOT NULL DEFAULT 1,
  current_count INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mission_subtasks_parent
ON mission_subtasks(parent_mission_id);

CREATE INDEX IF NOT EXISTS idx_mission_subtasks_parent_completed
ON mission_subtasks(parent_mission_id, is_completed);
