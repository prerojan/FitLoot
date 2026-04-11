-- Social Hub: user blocking and shared media inside direct conversations

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  FOREIGN KEY (blocker_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON user_blocks(blocked_user_id, created_at DESC);

ALTER TABLE conversation_messages
  ADD COLUMN message_kind TEXT NOT NULL DEFAULT 'text';

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS conversation_messages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_user_id TEXT NOT NULL,
  message_text TEXT,
  message_kind TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (message_kind IN ('text', 'image')),
  CHECK (
    (message_kind = 'text' AND length(trim(COALESCE(message_text, ''))) BETWEEN 1 AND 2000)
    OR (message_kind = 'image' AND length(trim(COALESCE(message_text, ''))) BETWEEN 0 AND 2000)
  )
);

INSERT INTO conversation_messages_new (
  id,
  conversation_id,
  sender_user_id,
  message_text,
  message_kind,
  created_at,
  updated_at,
  edited_at,
  deleted_at
)
SELECT
  id,
  conversation_id,
  sender_user_id,
  message_text,
  'text',
  created_at,
  updated_at,
  edited_at,
  deleted_at
FROM conversation_messages;

DROP TABLE conversation_messages;
ALTER TABLE conversation_messages_new RENAME TO conversation_messages;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
  ON conversation_messages(conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_sender
  ON conversation_messages(sender_user_id, created_at DESC);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversation_message_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL UNIQUE,
  conversation_id INTEGER NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  media_kind TEXT NOT NULL DEFAULT 'image',
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (media_kind IN ('image'))
);

CREATE INDEX IF NOT EXISTS idx_conversation_message_media_conversation
  ON conversation_message_media(conversation_id, created_at DESC);
