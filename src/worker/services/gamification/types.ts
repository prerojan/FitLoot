export type TitleSeed = {
  name: string;
  description: string;
  reference: string;
  unlock_condition: string;
  rarity: string;
  xp_reward?: number;
  points_reward?: number;
};

export type AchievementSeed = {
  name: string;
  description: string;
  category: string;
  rarity: string;
  color: string;
  secret: number;
  condition: string;
  icon: string;
  reference: string;
  xp_reward?: number;
  points_reward?: number;
};
