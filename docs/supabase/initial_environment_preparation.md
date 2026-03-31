# Preparação Inicial de Ambiente Supabase (2026-03-31)

## Objetivo

Preparar o Supabase para receber a estrutura atual do FitLoot (hoje em Cloudflare D1), com separação por domínios, camada de compatibilidade e segurança para migração incremental sem quebrar a lógica do app.

## Base de análise usada

- `docs/architecture/project-structure-map.md`
- `docs/audits/2026-03-28-structure-audit.md`
- Inventário real do D1 de produção (`fitloot-db`) via `wrangler d1 execute`
- Mapeamento real de uso de tabelas por `src/worker/routes/*` e `src/worker/services/*`

## Decisão de arquitetura

Em vez de "um banco por tabela", foi adotado isolamento por **domínios em schemas** no mesmo Postgres/Supabase:

- `core`
- `social`
- `catalog`
- `missions`
- `gameplay`
- `billing`
- `telemetry`
- `ai`
- `compat`

Isso mantém consistência transacional e evita quebrar joins e fluxos do Worker.

## O que já foi aplicado no Supabase

Migrations aplicadas:

1. `0001_environment_foundation`
2. `0002_domain_tables_and_indexes`
3. `0003_rls_and_compatibility_views`
4. `0004_fix_function_search_path`
5. `0005_fk_covering_indexes`
6. `0006_social_online_presence`

Estado validado:

- Todas as tabelas principais criadas por domínio
- RLS habilitado nas tabelas
- Policies de `service_role` aplicadas
- Camada de views de compatibilidade criada em `compat.*`
- Camada social online criada (`social.user_presence`, `social.friend_activity_events`, `social.friend_online_presence`)
- Security Advisor sem lints pendentes
- Performance Advisor sem alertas de FK sem índice

## Compatibilidade para migração gradual

Foi criada camada de views `compat` com nomes legados (`compat.users`, `compat.missions`, etc.).  
Isso permite migração incremental do acesso SQL do Worker sem exigir rename imediato de toda query.

## Melhorias estruturais já incorporadas

- `mission_generation_jobs` agora é schema-managed (não depende mais de `CREATE TABLE` em runtime)
- FKs e índices críticos adicionados para integridade/performance
- `plan_id` padronizado para `basic/pro/annual/vip` no schema novo
- Triggers de `updated_at` padronizadas
- Presença online desacoplada de `user_progression.last_activity_date`
- Políticas RLS para visibilidade de presença por amizade (`friends/private/public`)

## Pontos fracos detectados no legado (D1/Worker) e pendências

1. `withTransaction` no Worker ainda é no-op (`src/worker/index.ts`) e precisa de implementação real no adaptador Postgres.
2. `USER_PURGE_TARGETS` ainda não inclui `mission_generation_jobs`.
3. Existem sinais de drift histórico entre migrations e estado real do D1 (ex.: tabelas legadas criadas fora de migration em versões anteriores).
4. No D1 de produção, havia `plan_id = 'free'` em histórico; no Supabase novo isso já foi bloqueado por constraint.

## Segurança de segredos

- Foi feita varredura local para padrões sensíveis (`sb_secret_`, `sb_publishable_`, JWT de service role, etc.).
- Nenhum segredo foi encontrado em arquivos do projeto.
- Recomendação mantida: usar apenas variáveis de ambiente server-side para `service_role` e nunca expor em frontend.

## Próxima etapa recomendada (migração de dados)

1. Executar pre-checks de qualidade no D1.
2. Exportar por domínio (ordem: `core` -> `catalog` -> `missions/gameplay` -> `billing/telemetry/social`).
3. Importar no Supabase preservando IDs.
4. Rodar reconciliação (órfãos, contadores, planos).
5. Fazer cutover do Worker por feature flag (primeiro leitura, depois escrita).

## Próxima etapa recomendada (friends online)

1. Adicionar heartbeat no backend (`/api/friends/presence/heartbeat`) escrevendo em `social.user_presence`.
2. Atualizar `GET /api/friends` para usar presença em tempo real da tabela nova, com fallback para lógica antiga.
3. Registrar eventos sociais em `social.friend_activity_events` (accept, remove, challenge).
4. Evoluir a aba "Pedidos enviados" com endpoint dedicado e feed social baseado em eventos.
