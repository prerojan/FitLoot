import { resolveUserTrainingRankingPosition } from "./trainingRanking";

type RankingMilestoneDeps = {
  onRankingUpdate: (
    db: D1Database,
    userId: string,
    position: number,
  ) => Promise<void>;
  unlockAchievementIfNeeded: (
    db: D1Database,
    userId: string,
    achievementName: string,
    progressCurrent?: number,
    progressRequired?: number,
  ) => Promise<void>;
};

export async function applyTrainingRankingMilestones(
  db: D1Database,
  userId: string,
  {
    onRankingUpdate,
    unlockAchievementIfNeeded,
  }: RankingMilestoneDeps,
): Promise<number> {
  const position = await resolveUserTrainingRankingPosition(db, userId);
  if (position <= 0) {
    return 0;
  }

  await onRankingUpdate(db, userId, position);

  if (position <= 100) {
    await unlockAchievementIfNeeded(
      db,
      userId,
      "Na Disputa",
      100 - position + 1,
      100,
    );
  }

  if (position <= 10) {
    await unlockAchievementIfNeeded(db, userId, "Elite", 10 - position + 1, 10);
  }

  if (position === 1) {
    await unlockAchievementIfNeeded(db, userId, "O Escolhido", 1, 1);
  }

  return position;
}
