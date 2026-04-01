# MCP Applied Migration Manifest (2026-03-31)

Estas migrations foram aplicadas diretamente via Supabase MCP no projeto `bjsqqofrneuncnerjoqh`:

1. `0001_environment_foundation`
2. `0002_domain_tables_and_indexes`
3. `0003_rls_and_compatibility_views`
4. `0004_fix_function_search_path`
5. `0005_fk_covering_indexes`
6. `0006_social_online_presence`
7. `0007_catalog_reward_parity_and_notifications` (2026-04-01)
8. `0008_sqlite_datetime_compat` (2026-04-01)

Validação pós-aplicação:

- `list_migrations`: todas registradas
- `list_tables`: schemas de domínio criados com RLS habilitado
- `security advisors`: sem lints
- `performance advisors`: sem FKs sem índice

Referência de arquitetura e decisões:

- `docs/supabase/initial_environment_preparation.md`
- `docs/supabase/pre_migration_data_quality_checks.sql`
- `docs/supabase/clean_base_cutover_runbook.md`
