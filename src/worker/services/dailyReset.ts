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

  const users = await db.prepare("SELECT user_id FROM user_profiles").all<{ user_id: string }>();
  for (const user of users.results) {
    await processUser(user.user_id);
  }

  await db
    .prepare(
      "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(DAILY_RESET_STATE_KEY, today)
    .run();
}
