-- Mission origin, weekly circuit tasks and richer execution details

ALTER TABLE missions ADD COLUMN mission_origin TEXT DEFAULT 'regular';
ALTER TABLE missions ADD COLUMN circuit_tasks_json TEXT DEFAULT '[]';
ALTER TABLE missions ADD COLUMN safety_tips_json TEXT DEFAULT '[]';
ALTER TABLE missions ADD COLUMN difficulty_level TEXT;
ALTER TABLE missions ADD COLUMN video_url TEXT;
ALTER TABLE missions ADD COLUMN thumbnail_url TEXT;

UPDATE missions
SET mission_origin = 'regular'
WHERE mission_origin IS NULL OR TRIM(mission_origin) = '';

CREATE INDEX IF NOT EXISTS idx_missions_origin ON missions(mission_origin);
CREATE INDEX IF NOT EXISTS idx_missions_type_origin ON missions(type, mission_origin);
