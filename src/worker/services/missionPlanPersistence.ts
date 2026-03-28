import type { MissionMetricType } from "../../shared/types";
import type { Env } from "../core/types";

type MissionPeriod = "daily" | "weekly" | "monthly";

type MissionPayloadLike = {
  type?: MissionPeriod | undefined;
  title: string;
  description?: string | null | undefined;
  goal?: string | null | undefined;
  metric_type: MissionMetricType;
  metric_value?: number | null | undefined;
  target_reps?: number | null | undefined;
  target_time?: number | null | undefined;
  xp_reward?: number | null | undefined;
  points_reward?: number | null | undefined;
  difficulty_level?: string | null | undefined;
  exercise_name?: string | null | undefined;
  exercise_target?: string | null | undefined;
  muscle_groups?: string[] | null | undefined;
  exercise_secondary_muscles?: string[] | null | undefined;
};

type MissionPlanProfileLike = {
  userId: string;
  mainGoal: string;
  conditioning: string;
  injuries: string;
  equipment: string;
  trainingFrequency: number;
  weekKey: string;
  profileHash: string;
  volumeMultiplier: number;
  weeklyPlan: Record<string, unknown>;
  chatPlanPreferences: unknown;
};

type ResolvedMissionSubtaskLike = {
  title: string;
  compatibilityKey: string;
  compatibilityTerms: string[];
  requiredCount: number;
};

type MissionBlueprintLike = {
  period: MissionPeriod;
  name: string;
  description: string;
  goal: string | null;
  exerciseName: string;
  muscle: string;
  metricType: MissionMetricType;
  metricValue: number;
  xpReward: number;
  pointsReward: number;
  difficultyLevel: string;
  missionOrigin: "regular" | "ai";
  isAiSpecial: boolean;
  compatibilityKey: string;
  compatibilityTerms: string[];
  subtasks: ResolvedMissionSubtaskLike[];
};

type StructuredPeriodicMissionDraftLike = {
  name: string;
  description: string;
  goal?: string | undefined;
  xp_reward?: number | null | undefined;
  fitcoins_reward?: number | null | undefined;
  subtasks?: string[] | undefined;
};

type MissionConfigLike = {
  xp: number;
  points: number;
  titlePrefix: string;
};

type MissionPlanPersistenceDeps = {
  buildMissionCompatibilityTerms: (
    missionName: string,
    muscle: string,
    metricType: MissionMetricType,
  ) => string[];
  buildMonthlyCounterMissionBlueprints: (
    profile: MissionPlanProfileLike,
    targetCount: number,
    options: { missionOrigin: "regular"; isAiSpecial: boolean },
  ) => MissionBlueprintLike[];
  createMissionSubtasks: (
    db: D1Database,
    parentMissionId: number,
    subtasks: readonly ResolvedMissionSubtaskLike[],
  ) => Promise<void>;
  extractExerciseName: (title: string) => string;
  futureIsoForPeriod: (period: MissionPeriod) => string;
  getMonthlyCounters: (
    db: D1Database,
    userId: string,
  ) => Promise<unknown>;
  hasTableColumn: (
    db: D1Database,
    tableName: string,
    columnName: string,
  ) => Promise<boolean>;
  invalidateMissionListCache: (userId: string) => void;
  insertMission: (
    db: D1Database,
    userId: string,
    period: MissionPeriod,
    deadline: string,
    mission: MissionPayloadLike,
    skillId: number | null,
  ) => Promise<number | null>;
  listCurrentCycleMissions: (
    db: D1Database,
    userId: string,
    scope: "regular" | "ai_special",
  ) => Promise<MissionPayloadLike[]>;
  loadMissionGenerationProfile: (
    db: D1Database,
    userId: string,
  ) => Promise<MissionPlanProfileLike | null>;
  loadMissionSubtasksByParentIds: (
    db: D1Database,
    parentIds: readonly number[],
  ) => Promise<Map<number, unknown[]>>;
  mapWithConcurrency: <TItem, TResult>(
    items: readonly TItem[],
    concurrency: number,
    mapper: (item: TItem, index: number) => Promise<TResult>,
  ) => Promise<TResult[]>;
  materializeMissionBlueprint: (
    env: Env,
    profile: MissionPlanProfileLike,
    blueprint: MissionBlueprintLike,
  ) => Promise<MissionPayloadLike>;
  materializationConcurrency: number;
  mergeUniqueStrings: (
    values: string[],
    maxLength: number,
  ) => string[];
  metricUnitByType: (metricType: MissionMetricType) => string;
  missionConfigByPeriod: (period: MissionPeriod) => MissionConfigLike;
  missionCycleStartIso: (
    period: MissionPeriod,
    reference?: Date,
  ) => string;
  monthlyMissionProgressValue: (
    mission: Record<string, unknown>,
    monthlyCounters: unknown,
  ) => number;
  normalizeDifficultyLabel: (
    value: unknown,
    fallback: string,
  ) => string;
  normalizeMatchText: (value: string) => string;
  normalizeMissionMetricType: (
    rawType: unknown,
    rawTargetTime: unknown,
  ) => MissionMetricType;
  replaceMissionSubtasks: (
    db: D1Database,
    parentMissionId: number,
    subtasks: readonly ResolvedMissionSubtaskLike[],
  ) => Promise<void>;
  resolvePeriodicMissionBlueprints: (params: {
    period: "weekly" | "monthly";
    targetCount: number;
    drafts: readonly StructuredPeriodicMissionDraftLike[];
    fallbackDrafts: readonly StructuredPeriodicMissionDraftLike[];
    dailyBlueprints: readonly MissionBlueprintLike[];
    profile: MissionPlanProfileLike;
    missionOrigin: "regular" | "ai";
    isAiSpecial: boolean;
  }) => {
    blueprints: MissionBlueprintLike[];
    invalidCount: number;
    totalCount: number;
  };
  resolveSkillIdForExerciseMission: (
    db: D1Database,
    userId: string,
    exerciseName: string | null | undefined,
  ) => Promise<number | null>;
  serializeTrainingPlanChatPreferences: (
    preferences: unknown,
  ) => unknown;
  stripMissionDisplayTitlePrefix: (title: string) => string;
  upsertTrainingPlan: (
    db: D1Database,
    userId: string,
    plan: Record<string, unknown>,
    mainGoal: string,
    conditioning: string,
    equipment: string,
    injuries: string,
    trainingFrequency: number,
  ) => Promise<void>;
  withTransaction: <T>(
    db: D1Database,
    run: () => Promise<T>,
  ) => Promise<T>;
};

type MaterializedMissionEntry = {
  blueprint: MissionBlueprintLike;
  mission: MissionPayloadLike;
};

function buildPeriodicFallbackDraftsFromDailyBlueprints(
  profile: MissionPlanProfileLike,
  dailyBlueprints: readonly MissionBlueprintLike[],
  targets: { weekly: number; monthly: number },
): { weekly: StructuredPeriodicMissionDraftLike[]; monthly: StructuredPeriodicMissionDraftLike[] } {
  const monthlyRepeatCount = Math.max(2, Math.min(4, profile.trainingFrequency));
  const weeklyCircuitNames = [
    "Full Body Calisthenics Circuit",
    "Core and Conditioning Circuit",
    "Lower Body and Mobility Circuit",
    "Upper Body Strength Circuit",
  ];
  const weekly = weeklyCircuitNames
    .slice(0, targets.weekly)
    .map((missionName, index) => ({
      name: missionName,
      description: `O progresso desta missao semanal e atualizado automaticamente ao concluir as missoes diarias compativeis do circuito ${missionName}.`,
      goal: `Conclua as missoes diarias compativeis do circuito ${missionName} nesta semana.`,
      xp_reward: Math.max(1, 260 + index * 15),
      fitcoins_reward: Math.max(1, 55 + index * 3),
      subtasks: [],
    }));
  const monthly = Array.from({ length: targets.monthly }, (_, index) => {
    const dailyBlueprint = dailyBlueprints[index % Math.max(1, dailyBlueprints.length)];
    const dailyMissionName = dailyBlueprint?.name ?? "Missao diaria";
    return {
      name: `Meta Mensal: ${dailyMissionName}`,
      description: `Evolua esta missao mensal com repeticoes da missao diaria ${dailyMissionName} ao longo do mes.`,
      goal: `Conclua as missoes diarias compativeis de ${dailyMissionName} ao longo deste mes.`,
      xp_reward: Math.max(1, 620 + index * 25),
      fitcoins_reward: Math.max(1, 140 + index * 8),
      subtasks: Array.from({ length: monthlyRepeatCount }, () => dailyMissionName),
    } satisfies StructuredPeriodicMissionDraftLike;
  });

  return { weekly, monthly };
}

function isCurrentMonthlyCounterMissionRow(
  deps: MissionPlanPersistenceDeps,
  row: Record<string, unknown>,
): boolean {
  const title = deps.normalizeMatchText(typeof row.title === "string" ? row.title : "");
  const goal = deps.normalizeMatchText(typeof row.goal === "string" ? row.goal : "");
  const metricType = deps.normalizeMissionMetricType(row.metric_type, row.target_time);
  const metricValue = Math.max(0, Number(row.metric_value ?? row.target_reps ?? row.target_time ?? 0));

  if (title.includes("consistencia mensal")) {
    return goal.includes("missoes concluidas") && metricValue >= 20 && metricValue <= 50;
  }
  if (title.includes("passos do mes")) {
    return goal.includes("passos acumulados") && metricType === "steps" && metricValue >= 80_000 && metricValue <= 180_000;
  }
  if (title.includes("distancia mensal")) {
    if (metricType === "distance_meters") {
      return goal.includes("km acumulados") && metricValue >= 18_000 && metricValue <= 60_000;
    }
    return goal.includes("passos acumulados") && metricType === "steps" && metricValue >= 80_000 && metricValue <= 180_000;
  }
  if (title.includes("dias ativos") || title.includes("streak mensal") || title.includes("pratica ativa")) {
    return goal.includes("dias ativos") && metricValue >= 12 && metricValue <= 24;
  }
  if (title.includes("circuitos semanais")) {
    return goal.includes("circuitos semanais") && metricValue >= 2 && metricValue <= 4;
  }
  if (title.includes("volume mensal") || title.includes("ritmo mensal")) {
    return goal.includes("missoes concluidas") && metricValue >= 20 && metricValue <= 50;
  }
  if (title.includes("desafio cardio")) {
    if (metricType === "distance_meters") {
      return goal.includes("km acumulados") && metricValue >= 20_000 && metricValue <= 70_000;
    }
    return goal.includes("passos acumulados") && metricType === "steps" && metricValue >= 100_000 && metricValue <= 200_000;
  }

  return false;
}

export function createMissionPlanPersistenceService(
  deps: MissionPlanPersistenceDeps,
) {
  function buildDailyBlueprintFromMissionPayload(
    mission: MissionPayloadLike,
    profile: MissionPlanProfileLike,
  ): MissionBlueprintLike | null {
    if (mission.type !== "daily") return null;
    const exerciseName = typeof mission.exercise_name === "string" && mission.exercise_name.trim().length > 0
      ? mission.exercise_name.trim()
      : deps.extractExerciseName(mission.title);
    const muscle = mission.exercise_target
      ?? mission.muscle_groups?.[0]
      ?? "full body";

    const missionName = exerciseName.trim().length > 0
      ? exerciseName
      : deps.extractExerciseName(mission.title);

    return {
      period: "daily",
      name: missionName,
      description: mission.description ?? `Complete a meta proposta em ${missionName}.`,
      goal: null,
      exerciseName: missionName,
      muscle,
      metricType: mission.metric_type,
      metricValue: Math.max(1, Number(mission.metric_value ?? mission.target_reps ?? mission.target_time ?? 1)),
      xpReward: Math.max(1, Number(mission.xp_reward ?? deps.missionConfigByPeriod("daily").xp)),
      pointsReward: Math.max(1, Number(mission.points_reward ?? deps.missionConfigByPeriod("daily").points)),
      difficultyLevel: deps.normalizeDifficultyLabel(mission.difficulty_level, profile.conditioning),
      missionOrigin: "regular",
      isAiSpecial: false,
      compatibilityKey: deps.normalizeMatchText(deps.extractExerciseName(mission.title)),
      compatibilityTerms: deps.mergeUniqueStrings(
        [
          ...deps.buildMissionCompatibilityTerms(missionName, muscle, mission.metric_type),
          mission.title,
          ...(Array.isArray(mission.muscle_groups) ? mission.muscle_groups : []),
          ...(Array.isArray(mission.exercise_secondary_muscles) ? mission.exercise_secondary_muscles : []),
        ],
        12,
      ),
      subtasks: [],
    };
  }

  async function materializeMissionBlueprints(
    env: Env,
    profile: MissionPlanProfileLike,
    blueprints: readonly MissionBlueprintLike[],
  ): Promise<MaterializedMissionEntry[]> {
    return deps.mapWithConcurrency(
      blueprints,
      deps.materializationConcurrency,
      async (blueprint) => ({
        blueprint,
        mission: await deps.materializeMissionBlueprint(env, profile, blueprint),
      }),
    );
  }

  async function deleteMissionEntries(
    db: D1Database,
    missionIds: readonly number[],
  ): Promise<void> {
    if (missionIds.length === 0) return;
    const placeholders = missionIds.map(() => "?").join(", ");
    await db.prepare(
      `DELETE FROM mission_subtasks
        WHERE parent_mission_id IN (${placeholders})`
    ).bind(...missionIds).run();
    await db.prepare(
      `DELETE FROM missions
        WHERE id IN (${placeholders})`
    ).bind(...missionIds).run();
  }

  async function persistMaterializedMissionEntries(
    db: D1Database,
    profile: MissionPlanProfileLike,
    materialized: readonly MaterializedMissionEntry[],
    options?: { replaceMissionIds?: readonly number[] | undefined },
  ): Promise<void> {
    const replaceMissionIds = options?.replaceMissionIds ?? [];

    await deps.withTransaction(db, async () => {
      if (!materialized.some((entry) => entry.blueprint.isAiSpecial)) {
        await deps.upsertTrainingPlan(
          db,
          profile.userId,
          {
            week_key: profile.weekKey,
            profile_hash: profile.profileHash,
            volume_multiplier: profile.volumeMultiplier,
            progression_expected: "Progressao semanal ajustada em no maximo 10% conforme taxa de conclusao.",
            weekly: profile.weeklyPlan,
            ...(profile.chatPlanPreferences
              ? { chat_preferences: deps.serializeTrainingPlanChatPreferences(profile.chatPlanPreferences) }
              : {}),
          },
          profile.mainGoal,
          profile.conditioning,
          profile.equipment,
          profile.injuries,
          profile.trainingFrequency,
        );
      }

      await deleteMissionEntries(db, replaceMissionIds);

      for (const entry of materialized) {
        const skillId = await deps.resolveSkillIdForExerciseMission(
          db,
          profile.userId,
          entry.mission.exercise_name,
        );
        const insertedMissionId = await deps.insertMission(
          db,
          profile.userId,
          entry.blueprint.period,
          deps.futureIsoForPeriod(entry.blueprint.period),
          entry.mission,
          skillId,
        );
        if (insertedMissionId && entry.blueprint.subtasks.length > 0) {
          await deps.createMissionSubtasks(db, insertedMissionId, entry.blueprint.subtasks);
        }
      }
    });
  }

  async function persistGeneratedMissionPlan(
    env: Env,
    db: D1Database,
    profile: MissionPlanProfileLike,
    blueprints: readonly MissionBlueprintLike[],
  ): Promise<MissionPayloadLike[]> {
    const materialized = await materializeMissionBlueprints(env, profile, blueprints);
    await persistMaterializedMissionEntries(db, profile, materialized);

    deps.invalidateMissionListCache(profile.userId);
    return materialized.map((entry) => ({
      ...entry.mission,
      type: entry.blueprint.period,
    }));
  }

  async function listCurrentCycleRegularDailyBlueprints(
    db: D1Database,
    userId: string,
    profile: MissionPlanProfileLike,
  ): Promise<MissionBlueprintLike[]> {
    const missions = await deps.listCurrentCycleMissions(db, userId, "regular");
    return missions
      .map((mission) => buildDailyBlueprintFromMissionPayload(mission, profile))
      .filter((mission): mission is MissionBlueprintLike => mission !== null);
  }

  async function ensureStructuredPeriodicMissionsFromExistingDailyBlueprints(
    env: Env,
    db: D1Database,
    userId: string,
    params: {
      weeklyTarget: number;
      monthlyTarget: number;
      weeklyDrafts?: readonly StructuredPeriodicMissionDraftLike[] | undefined;
      monthlyDrafts?: readonly StructuredPeriodicMissionDraftLike[] | undefined;
      replaceMissionIds?: readonly number[] | undefined;
    },
  ): Promise<number> {
    if (params.weeklyTarget <= 0 && params.monthlyTarget <= 0) {
      return 0;
    }

    const profile = await deps.loadMissionGenerationProfile(db, userId);
    if (!profile) return 0;

    const dailyBlueprints = await listCurrentCycleRegularDailyBlueprints(db, userId, profile);
    if (dailyBlueprints.length === 0) {
      return 0;
    }

    const fallbackDrafts = buildPeriodicFallbackDraftsFromDailyBlueprints(
      profile,
      dailyBlueprints,
      {
        weekly: params.weeklyTarget,
        monthly: params.monthlyTarget,
      },
    );
    const weeklyResolution = deps.resolvePeriodicMissionBlueprints({
      period: "weekly",
      targetCount: params.weeklyTarget,
      drafts: params.weeklyDrafts ?? [],
      fallbackDrafts: fallbackDrafts.weekly,
      dailyBlueprints,
      profile,
      missionOrigin: "regular",
      isAiSpecial: false,
    });
    const monthlyBlueprints = deps.buildMonthlyCounterMissionBlueprints(profile, params.monthlyTarget, {
      missionOrigin: "regular",
      isAiSpecial: false,
    });
    const blueprints = [...weeklyResolution.blueprints, ...monthlyBlueprints];
    if (blueprints.length === 0) {
      return 0;
    }

    const materialized = await materializeMissionBlueprints(env, profile, blueprints);
    await persistMaterializedMissionEntries(db, profile, materialized, {
      replaceMissionIds: params.replaceMissionIds,
    });
    deps.invalidateMissionListCache(profile.userId);
    return blueprints.length;
  }

  async function repairLegacyPeriodicMissions(
    _env: Env,
    db: D1Database,
    userId: string,
  ): Promise<void> {
    const rows = await db.prepare(
      `SELECT id, type, title, description, goal, metric_type, metric_value, target_reps, target_time
        FROM missions
        WHERE user_id = ?
          AND type IN ('weekly', 'monthly')
          AND is_completed = 0
          AND COALESCE(mission_origin, 'regular') = 'regular'
          AND (deadline IS NULL OR deadline > datetime('now'))`
    ).bind(userId).all<Record<string, unknown>>();
    const periodicRows = Array.isArray(rows.results) ? rows.results : [];
    if (periodicRows.length === 0) return;

    const parentIds = periodicRows
      .map((row) => Number(row.id))
      .filter((missionId) => Number.isInteger(missionId) && missionId > 0);
    if (parentIds.length === 0) return;

    const subtasksByParentId = await deps.loadMissionSubtasksByParentIds(db, parentIds);
    const weeklyRowsToRepair = periodicRows.filter((row) => {
      if (row.type !== "weekly") return false;
      const missionId = Number(row.id);
      const hasGoal = typeof row.goal === "string" && row.goal.trim().length > 0;
      return (subtasksByParentId.get(missionId)?.length ?? 0) === 0 || !hasGoal;
    });
    const monthlyRowsToRepair = periodicRows.filter((row) => {
      if (row.type !== "monthly") return false;
      return !isCurrentMonthlyCounterMissionRow(deps, row);
    });

    if (weeklyRowsToRepair.length === 0 && monthlyRowsToRepair.length === 0) {
      return;
    }

    const profile = await deps.loadMissionGenerationProfile(db, userId);
    if (!profile) return;

    const dailyBlueprints = await listCurrentCycleRegularDailyBlueprints(db, userId, profile);
    if (dailyBlueprints.length === 0) return;

    const fallbackDrafts = buildPeriodicFallbackDraftsFromDailyBlueprints(
      profile,
      dailyBlueprints,
      {
        weekly: weeklyRowsToRepair.length,
        monthly: monthlyRowsToRepair.length,
      },
    );
    const weeklyDrafts = weeklyRowsToRepair.map((row) => ({
      name: deps.stripMissionDisplayTitlePrefix(
        typeof row.title === "string" ? row.title : "Full Body Calisthenics Circuit",
      ),
      description: typeof row.description === "string" && row.description.trim().length > 0
        ? row.description
        : "O progresso desta missao semanal e atualizado automaticamente ao concluir as missoes diarias compativeis.",
      goal: typeof row.goal === "string" ? row.goal : undefined,
      subtasks: [],
    } satisfies StructuredPeriodicMissionDraftLike));
    const weeklyResolution = deps.resolvePeriodicMissionBlueprints({
      period: "weekly",
      targetCount: weeklyRowsToRepair.length,
      drafts: weeklyDrafts,
      fallbackDrafts: fallbackDrafts.weekly,
      dailyBlueprints,
      profile,
      missionOrigin: "regular",
      isAiSpecial: false,
    });
    const monthlyBlueprints = deps.buildMonthlyCounterMissionBlueprints(profile, monthlyRowsToRepair.length, {
      missionOrigin: "regular",
      isAiSpecial: false,
    });
    const hasProgressValueColumn = await deps.hasTableColumn(db, "missions", "progress_value");
    const monthlyCounters = monthlyRowsToRepair.length > 0
      ? await deps.getMonthlyCounters(db, userId)
      : null;
    const weeklyConfig = deps.missionConfigByPeriod("weekly");
    const monthlyConfig = deps.missionConfigByPeriod("monthly");

    await deps.withTransaction(db, async () => {
      for (let index = 0; index < weeklyRowsToRepair.length; index += 1) {
        const row = weeklyRowsToRepair[index];
        const blueprint = weeklyResolution.blueprints[index];
        const missionId = Number(row?.id ?? 0);
        if (!row || !blueprint || !Number.isInteger(missionId) || missionId <= 0) {
          continue;
        }

        const title = `${weeklyConfig.titlePrefix}: ${deps.stripMissionDisplayTitlePrefix(blueprint.name)}`;
        const circuitTasks = blueprint.subtasks.map((subtask) => ({
          id: crypto.randomUUID(),
          label: subtask.title,
          mission_type: subtask.compatibilityKey,
          required_count: Math.max(1, subtask.requiredCount),
          current_count: 0,
          completed: false,
        }));
        const muscleGroupsJson = JSON.stringify(
          deps.mergeUniqueStrings(
            blueprint.subtasks.map((subtask) => subtask.title),
            6,
          ),
        );
        const metricValue = Math.max(
          1,
          blueprint.subtasks.reduce((total, subtask) => total + subtask.requiredCount, 0),
        );
        const weeklySql = hasProgressValueColumn
          ? `UPDATE missions
               SET title = ?,
                   description = '',
                   goal = ?,
                   metric_type = 'circuit_tasks',
                   metric_value = ?,
                   metric_unit = ?,
                   target_reps = NULL,
                   target_time = NULL,
                   sets = NULL,
                   rest_seconds = NULL,
                   duration_estimate_minutes = NULL,
                   exercise_category = 'cardio_circuit',
                   exercise_type = 'cardio_circuit',
                   body_area = 'full_body',
                   mission_origin = 'regular',
                   circuit_tasks_json = ?,
                   safety_tips_json = '[]',
                   difficulty_level = ?,
                   progress_value = 0,
                   image_url = NULL,
                   exercise_db_gif_url = NULL,
                   exercise_db_image_url = NULL,
                   video_url = NULL,
                   thumbnail_url = NULL,
                   exercise_name = NULL,
                   exercise_db_id = NULL,
                   exercise_equipment = NULL,
                   exercise_body_part = NULL,
                   exercise_target = NULL,
                   exercise_secondary_muscles_json = '[]',
                   muscle_groups_json = ?,
                   is_ai_special = 0,
                   updated_at = datetime('now')
             WHERE id = ?`
          : `UPDATE missions
               SET title = ?,
                   description = '',
                   goal = ?,
                   metric_type = 'circuit_tasks',
                   metric_value = ?,
                   metric_unit = ?,
                   target_reps = NULL,
                   target_time = NULL,
                   sets = NULL,
                   rest_seconds = NULL,
                   duration_estimate_minutes = NULL,
                   exercise_category = 'cardio_circuit',
                   exercise_type = 'cardio_circuit',
                   body_area = 'full_body',
                   mission_origin = 'regular',
                   circuit_tasks_json = ?,
                   safety_tips_json = '[]',
                   difficulty_level = ?,
                   image_url = NULL,
                   exercise_db_gif_url = NULL,
                   exercise_db_image_url = NULL,
                   video_url = NULL,
                   thumbnail_url = NULL,
                   exercise_name = NULL,
                   exercise_db_id = NULL,
                   exercise_equipment = NULL,
                   exercise_body_part = NULL,
                   exercise_target = NULL,
                   exercise_secondary_muscles_json = '[]',
                   muscle_groups_json = ?,
                   is_ai_special = 0,
                   updated_at = datetime('now')
             WHERE id = ?`;
        await db.prepare(weeklySql).bind(
          title,
          blueprint.goal,
          metricValue,
          deps.metricUnitByType("circuit_tasks"),
          JSON.stringify(circuitTasks),
          blueprint.difficultyLevel,
          muscleGroupsJson,
          missionId,
        ).run();
        await deps.replaceMissionSubtasks(db, missionId, blueprint.subtasks);
      }

      for (let index = 0; index < monthlyRowsToRepair.length; index += 1) {
        const row = monthlyRowsToRepair[index];
        const blueprint = monthlyBlueprints[index];
        const missionId = Number(row?.id ?? 0);
        if (!row || !blueprint || !Number.isInteger(missionId) || missionId <= 0) {
          continue;
        }

        const title = `${monthlyConfig.titlePrefix}: ${deps.stripMissionDisplayTitlePrefix(blueprint.name)}`;
        const targetReps =
          blueprint.metricType === "duration_seconds" || blueprint.metricType === "duration_minutes"
            ? null
            : blueprint.metricValue;
        const targetTime =
          blueprint.metricType === "duration_seconds" || blueprint.metricType === "duration_minutes"
            ? blueprint.metricValue
            : null;
        const progressValue = monthlyCounters
          ? deps.monthlyMissionProgressValue(
            {
              title,
              metric_type: blueprint.metricType,
              metric_value: blueprint.metricValue,
              target_reps: targetReps,
              target_time: targetTime,
            },
            monthlyCounters,
          )
          : 0;
        const monthlySql = hasProgressValueColumn
          ? `UPDATE missions
               SET title = ?,
                   description = '',
                   goal = ?,
                   metric_type = ?,
                   metric_value = ?,
                   metric_unit = ?,
                   target_reps = ?,
                   target_time = ?,
                   sets = NULL,
                   rest_seconds = NULL,
                   duration_estimate_minutes = NULL,
                   exercise_category = 'monthly_counter',
                   exercise_type = 'meta_mensal',
                   body_area = 'full_body',
                   mission_origin = 'regular',
                   circuit_tasks_json = '[]',
                   safety_tips_json = '[]',
                   difficulty_level = ?,
                   progress_value = ?,
                   image_url = NULL,
                   exercise_db_gif_url = NULL,
                   exercise_db_image_url = NULL,
                   video_url = NULL,
                   thumbnail_url = NULL,
                   exercise_name = NULL,
                   exercise_db_id = NULL,
                   exercise_equipment = NULL,
                   exercise_body_part = NULL,
                   exercise_target = NULL,
                   exercise_secondary_muscles_json = '[]',
                   muscle_groups_json = '[]',
                   is_ai_special = 0,
                   updated_at = datetime('now')
             WHERE id = ?`
          : `UPDATE missions
               SET title = ?,
                   description = '',
                   goal = ?,
                   metric_type = ?,
                   metric_value = ?,
                   metric_unit = ?,
                   target_reps = ?,
                   target_time = ?,
                   sets = NULL,
                   rest_seconds = NULL,
                   duration_estimate_minutes = NULL,
                   exercise_category = 'monthly_counter',
                   exercise_type = 'meta_mensal',
                   body_area = 'full_body',
                   mission_origin = 'regular',
                   circuit_tasks_json = '[]',
                   safety_tips_json = '[]',
                   difficulty_level = ?,
                   image_url = NULL,
                   exercise_db_gif_url = NULL,
                   exercise_db_image_url = NULL,
                   video_url = NULL,
                   thumbnail_url = NULL,
                   exercise_name = NULL,
                   exercise_db_id = NULL,
                   exercise_equipment = NULL,
                   exercise_body_part = NULL,
                   exercise_target = NULL,
                   exercise_secondary_muscles_json = '[]',
                   muscle_groups_json = '[]',
                   is_ai_special = 0,
                   updated_at = datetime('now')
             WHERE id = ?`;
        await db.prepare(monthlySql).bind(
          title,
          blueprint.goal,
          blueprint.metricType,
          blueprint.metricValue,
          deps.metricUnitByType(blueprint.metricType),
          targetReps,
          targetTime,
          blueprint.difficultyLevel,
          ...(hasProgressValueColumn ? [progressValue] : []),
          missionId,
        ).run();
        await db.prepare(
          `DELETE FROM mission_subtasks
            WHERE parent_mission_id = ?`
        ).bind(missionId).run();
      }
    });
  }

  return {
    ensureStructuredPeriodicMissionsFromExistingDailyBlueprints,
    listCurrentCycleRegularDailyBlueprints,
    materializeMissionBlueprints,
    persistGeneratedMissionPlan,
    persistMaterializedMissionEntries,
    repairLegacyPeriodicMissions,
  };
}
