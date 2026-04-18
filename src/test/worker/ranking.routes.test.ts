import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerRankingRoutes } from "../../worker/routes/ranking";
import type { AppContext } from "../../worker/core/types";
import type { RankingRow } from "../../worker/services/trainingRanking";
import {
  createAuthMiddleware,
  createExecutionContext,
  createTestEnv,
  TEST_USER,
} from "./testUtils";
import { createMockD1Database } from "./mockD1";

function createRankingRow(
  overrides: Partial<RankingRow> = {},
): RankingRow {
  return {
    user_id: TEST_USER.id,
    username: "tester",
    full_name: "Pessoa Teste",
    avatar_url: null,
    level: 8,
    xp: 340,
    current_streak: 5,
    points: 99,
    training_rank: "bronze_1",
    training_rank_score: 200,
    ...overrides,
  };
}

describe("ranking routes", () => {
  it("keeps the global ranking response sanitized and cached", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    let cachedRows: RankingRow[] | null = null;
    const loadTrainingRankingRows = vi.fn(async () => [
      createRankingRow(),
      createRankingRow({
        user_id: "friend-1",
        username: "ally",
        full_name: "Ally Prime",
        training_rank_score: 180,
      }),
    ]);

    const app = new Hono<AppContext>();
    registerRankingRoutes(app, {
      authMiddleware: createAuthMiddleware(),
      loadTrainingRankingRows,
      readRankingCache: () => cachedRows,
      streamJsonArrayResponse: (items: readonly unknown[], status = 200) =>
        new Response(JSON.stringify(items), {
          status,
          headers: { "content-type": "application/json" },
        }),
      writeRankingCache: (rows) => {
        cachedRows = rows;
      },
    });

    const { executionCtx } = createExecutionContext();

    const firstResponse = await app.fetch(
      new Request("http://localhost/api/ranking/global"),
      env,
      executionCtx,
    );
    const firstPayload = await firstResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(loadTrainingRankingRows).toHaveBeenCalledTimes(1);
    expect(firstPayload).toEqual([
      expect.not.objectContaining({ user_id: expect.anything() }),
      expect.not.objectContaining({ user_id: expect.anything() }),
    ]);

    const secondResponse = await app.fetch(
      new Request("http://localhost/api/ranking/global"),
      env,
      executionCtx,
    );

    expect(secondResponse.status).toBe(200);
    expect(loadTrainingRankingRows).toHaveBeenCalledTimes(1);
  });
});
