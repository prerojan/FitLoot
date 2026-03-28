import { Hono, type MiddlewareHandler } from "hono";

import {
  getErrorMessage,
  internalErrorResponse,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import type {
  AppContext,
  PhysicalBenchmarkDelta,
  PhysicalBenchmarkRow,
  PhysicalBenchmarkWithDelta,
} from "../core/types";

type ParseProgressionXpLevel = (
  row: { xp?: unknown; level?: unknown } | null | undefined,
) => { xp: number; level: number };

type ComputeXpAndLevelAfterGain = (
  xp: number,
  level: number,
  xpDelta: number,
) => { xp: number; level: number; levelsGained: number };

type ApplyXpPointsAndResolveLevels = (
  db: D1Database,
  userId: string,
  xpDelta: number,
  pointsDelta: number,
) => Promise<{ leveledUp: boolean; newLevel: number; levelsGained: number }>;

type ProgressionRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  applyXpPointsAndResolveLevels: ApplyXpPointsAndResolveLevels;
  computeXpAndLevelAfterGain: ComputeXpAndLevelAfterGain;
  parseProgressionXpLevel: ParseProgressionXpLevel;
  unlockAchievementIfNeeded: (
    db: D1Database,
    userId: string,
    achievementName: string,
    progressCurrent?: number,
    progressRequired?: number,
  ) => Promise<void>;
  unlockTitleIfNeeded: (
    db: D1Database,
    userId: string,
    titleName: string,
  ) => Promise<void>;
};

// Route registration for progression, attributes, benchmarks, and skill stages.
export function registerProgressionRoutes(
  app: Hono<AppContext>,
  {
    authMiddleware,
    applyXpPointsAndResolveLevels,
    computeXpAndLevelAfterGain,
    parseProgressionXpLevel,
    unlockAchievementIfNeeded,
    unlockTitleIfNeeded,
  }: ProgressionRouteDeps,
): void {
  app.get("/api/progression", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      let progression = await c.env.fitloot_db
        .prepare("SELECT * FROM user_progression WHERE user_id = ?")
        .bind(user.id)
        .first<Record<string, unknown>>();

      if (!progression) {
        await c.env.fitloot_db
          .prepare(
            `INSERT INTO user_progression (user_id, xp, level, points, current_streak, best_streak, updated_at)
            VALUES (?, 0, 1, 0, 0, 0, datetime('now'))`,
          )
          .bind(user.id)
          .run();

        progression = await c.env.fitloot_db
          .prepare("SELECT * FROM user_progression WHERE user_id = ?")
          .bind(user.id)
          .first<Record<string, unknown>>();
      }

      if (!progression) {
        return c.json(
          { error: "Progress?o n?o encontrada", code: "PROGRESSION_NOT_FOUND" },
          404,
        );
      }

      const beforeReconcile = parseProgressionXpLevel(progression);
      const overflowPreview = computeXpAndLevelAfterGain(
        beforeReconcile.xp,
        beforeReconcile.level,
        0,
      );
      let celebrateLevel: number | undefined;
      if (overflowPreview.levelsGained > 0) {
        const applied = await applyXpPointsAndResolveLevels(
          c.env.fitloot_db,
          user.id,
          0,
          0,
        );
        celebrateLevel = applied.newLevel;
        const refreshed = await c.env.fitloot_db
          .prepare("SELECT * FROM user_progression WHERE user_id = ?")
          .bind(user.id)
          .first<Record<string, unknown>>();
        if (refreshed) {
          progression = refreshed;
        }
      }

      return c.json({
        ...progression,
        ...(typeof celebrateLevel === "number" && celebrateLevel > 0
          ? { celebrate_level: celebrateLevel }
          : {}),
      });
    } catch (error) {
      console.error("[/api/progression]", {
        message: getErrorMessage(error),
        userId: user.id,
      });

      if (isMissingSchemaError(error)) {
        return schemaMismatchResponse(c);
      }

      return internalErrorResponse(c);
    }
  });

  app.get("/api/attributes", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const attributes = await c.env.fitloot_db
      .prepare("SELECT * FROM user_attributes WHERE user_id = ?")
      .bind(user.id)
      .first();

    return c.json(attributes);
  });

  app.post("/api/progress/snapshot", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const [progression, attributes, missionsCompleted] = await Promise.all([
        c.env.fitloot_db
          .prepare("SELECT * FROM user_progression WHERE user_id = ?")
          .bind(user.id)
          .first(),
        c.env.fitloot_db
          .prepare("SELECT * FROM user_attributes WHERE user_id = ?")
          .bind(user.id)
          .first(),
        c.env.fitloot_db
          .prepare(
            "SELECT COUNT(*) as count FROM missions WHERE user_id = ? AND is_completed = 1",
          )
          .bind(user.id)
          .first<{ count: number }>(),
      ]);

      if (!progression || !attributes) {
        return c.json({ error: "Dados do usuÃ¡rio nÃ£o encontrados" }, 404);
      }

      const result = await c.env.fitloot_db
        .prepare(`
          INSERT OR IGNORE INTO progress_snapshots 
          (user_id, level, xp, strength, constitution, vitality, dexterity, focus, missions_completed, streak)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          user.id,
          progression.level,
          progression.xp,
          attributes.strength,
          attributes.constitution,
          attributes.vitality,
          attributes.dexterity,
          attributes.focus,
          missionsCompleted?.count || 0,
          progression.current_streak,
        )
        .run();

      if (result.meta.changes === 0) {
        const existingSnapshot = await c.env.fitloot_db
          .prepare(
            "SELECT * FROM progress_snapshots WHERE user_id = ? AND snapshot_date = date('now')",
          )
          .bind(user.id)
          .first();

        return c.json({ snapshot: existingSnapshot, status: "existing" });
      }

      const newSnapshot = await c.env.fitloot_db
        .prepare("SELECT * FROM progress_snapshots WHERE id = ?")
        .bind(result.meta.last_row_id)
        .first();

      return c.json({ snapshot: newSnapshot, status: "created" });
    } catch (error) {
      console.error("[/api/progress/snapshot]", error);
      return internalErrorResponse(c);
    }
  });

  app.get("/api/progress/snapshots", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const snapshots = await c.env.fitloot_db
        .prepare(`
          SELECT * FROM progress_snapshots 
          WHERE user_id = ? 
          ORDER BY snapshot_date DESC 
          LIMIT 30
        `)
        .bind(user.id)
        .all();

      return c.json({ snapshots: snapshots.results });
    } catch (error) {
      console.error("[/api/progress/snapshots]", error);
      return internalErrorResponse(c);
    }
  });

  app.post("/api/benchmarks", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const body = await c.req.json();
      const {
        pushups_max,
        squats_max,
        situps_max,
        plank_seconds,
        pullups_max,
        run_distance_km,
        run_time_seconds,
        notes,
      } = body;

      const previousBenchmark = await c.env.fitloot_db
        .prepare(`
          SELECT * FROM physical_benchmarks 
          WHERE user_id = ? 
          ORDER BY test_date DESC 
          LIMIT 1
        `)
        .bind(user.id)
        .first<PhysicalBenchmarkRow>();

      const result = await c.env.fitloot_db
        .prepare(`
          INSERT INTO physical_benchmarks 
          (user_id, pushups_max, squats_max, situps_max, plank_seconds, pullups_max, run_distance_km, run_time_seconds, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          user.id,
          pushups_max || null,
          squats_max || null,
          situps_max || null,
          plank_seconds || null,
          pullups_max || null,
          run_distance_km || null,
          run_time_seconds || null,
          notes || null,
        )
        .run();

      const delta: PhysicalBenchmarkDelta = previousBenchmark
        ? {
            pushups_delta: (pushups_max || 0) - (previousBenchmark.pushups_max || 0),
            squats_delta: (squats_max || 0) - (previousBenchmark.squats_max || 0),
            situps_delta: (situps_max || 0) - (previousBenchmark.situps_max || 0),
            plank_delta:
              (plank_seconds || 0) - (previousBenchmark.plank_seconds || 0),
            pullups_delta: (pullups_max || 0) - (previousBenchmark.pullups_max || 0),
            run_distance_delta:
              (run_distance_km || 0) - (previousBenchmark.run_distance_km || 0),
            run_time_delta:
              (run_time_seconds || 0) -
              (previousBenchmark.run_time_seconds || 0),
          }
        : {
            pushups_delta: pushups_max || 0,
            squats_delta: squats_max || 0,
            situps_delta: situps_max || 0,
            plank_delta: plank_seconds || 0,
            pullups_delta: pullups_max || 0,
            run_distance_delta: run_distance_km || 0,
            run_time_delta: run_time_seconds || 0,
          };

      const attributeUpdates = [];
      const attributeValues = [];

      if (pushups_max && pushups_max > 0) {
        attributeUpdates.push("strength = strength + ?");
        attributeValues.push(Math.floor(pushups_max / 5));
      }

      if (squats_max && squats_max > 0) {
        attributeUpdates.push("vitality = vitality + ?");
        attributeValues.push(Math.floor(squats_max / 5));
      }

      if (situps_max && situps_max > 0) {
        attributeUpdates.push("focus = focus + ?");
        attributeValues.push(Math.floor(situps_max / 5));
      }

      if (plank_seconds && plank_seconds > 0) {
        attributeUpdates.push("dexterity = dexterity + ?");
        attributeValues.push(Math.floor(plank_seconds / 30));
      }

      if (pullups_max && pullups_max > 0) {
        attributeUpdates.push("strength = strength + ?");
        attributeValues.push(pullups_max * 2);
      }

      if (run_distance_km && run_distance_km > 0) {
        attributeUpdates.push("constitution = constitution + ?");
        attributeValues.push(Math.floor(run_distance_km * 2));
      }

      if (attributeUpdates.length > 0) {
        const updateQuery = `UPDATE user_attributes SET ${attributeUpdates.join(
          ", ",
        )}, updated_at = datetime('now') WHERE user_id = ?`;
        await c.env.fitloot_db.prepare(updateQuery).bind(...attributeValues, user.id).run();
      }

      const newBenchmark = await c.env.fitloot_db
        .prepare("SELECT * FROM physical_benchmarks WHERE id = ?")
        .bind(result.meta.last_row_id)
        .first<PhysicalBenchmarkRow>();

      return c.json({
        benchmark: newBenchmark,
        delta,
        attributes_updated: attributeUpdates.length > 0,
      });
    } catch (error) {
      console.error("[/api/benchmarks]", error);
      return internalErrorResponse(c);
    }
  });

  app.get("/api/benchmarks", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    try {
      const benchmarks = await c.env.fitloot_db
        .prepare(`
          SELECT * FROM physical_benchmarks 
          WHERE user_id = ? 
          ORDER BY test_date DESC
        `)
        .bind(user.id)
        .all<PhysicalBenchmarkRow>();

      const results = benchmarks.results.map<PhysicalBenchmarkWithDelta>(
        (benchmark, index) => {
          if (index === 0) {
            return { ...benchmark, delta: null };
          }

          const previous = benchmarks.results[index - 1];
          const delta: PhysicalBenchmarkDelta = {
            pushups_delta: (benchmark.pushups_max || 0) - (previous.pushups_max || 0),
            squats_delta: (benchmark.squats_max || 0) - (previous.squats_max || 0),
            situps_delta: (benchmark.situps_max || 0) - (previous.situps_max || 0),
            plank_delta:
              (benchmark.plank_seconds || 0) - (previous.plank_seconds || 0),
            pullups_delta: (benchmark.pullups_max || 0) - (previous.pullups_max || 0),
            run_distance_delta:
              (benchmark.run_distance_km || 0) -
              (previous.run_distance_km || 0),
            run_time_delta:
              (benchmark.run_time_seconds || 0) -
              (previous.run_time_seconds || 0),
          };

          return { ...benchmark, delta };
        },
      );

      return c.json({ benchmarks: results });
    } catch (error) {
      console.error("[/api/benchmarks]", error);
      return internalErrorResponse(c);
    }
  });

  app.get("/api/skills", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const userSkills = await c.env.fitloot_db
      .prepare(
        `SELECT s.*, us.total_reps, us.total_time, us.best_reps, us.unlocked_at, us.status, us.current_stage,
          (SELECT COUNT(*) FROM skill_stages ss WHERE ss.skill_id = s.id) as total_stages
        FROM skills s
        INNER JOIN user_skills us ON s.id = us.skill_id
        WHERE us.user_id = ?
        ORDER BY COALESCE(s.level_required, s.required_level), s.id`,
      )
      .bind(user.id)
      .all();

    return c.json(userSkills.results);
  });

  app.get("/api/skills/available", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const progression = await c.env.fitloot_db
      .prepare("SELECT level FROM user_progression WHERE user_id = ?")
      .bind(user.id)
      .first();

    const availableSkills = await c.env.fitloot_db
      .prepare(
        `SELECT s.* FROM skills s
        WHERE COALESCE(s.level_required, s.required_level) <= ?
        AND s.id NOT IN (SELECT skill_id FROM user_skills WHERE user_id = ?)
        ORDER BY COALESCE(s.level_required, s.required_level), s.id`,
      )
      .bind(progression?.level || 1, user.id)
      .all();

    return c.json(availableSkills.results);
  });

  app.post("/api/skills/:id/stage/complete", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const skillId = Number(c.req.param("id"));
    if (!Number.isFinite(skillId)) return c.json({ error: "Invalid skill" }, 400);

    const [progression, skillProgress] = await Promise.all([
      c.env.fitloot_db
        .prepare("SELECT level FROM user_progression WHERE user_id = ?")
        .bind(user.id)
        .first<{ level: number }>(),
      c.env.fitloot_db
        .prepare(
          "SELECT current_stage FROM user_skills WHERE user_id = ? AND skill_id = ?",
        )
        .bind(user.id, skillId)
        .first<{ current_stage: number }>(),
    ]);

    if (!skillProgress) return c.json({ error: "Skill not unlocked" }, 404);

    const nextStage = Number(skillProgress.current_stage ?? 0) + 1;
    const stageData = await c.env.fitloot_db
      .prepare("SELECT * FROM skill_stages WHERE skill_id = ? AND stage_number = ?")
      .bind(skillId, nextStage)
      .first<{ level_required: number; stage_number: number }>();

    if (!stageData) return c.json({ error: "No next stage" }, 400);
    if (Number(progression?.level ?? 1) < Number(stageData.level_required ?? 1)) {
      return c.json({ error: "NÃ­vel insuficiente para esta etapa" }, 400);
    }

    await c.env.fitloot_db
      .prepare(
        "UPDATE user_skills SET current_stage = ?, status = 'in_progress', updated_at = datetime('now') WHERE user_id = ? AND skill_id = ?",
      )
      .bind(nextStage, user.id, skillId)
      .run();

    if (nextStage >= 6) {
      await c.env.fitloot_db
        .prepare(
          "UPDATE user_skills SET status = 'unlocked', updated_at = datetime('now') WHERE user_id = ? AND skill_id = ?",
        )
        .bind(user.id, skillId)
        .run();

      const skill = await c.env.fitloot_db
        .prepare("SELECT name FROM skills WHERE id = ?")
        .bind(skillId)
        .first<{ name: string }>();
      const titleBySkill: Record<string, string> = {
        Handstand: "O Equilibrista",
        "Muscle Up": "Acima de Todos",
        Planche: "ForÃ§a Gravitacional",
        "Human Flag": "Bandeira Humana",
        "Front Lever": "Suspenso no Tempo",
      };
      const title = titleBySkill[skill?.name ?? ""];
      if (title) await unlockTitleIfNeeded(c.env.fitloot_db, user.id, title);

      if (skill?.name === "Handstand") {
        await unlockAchievementIfNeeded(
          c.env.fitloot_db,
          user.id,
          "Mestre do EquilÃ­brio",
          6,
          6,
        );
      }
    }

    return c.json({ success: true, current_stage: nextStage });
  });
}
