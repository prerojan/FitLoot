-- Idempotent storage for offline mission and telemetry synchronization

CREATE TABLE IF NOT EXISTS offline_sync_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence TEXT,
  request_payload TEXT,
  response_payload TEXT,
  status TEXT NOT NULL DEFAULT 'processed',
  processed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_sync_operations_user_operation
  ON offline_sync_operations(user_id, operation_id);

CREATE INDEX IF NOT EXISTS idx_offline_sync_operations_user_processed
  ON offline_sync_operations(user_id, processed_at DESC);
