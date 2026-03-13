import z from "zod";

export type ConditioningLevel = "sedentario" | "iniciante" | "intermediario" | "avancado";

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
  age: z.number().nullable().optional(),
  gender: z.string().nullable().optional(),
  goals_json: z.string().nullable().optional(),
  custom_color: z.string().nullable(),
  custom_font: z.string().nullable(),
  custom_border: z.string().nullable(),
  active_skill_focus: z.string().nullable().optional(),
  custom_primary_color: z.string().nullable().optional(),
  custom_secondary_color: z.string().nullable().optional(),
  custom_background_type: z.string().nullable().optional(),
  custom_background_value: z.string().nullable().optional(),
  custom_title_id: z.number().nullable().optional(),
  showcased_achievements: z.string().nullable().optional(),
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

export const MissionMetricTypeSchema = z.enum([
  "repetitions",
  "duration_seconds",
  "sets_reps",
  "steps",
  "distance_meters",
  "duration_minutes",
  "circuit_tasks",
]);

export type MissionMetricType = z.infer<typeof MissionMetricTypeSchema>;

export const CircuitTaskSchema = z.object({
  id: z.string(),
  label: z.string(),
  mission_type: z.string(),
  required_count: z.number(),
  current_count: z.number(),
  completed: z.boolean(),
});

export type CircuitTask = z.infer<typeof CircuitTaskSchema>;

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
  metric_type: MissionMetricTypeSchema.optional(),
  metric_value: z.number().optional(),
  progress_value: z.number().optional(),
  metric_unit: z.string().optional(),
  sets: z.number().nullable().optional(),
  rest_seconds: z.number().nullable().optional(),
  instructions: z.array(z.string()).optional(),
  exercise_instructions_en: z.array(z.string()).optional(),
  exercise_instructions_pt: z.array(z.string()).optional(),
  image_url: z.string().nullable().optional(),
  exercise_db_gif_url: z.string().nullable().optional(),
  exercise_db_image_url: z.string().nullable().optional(),
  muscle_groups: z.array(z.string()).optional(),
  exercise_secondary_muscles: z.array(z.string()).optional(),
  exercise_name: z.string().nullable().optional(),
  exercise_equipment: z.string().nullable().optional(),
  exercise_body_part: z.string().nullable().optional(),
  exercise_target: z.string().nullable().optional(),
  exercise_type: z.string().optional(),
  body_area: z.enum(["upper", "lower", "core", "full_body"]).optional(),
  attributes_benefited: z.array(z.string()).optional(),
  duration_estimate_minutes: z.number().optional(),
  exercise_category: z.string().optional(),
  mission_origin: z.enum(["regular", "ai"]).optional(),
  circuit_tasks: z.array(CircuitTaskSchema).optional(),
  safety_tips: z.array(z.string()).optional(),
  difficulty_level: z.string().optional(),
  video_url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  xp_reward: z.number(),
  points_reward: z.number(),
  deadline: z.string().nullable(),
  is_completed: z.number(),
  completed_at: z.string().nullable(),
  verified_by_sensor: z.number(),
  status: z.string().optional(),
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
  category: z.string().optional(),
  color: z.string().optional(),
  secret: z.number().optional(),
  condition: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
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
  description: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  unlock_condition: z.string().nullable().optional(),
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

// Composite UI/API types
export type SkillWithProgress = Skill & {
  total_reps: number;
  best_reps: number;
};

export type AchievementWithUnlock = Achievement & {
  unlocked?: number | undefined;
  unlocked_at?: string | undefined;
  progress_current?: number | undefined;
  progress_required?: number | undefined;
};

export type TitleWithUnlock = Title & {
  unlocked?: number | undefined;
  is_active?: number | undefined;
  is_equipped?: number | undefined;
};

export type RankingPlayer = {
  username: string;
  full_name: string;
  level: number;
  xp: number;
  current_streak: number;
};

export const PromoCodeEffectSchema = z.enum([
  "activate_vip",
  "discount_percent",
  "discount_fixed",
  "free_months",
  "unlock_feature",
]);

export type PromoCodeEffect = z.infer<typeof PromoCodeEffectSchema>;

export const PromoCodeRequestSchema = z.object({
  code: z.string().trim().min(1).max(128),
});

export type PromoCodeRequest = z.infer<typeof PromoCodeRequestSchema>;

// Onboarding Request Schema
export const OnboardingRequestSchema = z.object({
  username: z.string().min(3).max(20),
  full_name: z.string().min(1),
  weight: z.number().positive(),
  height: z.number().positive(),
  age: z.number().int().min(13).max(80),
  gender: z.enum(["homem", "mulher", "outro"]),
  initial_conditioning: z.enum(['sedentario', 'iniciante', 'intermediario', 'avancado']),
  initial_pushups: z.number().min(0),
  initial_situps: z.number().min(0),
  initial_squats: z.number().min(0),
  injuries: z.string().optional(),
  equipment: z.string().optional(),
  main_goal: z.enum(['perder_peso', 'ganhar_massa', 'resistencia', 'calistenia', 'saude_geral']),
  goals: z.array(z.enum(['perder_peso', 'ganhar_massa', 'resistencia', 'calistenia', 'saude_geral'])).min(1),
  training_frequency: z.number().int().min(1).max(7),
  plan_id: z.enum(["basic", "pro", "annual"]),
  payment_method: z.enum(["card", "pix"]),
  card_number: z.string().min(8).max(32).optional(),
  card_holder_name: z.string().min(1).max(120).optional(),
  card_expiry: z.string().min(3).max(8).optional(),
  promo_code: z.string().trim().min(1).max(128).optional(),
});

export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;

// Complete Mission Request Schema
export const CompleteMissionRequestSchema = z.object({
  mission_id: z.number(),
  reps_completed: z.number().min(0).optional(),
  time_completed: z.number().min(0).optional(),
  metric_completed: z.number().min(0).optional(),
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

// AI Chat Request Schema (validação de fronteira)
export const AiChatRequestSchema = z.object({
  message: z.string().min(1),
  history: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
  mode: z.enum(["suporte", "motivacional", "tecnico"]).optional(),
  session_count: z.number().min(1).optional(),
});
export type AiChatRequest = z.infer<typeof AiChatRequestSchema>;

// AI Analyze Food Request Schema

export const AiAnalyzeFoodRequestSchema = z.object({
  food_description: z.string().optional(),
  image_base64: z.string().optional(),
  identified_items: z.array(z.object({
    food_name: z.string().min(1),
    portion_description: z.string().optional(),
    portion_multiplier: z.number().positive().optional(),
  })).optional(),
  ocr_text: z.string().optional(),
}).refine((data) => data.food_description !== undefined || data.image_base64 !== undefined || (data.identified_items?.length ?? 0) > 0, {
  message: "Food description or image required",
});
export type AiAnalyzeFoodRequest = z.infer<typeof AiAnalyzeFoodRequestSchema>;

// Auth: login e registro por e-mail/senha
export const AuthRegisterRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});
export type AuthRegisterRequest = z.infer<typeof AuthRegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// User plan (subscription)
export const UserPlanRequestSchema = z.object({
  plan_id: z.enum(["basic", "pro", "annual"]),
  payment_method: z.enum(["none", "card", "pix"]),
  status: z.enum(["pending", "active", "cancelled", "failed", "expired"]),
});
export type UserPlanRequest = z.infer<typeof UserPlanRequestSchema>;

export const CheckoutStartRequestSchema = z.object({
  plan_id: z.enum(["basic", "pro", "annual"]),
  payment_method: z.enum(["card", "pix"]),
  card_number: z.string().min(8).max(32).optional(),
  card_holder_name: z.string().min(1).max(120).optional(),
  card_expiry: z.string().min(3).max(8).optional(),
  promo_code: z.string().trim().min(1).max(128).optional(),
});
export type CheckoutStartRequest = z.infer<typeof CheckoutStartRequestSchema>;

// PATCH /api/users/me (optional profile fields)
export const UpdateMeRequestSchema = z.object({
  name: z.string().min(1).optional(),
  photo_url: z.union([z.string().url(), z.literal("")]).optional(),
  goals: z.string().optional(),
  fitness_level: z.string().optional(),
});
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;
