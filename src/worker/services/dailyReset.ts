import { DAILY_RESET_STATE_KEY } from "../constants/appState";

interface DailyResetDeps {
  db: D1Database;
  processUser: (userId: string) => Promise<void>;
}

export async function processDailyResetForAllUsers({ db, processUser }: DailyResetDeps): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const state = await db
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .bind(DAILY_RESET_STATE_KEY)
    .first<{ value: string | null }>();

  if (state?.value === today) {
    return;
  }

  const pageSize = 200;
  let offset = 0;

  while (true) {
    const users = await db
      .prepare("SELECT user_id FROM user_profiles ORDER BY user_id LIMIT ? OFFSET ?")
      .bind(pageSize, offset)
      .all<{ user_id: string }>();

    const batch = Array.isArray(users.results) ? users.results : [];
    if (batch.length === 0) {
      break;
    }

    for (const user of batch) {
      await processUser(user.user_id);
    }

    if (batch.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  await db
    .prepare(
      "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(DAILY_RESET_STATE_KEY, today)
    .run();
}
