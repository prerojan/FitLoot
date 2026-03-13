-- Plan fields for users (subscription)
ALTER TABLE users ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE users ADD COLUMN plan_status TEXT NOT NULL DEFAULT 'active';
