import type { TrainingRank } from "../../shared/types";
import {
  deserializeRankSnapshot,
  getLowestTrainingRank,
  isTrainingRank,
} from "../../shared/trainingLevels";
import {
  needsTrainingRankSync,
  syncTrainingRankStatesForUsers,
} from "./trainingRank";

export type RankingRow = {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  level: number;
  xp: number;
  current_streak: number;
  points: number;
  training_rank: TrainingRank;
  training_rank_score: number;
};

type TrainingRankingSourceRow = {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  level: number | string | null;
  xp: number | string | null;
  current_streak: number | string | null;
  points: number | string | null;
  training_rank: string | null;
  training_rank_score: number | string | null;
  training_rank_snapshot: string | null;
};

function normalizeNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, parsed);
}

function normalizeTrainingRankingRow(
  row: TrainingRankingSourceRow,
  syncedSnapshots: ReadonlyMap<
    string,
    { globalRank: TrainingRank; globalScore: number }
  > = new Map(),
): RankingRow {
  const level = Math.max(1, normalizeNonNegativeNumber(row.level, 1));
  const xp = normalizeNonNegativeNumber(row.xp);
  const currentStreak = normalizeNonNegativeNumber(row.current_streak);
  const syncedSnapshot = syncedSnapshots.get(row.user_id);
  const storedSnapshot = deserializeRankSnapshot(row.training_rank_snapshot);
  const resolvedSnapshot = syncedSnapshot ?? storedSnapshot;
  const storedRank = isTrainingRank(row.training_rank) ? row.training_rank : null;
  const storedScoreRaw = Number(row.training_rank_score);
  const storedScore = Number.isFinite(storedScoreRaw)
    ? Math.max(0, storedScoreRaw)
    : null;
  const trainingRank = storedRank ?? resolvedSnapshot?.globalRank ?? getLowestTrainingRank();
  const trainingRankScore = storedScore ?? resolvedSnapshot?.globalScore ?? 0;

  return {
    user_id: row.user_id,
    username: row.username,
    full_name: row.full_name,
    avatar_url: row.avatar_url ?? null,
    level,
    xp,
    current_streak: currentStreak,
    points: normalizeNonNegativeNumber(row.points),
    training_rank: trainingRank,
    training_rank_score: trainingRankScore,
  };
}

function sortTrainingRankingRows(rows: RankingRow[]): RankingRow[] {
  return [...rows].sort((left, right) => {
    if (right.training_rank_score !== left.training_rank_score) {
      return right.training_rank_score - left.training_rank_score;
    }
    if (right.level !== left.level) {
      return right.level - left.level;
    }
    if (right.xp !== left.xp) {
      return right.xp - left.xp;
    }

    return left.username.localeCompare(right.username, "pt-BR", {
      sensitivity: "base",
    });
  });
}

export async function loadTrainingRankingRows(
  db: D1Database,
  whereClause?: string,
  bindings: readonly unknown[] = [],
): Promise<RankingRow[]> {
  const ranking = await db.prepare(
    `SELECT
      up.user_id,
      up.username,
      up.full_name,
      u.avatar_url,
      pr.level,
      pr.xp,
      pr.current_streak,
      pr.points,
      pr.training_rank,
      pr.training_rank_score,
      pr.training_rank_snapshot
    FROM user_profiles up
    LEFT JOIN users u
      ON u.id = up.user_id
    INNER JOIN user_progression pr
      ON up.user_id = pr.user_id
    ${whereClause ? `WHERE ${whereClause}` : ""}`,
  ).bind(...bindings).all<TrainingRankingSourceRow>();

  const sourceRows = Array.isArray(ranking.results) ? ranking.results : [];
  const missingStateUserIds = sourceRows
    .filter((row) =>
      needsTrainingRankSync({
        training_rank: row.training_rank,
        training_rank_score: row.training_rank_score,
        training_rank_snapshot: row.training_rank_snapshot,
      }),
    )
    .map((row) => row.user_id);

  const syncedSnapshots = missingStateUserIds.length > 0
    ? await syncTrainingRankStatesForUsers(db, missingStateUserIds)
    : new Map();

  return sortTrainingRankingRows(
    sourceRows.map((row) => normalizeTrainingRankingRow(row, syncedSnapshots)),
  );
}

export async function resolveUserTrainingRankingPosition(
  db: D1Database,
  userId: string,
): Promise<number> {
  const rankingRows = await loadTrainingRankingRows(db);
  return rankingRows.findIndex((row) => row.user_id === userId) + 1;
}
