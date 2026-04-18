import z from "zod";

export type ConditioningLevel = "sedentario" | "iniciante" | "intermediario" | "avancado";

// User Profile Schema
export const UserProfileSchema = z.object({
  id: z.number(),
  user_id: z.string(),
  username: z.string(),
  full_name: z.string(),
  avatar_url: z.string().nullable().optional(),
  weight: z.number().nullable(),
  height: z.number().nullable(),
  initial_conditioning: z.string().nullable(),
  initial_pushups: z.number().nullable().optional(),
  initial_situps: z.number().nullable().optional(),
  initial_squats: z.number().nullable().optional(),
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
  /** Presente só no GET /api/progression quando o servidor acabou de normalizar nível/XP atrasado (mostrar modal uma vez). */
  celebrate_level: z.number().optional(),
  /** NOVO: Snapshot do rank de treinamento calculado (camada paralela) */
  training_rank_snapshot: z.string().nullable().optional(), // JSON string do TrainingRankSnapshot
});

export type UserProgression = z.infer<typeof UserProgressionSchema>;

// Training Rank System (camada paralela derivada)
export const TRAINING_RANK_VALUES = [
  "bronze_1",
  "bronze_2",
  "bronze_3",
  "ferro_1",
  "ferro_2",
  "ferro_3",
  "ouro_1",
  "ouro_2",
  "ouro_3",
  "diamante_1",
  "diamante_2",
  "diamante_3",
  "elite",
] as const;

export type TrainingRank = (typeof TRAINING_RANK_VALUES)[number];
export const TRAINING_RANK_SNAPSHOT_VERSION = 3 as const;

export interface TrainingRankSnapshot {
  /** Versao do schema para invalidar snapshots legados quando o rank muda. */
  schemaVersion: number;
  /** Rank global calculado com base em todos os fatores */
  globalRank: TrainingRank;
  /** Score total usado para calcular o rank (0-1300) */
  globalScore: number;
  /** Data do último cálculo do rank */
  lastCalculatedAt: string;
  /** Fatores individuais usados no cálculo */
  factors: {
    volumeScore: number;      // Baseado em volume total de sessoes
    consistencyScore: number; // Baseado em semanas ativas e melhor streak
    benchmarkScore: number;   // Baseado em benchmarks fisicos
    skillMasteryScore: number; // Baseado em skills, estagios e repeticoes
    momentumScore: number;    // Baseado em streak atual e frescor da atividade
  };
  /** Metadados para fallback */
  hasBenchmarkData: boolean;
  hasSkillData: boolean;
  fallbackUsed: boolean;
}

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
  exercise_db_id: z.string().nullable().optional(),
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
  execution_mode: z.enum(["standard", "route_tracking"]).optional(),
  activity_kind: z.enum(["walking", "running"]).nullable().optional(),
  mission_origin: z.enum(["regular", "ai"]).optional(),
  goal: z.string().nullable().optional(),
  is_ai_special: z.number().optional(),
  circuit_tasks: z.array(CircuitTaskSchema).optional(),
  safety_tips: z.array(z.string()).optional(),
  difficulty_level: z.string().optional(),
  video_url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  cycle_date: z.string().nullable().optional(),
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
  xp_reward: z.number().optional(),
  points_reward: z.number().optional(),
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
  xp_reward: z.number().optional(),
  points_reward: z.number().optional(),
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
  distance_meters: z.number(),
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
  user_id?: string;
  username: string;
  full_name: string;
  avatar_url?: string | null;
  level: number;
  xp: number;
  current_streak: number;
  training_rank?: TrainingRank;
  training_rank_score?: number;
};

export const RewardNotificationTypeSchema = z.enum([
  "level_up",
  "achievement_unlocked",
  "title_unlocked",
]);

export type RewardNotificationType = z.infer<
  typeof RewardNotificationTypeSchema
>;

export const RewardNotificationSchema = z.object({
  id: z.number(),
  type: RewardNotificationTypeSchema,
  name: z.string().nullable().optional(),
  level: z.number().nullable().optional(),
  xp_reward: z.number().optional(),
  points_reward: z.number().optional(),
  created_at: z.string(),
});

export type RewardNotification = z.infer<typeof RewardNotificationSchema>;

export const ConsumeRewardNotificationsRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).max(50),
});

export type ConsumeRewardNotificationsRequest = z.infer<
  typeof ConsumeRewardNotificationsRequestSchema
>;

export const SocialConversationKindSchema = z.enum([
  "direct",
  "group",
]);

export type SocialConversationKind = z.infer<
  typeof SocialConversationKindSchema
>;

export const SocialConversationMessageKindSchema = z.enum([
  "text",
  "image",
]);

export type SocialConversationMessageKind = z.infer<
  typeof SocialConversationMessageKindSchema
>;

export const SocialConversationMemberRoleSchema = z.enum([
  "owner",
  "member",
]);

export type SocialConversationMemberRole = z.infer<
  typeof SocialConversationMemberRoleSchema
>;

export const SocialConversationParticipantSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  full_name: z.string(),
  avatar_url: z.string().nullable().optional(),
  is_online: z.boolean().optional(),
});

export type SocialConversationParticipant = z.infer<
  typeof SocialConversationParticipantSchema
>;

export const SocialConversationPreviewSchema = z.object({
  id: z.number().int().positive(),
  conversation_kind: SocialConversationKindSchema,
  title: z.string().nullable().optional(),
  display_title: z.string(),
  avatar_url: z.string().nullable().optional(),
  member_count: z.number().int().nonnegative(),
  unread_count: z.number().int().nonnegative(),
  last_message_id: z.number().int().positive().nullable().optional(),
  last_message_preview: z.string().nullable().optional(),
  last_message_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  notifications_muted: z.boolean().optional(),
  participants: z.array(SocialConversationParticipantSchema),
});

export type SocialConversationPreview = z.infer<
  typeof SocialConversationPreviewSchema
>;

export const SocialConversationMessageMediaSchema = z.object({
  id: z.number().int().positive(),
  media_kind: z.literal("image"),
  public_url: z.string(),
  created_at: z.string(),
});

export type SocialConversationMessageMedia = z.infer<
  typeof SocialConversationMessageMediaSchema
>;

export const SocialConversationMessageSchema = z.object({
  id: z.number().int().positive(),
  conversation_id: z.number().int().positive(),
  sender_user_id: z.string(),
  sender_username: z.string(),
  sender_full_name: z.string(),
  sender_avatar_url: z.string().nullable().optional(),
  message_text: z.string(),
  message_kind: SocialConversationMessageKindSchema,
  media: SocialConversationMessageMediaSchema.nullable().optional(),
  created_at: z.string(),
  edited_at: z.string().nullable().optional(),
  is_own_message: z.boolean(),
});

export type SocialConversationMessage = z.infer<
  typeof SocialConversationMessageSchema
>;

export const SocialConversationMessagesResponseSchema = z.object({
  conversation: SocialConversationPreviewSchema,
  messages: z.array(SocialConversationMessageSchema),
});

export type SocialConversationMessagesResponse = z.infer<
  typeof SocialConversationMessagesResponseSchema
>;

export const SocialDirectConversationRequestSchema = z.object({
  friend_user_id: z.string().trim().min(1).max(120),
});

export type SocialDirectConversationRequest = z.infer<
  typeof SocialDirectConversationRequestSchema
>;

export const SocialGroupConversationRequestSchema = z.object({
  title: z.string().trim().min(2).max(80),
  member_user_ids: z.array(z.string().trim().min(1).max(120)).min(2).max(20),
});

export type SocialGroupConversationRequest = z.infer<
  typeof SocialGroupConversationRequestSchema
>;

export const SocialConversationMessageRequestSchema = z.object({
  message_text: z.string().trim().min(1).max(2000),
});

export type SocialConversationMessageRequest = z.infer<
  typeof SocialConversationMessageRequestSchema
>;

export const SocialConversationMessageUpdateRequestSchema = z.object({
  message_text: z.string().trim().min(1).max(2000),
});

export type SocialConversationMessageUpdateRequest = z.infer<
  typeof SocialConversationMessageUpdateRequestSchema
>;

export const SocialConversationReadRequestSchema = z.object({
  last_read_message_id: z.number().int().positive().optional(),
});

export type SocialConversationReadRequest = z.infer<
  typeof SocialConversationReadRequestSchema
>;

export const SocialConversationMuteRequestSchema = z.object({
  muted: z.boolean(),
});

export type SocialConversationMuteRequest = z.infer<
  typeof SocialConversationMuteRequestSchema
>;

export const SocialUserPreferencesSchema = z.object({
  show_online_status: z.boolean(),
  allow_friend_requests: z.boolean(),
  allow_group_invites: z.boolean(),
});

export type SocialUserPreferences = z.infer<
  typeof SocialUserPreferencesSchema
>;

export const SocialUserPreferencesUpdateRequestSchema =
  SocialUserPreferencesSchema;

export type SocialUserPreferencesUpdateRequest = z.infer<
  typeof SocialUserPreferencesUpdateRequestSchema
>;

export const SocialHubFriendItemSchema = z.object({
  id: z.number().int().positive(),
  friend_user_id: z.string(),
  friend_username: z.string(),
  friend_full_name: z.string(),
  friend_avatar_url: z.string().nullable().optional(),
  friend_level: z.number().int().nonnegative(),
  friend_xp: z.number().nonnegative(),
  friend_streak: z.number().int().nonnegative(),
  is_online: z.boolean().optional(),
  last_heartbeat_at: z.string().nullable().optional(),
  direct_conversation_id: z.number().int().positive().nullable().optional(),
  unread_count: z.number().int().nonnegative(),
  last_message_preview: z.string().nullable().optional(),
  last_message_at: z.string().nullable().optional(),
  notifications_muted: z.boolean().optional(),
});

export type SocialHubFriendItem = z.infer<
  typeof SocialHubFriendItemSchema
>;

export const SocialHubFriendRequestSchema = z.object({
  id: z.number().int().positive(),
  friend_user_id: z.string(),
  friend_username: z.string(),
  friend_full_name: z.string(),
  friend_avatar_url: z.string().nullable().optional(),
  friend_level: z.number().int().nonnegative(),
  friend_xp: z.number().nonnegative(),
  friend_streak: z.number().int().nonnegative(),
  created_at: z.string(),
});

export type SocialHubFriendRequest = z.infer<
  typeof SocialHubFriendRequestSchema
>;

export const SocialHubBundleSchema = z.object({
  friends: z.array(SocialHubFriendItemSchema),
  pending_requests: z.array(SocialHubFriendRequestSchema),
  groups: z.array(SocialConversationPreviewSchema),
  preferences: SocialUserPreferencesSchema,
});

export type SocialHubBundle = z.infer<typeof SocialHubBundleSchema>;

export const SocialConversationMessageMutationResponseSchema = z.object({
  conversation: SocialConversationPreviewSchema.nullable().optional(),
  message: SocialConversationMessageSchema.optional(),
  deleted_message_id: z.number().int().positive().optional(),
});

export type SocialConversationMessageMutationResponse = z.infer<
  typeof SocialConversationMessageMutationResponseSchema
>;

export const SocialChatNotificationSchema = z.object({
  conversation_id: z.number().int().positive(),
  conversation_kind: SocialConversationKindSchema,
  conversation_title: z.string(),
  message_id: z.number().int().positive(),
  message_text: z.string(),
  sender_user_id: z.string(),
  sender_username: z.string(),
  sender_full_name: z.string(),
  sender_avatar_url: z.string().nullable().optional(),
  created_at: z.string(),
});

export type SocialChatNotification = z.infer<
  typeof SocialChatNotificationSchema
>;

export const SocialUnreadConversationSummarySchema = z.object({
  conversation_id: z.number().int().positive(),
  unread_count: z.number().int().nonnegative(),
  direct_peer_user_id: z.string().nullable().optional(),
});

export type SocialUnreadConversationSummary = z.infer<
  typeof SocialUnreadConversationSummarySchema
>;

export const SocialUnreadSummarySchema = z.object({
  total_unread_count: z.number().int().nonnegative(),
  conversations: z.array(SocialUnreadConversationSummarySchema),
});

export type SocialUnreadSummary = z.infer<typeof SocialUnreadSummarySchema>;

export const ConsumeSocialChatNotificationsRequestSchema = z.object({
  items: z.array(
    z.object({
      conversation_id: z.number().int().positive(),
      message_id: z.number().int().positive(),
    }),
  ).max(25),
});

export type ConsumeSocialChatNotificationsRequest = z.infer<
  typeof ConsumeSocialChatNotificationsRequestSchema
>;

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
export const OnboardingProfileSeedRequestSchema = z.object({
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
});

export type OnboardingProfileSeedRequest = z.infer<typeof OnboardingProfileSeedRequestSchema>;

export const OnboardingRequestSchema = OnboardingProfileSeedRequestSchema.extend({
  plan_id: z.enum(["basic", "pro", "annual"]),
  payment_method: z.enum(["card", "pix"]),
  card_number: z.string().min(8).max(32).optional(),
  card_holder_name: z.string().min(1).max(120).optional(),
  card_expiry: z.string().min(3).max(8).optional(),
  promo_code: z.string().trim().min(1).max(128).optional(),
});

export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;

// Complete Mission Request Schema
const OptionalMissionMetricInputSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return value;
}, z.number().finite().min(0).optional());

export const CompleteMissionRequestSchema = z.object({
  mission_id: z.coerce.number().int().positive(),
  reps_completed: OptionalMissionMetricInputSchema,
  time_completed: OptionalMissionMetricInputSchema,
  metric_completed: OptionalMissionMetricInputSchema,
  sensor_verified: z.boolean(),
  operation_id: z.string().trim().min(8).max(128).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
});

export type CompleteMissionRequest = z.infer<typeof CompleteMissionRequestSchema>;

export const OfflineOperationTypeSchema = z.enum([
  "mission_completed",
  "achievement_triggered",
  "step_delta_recorded",
  "calorie_delta_recorded",
  "distance_delta_recorded",
]);

export type OfflineOperationType = z.infer<typeof OfflineOperationTypeSchema>;

export const OfflineOperationSourceSchema = z.enum([
  "android-native",
  "browser",
]);

export type OfflineOperationSource = z.infer<typeof OfflineOperationSourceSchema>;

export const OfflineOperationConfidenceSchema = z.enum([
  "official",
  "derived",
]);

export type OfflineOperationConfidence = z.infer<typeof OfflineOperationConfidenceSchema>;

const OfflineMetricDeltaPayloadSchema = z.object({
  delta: z.number().finite().min(0),
  total_after_delta: z.number().finite().min(0).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const StepDeltaRecordedOperationSchema = z.object({
  operation_id: z.string().trim().min(8).max(128),
  type: z.literal("step_delta_recorded"),
  user_id: z.string().trim().min(1).max(128).optional(),
  occurred_at: z.string().datetime({ offset: true }),
  source: OfflineOperationSourceSchema,
  confidence: OfflineOperationConfidenceSchema,
  payload: OfflineMetricDeltaPayloadSchema,
});

export type StepDeltaRecordedOperation = z.infer<typeof StepDeltaRecordedOperationSchema>;

export const CalorieDeltaRecordedOperationSchema = z.object({
  operation_id: z.string().trim().min(8).max(128),
  type: z.literal("calorie_delta_recorded"),
  user_id: z.string().trim().min(1).max(128).optional(),
  occurred_at: z.string().datetime({ offset: true }),
  source: OfflineOperationSourceSchema,
  confidence: OfflineOperationConfidenceSchema,
  payload: OfflineMetricDeltaPayloadSchema,
});

export type CalorieDeltaRecordedOperation = z.infer<typeof CalorieDeltaRecordedOperationSchema>;

export const DistanceDeltaRecordedOperationSchema = z.object({
  operation_id: z.string().trim().min(8).max(128),
  type: z.literal("distance_delta_recorded"),
  user_id: z.string().trim().min(1).max(128).optional(),
  occurred_at: z.string().datetime({ offset: true }),
  source: OfflineOperationSourceSchema,
  confidence: OfflineOperationConfidenceSchema,
  payload: OfflineMetricDeltaPayloadSchema,
});

export type DistanceDeltaRecordedOperation = z.infer<typeof DistanceDeltaRecordedOperationSchema>;

export const AchievementTriggeredOperationSchema = z.object({
  operation_id: z.string().trim().min(8).max(128),
  type: z.literal("achievement_triggered"),
  user_id: z.string().trim().min(1).max(128).optional(),
  occurred_at: z.string().datetime({ offset: true }),
  source: OfflineOperationSourceSchema,
  confidence: OfflineOperationConfidenceSchema.optional(),
  payload: z.object({
    achievement_name: z.string().trim().min(1).max(160),
    progress_current: z.number().finite().min(0).optional(),
    progress_required: z.number().finite().min(0).optional(),
  }).passthrough(),
});

export type AchievementTriggeredOperation = z.infer<typeof AchievementTriggeredOperationSchema>;

export const OfflineSyncOperationSchema = z.discriminatedUnion("type", [
  StepDeltaRecordedOperationSchema,
  CalorieDeltaRecordedOperationSchema,
  DistanceDeltaRecordedOperationSchema,
  AchievementTriggeredOperationSchema,
]);

export type OfflineSyncOperation = z.infer<typeof OfflineSyncOperationSchema>;

export const OfflineSyncRequestSchema = z.object({
  operations: z.array(OfflineSyncOperationSchema).min(1).max(100),
});

export type OfflineSyncRequest = z.infer<typeof OfflineSyncRequestSchema>;

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
  distance_meters: z.number().min(0),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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
  image_mime_type: z.string().optional(),
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
  email: z.string().trim().email(),
  password: z.string().min(8),
});
export type AuthRegisterRequest = z.infer<typeof AuthRegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().trim().email(),
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

export const UpdateUserAvatarRequestSchema = z.object({
  image_base64: z.string().trim().min(1),
  image_mime_type: z.string().trim().min(1),
});
export type UpdateUserAvatarRequest = z.infer<typeof UpdateUserAvatarRequestSchema>;

// Training Rank Profile (input para cálculo)
export interface TrainingRankProfile {
  /** Dados de volume (derivados de UserProgression) */
  xp: number;
  level: number;
  totalSessions: number;
  activeWeeks: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate?: string | null;
  latestBenchmarkDate?: string | null;
  /** Dados de skills (derivados de UserSkill) */
  unlockedSkills: number;
  unlockedSkillStages: number;
  totalSkillReps: number;
  /** Dados de benchmarks (opcionais) */
  benchmarkResults?: {
    pushUpMaxReps?: number;
    squatMaxReps?: number;
    plankMaxSeconds?: number;
    sitUpMaxReps?: number;
    pullUpMaxReps?: number;
    runDistanceKm?: number;
    runTimeSeconds?: number;
  };
}
