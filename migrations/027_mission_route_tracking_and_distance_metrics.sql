ALTER TABLE missions.missions ADD COLUMN execution_mode TEXT DEFAULT 'standard';
ALTER TABLE missions.missions ADD COLUMN activity_kind TEXT;

ALTER TABLE telemetry.daily_metrics ADD COLUMN distance_meters INTEGER NOT NULL DEFAULT 0;

ALTER TABLE gameplay.user_monthly_counters ADD COLUMN steps INTEGER NOT NULL DEFAULT 0;

UPDATE missions.missions
SET
  execution_mode = COALESCE(execution_mode, 'standard'),
  activity_kind = CASE
    WHEN activity_kind IN ('walking', 'running') THEN activity_kind
    ELSE NULL
  END;

UPDATE telemetry.daily_metrics
SET distance_meters = COALESCE(distance_meters, 0);

UPDATE gameplay.user_monthly_counters
SET steps = COALESCE(steps, 0);
