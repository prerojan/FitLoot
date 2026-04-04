import { MISSION_LIMITS } from "../../constants/missionMetrics";
import type { Env } from "../core/types";

const REGULAR_MISSION_REBUILD_JOB_KEY = "regular_mission_cycle_rebuild_v1";
const REGULAR_MISSION_REBUILD_BATCH_SIZE = 25;
const REGULAR_MISSION_REBUILD_LOCK_TTL_MS = 15 * 60_000;

type StructuredGenerationOptions = {
  isAiSpecial: boolean;
  dailyTarget: number;
  weeklyTarget: number;
  monthlyTarget: number;
};

type RegularMissionRebuildDeps = {
  generateStructuredMissionPlanForUser: (
    env: Env,
    db: D1Database,
    userId: string,
    options: StructuredGenerationOptions,
  ) => Promise<unknown>;
  getErrorMessage: (error: unknown) => string;
  invalidateMissionListCache: (userId: string) => void;
};

type MaintenanceJobRow = {
  cursor_user_id: string | null;
  status: string | null;
  processed_count: number | null;
  started_at: string | null;
};

async function ensureMaintenanceJobSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS maintenance_jobs (
       job_key TEXT PRIMARY KEY,
       cursor_user_id TEXT,
       status TEXT NOT NULL DEFAULT 'pending',
       processed_count INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       started_at TEXT,
       finished_at TEXT,
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ).run();
}

export function createRegularMissionRebuildService(
  deps: RegularMissionRebuildDeps,
) {
  function isStaleRunningJob(value: string | null | undefined): boolean {
    if (typeof value !== "string" || value.trim().length === 0) {
      return true;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return true;
    }
    return Date.now() - parsed > REGULAR_MISSION_REBUILD_LOCK_TTL_MS;
  }

  async function acquireJobState(
    db: D1Database,
  ): Promise<MaintenanceJobRow | null> {
    await ensureMaintenanceJobSchema(db);
    await db.prepare(
      `INSERT INTO maintenance_jobs (
         job_key,
         cursor_user_id,
         status,
         processed_count,
         updated_at
       ) VALUES (?, NULL, 'pending', 0, datetime('now'))
       ON CONFLICT(job_key) DO NOTHING`,
    ).bind(REGULAR_MISSION_REBUILD_JOB_KEY).run();

    const current = await db.prepare(
      `SELECT cursor_user_id, status, processed_count, started_at
         FROM maintenance_jobs
        WHERE job_key = ?`,
    ).bind(REGULAR_MISSION_REBUILD_JOB_KEY).first<MaintenanceJobRow>();

    if (!current) {
      return null;
    }
    if (current.status === "completed") {
      return null;
    }
    if (current.status === "running" && !isStaleRunningJob(current.started_at)) {
      return null;
    }

    const claim = await db.prepare(
      `UPDATE maintenance_jobs
          SET status = 'running',
              started_at = datetime('now'),
              finished_at = NULL,
              last_error = NULL,
              updated_at = datetime('now')
        WHERE job_key = ?
          AND (
            status != 'running'
            OR started_at IS NULL
            OR datetime(started_at) < datetime('now', '-15 minutes')
          )`,
    ).bind(REGULAR_MISSION_REBUILD_JOB_KEY).run();

    if (Number(claim.meta.changes ?? 0) === 0) {
      return null;
    }

    return current;
  }

  async function loadUserBatch(
    db: D1Database,
    cursorUserId: string | null,
  ): Promise<string[]> {
    const rows = await db.prepare(
      `SELECT user_id
         FROM user_profiles
        WHERE (? IS NULL OR user_id > ?)
        ORDER BY user_id
        LIMIT ?`,
    ).bind(
      cursorUserId,
      cursorUserId,
      REGULAR_MISSION_REBUILD_BATCH_SIZE,
    ).all<{ user_id: string }>();

    return (Array.isArray(rows.results) ? rows.results : [])
      .map((row) => String(row.user_id ?? "").trim())
      .filter((userId) => userId.length > 0);
  }

  async function purgeRegularMissionsForUser(
    db: D1Database,
    userId: string,
  ): Promise<void> {
    await db.prepare(
      `DELETE FROM mission_subtasks
        WHERE parent_mission_id IN (
          SELECT id
            FROM missions
           WHERE user_id = ?
             AND COALESCE(mission_origin, 'regular') = 'regular'
             AND COALESCE(is_ai_special, 0) = 0
        )`,
    ).bind(userId).run();

    await db.prepare(
      `DELETE FROM missions
        WHERE user_id = ?
          AND COALESCE(mission_origin, 'regular') = 'regular'
          AND COALESCE(is_ai_special, 0) = 0`,
    ).bind(userId).run();
  }

  async function markBatchSuccess(
    db: D1Database,
    params: {
      nextCursor: string | null;
      processedCount: number;
      completed: boolean;
    },
  ): Promise<void> {
    await db.prepare(
      `UPDATE maintenance_jobs
          SET cursor_user_id = ?,
              processed_count = ?,
              status = ?,
              finished_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
              updated_at = datetime('now')
        WHERE job_key = ?`,
    ).bind(
      params.nextCursor,
      params.processedCount,
      params.completed ? "completed" : "pending",
      params.completed ? 1 : 0,
      REGULAR_MISSION_REBUILD_JOB_KEY,
    ).run();
  }

  async function markBatchFailure(
    db: D1Database,
    error: unknown,
  ): Promise<void> {
    await db.prepare(
      `UPDATE maintenance_jobs
          SET status = 'pending',
              last_error = ?,
              updated_at = datetime('now')
        WHERE job_key = ?`,
    ).bind(
      deps.getErrorMessage(error),
      REGULAR_MISSION_REBUILD_JOB_KEY,
    ).run();
  }

  async function runRegularMissionRebuildBatch(
    env: Env,
    db: D1Database,
  ): Promise<boolean> {
    const jobState = await acquireJobState(db);
    if (!jobState) {
      return false;
    }

    try {
      const userBatch = await loadUserBatch(db, jobState.cursor_user_id ?? null);
      if (userBatch.length === 0) {
        await markBatchSuccess(db, {
          nextCursor: jobState.cursor_user_id ?? null,
          processedCount: Number(jobState.processed_count ?? 0),
          completed: true,
        });
        return false;
      }

      for (const userId of userBatch) {
        await purgeRegularMissionsForUser(db, userId);
        deps.invalidateMissionListCache(userId);

        try {
          await deps.generateStructuredMissionPlanForUser(
            env,
            db,
            userId,
            {
              isAiSpecial: false,
              dailyTarget: MISSION_LIMITS.daily,
              weeklyTarget: MISSION_LIMITS.weekly,
              monthlyTarget: MISSION_LIMITS.monthly,
            },
          );
        } catch (error) {
          console.error("[missions][regular-rebuild][user]", {
            userId,
            message: deps.getErrorMessage(error),
          });
        }
      }

      const nextCursor = userBatch[userBatch.length - 1] ?? jobState.cursor_user_id ?? null;
      const processedCount = Number(jobState.processed_count ?? 0) + userBatch.length;
      const completed = userBatch.length < REGULAR_MISSION_REBUILD_BATCH_SIZE;
      await markBatchSuccess(db, {
        nextCursor,
        processedCount,
        completed,
      });
      return true;
    } catch (error) {
      await markBatchFailure(db, error);
      throw error;
    }
  }

  return {
    runRegularMissionRebuildBatch,
  };
}
