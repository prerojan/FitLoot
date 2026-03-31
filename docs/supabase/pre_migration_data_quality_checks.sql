-- D1 -> Supabase pre-migration data quality checks
-- Execute no D1 antes do export para evitar levar inconsistências ao Postgres.

-- 1) Planos legados fora do padrão atual
select id, email, plan_id, plan_status
from users
where plan_id not in ('basic', 'pro', 'annual', 'vip');

-- 2) Subtarefas órfãs (sem missão pai)
select ms.id, ms.parent_mission_id
from mission_subtasks ms
left join missions m on m.id = ms.parent_mission_id
where m.id is null;

-- 3) Sessões expiradas antigas (higiene)
select id, user_id, expires_at
from sessions
where expires_at < datetime('now');

-- 4) Registros de webhook com user inexistente
select cwe.id, cwe.identified_user_id
from cakto_webhook_events cwe
left join users u on u.id = cwe.identified_user_id
where cwe.identified_user_id is not null
  and u.id is null;

-- 5) FKs lógicas de user_id quebradas (amostra das tabelas críticas)
select 'missions' as table_name, m.id as row_id, m.user_id
from missions m
left join users u on u.id = m.user_id
where u.id is null
union all
select 'user_profiles', up.id, up.user_id
from user_profiles up
left join users u on u.id = up.user_id
where u.id is null
union all
select 'subscriptions', rowid, s.user_id
from subscriptions s
left join users u on u.id = s.user_id
where u.id is null;
