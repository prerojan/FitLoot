# Estrutura Atual do Projeto FitLoot

Este documento descreve a estrutura atual do repositório com foco em manutenção.
O objetivo aqui nao e redesenhar a arquitetura, e sim deixar claro qual arquivo atua como pai de cada fluxo e quais filhas/helpers ele consome.

## 1. Visao geral da raiz

### Arquivos e pastas principais

- `src/`
  - Contem o frontend web, o worker backend e modulos compartilhados.
- `android/`
  - Contem o app Android nativo que hospeda o web app em `WebView` e expoe a bridge nativa.
- `public/`
  - Contem assets publicos do frontend.
- `docs/`
  - Contem auditorias, guias operacionais e agora este mapa estrutural.
- `migrations/`
  - Contem migracoes usadas pelo ambiente de dados.
- `scripts/`
  - Contem scripts utilitarios do projeto.
- `mcp-orchestrator/`
  - Contem infraestrutura auxiliar usada pelo projeto fora da arvore principal de app.

### Entradas de configuracao mais relevantes

- `package.json`
  - Arquivo pai dos scripts de build, lint e teste.
- `vite.config.ts`
  - Configuracao pai do frontend Vite.
- `vitest.config.ts`
  - Configuracao pai da suite de testes local.
- `wrangler.json`
  - Configuracao pai do Cloudflare Worker.
- `android/app/build.gradle`
  - Configuracao pai do app Android.

## 2. Frontend Web (`src/react-app`)

### Fluxo principal de entrada

- `src/react-app/main.tsx`
  - Arquivo pai que monta o app React no DOM.
  - Filhas diretas:
    - `src/react-app/App.tsx`
    - `src/react-app/index.css`

- `src/react-app/App.tsx`
  - Arquivo pai do app web.
  - Responsabilidade:
    - montar providers de autenticacao, tema e chrome da aplicacao
    - iniciar bootstrap de sessao
    - delegar a navegacao para o roteador
  - Filhas/helpers diretas:
    - `src/react-app/auth/constants.ts`
    - `src/react-app/auth/context.ts`
    - `src/react-app/auth/hooks/useAuthBootstrap.ts`
    - `src/react-app/contexts/appChrome.ts`
    - `src/react-app/contexts/theme.ts`
    - `src/react-app/theme/appTheme.ts`
    - `src/react-app/theme/profileTheme.ts`
    - `src/react-app/utils/api.ts`
    - `src/react-app/routes/AppRoutes.tsx`
    - `src/react-app/routes/RouteLoader.tsx`

### Roteamento e carregamento de paginas

- `src/react-app/routes/AppRoutes.tsx`
  - Arquivo pai do mapa de rotas.
  - Responsabilidade:
    - associar cada rota publica/privada a sua pagina
    - aplicar guards sem misturar isso ao bootstrap do app
  - Filhas/helpers diretas:
    - `src/react-app/routes/guards.tsx`
    - `src/react-app/routes/lazyPages.ts`
    - `src/react-app/routes/RouteLoader.tsx`

- `src/react-app/routes/lazyPages.ts`
  - Arquivo pai do carregamento lazy das paginas.
  - Filhas diretas:
    - `src/react-app/pages/Home.tsx`
    - `src/react-app/pages/Onboarding.tsx`
    - `src/react-app/pages/Checkout.tsx`
    - `src/react-app/pages/PaymentPending.tsx`
    - `src/react-app/pages/Dashboard.tsx`
    - `src/react-app/pages/Profile.tsx`
    - `src/react-app/pages/Titles.tsx`
    - `src/react-app/pages/Friends.tsx`
    - `src/react-app/pages/Shop.tsx`
    - `src/react-app/pages/Ranking.tsx`
    - `src/react-app/pages/MiniGames.tsx`
    - `src/react-app/pages/AIChat.tsx`
    - `src/react-app/pages/Achievements.tsx`
    - `src/react-app/pages/FoodAnalysis.tsx`
    - `src/react-app/pages/HealthTest.tsx`
    - `src/react-app/pages/Landing.tsx`
    - `src/react-app/pages/NotFound.tsx`

- `src/react-app/routes/guards.tsx`
  - Helpers de acesso para rotas protegidas e fluxos que dependem de sessao/plano.

## 3. Areas canônicas do frontend

### Autenticacao

- `src/react-app/auth/`
  - Pasta pai da autenticacao canônica.
  - Filhas:
    - `constants.ts`
    - `context.ts`
    - `types.ts`
    - `hooks/useAuthBootstrap.ts`

### Tema

- `src/react-app/theme/`
  - Pasta pai da configuracao de tema.
  - Filhas:
    - `appTheme.ts`
    - `profileTheme.ts`
    - `authColorScheme.ts`
    - `AuthThemeHeader.tsx`

### Estilos globais

- `src/react-app/index.css`
  - Arquivo pai de entrada de estilos do frontend.
  - Filhas diretas:
    - `src/react-app/styles/patterns/foundation.css`
    - `src/react-app/styles/patterns/components.css`
    - `src/react-app/styles/patterns/utilities.css`

- `src/react-app/styles/patterns/`
  - Pasta pai dos padroes CSS globais.
  - Responsabilidade:
    - `foundation.css`: tokens, base visual e reset estrutural
    - `components.css`: classes padrao de componentes
    - `utilities.css`: utilitarios de apoio visual

## 4. Componentes compartilhados do frontend

- `src/react-app/components/AppPageShell.tsx`
  - Pai do layout padrao interno das paginas autenticadas.

- `src/react-app/components/DesktopAppNavbar.tsx`
  - Pai da navegacao principal desktop.

- `src/react-app/components/BottomNav.tsx`
  - Pai da navegacao principal mobile.

- `src/react-app/components/PageLoader.tsx`
  - Loader de pagina para transicoes internas.

- `src/react-app/components/LoadingBall.tsx`
  - Loader visual reutilizavel.

- `src/react-app/components/WalkingMissionExecution.tsx`
  - Arquivo pai do fluxo de missao de caminhada em execucao.
  - Filhas/helpers diretas:
    - `src/react-app/hooks/useWalkingMission.ts`
    - `src/react-app/hooks/useMapService.ts`
    - `src/react-app/services/openStreetMapService.ts`
    - `src/react-app/services/native/stepsService.ts`
    - `src/react-app/services/native/metricsService.ts`

### Cluster `MissionCard`

- `src/react-app/components/MissionCard.tsx`
  - Arquivo pai do card de missao.
  - Responsabilidade:
    - renderizar estado da missao
    - abrir detalhes e execucao
    - integrar recompensas, progresso e variacoes do card
  - Filhas/helpers diretas:
    - `src/react-app/components/mission-card/helpers.ts`
    - `src/react-app/components/mission-card/MissionExecutionModal.tsx`

- `src/react-app/components/mission-card/MissionExecutionModal.tsx`
  - Filha do `MissionCard.tsx` dedicada ao modal de execucao.

- `src/react-app/components/mission-card/helpers.ts`
  - Helpers puros usados pelo `MissionCard.tsx`.

## 5. Paginas com composicao interna ja separada

### `Onboarding`

- `src/react-app/pages/Onboarding.tsx`
  - Arquivo pai do fluxo de onboarding.
  - Responsabilidade:
    - controlar etapas
    - manter estado do formulario
    - orquestrar submit final
  - Filhas/helpers diretas:
    - `src/react-app/pages/onboarding/types.ts`
    - `src/react-app/pages/onboarding/constants.ts`
    - `src/react-app/pages/onboarding/helpers.ts`
    - `src/react-app/utils/onboardingDraft.ts`

- `src/react-app/pages/onboarding/types.ts`
  - Tipos usados pelo fluxo de onboarding.

- `src/react-app/pages/onboarding/constants.ts`
  - Defaults, listas e metadados de etapas.

- `src/react-app/pages/onboarding/helpers.ts`
  - Helpers puros de validacao, transformacao e suporte ao fluxo.

### `FoodAnalysis`

- `src/react-app/pages/FoodAnalysis.tsx`
  - Arquivo pai do fluxo de analise de alimentos.
  - Responsabilidade:
    - controlar camera/upload
    - orquestrar analise
    - renderizar preview, resultado e biblioteca salva
  - Filhas/helpers diretas:
    - `src/react-app/pages/food-analysis/types.ts`
    - `src/react-app/pages/food-analysis/helpers.ts`
    - `src/react-app/pages/food-analysis/MacroCard.tsx`
    - `src/react-app/pages/food-analysis/SavedFoodsLibraryPanel.tsx`
    - `src/react-app/services/native/cameraService.ts`

- `src/react-app/pages/food-analysis/MacroCard.tsx`
  - Componente filho para exibicao de macro nutriente.

- `src/react-app/pages/food-analysis/SavedFoodsLibraryPanel.tsx`
  - Componente filho para biblioteca de alimentos salvos.

- `src/react-app/pages/food-analysis/helpers.ts`
  - Helpers puros da analise de alimentos.

- `src/react-app/pages/food-analysis/types.ts`
  - Tipos locais usados por `FoodAnalysis.tsx`.

### `Dashboard`

- `src/react-app/pages/Dashboard.tsx`
  - Arquivo pai do painel principal do usuario.
  - Filhas/helpers diretas:
    - `src/react-app/pages/dashboardHelpers.tsx`
    - `src/react-app/pages/dashboardUtils.ts`
    - `src/react-app/components/MissionCard.tsx`
    - `src/react-app/components/LevelUpModal.tsx`

## 6. Hooks e services do frontend

### Hooks de negocio

- `src/react-app/hooks/useWalkingMission.ts`
  - Pai da logica de tracking de caminhada.
  - Filhas/helpers diretas:
    - `src/react-app/services/native/stepsService.ts`
    - `src/react-app/services/native/metricsService.ts`
    - `src/react-app/services/openStreetMapService.ts`

- `src/react-app/hooks/useMapService.ts`
  - Pai da logica de mapa, rotas e geometria de caminhada.
  - Filha/helper direta:
    - `src/react-app/services/openStreetMapService.ts`

- `src/react-app/hooks/useHealthData.ts`
  - Pai da leitura de dados de saude para a UI.
  - Filhas/helpers diretas:
    - `src/react-app/services/healthConnect.ts`
    - `src/react-app/services/googleFit.ts`
    - `src/react-app/services/native/metricsService.ts`

### Services de integracao

- `src/react-app/services/native/androidBridge.ts`
  - Arquivo pai da ponte JS para o Android nativo.

- `src/react-app/services/native/cameraService.ts`
  - Wrapper pai de camera nativa/bridge.

- `src/react-app/services/native/stepsService.ts`
  - Wrapper pai de contagem de passos nativa.

- `src/react-app/services/native/metricsService.ts`
  - Wrapper pai de metricas nativas agregadas.

- `src/react-app/services/authService.ts`
  - Cliente pai do fluxo de autenticacao.

- `src/react-app/services/profileService.ts`
  - Cliente pai do fluxo de perfil.

- `src/react-app/services/openStreetMapService.ts`
  - Service pai das consultas de mapa e geocodificacao.

- `src/react-app/utils/api.ts`
  - Camada pai de fetch/cache JSON do frontend.

## 7. Backend Worker (`src/worker`)

### Composicao principal

- `src/worker/index.ts`
  - Arquivo pai do backend Worker.
  - Responsabilidade:
    - criar a aplicacao Hono
    - aplicar CORS
    - montar middleware de autenticacao
    - registrar as rotas por dominio
    - conectar os services internos de missoes, IA, assinatura e gamificacao
  - Filhas/helpers diretas:
    - `src/worker/core/constants.ts`
    - `src/worker/core/cors.ts`
    - `src/worker/core/database.ts`
    - `src/worker/core/errors.ts`
    - `src/worker/core/providerConfig.ts`
    - `src/worker/core/sessionAuth.ts`
    - `src/worker/core/types.ts`
    - `src/worker/routes/*.ts`
    - `src/worker/services/*.ts`

### Core

- `src/worker/core/cors.ts`
  - Pai da resolucao de origem e headers CORS.

- `src/worker/core/sessionAuth.ts`
  - Pai da sessao via cookie, hashing e middleware de auth.

- `src/worker/core/database.ts`
  - Helpers pai de acesso e compatibilidade de schema.

- `src/worker/core/providerConfig.ts`
  - Leitura pai de chaves/configuracoes de provedores externos.

### Rotas por dominio

- `src/worker/routes/auth.ts`
  - Rotas de autenticacao e sessao.

- `src/worker/routes/onboarding.ts`
  - Rotas do onboarding e preferencias iniciais.

- `src/worker/routes/profile.ts`
  - Rotas de perfil do usuario.

- `src/worker/routes/missions.ts`
  - Arquivo pai do dominio de missoes.
  - Filhas/helpers mais relevantes:
    - `src/worker/services/missionPresentation.ts`
    - `src/worker/services/missionProgression.ts`
    - `src/worker/services/missionRuntimeState.ts`
    - `src/worker/services/legacyMissionRepair.ts`
    - `src/worker/services/gamificationLifecycle.ts`

- `src/worker/routes/ai.ts`
  - Arquivo pai das rotas de IA.
  - Filhas/helpers mais relevantes:
    - `src/worker/services/aiTransport.ts`
    - `src/worker/services/aiMissionGeneration.ts`
    - `src/worker/services/exerciseEnrichment.ts`

- `src/worker/routes/billing.ts`
  - Rotas de checkout, assinatura e cobranca.
  - Filhas/helpers mais relevantes:
    - `src/worker/services/subscriptionLifecycle.ts`
    - `src/worker/services/userPlanAccess.ts`
    - `src/worker/services/cakto.ts`

- `src/worker/routes/shop.ts`
  - Rotas da loja e itens ligados ao app.

- `src/worker/routes/friends.ts`
  - Rotas sociais de amizade.

- `src/worker/routes/health.ts`
  - Rotas de saude e metricas agregadas.

- `src/worker/routes/metrics.ts`
  - Rotas de metricas auxiliares e snapshots.

- `src/worker/routes/progression.ts`
  - Rotas de progresso, niveis e exibicao de avancos.

- `src/worker/routes/achievements.ts`
  - Rotas de conquistas e titulos.

### Services de dominio

#### Cluster de missoes

- `src/worker/services/missionGeneration.ts`
  - Pai da orquestracao principal de geracao de plano.

- `src/worker/services/missionBlueprintPlanning.ts`
  - Pai do planejamento de blueprint de missoes.

- `src/worker/services/missionPlanValidation.ts`
  - Pai da validacao do plano estruturado antes da persistencia.

- `src/worker/services/missionPlanPersistence.ts`
  - Pai da persistencia e reparo do plano.

- `src/worker/services/missionMaterialization.ts`
  - Pai da materializacao das missoes em registros concretos.

- `src/worker/services/missionMaterializationSupport.ts`
  - Helpers puros usados na materializacao.

- `src/worker/services/missionPresentation.ts`
  - Pai da normalizacao e apresentacao de missoes para resposta HTTP.

- `src/worker/services/missionComposition.ts`
  - Pai das regras de composicao de descricao, metricas e atributos.

- `src/worker/services/missionParsing.ts`
  - Pai do parsing de conteudos estruturados.

- `src/worker/services/missionProgression.ts`
  - Pai do impacto de conclusao de missoes em skills/atributos.

- `src/worker/services/missionRuntimeState.ts`
  - Pai do cache e refresh de estado de missao em runtime.

- `src/worker/services/legacyMissionRepair.ts`
  - Pai da compatibilidade e reparos para dados legados de missao.

#### Cluster de IA e treino

- `src/worker/services/aiTransport.ts`
  - Pai de chamadas para provedores de IA e fallbacks.

- `src/worker/services/aiMissionGeneration.ts`
  - Pai do fluxo de geracao de missoes com IA.

- `src/worker/services/exerciseEnrichment.ts`
  - Pai do enriquecimento de exercicios vindo de IA/catalogo.

- `src/worker/services/trainingPlanOrchestration.ts`
  - Pai da orquestracao de plano de treino e top-up.

- `src/worker/services/trainingPlan.ts`
  - Regras centrais do plano de treino.

- `src/worker/services/trainingPlanPreferences.ts`
  - Preferencias e normalizacao de escolha de treino.

#### Cluster de assinatura e acesso

- `src/worker/services/subscriptionLifecycle.ts`
  - Pai do ciclo de assinatura, checkout e webhook.

- `src/worker/services/userPlanAccess.ts`
  - Pai da decisao de acesso por plano/assinatura.

#### Cluster de gamificacao

- `src/worker/services/gamificationLifecycle.ts`
  - Pai da aplicacao de conquistas, titulos e progresso.

- `src/worker/services/gamificationCatalog.ts`
  - Pai da leitura/catalogo de seeds de gamificacao.

- `src/worker/services/gamification/`
  - Pasta pai dos seeds de dominio.
  - Filhas:
    - `achievementSeeds.ts`
    - `skillSeeds.ts`
    - `stageProgressionSeeds.ts`
    - `titleSeeds.ts`
    - `types.ts`

#### Processamento agendado

- `src/worker/services/backgroundProcessing.ts`
  - Pai do fluxo agendado do worker.
  - Filhas/helpers diretas:
    - `src/worker/services/dailyReset.ts`
    - `src/worker/services/missionGeneration.ts`
    - `src/worker/services/missionRuntimeState.ts`

## 8. Modulos compartilhados (`src/shared`)

- `src/shared/types.ts`
  - Pai dos tipos compartilhados entre frontend e worker.

- `src/shared/exerciseCatalog.ts`
  - Pai do catalogo de exercicios e nomes suportados.

- `src/shared/missionLocalization.ts`
  - Pai da localizacao de texto de missoes.

- `src/shared/coreSkillSeeds.ts`
  - Pai dos seeds compartilhados de skill base.

- `src/shared/trainingLevels.ts`
  - Pai da logica compartilhada de ranking/treino usada no frontend.

## 9. Android nativo (`android/app/src/main`)

### Entradas principais

- `android/app/src/main/AndroidManifest.xml`
  - Arquivo pai da declaracao do app Android.

- `android/app/src/main/java/com/fitloot/MainActivity.kt`
  - Arquivo pai da abertura do app Android.
  - Responsabilidade:
    - hospedar o `WebView`
    - configurar a bridge JS nativa
    - coordenar permissao e ciclo principal do app
  - Filhas/helpers diretas:
    - `android/app/src/main/java/com/fitloot/WebAppInterface.kt`
    - `android/app/src/main/java/com/fitloot/bridge/FitLootWebAppConfig.kt`
    - `android/app/src/main/java/com/fitloot/bridge/FitLootWebViewConfigurator.kt`
    - `android/app/src/main/res/layout/activity_main.xml`

- `android/app/src/main/java/com/fitloot/WebAppInterface.kt`
  - Arquivo pai da bridge entre JavaScript e Android nativo.
  - Filhas/helpers diretas:
    - `android/app/src/main/java/com/fitloot/StepCounter.kt`
    - `android/app/src/main/java/com/fitloot/health/HealthConnectMetricsProvider.kt`
    - `android/app/src/main/java/com/fitloot/health/HealthConnectPermissionCoordinator.kt`
    - `android/app/src/main/java/com/fitloot/media/NativeMediaPayloadFactory.kt`
    - `android/app/src/main/java/com/fitloot/bridge/WebEventDispatcher.kt`
    - `android/app/src/main/java/com/fitloot/bridge/NativeBridgeContract.kt`

- `android/app/src/main/java/com/fitloot/CameraActivity.kt`
  - Arquivo pai do fluxo de camera nativa Android.
  - Filhas/helpers diretas:
    - `android/app/src/main/java/com/fitloot/media/NativeMediaPayloadFactory.kt`
    - `android/app/src/main/res/layout/activity_camera.xml`
    - `android/app/src/main/res/drawable/scanner_*.xml`

- `android/app/src/main/java/com/fitloot/StepCounter.kt`
  - Pai do fluxo de passos exposto para o web app.
  - Filha/helper direta:
    - `android/app/src/main/java/com/fitloot/health/SensorStepTracker.kt`

### Bridge Android

- `android/app/src/main/java/com/fitloot/bridge/FitLootWebAppConfig.kt`
  - Define a URL/base web carregada pelo app Android.

- `android/app/src/main/java/com/fitloot/bridge/FitLootWebViewConfigurator.kt`
  - Centraliza a configuracao do `WebView`.

- `android/app/src/main/java/com/fitloot/bridge/NativeBridgeContract.kt`
  - Padroniza nomes e contratos da ponte JS nativa.

- `android/app/src/main/java/com/fitloot/bridge/WebEventDispatcher.kt`
  - Distribui eventos nativos de volta para o frontend.

### Health e media

- `android/app/src/main/java/com/fitloot/health/HealthConnectMetricsProvider.kt`
  - Provedor pai de metricas do Health Connect.

- `android/app/src/main/java/com/fitloot/health/HealthConnectPermissionCoordinator.kt`
  - Coordenador pai de permissao do Health Connect.

- `android/app/src/main/java/com/fitloot/health/NativeMetricsSnapshot.kt`
  - Snapshot nativo serializavel das metricas.

- `android/app/src/main/java/com/fitloot/health/SensorStepTracker.kt`
  - Tracker pai de sensor de passos.

- `android/app/src/main/java/com/fitloot/media/NativeMediaPayloadFactory.kt`
  - Fabrica pai dos payloads de midia retornados para o web app.

## 10. Documentacao

- `docs/audits/2026-03-28-structure-audit.md`
  - Auditoria estrutural acumulada da refatoracao.

- `docs/release-artifacts.md`
  - Regra de release e artefatos gerados.

- `docs/architecture/project-structure-map.md`
  - Este arquivo.

## 11. Observacoes de manutencao

- A estrutura canônica atual do frontend esta em `auth/`, `theme/`, `components/`, `pages/`, `routes/` e `services/`.
- A estrutura canônica atual do backend esta em `core/`, `routes/` e `services/`.
- Alguns arquivos legados ou de compatibilidade ainda permanecem no repositório por decisao de preservacao, mesmo quando nao sao o caminho canônico principal.
- Quando um arquivo pai crescer demais, a regra atual do projeto e extrair:
  - tipos locais
  - constantes do fluxo
  - helpers puros
  - blocos visuais coesos
  - services/hook de dominio
  sem mudar copy, layout, contrato HTTP ou UX existente.
