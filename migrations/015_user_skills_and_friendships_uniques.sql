-- Keep user skills and friendship edges unique to prevent duplicate unlock/progression counting.

DELETE FROM user_skills
WHERE id NOT IN (
  SELECT MIN(id)
  FROM user_skills
  GROUP BY user_id, skill_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_skills_unique_user_skill
  ON user_skills(user_id, skill_id);

UPDATE friendships
SET status = 'accepted'
WHERE status IS NULL OR TRIM(status) = '';

DELETE FROM friendships
WHERE id NOT IN (
  SELECT MIN(id)
  FROM friendships
  GROUP BY user_id, friend_user_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_unique_user_friend_user
  ON friendships(user_id, friend_user_id);
