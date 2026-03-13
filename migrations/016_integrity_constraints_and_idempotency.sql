-- Data integrity hardening for metrics, skills, titles and shop purchases.

ALTER TABLE coupon_orders ADD COLUMN request_id TEXT;

UPDATE daily_metrics
SET
  steps = (
    SELECT COALESCE(MAX(dm2.steps), 0)
    FROM daily_metrics dm2
    WHERE dm2.user_id = daily_metrics.user_id
      AND dm2.date = daily_metrics.date
  ),
  calories_burned = (
    SELECT COALESCE(MAX(dm2.calories_burned), 0)
    FROM daily_metrics dm2
    WHERE dm2.user_id = daily_metrics.user_id
      AND dm2.date = daily_metrics.date
  ),
  updated_at = (
    SELECT COALESCE(MAX(dm2.updated_at), daily_metrics.updated_at)
    FROM daily_metrics dm2
    WHERE dm2.user_id = daily_metrics.user_id
      AND dm2.date = daily_metrics.date
  )
WHERE id IN (
  SELECT MAX(id)
  FROM daily_metrics
  GROUP BY user_id, date
);

DELETE FROM daily_metrics
WHERE id NOT IN (
  SELECT MAX(id)
  FROM daily_metrics
  GROUP BY user_id, date
);

UPDATE user_skills
SET
  total_reps = (
    SELECT COALESCE(SUM(us2.total_reps), 0)
    FROM user_skills us2
    WHERE us2.user_id = user_skills.user_id
      AND us2.skill_id = user_skills.skill_id
  ),
  total_time = (
    SELECT COALESCE(SUM(us2.total_time), 0)
    FROM user_skills us2
    WHERE us2.user_id = user_skills.user_id
      AND us2.skill_id = user_skills.skill_id
  ),
  best_reps = (
    SELECT COALESCE(MAX(us2.best_reps), 0)
    FROM user_skills us2
    WHERE us2.user_id = user_skills.user_id
      AND us2.skill_id = user_skills.skill_id
  ),
  status = COALESCE((
    SELECT us2.status
    FROM user_skills us2
    WHERE us2.user_id = user_skills.user_id
      AND us2.skill_id = user_skills.skill_id
    ORDER BY CASE us2.status
      WHEN 'unlocked' THEN 3
      WHEN 'in_progress' THEN 2
      ELSE 1
    END DESC, us2.id ASC
    LIMIT 1
  ), status),
  current_stage = (
    SELECT COALESCE(MAX(us2.current_stage), 0)
    FROM user_skills us2
    WHERE us2.user_id = user_skills.user_id
      AND us2.skill_id = user_skills.skill_id
  ),
  unlocked_at = (
    SELECT COALESCE(MIN(us2.unlocked_at), user_skills.unlocked_at)
    FROM user_skills us2
    WHERE us2.user_id = user_skills.user_id
      AND us2.skill_id = user_skills.skill_id
  ),
  created_at = (
    SELECT COALESCE(MIN(us2.created_at), user_skills.created_at)
    FROM user_skills us2
    WHERE us2.user_id = user_skills.user_id
      AND us2.skill_id = user_skills.skill_id
  ),
  updated_at = (
    SELECT COALESCE(MAX(us2.updated_at), user_skills.updated_at)
    FROM user_skills us2
    WHERE us2.user_id = user_skills.user_id
      AND us2.skill_id = user_skills.skill_id
  )
WHERE id IN (
  SELECT MIN(id)
  FROM user_skills
  GROUP BY user_id, skill_id
);

DELETE FROM user_skills
WHERE id NOT IN (
  SELECT MIN(id)
  FROM user_skills
  GROUP BY user_id, skill_id
);

UPDATE user_titles
SET
  is_active = (
    SELECT COALESCE(MAX(ut2.is_active), 0)
    FROM user_titles ut2
    WHERE ut2.user_id = user_titles.user_id
      AND ut2.title_id = user_titles.title_id
  ),
  is_equipped = (
    SELECT COALESCE(MAX(ut2.is_equipped), 0)
    FROM user_titles ut2
    WHERE ut2.user_id = user_titles.user_id
      AND ut2.title_id = user_titles.title_id
  ),
  unlocked_at = (
    SELECT COALESCE(MIN(ut2.unlocked_at), user_titles.unlocked_at)
    FROM user_titles ut2
    WHERE ut2.user_id = user_titles.user_id
      AND ut2.title_id = user_titles.title_id
  ),
  created_at = (
    SELECT COALESCE(MIN(ut2.created_at), user_titles.created_at)
    FROM user_titles ut2
    WHERE ut2.user_id = user_titles.user_id
      AND ut2.title_id = user_titles.title_id
  ),
  updated_at = (
    SELECT COALESCE(MAX(ut2.updated_at), user_titles.updated_at)
    FROM user_titles ut2
    WHERE ut2.user_id = user_titles.user_id
      AND ut2.title_id = user_titles.title_id
  )
WHERE id IN (
  SELECT MIN(id)
  FROM user_titles
  GROUP BY user_id, title_id
);

DELETE FROM user_titles
WHERE id NOT IN (
  SELECT MIN(id)
  FROM user_titles
  GROUP BY user_id, title_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_metrics_unique_user_date
  ON daily_metrics(user_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_skills_unique_user_skill
  ON user_skills(user_id, skill_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_titles_unique_user_title
  ON user_titles(user_id, title_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_orders_unique_request
  ON coupon_orders(request_id);
