-- Streak/failure lifecycle, friend requests model, and personalization profile fields

ALTER TABLE missions ADD COLUMN status TEXT DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS friend_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE friendships ADD COLUMN friend_id TEXT;

ALTER TABLE user_profiles ADD COLUMN active_skill_focus TEXT DEFAULT 'calistenia';
ALTER TABLE user_profiles ADD COLUMN custom_primary_color TEXT;
ALTER TABLE user_profiles ADD COLUMN custom_secondary_color TEXT;
ALTER TABLE user_profiles ADD COLUMN custom_background_type TEXT;
ALTER TABLE user_profiles ADD COLUMN custom_background_value TEXT;
ALTER TABLE user_profiles ADD COLUMN custom_title_id INTEGER;
ALTER TABLE user_profiles ADD COLUMN showcased_achievements TEXT;

ALTER TABLE user_event_counters ADD COLUMN minimal_streak_days INTEGER DEFAULT 0;
ALTER TABLE user_event_counters ADD COLUMN single_mission_days_streak INTEGER DEFAULT 0;
ALTER TABLE user_event_counters ADD COLUMN last_streak_break_size INTEGER DEFAULT 0;
ALTER TABLE user_event_counters ADD COLUMN timing_last5m_count INTEGER DEFAULT 0;
ALTER TABLE user_event_counters ADD COLUMN timing_2355_streak INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requests_from ON friend_requests(from_user_id, status);
