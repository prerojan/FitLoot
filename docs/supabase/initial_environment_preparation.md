# Preparacao Inicial de Ambiente Supabase (2026-03-31)

## Objetivo

Preparar o Supabase para receber a estrutura atual do FitLoot (hoje em Cloudflare D1), com separacao por dominios, camada de compatibilidade e seguranca para migracao incremental sem quebrar a logica do app.

## Base de analise usada

- `docs/architecture/project-structure-map.md`
- `docs/audits/2026-03-28-structure-audit.md`
- Inventario real do D1 de producao (`fitloot-db`) via `wrangler d1 execute`
- Mapeamento real de uso de tabelas por `src/worker/routes/*` e `src/worker/services/*`

## Decisao de arquitetura

Em vez de "um banco por tabela", foi adotado isolamento por dominios em schemas no mesmo Postgres/Supabase:

- `core`
- `social`
- `catalog`
- `missions`
- `gameplay`
- `billing`
- `telemetry`
- `ai`
- `compat`

Isso mantem consistencia transacional e evita quebrar joins e fluxos do Worker.

## O que ja foi aplicado no Supabase

Migrations aplicadas:

1. `0001_environment_foundation`
2. `0002_domain_tables_and_indexes`
3. `0003_rls_and_compatibility_views`
4. `0004_fix_function_search_path`
5. `0005_fk_covering_indexes`
6. `0006_social_online_presence`
7. `0007_catalog_reward_parity_and_notifications`
8. `0008_sqlite_datetime_compat`

Estado validado:

- Todas as tabelas principais criadas por dominio
- RLS habilitado nas tabelas
- Policies de `service_role` aplicadas
- Camada de views de compatibilidade criada em `compat.*`
- Camada social online criada (`social.user_presence`, `social.friend_activity_events`, `social.friend_online_presence`)
- Security Advisor sem lints pendentes
- Performance Advisor sem alertas de FK sem indice

## Nota sobre visualizacao no Supabase Studio

Se o dashboard mostrar apenas migrations e "nenhuma tabela", normalmente o filtro de schema esta em `public`.
Para ver a estrutura completa do projeto, selecione `All schemas` ou cada dominio manualmente:
`core`, `social`, `catalog`, `missions`, `gameplay`, `billing`, `telemetry`, `compat`.

## Compatibilidade para migracao gradual

Foi criada camada de views `compat` com nomes legados (`compat.users`, `compat.missions`, etc.).
Isso permite migracao incremental do acesso SQL do Worker sem exigir rename imediato de toda query.

## Melhorias estruturais incorporadas

- `mission_generation_jobs` e demais estruturas sensiveis agora sao schema-managed (sem DDL em runtime)
- FKs e indices criticos adicionados para integridade/performance
- `plan_id` padronizado para `basic/pro/annual/vip` no schema novo
- Triggers de `updated_at` padronizadas
- Presenca online desacoplada de `user_progression.last_activity_date`
- Politicas RLS para visibilidade de presenca por amizade (`friends/private/public`)
- Adapter de banco com `DB_BACKEND` e transacao real (sem no-op)
- Compatibilidade de `datetime(...)` SQLite no Postgres via `compat.datetime(...)`

## Pontos fracos detectados no legado (D1/Worker)

1. SQL legado muito extenso e acoplado a sintaxe SQLite (coberto por camada compativel durante o cutover).
2. Drift historico entre migrations antigas e estado real de producao no D1.
3. Dados historicos de usuario/missoes com inconsistencias e duplicidade (motivo da estrategia de base limpa).

## Seguranca de segredos

- Varredura local para padroes sensiveis (`sb_secret_`, `sb_publishable_`, JWT de service role, etc.).
- Segredos restritos a ambiente server-side (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`).
- Recomendacao obrigatoria: nunca expor `service_role` no frontend.

## Proxima etapa recomendada

1. Deploy 1 com adapter dual-path e `DB_BACKEND=d1`.
2. Deploy 2 com migrations + bootstrap + import seletivo de `promo_codes`.
3. Deploy 3 ativando `DB_BACKEND=supabase` e executando smoke end-to-end.
4. Deploy 4 removendo fallback D1 apos janela de rollback curto.
