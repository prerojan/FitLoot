-- Garante colunas de auth por senha em users (caso a tabela já existia antes da 002)
-- Se as colunas já existirem, esta migration falhará com "duplicate column";
-- nesse caso o banco já está correto e pode marcar como aplicada manualmente se necessário.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
