export type MissionRetentionPeriod = "daily" | "weekly" | "monthly";

export const SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD: Record<
  MissionRetentionPeriod,
  string
> = {
  daily: "-5 minutes",
  weekly: "-5 minutes",
  monthly: "-5 minutes",
};

export const SETTLED_MISSION_RETENTION_MS_BY_PERIOD: Record<
  MissionRetentionPeriod,
  number
> = {
  daily: 5 * 60_000,
  weekly: 5 * 60_000,
  monthly: 5 * 60_000,
};

export const DEFAULT_SETTLED_MISSION_RETENTION_MODIFIER =
  SETTLED_MISSION_RETENTION_MODIFIER_BY_PERIOD.monthly;
