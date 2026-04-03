type RuntimeSessionRecord = {
  id: string;
  user_id: string;
  expires_at: string;
};

type RuntimeSessionLookup = {
  id: string;
  user_id: string;
};

const RUNTIME_SESSION_SCHEMA_TTL_MS = 60_000;
const runtimeSessionSchemaState = new WeakMap<D1Database, { checkedAt: number; ready: boolean }>();

type D1SessionCapable = D1Database & {
  withSession?: ((constraintOrBookmark?: string) => D1DatabaseSession) | undefined;
};

function resolvePrimaryReadSession(db: D1Database): D1DatabaseSession | D1Database {
  const candidate = db as D1SessionCapable;
  if (typeof candidate.withSession !== "function") {
    return db;
  }

  try {
    return candidate.withSession("first-primary");
  } catch {
    return db;
  }
}

async function ensureRuntimeSessionSchema(db: D1Database): Promise<void> {
  const now = Date.now();
  const cached = runtimeSessionSchemaState.get(db);
  if (cached?.ready && now - cached.checkedAt < RUNTIME_SESSION_SCHEMA_TTL_MS) {
    return;
  }

  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS runtime_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    )
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_runtime_sessions_expires_at ON runtime_sessions(expires_at)",
    )
    .run();

  runtimeSessionSchemaState.set(db, { checkedAt: now, ready: true });
}

export async function readRuntimeSession(
  db: D1Database,
  sessionId: string,
): Promise<RuntimeSessionLookup | null> {
  await ensureRuntimeSessionSchema(db);
  const readSession = resolvePrimaryReadSession(db);
  return readSession
    .prepare(
      "SELECT id, user_id FROM runtime_sessions WHERE id = ? AND expires_at > datetime('now')",
    )
    .bind(sessionId)
    .first<RuntimeSessionLookup>();
}

export async function upsertRuntimeSession(
  db: D1Database,
  session: RuntimeSessionRecord,
): Promise<void> {
  await ensureRuntimeSessionSchema(db);
  await db
    .prepare(
      `INSERT INTO runtime_sessions (id, user_id, expires_at, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         expires_at = excluded.expires_at,
         updated_at = datetime('now')`,
    )
    .bind(session.id, session.user_id, session.expires_at)
    .run();
}

export async function deleteRuntimeSession(
  db: D1Database,
  sessionId: string,
): Promise<void> {
  await ensureRuntimeSessionSchema(db);
  await db
    .prepare("DELETE FROM runtime_sessions WHERE id = ?")
    .bind(sessionId)
    .run();
}
