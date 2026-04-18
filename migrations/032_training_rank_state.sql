ALTER TABLE user_progression
ADD COLUMN training_rank TEXT DEFAULT NULL;

ALTER TABLE user_progression
ADD COLUMN training_rank_score INTEGER DEFAULT NULL;

ALTER TABLE user_progression
ADD COLUMN training_rank_last_synced_at TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_user_progression_training_rank_score
  ON user_progression (training_rank_score DESC, level DESC, xp DESC);
