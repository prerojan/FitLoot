import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  MiniGameChallengeRequestSchema,
  MiniGameCompleteRequestSchema,
} from "../../shared/types";
import type { AppContext, Env } from "../core/types";
import type { WithTransaction } from "./contracts";

type MiniGameRouteDeps = {
  applyXpPointsAndResolveLevels: (
    db: D1Database,
    userId: string,
    xpDelta: number,
    pointsDelta: number,
  ) => Promise<{ leveledUp: boolean; newLevel: number; levelsGained: number }>;
  authMiddleware: MiddlewareHandler<AppContext>;
  ensureUserCounterRow: (db: D1Database, userId: string) => Promise<void>;
  getRewardNotificationCursor: (
    db: D1Database,
    userId: string,
  ) => Promise<number>;
  invalidateRankingCache: () => void;
  listRewardNotifications: (
    db: D1Database,
    userId: string,
    options: {
      afterId?: number;
      pendingOnly?: boolean;
      limit?: number;
    },
  ) => Promise<Array<{ type: string } & Record<string, unknown>>>;
  logUserEvent: (
    db: D1Database,
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  unlockAchievementIfNeeded: (
    db: D1Database,
    userId: string,
    achievementName: string,
    progressCurrent?: number,
    progressRequired?: number,
  ) => Promise<void>;
  withTransaction: WithTransaction;
};

const MINI_GAME_ALREADY_COMPLETED_ERROR = "MINI_GAME_ALREADY_COMPLETED";

async function registerMiniGameResult(
  db: D1Database,
  userId: string,
  didWin: boolean,
  deps: Pick<
    MiniGameRouteDeps,
    "ensureUserCounterRow" | "unlockAchievementIfNeeded"
  >,
) {
  await deps.ensureUserCounterRow(db, userId);

  await db.prepare(
    `UPDATE user_event_counters
      SET minigames_played = COALESCE(minigames_played, 0) + 1,
          minigames_won = COALESCE(minigames_won, 0) + ?,
          minigame_win_streak = CASE
            WHEN ? = 1 THEN COALESCE(minigame_win_streak, 0) + 1
            ELSE 0
          END,
          updated_at = datetime('now')
      WHERE user_id = ?`,
  ).bind(didWin ? 1 : 0, didWin ? 1 : 0, userId).run();

  const counters = await db.prepare(
    "SELECT minigames_played, minigames_won, minigame_win_streak FROM user_event_counters WHERE user_id = ?",
  ).bind(userId).first<{
    minigames_played: number;
    minigames_won: number;
    minigame_win_streak: number;
  }>();

  const played = Number(counters?.minigames_played ?? 0);
  const won = Number(counters?.minigames_won ?? 0);
  const winStreak = Number(counters?.minigame_win_streak ?? 0);

  if (played >= 1) {
    await deps.unlockAchievementIfNeeded(db, userId, "Jogador", played, 1);
  }
  if (won >= 10) {
    await deps.unlockAchievementIfNeeded(db, userId, "Competidor", won, 10);
  }
  if (winStreak >= 50) {
    await deps.unlockAchievementIfNeeded(db, userId, "Imbatível", winStreak, 50);
  }
}

export function registerMiniGameRoutes(
  app: Hono<AppContext>,
  deps: MiniGameRouteDeps,
): void {
  app.post(
    "/api/mini-games/challenge",
    deps.authMiddleware,
    zValidator("json", MiniGameChallengeRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const data = c.req.valid("json");

      let challengedUserId = data.challenged_user_id;

      if (data.opponent_type === "random") {
        const progression = await c.env.fitloot_db.prepare(
          "SELECT level FROM user_progression WHERE user_id = ?",
        ).bind(user.id).first();

        const level = Number(progression?.level || 1);
        const minLevel = Math.max(1, level - 5);
        const maxLevel = level + 5;

        const randomUser = await c.env.fitloot_db.prepare(
          `SELECT user_id FROM user_progression
          WHERE user_id != ? AND level BETWEEN ? AND ?
          ORDER BY RANDOM()
          LIMIT 1`,
        ).bind(user.id, minLevel, maxLevel).first();

        if (!randomUser) {
          return c.json({ error: "No suitable opponent found" }, 404);
        }

        challengedUserId = randomUser.user_id as string;
      }

      if (!challengedUserId) {
        return c.json({ error: "Opponent not specified" }, 400);
      }

      if (challengedUserId === user.id) {
        return c.json({ error: "Cannot challenge yourself" }, 400);
      }

      const [targetUser, skill] = await Promise.all([
        c.env.fitloot_db.prepare("SELECT user_id FROM user_profiles WHERE user_id = ?").bind(challengedUserId).first<{ user_id: string }>(),
        c.env.fitloot_db.prepare("SELECT id FROM skills WHERE id = ?").bind(data.skill_id).first<{ id: number }>(),
      ]);

      if (!targetUser) {
        return c.json({ error: "Opponent not found" }, 404);
      }

      if (!skill) {
        return c.json({ error: "Skill not found" }, 404);
      }

      const existingGame = await c.env.fitloot_db.prepare(
        `SELECT id FROM mini_games
          WHERE skill_id = ?
          AND status IN ('pending', 'active')
          AND ((challenger_user_id = ? AND challenged_user_id = ?) OR (challenger_user_id = ? AND challenged_user_id = ?))`,
      ).bind(data.skill_id, user.id, challengedUserId, challengedUserId, user.id).first<{ id: number }>();

      if (existingGame?.id) {
        return c.json({ error: "Existing challenge in progress" }, 409);
      }

      const xpReward = data.target_reps * 5;
      const pointsReward = data.target_reps;
      const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await c.env.fitloot_db.prepare(
        `INSERT INTO mini_games (challenger_user_id, challenged_user_id, skill_id,
        target_reps, status, xp_reward, points_reward, deadline, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, datetime('now'))`,
      ).bind(
        user.id,
        challengedUserId,
        data.skill_id,
        data.target_reps,
        xpReward,
        pointsReward,
        deadline,
      ).run();

      return c.json({ success: true }, 201);
    },
  );

  app.get("/api/mini-games/active", deps.authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 120), 1), 250);

    const games = await c.env.fitloot_db.prepare(
      `SELECT mg.*,
      s.name as skill_name,
      up1.username as challenger_username,
      up2.username as challenged_username
      FROM mini_games mg
      INNER JOIN skills s ON mg.skill_id = s.id
      INNER JOIN user_profiles up1 ON mg.challenger_user_id = up1.user_id
      INNER JOIN user_profiles up2 ON mg.challenged_user_id = up2.user_id
      WHERE (mg.challenger_user_id = ? OR mg.challenged_user_id = ?)
      ORDER BY
        CASE mg.status
          WHEN 'active' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        mg.created_at DESC
      LIMIT ?`,
    ).bind(user.id, user.id, limit).all();

    return c.json(games.results);
  });

  app.post("/api/mini-games/:id/accept", deps.authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const gameId = Number(c.req.param("id"));
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return c.json({ error: "Invalid game id" }, 400);
    }

    const accepted = await c.env.fitloot_db.prepare(
      `UPDATE mini_games SET status = 'active', updated_at = datetime('now')
        WHERE id = ? AND challenged_user_id = ? AND status = 'pending'`,
    ).bind(gameId, user.id).run();

    const changes = Number((accepted as { meta?: { changes?: number } }).meta?.changes ?? 0);
    if (changes === 0) {
      return c.json({ error: "Game not found" }, 404);
    }

    return c.json({ success: true });
  });

  app.post(
    "/api/mini-games/:id/complete",
    deps.authMiddleware,
    zValidator("json", MiniGameCompleteRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      const gameId = Number(c.req.param("id"));
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return c.json({ error: "Invalid game id" }, 400);
      }

      const data = c.req.valid("json");

      const game = await c.env.fitloot_db.prepare(
        `SELECT id, challenger_user_id, challenged_user_id, target_reps, xp_reward, points_reward
          FROM mini_games
          WHERE id = ? AND status = 'active'`,
      ).bind(gameId).first<{
        id: number;
        challenger_user_id: string;
        challenged_user_id: string;
        target_reps: number;
        xp_reward: number;
        points_reward: number;
      }>();

      if (!game) {
        return c.json({ error: "Game not found" }, 404);
      }

      const isParticipant =
        game.challenger_user_id === user.id || game.challenged_user_id === user.id;
      if (!isParticipant) {
        return c.json({ error: "Forbidden" }, 403);
      }

      if (Number(data.reps_completed) < Number(game.target_reps ?? 0)) {
        return c.json({ error: "Target reps not reached" }, 400);
      }

      const winnerUserId = user.id;
      const loserUserId =
        winnerUserId === game.challenger_user_id
          ? game.challenged_user_id
          : game.challenger_user_id;
      const rewardNotificationCursor = await deps.getRewardNotificationCursor(
        c.env.fitloot_db,
        winnerUserId,
      );

      const winnerXp = Number(game.xp_reward ?? 0);
      const winnerPoints = Number(game.points_reward ?? 0);
      const loserXp = Math.floor(winnerXp / 2);
      const loserPoints = Math.floor(winnerPoints / 2);

      try {
        await deps.withTransaction(
          c.env.fitloot_db,
          async () => {
            const completeUpdate = await c.env.fitloot_db.prepare(
              `UPDATE mini_games
                SET status = 'completed', winner_user_id = ?, updated_at = datetime('now')
                WHERE id = ? AND status = 'active'`,
            ).bind(winnerUserId, gameId).run();

            const completeChanges = Number(
              (completeUpdate as { meta?: { changes?: number } }).meta?.changes ?? 0,
            );
            if (completeChanges === 0) {
              throw new Error(MINI_GAME_ALREADY_COMPLETED_ERROR);
            }

            await deps.applyXpPointsAndResolveLevels(
              c.env.fitloot_db,
              winnerUserId,
              winnerXp,
              winnerPoints,
            );
            await deps.applyXpPointsAndResolveLevels(
              c.env.fitloot_db,
              loserUserId,
              loserXp,
              loserPoints,
            );
            await registerMiniGameResult(
              c.env.fitloot_db,
              winnerUserId,
              true,
              deps,
            );
            await registerMiniGameResult(
              c.env.fitloot_db,
              loserUserId,
              false,
              deps,
            );
            await deps.logUserEvent(c.env.fitloot_db, winnerUserId, "onMiniGameComplete", {
              gameId,
              won: true,
              reps_completed: data.reps_completed,
              time_seconds: data.time_seconds,
            });
            await deps.logUserEvent(c.env.fitloot_db, loserUserId, "onMiniGameComplete", {
              gameId,
              won: false,
              reps_completed: data.reps_completed,
              time_seconds: data.time_seconds,
            });
          },
          c.env satisfies Pick<Env, "DB_BACKEND">,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes(MINI_GAME_ALREADY_COMPLETED_ERROR)) {
          return c.json({ error: "Game already completed" }, 409);
        }
        throw error;
      }

      deps.invalidateRankingCache();

      const rewardEvents = await deps.listRewardNotifications(
        c.env.fitloot_db,
        winnerUserId,
        {
          afterId: rewardNotificationCursor,
          pendingOnly: true,
          limit: 25,
        },
      );

      return c.json({
        success: true,
        winner: winnerUserId,
        xp_gained: winnerXp,
        points_gained: winnerPoints,
        leveledUp: rewardEvents.some((event) => event.type === "level_up"),
        reward_events: rewardEvents,
      });
    },
  );
}
