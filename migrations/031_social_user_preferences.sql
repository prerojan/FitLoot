CREATE TABLE IF NOT EXISTS social_user_preferences (
  user_id TEXT PRIMARY KEY,
  show_online_status INTEGER NOT NULL DEFAULT 1,
  allow_friend_requests INTEGER NOT NULL DEFAULT 1,
  allow_group_invites INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_social_user_preferences_friend_requests
  ON social_user_preferences (allow_friend_requests);

CREATE INDEX IF NOT EXISTS idx_social_user_preferences_group_invites
  ON social_user_preferences (allow_group_invites);
