import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  FoodScanRequestSchema,
  UpdateDailyMetricsRequestSchema,
} from "../../shared/types";
import { assertString, safeGet } from "../../utils/typeHelpers";
import type { AppContext } from "../core/types";
import {
  getErrorMessage,
  internalErrorResponse,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";

type MetricsRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
};

// Route registration for daily metrics and food diary persistence.
export function registerMetricsRoutes(
  app: Hono<AppContext>,
  { authMiddleware }: MetricsRouteDeps,
): void {
  app.get("/api/metrics/today", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const today = assertString(safeGet(new Date().toISOString().split("T"), 0));
      const nowIso = new Date().toISOString();

      let metrics = await c.env.fitloot_db
        .prepare("SELECT * FROM daily_metrics WHERE user_id = ? AND date = ?")
        .bind(user.id, today)
        .first();

      if (!metrics) {
        // Keep GET read-only to avoid write amplification during bootstrap bursts.
        metrics = {
          id: 0,
          user_id: user.id,
          date: today,
          steps: 0,
          calories_burned: 0,
          created_at: nowIso,
          updated_at: nowIso,
        };
      }

      return c.json(
        metrics,
      );
    } catch (error) {
      console.error("[/api/metrics/today]", {
        message: getErrorMessage(error),
        userId: user.id,
      });

      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      return internalErrorResponse(c);
    }
  });

  app.post(
    "/api/metrics/update",
    authMiddleware,
    zValidator("json", UpdateDailyMetricsRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      try {
        const data = c.req.valid("json");
        const today = assertString(safeGet(new Date().toISOString().split("T"), 0));

        await c.env.fitloot_db
          .prepare(
            `INSERT INTO daily_metrics (user_id, date, steps, calories_burned, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, date) DO UPDATE SET
            steps = ?, calories_burned = ?, updated_at = datetime('now')`,
          )
          .bind(
            user.id,
            today,
            data.steps,
            data.calories_burned,
            data.steps,
            data.calories_burned,
          )
          .run();

        return c.json({ success: true });
      } catch (error) {
        console.error("[/api/metrics/update]", {
          message: getErrorMessage(error),
          userId: user.id,
        });

        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }

        return internalErrorResponse(c);
      }
    },
  );

  app.post(
    "/api/food/scan",
    authMiddleware,
    zValidator("json", FoodScanRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      try {
        const data = c.req.valid("json");

        await c.env.fitloot_db
          .prepare(
            `INSERT INTO food_diary (user_id, food_name, calories, meal_type, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
          )
          .bind(user.id, data.food_name, data.calories || 0, data.meal_type || "lanche")
          .run();

        return c.json({ success: true });
      } catch (error) {
        console.error("[/api/food/scan]", {
          message: getErrorMessage(error),
          userId: user.id,
        });

        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }

        return internalErrorResponse(c);
      }
    },
  );

  app.get("/api/food/today", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const today = assertString(safeGet(new Date().toISOString().split("T"), 0));
      const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 300);

      const foods = await c.env.fitloot_db
        .prepare(
          `SELECT * FROM food_diary 
          WHERE user_id = ? AND DATE(scanned_at) = ?
          ORDER BY scanned_at DESC
          LIMIT ?`,
        )
        .bind(user.id, today, limit)
        .all();

      return c.json(foods.results);
    } catch (error) {
      console.error("[/api/food/today]", {
        message: getErrorMessage(error),
        userId: user.id,
      });

      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      return internalErrorResponse(c);
    }
  });
}
