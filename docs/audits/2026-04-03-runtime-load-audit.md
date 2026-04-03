# Auditoria Completa de Fluxo e Carga - 2026-04-03

## Escopo

- Frontend (`src/react-app`) com foco em duplicidade de chamadas `/api`.
- Worker (`src/worker`) com foco em auth/session, retries, pooling e chamadas externas.
- Evidência operacional baseada nos logs de cauda já capturados no repositório (`tmp_tail_*.out.log`).

## Evidências objetivas

1. Saturação por timeout no backend:
   - `tmp_tail_register_rootcause.out.log` registra dezenas de ocorrências de:
     - `Query read timeout`
     - `timeout exceeded when trying to connect`
   - Query mais afetada no log: `SELECT id, user_id FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP`.

2. Burst real de endpoints no fluxo autenticado:
   - Mesmo log mostra alta frequência para:
     - `/api/profile`
     - `/api/missions`
     - `/api/progression`
     - `/api/titles`
     - `/api/achievements`

3. Duplicidade estrutural de consumo de dados no frontend (mesmo com cache):
   - Dashboard carrega múltiplos recursos em paralelo.
   - Profile carrega múltiplos recursos em paralelo.
   - Navbar também hidrata `profile/progression` quando necessário.
   - O cache/dedupe existente reduz parte da duplicidade, mas o pico inicial ainda é significativo.

4. Sinal de fetch externo sem consumo de body:
   - Logs registram warning de `stalled HTTP response was canceled`.
   - Isso indica chamadas externas sem leitura/cancelamento do corpo em alguns caminhos de erro.

## Causa raiz consolidada

- O principal gargalo não é um único endpoint, mas a combinação:
  - pico de chamadas simultâneas de leitura;
  - retries excessivos no adapter Postgres (amplificando tempo total e concorrência);
  - ausência de índices funcionais para lookups case-insensitive (`lower(email)`, `lower(username)`);
  - caminhos externos com body não consumido em erro, gerando pressão adicional no runtime.

## Correções estruturais aplicadas nesta rodada

1. Retry policy do adapter Supabase endurecida para evitar efeito cascata:
   - Limite de tentativas de leitura configurável e mais baixo.
   - Retry desativado para erro de `query read timeout`/`statement timeout` (evita tempestade de retry).
   - Backoff configurável por ambiente.

2. Índices de lookup para auth/onboarding adicionados no Supabase:
   - `lower(email)` em `core.users`.
   - `lower(username)` em `core.user_profiles`.
   - `(id, expires_at)` em `core.sessions`.

3. Correção de consumo de body em erro para integrações externas:
   - RapidAPI: corpo de erro agora é lido antes de lançar exceção.
   - Cakto: corpo de erro agora é lido antes de lançar exceção.

4. Configuração operacional adicionada no Worker:
   - Variáveis de retry explícitas no `wrangler.json` para evitar regressão silenciosa.

5. Validação de disponibilidade (`/api/auth/check-availability`) ajustada para reduzir pressão de pool:
   - Consultas de `email` e `username` deixaram de executar em paralelo no mesmo request.
   - Agora executam em sequência para reduzir consumo simultâneo de conexões em janela de pico.

## Arquivos alterados nesta rodada

- `src/worker/core/supabaseCompatDb.ts`
- `src/worker/core/types.ts`
- `src/worker/services/rapidApi.ts`
- `src/worker/services/cakto.ts`
- `src/worker/routes/auth.ts`
- `wrangler.json`
- `supabase/migrations/0010_auth_lookup_indexes.sql`

## Estado de validação

- `npm run build`: OK
- `npm run lint`: OK (somente warnings pré-existentes)
- `npm run test:unit`: OK

## Próxima validação operacional (produção)

1. Reexecutar fluxo de criação de conta e login com captura de tail:
   - confirmar queda de `Query read timeout`;
   - confirmar ausência do erro `Nao foi possivel validar agora` na etapa de validação.
2. Acompanhar estabilidade por janela contínua (30-60 min) para validar comportamento sob tráfego real.
