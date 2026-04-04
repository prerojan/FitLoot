import { Hono, type Context, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  CompleteMissionRequestSchema,
  type CircuitTask,
  type MissionMetricType,
  type RewardNotification,
} from "../../shared/types";
import {
  resolveStrictSupportedMissionExerciseDbId,
  resolveSupportedMissionExerciseName,
} from "../../shared/exerciseCatalog";
import { MISSION_LIMITS } from "../../constants/missionMetrics";
import { hasTableColumn } from "../core/database";
import {
  getErrorMessage,
  internalErrorResponse,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import type { AppContext } from "../core/types";
import type { WithTransaction } from "./contracts";
import { ensurePortugueseExerciseLabel } from "../services/instructionLocalization";
import {
  DEFAULT_SETTLED_MISSION_RETENTION_MODIFIER,
  SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD,
} from "../constants/missionRetention";
import {
  currentDateKeyInTimeZone,
  resolveMissionTimeZone,
  sanitizeMissionTimeZone,
  shiftMissionDateKey,
} from "../services/missionCycle";

const MISSION_SCHEMA_CAPABILITY_TTL_MS = 5 * 60_000;

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
  getRewardNotificationCursor: (
    db: D1Database,
    userId: string,
  ) => Promise<number>;
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
  resolvePeriodicMissionProgressValue: (
    userId: string,
    mission: Record<string, unknown>,
    db: D1Database,
    monthlyCounters?: unknown,
  ) => Promise<number>;
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
  readMissionDetailCache: (
    userId: string,
    missionId: number,
  ) => Record<string, unknown> | null;
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
  listRewardNotifications: (
    db: D1Database,
    userId: string,
    options?: {
      afterId?: number | undefined;
      pendingOnly?: boolean | undefined;
      limit?: number | undefined;
    },
  ) => Promise<RewardNotification[]>;
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
  writeMissionDetailCache: (
    userId: string,
    missionId: number,
    payload: Record<string, unknown>,
  ) => void;
  writeMissionListCache: (
    userId: string,
    payload: Record<string, unknown>[],
  ) => void;
  clearMissionDetailCache: (userId: string, missionId: number) => void;
};

type StoredMissionOperationRow = {
  response_payload?: string | null;
};

async function readStoredMissionOperationResult(
  db: D1Database,
  userId: string,
  operationId: string,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(
      `SELECT response_payload
       FROM offline_sync_operations
       WHERE user_id = ? AND operation_id = ?`,
    )
    .bind(userId, operationId)
    .first<StoredMissionOperationRow>();

  if (!row?.response_payload) {
    return null;
  }

  try {
    const payload = JSON.parse(row.response_payload);
    return payload && typeof payload === "object"
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function persistMissionOperationResult(
  db: D1Database,
  params: {
    userId: string;
    operationId: string;
    occurredAt?: string | undefined;
    requestPayload: unknown;
    responsePayload: unknown;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO offline_sync_operations (
         user_id,
         operation_id,
         operation_type,
         occurred_at,
         source,
         confidence,
         request_payload,
         response_payload,
         status,
         processed_at,
         updated_at
       ) VALUES (?, ?, 'mission_completed', ?, 'browser', NULL, ?, ?, 'processed', datetime('now'), datetime('now'))
       ON CONFLICT(user_id, operation_id) DO UPDATE SET
         operation_type = 'mission_completed',
         occurred_at = excluded.occurred_at,
         request_payload = excluded.request_payload,
         response_payload = excluded.response_payload,
         status = 'processed',
         processed_at = datetime('now'),
         updated_at = datetime('now')`,
    )
    .bind(
      params.userId,
      params.operationId,
      params.occurredAt ?? new Date().toISOString(),
      JSON.stringify(params.requestPayload),
      JSON.stringify(params.responsePayload),
    )
    .run();
}

function looksLikeExerciseDbMediaUrl(value: unknown): boolean {
  return typeof value === "string"
    && /static\.exercisedb\.dev\/media\/[A-Za-z0-9_-]+\.(?:gif|png|jpe?g|webp)(?:$|\?)/i.test(value.trim());
}

function extractDailyMissionRepairSource(
  row: Record<string, unknown>,
  extractExerciseName: (title: string) => string,
): string {
  if (typeof row.exercise_name === "string" && row.exercise_name.trim().length > 0) {
    return row.exercise_name.trim();
  }
  if (typeof row.title === "string" && row.title.trim().length > 0) {
    return extractExerciseName(row.title).trim();
  }
  return "";
}

function dailyMissionNeedsCatalogRepair(
  row: Record<string, unknown>,
  extractExerciseName: (title: string) => string,
): boolean {
  if (row.type !== "daily") {
    return false;
  }

  const sourceExerciseName = extractDailyMissionRepairSource(row, extractExerciseName);
  const canonicalExerciseName = resolveSupportedMissionExerciseName(sourceExerciseName);
  const canonicalExerciseDbId = resolveStrictSupportedMissionExerciseDbId(sourceExerciseName);
  const explicitExerciseDbId =
    typeof row.exercise_db_id === "string" && row.exercise_db_id.trim().length > 0
      ? row.exercise_db_id.trim()
      : null;

  if (!canonicalExerciseName || !canonicalExerciseDbId) {
    return true;
  }

  if (explicitExerciseDbId !== canonicalExerciseDbId) {
    return true;
  }

  const hasExerciseDbMedia =
    looksLikeExerciseDbMediaUrl(row.exercise_db_gif_url)
    || looksLikeExerciseDbMediaUrl(row.exercise_db_image_url)
    || looksLikeExerciseDbMediaUrl(row.image_url);

  return !hasExerciseDbMedia;
}

function missionListNeedsDailyCatalogRepair(
  rows: readonly Record<string, unknown>[],
  extractExerciseName: (title: string) => string,
): boolean {
  return rows.some((row) => dailyMissionNeedsCatalogRepair(row, extractExerciseName));
}

function missionCycleDateSql(): string {
  return "COALESCE(cycle_date, substr(CAST(created_at AS TEXT), 1, 10))";
}

function missionMetricTargetValue(
  mission: Record<string, unknown>,
): number {
  return Math.max(
    1,
    Number(
      mission.metric_value
      ?? mission.target_reps
      ?? mission.target_time
      ?? 1,
    ) || 1,
  );
}

function normalizeCompletedMetricValueForMission(
  mission: Record<string, unknown>,
  missionMetricType: MissionMetricType,
  rawCompletedValue: number,
): number {
  const targetValue = missionMetricTargetValue(mission);
  if (!Number.isFinite(rawCompletedValue) || rawCompletedValue <= 0) {
    return targetValue;
  }

  const normalizedValue = Math.round(rawCompletedValue);
  switch (missionMetricType) {
    case "repetitions":
    case "sets_reps":
    case "duration_seconds":
    case "duration_minutes":
    case "steps":
    case "distance_meters":
      return Math.min(targetValue, Math.max(1, normalizedValue));
    default:
      return targetValue;
  }
}

async function readMissionRequestTimeZone(
  c: Context<AppContext>,
  userId: string,
): Promise<string> {
  const requestTimeZone = sanitizeMissionTimeZone(
    c.req.header("X-FitLoot-Timezone"),
  );
  if (requestTimeZone) {
    return requestTimeZone;
  }

  try {
    const row = await c.env.fitloot_db
      .prepare("SELECT timezone FROM user_profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ timezone: string | null }>();
    return resolveMissionTimeZone(row?.timezone);
  } catch {
    return "UTC";
  }
}

// Registra listagem, detalhes, geração e conclusão de missões.
export function registerMissionRoutes(
  app: Hono<AppContext>,
  deps: MissionRouteDeps,
  authMiddleware: MiddlewareHandler<AppContext>,
): void {
  const {
    clearMissionDetailCache,
    generateStructuredMissionPlanForUser,
    getMonthlyCounters,
    hydrateMissionRowsWithSubtasks,
    invalidateMissionListCache,
    missionSummaryFromNormalized,
    resolvePeriodicMissionProgressValue,
    normalizeMissionRow,
    readMissionDetailCache,
    readMissionListCache,
    scheduleLegacyDailyMetadataRepairWithGuard,
    schedulePeriodicMissionsRefreshWithGuard,
    schedulePeriodicProgressRecomputeWithGuard,
    streamJsonArrayResponse,
    writeMissionDetailCache,
    writeMissionListCache,
  } = deps;
  let missionReadSchemaCapabilities: {
    checkedAt: number;
    hasMissionStatus: boolean;
    includeSkillJoin: boolean;
  } | null = null;

  const canJoinSkillsTable = async (db: D1Database): Promise<boolean> => {
    try {
      const [hasMissionSkillId, hasSkillId, hasSkillName] = await Promise.all([
        hasTableColumn(db, "missions", "skill_id"),
        hasTableColumn(db, "skills", "id"),
        hasTableColumn(db, "skills", "name"),
      ]);
      return hasMissionSkillId && hasSkillId && hasSkillName;
    } catch (error) {
      console.warn("[missions][schema-check][skills]", {
        message: getErrorMessage(error),
      });
      return false;
    }
  };

  const resolveMissionReadSchemaCapabilities = async (
    db: D1Database,
  ): Promise<{
    hasMissionStatus: boolean;
    includeSkillJoin: boolean;
  }> => {
    const now = Date.now();
    if (
      missionReadSchemaCapabilities &&
      now - missionReadSchemaCapabilities.checkedAt < MISSION_SCHEMA_CAPABILITY_TTL_MS
    ) {
      return {
        hasMissionStatus: missionReadSchemaCapabilities.hasMissionStatus,
        includeSkillJoin: missionReadSchemaCapabilities.includeSkillJoin,
      };
    }

    const [hasMissionStatus, includeSkillJoin] = await Promise.all([
      hasTableColumn(db, "missions", "status"),
      canJoinSkillsTable(db),
    ]);
    missionReadSchemaCapabilities = {
      checkedAt: now,
      hasMissionStatus,
      includeSkillJoin,
    };

    return { hasMissionStatus, includeSkillJoin };
  };

  const buildMissionSkillQueryParts = (includeSkillJoin: boolean) => ({
    selectSkillName: includeSkillJoin ? "s.name as skill_name" : "NULL as skill_name",
    skillJoinClause: includeSkillJoin ? "LEFT JOIN skills s ON m.skill_id = s.id" : "",
  });

  // Lista as missões relevantes, reutilizando cache e agendando reparos leves em segundo plano.
  app.get("/api/missions", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const forceRefresh = c.req.query("refresh") === "1";
      if (forceRefresh) {
        invalidateMissionListCache(user.id);
      }

      const cached = !forceRefresh ? readMissionListCache(user.id) : null;
      const cachedNeedsRepair =
        Array.isArray(cached)
        && missionListNeedsDailyCatalogRepair(
          cached as Record<string, unknown>[],
          deps.extractExerciseName,
        );
      if (!forceRefresh && cached && !cachedNeedsRepair) {
        return streamJsonArrayResponse(cached);
      }
      if (cachedNeedsRepair) {
        invalidateMissionListCache(user.id);
      }

      // Mantém o endpoint de leitura leve e relega manutenção periódica ao fluxo com debounce.
      schedulePeriodicMissionsRefreshWithGuard(
        c.env,
        c.env.fitloot_db,
        user.id,
        c.executionCtx,
        "safe",
      );
      const shouldScheduleLegacyRepair = forceRefresh || cachedNeedsRepair;
      if (shouldScheduleLegacyRepair) {
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
      }

      // Busca missões ativas e histórico recente, com fallback para esquemas antigos sem coluna status.
      const { hasMissionStatus, includeSkillJoin } =
        await resolveMissionReadSchemaCapabilities(c.env.fitloot_db);
      const { selectSkillName, skillJoinClause } =
        buildMissionSkillQueryParts(includeSkillJoin);
      const activePendingFilter = hasMissionStatus
        ? "AND COALESCE(m.status,'pending') = 'pending'"
        : "";
      const retentionThresholdByTypeSql = `CASE m.type
        WHEN 'daily' THEN datetime('now', ?)
        WHEN 'weekly' THEN datetime('now', ?)
        WHEN 'monthly' THEN datetime('now', ?)
        ELSE datetime('now', ?)
      END`;
      const statusFilter = hasMissionStatus
        ? `OR (
            COALESCE(m.status,'pending') IN ('failed', 'expired')
            AND datetime(m.updated_at) >= ${retentionThresholdByTypeSql}
          )`
        : "";
      const retentionParams = [
        SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.daily,
        SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.weekly,
        SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.monthly,
        DEFAULT_SETTLED_MISSION_RETENTION_MODIFIER,
      ];
      const completedRetentionFilter = `datetime(COALESCE(m.completed_at, m.updated_at)) >= ${retentionThresholdByTypeSql}`;

      const missions = await c.env.fitloot_db
        .prepare(
          `SELECT m.*, ${selectSkillName} FROM missions m
          ${skillJoinClause}
          WHERE m.user_id = ?
          AND (
            (m.is_completed = 0 AND (m.deadline IS NULL OR m.deadline > datetime('now')) ${activePendingFilter})
            OR (m.is_completed = 1 AND ${completedRetentionFilter})
            ${statusFilter}
          )
          ORDER BY CASE m.type WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 ELSE 4 END, m.created_at DESC
          LIMIT 240`,
        )
        .bind(
          user.id,
          ...retentionParams,
          ...(hasMissionStatus ? retentionParams : []),
        )
        .all();

      const missionList = await hydrateMissionRowsWithSubtasks(
        c.env.fitloot_db,
        (Array.isArray(missions.results) ? missions.results : []) as Record<
          string,
          unknown
        >[],
      );
      const monthlyCounters = await getMonthlyCounters(c.env.fitloot_db, user.id);
      // Completa o progresso das missões mensais quando ele depende de contadores agregados.
      const withProgress = await Promise.all(missionList.map(async (row) => {
        const rawMission = row as Record<string, unknown>;
        const normalizedMission = normalizeMissionRow(
          rawMission,
        ) as NormalizedMissionRowLike;
        const isWeekly = rawMission.type === "weekly";
        const isMonthly = rawMission.type === "monthly";
        const isPeriodic = isWeekly || isMonthly;
        if (!isPeriodic) return normalizedMission;
        if (normalizedMission.circuit_tasks.length > 0) {
          return normalizedMission;
        }

        const isCompleted = Number(rawMission.is_completed ?? 0) === 1;
        const target = Math.max(
          1,
          Number(
            rawMission.metric_value
            ?? rawMission.target_reps
            ?? rawMission.target_time
            ?? 1,
          ),
        );
        return {
          ...normalizedMission,
          progress_value: Math.min(
            target,
            isCompleted
              ? target
              : await resolvePeriodicMissionProgressValue(
                  user.id,
                  rawMission,
                  c.env.fitloot_db,
                  isMonthly ? monthlyCounters : undefined,
                ),
          ),
        };
      }));
      const summaries = withProgress.map((mission) =>
        missionSummaryFromNormalized(mission),
      );
      const listNeedsRepair = missionListNeedsDailyCatalogRepair(
        summaries,
        deps.extractExerciseName,
      );
      if (listNeedsRepair && !shouldScheduleLegacyRepair) {
        scheduleLegacyDailyMetadataRepairWithGuard(
          c.env,
          c.env.fitloot_db,
          user.id,
          c.executionCtx,
        );
      }
      if (!listNeedsRepair) {
        writeMissionListCache(user.id, summaries);
      }
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

  // Carrega uma missão específica e completa a tradução dos passos quando necessário.
  app.get("/api/missions/:id", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const missionId = Number(c.req.param("id"));
    if (!Number.isInteger(missionId) || missionId <= 0) {
      return c.json({ error: "Mission id inválido" }, 400);
    }

    const cachedMissionDetail = readMissionDetailCache(user.id, missionId);
    if (cachedMissionDetail) {
      const cachedDetail = normalizeMissionRow(
        cachedMissionDetail,
      ) as NormalizedMissionRowLike;
      const shouldBypassCache =
        (cachedDetail.type === "weekly" || cachedDetail.type === "monthly")
        && Number(cachedDetail.is_completed ?? 0) !== 1;
      if (!shouldBypassCache) {
        return c.json(cachedMissionDetail);
      }
    }

    try {
      const row = await c.env.fitloot_db
        .prepare(
          `SELECT m.*, NULL as skill_name
           FROM missions m
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
        (normalized.type === "weekly" || normalized.type === "monthly") &&
        Number(normalized.is_completed ?? 0) !== 1 &&
        normalized.circuit_tasks.length === 0
      ) {
        const monthlyCounters = normalized.type === "monthly"
          ? await getMonthlyCounters(
              c.env.fitloot_db,
              user.id,
            )
          : undefined;
        const target = Math.max(
          1,
          Number(
            row.metric_value
            ?? row.target_reps
            ?? row.target_time
            ?? 1,
          ),
        );
        normalized.progress_value = Math.min(
          target,
          await resolvePeriodicMissionProgressValue(
            user.id,
            row,
            c.env.fitloot_db,
            monthlyCounters,
          ),
        );
      }

      const enSteps = normalized.exercise_instructions_en;
      const ptSteps = normalized.exercise_instructions_pt;
      if (
        normalized.type === "daily" &&
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
        const exerciseLabelPt = ensurePortugueseExerciseLabel(exerciseLabel);
        // Dispara a traducao em background para nao bloquear a leitura de detalhes.
        const currentInstructions = deps.normalizeInstructionList(
          normalized.instructions,
          8,
        );
        const shouldRefreshMainInstructions =
          currentInstructions.length === 0 ||
          (currentInstructions.length === enSteps.length &&
            currentInstructions.every(
              (line, index) =>
                deps.normalizeMatchText(line) ===
                deps.normalizeMatchText(enSteps[index] ?? ""),
            ));

        c.executionCtx.waitUntil(
          (async () => {
            try {
              const ptTranslated = await deps.translateExerciseInstructionsToPt(
                enSteps,
                exerciseLabelPt,
                c.env,
              );
              if (ptTranslated.length === 0) {
                return;
              }

              const nextInstructions = shouldRefreshMainInstructions
                ? deps.ensureInstructionSteps(
                  deps.normalizeInstructionList(ptTranslated, 6),
                  exerciseLabelPt,
                  normalized.metric_type as MissionMetricType,
                  normalized.sets,
                  normalized.rest_seconds,
                )
                : currentInstructions;

              await c.env.fitloot_db
                .prepare(
                  `UPDATE missions SET exercise_instructions_pt_json = ?, instructions_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
                )
                .bind(
                  JSON.stringify(ptTranslated),
                  JSON.stringify(nextInstructions),
                  missionId,
                  user.id,
                )
                .run();

              // A tradução em background altera o payload detalhado e precisa invalidar o cache de detalhe.
              clearMissionDetailCache(user.id, missionId);
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

      const shouldCacheMissionDetail =
        !(
          (normalized.type === "weekly" || normalized.type === "monthly")
          && Number(normalized.is_completed ?? 0) !== 1
        );
      if (shouldCacheMissionDetail) {
        writeMissionDetailCache(
          user.id,
          missionId,
          normalized as Record<string, unknown>,
        );
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

  // Gera o plano estruturado padrão de missões do usuário.
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

      // A geração de plano altera o conjunto de missões ativas e deve invalidar os caches associados.
      invalidateMissionListCache(user.id);

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

  // Gera uma missão especial por IA sem recriar o plano periódico completo.
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

      // Mantém consistência de lista/detalhes após criação de missão especial por IA.
      invalidateMissionListCache(user.id);

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
      const operationId =
        typeof data.operation_id === "string" && data.operation_id.trim().length > 0
          ? data.operation_id.trim()
          : null;
      const occurredAt =
        typeof data.occurred_at === "string" && data.occurred_at.trim().length > 0
          ? data.occurred_at.trim()
          : undefined;
      const completedMetricValue = Number(
        data.metric_completed ??
          data.reps_completed ??
          data.time_completed ??
          0,
      );
      let completionPhase = "load_mission";

      try {
        if (operationId) {
          const storedResult = await readStoredMissionOperationResult(
            c.env.fitloot_db,
            user.id,
            operationId,
          );
          if (storedResult) {
            return c.json(storedResult);
          }
        }

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
                "Missões semanais e mensais não podem ser concluídas manualmente. O progresso acontece automaticamente pelas missões diárias compatíveis.",
              code: "MISSION_AUTO_PROGRESS_ONLY",
            },
            400,
          );
        }

        const missionTimeZone = await readMissionRequestTimeZone(c, user.id);
        const today = currentDateKeyInTimeZone(new Date(), missionTimeZone);
        const yesterday = shiftMissionDateKey(today, -1);
        const missionMetricType = deps.normalizeMissionMetricType(
          mission.metric_type,
          mission.target_time,
        );
        const normalizedCompletedMetricValue = normalizeCompletedMetricValueForMission(
          mission,
          missionMetricType,
          completedMetricValue,
        );

        let streakMultiplier = 1;
        let xpGained = 0;
        let pointsGained = 0;
        let leveledUp = false;
        let rewardNotificationCursor = 0;

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

        completionPhase = "reward_cursor";
        rewardNotificationCursor = await deps.getRewardNotificationCursor(
          c.env.fitloot_db,
          user.id,
        );

        completionPhase = "transaction";
        await deps.withTransaction(c.env.fitloot_db, async () => {
          // Marca a missão como concluída respeitando esquemas antigos com ou sem coluna status.
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

          let newStreak = Number(progression?.current_streak || 0);

          // Recalcula streak apenas quando a atividade do dia ainda não foi registrada.
          if (progression?.last_activity_date !== today) {
            completionPhase = "calculate_streak";
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
          // Atualiza contadores globais, preservando compatibilidade com bancos sem colunas de streak diário.
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
          // Dispara os hooks de progressão e gamificação sem quebrar a conclusão principal.
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
          const completedToday = await (async () => {
            try {
              return await c.env.fitloot_db
                .prepare(
                  `SELECT COUNT(*) as c
                     FROM missions
                    WHERE user_id = ?
                      AND type = 'daily'
                      AND is_completed = 1
                      AND ${missionCycleDateSql()} = ?`,
                )
                .bind(user.id, today)
                .first<{ c: number }>();
            } catch {
              return { c: 1 } satisfies { c: number };
            }
          })();
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
          const repsForSkill =
            missionMetricType === "repetitions" ||
            missionMetricType === "sets_reps"
              ? normalizedCompletedMetricValue
              : 0;
          const timeForSkill =
            missionMetricType === "duration_seconds"
              ? normalizedCompletedMetricValue
              : missionMetricType === "duration_minutes"
                ? normalizedCompletedMetricValue * 60
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

          // Credita progresso em skill e aplica ganhos de atributo tabelados quando existirem.
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
            // Usa o perfil do exercício como fallback de atributos quando a skill não gera bônus próprios.
            completionPhase = "update_attributes_from_exercise_profile";
            const typeDelta = deps.computeMissionTypeAttributeDelta(
              mission,
              missionMetricType,
              normalizedCompletedMetricValue,
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
        }, c.env);

        try {
          // Limpa os caches dependentes da lista e do ranking logo após a conclusão confirmada.
          deps.invalidateRankingCache();
          deps.invalidateMissionListCache(user.id);
        } catch (cacheError) {
          console.error(
            "[/api/missions/complete] cache invalidation failed:",
            cacheError,
          );
        }

        // Reabastece missões periódicas em segundo plano depois da conclusão principal.
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

        const rewardEvents = await deps.listRewardNotifications(
          c.env.fitloot_db,
          user.id,
          {
            afterId: rewardNotificationCursor,
            pendingOnly: true,
            limit: 25,
          },
        );
        leveledUp = rewardEvents.some((event) => event.type === "level_up");

        const responsePayload = {
          success: true,
          xpGained,
          pointsGained,
          leveledUp,
          reward_events: rewardEvents,
          streakMultiplier: streakMultiplier.toFixed(1),
        };

        if (operationId) {
          await persistMissionOperationResult(c.env.fitloot_db, {
            userId: user.id,
            operationId,
            occurredAt,
            requestPayload: data,
            responsePayload,
          });
        }

        return c.json(responsePayload);
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        console.error("[/api/missions/complete]", {
          userId: user.id,
          missionId: data.mission_id,
          phase: completionPhase,
          message: errorMsg,
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Mantém a fase explícita para facilitar auditoria e suporte quando a conclusão falha.
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
