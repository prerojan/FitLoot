# Auditoria Android + WebApp

Data: 2026-04-03

## Objetivo

Avaliar o estado atual do ambiente Android do FitLoot, identificar fragilidades para hospedar o webapp como nucleo do aplicativo e mapear o que precisa ser adaptado:

- no Android, para servir com seguranca e estabilidade a camada web
- no webapp, para operar de forma nativa dentro do container Android sem perder estrutura e design

## Resumo executivo

O projeto ja possui uma base hibrida funcional: o Android abre um `WebView`, injeta uma bridge nativa para camera e metricas de saude, e o webapp React continua sendo a interface principal. Isso confirma que a direcao "webapp como nucleo" e viavel.

O problema e que o ambiente atual ainda nao e portavel nem resiliente o bastante para distribuicao e manutencao. Hoje o Android depende fortemente de um deploy remoto especifico em `https://fitloot.vercel.app`, a politica de confianca do `WebView` e fraca, o build Android nao e reproduzivel via CLI, e parte da experiencia visual/funcional do webapp depende de CDNs externos.

## O que esta solido hoje

- O nucleo web compila em producao com sucesso via `npm run build`.
- Os testes unitarios do projeto passaram via `npm run test:unit`.
- A validacao estatica leve passou via `npm run check:lite`.
- A integracao Android ja possui bridge nativa explicita para:
  - permissao de camera
  - captura de foto
  - selecao de imagem da galeria
  - leitura de metricas de passos
  - Health Connect
- O fluxo de camera nativa ja entrega `base64` para o webapp, o que evita depender apenas de leitura `file://`.

## Achados criticos

### 1. O build Android nao e reproduzivel no estado atual

Evidencia:

- `.\gradlew.bat app:assembleInternal` falhou com:
  - `Could not find or load main class org.gradle.wrapper.GradleWrapperMain`
- Em `android/gradle/wrapper/` existe apenas `gradle-wrapper.properties`.
- O arquivo esperado `gradle-wrapper.jar` nao esta presente.

Impacto:

- nao ha build Android confiavel por linha de comando
- CI/CD Android fica bloqueado
- qualquer nova maquina ou ambiente de automacao depende de Android Studio/local workaround

Arquivos relacionados:

- `android/gradle/wrapper/gradle-wrapper.properties`
- `android/gradlew.bat`

### 2. O app Android esta acoplado a um host remoto unico

Evidencia:

- `android/app/src/main/java/com/fitloot/bridge/FitLootWebAppConfig.kt`
  - `TRUSTED_BASE_URL = "https://fitloot.vercel.app"`
  - `WEB_APP_URL = "$TRUSTED_BASE_URL/home"`
- `src/react-app/utils/api.ts`
  - em producao o webapp assume `API_URL = ""`, portanto depende de `same-origin`
- `vercel.json`
  - reescreve `/api/*` para um Worker remoto
- `src/react-app/App.tsx`
  - usa `BrowserRouter`

Impacto:

- o APK nao hospeda o webapp; ele o consome remotamente
- migrar o webapp para bundle local, asset embarcado, dominio proprio ou ambiente de staging exige retrabalho
- autenticacao, rotas e chamadas `/api` dependem da topologia atual de Vercel + rewrite

Conclusao:

Hoje o Android e um container remoto do deploy web, nao um ambiente de hospedagem adaptavel ao webapp.

### 3. A verificacao de URL confiavel no WebView e insegura

Evidencia:

- `FitLootWebAppConfig.isTrustedUrl(url)` usa `url.startsWith(TRUSTED_BASE_URL)`

Impacto:

- uma URL como `https://fitloot.vercel.app.evil.tld/...` seria tratada como confiavel
- isso amplia o risco de manter paginas indevidas dentro do `WebView`
- combinado com `addJavascriptInterface`, vira um risco serio de exposicao da bridge nativa

Recomendacao:

- validar `scheme`, `host` e opcionalmente `port` via parser de URI
- restringir explicitamente hosts permitidos

### 4. O WebView esta com superficie de ataque maior do que o necessario

Evidencia:

- `android/app/src/main/java/com/fitloot/bridge/FitLootWebViewConfigurator.kt`
  - `javaScriptEnabled = true`
  - `allowFileAccess = true`
  - `allowContentAccess = true`
- `android/app/src/main/AndroidManifest.xml`
  - `android:usesCleartextTraffic="true"`

Impacto:

- mais permissao do que o necessario para uma app que deveria operar sobre HTTPS controlado
- em caso de XSS no webapp ou navegacao indevida, a bridge nativa fica mais sensivel
- `cleartext` aberto sem necessidade dificulta endurecimento de rede

Recomendacao:

- desabilitar `allowFileAccess` e `allowContentAccess` se nao forem estritamente necessarios
- remover `usesCleartextTraffic=true` se nao houver endpoint HTTP indispensavel
- considerar endurecer a bridge para apenas rotas/hosts validados

## Achados de alto impacto estrutural

### 5. O webapp nao esta pronto para ser hospedado localmente dentro do app

Evidencia:

- `src/react-app/App.tsx` usa `BrowserRouter`
- `src/react-app/utils/api.ts` assume `/api` same-origin em producao
- `vercel.json` faz o papel de cola entre frontend e Worker

Impacto:

- se o objetivo for embarcar o `dist` no APK, `BrowserRouter` e `same-origin /api` deixam de ser triviais
- cookies de sessao, redirects e bootstrap de autenticacao passam a depender de uma estrategia nova

Implicacao pratica:

Existem dois caminhos validos:

1. manter o modelo remoto, mas endurecendo o Android para funcionar como shell nativo robusto
2. transformar o Android em hospedeiro real do webapp, com bundle local + estrategia explicita de API/auth

Hoje o projeto esta no caminho 1.

### 6. O design e partes da experiencia dependem de recursos externos

Evidencia:

- `src/react-app/styles/patterns/foundation.css`
  - importa Google Fonts
- `src/react-app/theme/profileTheme.ts`
  - injeta fontes dinamicas do Google Fonts
- `src/react-app/pages/FoodAnalysis.tsx`
  - carrega MediaPipe do jsDelivr
  - carrega modelo do `storage.googleapis.com`
- `src/react-app/pages/dashboardUtils.ts`
  - usa fonte externa do Google Fonts

Impacto:

- o app nao e autocontido
- perda de conectividade ou bloqueio de CDN afeta diretamente design e funcionalidades
- a tela de analise alimentar depende de terceiros externos para iniciar

Conclusao:

Se o webapp deve ser o nucleo do app Android, os ativos visuais e modelos criticos precisam de estrategia local ou cacheada.

### 7. O repositorio Android contem arquivos de maquina e artefatos gerados versionados

Evidencia:

- `android/local.properties` esta versionado e contem:
  - `sdk.dir=C:\\Users\\Teser\\AppData\\Local\\Android\\Sdk`
- `git ls-files` confirma `android/app/build/outputs/apk/release/app-release-unsigned.apk` versionado
- `.gitignore` ja tenta ignorar `android/app/build/` e `*.apk`, mas isso nao remove arquivos que ja entraram no historico

Impacto:

- reduz portabilidade do repositorio
- aumenta ruído operacional
- mistura estado do ambiente local com codigo-fonte

## Achados medios

### 8. O release Android ainda esta configurado como build de desenvolvimento

Evidencia:

- `android/app/build.gradle`
  - `minifyEnabled false`
  - `signingConfig signingConfigs.debug`
- dependencia de `Health Connect` esta em `1.1.0-alpha07`

Impacto:

- release nao esta preparado para distribuicao real
- assinatura de debug invalida fluxo serio de release
- dependencia alpha aumenta risco de comportamento instavel no nucleo de saude

### 9. O webapp possui fallbacks de saude que nao sao fonte real de verdade

Evidencia:

- `src/react-app/services/healthConnect.ts`
  - disponibilidade sempre `false`
  - leituras simuladas/randomicas
- `src/react-app/services/googleFit.ts`
  - disponibilidade sempre `false`
  - fallback randomico em leitura

Impacto:

- fora do Android nativo, a camada "core" de metricas nao e verdadeiramente portavel
- dificulta manter o webapp como nucleo multiplataforma confiavel

## Estado atual de hospedagem

### Modelo real hoje

- Android abre `WebView`
- `WebView` carrega `https://fitloot.vercel.app/home`
- o frontend React roda remoto
- o frontend usa `/api`
- a camada Vercel reescreve `/api/*` para `fitloot-worker.suportefitloot.workers.dev`
- o Android adiciona apenas capacidades nativas pontuais por bridge

### Diagnostico

O Android nao "hospeda" o webapp no sentido forte. Ele hospeda um navegador embutido para um deploy remoto especifico.

## Recomendacao de estrategia

### Estrategia recomendada para a proxima etapa

Adotar o webapp como nucleo oficial, mas com shell Android endurecido e contrato de hospedagem explicito.

### Fase 1. Estabilizar o shell Android

- restaurar o Gradle Wrapper completo
- remover arquivos locais/versionados indevidos
- endurecer trusted host validation
- fechar `cleartext` e permissoes WebView excedentes
- separar config de `baseUrl` por build type
- parar de usar assinatura debug em release

### Fase 2. Desacoplar o webapp do deploy unico

- introduzir config de host por ambiente
- definir contrato claro entre:
  - origem do frontend
  - origem da API
  - politica de cookies/sessao
- revisar se o app continuara:
  - remoto-first
  - local bundle + API remota
  - modelo hibrido com fallback offline

### Fase 3. Tornar o design e features criticas autocontidas

- empacotar fontes essenciais
- reduzir dependencia de CDNs para assets de UI
- decidir se MediaPipe/modelos ficam:
  - embarcados
  - cacheados
  - ou explicitamente online-only com degradacao controlada

## Prioridade sugerida

### P0

- corrigir `isTrustedUrl`
- restaurar `gradle-wrapper.jar`
- remover assinatura debug de release

### P1

- externalizar `baseUrl` do webapp Android
- revisar `BrowserRouter` + estrategia de hospedagem futura
- fechar `cleartext` e file/content access desnecessarios

### P2

- limpar arquivos versionados de build e maquina local
- reduzir dependencia de fontes/modelos externos
- substituir fallbacks simulados por contratos reais ou degradacao explicita

## Conclusao final

O projeto ja provou que o webapp pode ser o centro da experiencia. O que falta agora nao e redesenhar a app, e sim profissionalizar a fronteira entre Android e web:

- o Android precisa virar um shell confiavel, seguro e configuravel
- o webapp precisa parar de assumir que sempre esta em um navegador web comum dentro de um dominio unico

Com isso, da para manter a estrutura e o design atuais do webapp e fazer dele, de fato, o nucleo do aplicativo.
