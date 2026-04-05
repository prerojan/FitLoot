import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  FoodScanRequestSchema,
  OfflineSyncRequestSchema,
  type OfflineSyncOperation,
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

type StoredOfflineOperationRow = {
  response_payload?: string | null;
};

function roundMetricDelta(value: number): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

function resolveMetricsDate(occurredAt: string, fallbackDate?: string | undefined): string {
  if (typeof fallbackDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)) {
    return fallbackDate;
  }

  const parsed = new Date(occurredAt);
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return assertString(safeGet(new Date().toISOString().split("T"), 0));
}

async function readStoredOfflineOperationResult(
  db: D1Database,
  userId: string,
  operationId: string,
): Promise<unknown | null> {
  const row = await db
    .prepare(
      `SELECT response_payload
       FROM offline_sync_operations
       WHERE user_id = ? AND operation_id = ?`,
    )
    .bind(userId, operationId)
    .first<StoredOfflineOperationRow>();

  if (!row?.response_payload) {
    return null;
  }

  try {
    return JSON.parse(row.response_payload);
  } catch {
    return null;
  }
}

async function persistOfflineOperationResult(
  db: D1Database,
  params: {
    userId: string;
    operationId: string;
    operationType: string;
    occurredAt: string;
    source: string;
    confidence?: string | undefined;
    requestPayload: unknown;
    responsePayload: unknown;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO offline_sync_operations (
         user_id,
         operation_id,
         operation_type,
         occurred_at,
         source,
         confidence,
         request_payload,
         response_payload,
         status,
         processed_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processed', datetime('now'), datetime('now'))
       ON CONFLICT(user_id, operation_id) DO UPDATE SET
         operation_type = excluded.operation_type,
         occurred_at = excluded.occurred_at,
         source = excluded.source,
         confidence = excluded.confidence,
         request_payload = excluded.request_payload,
         response_payload = excluded.response_payload,
         status = 'processed',
         processed_at = datetime('now'),
         updated_at = datetime('now')`,
    )
    .bind(
      params.userId,
      params.operationId,
      params.operationType,
      params.occurredAt,
      params.source,
      params.confidence ?? null,
      JSON.stringify(params.requestPayload),
      JSON.stringify(params.responsePayload),
    )
    .run();
}

async function applyMetricDeltaOperation(
  db: D1Database,
  params: {
    userId: string;
    field: "steps" | "calories_burned" | "distance_meters";
    delta: number;
    date: string;
  },
): Promise<{
  date: string;
  steps: number;
  calories_burned: number;
  distance_meters: number;
}> {
  const { userId, field, date } = params;
  const delta = roundMetricDelta(params.delta);
  const initialSteps = field === "steps" ? delta : 0;
  const initialCalories = field === "calories_burned" ? delta : 0;
  const initialDistance = field === "distance_meters" ? delta : 0;
  const nextValueSql = field === "steps"
    ? "steps = MAX(0, COALESCE(steps, 0) + excluded.steps)"
    : field === "calories_burned"
      ? "calories_burned = MAX(0, COALESCE(calories_burned, 0) + excluded.calories_burned)"
      : "distance_meters = MAX(0, COALESCE(distance_meters, 0) + excluded.distance_meters)";

  await db
    .prepare(
      `INSERT INTO daily_metrics (user_id, date, steps, calories_burned, distance_meters, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, date) DO UPDATE SET
         ${nextValueSql},
         updated_at = datetime('now')`,
    )
    .bind(userId, date, initialSteps, initialCalories, initialDistance)
    .run();

  const metrics = await db
    .prepare(
      `SELECT date, steps, calories_burned, distance_meters
       FROM daily_metrics
       WHERE user_id = ? AND date = ?`,
    )
    .bind(userId, date)
    .first<{
      date: string;
      steps: number;
      calories_burned: number;
      distance_meters: number;
    }>();

  return {
    date,
    steps: Number(metrics?.steps ?? 0),
    calories_burned: Number(metrics?.calories_burned ?? 0),
    distance_meters: Number(metrics?.distance_meters ?? 0),
  };
}

async function processOfflineSyncOperation(
  db: D1Database,
  userId: string,
  operation: OfflineSyncOperation,
): Promise<Record<string, unknown>> {
  const existingResult = await readStoredOfflineOperationResult(
    db,
    userId,
    operation.operation_id,
  );
  if (existingResult && typeof existingResult === "object") {
    return {
      ...existingResult as Record<string, unknown>,
      status: "duplicate",
    };
  }

  let resultPayload: Record<string, unknown>;
  if (operation.type === "step_delta_recorded") {
    const date = resolveMetricsDate(operation.occurred_at, operation.payload.date);
    const metrics = await applyMetricDeltaOperation(db, {
      userId,
      field: "steps",
      delta: operation.payload.delta,
      date,
    });
    resultPayload = {
      operation_id: operation.operation_id,
      type: operation.type,
      status: "processed",
      metrics,
    };
  } else if (operation.type === "calorie_delta_recorded") {
    const date = resolveMetricsDate(operation.occurred_at, operation.payload.date);
    const metrics = await applyMetricDeltaOperation(db, {
      userId,
      field: "calories_burned",
      delta: operation.payload.delta,
      date,
    });
    resultPayload = {
      operation_id: operation.operation_id,
      type: operation.type,
      status: "processed",
      metrics,
    };
  } else if (operation.type === "distance_delta_recorded") {
    const date = resolveMetricsDate(operation.occurred_at, operation.payload.date);
    const metrics = await applyMetricDeltaOperation(db, {
      userId,
      field: "distance_meters",
      delta: operation.payload.delta,
      date,
    });
    resultPayload = {
      operation_id: operation.operation_id,
      type: operation.type,
      status: "processed",
      metrics,
    };
  } else {
    resultPayload = {
      operation_id: operation.operation_id,
      type: operation.type,
      status: "processed",
      acknowledged: true,
      payload: operation.payload,
    };
  }

  await persistOfflineOperationResult(db, {
    userId,
    operationId: operation.operation_id,
    operationType: operation.type,
    occurredAt: operation.occurred_at,
    source: operation.source,
    confidence: operation.confidence,
    requestPayload: operation,
    responsePayload: resultPayload,
  });

  return resultPayload;
}

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
          distance_meters: 0,
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
            `INSERT INTO daily_metrics (user_id, date, steps, calories_burned, distance_meters, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(user_id, date) DO UPDATE SET
            steps = ?, calories_burned = ?, distance_meters = ?, updated_at = datetime('now')`,
          )
          .bind(
            user.id,
            today,
            data.steps,
            data.calories_burned,
            data.distance_meters,
            data.steps,
            data.calories_burned,
            data.distance_meters,
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
    "/api/offline/sync",
    authMiddleware,
    zValidator("json", OfflineSyncRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      try {
        const data = c.req.valid("json");
        const results: Record<string, unknown>[] = [];
        for (const operation of data.operations) {
          results.push(
            await processOfflineSyncOperation(
              c.env.fitloot_db,
              user.id,
              operation,
            ),
          );
        }

        return c.json({
          success: true,
          operations: results,
        });
      } catch (error) {
        console.error("[/api/offline/sync]", {
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
