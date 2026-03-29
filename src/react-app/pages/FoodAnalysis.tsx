import { useCallback, useMemo, useRef, useState, useEffect, type ChangeEventHandler } from "react";
import { useNavigate } from "react-router";
import { Camera, AlertTriangle, CheckCircle2, Bolt, ShieldCheck, ImageIcon, ArrowLeft, BookOpen, Clock3 } from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import { isAndroidNativeAvailable } from "@/react-app/services/native/androidBridge";
import { cameraService, type NormalizedCameraImage } from "@/react-app/services/native/cameraService";
import { ApiRequestError, clearJsonCache, fetchJson } from "@/react-app/utils/api";
import { safeGet } from "@/utils/typeHelpers";

type AnalysisItem = {
  food_name: string;
  portion_description: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  energy_kj: number | null;
  source: "usda" | "rapidapi" | "estimate" | "ocr_label";
  warning?: string | undefined;
};

type AnalysisResult = {
  success: boolean;
  items: AnalysisItem[];
  totals: {
    calories: number;
    energy_kj: number;
    protein: number;
    carbs: number;
    fats: number;
    macro_percentages: { protein: number; carbs: number; fats: number };
  };
  has_estimates?: boolean | undefined;
  estimation_warning?: string | undefined;
};

type IdentifiedItem = {
  food_name: string;
  portion_description: string;
  portion_multiplier: number;
};

type MediaPipeClassifier = {
  classify: (image: HTMLImageElement) => {
    classifications?: Array<{
      categories?: Array<{ categoryName?: string | undefined; score?: number | undefined }>;
    }>;
  };
  close: () => void;
};

type MediaPipeVisionModule = {
  FilesetResolver: {
    forVisionTasks: (wasmRootPath: string) => Promise<unknown>;
  };
  ImageClassifier: {
    createFromOptions: (vision: unknown, options: Record<string, unknown>) => Promise<MediaPipeClassifier>;
  };
};

type ClassificationCandidate = {
  label: string;
  score: number;
};

type FoodClassificationResult = {
  identifiedItems: IdentifiedItem[];
  foodDescription?: string | undefined;
};

type PreviewSource = "camera" | "gallery";
type WebCameraStartResult = "started" | "unsupported" | "blocked" | "fallback-native";

type SavedFoodEntry = {
  id: number;
  food_name: string;
  calories: number | null;
  meal_type?: string | null;
  scanned_at?: string | null;
  created_at?: string | null;
};

const STRICT_CLASSIFICATION_SCORE = 0.12;
const RELAXED_CLASSIFICATION_SCORE = 0.04;
const MAX_IDENTIFIED_ITEMS = 3;
const MAX_DESCRIPTION_LABELS = 6;

async function loadVisionModule(): Promise<MediaPipeVisionModule> {
  const moduleUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";
  return (await import(/* @vite-ignore */ moduleUrl)) as MediaPipeVisionModule;
}

function toIdentifiedItems(result: { classifications?: Array<{ categories?: Array<{ categoryName?: string | undefined; score?: number | undefined }> }> }): IdentifiedItem[] {
  const categories = safeGet(result.classifications ?? [], 0)?.categories ?? [];
  return categories
    .filter((category) => Number(category.score ?? 0) >= 0.2)
    .slice(0, 3)
    .map((category) => ({
      food_name: String(category.categoryName || "alimento"),
      portion_description: "porção média",
      portion_multiplier: 1,
    }));
}

function normalizeCategoryLabel(rawLabel?: string | undefined): string {
  return String(rawLabel || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function extractClassificationCandidates(
  result: { classifications?: Array<{ categories?: Array<{ categoryName?: string | undefined; score?: number | undefined }> }> },
): ClassificationCandidate[] {
  const seen = new Set<string>();

  return (result.classifications ?? [])
    .flatMap((classification) => classification.categories ?? [])
    .map((category) => ({
      label: normalizeCategoryLabel(category.categoryName),
      score: Number(category.score ?? 0),
    }))
    .filter((category) => category.label.length > 0 && Number.isFinite(category.score) && category.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter((category) => {
      const key = category.label.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function toIdentifiedItemsFromCandidates(candidates: ClassificationCandidate[]): IdentifiedItem[] {
  return candidates
    .filter((candidate) => candidate.score >= STRICT_CLASSIFICATION_SCORE)
    .slice(0, MAX_IDENTIFIED_ITEMS)
    .map((candidate) => ({
      food_name: candidate.label,
      portion_description: "porcao media",
      portion_multiplier: 1,
    }));
}

function toFoodDescription(candidates: ClassificationCandidate[]): string | undefined {
  const preferredLabels = candidates
    .filter((candidate) => candidate.score >= RELAXED_CLASSIFICATION_SCORE)
    .slice(0, MAX_DESCRIPTION_LABELS)
    .map((candidate) => candidate.label);

  const fallbackLabels = preferredLabels.length > 0
    ? preferredLabels
    : candidates.slice(0, Math.min(3, candidates.length)).map((candidate) => candidate.label);

  return fallbackLabels.length > 0 ? fallbackLabels.join(", ") : undefined;
}

function toPreviewSource(source: NormalizedCameraImage["source"]): PreviewSource {
  return source === "android-gallery" || source === "web-file" ? "gallery" : "camera";
}

function formatMealType(mealType?: string | null): string {
  const normalizedMealType = String(mealType || "lanche").trim().toLowerCase();
  const mealTypeMap: Record<string, string> = {
    cafe_da_manha: "Cafe da manha",
    cafe: "Cafe",
    almoco: "Almoco",
    almoço: "Almoco",
    lanche: "Lanche",
    jantar: "Jantar",
    ceia: "Ceia",
  };

  return mealTypeMap[normalizedMealType] ?? normalizedMealType.replace(/[_-]+/g, " ");
}

function formatSavedFoodTime(entry: SavedFoodEntry): string {
  const timestamp = entry.scanned_at ?? entry.created_at;
  if (!timestamp) return "agora";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "agora";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function FoodAnalysis() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const classifierRef = useRef<MediaPipeClassifier | null>(null);
  const classifierInitRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const processNormalizedImageRef = useRef<(image: NormalizedCameraImage) => void>(() => undefined);
  const classifierClosingRef = useRef(false);
  const lastNormalizedImageRef = useRef<NormalizedCameraImage | null>(null);
  const previewWatchdogRef = useRef<number | null>(null);

  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<PreviewSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savedFoods, setSavedFoods] = useState<SavedFoodEntry[]>([]);
  const [savedFoodsLoading, setSavedFoodsLoading] = useState(false);
  const [savedFoodsError, setSavedFoodsError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const [mediaPipeReady, setMediaPipeReady] = useState(false);
  const [mediaPipeLoading, setMediaPipeLoading] = useState(true);
  const [mediaPipeError, setMediaPipeError] = useState<string | null>(null);
  const androidNativeAvailable = isAndroidNativeAvailable();
  const reduceInlineCameraEffects = androidNativeAvailable && streamActive && !preview;

  const clearPreviewWatchdog = () => {
    if (previewWatchdogRef.current !== null) {
      window.clearTimeout(previewWatchdogRef.current);
      previewWatchdogRef.current = null;
    }
  };

  const stopCamera = (updateState = true) => {
    clearPreviewWatchdog();
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (updateState && mountedRef.current) {
      setStreamActive(false);
    }
  };

  const destroyMediaPipe = () => {
    if (classifierClosingRef.current) return;
    classifierClosingRef.current = true;
    const classifier = classifierRef.current;
    if (classifier) {
      try {
        classifier.close();
      } catch {
        // Evita falha durante desmontagem concorrente.
      }
      classifierRef.current = null;
    }
    if (mountedRef.current) {
      setMediaPipeReady(false);
    }
    classifierClosingRef.current = false;
  };

  const loadSavedFoods = useCallback(async () => {
    setSavedFoodsLoading(true);
    setSavedFoodsError(null);

    try {
      const foods = await fetchJson<SavedFoodEntry[]>("/api/food/today?limit=8");
      if (!mountedRef.current) return;
      setSavedFoods(Array.isArray(foods) ? foods : []);
    } catch (foodsError) {
      if (foodsError instanceof ApiRequestError && (foodsError.status === 401 || foodsError.status === 403)) {
        navigate("/app");
        return;
      }

      if (!mountedRef.current) return;
      setSavedFoodsError("Nao foi possivel carregar a biblioteca agora.");
    } finally {
      if (mountedRef.current) {
        setSavedFoodsLoading(false);
      }
    }
  }, [navigate]);

  const initializeMediaPipe = async () => {
    if (classifierRef.current) {
      if (mountedRef.current) {
        setMediaPipeReady(true);
        setMediaPipeError(null);
        setMediaPipeLoading(false);
      }
      return;
    }

    if (classifierInitRef.current) {
      await classifierInitRef.current;
      return;
    }

    if (mountedRef.current) {
      setMediaPipeLoading(true);
    }
    const initPromise = (async () => {
      try {
        const visionModule = await loadVisionModule();
        const vision = await visionModule.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );

        classifierRef.current = await visionModule.ImageClassifier.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/int8/1/efficientnet_lite0.tflite",
          },
          maxResults: 5,
          runningMode: "IMAGE",
        });

        if (mountedRef.current) {
          setMediaPipeReady(true);
          setMediaPipeError(null);
        }
      } catch {
        if (mountedRef.current) {
          setMediaPipeReady(false);
          setMediaPipeError("Não foi possível inicializar o MediaPipe. Verifique sua conexão e tente novamente.");
        }
      } finally {
        if (mountedRef.current) {
          setMediaPipeLoading(false);
        }
      }
    })();

    classifierInitRef.current = initPromise;
    await initPromise;
    classifierInitRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    void initializeMediaPipe();
    void loadSavedFoods();

    return () => {
      mountedRef.current = false;
      clearPreviewWatchdog();
      stopCamera(false);
      destroyMediaPipe();
      classifierInitRef.current = null;
    };
  }, [loadSavedFoods]);

  useEffect(() => {
    const handleCaptureError = (captureError: Error) => {
      if (!mountedRef.current) return;
      setCameraError(captureError.message);
      setLoading(false);
    };

    const unsubscribeCamera = cameraService.subscribeToCameraCaptured(
      (image) => {
        processNormalizedImageRef.current(image);
      },
      handleCaptureError,
    );
    const unsubscribeGallery = cameraService.subscribeToGallerySelected(
      (image) => {
        processNormalizedImageRef.current(image);
      },
      handleCaptureError,
    );
    const unsubscribeNativeErrors = cameraService.subscribeToNativeCameraErrors(handleCaptureError);

    return () => {
      unsubscribeCamera();
      unsubscribeGallery();
      unsubscribeNativeErrors();
    };
  }, []);

  const identifyFoodWithMediaPipe = async (image: HTMLImageElement): Promise<IdentifiedItem[]> => {
    if (!classifierRef.current) {
      await initializeMediaPipe();
    }

    const classifier = classifierRef.current;
    if (!classifier) {
      throw new Error("MediaPipe não está disponível para análise no momento.");
    }

    const prediction = classifier.classify(image);
    const items = toIdentifiedItems(prediction);

    if (items.length === 0) {
      throw new Error("Não foi possível identificar alimentos com o modelo local. Tente outra foto.");
    }

    return items;
  };

  const classifyFoodWithMediaPipe = async (image: HTMLImageElement): Promise<FoodClassificationResult> => {
    if (!classifierRef.current) {
      await initializeMediaPipe().catch(() => undefined);
    }

    const classifier = classifierRef.current;
    if (!classifier) {
      throw new Error("MediaPipe não está disponível para análise no momento.");
    }

    const prediction = classifier.classify(image);
    const candidates = extractClassificationCandidates(prediction);
    const identifiedItems = toIdentifiedItemsFromCandidates(candidates);
    const foodDescription = toFoodDescription(candidates);

    if (identifiedItems.length === 0 && !foodDescription) {
      const fallbackItems = await identifyFoodWithMediaPipe(image);
      return {
        identifiedItems: fallbackItems,
        foodDescription: fallbackItems.map((item) => item.food_name).join(", ") || undefined,
      };
    }

    const fallbackFoodDescription = identifiedItems.map((item) => item.food_name).join(", ");
    return {
      identifiedItems,
      foodDescription: foodDescription ?? (fallbackFoodDescription || undefined),
    };
  };

  const buildAnalysisHints = async (image: HTMLImageElement): Promise<FoodClassificationResult> => {
    if (mediaPipeLoading) {
      return {
        identifiedItems: [],
      };
    }

    try {
      return await classifyFoodWithMediaPipe(image);
    } catch {
      return {
        identifiedItems: [],
      };
    }
  };

  const resetCaptureState = () => {
    stopCamera();
    lastNormalizedImageRef.current = null;
    setStreamActive(false);
    setCameraError(null);
    setError(null);
    setResult(null);
    setPreview(null);
    setPreviewSource(null);
    setLoading(false);
    setSaveSuccess(false);
    setLibraryOpen(false);
  };

  const waitForInlinePreview = (video: HTMLVideoElement): Promise<boolean> => {
    return new Promise((resolve) => {
      let settled = false;
      let intervalId: number | null = null;
      let frameRequestId: number | null = null;

      const isReady = () =>
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0;

      const cleanup = () => {
        video.removeEventListener("loadeddata", handleReadyCheck);
        video.removeEventListener("canplay", handleReadyCheck);
        if (intervalId !== null) {
          window.clearInterval(intervalId);
        }
        if (frameRequestId !== null && "cancelVideoFrameCallback" in video) {
          (video as HTMLVideoElement & { cancelVideoFrameCallback: (handle: number) => void }).cancelVideoFrameCallback(frameRequestId);
        }
        clearPreviewWatchdog();
      };

      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(ready);
      };

      const handleReadyCheck = () => {
        if (isReady()) {
          finish(true);
        }
      };

      const scheduleFrameProbe = () => {
        if (!("requestVideoFrameCallback" in video)) {
          return;
        }

        frameRequestId = (
          video as HTMLVideoElement & {
            requestVideoFrameCallback: (callback: () => void) => number;
          }
        ).requestVideoFrameCallback(() => {
          if (isReady()) {
            finish(true);
            return;
          }

          if (!settled) {
            scheduleFrameProbe();
          }
        });
      };

      if (isReady()) {
        finish(true);
        return;
      }

      video.addEventListener("loadeddata", handleReadyCheck);
      video.addEventListener("canplay", handleReadyCheck);
      intervalId = window.setInterval(handleReadyCheck, 120);
      scheduleFrameProbe();

      previewWatchdogRef.current = window.setTimeout(() => {
        finish(isReady());
      }, androidNativeAvailable ? 1400 : 2200);
    });
  };

  const startWebCamera = async (): Promise<WebCameraStartResult> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("A camera inline nao esta disponivel neste ambiente.");
      return "unsupported";
    }

    try {
      setCameraError(null);
      
      if (import.meta.env.DEV) {
        console.log("[Camera] Iniciando camera...");
      }
      
      // Usa constraints tolerantes para mobile e WebView.
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 }
        },
        audio: false
      };
      
      if (import.meta.env.DEV) {
        console.log("[Camera] Requesting getUserMedia with constraints:", constraints);
      }
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (import.meta.env.DEV) {
        console.log("[Camera] Stream obtido:", stream);
        console.log("[Camera] Video tracks:", stream.getVideoTracks());
      }
      
      if (videoRef.current) {
        const currentVideo = videoRef.current;
        currentVideo.srcObject = stream;
        
        // Instrumenta o video apenas em desenvolvimento.
        currentVideo.onloadedmetadata = () => {
          if (import.meta.env.DEV) {
            console.log("[Camera] Video metadata loaded");
            console.log("[Camera] Video dimensions:", {
              videoWidth: currentVideo.videoWidth,
              videoHeight: currentVideo.videoHeight,
              readyState: currentVideo.readyState,
            });
          }
        };
        
        currentVideo.onplay = () => {
          if (import.meta.env.DEV) {
            console.log("[Camera] Video started playing");
          }
        };
        
        currentVideo.onerror = (event) => {
          console.error("[Camera] Video error:", event);
        };
        
        // Garante a inicializacao do video antes da captura.
        try {
          await currentVideo.play();
          if (import.meta.env.DEV) {
            console.log("[Camera] Video play() chamado com sucesso");
          }
        } catch (playError) {
          console.error('[Camera] Erro ao reproduzir vídeo:', playError);
          throw playError;
        }

        const previewReady = await waitForInlinePreview(currentVideo);
        if (!previewReady) {
          stream.getTracks().forEach((track) => track.stop());
          currentVideo.srcObject = null;
          setStreamActive(false);

          if (androidNativeAvailable) {
            if (import.meta.env.DEV) {
              console.warn("[Camera] Preview inline indisponivel no Android WebView. Abrindo camera nativa.");
            }
            return "fallback-native";
          }

          setCameraError("Nao foi possivel renderizar o preview da camera neste dispositivo.");
          return "blocked";
        }
      }
      
      setStreamActive(true);
      if (import.meta.env.DEV) {
        console.log("[Camera] Stream ativo definido como true");
      }

      return "started";
    } catch (error) {
      console.error('[Camera] Erro ao iniciar câmera:', error);
      let errorMessage = "Permissão de câmera negada ou indisponível neste dispositivo.";
      
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage = "Permissão de câmera negada. Por favor, permita o acesso à câmera nas configurações do navegador.";
        } else if (error.name === 'NotFoundError') {
          errorMessage = "Nenhuma câmera encontrada neste dispositivo.";
        } else if (error.name === 'NotReadableError') {
          errorMessage = "Câmera já está sendo usada por outro aplicativo.";
        } else if (error.name === 'OverconstrainedError') {
          errorMessage = "Câmera não suporta as configurações solicitadas.";
        } else {
          errorMessage = `Erro na câmera: ${error.message}`;
        }
      }
      
      setCameraError(errorMessage);
      return error instanceof Error && error.name === "NotSupportedError" ? "unsupported" : "blocked";
    }
  };

  const openCamera = async () => {
    stopCamera();
    lastNormalizedImageRef.current = null;
    setCameraError(null);
    setError(null);
    setResult(null);
    setPreview(null);
    setPreviewSource(null);
    setSaveSuccess(false);
    setLibraryOpen(false);

    if (androidNativeAvailable) {
      await cameraService.openCamera();
      return;
    }

    const startResult = await startWebCamera();
    if (startResult === "fallback-native") {
      setCameraError(null);
      await cameraService.openCamera();
      return;
    }

    if (startResult === "unsupported" && androidNativeAvailable) {
      await cameraService.openCamera();
    }
  };

  const openGallery = async () => {
    stopCamera();
    lastNormalizedImageRef.current = null;
    setCameraError(null);
    setError(null);
    setResult(null);
    setPreview(null);
    setPreviewSource(null);
    setSaveSuccess(false);
    setLibraryOpen(false);
    await cameraService.openGallery(() => {
      galleryInputRef.current?.click();
    });
  };

  const runAnalysis = async (normalizedImage: NormalizedCameraImage) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSaveSuccess(false);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Falha ao carregar imagem para análise local."));
        img.src = normalizedImage.dataUrl;
      });

      const classification = await buildAnalysisHints(image);
      const fallbackFoodDescription = classification.identifiedItems.map((item) => item.food_name).join(", ");
      const foodDescription = classification.foodDescription ?? (fallbackFoodDescription || undefined);
      const data = await fetchJson<AnalysisResult>("/api/ai/analyze-food", {
        method: "POST",
        body: JSON.stringify({
          identified_items: classification.identifiedItems,
          food_description: foodDescription,
          image_base64: normalizedImage.base64,
          image_mime_type: normalizedImage.mimeType,
        }),
      });

      setResult(data);
    } catch (analysisError) {
      if (analysisError instanceof ApiRequestError && (analysisError.status === 401 || analysisError.status === 403)) {
        navigate("/app");
        return;
      }

      const baseMessage = analysisError instanceof Error ? analysisError.message : "Não foi possível analisar a foto.";
      const shouldAppendMediaPipeContext = Boolean(mediaPipeError) && !mediaPipeReady;
      setError(shouldAppendMediaPipeContext ? `${baseMessage} ${mediaPipeError}` : baseMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleNormalizedImage = async (normalizedImage: NormalizedCameraImage) => {
    lastNormalizedImageRef.current = normalizedImage;
    setCameraError(null);
    setPreview(normalizedImage.previewUrl);
    setPreviewSource(toPreviewSource(normalizedImage.source));
    stopCamera();
    await runAnalysis(normalizedImage);
  };

  processNormalizedImageRef.current = (normalizedImage) => {
    void handleNormalizedImage(normalizedImage);
  };

  const retryAnalysis = async () => {
    const image = lastNormalizedImageRef.current;
    if (!image) return;
    await runAnalysis(image);
  };

  const captureFromCamera = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const image = canvas.toDataURL("image/jpeg", 0.85);
      const normalizedImage = await cameraService.handleCameraResult({
        dataUrl: image,
        source: "web-camera",
      });
      await handleNormalizedImage(normalizedImage);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "Falha ao processar a imagem capturada.");
    }
  };

  const onPickGallery: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const input = event.currentTarget;
    const file = safeGet(Array.from(event.target.files ?? []), 0);
    if (!file) return;

    try {
      const normalizedImage = await cameraService.handleCameraResult({
        file,
        source: "web-file",
      });
      await handleNormalizedImage(normalizedImage);
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "Falha ao processar a imagem selecionada.");
    } finally {
      input.value = "";
    }
  };

  const saveMeal = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const foodName = result.items.map((item) => item.food_name).slice(0, 2).join(" + ") || "Refeição analisada";
      await fetchJson<{ success: boolean }>("/api/food/scan", {
        method: "POST",
        body: JSON.stringify({ food_name: foodName, calories: result.totals.calories, meal_type: "lanche" }),
      });

      clearJsonCache("/api/food/today");
      void loadSavedFoods();
      setSaveSuccess(true);
      setError(null);
    } catch (saveError) {
      if (saveError instanceof ApiRequestError && (saveError.status === 401 || saveError.status === 403)) {
        navigate("/app");
        return;
      }

      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a refeição no histórico agora.");
    } finally {
      setSaving(false);
    }
  };

  const macroBars = useMemo(() => result?.totals.macro_percentages ?? { protein: 0, carbs: 0, fats: 0 }, [result]);
  const handleBack = () => navigate(-1);
  const scannerControlSurfaceClass = reduceInlineCameraEffects
    ? "bg-black/70"
    : "bg-white/10 backdrop-blur-md";
  const scannerStatusSurfaceClass = reduceInlineCameraEffects
    ? "bg-black/82"
    : "bg-black/60 backdrop-blur-md";
  const scannerLibrarySurfaceClass = reduceInlineCameraEffects
    ? "bg-black/88"
    : "bg-black/45 backdrop-blur-xl";
  const scannerCaptureButtonSurfaceClass = reduceInlineCameraEffects
    ? "bg-black/70"
    : "bg-white/10";

  return (
    <AppPageShell bottomNavActive="missions" className="fl-theme-page overflow-hidden w-full flex flex-col font-display antialiased">
      <style>{`
        @keyframes pulse-border {
          0% { border-color: color-mix(in srgb, var(--app-primary-color) 40%, transparent); }
          50% { border-color: var(--app-primary-color); }
          100% { border-color: color-mix(in srgb, var(--app-primary-color) 40%, transparent); }
        }
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes glow-pulse {
          0% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(1.02); }
          100% { opacity: 0.15; transform: scale(1); }
        }
        .scanner-line {
          height: 2px;
          background: linear-gradient(90deg, transparent, var(--app-primary-color), transparent);
          position: absolute;
          width: 100%;
          top: 0;
          animation: scan 3s linear infinite;
        }
        .bottom-sheet {
          box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.8);
          border-top: 1px solid color-mix(in srgb, var(--app-primary-color) 20%, transparent);
        }
        .neon-glow {
          box-shadow: 0 0 20px color-mix(in srgb, var(--app-primary-color) 40%, transparent);
        }
        .card-glow-bg {
          animation: glow-pulse 4s ease-in-out infinite;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--app-primary-color) 20%, transparent); border-radius: 10px; }
      `}</style>

      {/* Estado inicial */}
      {(!streamActive && !preview && !result) ? (
        <div className="flex-1 flex flex-col relative z-20 overflow-y-auto custom-scrollbar pb-4 min-w-0">
          {/* Cabecalho */}
          <header className="sticky top-0 z-10 flex items-center justify-between border-b p-3 sm:p-4 lg:p-6 backdrop-blur-md" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 84%, transparent)" }}>
            <button 
              onClick={handleBack}
              className="fl-theme-surface-soft flex h-10 w-10 items-center justify-center rounded-full fl-theme-text-muted transition-opacity hover:opacity-85"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-[0.68rem] font-bold uppercase tracking-[0.2em] sm:text-xs" style={{ color: "var(--fl-color-text)" }}>Scanner de Alimentos</h1>
            <div className="w-10 h-10" aria-hidden="true" />
          </header>

          {/* Introducao */}
          <div className="px-4 py-6 text-center sm:px-6 sm:py-10 min-w-0">
            <h2 className="mb-1 text-2xl sm:text-4xl font-bold tracking-tight">Scanner IA</h2>
            <p className="text-[11px] sm:text-sm font-medium" style={{ color: 'var(--app-primary-color)' }}>
              Selecione o portal de entrada para análise
            </p>
          </div>

          {/* Entradas principais */}
          <div className="flex-1 space-y-6 px-4 sm:space-y-8 sm:px-6">
            {/* Atalho da camera */}
            <div className="group relative">
              <div className="absolute -inset-1 bg-primary rounded-3xl blur opacity-10 card-glow-bg group-hover:opacity-30 transition-opacity" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>
              <div className="fl-theme-surface relative flex flex-col items-center overflow-hidden rounded-[1.5rem] sm:rounded-3xl p-5 sm:p-6 lg:p-8 min-w-0">
                <div 
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center mb-4 sm:mb-6 relative"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--app-primary-color) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--app-primary-color) 40%, transparent)' }}
                >
                  <Camera className="w-6 h-6 sm:w-8 sm:h-8" style={{ color: 'var(--app-primary-color)' }} />
                  <div className="absolute inset-0 rounded-full blur-md opacity-40" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>
                </div>
                
                <h3 className="mb-1 sm:mb-2 text-lg sm:text-2xl font-bold uppercase tracking-wide">Abrir Câmera</h3>
                <p className="mb-6 sm:mb-8 max-w-[200px] text-[11px] sm:text-sm" style={{ color: 'var(--fl-color-text-muted)' }}>
                  Aponte seu portal visual para o alimento
                </p>

                <button 
                  onClick={() => { void openCamera(); }}
                  className="neon-glow flex w-full items-center justify-center gap-2 sm:gap-3 rounded-2xl py-3.5 sm:py-4 text-[11px] sm:text-sm font-bold uppercase tracking-widest transition-all active:scale-95"
                  style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
                >
                  <Bolt className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
                  Iniciar Scan
                </button>
              </div>
            </div>

            {/* Atalho da galeria */}
            <button 
              onClick={() => { void openGallery(); }}
              className="fl-theme-surface-soft group relative flex w-full items-center justify-between overflow-hidden rounded-3xl border-l-4 p-4 transition-all sm:p-6"
              style={{ borderLeftColor: 'color-mix(in srgb, var(--app-primary-color) 40%, transparent)' }}
            >
              <div className="text-left">
                <h4 className="font-bold text-sm tracking-wide uppercase mb-1">Escolher da Galeria</h4>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fl-color-text-muted)' }}>Importar dados visuais</p>
              </div>
              <div className="fl-theme-surface-soft flex h-12 w-12 items-center justify-center rounded-2xl transition-transform group-hover:scale-110">
                <ImageIcon className="w-6 h-6" style={{ color: 'var(--app-primary-color)' }} />
              </div>
              <input ref={galleryInputRef} type="file" id="gallery-input" accept="image/*" className="hidden" onChange={onPickGallery} />
            </button>
          </div>

          {/* Selo inferior */}
          <div className="mt-auto flex justify-center px-4 pb-6 pt-8 sm:px-6 sm:pb-8">
            <div className="fl-theme-surface-soft inline-flex items-center gap-2 rounded-full px-4 py-2 backdrop-blur-sm">
              <ShieldCheck className="w-4 h-4" style={{ color: 'var(--app-primary-color)' }} />
              <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--fl-color-text-muted)" }}>Tecnologia Neural Ativa</span>
            </div>
          </div>
        </div>
      ) : result && !preview ? (
        /* Tela de resultado sem preview */
        <div className="custom-scrollbar flex flex-1 flex-col overflow-y-auto p-3 pb-4 sm:p-4 sm:pb-5 lg:p-6 animate-in fade-in slide-in-from-bottom-5 duration-500 min-w-0" style={{ backgroundColor: "var(--app-bg-color)" }}>
          {/* Cabecalho */}
          <div className="flex items-center justify-between mb-8">
            <button 
              onClick={handleBack}
              className="fl-theme-surface-soft flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-85"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" style={{ color: "var(--fl-color-text-muted)" }} />
            </button>
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.2em] sm:text-xs" style={{ color: "var(--fl-color-text-muted)" }}>Análise Completa</h2>
            <div className="w-10 h-10" />
          </div>

          {/* Totais energeticos */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--fl-color-text-muted)" }}>Energia Estimada</p>
              <h3 className="text-4xl font-bold tracking-tight sm:text-5xl" style={{ color: 'var(--app-primary-color)' }}>
                {result.totals.calories} <span className="ml-1 text-xl font-medium tracking-normal" style={{ color: "var(--fl-color-text-soft)" }}>kcal</span>
              </h3>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: 'color-mix(in srgb, var(--app-primary-color) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--app-primary-color) 30%, transparent)', color: 'var(--app-primary-color)' }}>
              <ShieldCheck className="w-3.5 h-3.5" />
              Acurácia {result.has_estimates ? '85%' : '94%'}
            </div>
          </div>

          {/* Grade de macros */}
          <div className="mb-8 grid grid-cols-3 gap-2 sm:mb-10 sm:gap-3">
            <MacroCard label="Proteínas" value={`${result.totals.protein}g`} percentage={macroBars.protein} />
            <MacroCard label="Carbs" value={`${result.totals.carbs}g`} percentage={macroBars.carbs} />
            <MacroCard label="Gorduras" value={`${result.totals.fats}g`} percentage={macroBars.fats} />
          </div>

          <div className="mb-8">
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] fl-theme-text-muted">Tags detectadas</h4>
            <div className="flex flex-wrap gap-2">
              {result.items.map((item) => (
                <span key={`${item.food_name}-${item.portion_description}`} className="rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 24%, transparent)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)" }}>
                  {item.food_name}
                </span>
              ))}
            </div>
          </div>

          {/* Lista detalhada */}
          <div className="mb-10 sm:mb-12">
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--fl-color-text-muted)" }}>Ingredientes Detectados</h4>
            <div className="space-y-3">
              {result.items.map((item, i) => (
                <div key={i} className="fl-theme-surface-soft flex items-center justify-between rounded-2xl border p-4 transition-opacity hover:opacity-90" style={{ borderColor: "var(--fl-border-soft)" }}>
                  <div className="flex items-center gap-4">
                    <div className="fl-theme-surface-soft w-12 h-12 rounded-xl flex items-center justify-center text-2xl">
                      {item.food_name.toLowerCase().includes('ovo') ? '🥚' : 
                       item.food_name.toLowerCase().includes('pão') ? '🍞' : 
                       item.food_name.toLowerCase().includes('carne') ? '🥩' : 
                       item.food_name.toLowerCase().includes('frango') ? '🍗' : 
                       item.food_name.toLowerCase().includes('arroz') ? '🍚' : 
                       item.food_name.toLowerCase().includes('feijão') ? '🫘' : 
                       item.food_name.toLowerCase().includes('salad') ? '🥗' : '🍱'}
                    </div>
                    <div>
                      <p className="text-sm font-bold" style={{ color: "var(--fl-color-text)" }}>{item.food_name}</p>
                      <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>{item.portion_description} • {item.calories || 0} kcal</p>
                    </div>
                  </div>
                  <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--app-primary-color)' }} />
                </div>
              ))}
            </div>
          </div>

          {saveSuccess ? (
            <div className="mb-6 inline-flex items-center gap-3 rounded-full border px-4 py-2" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 24%, transparent)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)" }}>
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-[11px] font-bold uppercase tracking-widest">Refeição salva no histórico</span>
            </div>
          ) : null}

          {/* Acoes finais */}
          <div className="mt-auto grid grid-cols-2 gap-3 pt-4 sm:gap-4">
            <button 
              onClick={() => { void openCamera(); }}
              className="fl-theme-input h-14 rounded-2xl border font-bold text-xs tracking-widest uppercase transition-opacity active:scale-95 hover:opacity-85"
              style={{ borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}
            >
              Repetir Scan
            </button>
            <button 
              onClick={saveMeal}
              disabled={saving || saveSuccess}
              className="neon-glow h-14 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
            >
              {saving ? "Registrando..." : saveSuccess ? "Salvo" : "Confirmar e Salvar"}
            </button>
          </div>
        </div>
      ) : preview ? (
        <div className="custom-scrollbar flex flex-1 flex-col overflow-y-auto p-3 pb-4 sm:p-4 sm:pb-5 lg:p-6 animate-in fade-in slide-in-from-bottom-5 duration-500 min-w-0" style={{ backgroundColor: "var(--app-bg-color)" }}>
          <div className="flex items-center justify-between mb-8">
            <button
              onClick={resetCaptureState}
              className="fl-theme-surface-soft flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-85"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" style={{ color: "var(--fl-color-text-muted)" }} />
            </button>
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.2em] sm:text-xs" style={{ color: "var(--fl-color-text-muted)" }}>
              {previewSource === "gallery" ? "Imagem Importada" : "Captura Pronta"}
            </h2>
            <div className="w-10 h-10" />
          </div>

          <div className="fl-theme-surface overflow-hidden rounded-[2rem] border mb-6" style={{ borderColor: "var(--fl-border-soft)" }}>
            <img src={preview} alt="Previa do alimento" className="aspect-[4/5] w-full object-cover" />
          </div>

          <div className="mb-6">
            {loading ? (
              <div className="inline-flex items-center gap-3 rounded-full border px-4 py-2" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 80%, transparent)" }}>
                <LoadingBall size="sm" />
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>
                  Analisando imagem
                </span>
              </div>
            ) : error ? (
              <div className="inline-flex items-center gap-3 rounded-full border border-red-500/30 bg-red-950/40 px-4 py-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-xs font-bold uppercase tracking-widest text-red-400">{error}</span>
              </div>
            ) : result ? (
              <div className="space-y-4">
                <div className="fl-theme-surface rounded-[1.75rem] border p-4" style={{ borderColor: "var(--fl-border-soft)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: "var(--fl-color-text-muted)" }}>
                        Resultado da Busca
                      </p>
                      <h3 className="mt-2 text-3xl font-bold tracking-tight" style={{ color: "var(--app-primary-color)" }}>
                        {result.totals.calories} <span className="text-base font-medium" style={{ color: "var(--fl-color-text-soft)" }}>kcal</span>
                      </h3>
                    </div>
                    <div className="rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 24%, transparent)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)" }}>
                      {result.has_estimates ? "Com estimativa" : "Dados detectados"}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.items.map((item) => (
                      <span
                        key={`${item.food_name}-${item.portion_description}`}
                        className="rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em]"
                        style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 24%, transparent)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 8%, transparent)", color: "var(--app-primary-color)" }}
                      >
                        {item.food_name}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 space-y-2">
                    {result.items.slice(0, 3).map((item) => (
                      <div key={`${item.food_name}-${item.portion_description}-summary`} className="flex items-center justify-between rounded-2xl border px-3 py-2.5" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 65%, transparent)" }}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold" style={{ color: "var(--fl-color-text)" }}>{item.food_name}</p>
                          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--fl-color-text-muted)" }}>{item.portion_description}</p>
                        </div>
                        <span className="ml-3 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: "var(--app-primary-color)" }}>
                          {item.calories ?? 0} kcal
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {saveSuccess ? (
                  <div className="inline-flex items-center gap-3 rounded-full border px-4 py-2" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 24%, transparent)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)" }}>
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-[11px] font-bold uppercase tracking-widest">Refeicao salva no historico</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-auto grid grid-cols-2 gap-3 pt-4 sm:gap-4">
            <button
              onClick={() => {
                if (previewSource === "gallery") {
                  void openGallery();
                  return;
                }
                void openCamera();
              }}
              className="fl-theme-input h-14 rounded-2xl border font-bold text-xs tracking-widest uppercase transition-opacity active:scale-95 hover:opacity-85"
              style={{ borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}
            >
              {previewSource === "gallery" ? "Outra Imagem" : "Novo Scan"}
            </button>
            {result ? (
              <button
                onClick={saveMeal}
                disabled={saving || saveSuccess}
                className="neon-glow h-14 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
              >
                {saving ? "Registrando..." : saveSuccess ? "Salvo" : "Confirmar e Salvar"}
              </button>
            ) : (
              <button
                onClick={() => { void retryAnalysis(); }}
                disabled={loading}
                className="neon-glow h-14 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
              >
                {loading ? "Analisando..." : "Tentar Novamente"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Scanner ativo */}
          <main className="relative flex-1 overflow-hidden">
            {/* Fonte visual */}
            <div className="absolute inset-0 z-0 overflow-hidden flex items-center justify-center bg-black">
              {!preview && streamActive ? (
                <video 
                  ref={videoRef} 
                  className="h-full w-full object-cover" 
                  autoPlay 
                  playsInline 
                  muted 
                  style={{ 
                    transform: 'scaleX(-1)',
                    objectFit: 'cover',
                    width: '100%',
                    height: '100%'
                  }}
                />
              ) : preview ? (
                <img src={preview} alt="Captured food" className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-4 text-slate-500">
                  <Camera className="w-16 h-16 opacity-20" />
                  <p className="text-sm uppercase tracking-widest font-bold">Iniciando Sensor...</p>
                </div>
              )}

              {/* Overlay do scanner */}
              <div className="absolute inset-0 bg-black/20"></div>

              {/* Moldura ativa */}
              <div className="absolute left-6 right-6 top-24 bottom-8 pointer-events-none" style={{ animation: "pulse-border 2s infinite" }}>
                <div className="absolute inset-0 rounded-[2.5rem] border border-white/10 bg-white/[0.02]"></div>
                <div className="absolute top-0 left-0 w-9 h-9 border-t-4 border-l-4 rounded-tl-[1.5rem]" style={{ borderColor: 'var(--app-primary-color)' }}></div>
                <div className="absolute top-0 right-0 w-9 h-9 border-t-4 border-r-4 rounded-tr-[1.5rem]" style={{ borderColor: 'var(--app-primary-color)' }}></div>
                <div className="absolute bottom-0 left-0 w-9 h-9 border-b-4 border-l-4 rounded-bl-[1.5rem]" style={{ borderColor: 'var(--app-primary-color)' }}></div>
                <div className="absolute bottom-0 right-0 w-9 h-9 border-b-4 border-r-4 rounded-br-[1.5rem]" style={{ borderColor: 'var(--app-primary-color)' }}></div>
                <div className="scanner-line"></div>
              </div>
            </div>

            {/* Cabecalho do scanner */}
            <header className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/70 to-transparent">
              <button 
                onClick={() => {
                  if (preview) {
                    setPreview(null);
                    setResult(null);
                    setError(null);
                    void openCamera();
                    return;
                  }
                  stopCamera();
                  setStreamActive(false);
                  setLibraryOpen(false);
                  handleBack();
                }}
                className={`w-10 h-10 rounded-full flex items-center justify-center border border-white/20 transition-all hover:bg-white/20 ${scannerControlSurfaceClass}`}
                aria-label="Voltar"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <h1 className="text-sm font-bold tracking-widest uppercase text-white/90">AI Vision ACTIVE</h1>
              <button
                type="button"
                onClick={() => setLibraryOpen((current) => !current)}
                className={`flex h-10 min-w-10 items-center justify-center rounded-full px-3 border border-white/20 transition-all hover:bg-white/20 ${scannerControlSurfaceClass}`}
                aria-label="Abrir biblioteca de alimentos"
              >
                <BookOpen className="h-4 w-4 text-white" />
                <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  {savedFoods.length}
                </span>
              </button>
            </header>

            <div className="absolute inset-x-0 bottom-0 z-10 h-52 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none"></div>

            {/* Mensagens de estado */}
            <div className="absolute bottom-32 left-0 right-0 px-6 z-20 text-center pointer-events-none">
              {cameraError && (
                <div className={`inline-flex items-center gap-3 px-4 py-2 rounded-full border border-red-500/30 ${reduceInlineCameraEffects ? "bg-red-950/90" : "bg-red-950/60 backdrop-blur-md"}`}>
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-bold uppercase tracking-widest text-red-400">{cameraError}</span>
                </div>
              )}
              {loading && (
                <div className={`inline-flex items-center gap-3 px-4 py-2 rounded-full border border-white/10 ${scannerStatusSurfaceClass}`}>
                    <LoadingBall size="sm" />
                    <span className="text-xs font-bold uppercase tracking-widest text-white/80">Sincronizando Macros...</span>
                </div>
              )}
              {error && (
                <div className={`inline-flex items-center gap-3 px-4 py-2 rounded-full border border-red-500/30 ${reduceInlineCameraEffects ? "bg-red-950/90" : "bg-red-950/60 backdrop-blur-md"}`}>
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-bold uppercase tracking-widest text-red-400">{error}</span>
                </div>
              )}
            </div>

            {!preview && streamActive && (
              <>
                {/* Biblioteca inline */}
              <div className={`absolute left-4 right-4 z-30 transition-all duration-300 ${libraryOpen ? "bottom-28 opacity-100 translate-y-0" : "bottom-24 pointer-events-none opacity-0 translate-y-6"}`}>
                <div className={`overflow-hidden rounded-[1.75rem] border border-white/10 ${scannerLibrarySurfaceClass}`}>
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/55">Biblioteca salva</p>
                      <h3 className="mt-1 text-sm font-bold text-white">Alimentos registrados hoje</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => { void loadSavedFoods(); }}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/75 transition-opacity hover:opacity-80"
                    >
                      Atualizar
                    </button>
                  </div>

                  <div className="custom-scrollbar max-h-56 space-y-2 overflow-y-auto px-3 py-3">
                    {savedFoodsLoading ? (
                      <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-5">
                        <LoadingBall size="sm" />
                        <span className="text-xs font-bold uppercase tracking-widest text-white/70">Carregando biblioteca</span>
                      </div>
                    ) : savedFoodsError ? (
                      <div className="rounded-2xl border border-red-500/25 bg-red-950/35 px-4 py-4 text-center text-xs font-bold uppercase tracking-widest text-red-300">
                        {savedFoodsError}
                      </div>
                    ) : savedFoods.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-center">
                        <p className="text-xs font-bold uppercase tracking-widest text-white/75">Nenhum alimento salvo hoje</p>
                        <p className="mt-2 text-[11px] text-white/55">Quando voce confirmar uma analise, ela aparece aqui.</p>
                      </div>
                    ) : (
                      savedFoods.map((food) => (
                        <div key={food.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-white">{food.food_name}</p>
                            <div className="mt-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
                              <span>{formatMealType(food.meal_type)}</span>
                              <span className="h-1 w-1 rounded-full bg-white/35"></span>
                              <span className="inline-flex items-center gap-1">
                                <Clock3 className="h-3 w-3" />
                                {formatSavedFoodTime(food)}
                              </span>
                            </div>
                          </div>
                          <div className="ml-4 rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                            {food.calories ?? 0} kcal
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              </>
            )}

            {/* Disparo da captura */}
            {!preview && streamActive && !loading && (
               <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center justify-center gap-3 z-30">
                 <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/65">
                   Centralize o alimento no quadro
                 </p>
                 <button 
                  onClick={captureFromCamera}
                  className={`relative flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/20 p-1 transition-all active:scale-95 ${scannerCaptureButtonSurfaceClass}`}
                >
                  {!reduceInlineCameraEffects ? (
                    <div className="absolute inset-0 rounded-full bg-white/10 blur-md"></div>
                  ) : null}
                  <div className="relative h-full w-full rounded-full bg-white opacity-85 shadow-lg"></div>
                </button>
               </div>
            )}
          </main>
        </>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </AppPageShell>
  );
}

function MacroCard({ label, value, percentage }: { label: string; value: string; percentage: number }) {
  return (
    <div className="fl-theme-surface p-3 rounded-2xl flex flex-col items-center">
      <span className="text-[10px] fl-theme-text-muted uppercase font-medium">{label}</span>
      <span className="text-xl font-bold tracking-tight">{value}</span>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--fl-color-text) 8%, transparent)" }}>
        <div 
          className="h-full transition-all duration-1000" 
          style={{ backgroundColor: 'var(--app-primary-color)', width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
    </div>
  );
}
