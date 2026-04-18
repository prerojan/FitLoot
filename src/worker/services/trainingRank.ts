import type { TrainingRankProfile, TrainingRankSnapshot } from "../../shared/types";
import {
  calculateTrainingRankSnapshot,
  deserializeRankSnapshot,
  isTrainingRank,
  serializeRankSnapshot,
} from "../../shared/trainingLevels";

type ProgressionTrainingRankRow = {
  user_id: string;
  xp: number | string | null;
  level: number | string | null;
  current_streak: number | string | null;
  best_streak: number | string | null;
  last_activity_date: string | null;
  training_rank: string | null;
  training_rank_score: number | string | null;
  training_rank_snapshot: string | null;
};

type UserSkillAggregateRow = {
  user_id: string;
  unlocked_skills: number | string | null;
  unlocked_skill_stages: number | string | null;
  total_skill_reps: number | string | null;
};

type LatestBenchmarkRow = {
  user_id: string;
  test_date: string | null;
  created_at: string | null;
  pushups_max: number | string | null;
  squats_max: number | string | null;
  situps_max: number | string | null;
  plank_seconds: number | string | null;
  pullups_max: number | string | null;
  run_distance_km: number | string | null;
  run_time_seconds: number | string | null;
};

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPlaceholders(size: number): string {
  return Array.from({ length: size }, () => "?").join(", ");
}

function uniqueUserIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.map((userId) => userId.trim()).filter((userId) => userId.length > 0))];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildTrainingRankProfile(
  progression: ProgressionTrainingRankRow,
  skillAggregate: UserSkillAggregateRow | undefined,
  latestBenchmark: LatestBenchmarkRow | undefined,
): TrainingRankProfile {
  const xp = Math.floor(toNonNegativeNumber(progression.xp));
  const level = Math.max(1, Math.floor(toNonNegativeNumber(progression.level, 1)));
  const totalSessions = Math.floor(xp / 50);
  const activeWeeks = Math.min(Math.floor(totalSessions / 3), 52);
  const unlockedSkills = Math.floor(toNonNegativeNumber(skillAggregate?.unlocked_skills));
  const unlockedSkillStages = Math.floor(toNonNegativeNumber(skillAggregate?.unlocked_skill_stages));
  const totalSkillReps = Math.floor(toNonNegativeNumber(skillAggregate?.total_skill_reps));

  const benchmarkResults = latestBenchmark
    ? {
        ...(latestBenchmark.pushups_max == null
          ? {}
          : { pushUpMaxReps: toNonNegativeNumber(latestBenchmark.pushups_max) }),
        ...(latestBenchmark.squats_max == null
          ? {}
          : { squatMaxReps: toNonNegativeNumber(latestBenchmark.squats_max) }),
        ...(latestBenchmark.plank_seconds == null
          ? {}
          : { plankMaxSeconds: toNonNegativeNumber(latestBenchmark.plank_seconds) }),
        ...(latestBenchmark.situps_max == null
          ? {}
          : { sitUpMaxReps: toNonNegativeNumber(latestBenchmark.situps_max) }),
        ...(latestBenchmark.pullups_max == null
          ? {}
          : { pullUpMaxReps: toNonNegativeNumber(latestBenchmark.pullups_max) }),
        ...(latestBenchmark.run_distance_km == null
          ? {}
          : { runDistanceKm: toNonNegativeNumber(latestBenchmark.run_distance_km) }),
        ...(latestBenchmark.run_time_seconds == null
          ? {}
          : { runTimeSeconds: toNonNegativeNumber(latestBenchmark.run_time_seconds) }),
      }
    : null;

  return {
    xp,
    level,
    totalSessions,
    activeWeeks,
    currentStreak: Math.floor(toNonNegativeNumber(progression.current_streak)),
    longestStreak: Math.max(
      Math.floor(toNonNegativeNumber(progression.current_streak)),
      Math.floor(toNonNegativeNumber(progression.best_streak)),
    ),
    lastActivityDate: progression.last_activity_date,
    latestBenchmarkDate: latestBenchmark?.test_date ?? latestBenchmark?.created_at ?? null,
    unlockedSkills,
    unlockedSkillStages,
    totalSkillReps,
    ...(benchmarkResults ? { benchmarkResults } : {}),
  };
}

function snapshotsMatchPersistedState(
  progression: Pick<
    ProgressionTrainingRankRow,
    "training_rank" | "training_rank_score" | "training_rank_snapshot"
  >,
): boolean {
  if (!isTrainingRank(progression.training_rank)) {
    return false;
  }

  const snapshot = deserializeRankSnapshot(progression.training_rank_snapshot);
  if (!snapshot) {
    return false;
  }

  return (
    snapshot.globalRank === progression.training_rank &&
    snapshot.globalScore === Math.round(toFiniteNumber(progression.training_rank_score) ?? -1)
  );
}

export function needsTrainingRankSync(
  progression: Pick<
    ProgressionTrainingRankRow,
    "training_rank" | "training_rank_score" | "training_rank_snapshot"
  > | null | undefined,
): boolean {
  if (!progression) return true;
  return !snapshotsMatchPersistedState(progression);
}

async function loadProgressionRows(
  db: D1Database,
  userIds: readonly string[],
): Promise<ProgressionTrainingRankRow[]> {
  const placeholders = buildPlaceholders(userIds.length);
  const result = await db
    .prepare(
      `SELECT
        user_id,
        xp,
        level,
        current_streak,
        best_streak,
        last_activity_date,
        training_rank,
        training_rank_score,
        training_rank_snapshot
      FROM user_progression
      WHERE user_id IN (${placeholders})`,
    )
    .bind(...userIds)
    .all<ProgressionTrainingRankRow>();

  return Array.isArray(result.results) ? result.results : [];
}

async function loadSkillAggregates(
  db: D1Database,
  userIds: readonly string[],
): Promise<UserSkillAggregateRow[]> {
  const placeholders = buildPlaceholders(userIds.length);
  const result = await db
    .prepare(
      `SELECT
        user_id,
        COUNT(*) AS unlocked_skills,
        SUM(CASE WHEN total_reps >= 100 THEN 1 ELSE 0 END) AS unlocked_skill_stages,
        SUM(COALESCE(total_reps, 0)) AS total_skill_reps
      FROM user_skills
      WHERE user_id IN (${placeholders})
      GROUP BY user_id`,
    )
    .bind(...userIds)
    .all<UserSkillAggregateRow>();

  return Array.isArray(result.results) ? result.results : [];
}

async function loadLatestBenchmarks(
  db: D1Database,
  userIds: readonly string[],
): Promise<LatestBenchmarkRow[]> {
  const placeholders = buildPlaceholders(userIds.length);
  const result = await db
    .prepare(
      `SELECT
        pb.user_id,
        pb.test_date,
        pb.created_at,
        pb.pushups_max,
        pb.squats_max,
        pb.situps_max,
        pb.plank_seconds,
        pb.pullups_max,
        pb.run_distance_km,
        pb.run_time_seconds
      FROM physical_benchmarks pb
      INNER JOIN (
        SELECT user_id, MAX(id) AS latest_id
        FROM physical_benchmarks
        WHERE user_id IN (${placeholders})
        GROUP BY user_id
      ) latest
        ON latest.latest_id = pb.id`,
    )
    .bind(...userIds)
    .all<LatestBenchmarkRow>();

  return Array.isArray(result.results) ? result.results : [];
}

export async function syncTrainingRankStatesForUsers(
  db: D1Database,
  userIds: readonly string[],
): Promise<Map<string, TrainingRankSnapshot>> {
  const normalizedUserIds = uniqueUserIds(userIds);
  const snapshots = new Map<string, TrainingRankSnapshot>();
  const userIdChunks = chunk(normalizedUserIds, 100);

  if (userIdChunks.length === 0) {
    return snapshots;
  }

  for (const userIdChunk of userIdChunks) {
    const [progressions, skillAggregates, latestBenchmarks] = await Promise.all([
      loadProgressionRows(db, userIdChunk),
      loadSkillAggregates(db, userIdChunk),
      loadLatestBenchmarks(db, userIdChunk),
    ]);

    const progressionByUserId = new Map(progressions.map((row) => [row.user_id, row]));
    const skillAggregateByUserId = new Map(skillAggregates.map((row) => [row.user_id, row]));
    const latestBenchmarkByUserId = new Map(latestBenchmarks.map((row) => [row.user_id, row]));

    for (const userId of userIdChunk) {
      const progression = progressionByUserId.get(userId);
      if (!progression) continue;

      const snapshot = calculateTrainingRankSnapshot(
        buildTrainingRankProfile(
          progression,
          skillAggregateByUserId.get(userId),
          latestBenchmarkByUserId.get(userId),
        ),
      );

      await db
        .prepare(
          `UPDATE user_progression
              SET training_rank = ?,
                  training_rank_score = ?,
                  training_rank_snapshot = ?,
                  training_rank_last_synced_at = datetime('now')
            WHERE user_id = ?`,
        )
        .bind(
          snapshot.globalRank,
          snapshot.globalScore,
          serializeRankSnapshot(snapshot),
          userId,
        )
        .run();

      snapshots.set(userId, snapshot);
    }
  }

  return snapshots;
}

export async function syncTrainingRankStateForUser(
  db: D1Database,
  userId: string,
): Promise<TrainingRankSnapshot | null> {
  const snapshots = await syncTrainingRankStatesForUsers(db, [userId]);
  return snapshots.get(userId) ?? null;
}
