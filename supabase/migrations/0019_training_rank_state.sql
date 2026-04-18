alter table core.user_progression
  add column if not exists training_rank text,
  add column if not exists training_rank_score integer,
  add column if not exists training_rank_last_synced_at timestamp with time zone;

create index if not exists idx_core_user_progression_training_rank_score
  on core.user_progression (training_rank_score desc nulls last, level desc, xp desc);

create or replace view compat.user_progression as
select
  id,
  user_id,
  xp,
  level,
  points,
  current_streak,
  best_streak,
  last_activity_date,
  created_at,
  updated_at,
  training_rank_snapshot,
  training_rank,
  training_rank_score,
  training_rank_last_synced_at
from core.user_progression;
