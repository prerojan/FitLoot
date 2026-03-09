-- Prevent duplicate achievements per user and keep one canonical row.

DELETE FROM user_achievements
WHERE id NOT IN (
  SELECT MIN(id)
  FROM user_achievements
  GROUP BY user_id, achievement_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_achievements_unique_user_achievement
  ON user_achievements(user_id, achievement_id);
