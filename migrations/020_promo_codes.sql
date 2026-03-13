CREATE TABLE promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  effect TEXT NOT NULL,
  effect_value TEXT,
  max_uses INTEGER,
  uses_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_promo_codes_code_nocase
ON promo_codes(UPPER(code));

CREATE INDEX idx_promo_codes_active_expires
ON promo_codes(active, expires_at);

CREATE TABLE promo_code_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_code_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  subscription_id TEXT,
  applied_effect TEXT NOT NULL,
  applied_value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(promo_code_id, user_id)
);

CREATE INDEX idx_promo_code_usages_user
ON promo_code_usages(user_id);

CREATE INDEX idx_promo_code_usages_subscription
ON promo_code_usages(subscription_id);

INSERT INTO promo_codes (code, description, effect, active)
VALUES ('maderaaichefe', 'Ativação VIP', 'activate_vip', 1);
