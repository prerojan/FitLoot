import z from "zod";

// User Profile Schema
export const UserProfileSchema = z.object({
  id: z.number(),
  user_id: z.string(),
  username: z.string(),
  full_name: z.string(),
  weight: z.number().nullable(),
  height: z.number().nullable(),
  initial_conditioning: z.string().nullable(),
  injuries: z.string().nullable(),
  equipment: z.string().nullable(),
  main_goal: z.string().nullable(),
  custom_color: z.string().nullable(),
  custom_font: z.string().nullable(),
  custom_border: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// User Attributes Schema
export const UserAttributesSchema = z.object({
  id: z.number(),
  user_id: z.string(),
  strength: z.number(),
  constitution: z.number(),
  vitality: z.number(),
  dexterity: z.number(),
  focus: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserAttributes = z.infer<typeof UserAttributesSchema>;

// User Progression Schema
export const UserProgressionSchema = z.object({
  id: z.number(),
  user_id: z.string(),
  xp: z.number(),
  level: z.number(),
  points: z.number(),
  current_streak: z.number(),
  best_streak: z.number(),
  last_activity_date: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserProgression = z.infer<typeof UserProgressionSchema>;

// Skill Schema
export const SkillSchema = z.object({
  id: z.number(),
  name: z.string(),
  category: z.string(),
  difficulty: z.string(),
  description: z.string().nullable(),
  calories_per_rep: z.number(),
  strength_gain: z.number(),
  constitution_gain: z.number(),
  vitality_gain: z.number(),
  dexterity_gain: z.number(),
  focus_gain: z.number(),
  required_level: z.number(),
  prerequisite_skill_id: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Skill = z.infer<typeof SkillSchema>;

// User Skill Schema
export const UserSkillSchema = z.object({
  id: z.number(),
  user_id: z.string(),
  skill_id: z.number(),
  total_reps: z.number(),
  total_time: z.number(),
  best_reps: z.number(),
  unlocked_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserSkill = z.infer<typeof UserSkillSchema>;

// Mission Schema
export const MissionSchema = z.object({
  id: z.number(),
  user_id: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  skill_id: z.number().nullable(),
  target_reps: z.number().nullable(),
  target_time: z.number().nullable(),
  xp_reward: z.number(),
  points_reward: z.number(),
  deadline: z.string().nullable(),
  is_completed: z.number(),
  completed_at: z.string().nullable(),
  verified_by_sensor: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Mission = z.infer<typeof MissionSchema>;

// Achievement Schema
export const AchievementSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  rarity: z.string(),
  icon: z.string().nullable(),
  requirement_type: z.string(),
  requirement_value: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Achievement = z.infer<typeof AchievementSchema>;

// Title Schema
export const TitleSchema = z.object({
  id: z.number(),
  name: z.string(),
  rarity: z.string(),
  requirement_type: z.string(),
  requirement_value: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Title = z.infer<typeof TitleSchema>;

// Shop Product Schema
export const ShopProductSchema = z.object({
  id: z.number(),
  partner_id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  points_cost: z.number(),
  category: z.string(),
  image_url: z.string().nullable(),
  is_available: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ShopProduct = z.infer<typeof ShopProductSchema>;

// Daily Metrics Schema
export const DailyMetricsSchema = z.object({
  id: z.number(),
  user_id: z.string(),
  date: z.string(),
  steps: z.number(),
  calories_burned: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type DailyMetrics = z.infer<typeof DailyMetricsSchema>;

// Onboarding Request Schema
export const OnboardingRequestSchema = z.object({
  username: z.string().min(3).max(20),
  full_name: z.string().min(1),
  weight: z.number().positive(),
  height: z.number().positive(),
  initial_conditioning: z.enum(['sedentario', 'iniciante', 'intermediario', 'avancado']),
  initial_pushups: z.number().min(0),
  initial_situps: z.number().min(0),
  initial_squats: z.number().min(0),
  injuries: z.string().optional(),
  equipment: z.string().optional(),
  main_goal: z.enum(['perder_peso', 'ganhar_massa', 'resistencia', 'calistenia', 'saude_geral']),
});

export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;

// Complete Mission Request Schema
export const CompleteMissionRequestSchema = z.object({
  mission_id: z.number(),
  reps_completed: z.number().min(0).optional(),
  time_completed: z.number().min(0).optional(),
  sensor_verified: z.boolean(),
});

export type CompleteMissionRequest = z.infer<typeof CompleteMissionRequestSchema>;

// Food Scan Request Schema
export const FoodScanRequestSchema = z.object({
  food_name: z.string(),
  calories: z.number().optional(),
  meal_type: z.enum(['cafe', 'almoco', 'jantar', 'lanche']).optional(),
});

export type FoodScanRequest = z.infer<typeof FoodScanRequestSchema>;

// Update Daily Metrics Request Schema
export const UpdateDailyMetricsRequestSchema = z.object({
  steps: z.number().min(0),
  calories_burned: z.number().min(0),
});

export type UpdateDailyMetricsRequest = z.infer<typeof UpdateDailyMetricsRequestSchema>;

// Friend Request Schema
export const FriendRequestSchema = z.object({
  friend_user_id: z.string(),
});

export type FriendRequest = z.infer<typeof FriendRequestSchema>;

// Mini Game Challenge Request Schema
export const MiniGameChallengeRequestSchema = z.object({
  challenged_user_id: z.string().nullable(),
  skill_id: z.number(),
  target_reps: z.number().min(1),
  opponent_type: z.enum(['friend', 'random']),
});

export type MiniGameChallengeRequest = z.infer<typeof MiniGameChallengeRequestSchema>;

// Mini Game Complete Request Schema
export const MiniGameCompleteRequestSchema = z.object({
  reps_completed: z.number().min(0),
  time_seconds: z.number().min(0),
});

export type MiniGameCompleteRequest = z.infer<typeof MiniGameCompleteRequestSchema>;
