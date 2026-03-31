-- Reward catalog fields and persistent reward notification queue

ALTER TABLE achievements ADD COLUMN xp_reward INTEGER DEFAULT 50;
ALTER TABLE achievements ADD COLUMN points_reward INTEGER DEFAULT 0;
ALTER TABLE titles ADD COLUMN xp_reward INTEGER DEFAULT 0;
ALTER TABLE titles ADD COLUMN points_reward INTEGER DEFAULT 0;

UPDATE achievements
   SET xp_reward = COALESCE(xp_reward, 50),
       points_reward = COALESCE(points_reward, 0);

UPDATE titles
   SET xp_reward = COALESCE(xp_reward, 0),
       points_reward = COALESCE(points_reward, 0);

CREATE TABLE IF NOT EXISTS user_reward_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  entity_name TEXT,
  level INTEGER,
  xp_reward INTEGER DEFAULT 0,
  points_reward INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reward_notifications_user_pending
  ON user_reward_notifications(user_id, consumed_at, id);
