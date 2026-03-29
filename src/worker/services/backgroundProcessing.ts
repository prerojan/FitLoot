import { getErrorMessage } from "../core/errors";
import type { Env, PhysicalBenchmarkRow } from "../core/types";
import { processDailyResetForAllUsers } from "./dailyReset";

type BackgroundProcessingDeps = {
  cleanupSettledMissionsWithGuard: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  ensurePeriodicMissions: (
    env: Env,
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  ensureUserCounterRow: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
  expirePendingMissionsAndUpdateStreak: (
    db: D1Database,
    userId: string,
  ) => Promise<void>;
};

export function createBackgroundProcessingService(
  deps: BackgroundProcessingDeps,
) {
  async function createDailySnapshot(
    db: D1Database,
    userId: string,
  ): Promise<void> {
    try {
      const lastActivity = await db.prepare(
        "SELECT last_activity_date FROM user_progression WHERE user_id = ?"
      ).bind(userId).first<{ last_activity_date: string }>();

      if (!lastActivity?.last_activity_date) {
        return;
      }

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      if (new Date(lastActivity.last_activity_date) < sevenDaysAgo) {
        return;
      }

      const [progression, attributes, missionsCompleted] = await Promise.all([
        db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(userId).first(),
        db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(userId).first(),
        db.prepare(
          "SELECT COUNT(*) as count FROM missions WHERE user_id = ? AND is_completed = 1"
        ).bind(userId).first<{ count: number }>(),
      ]);

      if (!progression || !attributes) {
        return;
      }

      await db.prepare(`
        INSERT OR IGNORE INTO progress_snapshots
        (user_id, level, xp, strength, constitution, vitality, dexterity, focus, missions_completed, streak)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        userId,
        progression.level,
        progression.xp,
        attributes.strength,
        attributes.constitution,
        attributes.vitality,
        attributes.dexterity,
        attributes.focus,
        missionsCompleted?.count || 0,
        progression.current_streak,
      ).run();
    } catch (error) {
      console.error("[createDailySnapshot]", { userId, error: getErrorMessage(error) });
    }
  }

  async function recalculateUserAttributes(
    db: D1Database,
    userId: string,
  ): Promise<void> {
    try {
      const latestBenchmark = await db.prepare(`
        SELECT * FROM physical_benchmarks
        WHERE user_id = ?
        ORDER BY test_date DESC
        LIMIT 1
      `).bind(userId).first<PhysicalBenchmarkRow>();

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const weeklyMissions = await db.prepare(`
        SELECT COUNT(*) as count FROM missions
        WHERE user_id = ?
        AND is_completed = 1
        AND completed_at >= datetime(?)
      `).bind(userId, oneWeekAgo.toISOString()).first<{ count: number }>();

      const progression = await db.prepare(
        "SELECT current_streak FROM user_progression WHERE user_id = ?"
      ).bind(userId).first<{ current_streak: number }>();

      if (!progression) {
        return;
      }

      let strengthBonus = 0;
      let vitalityBonus = 0;
      let focusBonus = 0;
      let dexterityBonus = 0;
      let constitutionBonus = 0;

      if (latestBenchmark) {
        const pushupsMax = latestBenchmark.pushups_max ?? 0;
        const squatsMax = latestBenchmark.squats_max ?? 0;
        const situpsMax = latestBenchmark.situps_max ?? 0;
        const plankSeconds = latestBenchmark.plank_seconds ?? 0;
        const pullupsMax = latestBenchmark.pullups_max ?? 0;
        const runDistanceKm = latestBenchmark.run_distance_km ?? 0;

        if (pushupsMax && pushupsMax > 0) {
          strengthBonus += Math.floor(pushupsMax / 5);
        }
        if (squatsMax && squatsMax > 0) {
          vitalityBonus += Math.floor(squatsMax / 5);
        }
        if (situpsMax && situpsMax > 0) {
          focusBonus += Math.floor(situpsMax / 5);
        }
        if (plankSeconds && plankSeconds > 0) {
          dexterityBonus += Math.floor(plankSeconds / 30);
        }
        if (pullupsMax && pullupsMax > 0) {
          strengthBonus += pullupsMax * 2;
        }
        if (runDistanceKm && runDistanceKm > 0) {
          constitutionBonus += Math.floor(runDistanceKm * 2);
        }
      }

      const missionBonus = Math.min(Math.floor((weeklyMissions?.count || 0) / 5), 10);
      const streakBonus = Math.min(Math.floor(progression.current_streak / 7), 5);
      const totalBonus = missionBonus + streakBonus;
      const perAttributeBonus = Math.floor(totalBonus / 5);

      await db.prepare(`
        UPDATE user_attributes SET
          strength = strength + ?,
          constitution = constitution + ?,
          vitality = vitality + ?,
          dexterity = dexterity + ?,
          focus = focus + ?,
          updated_at = datetime('now')
        WHERE user_id = ?
      `).bind(
        strengthBonus + perAttributeBonus,
        constitutionBonus + perAttributeBonus,
        vitalityBonus + perAttributeBonus,
        dexterityBonus + perAttributeBonus,
        focusBonus + perAttributeBonus,
        userId,
      ).run();

      const [updatedAttributes, updatedProgression] = await Promise.all([
        db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(userId).first(),
        db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(userId).first(),
      ]);

      if (updatedAttributes && updatedProgression) {
        await db.prepare(`
          INSERT OR IGNORE INTO progress_snapshots
          (user_id, level, xp, strength, constitution, vitality, dexterity, focus, missions_completed, streak)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          userId,
          updatedProgression.level,
          updatedProgression.xp,
          updatedAttributes.strength,
          updatedAttributes.constitution,
          updatedAttributes.vitality,
          updatedAttributes.dexterity,
          updatedAttributes.focus,
          weeklyMissions?.count || 0,
          updatedProgression.current_streak,
        ).run();
      }
    } catch (error) {
      console.error("[recalculateUserAttributes]", { userId, error: getErrorMessage(error) });
    }
  }

  async function processDailyReset(env: Env): Promise<void> {
    await processDailyResetForAllUsers({
      db: env.fitloot_db,
      processUser: async (userId) => {
        try {
          await deps.ensureUserCounterRow(env.fitloot_db, userId);
          await deps.cleanupSettledMissionsWithGuard(env.fitloot_db, userId);
          await deps.expirePendingMissionsAndUpdateStreak(env.fitloot_db, userId);
          await deps.ensurePeriodicMissions(env, env.fitloot_db, userId);
          await createDailySnapshot(env.fitloot_db, userId);
        } catch (error) {
          console.error("[processDailyReset][user]", {
            userId,
            message: getErrorMessage(error),
          });
        }
      },
    });
  }

  async function processWeeklyRecalculation(env: Env): Promise<void> {
    const pageSize = 50;
    let offset = 0;

    while (true) {
      const users = await env.fitloot_db.prepare(`
        SELECT user_id FROM user_profiles
        WHERE user_id IN (
          SELECT user_id FROM user_progression
          WHERE last_activity_date >= datetime('now', '-7 days')
        )
        ORDER BY user_id
        LIMIT ? OFFSET ?
      `).bind(pageSize, offset).all<{ user_id: string }>();

      const batch = Array.isArray(users.results) ? users.results : [];
      if (batch.length === 0) {
        break;
      }

      for (const user of batch) {
        await recalculateUserAttributes(env.fitloot_db, user.user_id);
      }

      if (batch.length < pageSize) {
        break;
      }
      offset += pageSize;
    }
  }

  async function runScheduledWithGuard(
    event: ScheduledEvent,
    env: Env,
  ): Promise<void> {
    try {
      await processDailyReset(env);

      if (event.cron === "0 0 * * 1") {
        console.log("[worker][weekly-recalculation] Iniciando recálculo semanal de atributos");
        await processWeeklyRecalculation(env);
        console.log("[worker][weekly-recalculation] Recálculo semanal concluído");
      }
    } catch (error) {
      console.error("[worker][scheduled-guard]", {
        cron: event.cron,
        scheduledTime: event.scheduledTime,
        message: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  return {
    createDailySnapshot,
    processDailyReset,
    processWeeklyRecalculation,
    recalculateUserAttributes,
    runScheduledWithGuard,
  };
}
