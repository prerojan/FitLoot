import type { Env } from "../core/types";

export type MissionRefreshMode = "safe" | "full";

type MissionListCacheEntry = {
  payload: Record<string, unknown>[];
  expiresAt: number;
};

type MissionRuntimeStateDeps = {
  ensurePeriodicMissions: (
    env: Env,
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  getErrorMessage: (error: unknown) => string;
  recomputeActivePeriodicMissionProgress: (
    userId: string,
    db: D1Database,
  ) => Promise<void>;
  repairLegacyDailyMissionMetadata: (
    env: Env,
    db: D1Database,
    userId: string,
    options?: { limit?: number | undefined },
  ) => Promise<void>;
  repairLegacyPeriodicMissions: (
    env: Env,
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  updateMonthlyMissionProgress: (
    userId: string,
    db: D1Database,
  ) => Promise<void>;
};

const MISSION_LIST_CACHE_TTL_MS = 90_000;
const MISSION_LIST_CACHE_MAX_ENTRIES = 400;
const MISSION_REFRESH_DEBOUNCE_MS = 5 * 60 * 1000;
const PERIODIC_PROGRESS_RECOMPUTE_DEBOUNCE_MS = 5 * 60 * 1000;
const MISSION_REFRESH_TRACK_TTL_MS = 24 * 60 * 60 * 1000;
const MISSION_REFRESH_TRACK_MAX_KEYS = 3_000;
const MISSION_REFRESH_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const DAILY_METADATA_REPAIR_DEBOUNCE_MS = 15 * 60 * 1000;

// Mantem o estado efemero de cache e locks de missao fora do entrypoint.
export function createMissionRuntimeStateService({
  ensurePeriodicMissions,
  getErrorMessage,
  recomputeActivePeriodicMissionProgress,
  repairLegacyDailyMissionMetadata,
  repairLegacyPeriodicMissions,
  updateMonthlyMissionProgress,
}: MissionRuntimeStateDeps) {
  const missionListCache = new Map<string, MissionListCacheEntry>();
  const missionRefreshLocks = new Map<string, Promise<void>>();
  const missionRefreshLastRun = new Map<string, number>();
  const periodicProgressRecomputeLocks = new Map<string, Promise<void>>();
  const periodicProgressRecomputeLastRun = new Map<string, number>();
  const dailyMetadataRepairLocks = new Map<string, Promise<void>>();
  const dailyMetadataRepairLastRun = new Map<string, number>();
  let missionRefreshLastCleanupAt = 0;

  function missionListCacheKey(userId: string): string {
    return `missions:${userId}`;
  }

  function readMissionListCache(userId: string): Record<string, unknown>[] | null {
    const entry = missionListCache.get(missionListCacheKey(userId));
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      missionListCache.delete(missionListCacheKey(userId));
      return null;
    }
    return entry.payload;
  }

  function writeMissionListCache(userId: string, payload: Record<string, unknown>[]): void {
    missionListCache.set(missionListCacheKey(userId), {
      payload,
      expiresAt: Date.now() + MISSION_LIST_CACHE_TTL_MS,
    });

    if (missionListCache.size <= MISSION_LIST_CACHE_MAX_ENTRIES) return;
    const oldestKey = missionListCache.keys().next().value;
    if (typeof oldestKey === "string") {
      missionListCache.delete(oldestKey);
    }
  }

  function clearMissionListCache(userId: string): void {
    missionListCache.delete(missionListCacheKey(userId));
  }

  function invalidateMissionListCache(userId: string): void {
    clearMissionListCache(userId);
    missionRefreshLastRun.delete(userId);
  }

  function cleanupMissionRefreshTracking(now: number): void {
    if (now - missionRefreshLastCleanupAt < MISSION_REFRESH_CLEANUP_INTERVAL_MS) return;

    for (const [trackedUserId, lastRun] of missionRefreshLastRun.entries()) {
      if (now - lastRun > MISSION_REFRESH_TRACK_TTL_MS) {
        missionRefreshLastRun.delete(trackedUserId);
      }
    }

    if (missionRefreshLastRun.size > MISSION_REFRESH_TRACK_MAX_KEYS) {
      const overflow = missionRefreshLastRun.size - MISSION_REFRESH_TRACK_MAX_KEYS;
      const iterator = missionRefreshLastRun.keys();
      for (let index = 0; index < overflow; index += 1) {
        const nextKey = iterator.next().value;
        if (typeof nextKey === "string") {
          missionRefreshLastRun.delete(nextKey);
        }
      }
    }

    missionRefreshLastCleanupAt = now;
  }

  function cleanupPeriodicProgressTracking(now: number): void {
    for (const [trackedUserId, lastRun] of periodicProgressRecomputeLastRun.entries()) {
      if (now - lastRun > MISSION_REFRESH_TRACK_TTL_MS) {
        periodicProgressRecomputeLastRun.delete(trackedUserId);
      }
    }

    if (periodicProgressRecomputeLastRun.size > MISSION_REFRESH_TRACK_MAX_KEYS) {
      const overflow = periodicProgressRecomputeLastRun.size - MISSION_REFRESH_TRACK_MAX_KEYS;
      const iterator = periodicProgressRecomputeLastRun.keys();
      for (let index = 0; index < overflow; index += 1) {
        const nextKey = iterator.next().value;
        if (typeof nextKey === "string") {
          periodicProgressRecomputeLastRun.delete(nextKey);
        }
      }
    }
  }

  function shouldDebounceMissionRefresh(userId: string, now: number): boolean {
    const lastRun = missionRefreshLastRun.get(userId) ?? 0;
    return now - lastRun < MISSION_REFRESH_DEBOUNCE_MS;
  }

  function shouldDebouncePeriodicProgressRecompute(userId: string, now: number): boolean {
    const lastRun = periodicProgressRecomputeLastRun.get(userId) ?? 0;
    return now - lastRun < PERIODIC_PROGRESS_RECOMPUTE_DEBOUNCE_MS;
  }

  function createPeriodicProgressRecomputePromise(
    userId: string,
    db: D1Database,
  ): Promise<void> {
    const inflight = periodicProgressRecomputeLocks.get(userId);
    if (inflight) {
      return inflight;
    }

    const recomputePromise = (async () => {
      try {
        await recomputeActivePeriodicMissionProgress(userId, db);
        clearMissionListCache(userId);
        periodicProgressRecomputeLastRun.set(userId, Date.now());
      } finally {
        periodicProgressRecomputeLocks.delete(userId);
      }
    })();

    periodicProgressRecomputeLocks.set(userId, recomputePromise);
    return recomputePromise;
  }

  function schedulePeriodicProgressRecomputeWithGuard(
    userId: string,
    db: D1Database,
    executionCtx: ExecutionContext,
  ): boolean {
    const now = Date.now();
    cleanupPeriodicProgressTracking(now);
    if (
      shouldDebouncePeriodicProgressRecompute(userId, now) ||
      periodicProgressRecomputeLocks.has(userId)
    ) {
      return false;
    }

    const recomputePromise = createPeriodicProgressRecomputePromise(userId, db);
    executionCtx.waitUntil(
      recomputePromise.catch((error) => {
        console.error("[missions][background-periodic-progress]", {
          userId,
          message: getErrorMessage(error),
        });
      }),
    );
    return true;
  }

  async function runMissionRefreshStepSafely(
    userId: string,
    phase: string,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error("[missions][refresh]", {
        userId,
        phase,
        message: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  function createMissionRefreshPromise(
    env: Env,
    db: D1Database,
    userId: string,
    mode: MissionRefreshMode = "safe",
  ): Promise<void> {
    const inflight = missionRefreshLocks.get(userId);
    if (inflight) {
      return inflight;
    }

    const refreshPromise = (async () => {
      try {
        await runMissionRefreshStepSafely(userId, "repair_legacy_periodic", () =>
          repairLegacyPeriodicMissions(env, db, userId),
        );
        if (mode === "full") {
          await runMissionRefreshStepSafely(userId, "ensure_periodic", () =>
            ensurePeriodicMissions(env, db, userId),
          );
          await runMissionRefreshStepSafely(
            userId,
            "repair_legacy_daily_metadata",
            () => repairLegacyDailyMissionMetadata(env, db, userId),
          );
        }
        await runMissionRefreshStepSafely(userId, "update_monthly_progress", () =>
          updateMonthlyMissionProgress(userId, db),
        );
        clearMissionListCache(userId);
        missionRefreshLastRun.set(userId, Date.now());
      } finally {
        missionRefreshLocks.delete(userId);
      }
    })();

    missionRefreshLocks.set(userId, refreshPromise);
    return refreshPromise;
  }

  async function ensurePeriodicMissionsWithGuard(
    env: Env,
    db: D1Database,
    userId: string,
    options?: { force?: boolean | undefined; mode?: MissionRefreshMode | undefined },
  ): Promise<void> {
    const mode = options?.mode ?? "safe";
    if (options?.force === true) {
      await createMissionRefreshPromise(env, db, userId, mode);
      return;
    }

    const now = Date.now();
    cleanupMissionRefreshTracking(now);
    if (shouldDebounceMissionRefresh(userId, now)) {
      return;
    }

    await createMissionRefreshPromise(env, db, userId, mode);
  }

  function schedulePeriodicMissionsRefreshWithGuard(
    env: Env,
    db: D1Database,
    userId: string,
    executionCtx: ExecutionContext,
    mode: MissionRefreshMode = "safe",
  ): boolean {
    const now = Date.now();
    cleanupMissionRefreshTracking(now);
    if (shouldDebounceMissionRefresh(userId, now) || missionRefreshLocks.has(userId)) {
      return false;
    }

    const refreshPromise = createMissionRefreshPromise(env, db, userId, mode);
    executionCtx.waitUntil(
      refreshPromise.catch((error) => {
        console.error("[missions][background-refresh]", {
          userId,
          message: getErrorMessage(error),
        });
      }),
    );

    return true;
  }

  function scheduleLegacyDailyMetadataRepairWithGuard(
    env: Env,
    db: D1Database,
    userId: string,
    executionCtx: ExecutionContext,
  ): boolean {
    const now = Date.now();
    const lastRun = dailyMetadataRepairLastRun.get(userId) ?? 0;
    if (now - lastRun < DAILY_METADATA_REPAIR_DEBOUNCE_MS) {
      return false;
    }

    const inflight = dailyMetadataRepairLocks.get(userId);
    if (inflight) {
      return false;
    }

    const repairPromise = (async () => {
      try {
        await repairLegacyDailyMissionMetadata(env, db, userId, { limit: 4 });
        clearMissionListCache(userId);
        dailyMetadataRepairLastRun.set(userId, Date.now());
      } catch (error) {
        console.error("[missions][legacy-daily-repair]", {
          userId,
          message: getErrorMessage(error),
        });
      } finally {
        dailyMetadataRepairLocks.delete(userId);
      }
    })();

    dailyMetadataRepairLocks.set(userId, repairPromise);
    executionCtx.waitUntil(repairPromise);
    return true;
  }

  return {
    clearMissionListCache,
    ensurePeriodicMissionsWithGuard,
    invalidateMissionListCache,
    readMissionListCache,
    scheduleLegacyDailyMetadataRepairWithGuard,
    schedulePeriodicMissionsRefreshWithGuard,
    schedulePeriodicProgressRecomputeWithGuard,
    writeMissionListCache,
  };
}
