import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  CompleteMissionRequestSchema,
  type CircuitTask,
  type MissionMetricType,
} from "../../shared/types";
import { MISSION_LIMITS } from "../../constants/missionMetrics";
import { assertString, safeGet } from "../../utils/typeHelpers";
import { hasTableColumn } from "../core/database";
import {
  getErrorMessage,
  internalErrorResponse,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import { getHuggingFaceApiKey } from "../core/providerConfig";
import type { AppContext } from "../core/types";

type StreamJsonArrayResponse = (
  items: readonly unknown[],
  status?: number,
) => Response;

type NormalizedMissionRowLike = Record<string, unknown> & {
  type: string;
  circuit_tasks: CircuitTask[];
  progress_value?: number | undefined;
  exercise_instructions_en: string[];
  exercise_instructions_pt: string[];
  exercise_name?: string | null | undefined;
  title?: string | undefined;
  metric_type?: unknown;
  sets?: number | null | undefined;
  rest_seconds?: number | null | undefined;
  instructions: string[];
  metric_value?: number | null | undefined;
  is_completed?: number | null | undefined;
};

type StructuredMissionPlanResult = {
  already_active: boolean;
  used_ai: boolean;
  invalid_ratio: number | null | undefined;
  missions: unknown[];
};

type MissionAttributeDelta = {
  strength: number;
  constitution: number;
  vitality: number;
  dexterity: number;
  focus: number;
};

type WithTransaction = <T>(
  db: D1Database,
  run: () => Promise<T>,
) => Promise<T>;

type MissionRouteDeps = {
  applyMissionAttributeDeltaToUser: (
    db: D1Database,
    userId: string,
    delta: MissionAttributeDelta,
  ) => Promise<void>;
  applyXpPointsAndResolveLevels: (
    db: D1Database,
    userId: string,
    xpDelta: number,
    pointsDelta: number,
  ) => Promise<{
    leveledUp: boolean;
    newLevel: number;
    levelsGained: number;
  }>;
  checkMissionRelevance: (
    userId: string,
    missionId: number,
    db: D1Database,
    status: "completed" | "failed",
  ) => Promise<{ isGoalRelevant: boolean }>;
  clearMissionListCache: (userId: string) => void;
  computeMissionTypeAttributeDelta: (
    missionRecord: Record<string, unknown>,
    missionMetricType: MissionMetricType,
    completedMetricValue: number,
  ) => MissionAttributeDelta;
  ensureInstructionSteps: (
    steps: string[],
    exerciseName: string,
    metricType: MissionMetricType,
    sets: number | null | undefined,
    restSeconds: number | null | undefined,
  ) => string[];
  ensurePeriodicMissionsWithGuard: (
    env: AppContext["Bindings"],
    db: D1Database,
    userId: string,
    options: { force?: boolean; mode?: "safe" | "full" | undefined },
  ) => Promise<void>;
  ensureUserAttributesRow: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  ensureUserCounterRow: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  extractExerciseName: (title: string) => string;
  generateStructuredMissionPlanForUser: (
    env: AppContext["Bindings"],
    db: D1Database,
    userId: string,
    options: {
      isAiSpecial: boolean;
      dailyTarget: number;
      weeklyTarget: number;
      monthlyTarget: number;
    },
  ) => Promise<StructuredMissionPlanResult>;
  getMonthlyCounters: (
    db: D1Database,
    userId: string,
  ) => Promise<unknown>;
  hydrateMissionRowsWithSubtasks: (
    db: D1Database,
    rows: Record<string, unknown>[],
  ) => Promise<Record<string, unknown>[]>;
  invalidateMissionListCache: (userId: string) => void;
  invalidateRankingCache: () => void;
  logUserEvent: (
    db: D1Database,
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  missionSummaryFromNormalized: (
    mission: Record<string, unknown>,
  ) => Record<string, unknown>;
  monthlyMissionProgressValue: (
    mission: Record<string, unknown>,
    monthlyCounters: unknown,
  ) => number;
  normalizeInstructionList: (value: unknown, maxLength?: number) => string[];
  normalizeMatchText: (value: string) => string;
  normalizeMissionMetricType: (
    rawType: unknown,
    rawTargetTime: unknown,
  ) => MissionMetricType;
  normalizeMissionRow: (
    row: Record<string, unknown>,
  ) => Record<string, unknown>;
  onGoalProgress: (
    db: D1Database,
    userId: string,
    progressPercent: number,
  ) => Promise<void>;
  onMissionComplete: (
    db: D1Database,
    userId: string,
    missionId: number,
  ) => Promise<void>;
  onStreakContinued: (
    db: D1Database,
    userId: string,
    streakDays: number,
    missionsCompletedToday: number,
    timestamp: string,
  ) => Promise<void>;
  readMissionListCache: (userId: string) => Record<string, unknown>[] | null;
  runMissionLifecycleHookSafely: (
    userId: string,
    label: string,
    action: () => Promise<void>,
  ) => Promise<void>;
  scheduleLegacyDailyMetadataRepairWithGuard: (
    env: AppContext["Bindings"],
    db: D1Database,
    userId: string,
    executionCtx: ExecutionContext,
  ) => void;
  schedulePeriodicMissionsRefreshWithGuard: (
    env: AppContext["Bindings"],
    db: D1Database,
    userId: string,
    executionCtx: ExecutionContext,
    mode: "safe" | "full",
  ) => unknown;
  schedulePeriodicProgressRecomputeWithGuard: (
    userId: string,
    db: D1Database,
    executionCtx: ExecutionContext,
  ) => void;
  streamJsonArrayResponse: StreamJsonArrayResponse;
  totalSkillTableAttributeGain: (
    skill: Record<string, unknown>,
  ) => number;
  translateExerciseInstructionsToPt: (
    steps: string[],
    exerciseName: string,
    env: AppContext["Bindings"],
  ) => Promise<string[]>;
  tryUnlockSkillsFromPerformance: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  unlockAchievementIfNeeded: (
    db: D1Database,
    userId: string,
    achievementName: string,
    progressCurrent: number,
    progressRequired: number,
  ) => Promise<void>;
  updateCircuitProgress: (
    userId: string,
    mission: Record<string, unknown>,
    db: D1Database,
  ) => Promise<void>;
  updateMissionSubtaskProgress: (
    userId: string,
    mission: Record<string, unknown>,
    db: D1Database,
  ) => Promise<void>;
  updateMonthlyMissionProgress: (
    userId: string,
    db: D1Database,
  ) => Promise<void>;
  withTransaction: WithTransaction;
  writeMissionListCache: (
    userId: string,
    payload: Record<string, unknown>[],
  ) => void;
};

// Route registration for mission list, mission detail, generation, and completion.
export function registerMissionRoutes(
  app: Hono<AppContext>,
  deps: MissionRouteDeps,
  authMiddleware: MiddlewareHandler<AppContext>,
): void {
  const {
    clearMissionListCache,
    generateStructuredMissionPlanForUser,
    getMonthlyCounters,
    hydrateMissionRowsWithSubtasks,
    missionSummaryFromNormalized,
    monthlyMissionProgressValue,
    normalizeMissionRow,
    readMissionListCache,
    scheduleLegacyDailyMetadataRepairWithGuard,
    schedulePeriodicMissionsRefreshWithGuard,
    schedulePeriodicProgressRecomputeWithGuard,
    streamJsonArrayResponse,
    writeMissionListCache,
  } = deps;

  app.get("/api/missions", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const forceRefresh = c.req.query("refresh") === "1";
      if (forceRefresh) {
        clearMissionListCache(user.id);
      }

      schedulePeriodicMissionsRefreshWithGuard(
        c.env,
        c.env.fitloot_db,
        user.id,
        c.executionCtx,
        "safe",
      );
      scheduleLegacyDailyMetadataRepairWithGuard(
        c.env,
        c.env.fitloot_db,
        user.id,
        c.executionCtx,
      );
      schedulePeriodicProgressRecomputeWithGuard(
        user.id,
        c.env.fitloot_db,
        c.executionCtx,
      );

      const cached = !forceRefresh ? readMissionListCache(user.id) : null;
      if (!forceRefresh && cached) {
        return streamJsonArrayResponse(cached);
      }

      if (!forceRefresh) {
        const refreshedCache = readMissionListCache(user.id);
        if (refreshedCache) {
          return streamJsonArrayResponse(refreshedCache);
        }
      }

      let missions;
      try {
        missions = await c.env.fitloot_db
          .prepare(
            `SELECT m.*, s.name as skill_name FROM missions m
            LEFT JOIN skills s ON m.skill_id = s.id
            WHERE m.user_id = ?
            AND (
              (m.is_completed = 0 AND (m.deadline IS NULL OR m.deadline > datetime('now')))
              OR (m.is_completed = 1 AND datetime(COALESCE(m.completed_at, m.updated_at)) >= datetime('now', '-30 day'))
              OR (COALESCE(m.status,'pending') IN ('failed', 'expired') AND date(m.updated_at) >= date('now', '-3 day'))
            )
            ORDER BY CASE m.type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 ELSE 4 END, m.created_at DESC
            LIMIT 240`,
          )
          .bind(user.id)
          .all();
      } catch (statusQueryError) {
        const message = getErrorMessage(statusQueryError).toLowerCase();
        const missingStatusColumn =
          message.includes("no such column") && message.includes("status");
        if (!missingStatusColumn) {
          throw statusQueryError;
        }

        missions = await c.env.fitloot_db
          .prepare(
            `SELECT m.*, s.name as skill_name FROM missions m
            LEFT JOIN skills s ON m.skill_id = s.id
            WHERE m.user_id = ?
            AND (
              (m.is_completed = 0 AND (m.deadline IS NULL OR m.deadline > datetime('now')))
              OR (m.is_completed = 1 AND datetime(COALESCE(m.completed_at, m.updated_at)) >= datetime('now', '-30 day'))
            )
            ORDER BY CASE m.type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 ELSE 4 END, m.created_at DESC
            LIMIT 240`,
          )
          .bind(user.id)
          .all();
      }

      const missionList = await hydrateMissionRowsWithSubtasks(
        c.env.fitloot_db,
        (Array.isArray(missions.results) ? missions.results : []) as Record<
          string,
          unknown
        >[],
      );
      const monthlyCounters = await getMonthlyCounters(c.env.fitloot_db, user.id);
      const withProgress = missionList.map((row) => {
        const rawMission = row as Record<string, unknown>;
        const normalizedMission = normalizeMissionRow(
          rawMission,
        ) as NormalizedMissionRowLike;
        const isMonthly = rawMission.type === "monthly";
        if (!isMonthly) return normalizedMission;
        if (
          normalizedMission.circuit_tasks.length > 0 &&
          normalizedMission.progress_value !== undefined
        ) {
          return normalizedMission;
        }

        const isCompleted = Number(rawMission.is_completed ?? 0) === 1;
        return {
          ...normalizedMission,
          progress_value: isCompleted
            ? Number(normalizedMission.metric_value ?? 1)
            : monthlyMissionProgressValue(rawMission, monthlyCounters),
        };
      });
      const summaries = withProgress.map((mission) =>
        missionSummaryFromNormalized(mission),
      );
      writeMissionListCache(user.id, summaries);
      return streamJsonArrayResponse(summaries);
    } catch (error) {
      console.error("[/api/missions]", {
        message: getErrorMessage(error),
        userId: user.id,
      });

      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      return internalErrorResponse(c);
    }
  });

  app.get("/api/missions/:id", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const missionId = Number(c.req.param("id"));
    if (!Number.isInteger(missionId) || missionId <= 0) {
      return c.json({ error: "Mission id invalido" }, 400);
    }

    try {
      const row = await c.env.fitloot_db
        .prepare(
          `SELECT m.*, s.name as skill_name
           FROM missions m
           LEFT JOIN skills s ON m.skill_id = s.id
           WHERE m.id = ? AND m.user_id = ?`,
        )
        .bind(missionId, user.id)
        .first<Record<string, unknown>>();

      if (!row) {
        return c.json({ error: "Mission not found" }, 404);
      }

      const hydratedRows = await hydrateMissionRowsWithSubtasks(
        c.env.fitloot_db,
        [row],
      );
      const normalized = deps.normalizeMissionRow(
        (hydratedRows[0] ?? row) as Record<string, unknown>,
      ) as NormalizedMissionRowLike;
      if (
        normalized.type === "monthly" &&
        Number(normalized.is_completed ?? 0) !== 1 &&
        !(
          normalized.circuit_tasks.length > 0 &&
          normalized.progress_value !== undefined
        )
      ) {
        const monthlyCounters = await getMonthlyCounters(
          c.env.fitloot_db,
          user.id,
        );
        normalized.progress_value = monthlyMissionProgressValue(
          row,
          monthlyCounters,
        );
      }

      const enSteps = normalized.exercise_instructions_en;
      const ptSteps = normalized.exercise_instructions_pt;
      if (
        normalized.type === "daily" &&
        getHuggingFaceApiKey(c.env) &&
        enSteps.length > 0 &&
        (ptSteps.length === 0 ||
          (ptSteps.length === enSteps.length &&
            ptSteps.every(
              (line, index) =>
                deps.normalizeMatchText(line) ===
                deps.normalizeMatchText(enSteps[index] ?? ""),
            )))
      ) {
        const exerciseLabel =
          typeof normalized.exercise_name === "string" &&
          normalized.exercise_name.trim().length > 0
            ? normalized.exercise_name.trim()
            : deps.extractExerciseName(String(normalized.title ?? ""));
        const ptTranslated = await deps.translateExerciseInstructionsToPt(
          enSteps,
          exerciseLabel,
          c.env,
        );
        if (ptTranslated.length > 0) {
          normalized.exercise_instructions_pt = ptTranslated;
          const mainSteps = deps.normalizeInstructionList(normalized.instructions, 8);
          const refreshMain =
            mainSteps.length === 0 ||
            (mainSteps.length === enSteps.length &&
              mainSteps.every(
                (line, index) =>
                  deps.normalizeMatchText(line) ===
                  deps.normalizeMatchText(enSteps[index] ?? ""),
              ));
          if (refreshMain) {
            normalized.instructions = deps.ensureInstructionSteps(
              deps.normalizeInstructionList(ptTranslated, 6),
              exerciseLabel,
              normalized.metric_type as MissionMetricType,
              normalized.sets,
              normalized.rest_seconds,
            );
          }
          c.executionCtx.waitUntil(
            (async () => {
              try {
                await c.env.fitloot_db
                  .prepare(
                    `UPDATE missions SET exercise_instructions_pt_json = ?, instructions_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
                  )
                  .bind(
                    JSON.stringify(ptTranslated),
                    JSON.stringify(normalized.instructions),
                    missionId,
                    user.id,
                  )
                  .run();
              } catch (persistErr) {
                console.error(
                  "[/api/missions/:id] persist translated instructions failed",
                  {
                    missionId,
                    message: getErrorMessage(persistErr),
                  },
                );
              }
            })(),
          );
        }
      }

      return c.json(normalized);
    } catch (error) {
      console.error("[/api/missions/:id]", {
        message: getErrorMessage(error),
        userId: user.id,
        missionId,
      });

      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      return internalErrorResponse(c);
    }
  });

  app.post("/api/missions/generate", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const result = await generateStructuredMissionPlanForUser(
        c.env,
        c.env.fitloot_db,
        user.id,
        {
          isAiSpecial: false,
          dailyTarget: MISSION_LIMITS.daily,
          weeklyTarget: MISSION_LIMITS.weekly,
          monthlyTarget: MISSION_LIMITS.monthly,
        },
      );

      return c.json({
        success: true,
        generated: !result.already_active,
        code: result.already_active ? "MISSIONS_ALREADY_ACTIVE" : undefined,
        used_ai: result.used_ai,
        invalid_ratio: result.invalid_ratio,
        missions: result.missions,
      });
    } catch (error) {
      console.error("[/api/missions/generate]", {
        message: getErrorMessage(error),
        userId: user.id,
      });
      return internalErrorResponse(c);
    }
  });

  app.post("/api/missions/generate/ai-special", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const result = await generateStructuredMissionPlanForUser(
        c.env,
        c.env.fitloot_db,
        user.id,
        {
          isAiSpecial: true,
          dailyTarget: 1,
          weeklyTarget: 0,
          monthlyTarget: 0,
        },
      );

      return c.json({
        success: true,
        generated: !result.already_active,
        code: result.already_active ? "AI_SPECIAL_ALREADY_ACTIVE" : undefined,
        used_ai: result.used_ai,
        invalid_ratio: result.invalid_ratio,
        missions: result.missions,
      });
    } catch (error) {
      console.error("[/api/missions/generate/ai-special]", {
        message: getErrorMessage(error),
        userId: user.id,
      });
      return internalErrorResponse(c);
    }
  });

  app.post(
    "/api/missions/complete",
    authMiddleware,
    zValidator("json", CompleteMissionRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const data = c.req.valid("json");
      const completedMetricValue = Number(
        data.metric_completed ??
          data.reps_completed ??
          data.time_completed ??
          0,
      );
      let completionPhase = "load_mission";

      try {
        const mission = await c.env.fitloot_db
          .prepare(
            "SELECT * FROM missions WHERE id = ? AND user_id = ? AND is_completed = 0",
          )
          .bind(data.mission_id, user.id)
          .first<Record<string, unknown>>();

        if (!mission) {
          return c.json({ error: "Mission not found" }, 404);
        }

        const missionId = Number(mission.id ?? 0);
        if (!Number.isInteger(missionId) || missionId <= 0) {
          return c.json({ error: "Mission not found" }, 404);
        }

        const missionType = String(mission.type ?? "");
        if (missionType === "weekly" || missionType === "monthly") {
          return c.json(
            {
              error:
                "Missoes semanais e mensais nao podem ser concluidas manualmente. O progresso acontece automaticamente pelas missoes diarias compativeis.",
              code: "MISSION_AUTO_PROGRESS_ONLY",
            },
            400,
          );
        }

        let streakMultiplier = 1;
        let xpGained = 0;
        let pointsGained = 0;
        let leveledUp = false;

        completionPhase = "schema_probe";
        const [
          missionsTableHasStatus,
          countersHaveConsecutiveDays,
          countersHaveLongestDays,
        ] = await Promise.all([
          hasTableColumn(c.env.fitloot_db, "missions", "status"),
          hasTableColumn(
            c.env.fitloot_db,
            "user_event_counters",
            "consecutive_days_completed",
          ),
          hasTableColumn(
            c.env.fitloot_db,
            "user_event_counters",
            "longest_consecutive_days",
          ),
        ]);
        const countersHaveStreakDayColumns =
          countersHaveConsecutiveDays && countersHaveLongestDays;

        completionPhase = "transaction";
        await deps.withTransaction(c.env.fitloot_db, async () => {
          completionPhase = "mark_completed";
          if (missionsTableHasStatus) {
            await c.env.fitloot_db
              .prepare(
                `UPDATE missions SET is_completed = 1, status = 'completed', completed_at = datetime('now'),
                verified_by_sensor = ?, updated_at = datetime('now')
                WHERE id = ?`,
              )
              .bind(data.sensor_verified ? 1 : 0, data.mission_id)
              .run();
          } else {
            await c.env.fitloot_db
              .prepare(
                `UPDATE missions SET is_completed = 1, completed_at = datetime('now'),
                verified_by_sensor = ?, updated_at = datetime('now')
                WHERE id = ?`,
              )
              .bind(data.sensor_verified ? 1 : 0, data.mission_id)
              .run();
          }

          completionPhase = "load_progression";
          const progression = await c.env.fitloot_db
            .prepare("SELECT * FROM user_progression WHERE user_id = ?")
            .bind(user.id)
            .first<{
              current_streak?: number | null;
              last_activity_date?: string | null;
            }>();

          const today = assertString(
            safeGet(new Date().toISOString().split("T"), 0),
          );
          let newStreak = Number(progression?.current_streak || 0);

          if (progression?.last_activity_date !== today) {
            completionPhase = "calculate_streak";
            const yesterday = assertString(
              safeGet(
                new Date(Date.now() - 86_400_000).toISOString().split("T"),
                0,
              ),
            );
            newStreak = 1;

            if (progression?.last_activity_date === yesterday) {
              newStreak = Number(progression?.current_streak || 0) + 1;
            }

            streakMultiplier = 1 + newStreak * 0.1;

            completionPhase = "update_streak_db";
            await c.env.fitloot_db
              .prepare(
                `UPDATE user_progression SET current_streak = ?, best_streak = MAX(best_streak, ?), 
                  last_activity_date = ?, updated_at = datetime('now')
                  WHERE user_id = ?`,
              )
              .bind(newStreak, newStreak, today, user.id)
              .run();
          } else {
            streakMultiplier =
              1 + Number(progression?.current_streak || 0) * 0.1;
          }

          completionPhase = "calculate_rewards";
          xpGained = Math.max(
            0,
            Math.floor(Number(mission.xp_reward || 0) * streakMultiplier),
          );
          pointsGained = Math.max(0, Number(mission.points_reward || 0));

          completionPhase = "award_xp_and_levels";
          const progressionOutcome = await deps.applyXpPointsAndResolveLevels(
            c.env.fitloot_db,
            user.id,
            xpGained,
            pointsGained,
          );
          leveledUp = progressionOutcome.leveledUp;

          completionPhase = "update_event_counters_db";
          await deps.ensureUserCounterRow(c.env.fitloot_db, user.id);
          const currentHour = new Date().getHours();
          if (countersHaveStreakDayColumns) {
            await c.env.fitloot_db
              .prepare(
                `UPDATE user_event_counters
                  SET missions_completed = COALESCE(missions_completed, 0) + 1,
                      consecutive_days_completed = ?,
                      longest_consecutive_days = MAX(COALESCE(longest_consecutive_days, 0), ?),
                      updated_at = datetime('now')
                  WHERE user_id = ?`,
              )
              .bind(newStreak, newStreak, user.id)
              .run();
          } else {
            await c.env.fitloot_db
              .prepare(
                `UPDATE user_event_counters
                  SET missions_completed = COALESCE(missions_completed, 0) + 1,
                      updated_at = datetime('now')
                  WHERE user_id = ?`,
              )
              .bind(user.id)
              .run();
          }

          completionPhase = "lifecycle_mission_events";
          await deps.runMissionLifecycleHookSafely(
            user.id,
            "mission_complete_event",
            () =>
              deps.logUserEvent(c.env.fitloot_db, user.id, "mission_complete", {
                missionId,
                period: missionType,
                xpGained,
                pointsGained,
                hour: currentHour,
                leveledUp,
              }),
          );

          completionPhase = "lifecycle_streak";
          const completedToday = await c.env.fitloot_db
            .prepare(
              "SELECT COUNT(*) as c FROM missions WHERE user_id = ? AND is_completed = 1 AND date(completed_at) = date('now')",
            )
            .bind(user.id)
            .first<{ c: number }>();
          await deps.runMissionLifecycleHookSafely(user.id, "streak_continued", () =>
            deps.onStreakContinued(
              c.env.fitloot_db,
              user.id,
              newStreak,
              Number(completedToday?.c ?? 1),
              new Date().toISOString(),
            ),
          );

          completionPhase = "lifecycle_on_mission_complete";
          await deps.runMissionLifecycleHookSafely(
            user.id,
            "on_mission_complete_hook",
            () => deps.onMissionComplete(c.env.fitloot_db, user.id, missionId),
          );

          completionPhase = "lifecycle_subtasks";
          await deps.runMissionLifecycleHookSafely(
            user.id,
            "update_subtasks",
            () =>
              deps.updateMissionSubtaskProgress(
                user.id,
                mission,
                c.env.fitloot_db,
              ),
          );

          completionPhase = "lifecycle_weekly_circuits";
          await deps.runMissionLifecycleHookSafely(
            user.id,
            "update_weekly_circuits",
            () => deps.updateCircuitProgress(user.id, mission, c.env.fitloot_db),
          );

          completionPhase = "lifecycle_monthly_progress";
          await deps.runMissionLifecycleHookSafely(
            user.id,
            "update_monthly_progress",
            () => deps.updateMonthlyMissionProgress(user.id, c.env.fitloot_db),
          );

          completionPhase = "lifecycle_goal_progress";
          await deps.runMissionLifecycleHookSafely(
            user.id,
            "goal_progress",
            async () => {
              const relevance = await deps.checkMissionRelevance(
                user.id,
                missionId,
                c.env.fitloot_db,
                "completed",
              );
              if (!relevance.isGoalRelevant) return;

              const goalStats = await c.env.fitloot_db
                .prepare(
                  "SELECT goal_completed_count FROM user_goal_stats WHERE user_id = ?",
                )
                .bind(user.id)
                .first<{ goal_completed_count: number }>();
              const progressPercent = Math.min(
                200,
                Math.floor(
                  (Number(goalStats?.goal_completed_count ?? 0) / 100) * 100,
                ),
              );
              await c.env.fitloot_db
                .prepare(
                  "UPDATE user_goal_stats SET goal_progress_percent = ?, updated_at = datetime('now') WHERE user_id = ?",
                )
                .bind(progressPercent, user.id)
                .run();
              await deps.onGoalProgress(c.env.fitloot_db, user.id, progressPercent);
            },
          );

          if (currentHour >= 2 && currentHour < 4) {
            completionPhase = "lifecycle_night_achievement";
            await deps.runMissionLifecycleHookSafely(
              user.id,
              "night_achievement",
              () =>
                deps.unlockAchievementIfNeeded(
                  c.env.fitloot_db,
                  user.id,
                  "Insônia",
                  1,
                  1,
                ),
            );
          }

          completionPhase = "update_skill_progress";
          const missionMetricType = deps.normalizeMissionMetricType(
            mission.metric_type,
            mission.target_time,
          );
          const repsForSkill =
            missionMetricType === "repetitions" ||
            missionMetricType === "sets_reps"
              ? completedMetricValue
              : 0;
          const timeForSkill =
            missionMetricType === "duration_seconds"
              ? completedMetricValue
              : missionMetricType === "duration_minutes"
                ? completedMetricValue * 60
                : 0;

          const skillIdRaw = mission.skill_id;
          const skillId =
            skillIdRaw !== null &&
            skillIdRaw !== undefined &&
            String(skillIdRaw).trim() !== ""
              ? Number(skillIdRaw)
              : null;
          const skillIdValid =
            skillId !== null && Number.isInteger(skillId) && skillId > 0;

          let appliedAttributeGainFromSkill = false;

          if (skillIdValid && (repsForSkill > 0 || timeForSkill > 0)) {
            completionPhase = "update_skill_stats_db";
            await c.env.fitloot_db
              .prepare(
                `UPDATE user_skills SET total_reps = total_reps + ?, total_time = total_time + ?, best_reps = MAX(best_reps, ?), updated_at = datetime('now')
                  WHERE user_id = ? AND skill_id = ?`,
              )
              .bind(repsForSkill, timeForSkill, repsForSkill, user.id, skillId)
              .run();

            const skill = await c.env.fitloot_db
              .prepare("SELECT * FROM skills WHERE id = ?")
              .bind(skillId)
              .first<Record<string, unknown>>();

            if (skill && deps.totalSkillTableAttributeGain(skill) > 0) {
              completionPhase = "update_attributes_db";
              await deps.ensureUserAttributesRow(c.env.fitloot_db, user.id);
              await c.env.fitloot_db
                .prepare(
                  `UPDATE user_attributes SET 
                    strength = strength + ?, constitution = constitution + ?, 
                    vitality = vitality + ?, dexterity = dexterity + ?, 
                    focus = focus + ?, updated_at = datetime('now')
                    WHERE user_id = ?`,
                )
                .bind(
                  Number(skill.strength_gain ?? 0),
                  Number(skill.constitution_gain ?? 0),
                  Number(skill.vitality_gain ?? 0),
                  Number(skill.dexterity_gain ?? 0),
                  Number(skill.focus_gain ?? 0),
                  user.id,
                )
                .run();
              appliedAttributeGainFromSkill = true;
            }
          }

          if (!appliedAttributeGainFromSkill) {
            completionPhase = "update_attributes_from_exercise_profile";
            const typeDelta = deps.computeMissionTypeAttributeDelta(
              mission,
              missionMetricType,
              completedMetricValue,
            );
            await deps.applyMissionAttributeDeltaToUser(
              c.env.fitloot_db,
              user.id,
              typeDelta,
            );
          }
          completionPhase = "unlock_performance_variants";
          await deps.tryUnlockSkillsFromPerformance(c.env.fitloot_db, user.id);
          completionPhase = "completed";
        });

        try {
          deps.invalidateRankingCache();
          deps.invalidateMissionListCache(user.id);
        } catch (cacheError) {
          console.error(
            "[/api/missions/complete] cache invalidation failed:",
            cacheError,
          );
        }

        c.executionCtx.waitUntil(
          deps.ensurePeriodicMissionsWithGuard(
            c.env,
            c.env.fitloot_db,
            user.id,
            {
              force: true,
              mode: "safe",
            },
          ).catch((refreshError) => {
            console.error("[/api/missions/complete][refresh]", {
              userId: user.id,
              missionId: data.mission_id,
              message: getErrorMessage(refreshError),
            });
          }),
        );

        return c.json({
          success: true,
          xpGained,
          pointsGained,
          leveledUp,
          streakMultiplier: streakMultiplier.toFixed(1),
        });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        console.error("[/api/missions/complete]", {
          userId: user.id,
          missionId: data.mission_id,
          phase: completionPhase,
          message: errorMsg,
          stack: error instanceof Error ? error.stack : undefined,
        });
        return c.json(
          {
            error: "Erro interno",
            code: "INTERNAL_ERROR",
            phase: completionPhase,
            detail: errorMsg,
          },
          500,
        );
      }
    },
  );
}
