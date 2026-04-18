import { Hono, type MiddlewareHandler } from "hono";

import type { AppContext } from "../core/types";
import type { RankingRow } from "../services/trainingRanking";

type StreamJsonArrayResponse = (
  items: readonly unknown[],
  status?: number,
) => Response;

type RankingRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  loadTrainingRankingRows: (
    db: D1Database,
    whereClause?: string,
    bindings?: readonly unknown[],
  ) => Promise<RankingRow[]>;
  readRankingCache: () => RankingRow[] | null;
  streamJsonArrayResponse: StreamJsonArrayResponse;
  writeRankingCache: (rows: RankingRow[]) => void;
};

function sanitizeRankingRows(rows: readonly RankingRow[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const sanitized = { ...(row as Record<string, unknown>) };
    delete sanitized.user_id;
    return sanitized;
  });
}

export function registerRankingRoutes(
  app: Hono<AppContext>,
  {
    authMiddleware,
    loadTrainingRankingRows,
    readRankingCache,
    streamJsonArrayResponse,
    writeRankingCache,
  }: RankingRouteDeps,
): void {
  app.get("/api/ranking/global", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    let rankingRows = readRankingCache();
    if (!rankingRows) {
      rankingRows = (await loadTrainingRankingRows(c.env.fitloot_db)).slice(0, 100);
      writeRankingCache(rankingRows);
    }

    return streamJsonArrayResponse(sanitizeRankingRows(rankingRows));
  });

  app.get("/api/ranking/friends", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    c.header("Cache-Control", "no-store");

    const rankingRows = await loadTrainingRankingRows(
      c.env.fitloot_db,
      `up.user_id = ? OR up.user_id IN (
        SELECT COALESCE(friend_id, friend_user_id)
        FROM friendships
        WHERE user_id = ?
      )`,
      [user.id, user.id],
    );

    return streamJsonArrayResponse(rankingRows);
  });
}
