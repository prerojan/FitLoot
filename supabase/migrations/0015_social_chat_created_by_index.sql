create index if not exists idx_conversations_created_by
  on social.conversations (created_by_user_id);
