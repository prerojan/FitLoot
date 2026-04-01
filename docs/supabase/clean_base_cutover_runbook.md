# Supabase Cutover Runbook (Base Limpa)

## Objetivo

Executar o cutover para Supabase com banco limpo, sem historico de usuario, mantendo contratos HTTP e logica de negocio do app.

## Pre-requisitos

- `DB_BACKEND=d1` no Worker para baseline.
- `SUPABASE_DB_URL` disponivel no ambiente local para scripts de preparacao.
- `SUPABASE_SERVICE_ROLE_KEY` e demais segredos somente no ambiente server-side.

## Como visualizar os dominios no Dashboard

- No Supabase Studio, abra `Database -> Tables`.
- Troque o filtro de schema para `All schemas` (ou selecione manualmente `core`, `social`, `catalog`, `missions`, `gameplay`, `billing`, `telemetry`, `compat`).
- Se o filtro ficar apenas em `public`, as tabelas de dominio nao aparecem.

## Sequencia operacional

1. **Paridade de schema Supabase**
- Migration aplicada: `0007_catalog_reward_parity_and_notifications`
- Migration aplicada: `0008_sqlite_datetime_compat`
- Inclui:
- `catalog.achievements`: `xp_reward`, `points_reward`
- `catalog.titles`: `xp_reward`, `points_reward`
- `gameplay.user_reward_notifications`
- views `compat.achievements`, `compat.titles`, `compat.user_reward_notifications`
- funcoes `compat.datetime(...)` para compatibilidade de SQL legado em runtime

2. **Limpeza da base user-bound**
- Comando:
- `npm run supabase:reset-clean-base`
- Remove dados de: `core.*` (user/session), `missions.*`, `gameplay.user_*`, `social.*`, `billing.*` historico, `telemetry.*`, `app_state`.

3. **Bootstrap de catalogo por seed**
- Comando:
- `npm run supabase:bootstrap-catalog`
- Fonte de verdade:
- `src/worker/services/gamification/*.ts`
- `src/shared/coreSkillSeeds.ts`
- Normalizacao de encoding aplicada durante o seed.

4. **Import seletivo de promo codes**
- Comando:
- `npm run supabase:import-promo-codes`
- Importa somente `catalog.promo_codes` com upsert por `code`.
- Nao migra `promo_code_usages`, `subscriptions`, `cakto_webhook_events`.

5. **Verificacao de base limpa**
- Comando:
- `npm run supabase:verify-clean-base`
- Esperado: tabelas user-bound em `0`.

## Scripts adicionados

- `scripts/supabase/reset-clean-base.mjs`
- `scripts/supabase/bootstrap-catalog.mjs`
- `scripts/supabase/import-promo-codes-from-d1.mjs`
- `scripts/supabase/verify-clean-base.mjs`
- `scripts/supabase/generate-catalog-seed-sql.mjs`

## Seguranca de segredos

- Nao commitar tokens/chaves.
- Nao usar `service_role` no frontend.
- Variaveis sensiveis devem existir apenas como secret no Worker.
- Static checks incluem varredura para padroes comuns de segredo (`scripts/static-checks.mjs`).

## Observacao de cutover

- O runtime suporta `DB_BACKEND=supabase` com camada de compatibilidade `prepare/bind/first/all/run`.
- Por seguranca operacional, manter `DB_BACKEND=d1` no baseline e ativar `supabase` por flag em deploy controlado.
- `withTransaction` deixou de ser no-op e agora usa transacao com savepoint quando suportado.
