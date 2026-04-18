import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerProgressionRoutes } from "../../worker/routes/progression";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import {
  createAuthMiddleware,
  createExecutionContext,
  createTestEnv,
  TEST_USER,
} from "./testUtils";

function createProgressionDeps() {
  return {
    authMiddleware: createAuthMiddleware(),
    applyXpPointsAndResolveLevels: vi.fn(async () => ({
      leveledUp: false,
      newLevel: 1,
      levelsGained: 0,
    })),
    computeXpAndLevelAfterGain: vi.fn(() => ({
      xp: 0,
      level: 1,
      levelsGained: 0,
    })),
    invalidateRankingCache: vi.fn(() => undefined),
    onRankingUpdate: vi.fn(async () => undefined),
    parseProgressionXpLevel: vi.fn(() => ({
      xp: 0,
      level: 1,
    })),
    syncTrainingRankState: vi.fn(async () => undefined),
    unlockAchievementIfNeeded: vi.fn(async () => undefined),
    unlockTitleIfNeeded: vi.fn(async () => undefined),
    listRewardNotifications: vi.fn(async () => []),
    consumeRewardNotifications: vi.fn(async () => undefined),
  };
}

describe("progression routes", () => {
  it("retries transient attribute reads before failing the profile surface", async () => {
    let attributeReads = 0;
    const { db } = createMockD1Database([
      {
        match: "SELECT * FROM user_attributes WHERE user_id = ?",
        first: () => {
          attributeReads += 1;
          if (attributeReads === 1) {
            throw new Error("query read timeout");
          }
          return {
            user_id: TEST_USER.id,
            strength: 7,
            constitution: 4,
            vitality: 5,
            dexterity: 3,
            focus: 6,
          };
        },
      },
    ]);

    const env = createTestEnv(db);
    const deps = createProgressionDeps();
    const app = new Hono<AppContext>();
    registerProgressionRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/attributes"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user_id: TEST_USER.id,
      strength: 7,
    });
    expect(attributeReads).toBe(2);
  });

  it("retries transient skill reads and still returns the unlocked skills list", async () => {
    let skillReads = 0;
    const { db } = createMockD1Database([
      {
        match: (sql) =>
          sql.includes("FROM skills s") &&
          sql.includes("INNER JOIN user_skills us") &&
          sql.includes("WHERE us.user_id = ?"),
        all: () => {
          skillReads += 1;
          if (skillReads === 1) {
            throw new Error("socket hang up");
          }
          return {
            results: [
              {
                id: 1,
                name: "Handstand",
                total_reps: 120,
                best_reps: 12,
              },
            ],
          };
        },
      },
    ]);

    const env = createTestEnv(db);
    const deps = createProgressionDeps();
    const app = new Hono<AppContext>();
    registerProgressionRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/skills"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: 1,
        name: "Handstand",
      }),
    ]);
    expect(skillReads).toBe(2);
  });
});
