# Auditoria FoodAnalysis + Scan (2026-03-30)

## 1. Structure map (recorte funcional)

### Frontend React

- `src/react-app/pages/FoodAnalysis.tsx`
  - orquestra UI do scanner, galeria, preview e resultado.
  - decide entre camera nativa Android e camera web.
- `src/react-app/services/native/cameraService.ts`
  - camada unica para abrir camera/galeria e normalizar imagem.
  - escuta eventos nativos:
    - `camera_captured`
    - `camera_capture_error`
    - `gallery_image_selected`
- `src/react-app/services/native/androidBridge.ts`
  - detecta disponibilidade da bridge (`window.AndroidBridge`).

### Android nativo

- `android/app/src/main/java/com/fitloot/MainActivity.kt`
  - host do WebView.
  - recebe retorno da `CameraActivity` e envia evento para o web app.
- `android/app/src/main/java/com/fitloot/WebAppInterface.kt`
  - expoe `openCamera()` e `openGallery()` para o frontend.
- `android/app/src/main/java/com/fitloot/CameraActivity.kt`
  - tela nativa do scanner (preview + botao + overlays).
  - captura foto e retorna `image_path`.
- `android/app/src/main/res/layout/activity_camera.xml`
  - layout visual do scanner nativo.

### Backend Worker

- `src/worker/routes/ai.ts`
  - `/api/ai/analyze-food`: identifica alimento e calcula macros (USDA/RapidAPI/estimativa IA).
- `src/worker/routes/metrics.ts`
  - `/api/food/scan`: salva refeicao no diario.
  - `/api/food/today`: retorna historico diario.

## 2. Auditoria de fluxo

### Fluxo `FoodAnalysis` (app web)

1. Usuario toca em `Iniciar Scan` na `FoodAnalysis.tsx`.
2. Se bridge Android existe, `openCamera()` chama `cameraService.openCamera()`.
3. Bridge dispara `WebAppInterface.openCamera()` e abre `CameraActivity`.
4. Captura retorna `image_path` para `MainActivity`.
5. `MainActivity` envia evento `camera_captured` ao WebView.
6. `cameraService` normaliza imagem (base64/dataUrl) e devolve para `FoodAnalysis`.
7. `FoodAnalysis` chama `/api/ai/analyze-food`.
8. Resultado pode ser salvo em `/api/food/scan`.
9. Biblioteca lateral carrega de `/api/food/today`.

### Fluxo `scan` nativo (Android)

1. `CameraActivity` pede permissao de camera.
2. `PreviewView` recebe stream da CameraX.
3. Ao ficar `STREAMING`, botao de captura e animacao sao habilitados.
4. Captura salva jpg no cache e retorna caminho via `Intent`.

## 3. Causa raiz do preview cinza

- Regressao introduzida no redesign do scanner:
  - `PreviewView.ImplementationMode` foi alterado para `PERFORMANCE` (SurfaceView).
- Em varios devices Android, `SurfaceView` com overlays complexos causa preview cinza/preto/intermitente.
- A versao antiga (botao azul) funcionava com `COMPATIBLE` (TextureView), que e mais estavel para esse layout.

## 4. Correcao aplicada

- Arquivo: `android/app/src/main/java/com/fitloot/CameraActivity.kt`
  - `PreviewView.ImplementationMode.PERFORMANCE` -> `PreviewView.ImplementationMode.COMPATIBLE`.
- Arquivo: `android/app/src/main/res/layout/activity_camera.xml`
  - `previewDimmer` reduzido de `#22000000` para `#12000000` para evitar efeito de cinza excessivo.

Resultado esperado:

- Mantem o design atual do scan (moldura, linha, cabecalho, botao estilizado).
- Recupera estabilidade de preview da camera no Android.

## 5. Validacao

- `npm run lint` executado (falhou por erros preexistentes e nao relacionados em `src/worker/services/aiTransport.ts`).
- Build Android local nao executou porque o wrapper Gradle esta incompleto no repositorio local:
  - erro: `Could not find or load main class org.gradle.wrapper.GradleWrapperMain`.

