# Auditoria Completa de Migracao D1 -> Supabase (2026-04-01)

## Escopo auditado

- Estrutura real do D1 de producao (`fitloot-db`) via Cloudflare API (schema, tabelas, indices, volumetria).
- Estrutura real do Supabase do projeto `bjsqqofrneuncnerjoqh` via MCP (migrations, tabelas por dominio, RLS, advisors).
- Fluxo do Worker (`src/worker`) com foco em compatibilidade SQL e seguranca durante cutover.

## Estado atual do Supabase

- Migrations registradas:
  - `0001_environment_foundation`
  - `0002_domain_tables_and_indexes`
  - `0003_rls_and_compatibility_views`
  - `0004_fix_function_search_path`
  - `0005_fk_covering_indexes`
  - `0006_social_online_presence`
  - `0007_catalog_reward_parity_and_notifications`
  - `0008_sqlite_datetime_compat`
- Schemas por dominio ativos: `core`, `social`, `catalog`, `missions`, `gameplay`, `billing`, `telemetry`, `compat`.
- RLS habilitado nas tabelas de dominio.
- Camada de compatibilidade ativa (`compat.*`) para manter SQL legado sem quebrar contrato HTTP.
- Base limpa confirmada para tabelas user-bound.
- Catalogo seeded no Supabase:
  - `catalog.skills = 49`
  - `catalog.skill_stages = 84`
  - `catalog.titles = 22`
  - `catalog.achievements = 75`
  - `catalog.promo_codes = 1` (import seletivo legado)

## Inventario D1 legado (producao)

### Tabelas principais e volumetria observada

- `users = 20`
- `missions = 274`
- `mission_subtasks = 139`
- `user_event_log = 1318`
- `user_skills = 106`
- `user_achievements = 52`
- `user_titles = 16`
- `subscriptions = 12`
- `promo_code_usages = 12`
- `cakto_webhook_events = 5`
- `friend_requests = 4`
- `friendships = 2`
- `promo_codes = 1`

### Tabelas vazias, mas ainda acopladas ao app

- `coupon_orders`, `shop_partners`, `shop_products`, `physical_benchmarks`, `progress_snapshots`, `magic_link_tokens`, `user_sessions`.

## Pontos fracos estruturais encontrados

1. Drift de schema legado em relacao ao dominio atual:
- `users.plan_id` no D1 ainda com default legado `free` (app hoje opera em `basic/pro/annual/vip`).

2. Tipagem inconsistente no legado:
- `user_sessions.user_id` no D1 esta como `INTEGER` enquanto `users.id` e `TEXT` (risco de integridade e joins inconsistentes).

3. Catalogo legado com divergencia de cardinalidade:
- D1: `skills=51`, `titles=26`, `achievements=99`.
- Supabase seed limpo: `skills=49`, `titles=22`, `achievements=75`.
- Evidencia de duplicidade/ruido de dados no legado (esperado pelo contexto do projeto).

4. Historico comercial e de missao com risco de qualidade:
- `subscriptions`, `promo_code_usages`, `mission_generation_jobs`, `missions` e tabelas user-bound contem dados com historico parcialmente inconsistente.
- Recomendacao validada: nao migrar dados pessoais/historicos nesta fase.

5. SQL legado fortemente orientado a SQLite:
- Uso amplo de `datetime('now')`, `INSERT OR IGNORE`, `MAX(a,b)`, etc.
- Mitigado no Supabase por camada de compatibilidade:
  - `compat.datetime(...)`
  - reescrita de `INSERT OR IGNORE` no adapter
  - mapeamento de `MAX(a,b)` para `GREATEST(a,b)` no adapter

## Auditoria do Worker (funcionamento e risco de quebra)

- Backend dual-path implementado (`DB_BACKEND=d1|supabase`) com fallback.
- `SupabaseCompatDatabase` emula API D1 (`prepare/bind/first/all/run`), preservando rotas e payloads.
- `withTransaction` agora usa transacao real (savepoint/rollback) no backend supabase.
- `ensureMissionJobSchema` removido como DDL runtime (apenas health-check de tabela).
- Queries legadas mantidas sem alteracao de contrato HTTP; resolvidas por `search_path=compat,public`.

## Seguranca e isolamento de credenciais

- Chaves sensiveis mantidas server-side (`SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- Sem uso de `service_role` no frontend.
- Varredura de segredo no repositório (`scripts/static-checks.mjs`) cobrindo padroes `sb_secret_` e JWT service-role.
- URL de banco configurada em ambiente de usuario, nao em arquivo versionado.

## Plano de refatoracao/adaptacao (status)

1. Paridade de schema Supabase
- Status: concluido.
- Evidencia: migrations `0007` e `0008`, `user_reward_notifications`, views `compat` atualizadas.

2. Politica de base limpa (sem migrar historico de usuario)
- Status: concluido.
- Evidencia: `reset-clean-base` + `verify-clean-base`.

3. Adapter estrutural de banco (sem gambiarra de rota)
- Status: concluido.
- Evidencia: `dbAdapter.ts` + `supabaseCompatDb.ts` + bootstrap no `index.ts`.

4. Bootstrap de catalogo e import seletivo
- Status: concluido.
- Evidencia: scripts `bootstrap-catalog`, `import-promo-codes`.

5. Cutover faseado com rollback por flag
- Status: pronto para operacao controlada.
- Evidencia: `DB_BACKEND` por variavel e runbook de cutover.

6. Hardening de segredos
- Status: concluido no codigo e ambiente local.
- Evidencia: sem segredo no frontend/repo e checagens estaticas de segredo.

## Checklist de aceite operacional

- Build/lint/teste local do projeto: verde.
- Supabase com schemas/tabelas de dominio e RLS: valido.
- Base limpa de user-bound: valida.
- Catalogo seedado e promo code legado importado: valido.
- Contratos HTTP do frontend preservados: sem mudanca de assinatura de rota.

## Riscos residuais (controlados)

1. Para deploy em producao com `DB_BACKEND=supabase`, e obrigatorio validar `SUPABASE_DB_URL` como secret do Worker em todos os ambientes.
2. Em `wrangler dev --local`, o backend `supabase` apresentou `Connection terminated unexpectedly` ao abrir conexao Postgres no runtime do Worker local (scripts Node e MCP continuam funcionais). Necessario validar canario em ambiente Cloudflare real antes do cutover definitivo ou adotar Hyperdrive para conexao Postgres.
3. Advisors de performance listam indices "unused" em base vazia; nao remover indices antes de observar carga real.
4. O fallback D1 deve permanecer durante janela curta de rollback, depois ser removido no hardening final.
