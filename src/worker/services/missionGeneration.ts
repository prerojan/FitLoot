import { MISSION_LIMITS } from "../../constants/missionMetrics";
import { getErrorMessage } from "../core/errors";
import { getHuggingFaceApiKey } from "../core/providerConfig";
import type { Env } from "../core/types";
import { requestValidatedStructuredPlanWithRetry } from "./structuredPlanRetry";

type MissionPeriod = "daily" | "weekly" | "monthly";
type MissionOrigin = "regular" | "ai_special";

export type StructuredGenerationOptions = {
  isAiSpecial: boolean;
  dailyTarget: number;
  weeklyTarget: number;
  monthlyTarget: number;
};

export type GeneratedMissionPlanResult<TMission = unknown> = {
  missions: TMission[];
  used_ai: boolean;
  invalid_ratio: number;
  already_active: boolean;
};

type ActiveCycleMissionCounts = {
  daily: number;
  weekly: number;
  monthly: number;
};

type MissingPeriodicTargets = {
  weeklyTarget: number;
  monthlyTarget: number;
};

type ValidationResult<TBlueprint> = {
  blueprints: TBlueprint[];
  invalidCount: number;
  totalCount: number;
};

type MissionGenerationDeps<TProfile, TPlanDraft, TBlueprint, TMission> = {
  buildFallbackStructuredPlan: (
    profile: TProfile,
    options: StructuredGenerationOptions,
  ) => TPlanDraft;
  buildStructuredPlanPrompt: (
    profile: TProfile,
    options: StructuredGenerationOptions,
    retryReason?: string,
  ) => string;
  createMissionsForPeriod: (
    env: Env,
    db: D1Database,
    userId: string,
    period: MissionPeriod,
    requestedAmount?: number,
  ) => Promise<void>;
  ensureStructuredPeriodicMissionsFromExistingDailyBlueprints: (
    env: Env,
    db: D1Database,
    userId: string,
    targets: MissingPeriodicTargets,
  ) => Promise<unknown>;
  getActiveCycleMissionCounts: (
    db: D1Database,
    userId: string,
    missionOrigin: MissionOrigin,
  ) => Promise<ActiveCycleMissionCounts>;
  getProfileTimeZone: (
    profile: TProfile | null | undefined,
  ) => string;
  hasTableColumn: (
    db: D1Database,
    tableName: string,
    columnName: string,
  ) => Promise<boolean>;
  listCurrentCycleMissions: (
    db: D1Database,
    userId: string,
    missionOrigin: MissionOrigin,
  ) => Promise<TMission[]>;
  loadMissionGenerationProfile: (
    env: Env,
    db: D1Database,
    userId: string,
  ) => Promise<TProfile | null>;
  missionCycleDateKey: (
    period: MissionPeriod,
    timeZone: string,
    reference?: Date,
  ) => string;
  missionCycleStartIso: (
    period: MissionPeriod,
    reference?: Date,
  ) => string;
  persistGeneratedMissionPlan: (
    env: Env,
    db: D1Database,
    profile: TProfile,
    blueprints: readonly TBlueprint[],
  ) => Promise<TMission[]>;
  repairLegacyPeriodicMissions: (
    env: Env,
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  requestStructuredMissionPlanFromAI: (
    env: Env,
    prompt: string,
  ) => Promise<TPlanDraft>;
  validateStructuredMissionPlan: (
    planDraft: TPlanDraft,
    profile: TProfile,
    options: StructuredGenerationOptions,
  ) => ValidationResult<TBlueprint>;
};

export function createMissionGenerationService<
  TProfile,
  TPlanDraft,
  TBlueprint,
  TMission = unknown,
>(
  deps: MissionGenerationDeps<TProfile, TPlanDraft, TBlueprint, TMission>,
) {
  async function generateStructuredMissionPlanForUser(
    env: Env,
    db: D1Database,
    userId: string,
    options: StructuredGenerationOptions,
  ): Promise<GeneratedMissionPlanResult<TMission>> {
    const profile = await deps.loadMissionGenerationProfile(env, db, userId);
    if (!profile) {
      throw new Error("MISSION_GENERATION_PROFILE_INCOMPLETE");
    }

    if (!options.isAiSpecial) {
      await deps.repairLegacyPeriodicMissions(env, db, userId);
    }

    const missionOrigin: MissionOrigin = options.isAiSpecial ? "ai_special" : "regular";
    const activeCounts = await deps.getActiveCycleMissionCounts(db, userId, missionOrigin);
    const hasActiveMissions = options.isAiSpecial
      ? activeCounts.daily >= options.dailyTarget
      : activeCounts.daily > 0 || activeCounts.weekly > 0 || activeCounts.monthly > 0;

    if (hasActiveMissions) {
      return {
        missions: await deps.listCurrentCycleMissions(db, userId, missionOrigin),
        used_ai: false,
        invalid_ratio: 0,
        already_active: true,
      };
    }

    const fallbackPlan = deps.buildFallbackStructuredPlan(profile, options);
    let validation = deps.validateStructuredMissionPlan(fallbackPlan, profile, options);
    let usedAi = false;

    if (getHuggingFaceApiKey(env)) {
      const aiResult = await requestValidatedStructuredPlanWithRetry({
        buildPrompt: (retryReason?: string) =>
          deps.buildStructuredPlanPrompt(profile, options, retryReason),
        buildInvalidRatioRetryReason: (invalidRatio) =>
          `Mais de 30% das missoes vieram invalidas (${Math.round(invalidRatio * 100)}%). Corrija metricas, XP, subtasks e circuitos diarios.`,
        getErrorMessage,
        requestPlan: (prompt) =>
          deps.requestStructuredMissionPlanFromAI(env, prompt),
        validatePlan: (planDraft) =>
          deps.validateStructuredMissionPlan(planDraft, profile, options),
      });
      if (aiResult.accepted && aiResult.validation) {
        validation = aiResult.validation;
        usedAi = true;
      }
    }

    const missions = await deps.persistGeneratedMissionPlan(
      env,
      db,
      profile,
      validation.blueprints,
    );
    const currentCycleMissions = await deps.listCurrentCycleMissions(
      db,
      userId,
      missionOrigin,
    );

    return {
      missions: currentCycleMissions.length > 0 ? currentCycleMissions : missions,
      used_ai: usedAi,
      invalid_ratio: validation.totalCount > 0
        ? validation.invalidCount / validation.totalCount
        : 0,
      already_active: false,
    };
  }

  async function ensurePeriodicMissions(
    env: Env,
    db: D1Database,
    userId: string,
  ): Promise<void> {
    const profile = await deps.loadMissionGenerationProfile(env, db, userId);
    const userTimeZone = deps.getProfileTimeZone(profile);
    const [hasMissionStatusColumn, hasCycleDateColumn] = await Promise.all([
      deps.hasTableColumn(db, "missions", "status"),
      deps.hasTableColumn(db, "missions", "cycle_date"),
    ]);
    const activeRegularCounts = await deps.getActiveCycleMissionCounts(
      db,
      userId,
      "regular",
    );
    const shouldGenerateWholePlan =
      activeRegularCounts.daily === 0 &&
      activeRegularCounts.weekly === 0 &&
      activeRegularCounts.monthly === 0;

    if (shouldGenerateWholePlan) {
      try {
        await generateStructuredMissionPlanForUser(env, db, userId, {
          isAiSpecial: false,
          dailyTarget: MISSION_LIMITS.daily,
          weeklyTarget: MISSION_LIMITS.weekly,
          monthlyTarget: MISSION_LIMITS.monthly,
        });
        return;
      } catch (error) {
        console.error("[missions][structured-generate-fallback]", {
          userId,
          message: getErrorMessage(error),
        });
      }
    }

    const periods: MissionPeriod[] = ["daily", "weekly", "monthly"];
    const missingPeriodicTargets = {
      weeklyTarget: 0,
      monthlyTarget: 0,
    };

    for (const period of periods) {
      const cycleDate = deps.missionCycleDateKey(period, userTimeZone);
      const cycleStart = deps.missionCycleStartIso(period);
      if (hasCycleDateColumn) {
        if (hasMissionStatusColumn) {
          await db.prepare(
            `UPDATE missions
               SET status = 'expired', updated_at = datetime('now')
             WHERE user_id = ?
               AND type = ?
               AND is_completed = 0
               AND COALESCE(mission_origin, 'regular') = 'regular'
               AND COALESCE(status, 'pending') = 'pending'
               AND COALESCE(cycle_date, substr(created_at, 1, 10)) < ?`,
          ).bind(userId, period, cycleDate).run();
        } else {
          await db.prepare(
            `UPDATE missions
               SET deadline = datetime('now', '-1 second'),
                   updated_at = datetime('now')
             WHERE user_id = ?
               AND type = ?
               AND is_completed = 0
               AND COALESCE(mission_origin, 'regular') = 'regular'
               AND COALESCE(cycle_date, substr(created_at, 1, 10)) < ?`,
          ).bind(userId, period, cycleDate).run();
        }
      } else if (hasMissionStatusColumn) {
        await db.prepare(
          `UPDATE missions
             SET status = 'expired', updated_at = datetime('now')
           WHERE user_id = ?
             AND type = ?
             AND is_completed = 0
             AND COALESCE(mission_origin, 'regular') = 'regular'
             AND COALESCE(status, 'pending') = 'pending'
             AND datetime(created_at) < datetime(?)`
        ).bind(userId, period, cycleStart).run();
      } else {
        await db.prepare(
          `UPDATE missions
             SET deadline = datetime('now', '-1 second'),
                 updated_at = datetime('now')
           WHERE user_id = ?
             AND type = ?
             AND is_completed = 0
             AND COALESCE(mission_origin, 'regular') = 'regular'
             AND datetime(created_at) < datetime(?)`
        ).bind(userId, period, cycleStart).run();
      }

      const generatedInCycle = hasCycleDateColumn
        ? await db.prepare(
            `SELECT COUNT(*) as count
             FROM missions
             WHERE user_id = ?
               AND type = ?
               AND COALESCE(mission_origin, 'regular') = 'regular'
               AND COALESCE(cycle_date, substr(created_at, 1, 10)) = ?`
          ).bind(userId, period, cycleDate).first<{ count: number }>()
        : await db.prepare(
            `SELECT COUNT(*) as count
             FROM missions
             WHERE user_id = ?
               AND type = ?
               AND COALESCE(mission_origin, 'regular') = 'regular'
               AND datetime(created_at) >= datetime(?)`
          ).bind(userId, period, cycleStart).first<{ count: number }>();

      const existingCount = Number(generatedInCycle?.count ?? 0);
      const missingCount = Math.max(0, MISSION_LIMITS[period] - existingCount);
      if (missingCount > 0) {
        if (period === "daily") {
          await deps.createMissionsForPeriod(env, db, userId, period, missingCount);
        } else {
          missingPeriodicTargets[period === "weekly" ? "weeklyTarget" : "monthlyTarget"] = missingCount;
        }
      }
    }

    if (missingPeriodicTargets.weeklyTarget > 0 || missingPeriodicTargets.monthlyTarget > 0) {
      await deps.ensureStructuredPeriodicMissionsFromExistingDailyBlueprints(
        env,
        db,
        userId,
        missingPeriodicTargets,
      );
    }
  }

  return {
    ensurePeriodicMissions,
    generateStructuredMissionPlanForUser,
  };
}
