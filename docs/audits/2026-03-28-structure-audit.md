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

### Worker phase 5.4 completed

The mission validation and blueprint-resolution cluster was extracted into a dedicated service:

- `src/worker/services/missionPlanValidation.ts`

This new service now owns the rules that validate and normalize the structured mission plan before persistence:

- periodic subtask fallback derivation
- periodic blueprint resolution for weekly and monthly plans
- metric range validation for daily mission drafts
- promotion of invalid daily circuit-like drafts into weekly periodic drafts
- fallback filling for missing daily drafts

The extraction was kept logic-preserving by moving the implementation into the new service and keeping `src/worker/index.ts` as a thin adapter for the two public entrypoints that still anchor existing composition:

- `resolvePeriodicMissionBlueprints(...)`
- `validateStructuredMissionPlan(...)`

This means the mission-generation service and the mission-plan persistence service continue to call the same semantic contract, while the rule implementation now lives outside the monolith in a dedicated domain file.

Validation performed after phase 5.4:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint still reports only the same 9 pre-existing frontend warnings

Fidelity confirmation after extraction:

- the periodic blueprint resolution path is now implemented in `missionPlanValidationService`
- the structured mission-plan validation path is now implemented in `missionPlanValidationService`
- `createMissionGenerationService(...)` still receives the same validation contract
- `createMissionPlanPersistenceService(...)` still receives the same periodic blueprint resolution contract
- `topUpStructuredDailyMissionsForUser(...)` still validates fallback and AI plans through the same mission-plan validation contract

Current worker monolith size after phase 5.4:

- `src/worker/index.ts`: 9086 lines

### Updated next safe cuts after phase 5.4

The safest remaining worker extractions are now:

- split the remaining mission materialization/enrichment cluster out of `src/worker/index.ts`
- isolate profile and subscription/onboarding flows into dedicated services where route handlers still carry too much orchestration
- review whether remaining worker helper groups should be promoted into `src/worker/core` to reduce cross-domain drift

### Worker phase 5.5 completed

This phase completed the next safe separation around subscription/onboarding orchestration and route contracts, while preserving the existing runtime behavior.

New dedicated modules introduced or finalized in this phase:

- `src/worker/services/userPlanAccess.ts`
- `src/worker/services/subscriptionLifecycle.ts`
- `src/worker/routes/onboarding.ts`
- `src/worker/routes/contracts.ts`

Structural changes completed:

- the promo-code, checkout bootstrap, subscription persistence, and Cakto webhook orchestration now live in `subscriptionLifecycle.ts`
- plan-access and user-plan normalization helpers now live in `userPlanAccess.ts`
- the onboarding endpoint was removed from `src/worker/routes/profile.ts` and registered through `src/worker/routes/onboarding.ts`
- `src/worker/routes/profile.ts` now focuses on profile editing and feedback only
- the shared `WithTransaction` contract was deduplicated into `src/worker/routes/contracts.ts` and reused by `billing`, `friends`, `missions`, `profile`, `shop`, and `onboarding`

Encoding cleanup completed in this phase:

- fixed user-facing mojibake in the extracted onboarding/subscription flow
- fixed visible authentication and checkout-status strings in `src/worker/index.ts`
- fixed visible monthly mission labels and fallback names that could leak garbled text to users

Validation performed after phase 5.5:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint still reports only the same 9 pre-existing frontend warnings

Fidelity confirmation after extraction:

- `/api/onboarding` still uses the same onboarding schema, persistence flow, initial skill unlock rules, training-plan generation path, checkout bootstrap, and background mission scheduling
- billing routes still receive the same subscription helpers, now provided by `subscriptionLifecycle.ts`
- profile routes still keep the same profile-editing, goal-change, feedback, and mission-regeneration behavior, now without carrying onboarding orchestration inline
- no route contract or response shape was intentionally changed during this phase

Current size snapshot after phase 5.5:

- `src/worker/index.ts`: 6732 lines
- `src/worker/routes/profile.ts`: 579 lines
- `src/worker/routes/onboarding.ts`: 402 lines
- `src/worker/services/subscriptionLifecycle.ts`: 989 lines

Updated next safe cuts after phase 5.5:

- extract the remaining mission enrichment/materialization helpers that still live in `src/worker/index.ts`
- perform a dedicated mojibake sweep on the oldest untouched strings/comments that remain in legacy portions of the monolith
- continue reducing cross-domain utility drift by promoting stable helpers into `src/worker/core` or narrow domain services

### Worker phase 5.6 completed

This phase continued the mission-domain breakup without changing runtime behavior, focusing on the remaining blueprint planning/materialization orchestration still anchored in `src/worker/index.ts`.

New dedicated modules introduced or expanded in this phase:

- `src/worker/services/missionComposition.ts`
- `src/worker/services/missionProgression.ts`
- `src/worker/services/missionBlueprintPlanning.ts`
- `src/worker/services/gamification/types.ts`
- `src/worker/services/gamification/skillSeeds.ts`
- `src/worker/services/gamification/stageProgressionSeeds.ts`
- `src/worker/services/gamification/titleSeeds.ts`
- `src/worker/services/gamification/achievementSeeds.ts`

Structural changes completed:

- mission composition helpers now live in `missionComposition.ts`, including description/instruction builders, metric conditioning, periodic descriptions, and circuit-task generation
- mission attribute progression now lives in `missionProgression.ts`, including per-category deltas, skill-table gain aggregation, and user attribute application
- blueprint planning and fallback drafting now live in `missionBlueprintPlanning.ts`, including:
  - monthly counter blueprint generation
  - mission compatibility-term expansion
  - fallback structured daily/weekly draft generation
  - AI prompt assembly for structured mission generation
  - structured mission-plan request dispatch to Hugging Face
- the gamification catalog no longer carries its large inline seed arrays; skill, title, achievement, and stage seed data now live in dedicated files under `src/worker/services/gamification/`
- `src/worker/index.ts` now composes the extracted services instead of keeping these helpers inline
- commented legacy validation/resolution blocks were removed from `src/worker/index.ts` after the service extraction was verified, reducing dead-code drift

Encoding cleanup completed in this phase:

- fixed visible mojibake in `src/worker/routes/friends.ts`
- fixed visible mojibake in `src/worker/routes/progression.ts`
- fixed visible mojibake and inconsistent upstream error strings in `src/worker/services/aiTransport.ts`
- fixed visible mojibake in weekly recalculation logs in `src/worker/services/backgroundProcessing.ts`
- fixed mojibake that had leaked into the extracted weekly fallback goal in `src/worker/services/missionBlueprintPlanning.ts`

Validation performed after phase 5.6:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint still reports only the same 9 pre-existing frontend warnings

Fidelity confirmation after extraction:

- mission generation still uses the same fallback plan semantics and the same AI retry loop, now composed through `missionBlueprintPlanningService`
- mission persistence still receives the same blueprint shape and periodic resolution contract
- mission progression still applies the same attribute gains, now composed through `missionProgressionService`
- gamification catalog bootstrap still seeds the same logical content, now sourced from dedicated seed files instead of a single large catalog file
- no route contract or response shape was intentionally changed during this phase

Current size snapshot after phase 5.6:

- `src/worker/index.ts`: 5155 lines
- `src/worker/services/missionBlueprintPlanning.ts`: 690 lines
- `src/worker/services/missionComposition.ts`: 687 lines
- `src/worker/services/missionProgression.ts`: 208 lines

Updated next safe cuts after phase 5.6:

- continue splitting the remaining exercise enrichment/materialization flow still anchored in `src/worker/index.ts`
- isolate the remaining training-plan and mission-top-up orchestration helpers that still sit in the monolith
- run one last narrow mojibake sweep on untouched legacy comments/messages only after those extractions land, to avoid churn on moving code

### Worker phase 5.7 completed

This phase resumed the mission-materialization and training-plan/top-up breakup with a safety-first goal: stabilize the extracted services, remove the now-dead inline implementations, and keep the runtime contracts unchanged.

New or now-actively wired modules in this phase:

- `src/worker/services/trainingPlanOrchestration.ts`
- `src/worker/services/aiMissionGeneration.ts`
- `src/worker/services/missionParsing.ts`

Structural changes completed:

- `src/worker/index.ts` now delegates mission-profile loading, daily top-up orchestration, and period mission creation through `trainingPlanOrchestrationService`
- AI mission generation and mission-job schema handling are now delegated through `aiMissionGenerationService`
- JSON/model parsing helpers used by extracted mission services are now centralized in `missionParsing.ts`
- dead inline legacy implementations that were left behind during the previous partial restore were removed from `src/worker/index.ts`, including:
  - the old inline legacy daily mission-repair implementation
  - dead duplicate progression helpers already covered by `missionProgressionService`
  - dead duplicate repair-selection helpers tied to the removed inline legacy-repair path
  - dead exercise-selection helpers and local-pool fallbacks that no longer participate in the current orchestration flow
- the worker entrypoint was re-stabilized so the extracted services are the active code paths again, instead of coexisting with conflicting local copies

Validation/support changes completed in this phase:

- restored the missing orchestration helpers required by blueprint validation:
  - XP clamping by period
  - points derivation by period
  - structured metric-type resolution
  - structured metric-value conversion
  - circuit-text detection
- restored the route/service aliases needed by extracted progression and mission handlers without changing the route contracts
- removed stale imports and stale local declarations left over from the interrupted extraction attempt

Validation performed after phase 5.7:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint reports only the same 9 pre-existing frontend warnings

Fidelity confirmation after extraction:

- mission generation still resolves structured plans, fallback drafts, periodic blueprints, and AI mission insertion through the same contracts already used by the route layer
- training-plan top-up still uses the same profile loading, plan hashing, and cycle-based mission creation flow, now wired through `trainingPlanOrchestrationService`
- AI special mission generation still uses the same route contract and persistence path, now wired through `aiMissionGenerationService`
- no route contract or response shape was intentionally changed during this phase

Current size snapshot after phase 5.7:

- `src/worker/index.ts`: 4715 lines
- `src/worker/services/trainingPlanOrchestration.ts`: active orchestration source for top-up/training-plan
- `src/worker/services/aiMissionGeneration.ts`: active orchestration source for AI mission generation
- `src/worker/services/missionParsing.ts`: active parsing source for extracted mission services

Updated next safe cuts after phase 5.7:

- move the remaining mission-materialization fallbacks still living in `src/worker/index.ts` behind `missionMaterialization.ts`
- decide whether the residual translation helper chain in `src/worker/index.ts` should be promoted into `missionMaterialization.ts` or removed entirely if the service path already supersedes it
- run a dedicated mojibake sweep only on the code that remains active after those last materialization cuts, to avoid touching text in code paths that are about to be deleted

### Worker phase 5.8 completed

This phase closed the remaining safe mission-materialization cut in the worker entrypoint and finished the narrow mojibake/comment cleanup on the active code paths touched by the refactor.

New or newly active support modules in this phase:

- `src/worker/services/missionMaterializationSupport.ts`
- `src/worker/services/missionComposition.ts` (now reused directly by `index.ts` instead of keeping local copies)

Structural changes completed:

- `src/worker/index.ts` now imports the active mission-composition helpers directly from `missionComposition.ts` instead of maintaining local duplicates for:
  - mission period/category typing
  - mission metric normalization
  - duration/sets/rest inference
  - mission description and instruction composition
  - metric-context application
  - cycle key helpers
  - fallback exercise selection and unique exercise filtering
- the remaining inline mission-materialization support helpers were extracted into `missionMaterializationSupport.ts`, including:
  - mission payload typing shared by the worker entrypoint
  - instruction-step sanitation and normalization
  - model JSON extraction/parsing helpers
  - exercise API body-area and muscle-group resolution
  - bounded async map/concurrency helper
  - daily fallback mission construction via injected payload builder
  - metric-type resolution by category
- dead inline helper chains were removed from `src/worker/index.ts`, including:
  - the duplicated mission payload builder
  - the duplicated fallback mission list builder
  - the old inline instruction translation/parsing chain that was no longer the active runtime path
  - the duplicated mission-composition helpers already covered by `missionComposition.ts`

Cleanup completed in this phase:

- corrected mojibake/legacy comments in `src/worker/services/missionComposition.ts`
- corrected the remaining mojibake strings and bootstrap comments in active sections of `src/worker/index.ts`
- verified that the active files touched in this phase no longer contain the broken `Ã/Â/â€` sequences that were being carried by legacy text

Validation performed after phase 5.8:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint reports only the same 9 pre-existing frontend warnings

Fidelity confirmation after extraction:

- `missionMaterializationService`, `aiMissionGenerationService`, `missionBlueprintPlanningService`, `missionPlanValidationService`, and `trainingPlanOrchestrationService` remain wired to the same runtime contracts
- AI mission generation still uses the same persistence and enrichment path, now backed by imported helper modules instead of entrypoint-local copies
- fallback daily mission generation still produces the same logical defaults, now via an injected payload builder in `missionMaterializationSupport.ts`
- no route contract or response shape was intentionally changed during this phase

Current size snapshot after phase 5.8:

- `src/worker/index.ts`: 4179 lines
- `src/worker/services/missionComposition.ts`: active shared source for mission composition/cycle helpers
- `src/worker/services/missionMaterializationSupport.ts`: active shared source for instruction parsing/materialization support helpers

Updated next safe cuts after phase 5.8:

- continue shrinking `src/worker/index.ts` by extracting the remaining generic bootstrap/auth/session helpers that are still entrypoint-local
- decide whether to modularize the auth/cors/session layer next or freeze the backend structure and move to a frontend-only cleanup phase
- if a broader text cleanup is desired later, run it outside this refactor patch as a dedicated normalization pass to keep structural changes auditable

### Worker phase 5.9 completed

This phase finalized the next safe cut in the worker entrypoint and then focused on readability of the remaining orchestration code without changing any runtime behavior.

New modules activated in this phase:

- `src/worker/core/sessionAuth.ts`
- `src/worker/routes/auth.ts`

Structural changes completed:

- session parsing, password hashing, session cookie generation, cookie expiration, and authenticated plan-guard middleware were extracted from `src/worker/index.ts` into `src/worker/core/sessionAuth.ts`
- auth route registration for:
  - `/api/auth/register`
  - `/api/auth/check-availability`
  - `/api/auth/login`
  was extracted into `src/worker/routes/auth.ts`
- the remaining worker entrypoint now stays focused on:
  - service composition
  - mission orchestration helpers that still bridge extracted modules
  - route registration
  - CORS/bootstrap/export guards
- `src/worker/index.ts` received short block comments describing the responsibility of each remaining section, keeping the file readable without introducing noisy commentary

Cleanup completed in this phase:

- removed the last stale inline auth/session helpers from `src/worker/index.ts`
- replaced the leftover legacy/English inline note in the mission expiry fallback with a consistent Portuguese comment
- normalized old section comments in the ranking, mini-game, AI, SPA fallback, and worker export regions so the file reads as one coherent entrypoint

Validation performed after phase 5.9:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- worker dry-run deploy passed
- lint reports only the same 9 pre-existing frontend warnings

Fidelity confirmation after extraction:

- auth routes still expose the same contracts and response flow, now registered from `routes/auth.ts`
- plan access, session resolution, and cleanup side-effects still execute through the same logic, now composed by `createAuthMiddleware`
- no route contract or response shape was intentionally changed during this phase
- the comments added to `src/worker/index.ts` are descriptive only and do not affect execution

Current size snapshot after phase 5.9:

- `src/worker/index.ts`: 3464 lines
- `src/worker/core/sessionAuth.ts`: active source for session/auth helpers
- `src/worker/routes/auth.ts`: active source for auth route registration

Updated next safe cuts after phase 5.9:

- if backend shrinkage continues, the next natural extraction target is the remaining CORS/bootstrap layer from `src/worker/index.ts`
- otherwise the worker entrypoint is now small and organized enough to freeze and shift effort to frontend structure cleanup or targeted behavioral validation

### Repo patch 1 completed

This patch started the repository-wide comment and encoding sweep outside the worker, with a focused pass on the frontend map/walking stack.

Files covered in this patch:

- `src/react-app/hooks/useMapService.ts`
- `src/react-app/hooks/useWalkingMission.ts`
- `src/react-app/components/WalkingMissionExecution.tsx`
- `src/react-app/services/openStreetMapService.ts`
- `src/react-app/pages/FoodAnalysis.tsx`

Changes completed:

- block comments were rewritten to be short, surgical, and responsibility-oriented in the walking/map hook and component flow
- noisy inline comments were reduced or normalized so those files read as functional sections instead of implementation chatter
- the OpenStreetMap service now documents its provider/configuration boundaries more clearly
- the Haversine calculation in `openStreetMapService.ts` now uses ASCII identifiers (`phi1`, `phi2`, `deltaPhi`, `deltaLambda`) instead of Greek symbols, reducing maintenance and encoding risk without changing behavior
- the known mojibake string in `FoodAnalysis.tsx` was corrected (`MediaPipe não está disponível para análise no momento.`)

Validation performed after repo patch 1:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Encoding sweep note:

- a targeted search for common mojibake sequences in `src/react-app` returned no remaining hits after this patch

Suggested next patch:

- continue with the native/health/map service layer:
  - `src/react-app/services/googleFit.ts`
  - `src/react-app/services/healthConnect.ts`
  - `src/react-app/services/native/*`
- then move to high-surface pages/components with user-facing text density:
  - `src/react-app/pages/FoodAnalysis.tsx`
  - `src/react-app/pages/Profile.tsx`
  - `src/react-app/pages/Friends.tsx`

### Repo patch 2 completed

This patch continued the repository-wide readability sweep in the frontend service layer, focusing on health integrations and native bridge modules.

Files covered in this patch:

- `src/react-app/services/googleFit.ts`
- `src/react-app/services/healthConnect.ts`
- `src/react-app/services/native/androidBridge.ts`
- `src/react-app/services/native/cameraService.ts`
- `src/react-app/services/native/metricsService.ts`
- `src/react-app/services/native/stepsService.ts`

Changes completed:

- top-level descriptions were rewritten so each service now states its responsibility clearly
- old explanatory comments were reduced to short, functional block comments
- the Android bridge, camera, metrics, and steps services now have explicit comments around:
  - native availability detection
  - source prioritization
  - event normalization
  - synchronization and polling
  - state consolidation
- no runtime contracts were changed in this patch

Validation performed after repo patch 2:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Encoding sweep note:

- the targeted scan over `src/react-app/services` returned no remaining common mojibake sequences after this patch

Suggested next patch:

- move to high-surface pages and dense user-facing flows:
  - `src/react-app/pages/FoodAnalysis.tsx`
  - `src/react-app/pages/Profile.tsx`
  - `src/react-app/pages/Friends.tsx`
- then continue with component-heavy pages that still carry older comment style or high text density

### Repo patch 3 completed

This patch continued the repository-wide readability sweep in the highest-surface frontend pages, preserving existing logic while normalizing comments and removing stale labels.

Files covered in this patch:

- `src/react-app/pages/FoodAnalysis.tsx`
- `src/react-app/pages/Profile.tsx`
- `src/react-app/pages/Friends.tsx`

Changes completed:

- JSX section comments were rewritten to be short, surgical, and responsibility-oriented
- stale labels such as `NOVO`, `Header`, `Section`, and similar generic markers were replaced with comments that describe the actual responsibility of each block
- noisy inline comments in camera/bootstrap code were reduced and normalized
- the scanner page keeps the same camera, gallery, preview, library, and result flow, but reads more clearly as independent UI sections
- the profile page now documents its computed blocks, identity column, stats area, rank area, and settings modal with simpler comments
- the friends page now documents search, tabs, online/offline lists, and sidebar responsibilities more directly
- no active mojibake was found in these three files during this patch; the earlier `FoodAnalysis` string fix remains preserved

Validation performed after repo patch 3:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- continue the repository-wide sweep in component-heavy pages and shared UI primitives
- prioritize files with dense JSX structure, user-facing copy, and older inline comment style before moving to broader utility cleanup

### Repo patch 4 completed

This patch continued the repository-wide readability sweep in the shared frontend shell and route composition layer.

Files covered in this patch:

- `src/react-app/components/AppPageShell.tsx`
- `src/react-app/components/PageLoader.tsx`
- `src/react-app/components/LoadingBall.tsx`
- `src/react-app/routes/AppRoutes.tsx`
- `src/react-app/routes/guards.tsx`
- `src/react-app/routes/RouteLoader.tsx`
- `src/react-app/routes/lazyPages.ts`

Changes completed:

- route composition now has simple block comments for public entry, billing flow, protected area, and fallback routing
- the guard layer now documents session resolution, anonymous redirects, plan access gating, and authenticated entry behavior
- the shared shell now documents its navigation, backdrop, content container, and mobile bottom navigation responsibilities
- shared loading wrappers now document how they reuse the common app loader without changing behavior
- no active mojibake was found in this group during the patch

Validation performed after repo patch 4:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- continue with higher-density page modules such as `Dashboard`, `Home`, `AIChat`, or `Shop`
- then move into shared utilities with older inline comment style or text-heavy fallback strings

### Repo patch 5 completed

This patch continued the repository-wide readability sweep in high-density frontend pages that mix shared data flows, large JSX trees, and user-facing copy.

Files covered in this patch:

- `src/react-app/pages/Dashboard.tsx`
- `src/react-app/pages/Home.tsx`
- `src/react-app/pages/AIChat.tsx`
- `src/react-app/pages/Shop.tsx`

Changes completed:

- `Dashboard.tsx` now documents its reconciliation guards, prefetch behavior, recovery states, hero metrics, mission summary, assistant tools, and floating action area with short responsibility-oriented comments
- `Home.tsx` now documents the landing/login structure by responsibility: top bar, hero, auth panel, form flow, and signup/trial CTA area
- `AIChat.tsx` now documents message normalization, local history restoration, persistence, topbar, message feed, composer, and history modal responsibilities
- `Shop.tsx` now documents the internal header, promotional surface, category filters, partner shelf, product card behavior, and coupon detail layout
- the old inline English/legacy comments left in this group were normalized to the same surgical style used in earlier patches
- no active mojibake was found in this group during the sweep

Validation performed after repo patch 5:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- continue with remaining high-surface pages such as `Achievements`, `Titles`, `MiniGames`, `Checkout`, `Onboarding`, and `PaymentPending`
- after that, move into shared utility modules and text-heavy helper files for the next encoding and comment sweep

### Repo patch 6 completed

This patch continued the repository-wide readability sweep in another group of high-surface pages with dense JSX, onboarding flow logic, and checkout status handling.

Files covered in this patch:

- `src/react-app/pages/Achievements.tsx`
- `src/react-app/pages/Titles.tsx`
- `src/react-app/pages/MiniGames.tsx`
- `src/react-app/pages/Checkout.tsx`
- `src/react-app/pages/Onboarding.tsx`
- `src/react-app/pages/PaymentPending.tsx`

Changes completed:

- `Achievements.tsx` now documents its hero, honored state, filter area, gallery, modal detail flow, and section-level grouping with short responsibility comments
- `Titles.tsx` now documents title sanitization, unlock text formatting, equip flow, active title surface, filters, and gallery rendering
- `MiniGames.tsx` now documents arena loading, skill loading, challenge creation, rival search, live duel surfaces, and history/sidebar composition
- `Checkout.tsx` now documents payload preparation, redirect orchestration, billing cycle selection, promo flow, and summary/payment surfaces while normalizing older inline English comments
- `Onboarding.tsx` now documents its session bootstrap, auth redirect, preview cleanup, debounced availability checks, step progression helpers, each major stage of the funnel, and the final page shell
- `Onboarding.tsx` was also normalized to UTF-8 before editing so the comment sweep could proceed safely, and the decorative footer separators were converted to ASCII-safe markers
- `PaymentPending.tsx` now documents polling lifecycle, retry/verification behavior, and the pending status action surfaces while normalizing older inline English comments
- no new active mojibake remained in this group after the patch

Validation performed after repo patch 6:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- continue into remaining text-heavy page modules and shared components not yet covered by the repository-wide comment sweep
- prioritize files that still combine dense UI markup, legacy inline notes, and user-visible copy before moving to smaller utility modules

### Repo patch 7 completed

This patch finished the remaining page-level sweep in `src/react-app/pages` and covered one dashboard support file that still concentrated shared layout primitives.

Files covered in this patch:

- `src/react-app/pages/Arena.tsx`
- `src/react-app/pages/dashboardHelpers.tsx`
- `src/react-app/pages/HealthTest.tsx`
- `src/react-app/pages/Landing.tsx`
- `src/react-app/pages/NotFound.tsx`
- `src/react-app/pages/PaymentRequired.tsx`
- `src/react-app/pages/Ranking.tsx`

Changes completed:

- `Arena.tsx` now documents its hero placeholder and feature teaser surfaces, and the layout indentation was normalized without changing rendering logic
- `dashboardHelpers.tsx` now documents the responsibilities of the shared icon, section header, and metric card helpers used by the dashboard
- `HealthTest.tsx` now documents its local test controls, health/map integration hooks, mutation handlers, and each diagnostic section of the page
- `Landing.tsx` now documents its scrolling helper, login CTA, top navigation, hero, metrics band, attributes grid, features grid, comparison table, pricing section, community proof, and footer structure
- `NotFound.tsx` now documents the delayed 404 achievement flow and the recovery card used to guide the user back into the app
- `PaymentRequired.tsx` now documents that it intentionally reuses the checkout flow as the payment gate
- `Ranking.tsx` now documents ranking normalization, parallel loading with cache reuse, mode switching, current-user summary, podium rendering, and the remaining competitors list
- no active mojibake was identified in this group during the review; false positives from valid Portuguese accents were ignored during the scan

Validation performed after repo patch 7:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- continue into shared components with dense UI behavior such as navigation, payments, missions, rank visuals, and status modals
- then move into services, hooks, and utility files to complete the repository-wide comment and encoding sweep

### Repo patch 8 completed

This patch moved from page modules into shared components that concentrate recurring UI behavior, navigation, rank display, payment feedback, and AI-driven helpers.

Files covered in this patch:

- `src/react-app/components/AIMissionGenerator.tsx`
- `src/react-app/components/AIRecommendations.tsx`
- `src/react-app/components/AppLoader.tsx`
- `src/react-app/components/BillingCycleSwitch.tsx`
- `src/react-app/components/BottomNav.tsx`
- `src/react-app/components/DesktopAppNavbar.tsx`
- `src/react-app/components/PaymentStatusPopup.tsx`
- `src/react-app/components/ProfileFriendsPanel.tsx`
- `src/react-app/components/TrainingRankDisplay.tsx`
- `src/react-app/components/AchievementShowcaseBadge.tsx`

Changes completed:

- `AIMissionGenerator.tsx` now documents active-mission filtering, baseline snapshotting, dashboard refresh triggering, temporary polling, notice cleanup, and the main generation action
- `AIRecommendations.tsx` now documents daily scheduling, payload normalization, section hierarchy, and the role of each recommendation card group
- `AppLoader.tsx` now documents the shared sizing contract used across the app
- `BillingCycleSwitch.tsx` now documents its isolated role inside checkout flows
- `BottomNav.tsx` now documents the fixed mobile navigation contract
- `DesktopAppNavbar.tsx` now documents icon hydration, cache-backed chrome hydration, the level chip, navigation area, and profile/settings actions
- `PaymentStatusPopup.tsx` now documents its tone mapping and lightweight modal role in checkout feedback
- `ProfileFriendsPanel.tsx` now documents cache use, loading/search/request flows, and the separation between search, pending requests, and confirmed friends
- `TrainingRankDisplay.tsx` now documents compact vs expanded rendering, fallback rank warnings, detail factors, and the local hook that calculates the rank snapshot
- `AchievementShowcaseBadge.tsx` now documents the context-sensitive badge rendering used in dashboard and profile surfaces
- no active mojibake was identified in this group during the review; the scan again produced false positives from valid Portuguese accents only

Validation performed after repo patch 8:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- cover the remaining large interaction-heavy components separately, especially `MissionCard.tsx` and `LevelUpModal.tsx`
- then finish the smaller wrapper/re-export components, UI primitives, hooks, services, and utility files so the repository-wide sweep reaches full coverage

### Repo patch 9 completed

This short patch focused on compatibility wrappers and UI primitives so the repository-wide sweep keeps a consistent baseline even in the smallest shared files.

Files covered in this patch:

- `src/react-app/components/authColorScheme.ts`
- `src/react-app/components/AuthThemeHeader.tsx`
- `src/react-app/components/ui/avatar.tsx`
- `src/react-app/components/ui/badge.tsx`
- `src/react-app/components/ui/button.tsx`
- `src/react-app/components/ui/card.tsx`
- `src/react-app/components/ui/input.tsx`

Changes completed:

- the wrapper files now explicitly document that they exist to preserve compatibility with older import paths
- `avatar.tsx` now documents its initials derivation and fallback rendering
- `badge.tsx` now documents its role as the generic tonal badge primitive
- `button.tsx` now documents the shared accessibility base, variant map, and default button type contract
- `card.tsx` now documents its role as the minimal themed surface wrapper
- `input.tsx` now documents its role as the themed text input primitive

Validation performed after repo patch 9:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- move into services, hooks, and utility files to finish the smaller but highly reused logic layer
- keep `MissionCard.tsx` and `LevelUpModal.tsx` for isolated dedicated patches because of their size and UI density

### Repo patch 10 completed

This patch covered highly reused services, utilities, theme helpers, and the canonical auth bootstrap hook so the repository-wide sweep reaches the shared logic layer instead of only UI surfaces.

Files covered in this patch:

- `src/react-app/services/achievementService.ts`
- `src/react-app/services/authService.ts`
- `src/react-app/services/profileService.ts`
- `src/react-app/utils/api.ts`
- `src/react-app/utils/achievementShowcase.ts`
- `src/react-app/utils/onboardingDraft.ts`
- `src/react-app/utils/coreSkillSeeds.ts`
- `src/react-app/theme/appTheme.ts`
- `src/react-app/theme/authColorScheme.ts`
- `src/react-app/theme/AuthThemeHeader.tsx`
- `src/react-app/theme/profileTheme.ts`
- `src/react-app/auth/hooks/useAuthBootstrap.ts`

Changes completed:

- service helpers now document their boundary responsibilities, especially session restoration, app-open notification, plan access checks, and route-not-found achievement dispatch
- `api.ts` now documents path normalization, cache-key strategy, JSON parsing, plan-required redirects, request timeouts, inflight deduplication, and cache invalidation
- `achievementShowcase.ts` now documents its mojibake repair, showcase-token parsing, rarity normalization, and style derivation flow
- `onboardingDraft.ts` now documents how the checkout draft is validated, restored, and cleared
- `coreSkillSeeds.ts` now documents its frontend compatibility role and the merged list used for UI rendering
- theme helpers now document storage resolution, CSS variable projection, dynamic font loading, and auth-theme synchronization
- `useAuthBootstrap.ts` now documents its session probing rules, protected-path behavior, theme application, route prefetching, and delayed 404 achievement fulfillment

Validation performed after repo patch 10:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- cover the remaining wrapper files plus the medium hooks/services still left in the shared logic layer
- keep `MissionCard.tsx`, `LevelUpModal.tsx`, and the native/health route of hooks for dedicated passes because they still concentrate more moving pieces than the patches above

### Repo patch 11 completed

This patch continued the sweep through the remaining lightweight wrappers and medium hooks tied to metrics, health state, and native-bridge compatibility.

Files covered in this patch:

- `src/react-app/hooks/useAuthBootstrap.ts`
- `src/react-app/hooks/useDailyMetrics.ts`
- `src/react-app/hooks/useHealthData.ts`
- `src/react-app/utils/appTheme.ts`
- `src/react-app/utils/theme.ts`
- `src/react-app/utils/index.ts`
- `src/react-app/services/native/androidBridge.ts`

Changes completed:

- the wrapper files now explicitly document that they preserve compatibility with the canonical modules
- `useDailyMetrics.ts` now documents its role as the React-facing adapter over the centralized metrics service
- `useHealthData.ts` now documents its translation layer from consolidated metrics into the historical health hook contract, including manual overrides used by the test surface
- `utils/index.ts` now documents the purpose of the shared `cn` helper
- `androidBridge.ts` retains its existing native-bridge comments and now sits inside a more uniform commented layer around the rest of the compatibility wrappers

Validation performed after repo patch 11:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- dedicate isolated passes to `MissionCard.tsx` and `LevelUpModal.tsx`
- then finish the remaining larger native/health services and hooks such as `stepsService.ts`, `metricsService.ts`, `cameraService.ts`, `googleFit.ts`, `healthConnect.ts`, `useMapService.ts`, and `useWalkingMission.ts`

### Repo patch 12 completed

This isolated patch covered the level-up celebration modal so one of the densest shared overlays now follows the same commenting and readability baseline as the rest of the frontend.

Files covered in this patch:

- `src/react-app/components/LevelUpModal.tsx`

Changes completed:

- documented the attribute metadata, unlock-window helpers, cached hydration flow, summary-card derivation, unlocked-content derivation, and share payload handling
- added concise section comments for the celebration shell, hero, summary grid, attribute bars, unlock list, and footer actions
- normalized the leftover English fallback comment so the whole file now reads with the same style as the rest of the audit sweep

Validation performed after repo patch 12:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- move into the native and health-related service layer before returning to the last large mission card surface

### Repo patch 13 completed

This patch focused on the native/health service layer so the repository-wide sweep now reaches the bridge-facing files that coordinate camera, metrics, step tracking, Google Fit, and Health Connect.

Files covered in this patch:

- `src/react-app/services/native/cameraService.ts`
- `src/react-app/services/native/metricsService.ts`
- `src/react-app/services/native/stepsService.ts`
- `src/react-app/services/googleFit.ts`
- `src/react-app/services/healthConnect.ts`

Changes completed:

- normalized service comments and method descriptions across the native media, metrics, and health integrations
- repaired visible text quality issues in user-facing native camera and metrics fallback messages
- normalized the unavailable-source label in the step service to the proper accented display text
- preserved the existing fallback contracts for Google Fit and Health Connect while aligning their documentation with the audited style

Validation performed after repo patch 13:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- finish the last large mission surface in `MissionCard.tsx`, then continue with any remaining repo-wide text-quality sweep

### Repo patch 14 completed

This patch covered the heaviest remaining mission UI surface so the core mission card, mission details, and mission execution flow now share the same structural commenting baseline as the rest of the frontend.

Files covered in this patch:

- `src/react-app/components/MissionCard.tsx`

Changes completed:

- documented the helper clusters responsible for metric normalization, progress formatting, display-title cleanup, focus-label selection, unilateral-detection, and media resolution
- documented the execution modal flow, including timer effects, rep controls, finish handling, progress rendering, and completion overlay responsibilities
- documented the mission card orchestration layer, including derived state, lazy detail loading, chrome synchronization, compact/default trigger rendering, details modal sections, sticky action behavior, and walking-mission routing
- normalized the visible copy for the inline rest label to `Descanso entre séries`

Validation performed after repo patch 14:

- `npm run build`
- `npm run lint`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings

Suggested next patch:

- continue the remaining project-wide sweep with a pass focused on any still-uncovered files and a final manual review of text-quality hotspots

### Repo patch 15 completed

This patch returned to the worker so the audit sweep keeps advancing across the full project instead of only the React surface.

Files covered in this patch:

- `src/worker/routes/auth.ts`
- `src/worker/routes/onboarding.ts`
- `src/worker/routes/profile.ts`

Changes completed:

- documented the responsibility of each route group and the key route blocks inside auth, onboarding, and profile
- clarified the route-level flow for registration, availability checks, login, onboarding submission, profile customization, goal changes, and feedback delivery
- normalized visible response text in a few remaining spots such as `Dados de identidade inválidos`, `saúde_geral`, and `Não foi possível enviar o feedback agora.`

Validation performed after repo patch 15:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings
- worker dry-run deploy passed

Suggested next patch:

- continue the worker sweep with the larger remaining AI route surface, focusing first on comment organization and mojibake cleanup in user-facing text blocks

### Repo patch 16 completed

This patch covered the largest remaining AI route module in the worker so the chat, recommendations, mission-generation status, and food-analysis flows now follow the same documentation and text-quality baseline as the rest of the audited backend.

Files covered in this patch:

- `src/worker/routes/ai.ts`

Changes completed:

- documented the responsibility of the USDA helper, RapidAPI fallback helper, OCR nutrition parser, mission-generation status route, chatbot route, recommendation fallback builder, workout suggestion route, visual food-identification helper, and food-analysis pipeline
- normalized user-facing Portuguese text in the AI chat prompt guidance and chat plan-preference notice
- repaired recommendation fallback copy that was still accentless in multiple places, such as `Força progressiva`, `Constância semanal`, `Constituição`, and the progression/motivation messages
- fixed the OCR food-analysis label text to `dados extraídos do rótulo`
- preserved all route contracts, fallback branches, and upstream-calling logic

Validation performed after repo patch 16:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings
- worker dry-run deploy passed

Suggested next patch:

- keep advancing through the remaining worker route modules with smaller patches, prioritizing billing, shop, missions, and any leftover text-quality hotspots

### Repo patch 17 completed

This patch moved to the smaller commerce route modules to keep backend coverage progressing without waiting for a larger `missions` pass.

Files covered in this patch:

- `src/worker/routes/billing.ts`
- `src/worker/routes/shop.ts`

Changes completed:

- documented the purpose of promo validation, promo application, checkout start, subscription status, and webhook normalization in the billing routes
- documented the in-memory cache helpers, shop product listing, purchase flow, and order-history flow in the shop routes
- normalized the billing route-group header comment into the same concise style used across the audit
- preserved the existing checkout, transaction, idempotency, and cache invalidation logic without altering payload shape or response rules

Validation performed after repo patch 17:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings
- worker dry-run deploy passed

Suggested next patch:

- continue with the next heavier worker route, preferably `src/worker/routes/missions.ts`, or switch back to any remaining large frontend surface that still lacks block comments

### Repo patch 18 completed

This patch opened the largest remaining mission route surface, but kept the scope intentionally narrow so the audit could move forward without risking the mission-completion logic.

Files covered in this patch:

- `src/worker/routes/missions.ts`

Changes completed:

- documented the purpose of the mission list route, mission detail route, standard mission generation route, AI special-mission generation route, and mission-completion route group
- normalized visible response text in the mission detail validation error to `Mission id inválido`
- normalized the weekly/monthly completion guard message to `Missões semanais e mensais não podem ser concluídas manualmente. O progresso acontece automaticamente pelas missões diárias compatíveis.`
- preserved the existing cache, hydration, translation, generation, and completion flows without touching the persistence logic

Validation performed after repo patch 18:

- `npm run build`
- `npm run lint`
- `npm run test:worker`

Validation result:

- build passed
- lint reports only the same 9 pre-existing frontend warnings
- worker dry-run deploy passed

Suggested next patch:

- continue the deeper mission-route sweep inside `src/worker/routes/missions.ts`, focusing on internal helper blocks and any remaining visible text cleanups
