begin;

create or replace view social.friend_online_presence as
select
  f.user_id,
  up.user_id as friend_user_id,
  up.presence_status,
  up.visibility,
  up.last_heartbeat_at,
  up.last_seen_at,
  (
    up.presence_status = 'online'
    and up.last_heartbeat_at >= timezone('utc', now()) - interval '10 minutes'
  ) as is_online
from social.friendships f
inner join social.user_presence up
  on up.user_id = coalesce(f.friend_id, f.friend_user_id)
where f.status = 'accepted';

commit;
