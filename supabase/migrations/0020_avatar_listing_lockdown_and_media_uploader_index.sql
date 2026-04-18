begin;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;

create index if not exists idx_conversation_message_media_uploaded_by_user_id
  on social.conversation_message_media (uploaded_by_user_id);

commit;
