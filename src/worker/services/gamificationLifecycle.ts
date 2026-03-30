import type { ConditioningLevel } from "../../shared/types";
import { repairKnownMojibakeString } from "../../shared/textEncoding";
import {
  PARENT_SKILL_MAP,
  variantSkillSeeds,
} from "../../shared/coreSkillSeeds";
import { getErrorMessage } from "../core/errors";
import {
  conditioningOrder,
  skillTierOrder,
} from "./gamificationCatalog";

type GamificationLifecycleDeps = {
  invalidateRankingCache: () => void;
};

type GoalMissionRelevance = {
  isGoalRelevant: boolean;
  missionGroup: string;
  missionType: string;
  userGoal: string;
};

// Concentrates post-mission gamification side effects: counters, titles, achievements, skills, and xp progression.
function canonicalCatalogName(value: string): string {
  return repairKnownMojibakeString(value);
}

async function findTitleIdByName(
  db: D1Database,
  titleName: string,
): Promise<number | null> {
  const canonical = canonicalCatalogName(titleName);
  const row = await db
    .prepare("SELECT id FROM titles WHERE name = ? OR name = ? LIMIT 1")
    .bind(canonical, titleName)
    .first<{ id: number }>();
  return row?.id ?? null;
}

async function findAchievementIdByName(
  db: D1Database,
  achievementName: string,
): Promise<number | null> {
  const canonical = canonicalCatalogName(achievementName);
  const row = await db
    .prepare(
      "SELECT id FROM achievements WHERE name = ? OR name = ? LIMIT 1",
    )
    .bind(canonical, achievementName)
    .first<{ id: number }>();
  return row?.id ?? null;
}

export function createGamificationLifecycleService(
  deps: GamificationLifecycleDeps,
) {
  // Baseline row helpers guarantee that later reward hooks always mutate an existing progression state.
  async function ensureUserCounterRow(
    db: D1Database,
    userId: string,
  ): Promise<void> {
    await db
      .prepare(
        `INSERT OR IGNORE INTO user_event_counters (user_id, updated_at)
         VALUES (?, datetime('now'))`,
      )
      .bind(userId)
      .run();
  }

  async function ensureUserAttributesRow(
    db: D1Database,
    userId: string,
  ): Promise<void> {
    await db
      .prepare(
        `INSERT OR IGNORE INTO user_attributes (
          user_id,
          strength,
          constitution,
          vitality,
          dexterity,
          focus,
          updated_at
        ) VALUES (?, 0, 0, 0, 0, 0, datetime('now'))`,
      )
      .bind(userId)
      .run();
  }

  async function logUserEvent(
    db: D1Database,
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO user_event_log (user_id, event_type, payload_json)
         VALUES (?, ?, ?)`,
      )
      .bind(userId, eventType, JSON.stringify(payload))
      .run();
  }

  async function runMissionLifecycleHookSafely(
    userId: string,
    phase: string,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error("[missions][lifecycle]", {
        userId,
        phase,
        message: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  async function unlockTitleIfNeeded(
    db: D1Database,
    userId: string,
    titleName: string,
  ): Promise<void> {
    const titleId = await findTitleIdByName(db, titleName);
    if (!titleId) return;
    await db
      .prepare(
        `INSERT OR IGNORE INTO user_titles (
          user_id,
          title_id,
          unlocked_at,
          updated_at
        ) VALUES (?, ?, datetime('now'), datetime('now'))`,
      )
      .bind(userId, titleId)
      .run();
  }

  async function unlockAchievementIfNeeded(
    db: D1Database,
    userId: string,
    achievementName: string,
    progressCurrent = 1,
    progressRequired = 1,
  ): Promise<void> {
    const achievementId = await findAchievementIdByName(db, achievementName);
    if (!achievementId) return;

    const normalizedCurrent = Math.max(1, Math.floor(progressCurrent));
    const normalizedRequired = Math.max(1, Math.floor(progressRequired));
    const existing = await db
      .prepare(
        `SELECT id
           FROM user_achievements
          WHERE user_id = ? AND achievement_id = ?
          ORDER BY id ASC
          LIMIT 1`,
      )
      .bind(userId, achievementId)
      .first<{ id: number }>();

    if (existing?.id) {
      await db
        .prepare(
          `UPDATE user_achievements
              SET progress_current = MAX(COALESCE(progress_current, 0), ?),
                  progress_required = MAX(COALESCE(progress_required, 0), ?),
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
        .bind(normalizedCurrent, normalizedRequired, existing.id)
        .run();

      await db
        .prepare(
          `DELETE FROM user_achievements
            WHERE user_id = ? AND achievement_id = ? AND id <> ?`,
        )
        .bind(userId, achievementId, existing.id)
        .run();
      return;
    }

    await db
      .prepare(
        `INSERT INTO user_achievements (
          user_id,
          achievement_id,
          unlocked_at,
          progress_current,
          progress_required,
          updated_at
        ) VALUES (?, ?, datetime('now'), ?, ?, datetime('now'))`,
      )
      .bind(userId, achievementId, normalizedCurrent, normalizedRequired)
      .run();
  }

  // Mission-achievement evaluation translates accumulated counters into durable unlocks and titles.
  async function evaluateMissionAchievementsAndTitles(
    db: D1Database,
    userId: string,
  ): Promise<void> {
    const counters = await db
      .prepare("SELECT * FROM user_event_counters WHERE user_id = ?")
      .bind(userId)
      .first<Record<string, unknown>>();
    const missionsCompleted = Number(counters?.missions_completed ?? 0);
    const consecutiveDays = Number(counters?.consecutive_days_completed ?? 0);

    if (missionsCompleted >= 1) {
      await unlockAchievementIfNeeded(db, userId, "Primeiro Passo", missionsCompleted, 1);
    }
    if (missionsCompleted >= 7) {
      await unlockAchievementIfNeeded(db, userId, "Aquecendo", missionsCompleted, 7);
    }
    if (missionsCompleted >= 30) {
      await unlockAchievementIfNeeded(db, userId, "Rotina Formada", missionsCompleted, 30);
    }
    if (missionsCompleted >= 100) {
      await unlockAchievementIfNeeded(db, userId, "Máquina", missionsCompleted, 100);
    }
    if (missionsCompleted >= 365) {
      await unlockAchievementIfNeeded(db, userId, "Lenda Viva", missionsCompleted, 365);
    }
    if (consecutiveDays >= 5) {
      await unlockAchievementIfNeeded(db, userId, "Sem Desculpas", consecutiveDays, 5);
    }
    if (consecutiveDays >= 30) {
      await unlockAchievementIfNeeded(db, userId, "Imparável", consecutiveDays, 30);
      await unlockTitleIfNeeded(db, userId, "Rocky");
    }
    if (missionsCompleted >= 300) {
      await unlockTitleIfNeeded(db, userId, "300");
    }
    if (missionsCompleted >= 120) {
      await unlockTitleIfNeeded(db, userId, "Shoto Style");
    }
  }

  async function evaluateChatAchievements(
    db: D1Database,
    userId: string,
  ): Promise<void> {
    const counters = await db
      .prepare(
        `SELECT chat_messages, repeated_message_streak
           FROM user_event_counters
          WHERE user_id = ?`,
      )
      .bind(userId)
      .first<{ chat_messages: number; repeated_message_streak: number }>();
    const total = Number(counters?.chat_messages ?? 0);
    const repeat = Number(counters?.repeated_message_streak ?? 0);

    if (total >= 1) await unlockAchievementIfNeeded(db, userId, "Primeira Conversa", total, 1);
    if (total >= 50) await unlockAchievementIfNeeded(db, userId, "Curioso", total, 50);
    if (total >= 200) await unlockAchievementIfNeeded(db, userId, "Aprendiz Dedicado", total, 200);
    if (repeat >= 5) await unlockAchievementIfNeeded(db, userId, "Eco", repeat, 5);
  }

  async function evaluateLevelTitles(
    db: D1Database,
    userId: string,
    level: number,
  ): Promise<void> {
    const byLevel: Array<[number, string]> = [
      [1, "Recruta"],
      [5, "Guerreiro do Core"],
      [10, "Veterano de Ferro"],
      [15, "Lâmina Afiada"],
      [20, "Mestre do Peso Corporal"],
      [30, "O Último de Nós"],
      [50, "Lendário"],
    ];
    for (const [threshold, name] of byLevel) {
      if (level >= threshold) await unlockTitleIfNeeded(db, userId, name);
    }
  }

  // Streak hooks isolate the retention mechanics that react to daily mission continuity changes.
  async function onStreakContinued(
    db: D1Database,
    userId: string,
    streakDays: number,
    missionsCompletedToday: number,
    lastMissionDate?: string | undefined,
  ): Promise<void> {
    await logUserEvent(db, userId, "onStreakContinued", {
      streakDays,
      missionsCompletedToday,
    });

    const milestones: Array<[number, string]> = [
      [3, "Aquecendo o Motor"],
      [7, "Semana Completa"],
      [14, "Ritmo Certo"],
      [21, "Sem Parar"],
      [30, "Mês de Ferro"],
      [60, "Disciplina Absurda"],
      [100, "Inabalável"],
      [365, "Um Ano de Dor"],
    ];
    for (const [value, name] of milestones) {
      if (streakDays >= value) {
        await unlockAchievementIfNeeded(db, userId, name, streakDays, value);
      }
    }

    if (missionsCompletedToday === 1) {
      await db
        .prepare(
          `UPDATE user_event_counters
              SET minimal_streak_days = COALESCE(minimal_streak_days, 0) + 1,
                  single_mission_days_streak = COALESCE(single_mission_days_streak, 0) + 1,
                  updated_at = datetime('now')
            WHERE user_id = ?`,
        )
        .bind(userId)
        .run();
    } else if (missionsCompletedToday > 1) {
      await db
        .prepare(
          `UPDATE user_event_counters
              SET single_mission_days_streak = 0,
                  updated_at = datetime('now')
            WHERE user_id = ?`,
        )
        .bind(userId)
        .run();
    }

    const counters = await db
      .prepare(
        `SELECT
           minimal_streak_days,
           single_mission_days_streak,
           timing_last5m_count,
           timing_2355_streak
         FROM user_event_counters
         WHERE user_id = ?`,
      )
      .bind(userId)
      .first<{
        minimal_streak_days: number;
        single_mission_days_streak: number;
        timing_last5m_count: number;
        timing_2355_streak: number;
      }>();
    const minimal = Number(counters?.minimal_streak_days ?? 0);
    const singleStreak = Number(counters?.single_mission_days_streak ?? 0);

    if (minimal >= 7) await unlockAchievementIfNeeded(db, userId, "Tudo pela Streak", minimal, 7);
    if (minimal >= 30) await unlockAchievementIfNeeded(db, userId, "O Minimalista", minimal, 30);
    if (minimal >= 100) await unlockAchievementIfNeeded(db, userId, "Engenharia de Streak", minimal, 100);
    if (singleStreak >= 30) await unlockAchievementIfNeeded(db, userId, "A Arte da Preguiça", singleStreak, 30);

    if (lastMissionDate) {
      const date = new Date(lastMissionDate);
      const hour = date.getHours();
      const minute = date.getMinutes();
      if (hour === 23 && minute >= 55) {
        await db
          .prepare(
            `UPDATE user_event_counters
                SET timing_last5m_count = COALESCE(timing_last5m_count, 0) + 1,
                    timing_2355_streak = COALESCE(timing_2355_streak, 0) + 1,
                    updated_at = datetime('now')
              WHERE user_id = ?`,
          )
          .bind(userId)
          .run();
        const timing = await db
          .prepare(
            `SELECT timing_last5m_count, timing_2355_streak
               FROM user_event_counters
              WHERE user_id = ?`,
          )
          .bind(userId)
          .first<{ timing_last5m_count: number; timing_2355_streak: number }>();
        if (Number(timing?.timing_last5m_count ?? 0) >= 5) {
          await unlockAchievementIfNeeded(db, userId, "Por um Fio", Number(timing?.timing_last5m_count ?? 0), 5);
        }
        if (Number(timing?.timing_last5m_count ?? 0) >= 20) {
          await unlockAchievementIfNeeded(db, userId, "Especialista em Timing", Number(timing?.timing_last5m_count ?? 0), 20);
        }
        if (Number(timing?.timing_2355_streak ?? 0) >= 7) {
          await unlockAchievementIfNeeded(db, userId, "Missão às 23:59", Number(timing?.timing_2355_streak ?? 0), 7);
        }
      } else {
        await db
          .prepare(
            `UPDATE user_event_counters
                SET timing_2355_streak = 0,
                    updated_at = datetime('now')
              WHERE user_id = ?`,
          )
          .bind(userId)
          .run();
      }
    }
  }

  async function onStreakBroken(
    db: D1Database,
    userId: string,
    streakDaysBefore: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onStreakBroken", { streakDaysBefore });
    await db
      .prepare(
        `UPDATE user_event_counters
            SET streak_loss_count = COALESCE(streak_loss_count, 0) + 1,
                last_streak_break_size = ?,
                single_mission_days_streak = 0,
                updated_at = datetime('now')
          WHERE user_id = ?`,
      )
      .bind(streakDaysBefore, userId)
      .run();

    if (streakDaysBefore >= 1) await unlockAchievementIfNeeded(db, userId, "Acontece", streakDaysBefore, 1);
    if (streakDaysBefore >= 30) await unlockAchievementIfNeeded(db, userId, "Voltar é Difícil", streakDaysBefore, 30);
    if (streakDaysBefore >= 100) await unlockAchievementIfNeeded(db, userId, "Tudo Ruiu", streakDaysBefore, 100);
    if (streakDaysBefore >= 365) await unlockAchievementIfNeeded(db, userId, "A Queda Épica", streakDaysBefore, 365);
  }

  async function onStreakRebuilt(
    db: D1Database,
    userId: string,
    newStreakDays: number,
    previousBestStreak: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onStreakRebuilt", {
      newStreakDays,
      previousBestStreak,
    });
    if (newStreakDays >= 7) await unlockAchievementIfNeeded(db, userId, "De Volta ao Jogo", newStreakDays, 7);
    if (previousBestStreak >= 30 && newStreakDays >= 30) {
      await unlockAchievementIfNeeded(db, userId, "Fênix", newStreakDays, 30);
    }
    if (previousBestStreak >= 100 && newStreakDays >= 100) {
      await unlockAchievementIfNeeded(db, userId, "Lenda Resiliente", newStreakDays, 100);
    }
  }

  async function ensureGoalStatsRow(
    db: D1Database,
    userId: string,
    goal: string | null,
  ): Promise<void> {
    await db
      .prepare(
        `INSERT OR IGNORE INTO user_goal_stats (
          user_id,
          original_goal,
          current_goal,
          updated_at
        ) VALUES (?, ?, ?, datetime('now'))`,
      )
      .bind(userId, goal ?? "saude_geral", goal ?? "saude_geral")
      .run();
  }

  // Goal relevance hooks decide whether a mission meaningfully advanced the player's selected objective.
  async function getMissionContext(
    db: D1Database,
    missionId: number,
  ): Promise<{
    id: number;
    type: string;
    title: string;
    description: string | null;
    skill_category: string | null;
  } | null> {
    return db
      .prepare(
        `SELECT
           m.id,
           m.type,
           m.title,
           m.description,
           s.category as skill_category
         FROM missions m
         LEFT JOIN skills s ON s.id = m.skill_id
         WHERE m.id = ?`,
      )
      .bind(missionId)
      .first<{
        id: number;
        type: string;
        title: string;
        description: string | null;
        skill_category: string | null;
      }>();
  }

  function isMissionRelevantToGoal(
    missionGroup: string,
    missionType: string,
    userGoal: string,
  ): boolean {
    const group = missionGroup.toLowerCase();
    if (userGoal === "ganhar_massa") {
      return (
        ["peito", "costas", "pernas", "ombro", "triceps", "biceps"].some(
          (entry) => group.includes(entry),
        ) || missionType !== "daily"
      );
    }
    if (userGoal === "perder_peso") {
      return (
        ["full", "core", "cardio", "mobilidade"].some((entry) =>
          group.includes(entry),
        ) || missionType === "daily"
      );
    }
    if (userGoal === "resistencia") {
      return (
        ["core", "pernas", "cardio"].some((entry) => group.includes(entry)) ||
        missionType !== "monthly"
      );
    }
    if (userGoal === "calistenia") {
      return ["calistenia", "core", "yoga"].some((entry) =>
        group.includes(entry),
      );
    }
    return true;
  }

  async function onGoalMissionFailed(
    db: D1Database,
    userId: string,
    failCount: number,
    distinctDays: number,
    consecutiveFailDays: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onGoalMissionFailed", {
      failCount,
      distinctDays,
      consecutiveFailDays,
    });
    if (failCount >= 1) await unlockAchievementIfNeeded(db, userId, "Hoje Não", failCount, 1);
    if (distinctDays >= 3) await unlockAchievementIfNeeded(db, userId, "Amanhã Eu Começo", distinctDays, 3);
    if (failCount >= 5) await unlockAchievementIfNeeded(db, userId, "Meta? Que Meta?", failCount, 5);
    if (failCount >= 15) await unlockAchievementIfNeeded(db, userId, "Plano de Mentira", failCount, 15);
    if (failCount >= 30) await unlockAchievementIfNeeded(db, userId, "Autobiotagem", failCount, 30);
    if (consecutiveFailDays >= 7) await unlockAchievementIfNeeded(db, userId, "Speedrun do Fracasso", consecutiveFailDays, 7);
  }

  async function onGoalMissionCompleted(
    db: D1Database,
    userId: string,
    completedCount: number,
    consecutiveDays: number,
    noFailStreak: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onGoalMissionCompleted", {
      completedCount,
      consecutiveDays,
      noFailStreak,
    });
    if (completedCount >= 7) await unlockAchievementIfNeeded(db, userId, "No Caminho Certo", completedCount, 7);
    if (completedCount >= 30) await unlockAchievementIfNeeded(db, userId, "Focado", completedCount, 30);
    if (completedCount >= 100) await unlockAchievementIfNeeded(db, userId, "Comprometido", completedCount, 100);
    if (completedCount >= 365) await unlockAchievementIfNeeded(db, userId, "Obsessão Saudável", completedCount, 365);
    if (consecutiveDays >= 7) await unlockAchievementIfNeeded(db, userId, "Sem Desvios", consecutiveDays, 7);
    if (consecutiveDays >= 30) await unlockAchievementIfNeeded(db, userId, "Olho no Alvo", consecutiveDays, 30);
    if (noFailStreak >= 100) await unlockAchievementIfNeeded(db, userId, "Inabalável no Propósito", noFailStreak, 100);

    const streak = await db
      .prepare("SELECT current_streak FROM user_progression WHERE user_id = ?")
      .bind(userId)
      .first<{ current_streak: number }>();
    if (Number(streak?.current_streak ?? 0) >= 30 && noFailStreak >= 30) {
      await unlockAchievementIfNeeded(db, userId, "Dupla Ameaça", 30, 30);
    }
    if (Number(streak?.current_streak ?? 0) >= 100 && noFailStreak >= 100) {
      await unlockAchievementIfNeeded(db, userId, "Máquina de Resultados", 100, 100);
    }
  }

  async function onGoalProgress(
    db: D1Database,
    userId: string,
    progressPercent: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onGoalProgress", { progressPercent });
    if (progressPercent >= 10) await unlockAchievementIfNeeded(db, userId, "Primeiro Resultado", progressPercent, 10);
    if (progressPercent >= 50) await unlockAchievementIfNeeded(db, userId, "Meio Caminho", progressPercent, 50);
    if (progressPercent >= 90) await unlockAchievementIfNeeded(db, userId, "Quase Lá", progressPercent, 90);
    if (progressPercent >= 100) await unlockAchievementIfNeeded(db, userId, "Meta Batida", progressPercent, 100);
    if (progressPercent >= 120) await unlockAchievementIfNeeded(db, userId, "Além da Meta", progressPercent, 120);
  }

  async function onGoalChanged(
    db: D1Database,
    userId: string,
    oldGoal: string,
    newGoal: string,
    changeCount: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onGoalChanged", {
      oldGoal,
      newGoal,
      changeCount,
    });
    if (changeCount >= 1) await unlockAchievementIfNeeded(db, userId, "Novo Capítulo", changeCount, 1);
    if (changeCount >= 3) await unlockAchievementIfNeeded(db, userId, "Indefinido", changeCount, 3);
  }

  async function checkMissionRelevance(
    userId: string,
    missionId: number,
    db: D1Database,
    mode: "failed" | "completed",
  ): Promise<GoalMissionRelevance> {
    const [mission, profile] = await Promise.all([
      getMissionContext(db, missionId),
      db
        .prepare("SELECT main_goal FROM user_profiles WHERE user_id = ?")
        .bind(userId)
        .first<{ main_goal: string | null }>(),
    ]);

    const userGoal = profile?.main_goal ?? "saude_geral";
    await ensureGoalStatsRow(db, userId, userGoal);

    const missionGroup = String(
      mission?.skill_category ?? mission?.title ?? mission?.description ?? "geral",
    );
    const missionType = String(mission?.type ?? "daily");
    const isGoalRelevant = isMissionRelevantToGoal(
      missionGroup,
      missionType,
      userGoal,
    );

    if (!isGoalRelevant) {
      return { isGoalRelevant, missionGroup, missionType, userGoal };
    }

    const today = new Date().toISOString().split("T")[0];
    const stats = await db
      .prepare("SELECT * FROM user_goal_stats WHERE user_id = ?")
      .bind(userId)
      .first<Record<string, unknown>>();

    if (mode === "failed") {
      const sameDay = String(stats?.goal_fail_last_day ?? "") === today;
      const failCount = Number(stats?.goal_fail_count ?? 0) + 1;
      const distinctDays = Number(stats?.goal_fail_distinct_days ?? 0) + (sameDay ? 0 : 1);
      const consecutiveFailDays = sameDay
        ? Number(stats?.goal_fail_consecutive_days ?? 0)
        : Number(stats?.goal_fail_consecutive_days ?? 0) + 1;

      await db
        .prepare(
          `UPDATE user_goal_stats
              SET goal_fail_count = ?,
                  goal_fail_distinct_days = ?,
                  goal_fail_last_day = ?,
                  goal_fail_consecutive_days = ?,
                  updated_at = datetime('now')
            WHERE user_id = ?`,
        )
        .bind(failCount, distinctDays, today, consecutiveFailDays, userId)
        .run();
      await onGoalMissionFailed(db, userId, failCount, distinctDays, consecutiveFailDays);
    } else {
      const sameDay = String(stats?.goal_completed_last_day ?? "") === today;
      const completedCount = Number(stats?.goal_completed_count ?? 0) + 1;
      const completedConsecutive = sameDay
        ? Number(stats?.goal_completed_consecutive_days ?? 0)
        : Number(stats?.goal_completed_consecutive_days ?? 0) + 1;
      const noFailStreak = sameDay
        ? Number(stats?.goal_no_fail_streak_days ?? 0)
        : Number(stats?.goal_no_fail_streak_days ?? 0) + 1;

      await db
        .prepare(
          `UPDATE user_goal_stats
              SET goal_completed_count = ?,
                  goal_completed_last_day = ?,
                  goal_completed_consecutive_days = ?,
                  goal_no_fail_streak_days = ?,
                  missions_after_return = CASE
                    WHEN returned_to_original_count > 0
                     AND current_goal = original_goal
                    THEN COALESCE(missions_after_return, 0) + 1
                    ELSE missions_after_return
                  END,
                  updated_at = datetime('now')
            WHERE user_id = ?`,
        )
        .bind(completedCount, today, completedConsecutive, noFailStreak, userId)
        .run();

      const returnedStats = await db
        .prepare(
          `SELECT missions_after_return, returned_to_original_count
             FROM user_goal_stats
            WHERE user_id = ?`,
        )
        .bind(userId)
        .first<{ missions_after_return: number; returned_to_original_count: number }>();
      if (
        Number(returnedStats?.returned_to_original_count ?? 0) > 0 &&
        Number(returnedStats?.missions_after_return ?? 0) >= 30
      ) {
        await unlockAchievementIfNeeded(
          db,
          userId,
          "A Meta era Essa?",
          Number(returnedStats?.missions_after_return ?? 0),
          30,
        );
      }
      await onGoalMissionCompleted(
        db,
        userId,
        completedCount,
        completedConsecutive,
        noFailStreak,
      );
    }

    return { isGoalRelevant, missionGroup, missionType, userGoal };
  }

  // Public lifecycle hooks are the integration surface consumed by mission, ranking, profile, and chat flows.
  async function onMissionComplete(
    db: D1Database,
    userId: string,
    missionId: number,
  ): Promise<void> {
    await runMissionLifecycleHookSafely(userId, "mission_complete_log", () =>
      logUserEvent(db, userId, "onMissionComplete", { missionId }),
    );
    await runMissionLifecycleHookSafely(
      userId,
      "mission_complete_achievements",
      () => evaluateMissionAchievementsAndTitles(db, userId),
    );
  }

  async function onLevelUp(
    db: D1Database,
    userId: string,
    newLevel: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onLevelUp", { newLevel });
    await evaluateLevelTitles(db, userId, newLevel);
  }

  async function onChatMessage(
    db: D1Database,
    userId: string,
    messageCount: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onChatMessage", { messageCount });
    await evaluateChatAchievements(db, userId);
  }

  async function onSkillUnlocked(
    db: D1Database,
    userId: string,
    skillId: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onSkillUnlocked", { skillId });

    const skill = await db
      .prepare("SELECT name, tier FROM skills WHERE id = ?")
      .bind(skillId)
      .first<{ name: string; tier: string }>();
    const count = await db
      .prepare("SELECT COUNT(*) as c FROM user_skills WHERE user_id = ?")
      .bind(userId)
      .first<{ c: number }>();
    const unlockedCount = Number(count?.c ?? 0);
    if (unlockedCount >= 5) {
      await unlockTitleIfNeeded(db, userId, "Demon Slayer");
    }

    if (skill?.name === "Handstand") {
      await unlockAchievementIfNeeded(db, userId, "Primeiros Voos", 1, 1);
    }

    const calisthenics = await db
      .prepare(
        `SELECT COUNT(*) as c
           FROM user_skills us
           INNER JOIN skills s ON s.id = us.skill_id
          WHERE us.user_id = ? AND s.tier = 'calistenico'`,
      )
      .bind(userId)
      .first<{ c: number }>();
    if (Number(calisthenics?.c ?? 0) >= 9) {
      await unlockAchievementIfNeeded(
        db,
        userId,
        "Kalista",
        Number(calisthenics?.c ?? 0),
        9,
      );
    }
  }

  async function onRankingUpdate(
    db: D1Database,
    userId: string,
    position: number,
  ): Promise<void> {
    await logUserEvent(db, userId, "onRankingUpdate", { position });
  }

  async function onFriendAdded(
    db: D1Database,
    userId: string,
  ): Promise<void> {
    await logUserEvent(db, userId, "onFriendAdded", {});
    const [rankData, friendsCount] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(*) + 1 as position
             FROM user_progression
            WHERE (
              level > (SELECT level FROM user_progression WHERE user_id = ?)
              OR (
                level = (SELECT level FROM user_progression WHERE user_id = ?)
                AND xp > (SELECT xp FROM user_progression WHERE user_id = ?)
              )
            )`,
        )
        .bind(userId, userId, userId)
        .first<{ position: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) as c
             FROM friendships
            WHERE user_id = ? OR friend_id = ? OR friend_user_id = ?`,
        )
        .bind(userId, userId, userId)
        .first<{ c: number }>(),
    ]);
    if (
      Number(rankData?.position ?? 999) <= 10 &&
      Number(friendsCount?.c ?? 0) === 0
    ) {
      await unlockAchievementIfNeeded(db, userId, "Ghost", 1, 1);
    }
  }

  async function onProfileCustomization(
    db: D1Database,
    userId: string,
    customizations: Record<string, unknown>,
  ): Promise<void> {
    await logUserEvent(db, userId, "onProfileCustomization", customizations);
  }

  async function onAppOpen(
    db: D1Database,
    userId: string,
    timestamp: string,
  ): Promise<void> {
    await ensureUserCounterRow(db, userId);
    const current = await db
      .prepare(
        "SELECT app_last_open_at FROM user_event_counters WHERE user_id = ?",
      )
      .bind(userId)
      .first<{ app_last_open_at: string | null }>();
    const previous = current?.app_last_open_at
      ? new Date(current.app_last_open_at).getTime()
      : Date.now();
    const now = new Date(timestamp).getTime();
    const gapDays = Math.max(0, Math.floor((now - previous) / 86400000));

    await db
      .prepare(
        `UPDATE user_event_counters
            SET app_last_open_at = ?,
                app_open_gap_days = ?,
                updated_at = datetime('now')
          WHERE user_id = ?`,
      )
      .bind(timestamp, gapDays, userId)
      .run();
    await logUserEvent(db, userId, "onAppOpen", { gapDays, timestamp });

    const hour = new Date(timestamp).getHours();
    if (hour >= 2 && hour < 4) {
      await unlockAchievementIfNeeded(db, userId, "Insônia", 1, 1);
    }

    if (gapDays >= 6) {
      const missionToday = await db
        .prepare(
          `SELECT COUNT(*) as c
             FROM missions
            WHERE user_id = ?
              AND is_completed = 1
              AND date(completed_at) = date('now')`,
        )
        .bind(userId)
        .first<{ c: number }>();
      if (Number(missionToday?.c ?? 0) >= 1) {
        await unlockAchievementIfNeeded(
          db,
          userId,
          "Fantasma",
          Number(gapDays),
          7,
        );
      }
    }
  }

  // Skill unlock and level-resolution helpers keep xp gains synchronized with progression side effects.
  async function tryUnlockSkillsForLevel(
    db: D1Database,
    userId: string,
    level: number,
  ): Promise<void> {
    const [profile, attrs] = await Promise.all([
      db
        .prepare(
          "SELECT initial_conditioning FROM user_profiles WHERE user_id = ?",
        )
        .bind(userId)
        .first<{ initial_conditioning: ConditioningLevel }>(),
      db
        .prepare(
          `SELECT strength, constitution, vitality, dexterity, focus
             FROM user_attributes
            WHERE user_id = ?`,
        )
        .bind(userId)
        .first<Record<string, number>>(),
    ]);
    const conditioning = (profile?.initial_conditioning ?? "iniciante") as ConditioningLevel;

    const candidates = await db
      .prepare(
        `SELECT id, name, tier, level_required, prerequisites, attribute_requirements
           FROM skills
          WHERE COALESCE(level_required, required_level) <= ?
            AND id NOT IN (
              SELECT skill_id FROM user_skills WHERE user_id = ?
            )`,
      )
      .bind(level, userId)
      .all<{
        id: number;
        name: string;
        tier: string;
        level_required: number;
        prerequisites?: string | undefined;
        attribute_requirements?: string | undefined;
      }>();

    for (const skill of candidates.results) {
      if (skillTierOrder(skill.tier) > conditioningOrder(conditioning) + 1) {
        continue;
      }
      const prereqNames = JSON.parse(skill.prerequisites || "[]") as string[];
      let hasPrereq = true;
      for (const prereq of prereqNames) {
        const row = await db
          .prepare(
            `SELECT 1
               FROM user_skills us
               INNER JOIN skills s ON s.id = us.skill_id
              WHERE us.user_id = ? AND s.name = ?`,
          )
          .bind(userId, prereq)
          .first();
        if (!row) {
          hasPrereq = false;
          break;
        }
      }
      if (!hasPrereq) continue;

      const requirements = JSON.parse(
        skill.attribute_requirements || "{}",
      ) as Record<string, number>;
      const attributesOk = Object.entries(requirements).every(
        ([key, value]) => Number(attrs?.[key] ?? 0) >= Number(value),
      );
      if (!attributesOk) continue;

      await db
        .prepare(
          `INSERT OR IGNORE INTO user_skills (
            user_id,
            skill_id,
            status,
            current_stage,
            total_reps,
            total_time,
            best_reps,
            unlocked_at,
            updated_at
          ) VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`,
        )
        .bind(userId, skill.id)
        .run();
      await db
        .prepare(
          `UPDATE user_event_counters
              SET skills_unlocked = COALESCE(skills_unlocked, 0) + 1,
                  updated_at = datetime('now')
            WHERE user_id = ?`,
        )
        .bind(userId)
        .run();
      await onSkillUnlocked(db, userId, skill.id);
    }
  }

  async function tryUnlockSkillsFromPerformance(
    db: D1Database,
    userId: string,
  ): Promise<void> {
    const profile = await db
      .prepare(
        "SELECT initial_conditioning FROM user_profiles WHERE user_id = ?",
      )
      .bind(userId)
      .first<{ initial_conditioning: string }>();
    const conditioning = (profile?.initial_conditioning ?? "iniciante") as ConditioningLevel;
    const maxTier = conditioningOrder(conditioning) + 1;

    for (const variantSeed of variantSkillSeeds) {
      const parentName = PARENT_SKILL_MAP[variantSeed.parentSkill] ?? variantSeed.parentSkill;
      const [parentSkill, childSkill, hasChild] = await Promise.all([
        db
          .prepare("SELECT id FROM skills WHERE name = ?")
          .bind(parentName)
          .first<{ id: number }>(),
        db
          .prepare("SELECT id, tier FROM skills WHERE name = ?")
          .bind(variantSeed.namePt)
          .first<{ id: number; tier: string }>(),
        db
          .prepare(
            `SELECT 1
               FROM user_skills us
               INNER JOIN skills s ON s.id = us.skill_id
              WHERE us.user_id = ? AND s.name = ?`,
          )
          .bind(userId, variantSeed.namePt)
          .first(),
      ]);
      if (!parentSkill?.id || !childSkill?.id || hasChild) continue;
      if (skillTierOrder(childSkill.tier) > maxTier) continue;

      const parentStats = await db
        .prepare(
          `SELECT best_reps, total_reps, total_time
             FROM user_skills
            WHERE user_id = ? AND skill_id = ?`,
        )
        .bind(userId, parentSkill.id)
        .first<{ best_reps: number; total_reps: number; total_time: number }>();
      if (!parentStats) continue;

      const threshold = variantSeed.threshold;
      const meetsThreshold =
        variantSeed.thresholdType === "reps"
          ? Number(parentStats.best_reps ?? 0) >= threshold ||
            Number(parentStats.total_reps ?? 0) >= threshold
          : Number(parentStats.total_time ?? 0) >= threshold;
      if (!meetsThreshold) continue;

      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO user_skills (
            user_id,
            skill_id,
            status,
            current_stage,
            total_reps,
            total_time,
            best_reps,
            unlocked_at,
            updated_at
          ) VALUES (?, ?, 'unlocked', 1, 0, 0, 0, datetime('now'), datetime('now'))`,
        )
        .bind(userId, childSkill.id)
        .run();
      if (Number(result.meta.changes ?? 0) > 0) {
        await db
          .prepare(
            `UPDATE user_event_counters
                SET skills_unlocked = COALESCE(skills_unlocked, 0) + 1,
                    updated_at = datetime('now')
              WHERE user_id = ?`,
          )
          .bind(userId)
          .run();
        await onSkillUnlocked(db, userId, childSkill.id);
      }
    }
  }

  function xpRequiredToAdvanceFromLevel(level: number): number {
    const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
    return Math.max(100, normalizedLevel * 100);
  }

  function parseProgressionXpLevel(
    row: { xp?: unknown; level?: unknown } | null | undefined,
  ): { xp: number; level: number } {
    const level = Math.max(1, Math.floor(Number(row?.level ?? 1)));
    const xp = Math.max(0, Math.floor(Number(row?.xp ?? 0)));
    return { xp, level };
  }

  function computeXpAndLevelAfterGain(
    xp: number,
    level: number,
    xpDelta: number,
  ): { xp: number; level: number; levelsGained: number } {
    const add = Math.max(0, Math.floor(Number(xpDelta) || 0));
    let currentXp = Math.max(0, Math.floor(xp)) + add;
    let currentLevel = Math.max(1, Math.floor(level));
    let levelsGained = 0;
    const maxIterations = 1000;
    for (let index = 0; index < maxIterations; index += 1) {
      const requiredXp = xpRequiredToAdvanceFromLevel(currentLevel);
      if (currentXp < requiredXp) break;
      currentXp -= requiredXp;
      currentLevel += 1;
      levelsGained += 1;
    }
    return { xp: currentXp, level: currentLevel, levelsGained };
  }

  async function applyXpPointsAndResolveLevels(
    db: D1Database,
    userId: string,
    xpDelta: number,
    pointsDelta: number,
  ): Promise<{ leveledUp: boolean; newLevel: number; levelsGained: number }> {
    const row = await db
      .prepare("SELECT xp, level FROM user_progression WHERE user_id = ?")
      .bind(userId)
      .first<{ xp: number | null; level: number | null }>();
    if (!row) {
      return { leveledUp: false, newLevel: 1, levelsGained: 0 };
    }

    const before = parseProgressionXpLevel(row);
    const next = computeXpAndLevelAfterGain(before.xp, before.level, xpDelta);
    const pointsAdd =
      Math.max(0, Math.floor(Number(pointsDelta) || 0)) +
      100 * next.levelsGained;

    if (
      next.levelsGained === 0 &&
      next.xp === before.xp &&
      next.level === before.level &&
      pointsAdd === 0
    ) {
      return { leveledUp: false, newLevel: before.level, levelsGained: 0 };
    }

    await db
      .prepare(
        `UPDATE user_progression
            SET xp = ?,
                level = ?,
                points = COALESCE(points, 0) + ?,
                updated_at = datetime('now')
          WHERE user_id = ?`,
      )
      .bind(next.xp, next.level, pointsAdd, userId)
      .run();

    if (next.levelsGained > 0) {
      deps.invalidateRankingCache();
      for (let level = before.level + 1; level <= next.level; level += 1) {
        await runMissionLifecycleHookSafely(userId, "on_level_up", () =>
          onLevelUp(db, userId, level),
        );
        await runMissionLifecycleHookSafely(userId, "unlock_skills", () =>
          tryUnlockSkillsForLevel(db, userId, level),
        );
      }
    } else if (xpDelta !== 0 || pointsDelta !== 0) {
      deps.invalidateRankingCache();
    }

    return {
      leveledUp: next.levelsGained > 0,
      newLevel: next.level,
      levelsGained: next.levelsGained,
    };
  }

  return {
    applyXpPointsAndResolveLevels,
    checkMissionRelevance,
    computeXpAndLevelAfterGain,
    ensureGoalStatsRow,
    ensureUserAttributesRow,
    ensureUserCounterRow,
    evaluateLevelTitles,
    logUserEvent,
    onAppOpen,
    onChatMessage,
    onFriendAdded,
    onGoalChanged,
    onGoalProgress,
    onLevelUp,
    onMissionComplete,
    onProfileCustomization,
    onRankingUpdate,
    onStreakBroken,
    onStreakContinued,
    onStreakRebuilt,
    parseProgressionXpLevel,
    runMissionLifecycleHookSafely,
    tryUnlockSkillsForLevel,
    tryUnlockSkillsFromPerformance,
    unlockAchievementIfNeeded,
    unlockTitleIfNeeded,
  };
}
