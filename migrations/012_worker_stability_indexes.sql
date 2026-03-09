-- Worker stability/performance indexes for high-frequency filters and ordering.

CREATE INDEX IF NOT EXISTS idx_missions_user_type_origin_created
  ON missions(user_id, type, mission_origin, created_at);

CREATE INDEX IF NOT EXISTS idx_missions_user_status_deadline
  ON missions(user_id, status, deadline);

CREATE INDEX IF NOT EXISTS idx_missions_user_completed_updated
  ON missions(user_id, is_completed, completed_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_missions_user_created
  ON missions(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_friend_requests_to_status_created
  ON friend_requests(to_user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_friendships_user_friend
  ON friendships(user_id, friend_id);

CREATE INDEX IF NOT EXISTS idx_coupon_orders_user_created
  ON coupon_orders(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_mini_games_participant_status_created_challenger
  ON mini_games(challenger_user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_mini_games_participant_status_created_challenged
  ON mini_games(challenged_user_id, status, created_at);
