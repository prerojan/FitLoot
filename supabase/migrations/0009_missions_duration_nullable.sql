-- Keep parity with Worker mission payloads: daily and circuit-like missions can
-- legitimately omit a duration estimate.
ALTER TABLE missions.missions
  ALTER COLUMN duration_estimate_minutes DROP NOT NULL;

ALTER TABLE missions.missions
  ALTER COLUMN duration_estimate_minutes SET DEFAULT 10;
