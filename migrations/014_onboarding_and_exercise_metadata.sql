-- Onboarding persistence expansion + ExerciseDB mission metadata

ALTER TABLE user_profiles ADD COLUMN age INTEGER;
ALTER TABLE user_profiles ADD COLUMN gender TEXT;
ALTER TABLE user_profiles ADD COLUMN goals_json TEXT DEFAULT '[]';

ALTER TABLE users ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'none';

ALTER TABLE missions ADD COLUMN exercise_name TEXT;
ALTER TABLE missions ADD COLUMN exercise_equipment TEXT;
ALTER TABLE missions ADD COLUMN exercise_body_part TEXT;
ALTER TABLE missions ADD COLUMN exercise_target TEXT;
ALTER TABLE missions ADD COLUMN exercise_secondary_muscles_json TEXT DEFAULT '[]';
ALTER TABLE missions ADD COLUMN exercise_instructions_en_json TEXT DEFAULT '[]';
ALTER TABLE missions ADD COLUMN exercise_instructions_pt_json TEXT DEFAULT '[]';
ALTER TABLE missions ADD COLUMN exercise_db_gif_url TEXT;
ALTER TABLE missions ADD COLUMN exercise_db_image_url TEXT;
