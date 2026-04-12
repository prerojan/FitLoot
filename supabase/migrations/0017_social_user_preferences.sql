CREATE TABLE IF NOT EXISTS social.social_user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES core.user_profiles(user_id) ON DELETE CASCADE,
  show_online_status BOOLEAN NOT NULL DEFAULT TRUE,
  allow_friend_requests BOOLEAN NOT NULL DEFAULT TRUE,
  allow_group_invites BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_social_user_preferences_friend_requests
  ON social.social_user_preferences (allow_friend_requests);

CREATE INDEX IF NOT EXISTS idx_social_user_preferences_group_invites
  ON social.social_user_preferences (allow_group_invites);
