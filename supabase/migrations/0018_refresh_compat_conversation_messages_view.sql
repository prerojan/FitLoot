begin;

create or replace view compat.conversation_messages as
select
  id,
  conversation_id,
  sender_user_id,
  message_text,
  created_at,
  updated_at,
  edited_at,
  deleted_at,
  message_kind
from social.conversation_messages;

commit;
