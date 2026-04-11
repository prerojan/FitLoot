import { MISSION_LIMITS } from "../../constants/missionMetrics";
import { hasTableColumn } from "../core/database";
import type { Env } from "../core/types";

const REGULAR_MISSION_REBUILD_JOB_KEY = "regular_mission_cycle_rebuild_v1";
const REGULAR_MISSION_REBUILD_BATCH_SIZE = 25;
const REGULAR_MISSION_REBUILD_LOCK_TTL_MS = 15 * 60_000;
const REGULAR_MISSION_REBUILD_RUN_BUDGET_MS = 20_000;
const REGULAR_MISSION_REBUILD_PER_USER_TIMEOUT_MS = 15_000;

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
  cursor: string | null;
  status: string | null;
  processedCount: number;
  lastError: string | null;
  started_at: string | null;
};

type MaintenanceJobSchema = "generic" | "legacy";

type MaintenanceJobPayload = {
  processedCount?: number;
  lastError?: string | null;
};

function parseMaintenanceJobPayload(value: string | null | undefined): MaintenanceJobPayload {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as MaintenanceJobPayload | null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function serializeMaintenanceJobPayload(payload: MaintenanceJobPayload): string {
  const normalized: MaintenanceJobPayload = {};
  const processedCount = Number(payload.processedCount ?? 0);
  if (Number.isFinite(processedCount) && processedCount > 0) {
    normalized.processedCount = processedCount;
  }
  if (typeof payload.lastError === "string" && payload.lastError.trim().length > 0) {
    normalized.lastError = payload.lastError.trim();
  }
  return JSON.stringify(normalized);
}

async function ensureMaintenanceJobSchema(db: D1Database): Promise<MaintenanceJobSchema> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS maintenance_jobs (
       job_key TEXT PRIMARY KEY,
       status TEXT NOT NULL DEFAULT 'pending',
       cursor TEXT,
       payload_json TEXT NOT NULL DEFAULT '{}',
       started_at TEXT,
       completed_at TEXT,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  ).run();

  const hasGenericCursor = await hasTableColumn(db, "maintenance_jobs", "cursor");
  if (hasGenericCursor) {
    return "generic";
  }

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

  return "legacy";
}

export function createRegularMissionRebuildService(
  deps: RegularMissionRebuildDeps,
) {
  async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  function createDeterministicRebuildEnv(env: Env): Env {
    return {
      ...env,
      OPENROUTER_API_KEY: undefined,
    };
  }

  function buildBatchErrorSummary(
    failedUsers: number,
    batchSize: number,
    firstFailureMessage: string | null,
  ): string | null {
    return failedUsers > 0
      ? `batch_failed_users=${failedUsers}/${batchSize}; first=${firstFailureMessage ?? "UNKNOWN"}`
      : null;
  }

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
    schema: MaintenanceJobSchema,
  ): Promise<MaintenanceJobRow | null> {
    if (schema === "generic") {
      await db.prepare(
        `INSERT INTO maintenance_jobs (
           job_key,
           status,
           cursor,
           payload_json,
           updated_at
         ) VALUES (?, 'pending', NULL, '{}', datetime('now'))
         ON CONFLICT(job_key) DO NOTHING`,
      ).bind(REGULAR_MISSION_REBUILD_JOB_KEY).run();
    } else {
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
    }

    const current = schema === "generic"
      ? await db.prepare(
        `SELECT cursor as cursor_value, payload_json, status, started_at
           FROM maintenance_jobs
          WHERE job_key = ?`,
      ).bind(REGULAR_MISSION_REBUILD_JOB_KEY).first<{
        cursor_value: string | null;
        payload_json: string | null;
        status: string | null;
        started_at: string | null;
      }>()
      : await db.prepare(
        `SELECT cursor_user_id as cursor_value, status, processed_count, last_error, started_at
           FROM maintenance_jobs
          WHERE job_key = ?`,
      ).bind(REGULAR_MISSION_REBUILD_JOB_KEY).first<{
        cursor_value: string | null;
        status: string | null;
        processed_count: number | null;
        last_error: string | null;
        started_at: string | null;
      }>();

    if (!current) {
      return null;
    }
    const genericPayload = schema === "generic"
      ? parseMaintenanceJobPayload(
        (current as { payload_json?: string | null }).payload_json ?? null,
      )
      : {};
    const normalizedCurrent: MaintenanceJobRow = {
      cursor: (current as { cursor_value?: string | null }).cursor_value ?? null,
      status: current.status ?? null,
      processedCount: schema === "generic"
        ? Number(genericPayload.processedCount ?? 0)
        : Number((current as { processed_count?: number | null }).processed_count ?? 0),
      lastError: schema === "generic"
        ? (typeof genericPayload.lastError === "string" ? genericPayload.lastError : null)
        : ((current as { last_error?: string | null }).last_error ?? null),
      started_at: current.started_at ?? null,
    };

    if (normalizedCurrent.status === "completed") {
      return null;
    }
    if (normalizedCurrent.status === "running" && !isStaleRunningJob(normalizedCurrent.started_at)) {
      return null;
    }

    const claim = schema === "generic"
      ? await db.prepare(
        `UPDATE maintenance_jobs
            SET status = 'running',
                started_at = datetime('now'),
                completed_at = NULL,
                payload_json = ?,
                updated_at = datetime('now')
          WHERE job_key = ?
            AND (
              status != 'running'
              OR started_at IS NULL
              OR datetime(started_at) < datetime('now', '-15 minutes')
            )`,
      ).bind(
        serializeMaintenanceJobPayload({
          processedCount: normalizedCurrent.processedCount,
          lastError: null,
        }),
        REGULAR_MISSION_REBUILD_JOB_KEY,
      ).run()
      : await db.prepare(
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

    return normalizedCurrent;
  }

  async function loadUserBatch(
    db: D1Database,
    cursorUserId: string | null,
  ): Promise<string[]> {
    const normalizedCursor = typeof cursorUserId === "string"
      ? cursorUserId.trim()
      : "";
    const rows = await db.prepare(
      `SELECT user_id
         FROM user_profiles
        WHERE user_id > ?
        ORDER BY user_id
        LIMIT ?`,
    ).bind(
      normalizedCursor,
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
    schema: MaintenanceJobSchema,
    params: {
      nextCursor: string | null;
      processedCount: number;
      completed: boolean;
      lastError?: string | null;
    },
  ): Promise<void> {
    if (schema === "generic") {
      await db.prepare(
        `UPDATE maintenance_jobs
            SET cursor = ?,
                payload_json = ?,
                status = ?,
                completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
                updated_at = datetime('now')
          WHERE job_key = ?`,
      ).bind(
        params.nextCursor,
        serializeMaintenanceJobPayload({
          processedCount: params.processedCount,
          lastError: params.lastError ?? null,
        }),
        params.completed ? "completed" : "pending",
        params.completed ? 1 : 0,
        REGULAR_MISSION_REBUILD_JOB_KEY,
      ).run();
      return;
    }

    await db.prepare(
      `UPDATE maintenance_jobs
          SET cursor_user_id = ?,
              processed_count = ?,
              status = ?,
              last_error = ?,
              finished_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
              updated_at = datetime('now')
        WHERE job_key = ?`,
    ).bind(
      params.nextCursor,
      params.processedCount,
      params.completed ? "completed" : "pending",
      params.lastError ?? null,
      params.completed ? 1 : 0,
      REGULAR_MISSION_REBUILD_JOB_KEY,
    ).run();
  }

  async function markBatchFailure(
    db: D1Database,
    schema: MaintenanceJobSchema,
    currentState: MaintenanceJobRow | null,
    error: unknown,
  ): Promise<void> {
    const message = deps.getErrorMessage(error);
    if (schema === "generic") {
      await db.prepare(
        `UPDATE maintenance_jobs
            SET status = 'pending',
                payload_json = ?,
                updated_at = datetime('now')
          WHERE job_key = ?`,
      ).bind(
        serializeMaintenanceJobPayload({
          processedCount: Number(currentState?.processedCount ?? 0),
          lastError: message,
        }),
        REGULAR_MISSION_REBUILD_JOB_KEY,
      ).run();
      return;
    }

    await db.prepare(
      `UPDATE maintenance_jobs
          SET status = 'pending',
              last_error = ?,
              updated_at = datetime('now')
        WHERE job_key = ?`,
    ).bind(
      message,
      REGULAR_MISSION_REBUILD_JOB_KEY,
    ).run();
  }

  async function runRegularMissionRebuildBatch(
    env: Env,
    db: D1Database,
  ): Promise<boolean> {
    const schema = await ensureMaintenanceJobSchema(db);
    const jobState = await acquireJobState(db, schema);
    if (!jobState) {
      return false;
    }

    try {
      const rebuildEnv = createDeterministicRebuildEnv(env);
      const userBatch = await loadUserBatch(db, jobState.cursor ?? null);
      let failedUsers = 0;
      let firstFailureMessage: string | null = null;
      let processedCount = Number(jobState.processedCount ?? 0);
      let lastProcessedCursor = jobState.cursor ?? null;
      const runStartedAt = Date.now();
      if (userBatch.length === 0) {
        await markBatchSuccess(db, schema, {
          nextCursor: jobState.cursor ?? null,
          processedCount,
          completed: true,
          lastError: null,
        });
        return false;
      }

      for (let index = 0; index < userBatch.length; index += 1) {
        const userId = userBatch[index]!;
        await purgeRegularMissionsForUser(db, userId);
        deps.invalidateMissionListCache(userId);

        try {
          const generationResult = await withTimeout(
            deps.generateStructuredMissionPlanForUser(
              rebuildEnv,
              db,
              userId,
              {
                isAiSpecial: false,
                dailyTarget: MISSION_LIMITS.daily,
                weeklyTarget: MISSION_LIMITS.weekly,
                monthlyTarget: MISSION_LIMITS.monthly,
              },
            ),
            REGULAR_MISSION_REBUILD_PER_USER_TIMEOUT_MS,
            `REGULAR_MISSION_REBUILD_TIMEOUT:${userId}`,
          );
          if ((generationResult as { missions?: unknown[] | null }).missions?.length === 0) {
            failedUsers += 1;
            firstFailureMessage ??= "MISSION_GENERATION_RESULT_EMPTY";
          }
        } catch (error) {
          failedUsers += 1;
          firstFailureMessage ??= deps.getErrorMessage(error);
          console.error("[missions][regular-rebuild][user]", {
            userId,
            message: deps.getErrorMessage(error),
          });
        }

        processedCount += 1;
        lastProcessedCursor = userId;

        const remainingUsers = userBatch.length - index - 1;
        if (
          remainingUsers > 0
          && Date.now() - runStartedAt >= REGULAR_MISSION_REBUILD_RUN_BUDGET_MS
        ) {
          await markBatchSuccess(db, schema, {
            nextCursor: lastProcessedCursor,
            processedCount,
            completed: false,
            lastError: buildBatchErrorSummary(
              failedUsers,
              processedCount - Number(jobState.processedCount ?? 0),
              firstFailureMessage,
            ),
          });
          return true;
        }
      }

      const nextCursor = lastProcessedCursor;
      const completed = userBatch.length < REGULAR_MISSION_REBUILD_BATCH_SIZE;
      await markBatchSuccess(db, schema, {
        nextCursor,
        processedCount,
        completed,
        lastError: buildBatchErrorSummary(
          failedUsers,
          processedCount - Number(jobState.processedCount ?? 0),
          firstFailureMessage,
        ),
      });
      return true;
    } catch (error) {
      await markBatchFailure(db, schema, jobState, error);
      throw error;
    }
  }

  return {
    runRegularMissionRebuildBatch,
  };
}
