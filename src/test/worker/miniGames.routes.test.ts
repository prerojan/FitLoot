import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerMiniGameRoutes } from "../../worker/routes/miniGames";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import {
  createAuthMiddleware,
  createExecutionContext,
  createJsonRequest,
  createTestEnv,
  TEST_USER,
} from "./testUtils";

function createMiniGameDeps(
  overrides: Partial<Parameters<typeof registerMiniGameRoutes>[1]> = {},
) {
  return {
    applyXpPointsAndResolveLevels: vi.fn(async () => ({
      leveledUp: false,
      newLevel: 1,
      levelsGained: 0,
    })),
    authMiddleware: createAuthMiddleware(),
    ensureUserCounterRow: vi.fn(async () => undefined),
    getRewardNotificationCursor: vi.fn(async () => 12),
    invalidateRankingCache: vi.fn(() => undefined),
    listRewardNotifications: vi.fn(async () => [{ type: "level_up" }]),
    logUserEvent: vi.fn(async () => undefined),
    unlockAchievementIfNeeded: vi.fn(async () => undefined),
    withTransaction: vi.fn(async (_db: D1Database, action: () => Promise<unknown>) => await action()),
    ...overrides,
  } satisfies Parameters<typeof registerMiniGameRoutes>[1];
}

describe("mini-games routes", () => {
  it("completes the game inside a single transaction and only invalidates cache after commit", async () => {
    const order: string[] = [];
    const deps = createMiniGameDeps({
      applyXpPointsAndResolveLevels: vi.fn(async (_db, userId) => {
        order.push(`xp:${userId}`);
        return {
          leveledUp: false,
          newLevel: 1,
          levelsGained: 0,
        };
      }),
      ensureUserCounterRow: vi.fn(async (_db, userId) => {
        order.push(`ensure-counter:${userId}`);
      }),
      getRewardNotificationCursor: vi.fn(async () => {
        order.push("cursor");
        return 12;
      }),
      invalidateRankingCache: vi.fn(() => {
        order.push("invalidate-ranking-cache");
      }),
      listRewardNotifications: vi.fn(async () => {
        order.push("list-reward-notifications");
        return [{ type: "level_up" }];
      }),
      logUserEvent: vi.fn(async (_db, userId) => {
        order.push(`log:${userId}`);
      }),
      unlockAchievementIfNeeded: vi.fn(async (_db, userId, achievementName) => {
        order.push(`achievement:${userId}:${achievementName}`);
      }),
      withTransaction: vi.fn(async (_db: D1Database, action: () => Promise<unknown>) => {
        order.push("transaction:start");
        const result = await action();
        order.push("transaction:end");
        return result;
      }),
    });

    const { db } = createMockD1Database([
      {
        match: (sql) =>
          sql.includes("FROM mini_games") &&
          sql.includes("WHERE id = ? AND status = 'active'"),
        first: () => ({
          id: 7,
          challenger_user_id: TEST_USER.id,
          challenged_user_id: "friend-1",
          target_reps: 30,
          xp_reward: 150,
          points_reward: 30,
        }),
      },
      {
        match: (sql) =>
          sql.includes("UPDATE mini_games") &&
          sql.includes("SET status = 'completed'"),
        run: () => {
          order.push("game:complete");
          return { success: true, meta: { changes: 1 } };
        },
      },
      {
        match: (sql) => sql.includes("UPDATE user_event_counters"),
        run: (params) => {
          order.push(`counter:update:${String(params.at(-1))}`);
          return { success: true, meta: { changes: 1 } };
        },
      },
      {
        match: (sql) =>
          sql.includes("SELECT minigames_played, minigames_won, minigame_win_streak"),
        first: (params) => {
          order.push(`counter:read:${String(params[0])}`);
          if (params[0] === TEST_USER.id) {
            return {
              minigames_played: 1,
              minigames_won: 1,
              minigame_win_streak: 1,
            };
          }

          return {
            minigames_played: 1,
            minigames_won: 0,
            minigame_win_streak: 0,
          };
        },
      },
    ]);

    const env = createTestEnv(db);
    const app = new Hono<AppContext>();
    registerMiniGameRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/mini-games/7/complete", {
        method: "POST",
        body: {
          reps_completed: 30,
          time_seconds: 120,
        },
      }),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      winner: TEST_USER.id,
      leveledUp: true,
    });
    expect(deps.withTransaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "cursor",
      "transaction:start",
      "game:complete",
      `xp:${TEST_USER.id}`,
      "xp:friend-1",
      `ensure-counter:${TEST_USER.id}`,
      `counter:update:${TEST_USER.id}`,
      `counter:read:${TEST_USER.id}`,
      `achievement:${TEST_USER.id}:Jogador`,
      `ensure-counter:friend-1`,
      "counter:update:friend-1",
      "counter:read:friend-1",
      `achievement:friend-1:Jogador`,
      `log:${TEST_USER.id}`,
      "log:friend-1",
      "transaction:end",
      "invalidate-ranking-cache",
      "list-reward-notifications",
    ]);
  });

  it("does not invalidate ranking cache or fetch rewards when the transactional phase fails", async () => {
    const deps = createMiniGameDeps({
      applyXpPointsAndResolveLevels: vi.fn(async (_db, userId) => {
        if (userId === "friend-1") {
          throw new Error("xp write failed");
        }

        return {
          leveledUp: false,
          newLevel: 1,
          levelsGained: 0,
        };
      }),
    });

    const { db } = createMockD1Database([
      {
        match: (sql) =>
          sql.includes("FROM mini_games") &&
          sql.includes("WHERE id = ? AND status = 'active'"),
        first: () => ({
          id: 7,
          challenger_user_id: TEST_USER.id,
          challenged_user_id: "friend-1",
          target_reps: 30,
          xp_reward: 150,
          points_reward: 30,
        }),
      },
      {
        match: (sql) =>
          sql.includes("UPDATE mini_games") &&
          sql.includes("SET status = 'completed'"),
        run: () => ({ success: true, meta: { changes: 1 } }),
      },
    ]);

    const env = createTestEnv(db);
    const app = new Hono<AppContext>();
    registerMiniGameRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/mini-games/7/complete", {
        method: "POST",
        body: {
          reps_completed: 30,
          time_seconds: 120,
        },
      }),
      env,
      executionCtx,
    );

    expect(response.status).toBe(500);
    expect(deps.withTransaction).toHaveBeenCalledTimes(1);
    expect(deps.invalidateRankingCache).not.toHaveBeenCalled();
    expect(deps.listRewardNotifications).not.toHaveBeenCalled();
  });
});
