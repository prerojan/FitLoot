export type MissionRetentionPeriod = "daily" | "weekly" | "monthly";

export const SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD: Record<
  MissionRetentionPeriod,
  string
> = {
  daily: "-5 minutes",
  weekly: "-7 days",
  monthly: "-30 days",
};

export const DEFAULT_SETTLED_MISSION_RETENTION_MODIFIER =
  SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.monthly;

