import { Hono, type MiddlewareHandler } from "hono";

import { repairKnownMojibakeString } from "../../shared/textEncoding";
import {
  getErrorMessage,
  internalErrorResponse,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import type { AppContext } from "../core/types";

type AchievementRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
};

// Route registration for achievements and titles.
export function registerAchievementRoutes(
  app: Hono<AppContext>,
  { authMiddleware }: AchievementRouteDeps,
): void {
  app.get("/api/achievements", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const achievements = await c.env.fitloot_db
      .prepare(
        `SELECT a.*, ua.unlocked_at, ua.progress_current, ua.progress_required,
        CASE WHEN ua.id IS NOT NULL THEN 1 ELSE 0 END as unlocked
        FROM achievements a
        LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?
        ORDER BY a.secret ASC, a.rarity, a.id`,
      )
      .bind(user.id)
      .all<Record<string, unknown>>();

    const mapped = achievements.results.map((achievement) => {
      const normalizedAchievement = {
        ...achievement,
        name:
          typeof achievement.name === "string"
            ? repairKnownMojibakeString(achievement.name)
            : achievement.name,
        description:
          typeof achievement.description === "string"
            ? repairKnownMojibakeString(achievement.description)
            : achievement.description,
        rarity:
          typeof achievement.rarity === "string"
            ? repairKnownMojibakeString(achievement.rarity)
            : achievement.rarity,
        reference:
          typeof achievement.reference === "string"
            ? repairKnownMojibakeString(achievement.reference)
            : achievement.reference,
      };
      const unlocked = Number(achievement.unlocked ?? 0) === 1;
      const isSecret = Number(achievement.secret ?? 0) === 1;
      if (isSecret && !unlocked) {
        return {
          ...normalizedAchievement,
          name: "?",
          description: "Conquista secreta",
          condition: null,
          icon: "",
        };
      }
      return normalizedAchievement;
    });

    return c.json(mapped);
  });

  app.get("/api/titles", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const titles = await c.env.fitloot_db
        .prepare(
          `SELECT t.*, ut.is_active, ut.unlocked_at,
          CASE WHEN ut.id IS NOT NULL THEN 1 ELSE 0 END as unlocked
          FROM titles t
          LEFT JOIN user_titles ut ON t.id = ut.title_id AND ut.user_id = ?
          ORDER BY t.rarity, t.id`,
        )
        .bind(user.id)
        .all();

      return c.json(Array.isArray(titles.results) ? titles.results : []);
    } catch (error) {
      console.error("[/api/titles]", {
        message: getErrorMessage(error),
        userId: user.id,
      });

      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      return internalErrorResponse(c);
    }
  });

  app.post("/api/titles/:id/activate", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const titleId = parseInt(c.req.param("id"));

    await c.env.fitloot_db
      .prepare("UPDATE user_titles SET is_active = 0, is_equipped = 0 WHERE user_id = ?")
      .bind(user.id)
      .run();

    await c.env.fitloot_db
      .prepare(
        "UPDATE user_titles SET is_active = 1, is_equipped = 1, updated_at = datetime('now') WHERE user_id = ? AND title_id = ?",
      )
      .bind(user.id, titleId)
      .run();

    return c.json({ success: true });
  });
}
