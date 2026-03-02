-- Flag para indicar que o usuário concluiu o onboarding (etapa de plano)
ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0;
