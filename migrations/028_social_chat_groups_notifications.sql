-- Social chat, groups, and unread notification tracking for the Arena hub

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_kind TEXT NOT NULL DEFAULT 'direct',
  direct_key TEXT UNIQUE,
  title TEXT,
  created_by_user_id TEXT,
  last_message_id INTEGER,
  last_message_preview TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (conversation_kind IN ('direct', 'group'))
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  member_role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_read_message_id INTEGER,
  last_read_at TEXT,
  last_notified_message_id INTEGER,
  last_notified_at TEXT,
  notifications_muted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (member_role IN ('owner', 'member'))
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_user_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (length(trim(message_text)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_conversations_kind_last_message
  ON conversations(conversation_kind, last_message_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_direct_key
  ON conversations(direct_key);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user
  ON conversation_members(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
  ON conversation_messages(conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_sender
  ON conversation_messages(sender_user_id, created_at DESC);
