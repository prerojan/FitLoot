# Auditoria Estrutural - 2026-04-18

## Escopo validado

- Worker (`src/worker`) com foco em rotas, consistencia transacional, retries, cobertura de testes e uso do banco.
- Frontend (`src/react-app`) com foco nas chamadas criticas ligadas ao chat e ao shell autenticado.
- Infraestrutura operacional a partir de `vercel.json`, `wrangler.json`, artefatos temporarios versionados no repositorio e advisors reais do Supabase.

## Achados comprovados

### 1. `GET /api/social/conversations/:id/messages` podia retornar `500` em falha transitoria de banco

- Evidencia:
  - A rota fazia leituras sequenciais sem `runWithTransientDatabaseRetry` em `src/worker/routes/socialChat.ts`.
  - O helper central em `src/worker/core/database.ts` ja classifica `query read timeout` e falhas de conexao como transitorias.
  - Os logs versionados no repositorio e a auditoria operacional anterior registram `Query read timeout`.
- Impacto:
  - Um timeout momentaneo de leitura derrubava a rota com `500`, apesar do fluxo ser idempotente e apropriado para retry.
- Status:
  - Corrigido nesta rodada.

### 2. Preview de conversa direta perdia participantes por inconsistenca de tipo no `conversation_id`

- Evidencia:
  - `listConversationParticipants()` monta `Map<number, ...>`.
  - `hydrateConversationPreviews()` consultava `participantsByConversation.get(row.id)` sem normalizar `row.id`.
  - Em runtimes onde ids inteiros chegam como string, o lookup falhava e o preview ficava sem participantes.
- Impacto:
  - Fallback inconsistente no chat direto, com `display_title` generico e dados incompletos.
- Status:
  - Corrigido nesta rodada.

### 3. `GET /api/ranking/global` tinha efeito colateral persistente

- Evidencia:
  - A implementacao original em `src/worker/index.ts` executava `ensureUserCounterRow`, `onRankingUpdate` e `unlockAchievementIfNeeded` durante um `GET`.
  - A nova rota modular em `src/worker/routes/ranking.ts` responde apenas com leitura e cache.
  - Os side effects de ranking foram movidos para fluxos de mutacao em `src/worker/services/gamificationLifecycle.ts`, `src/worker/routes/missions.ts` e `src/worker/routes/progression.ts`.
- Impacto:
  - `GET` deixava de ser semanticamente seguro e podia mutar estado em refresh, prefetch e retry.
- Status:
  - Corrigido nesta rodada.

### 4. `POST /api/mini-games/:id/complete` nao era transacional

- Evidencia:
  - A implementacao original atualizava o mini-game e depois disparava varias mutacoes paralelas.
  - A nova rota em `src/worker/routes/miniGames.ts` encapsula a conclusao em `withTransaction(...)` e so invalida cache/lista recompensas depois do commit.
- Impacto:
  - Falha parcial podia deixar mini-game concluido com recompensas, counters e eventos incompletos.
- Status:
  - Corrigido nesta rodada para consistencia transacional.

### 5. Conclusao do mini-game ainda depende do payload do cliente

- Evidencia:
  - `src/worker/routes/miniGames.ts` continua decidindo a conclusao a partir de `data.reps_completed >= target_reps`.
  - A busca no codigo nao encontrou uma fonte server-side de telemetria que permita validar `reps_completed` ou `time_seconds` de forma independente.
- Impacto:
  - O servidor agora e consistente na gravacao, mas ainda nao possui uma fonte de verdade propria para auditar a performance declarada.
- Status:
  - Parcialmente mitigado. Nao foi alterado sem uma fonte de verdade comprovada para evitar regressao funcional.

### 6. Logica de retry transitorio estava duplicada e divergente entre rotas

- Evidencia:
  - `src/worker/core/database.ts` possui a implementacao central.
  - `billing`, `onboarding` e `presence` mantinham copias locais com cobertura de erros diferente.
  - Nesta rodada, essas rotas passaram a consumir o helper central.
- Impacto:
  - O mesmo tipo de falha infraestrutural podia ser tratado de forma diferente dependendo da rota.
- Status:
  - Corrigido nesta rodada.

### 7. Ranking e mini-games estavam sem cobertura de rota dedicada

- Evidencia:
  - As rotas foram extraidas de `src/worker/index.ts` para `src/worker/routes/ranking.ts` e `src/worker/routes/miniGames.ts`.
  - Foram adicionadas suites dedicadas em `src/test/worker/ranking.routes.test.ts` e `src/test/worker/miniGames.routes.test.ts`.
- Impacto:
  - Fluxos com side effects e multiplas mutacoes ficavam expostos sem regressao automatizada proporcional ao risco.
- Status:
  - Corrigido nesta rodada.

### 8. Bucket publico de avatar permitia listagem ampla

- Evidencia:
  - Advisor real do Supabase apontava `public_bucket_allows_listing` no bucket `fitloot-avatars`.
  - Foi aplicada migracao removendo a policy publica redundante em `storage.objects`.
  - A consulta posterior aos advisors retornou `security.lints = []`.
- Impacto:
  - Clientes podiam listar objetos alem do necessario para acesso por URL publica.
- Status:
  - Corrigido nesta rodada.

### 9. FK `social.conversation_message_media_uploaded_by_user_id_fkey` nao tinha indice de cobertura

- Evidencia:
  - Advisor real do Supabase apontava a ausencia de indice.
  - Foram adicionadas migracoes para D1 e Supabase criando o indice.
  - A consulta posterior aos advisors removeu esse achado; o indice novo aparece apenas como `unused_index` informativo por ainda nao ter aquecido uso.
- Impacto:
  - Operacoes envolvendo essa FK podiam degradar com crescimento do volume.
- Status:
  - Corrigido nesta rodada.

### 10. Repositorio ainda versionava arquivos temporarios de cookie e logs auxiliares

- Evidencia:
  - `git ls-files` mostrava `tmp_cookie.txt`, `tmp_cookie_dev.txt` e `tmp_smoke_cookie.txt` versionados.
  - Tambem havia grande volume de logs `tmp_*`, `tail_capture.*` e caches temporarios locais.
  - `.gitignore` nao cobria esses padroes.
- Impacto:
  - Mesmo vazios hoje, sao artefatos sensiveis por natureza e poluem a arvore do projeto.
- Status:
  - Corrigido nesta rodada.

## Correcoes aplicadas nesta rodada

- `src/worker/routes/socialChat.ts`
  - Retry transitorio no `GET /api/social/conversations/:id/messages`.
  - Normalizacao consistente de `conversationId` no preview.
  - Separacao do rotulo de log entre `GET` e `POST`.
- `src/worker/routes/ranking.ts`
  - Extracao do ranking para rota modular read-only.
  - Sanitizacao do ranking global antes da resposta.
- `src/worker/routes/miniGames.ts`
  - Extracao do fluxo para rota modular.
  - Conclusao do mini-game encapsulada em transacao.
  - Invalida cache e busca eventos de recompensa apenas apos commit bem-sucedido.
- `src/worker/services/trainingRanking.ts`
  - Fonte compartilhada para leitura do ranking.
- `src/worker/services/trainingRankingMilestones.ts`
  - Reaproveita o calculo de posicao para milestones de ranking fora do `GET`.
- `src/worker/services/gamificationLifecycle.ts`
  - Aplicacao de milestones de ranking em fluxo de mutacao.
- `src/worker/routes/missions.ts`
  - Aplicacao de milestones de ranking apos sincronizacao de rank.
- `src/worker/routes/progression.ts`
  - Aplicacao de milestones de ranking no fluxo de benchmark.
- `src/worker/routes/billing.ts`
  - Migracao para o helper central de retry transitorio.
- `src/worker/routes/onboarding.ts`
  - Migracao para o helper central de retry transitorio.
- `src/worker/routes/presence.ts`
  - Migracao para o helper central de retry transitorio.
- `src/worker/services/userPlanAccess.ts`
  - Remocao do classificador duplicado de erro transitorio.
- `src/test/worker/socialChat.routes.test.ts`
  - Nova cobertura para retry e ids vindo como string.
- `src/test/worker/ranking.routes.test.ts`
  - Nova cobertura para resposta sanitizada e cache do ranking global.
- `src/test/worker/miniGames.routes.test.ts`
  - Nova cobertura para commit completo e falha transacional.
- `src/test/worker/account.routes.test.ts`
  - Alinhamento de mocks com `syncTrainingRankState`.
- `src/test/worker/missions.routes.test.ts`
  - Alinhamento de mocks e novo contrato de `onRankingUpdate`.
- `src/test/worker/onboarding.routes.test.ts`
  - Mock do helper central de retry.
- `src/test/worker/progression.routes.test.ts`
  - Ajuste de dependencias para milestones e invalidacao de ranking.
- `supabase/migrations/0020_avatar_listing_lockdown_and_media_uploader_index.sql`
  - Remocao da policy redundante do bucket e criacao do indice da FK.
- `migrations/033_conversation_message_media_uploader_index.sql`
  - Criacao do indice equivalente no banco D1.
- `.gitignore`
  - Bloqueio de `tmp_*`, `tmp_cookie*`, logs auxiliares e `supabase/.temp/`.

## Validacao executada

- `npm run test:unit` -> OK (`69` arquivos, `262` testes)
- `npm run build` -> OK
- Advisors do Supabase:
  - `security` -> sem lints
  - `performance` -> apenas avisos `unused_index` informativos

## Proxima rodada recomendada

1. Desenhar uma fonte de verdade server-side para performance do mini-game antes de endurecer a verificacao de vencedor.
2. Observar os novos indices em producao para confirmar aquecimento e utilidade real antes de remover outros indices marcados como `unused_index`.
3. Se o volume do chat crescer, adicionar observabilidade dedicada para latencia por consulta em `social.conversations` e `social.conversation_messages`.
