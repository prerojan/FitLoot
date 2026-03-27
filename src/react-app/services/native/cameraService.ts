import { debugNativeOnce, getAndroidBridge, isAndroidNativeAvailable, type AndroidCameraCapturedDetail } from "./androidBridge";

export type CameraInputSource = "android-native" | "web-camera" | "web-file";

export type NormalizedCameraImage = {
  source: CameraInputSource;
  path?: string;
  mimeType: string;
  dataUrl: string;
  base64: string;
  previewUrl: string;
};

export type CameraResultInput =
  | { path: string; source?: CameraInputSource }
  | { dataUrl: string; source?: CameraInputSource }
  | { base64: string; mimeType?: string; source?: CameraInputSource }
  | { blob: Blob; source?: CameraInputSource }
  | { file: File; source?: CameraInputSource };

type CameraCapturedHandler = (image: NormalizedCameraImage) => void | Promise<void>;

function toFileUri(path: string): string {
  if (/^file:\/\//i.test(path)) return path;
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.startsWith("/")
    ? `file://${normalizedPath}`
    : `file:///${normalizedPath}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao converter blob de imagem."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToImagePayload(
  dataUrl: string,
  source: CameraInputSource,
  path?: string,
): NormalizedCameraImage {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  const mimeType = match?.[1] ?? "image/jpeg";
  const base64 = match?.[2] ?? "";

  if (!base64) {
    throw new Error("Falha ao normalizar a imagem capturada.");
  }

  return {
    source,
    mimeType,
    dataUrl,
    base64,
    previewUrl: dataUrl,
    ...(path ? { path } : {}),
  };
}

async function loadImageAsDataUrl(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;

        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Falha ao preparar a imagem da camera nativa."));
          return;
        }

        context.drawImage(image, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Falha ao ler a imagem da camera nativa."));
      }
    };

    image.onerror = () => reject(new Error("Falha ao carregar a imagem da camera nativa."));
    image.src = toFileUri(path);
  });
}

class CameraService {
  async openCamera(fallback?: () => Promise<void> | void): Promise<"android-native" | "web-fallback"> {
    if (isAndroidNativeAvailable()) {
      const bridge = getAndroidBridge();
      if (bridge?.openCamera) {
        debugNativeOnce("camera-open-native", "Opening camera through AndroidBridge.");
        bridge.openCamera();
        return "android-native";
      }
    }

    debugNativeOnce("camera-open-fallback", "Android camera unavailable. Using web camera fallback.");
    if (fallback) {
      await fallback();
    }
    return "web-fallback";
  }

  async handleCameraResult(input: CameraResultInput): Promise<NormalizedCameraImage> {
    if ("path" in input) {
      return this.handleAndroidPath(input.path, input.source ?? "android-native");
    }

    if ("dataUrl" in input) {
      return dataUrlToImagePayload(input.dataUrl, input.source ?? "web-camera");
    }

    if ("base64" in input) {
      const mimeType = input.mimeType ?? "image/jpeg";
      return dataUrlToImagePayload(
        `data:${mimeType};base64,${input.base64}`,
        input.source ?? "web-camera",
      );
    }

    if ("blob" in input) {
      const dataUrl = await blobToDataUrl(input.blob);
      return dataUrlToImagePayload(dataUrl, input.source ?? "web-camera");
    }

    const dataUrl = await blobToDataUrl(input.file);
    return dataUrlToImagePayload(dataUrl, input.source ?? "web-file");
  }

  subscribeToCameraCaptured(
    onCaptured: CameraCapturedHandler,
    onError?: (error: Error) => void,
  ): () => void {
    if (typeof window === "undefined") {
      return () => undefined;
    }

    const handleEvent = (event: CustomEvent<AndroidCameraCapturedDetail>) => {
      const path = event.detail?.path;
      if (!path) {
        return;
      }

      void this.handleCameraResult({ path, source: "android-native" })
        .then((image) => onCaptured(image))
        .catch((error) => {
          onError?.(error instanceof Error ? error : new Error("Falha ao processar a captura da camera nativa."));
        });
    };

    window.addEventListener("camera_captured", handleEvent);

    return () => {
      window.removeEventListener("camera_captured", handleEvent);
    };
  }

  private async handleAndroidPath(path: string, source: CameraInputSource): Promise<NormalizedCameraImage> {
    const fileUri = toFileUri(path);

    try {
      const response = await fetch(fileUri);
      if (!response.ok) {
        throw new Error("Falha ao abrir a imagem capturada.");
      }

      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      return dataUrlToImagePayload(dataUrl, source, path);
    } catch {
      const dataUrl = await loadImageAsDataUrl(path);
      return dataUrlToImagePayload(dataUrl, source, path);
    }
  }
}

export const cameraService = new CameraService();

export default cameraService;
