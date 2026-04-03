# Auditoria Completa do Projeto - 2026-04-03

## Escopo real da auditoria

Esta auditoria cobriu **todo o projeto**, nao apenas arquivos alterados:

- Frontend inteiro (`src/react-app`) para mapa de chamadas `/api/*`, duplicidade e burst.
- Worker inteiro (`src/worker`) para mapa de rotas, middleware, query paths e hotspots.
- Telemetria operacional com `wrangler tail` e testes ativos contra:
  - `https://fitloot.vercel.app`
  - `https://fitloot-worker.suportefitloot.workers.dev`

## Inventario de superficie (projeto inteiro)

### 1. Rotas backend encontradas

- Total de endpoints HTTP mapeados: **66**.
- Resultado: **nao existem definicoes duplicadas de rota** (mesmo metodo + mesmo path).

### 2. Hotspots de chamadas no frontend

Arquivos com maior concentracao de referencias `/api`:

- `src/react-app/pages/Profile.tsx`: 19 refs / 11 endpoints.
- `src/react-app/pages/Dashboard.tsx`: 18 refs / 7 endpoints.
- `src/react-app/pages/MiniGames.tsx`: 13 refs / 8 endpoints.
- `src/react-app/pages/Titles.tsx`: 9 refs / 4 endpoints.
- `src/react-app/components/LevelUpModal.tsx`: 8 refs / 4 endpoints.

Endpoints mais referenciados no frontend:

- `/api/progression` (19 refs)
- `/api/profile` (16 refs)
- `/api/titles` (12 refs)
- `/api/missions` (9 refs)
- `/api/skills` (7 refs)

### 3. Hotspots de acesso DB no worker

Arquivos com maior densidade de operacoes SQL (`prepare/run/first/all`):

- `src/worker/index.ts`: score 98
- `src/worker/services/gamificationLifecycle.ts`: score 86
- `src/worker/routes/progression.ts`: score 43
- `src/worker/routes/ai.ts`: score 36
- `src/worker/routes/profile.ts`: score 34

## Evidencia operacional (sem suposicao)

### 1. Causa de latencia observada em producao

Com tail ativo, foram registrados retries de query por timeout no adapter Supabase:

- Log recorrente: `[supabase-compat-db][query-retry]`
- Erro recorrente: `Query read timeout`
- SQL recorrente:
  - `SELECT id, user_id FROM sessions WHERE id = ? AND expires_at > CURRENT_TIMESTAMP`
  - `SELECT showcased_achievements FROM user_profiles WHERE user_id = ?`
  - query de `check-availability` (subselect de email/username)

Isso confirma que parte relevante da latencia vem de timeout + retry no caminho de leitura, nao de erro de frontend.

### 2. Validacao real apos correcoes

Deploy ativo: **Version ID `e7711f9f-1769-4d0b-94dc-edaf4825af2e`**

Bateria `check-availability` (Vercel):

- 20 chamadas
- **20/20 sucesso**
- media: **1569.3 ms**
- erro: **0**

Bateria `users/me` autenticado:

- 15 chamadas
- **15/15 sucesso**
- media: **1709 ms**
- erro: **0**

Bateria `auth/login` (20 sessoes novas):

- 20 chamadas
- **20/20 sucesso**
- media: **1783.6 ms**
- erro: **0**

## Correcoes estruturais implementadas nesta rodada

### 1. `check-availability` com roundtrip unico

Arquivo: `src/worker/routes/auth.ts`

Antes:
- 2 consultas separadas para email e username por request.

Agora:
- 1 consulta consolidada com subselects para `email_user_id` e `username_user_id`.
- Mantida a regra de reaproveitamento de conta incompleta (`isReusableIncompleteAccount`).

Impacto estrutural:
- Menos roundtrips DB por validacao.
- Menor pressao de conexao no pico de onboarding.

### 2. Deduplicacao de validacao no onboarding

Arquivo: `src/react-app/pages/Onboarding.tsx`

Antes:
- `validateEmail` chamava disponibilidade so de email.
- `validateUsername` chamava disponibilidade so de username.
- submit chamava os dois juntos novamente.

Agora:
- `validateEmail` e `validateUsername` passam contexto do outro campo valido,
  para convergir no mesmo cache key (`email+username`) e reaproveitar cache/inflight.

Impacto estrutural:
- Menos chamadas duplicadas no fluxo de digitacao + submit.
- Menor estresse em cache e banco.

### 3. Regressao de tuning detectada e revertida

Arquivo: `wrangler.json`

Foi testado tuning com timeout mais alto (5s), mas em producao isso gerou:

- latencia ~5s em quase todas as leituras
- picos de 500 por retry estendido

A configuracao operacional foi **revertida** para o perfil estavel:

- `SUPABASE_QUERY_TIMEOUT_MS=1500`
- `SUPABASE_READ_MAX_ATTEMPTS=3`

Resultado apos rollback + melhorias estruturais acima:

- estabilidade sem 500 nas baterias atuais
- latencia voltou para faixa ~1.6-1.7s

## Conclusao de causa raiz

1. **Nao ha duplicidade de rotas backend** causando 500.
2. O problema principal e **latencia de leitura no caminho Supabase (timeout/retry)**.
3. O frontend contribuia com burst/duplicidade em onboarding e paginas de alta carga, e isso foi reduzido com dedupe estrutural.
4. A aplicacao esta funcional no fluxo testado; ainda existe oportunidade de reduzir mais a latencia media no caminho de leitura autenticada.

## Recomendacoes imediatas (proxima etapa)

1. Instrumentar metricas por endpoint com buckets (p50/p95/p99) no worker para separar latencia de auth middleware vs handler.
2. Aplicar bootstrap agregado por tela critica (`dashboard/profile`) para reduzir fan-out inicial no login.
3. Evoluir projecoes D1 para leituras quentes de dashboard (mantendo Supabase como source of truth), conforme a topologia hibrida definida.
