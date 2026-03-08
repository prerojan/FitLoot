-- Mission details schema expansion for typed goals and rich execution data

ALTER TABLE missions ADD COLUMN metric_type TEXT DEFAULT 'repetitions';
ALTER TABLE missions ADD COLUMN metric_value INTEGER DEFAULT 20;
ALTER TABLE missions ADD COLUMN metric_unit TEXT DEFAULT 'repetições';
ALTER TABLE missions ADD COLUMN sets INTEGER;
ALTER TABLE missions ADD COLUMN rest_seconds INTEGER;
ALTER TABLE missions ADD COLUMN instructions_json TEXT DEFAULT '[]';
ALTER TABLE missions ADD COLUMN image_url TEXT;
ALTER TABLE missions ADD COLUMN muscle_groups_json TEXT DEFAULT '[]';
ALTER TABLE missions ADD COLUMN exercise_type TEXT DEFAULT 'forca';
ALTER TABLE missions ADD COLUMN body_area TEXT DEFAULT 'full_body';
ALTER TABLE missions ADD COLUMN attributes_benefited_json TEXT DEFAULT '[]';
ALTER TABLE missions ADD COLUMN duration_estimate_minutes INTEGER DEFAULT 10;
ALTER TABLE missions ADD COLUMN exercise_category TEXT DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_missions_metric_type ON missions(metric_type);
CREATE INDEX IF NOT EXISTS idx_missions_body_area ON missions(body_area);
