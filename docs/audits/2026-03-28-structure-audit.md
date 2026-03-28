# Auditoria Estrutural - 2026-03-28

## Escopo

Esta auditoria teve foco exclusivo em estrutura de pastas e arquivos, com a regra de preservar integralmente a lÃ³gica existente.

Garantias desta etapa:

- Nenhuma regra de negÃ³cio foi alterada intencionalmente.
- As mudanÃ§as aplicadas foram apenas de separaÃ§Ã£o, agrupamento e extraÃ§Ã£o de responsabilidades.
- O backup completo foi criado antes de qualquer alteraÃ§Ã£o.

## Backup

- Backup fÃ­sico completo da base: `C:\Users\Teser\OneDrive\Documentos\GitHub\FitLoot_backup_20260328_163146`

## Principais fragilidades encontradas

### 1. Worker monolÃ­tico

O arquivo `src/worker/index.ts` concentrava tipos, constantes, cache de schema, helpers de erro, configuraÃ§Ã£o de providers, catÃ¡logo de dados, rotas HTTP e lÃ³gica de domÃ­nio num Ãºnico ponto.

Riscos observados:

- alto acoplamento entre rotas, helpers e tipos
- baixa previsibilidade de impacto em mudanÃ§as pequenas
- maior chance de regressÃµes silenciosas
- revisÃ£o e manutenÃ§Ã£o muito mais lentas

### 2. Ãrvore duplicada de componentes

O projeto mantinha duas Ã¡rvores paralelas:

- `src/react-app/components`
- `src/react-app/constants/components`

DiagnÃ³stico:

- `components/` funciona majoritariamente como fachada de reexportaÃ§Ã£o
- `constants/components/` concentra a implementaÃ§Ã£o real
- existem nomes duplicados nas duas Ã¡rvores
- alguns arquivos nÃ£o sÃ£o equivalentes byte a byte, o que impede remoÃ§Ã£o cega

Isso cria ambiguidade sobre a origem canÃ´nica de cada componente.

### 3. CSS global excessivamente centralizado

Toda a base visual estava concentrada em `src/react-app/index.css`, misturando:

- tokens de tema
- camadas do Tailwind
- padrÃµes de superfÃ­cies
- estilos de autenticaÃ§Ã£o
- onboarding
- navegaÃ§Ã£o inferior
- utilidades visuais globais

Risco principal:

- qualquer ajuste visual exige navegar um arquivo longo e heterogÃªneo

### 4. `App.tsx` acumulando responsabilidades

`src/react-app/App.tsx` combinava:

- bootstrap de autenticaÃ§Ã£o
- tema
- chrome da aplicaÃ§Ã£o
- guards de rota
- carregamento lazy
- mapa de rotas

Isso dificultava leitura e isolamento de mudanÃ§as.

### 5. Uso inconsistente de caminhos

O projeto jÃ¡ tinha alias `@` configurado, mas a base continuava mista:

- imports relativos
- imports por alias
- wrappers que apontam para pastas antigas

Como o objetivo desta etapa era seguranÃ§a estrutural, nÃ£o foi feita migraÃ§Ã£o ampla de caminhos.

## Duplicidades confirmadas

### Rotas de frontend com alias funcional

As seguintes rotas compartilham a mesma pÃ¡gina:

- `/` e `ROUTE_PATHS.publicLanding` apontam para `Landing`
- `payment` e `checkout` apontam para `Checkout`
- `home` e `dashboard` apontam para `Dashboard`

Isso nÃ£o Ã© necessariamente erro funcional, mas precisa ser documentado como alias de navegaÃ§Ã£o, nÃ£o como duplicaÃ§Ã£o acidental.

### Componentes duplicados por nome

Foram identificados nomes repetidos nas duas Ã¡rvores de componentes, incluindo:

- `MissionCard.tsx`
- `LevelUpModal.tsx`
- `AIMissionGenerator.tsx`
- `AIRecommendations.tsx`
- `AppPageShell.tsx`
- `DesktopAppNavbar.tsx`
- `BottomNav.tsx`
- `PageLoader.tsx`
- `PaymentStatusPopup.tsx`
- `ui/button.tsx`
- `ui/card.tsx`
- `ui/input.tsx`
- `ui/badge.tsx`
- `ui/avatar.tsx`

### UtilitÃ¡rios com responsabilidade dispersa

Foram encontrados nomes de responsabilidade repetidos em locais diferentes:

- `auth.ts` em camadas distintas
- `theme.ts` em `contexts`, `styles` e `utils`
- `coreSkillSeeds.ts` em `shared` e `react-app/utils`

Esses arquivos precisam de consolidaÃ§Ã£o por domÃ­nio em prÃ³xima fase.

## RefatoraÃ§Ã£o aplicada nesta etapa

### 1. Rotas do frontend extraÃ­das

Foram criados mÃ³dulos dedicados em `src/react-app/routes/`:

- `RouteLoader.tsx`
- `guards.tsx`
- `lazyPages.ts`
- `AppRoutes.tsx`

Resultado:

- `App.tsx` caiu para um arquivo focado em bootstrap e providers
- os guards deixaram de ficar acoplados ao mapa de rotas
- o mapa de rotas ficou isolado em um ponto previsÃ­vel

### 2. CSS reorganizado em pasta de padrÃµes

Foi criada a pasta `src/react-app/styles/patterns/` com:

- `foundation.css`
- `components.css`
- `utilities.css`

O arquivo `src/react-app/index.css` agora atua apenas como entrypoint de importaÃ§Ã£o ordenada.

Resultado:

- tokens e base visual ficaram separados dos padrÃµes de componente
- o arquivo de entrada deixou de ser monolÃ­tico
- a ordem original do CSS foi preservada

### 3. ExtraÃ§Ã£o inicial do worker

Foi criada a base modular em `src/worker/core/`:

- `types.ts`
- `constants.ts`
- `providerConfig.ts`
- `errors.ts`
- `database.ts`

O `src/worker/index.ts` passou a importar essas responsabilidades em vez de mantÃª-las todas inline.

Resultado:

- o arquivo principal do worker foi reduzido para 13294 linhas
- tipos e constantes de infraestrutura deixaram o arquivo principal
- helpers de banco, providers e respostas de erro agora tÃªm destino explÃ­cito

### 4. Fase 2 concluÃ­da: Ã¡rvore canÃ´nica de componentes

Nesta etapa a Ã¡rvore `src/react-app/components/` passou a ser a fonte canÃ´nica de implementaÃ§Ã£o.

AÃ§Ãµes aplicadas:

- os componentes reais foram promovidos para `src/react-app/components/`
- os componentes exclusivos que ainda existiam apenas em `constants/components` tambÃ©m foram trazidos para a Ã¡rvore canÃ´nica
- `src/react-app/constants/components/` foi convertida em camada de compatibilidade por reexportaÃ§Ã£o
- os wrappers antigos de `ui/*` foram simplificados para exports explÃ­citos

Arquivos promovidos para a Ã¡rvore canÃ´nica incluem:

- `AchievementShowcaseBadge.tsx`
- `ProfileFriendsPanel.tsx`
- `WalkingMissionExecution.tsx`
- toda a famÃ­lia de `MissionCard`, `LevelUpModal`, `AIRecommendations`, `AIMissionGenerator` e `ui/*`

Resultado:

- a implementaÃ§Ã£o real agora estÃ¡ em um Ãºnico lugar
- a Ã¡rvore antiga continua funcionando para compatibilidade
- o projeto deixou de depender da pasta errada como fonte principal
- warnings de reexportaÃ§Ã£o genÃ©rica foram reduzidos no lint

### 5. Fase 3 concluÃ­da: primeiras rotas do worker por domÃ­nio

Nesta etapa os blocos de rota menos acoplados do worker saÃ­ram do monÃ³lito e passaram a viver em `src/worker/routes/`.

AÃ§Ãµes aplicadas:

- foram criados `health.ts`, `shop.ts`, `metrics.ts` e `friends.ts`
- `src/worker/index.ts` passou a apenas registrar esses mÃ³dulos, preservando a ordem das rotas
- o cache local da loja saiu do arquivo principal junto com suas rotas
- as rotas de `metrics` e `food` passaram a compartilhar um mesmo mÃ³dulo de persistÃªncia operacional

Resultado:

- o arquivo principal do worker caiu para 12939 linhas
- as primeiras rotas de baixo acoplamento deixaram de disputar contexto com `missions`, `ai` e `progression`
- a composiÃ§Ã£o das rotas ficou previsÃ­vel e pronta para as extraÃ§Ãµes seguintes
- a lÃ³gica existente foi preservada, sem alteraÃ§Ã£o de contrato HTTP

## Estrutura recomendada como alvo

### Frontend

Estrutura alvo sugerida:

```text
src/react-app/
  app/
    App.tsx
    providers/
    routes/
  components/
    app/
    auth/
    missions/
    profile/
    ui/
  hooks/
  pages/
  services/
  styles/
    patterns/
    tokens/
  types/
  utils/
```

Regra recomendada:

- `components/` deve virar a fonte canÃ´nica
- `constants/components/` deve ser esvaziada progressivamente e convertida em ponte temporÃ¡ria

### Worker

Estrutura alvo sugerida:

```text
src/worker/
  core/
    constants.ts
    database.ts
    errors.ts
    providerConfig.ts
    types.ts
  routes/
    auth.ts
    profile.ts
    progression.ts
    missions.ts
    achievements.ts
    shop.ts
    metrics.ts
    food.ts
    friends.ts
    minigames.ts
    ai.ts
    health.ts
  services/
  index.ts
```

RecomendaÃ§Ã£o de execuÃ§Ã£o:

- extrair por grupos de rota
- preservar a ordem de registro atual
- validar build apÃ³s cada grupo

## PrÃ³ximas separaÃ§Ãµes seguras

### Fase 2

- consolidar `src/react-app/components` como Ã¡rvore canÃ´nica
- transformar `src/react-app/constants/components` em camada de compatibilidade temporÃ¡ria
- separar `TrainingRankDisplay` para eliminar warning de Fast Refresh

Status:

- consolidaÃ§Ã£o da Ã¡rvore canÃ´nica: concluÃ­da
- compatibilidade temporÃ¡ria: concluÃ­da
- separaÃ§Ã£o de `TrainingRankDisplay`: pendente

### Fase 3

- extrair grupos de rota do worker para `src/worker/routes`
- comeÃ§ar por rotas menos acopladas: `health`, `shop`, `friends`, `metrics`
- deixar `missions` para uma etapa dedicada

Status:

- extraÃ§Ã£o de `health`: concluÃ­da
- extraÃ§Ã£o de `shop`: concluÃ­da
- extraÃ§Ã£o de `friends`: concluÃ­da
- extraÃ§Ã£o de `metrics` e `food`: concluÃ­da
- extraÃ§Ã£o de `missions`: pendente
- extraÃ§Ã£o de `ai`: pendente

### Fase 4

- consolidar utilitÃ¡rios duplicados de tema e autenticaÃ§Ã£o
- definir um padrÃ£o Ãºnico para `shared`, `utils` e `services`

## DecisÃ£o sobre alias `@`

O alias `@` jÃ¡ estÃ¡ configurado e funcional em:

- `vite.config.ts`
- `tsconfig.app.json`
- `tsconfig.worker.json`

Nesta etapa ele nÃ£o foi expandido, porque o foco era refatoraÃ§Ã£o estrutural segura. A recomendaÃ§Ã£o Ã©:

- manter imports relativos em mÃ³dulos locais novos
- adotar `@` apenas para travessias entre domÃ­nios maiores
- nunca misturar estratÃ©gia de alias e migraÃ§Ã£o de pasta na mesma etapa

## ValidaÃ§Ã£o executada

Comandos validados apÃ³s a refatoraÃ§Ã£o aplicada:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Estado final:

- build aprovado
- lint sem erros
- deploy dry-run do worker aprovado
- warnings estruturais de wrappers antigos foram reduzidos
- warnings remanescentes concentram-se em hooks e Fast Refresh

## Guia seguro de manutenÃ§Ã£o

### Para componentes

- toda implementaÃ§Ã£o nova deve entrar em `src/react-app/components`
- pÃ¡ginas nÃ£o devem importar diretamente de `constants/components`
- wrappers antigos sÃ³ devem existir como compatibilidade temporÃ¡ria

### Para CSS

- tokens e base em `foundation.css`
- padrÃµes de superfÃ­cie e componente em `components.css`
- shells, auth e utilidades globais em `utilities.css`
- evitar recolocar tudo dentro de `index.css`

### Para worker

- novos tipos devem nascer em `src/worker/core/types.ts`
- novos helpers de infra devem entrar em `src/worker/core/*`
- novas rotas devem nascer em mÃ³dulos dedicados antes de serem ligadas ao `index.ts`

### Para validaÃ§Ã£o

- rodar `npm run build` apÃ³s cada extraÃ§Ã£o
- rodar `npm run lint` ao concluir cada fase estrutural
- evitar mover e reescrever lÃ³gica na mesma etapa

## ConclusÃ£o

A base jÃ¡ saiu desta etapa mais organizada, com:

- rotas do frontend separadas
- padrÃµes visuais centralizados numa pasta dedicada
- extraÃ§Ã£o inicial real do monÃ³lito do worker
- extraÃ§Ã£o inicial de rotas do worker por domÃ­nio
- relatÃ³rio permanente de arquitetura e manutenÃ§Ã£o

Os maiores passivos restantes agora sÃ£o a separaÃ§Ã£o dos blocos mais acoplados do worker (`missions`, `ai`, `progression`, `profile`) e alguns warnings antigos de hooks/Fast Refresh fora do escopo estrutural. Esses pontos devem ser o foco da prÃ³xima rodada.

## Addendum - Phase 3 Continuation And Phase 4

### Worker extraction expanded safely

The worker extraction continued after the first low-coupling route split.

Additional route modules were created in `src/worker/routes/`:

- `achievements.ts`
- `progression.ts`

The worker entrypoint now registers the following extracted modules:

- `registerHealthRoutes`
- `registerShopRoutes`
- `registerMetricsRoutes`
- `registerFriendsRoutes`
- `registerAchievementRoutes`
- `registerProgressionRoutes`

Confirmed extracted HTTP contracts now live only in dedicated route files:

- health and provider diagnostics: `/health`, `/api/health/*`
- shop: `/api/shop/products`, `/api/shop/purchase/:id`, `/api/shop/orders`
- metrics and food diary: `/api/metrics/today`, `/api/metrics/update`, `/api/food/scan`, `/api/food/today`
- friends: `/api/friends/*` and `/api/users/search`
- achievements and titles: `/api/achievements`, `/api/titles`, `/api/titles/:id/activate`
- progression and performance: `/api/progression`, `/api/attributes`, `/api/progress/*`, `/api/benchmarks`, `/api/skills/*`

Validation performed for route fidelity:

- route registration confirmed in `src/worker/index.ts`
- extracted route paths confirmed in the new modules
- no duplicate inlined definitions were found for the extracted paths inside `src/worker/index.ts`

Current worker monolith size after this extraction wave:

- `src/worker/index.ts`: 12544 lines

This means the worker refactor remained faithful to the existing logic while further shrinking the monolith.

### Frontend phase 4 completed

Authentication and theme files were reorganized into canonical domain folders:

- `src/react-app/auth/`
- `src/react-app/theme/`

Canonical auth files:

- `auth/constants.ts`
- `auth/context.ts`
- `auth/types.ts`
- `auth/hooks/useAuthBootstrap.ts`

Canonical theme files:

- `theme/appTheme.ts`
- `theme/profileTheme.ts`
- `theme/authColorScheme.ts`
- `theme/AuthThemeHeader.tsx`

Compatibility was preserved by converting the old locations into reexports:

- `constants/auth.ts`
- `contexts/auth.ts`
- `hooks/useAuthBootstrap.ts`
- `types/auth.ts`
- `utils/appTheme.ts`
- `utils/theme.ts`
- `components/authColorScheme.ts`
- `components/AuthThemeHeader.tsx`

This preserves the exact runtime behavior while giving the codebase a clear canonical structure for future maintenance.

### Import migration completed

The active frontend code now points to the canonical folders for:

- auth constants
- auth context
- auth bootstrap hook
- auth types
- app theme
- profile theme
- auth color scheme
- auth theme header

This was a structure-only migration. No business rules, route behavior, or visual tokens were intentionally changed.

### Validation after phase 4

Commands executed successfully after the canonicalization:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Result:

- build passed
- lint passed with the same 9 pre-existing warnings
- worker dry-run deploy passed

Warnings still outside structural scope:

- `TrainingRankDisplay.tsx` fast refresh export warning
- hook dependency warnings in `WalkingMissionExecution.tsx`
- hook dependency warning in `useMapService.ts`
- hook dependency warnings in `useWalkingMission.ts`
- hook dependency warning in `FoodAnalysis.tsx`

### Remaining safe next steps

The next worker extractions should focus on the most coupled blocks:

- `missions`
- `ai`
- `profile`
- subscription and onboarding flows

The next frontend structural cleanups should focus on:

- reducing the remaining compatibility reexports once imports are fully stabilized
- isolating `TrainingRankDisplay` constants to remove the fast refresh warning
- auditing duplicated responsibilities between `shared`, `services`, and `utils`

### Worker phase 5 completed

The next highly coupled worker domain, `ai`, was extracted into a dedicated route module:

- `src/worker/routes/ai.ts`

The AI route module now owns the HTTP contracts for:

- `/api/ai/generate-missions`
- `/api/ai/generate-missions/status`
- `/api/ai/chat`
- `/api/ai/recommendations`
- `/api/ai/workout-suggestions`
- `/api/ai/analyze-food`

The supporting route-local helpers that were previously mixed into `src/worker/index.ts` were moved together with the AI routes:

- recommendation fallback assembly
- recommendation merge normalization
- USDA and RapidAPI food search wrappers
- OCR nutrition parsing
- multimodal food item identification from image input

This extraction preserved the existing logic by keeping the original helper functions and messages intact, while injecting shared dependencies explicitly from `src/worker/index.ts`.

Validation performed after the AI extraction:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint still reports only the same 9 pre-existing frontend warnings

Route-fidelity confirmation after extraction:

- all `/api/ai/*` route definitions were removed from `src/worker/index.ts`
- the same `/api/ai/*` contracts are now registered from `src/worker/routes/ai.ts`
- no duplicate inline AI route handlers remain in `src/worker/index.ts`

Current worker monolith size after the AI extraction:

- `src/worker/index.ts`: 10484 lines

This is a substantial structural reduction while preserving the existing API behavior.

### Worker phase 5.1 completed

The AI provider transport and upstream error handling were also separated into a dedicated service:

- `src/worker/services/aiTransport.ts`

This service now owns the previously inlined infrastructure for:

- `ApiIntegrationError`
- external-provider rate limiting
- upstream timeout and JSON parsing wrappers
- Hugging Face structured chat requests
- Hugging Face vision structured requests
- Anthropic chat fallback
- cross-provider chat fallback orchestration
- friendly upstream error normalization
- generic fetch timeout wrapper reused by checkout/profile flows

The worker entrypoint now imports these capabilities instead of defining them inline, and the AI route module keeps consuming them through explicit dependencies. This further reduces hidden coupling while preserving the same behavior and retry rules.

Validation performed after the AI transport extraction:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint still reports only the same 9 pre-existing frontend warnings

Transport-fidelity confirmation after extraction:

- no remaining inline definitions were found in `src/worker/index.ts` for `ApiIntegrationError`
- no remaining inline definitions were found in `src/worker/index.ts` for `fetchJsonWithTimeout`
- no remaining inline definitions were found in `src/worker/index.ts` for `callOpenAIChatWithFallback`
- no remaining inline definitions were found in `src/worker/index.ts` for the Hugging Face vision/chat transport helpers

Current worker monolith size after phase 5.1:

- `src/worker/index.ts`: 9942 lines

### Updated next safe cuts

The safest remaining worker extractions are now:

- split mission generation internals away from route registration
- isolate daily reset, snapshot, and weekly recalculation flows into background-processing modules
- evaluate whether training-plan chat preference helpers can move from the monolith into an AI planning service without widening runtime surface area

### Worker phase 5.2 completed

The next two coupled worker orchestration blocks were extracted into dedicated services:

- `src/worker/services/missionGeneration.ts`
- `src/worker/services/backgroundProcessing.ts`

The mission-generation service now owns the orchestration flow for:

- structured mission-plan generation
- AI retry/fallback selection during plan generation
- active-cycle short-circuit checks
- periodic mission backfill for daily, weekly, and monthly windows

This was intentionally done without moving the lower-level mission helpers yet. The internal validation, draft normalization, repair, persistence, and blueprint logic remain untouched in `src/worker/index.ts`; the new service composes them through explicit dependency injection. This keeps the runtime behavior stable while removing orchestration weight from the monolith.

The background-processing service now owns the scheduled orchestration for:

- daily reset processing
- automatic daily progress snapshots
- weekly attribute recalculation
- scheduled execution guard logic

This extraction preserved the existing queries, log messages, ordering, and failure handling. Only the file location and composition boundary changed.

Validation performed after phase 5.2:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint still reports only the same 9 pre-existing frontend warnings

Fidelity confirmation after extraction:

- no inline definitions remain in `src/worker/index.ts` for `generateStructuredMissionPlanForUser`
- no inline definitions remain in `src/worker/index.ts` for `ensurePeriodicMissions`
- no inline definitions remain in `src/worker/index.ts` for `processDailyReset`
- no inline definitions remain in `src/worker/index.ts` for `createDailySnapshot`
- no inline definitions remain in `src/worker/index.ts` for `recalculateUserAttributes`
- no inline definitions remain in `src/worker/index.ts` for `processWeeklyRecalculation`
- no inline definitions remain in `src/worker/index.ts` for `runScheduledWithGuard`
- `registerMissionRoutes(...)` still receives the same mission-generation entrypoints
- the scheduled worker entrypoint still calls the same guarded processing flow, now imported from the background service composition

Current worker monolith size after phase 5.2:

- `src/worker/index.ts`: 9608 lines

### Updated next safe cuts after phase 5.2

The safest remaining worker extractions are now:

- move the remaining mission-generation helper cluster out of `src/worker/index.ts` in domain slices such as validation, persistence, repair, and fallback drafting
- isolate profile and subscription/onboarding flows into dedicated services where route handlers still carry too much orchestration
- review whether shared worker utility groups should be promoted into `src/worker/core` to reduce cross-domain helper drift

### Worker phase 5.3 completed

The next mission helper slice was extracted into a dedicated persistence-and-repair service:

- `src/worker/services/missionPlanPersistence.ts`

This new service now owns the mission-plan lifecycle pieces that were previously mixed into the monolith:

- structured mission-plan persistence
- periodic mission materialization and insertion
- daily blueprint derivation from current-cycle missions
- periodic backfill using existing daily blueprints
- legacy weekly/monthly mission repair

The extraction was kept logic-preserving by composing the existing helpers through explicit adapters in `src/worker/index.ts`, instead of rewriting mission rules. The service consumes the same lower-level functions for plan storage, mission insertion, subtask replacement, monthly counter progress, and periodic blueprint resolution.

Validation performed after phase 5.3:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint still reports only the same 9 pre-existing frontend warnings

Fidelity confirmation after extraction:

- no inline definitions remain in `src/worker/index.ts` for `persistGeneratedMissionPlan`
- no inline definitions remain in `src/worker/index.ts` for `ensureStructuredPeriodicMissionsFromExistingDailyBlueprints`
- no inline definitions remain in `src/worker/index.ts` for `repairLegacyPeriodicMissions`
- no inline definitions remain in `src/worker/index.ts` for the supporting persistence helpers that were moved together with that cluster
- `createMissionGenerationService(...)` still receives the same persistence entrypoints, now through `missionPlanPersistenceService`
- `topUpStructuredDailyMissionsForUser(...)` and `createMissionsForPeriod(...)` still execute the same persistence flow, now through the dedicated service

Current worker monolith size after phase 5.3:

- `src/worker/index.ts`: 9139 lines

### Updated next safe cuts after phase 5.3

The safest remaining worker extractions are now:

- move the remaining mission-generation validation and fallback drafting cluster out of `src/worker/index.ts`
- isolate profile and subscription/onboarding flows into dedicated services where route handlers still carry too much orchestration
- review whether remaining worker helper groups should be promoted into `src/worker/core` to reduce cross-domain drift
