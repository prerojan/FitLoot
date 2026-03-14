import { useMemo, useRef, useState, useEffect, type ChangeEventHandler } from "react";
import { useNavigate } from "react-router";
import { Camera, ImagePlus, RefreshCw, Save, AlertTriangle, CheckCircle2 } from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import LoadingBall from "@/react-app/components/LoadingBall";
import { api } from "@/react-app/utils/api";
import { assertString, safeGet } from "@/utils/typeHelpers";

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

export default function FoodAnalysis() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const classifierRef = useRef<MediaPipeClassifier | null>(null);
  const classifierInitRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const classifierClosingRef = useRef(false);

  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [saving, setSaving] = useState(false);

  const [mediaPipeReady, setMediaPipeReady] = useState(false);
  const [mediaPipeLoading, setMediaPipeLoading] = useState(true);
  const [mediaPipeError, setMediaPipeError] = useState<string | null>(null);

  const stopCamera = (updateState = true) => {
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
        // no-op: evita crash em desmontagem concorrente
      }
      classifierRef.current = null;
    }
    if (mountedRef.current) {
      setMediaPipeReady(false);
    }
    classifierClosingRef.current = false;
  };

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

    return () => {
      mountedRef.current = false;
      stopCamera(false);
      destroyMediaPipe();
      classifierInitRef.current = null;
    };
  }, []);

  const identifyFoodWithMediaPipe = async (image: HTMLImageElement) => {
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

  const startCamera = async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreamActive(true);
    } catch {
      setCameraError("Permissão de câmera negada ou indisponível neste dispositivo.");
    }
  };

  const runAnalysis = async (base64: string) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      if (mediaPipeLoading) {
        throw new Error("Aguarde, inicializando análise de imagem...");
      }

      if (!mediaPipeReady) {
        throw new Error(mediaPipeError || "MediaPipe não está pronto para análise.");
      }

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Falha ao carregar imagem para análise local."));
        img.src = `data:image/jpeg;base64,${base64}`;
      });

      const identifiedItems = await identifyFoodWithMediaPipe(image);
      const response = await api("/api/ai/analyze-food", {
        method: "POST",
        body: JSON.stringify({
          identified_items: identifiedItems,
          food_description: identifiedItems.map((item) => item.food_name).join(", "),
        }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      const data = (await response.json().catch(() => null)) as { error?: string | undefined } | AnalysisResult | null;
      if (!response.ok) {
        throw new Error((data as { error?: string | undefined } | null)?.error || "Falha ao analisar alimento");
      }
      setResult(data as AnalysisResult);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Não foi possível analisar a foto.");
    } finally {
      setLoading(false);
    }
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

    const image = canvas.toDataURL("image/jpeg", 0.85);
    setPreview(image);
    stopCamera();
    const base64 = assertString(safeGet(image.split(","), 1));
    if (!base64) {
      setError("Falha ao processar a imagem capturada.");
      return;
    }
    await runAnalysis(base64);
  };

  const onPickGallery: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = safeGet(Array.from(event.target.files ?? []), 0);
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const value = String(reader.result || "");
      if (!value.includes(",")) return;
      setPreview(value);
      const base64 = assertString(safeGet(value.split(","), 1));
      if (!base64) {
        setError("Falha ao processar a imagem selecionada.");
        return;
      }
      await runAnalysis(base64);
    };
    reader.readAsDataURL(file);
  };

  const saveMeal = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const foodName = result.items.map((item) => item.food_name).slice(0, 2).join(" + ") || "Refeição analisada";
      const response = await api("/api/food/scan", {
        method: "POST",
        body: JSON.stringify({ food_name: foodName, calories: result.totals.calories, meal_type: "lanche" }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) throw new Error("Não foi possível salvar o registro");
      navigate("/dashboard");
    } catch {
      setError("Não foi possível salvar a refeição no histórico agora.");
    } finally {
      setSaving(false);
    }
  };

  const macroBars = useMemo(() => result?.totals.macro_percentages ?? { protein: 0, carbs: 0, fats: 0 }, [result]);

  return (
    <AppPageShell bottomNavActive="missions" className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
      <section className="fl-app-container py-4 sm:py-6">
        <div className="rounded-[1.75rem] bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-5 text-white shadow-xl sm:rounded-[2rem] sm:px-6 sm:py-6">
          <h1 className="fl-title-page text-white">Análise de alimentos</h1>
          <p className="mt-1 max-w-2xl text-sm text-emerald-100 sm:text-base">
            Foto por câmera ou galeria, com MediaPipe + USDA + fallback
          </p>
        </div>
      </section>

      <section className="fl-app-container space-y-4 pb-6 pt-1 sm:space-y-5">
        <Card tone="soft" className="space-y-3 p-4 sm:p-5">
          {!preview && (
            <>
              {!streamActive ? (
                <Button onClick={startCamera} className="w-full">
                  <Camera className="w-4 h-4" />
                  Abrir câmera
                </Button>
              ) : (
                <Button onClick={captureFromCamera} className="w-full">
                  <CheckCircle2 className="w-4 h-4" />
                  Tirar foto
                </Button>
              )}
              <label className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 font-medium text-gray-700">
                <ImagePlus className="w-4 h-4" />
                Selecionar da galeria
                <input type="file" accept="image/*" className="hidden" onChange={onPickGallery} />
              </label>
            </>
          )}

          {cameraError && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-700 text-sm">{cameraError}</div>
          )}

          {mediaPipeLoading && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-gray-600 text-sm flex items-center gap-2">
              <LoadingBall size="sm" />
              Inicializando MediaPipe...
            </div>
          )}

          {mediaPipeError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">{mediaPipeError}</div>
          )}

          {streamActive && <video ref={videoRef} className="w-full rounded-2xl object-cover" autoPlay playsInline muted />}
          {preview && (
            <img
              src={preview}
              alt="Prévia do alimento"
              loading="lazy"
              decoding="async"
              className="w-full rounded-2xl object-cover"
            />
          )}
          <canvas ref={canvasRef} className="hidden" />
        </Card>

        {loading && (
          <Card tone="soft" className="p-5 sm:p-6">
            <div className="flex items-center justify-center gap-2 text-emerald-700">
              <LoadingBall size="md" />
              Processando imagem e calculando nutrientes...
            </div>
          </Card>
        )}

        {error && (
          <Card className="p-4 border-2 border-red-200 bg-red-50">
            <div className="flex items-start gap-2 text-red-700 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5" />
              <span>{error}</span>
            </div>
          </Card>
        )}

        {result && (
          <>
            {result.estimation_warning && (
              <Card className="p-4 border-2 border-amber-200 bg-amber-50 text-amber-800 text-sm">
                {result.estimation_warning}
              </Card>
            )}

            <Card className="space-y-4 p-4 sm:p-5">
              <h2 className="fl-title-card">Resumo nutricional</h2>
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <Metric label="Calorias" value={`${result.totals.calories} kcal`} />
                <Metric label="Energia" value={`${result.totals.energy_kj} kJ`} />
                <Metric label="Proteínas" value={`${result.totals.protein} g`} />
                <Metric label="Carboidratos" value={`${result.totals.carbs} g`} />
                <Metric label="Gorduras" value={`${result.totals.fats} g`} />
              </div>

              <MacroBar label={`Proteínas ${macroBars.protein}%`} value={macroBars.protein} color="bg-blue-500" />
              <MacroBar label={`Carboidratos ${macroBars.carbs}%`} value={macroBars.carbs} color="bg-emerald-500" />
              <MacroBar label={`Gorduras ${macroBars.fats}%`} value={macroBars.fats} color="bg-amber-500" />
            </Card>

            <Card className="space-y-3 p-4 sm:p-5">
              <h3 className="font-semibold text-gray-900">Itens identificados</h3>
              {result.items.map((item, index) => (
                <div key={`${item.food_name}-${index}`} className="rounded-xl border border-gray-200 p-3 text-sm">
                  <p className="font-semibold text-gray-900">{item.food_name}</p>
                  <p className="text-gray-600">{item.portion_description}</p>
                  <p className="text-gray-700 mt-1">{item.calories ?? "-"} kcal • P {item.protein ?? "-"}g • C {item.carbs ?? "-"}g • G {item.fats ?? "-"}g</p>
                  {item.source !== "usda" && <p className="text-amber-600 mt-1">Fonte: {item.source === "estimate" ? "estimativa IA" : item.source === "rapidapi" ? "RapidAPI" : "OCR do rótulo"}</p>}
                </div>
              ))}
            </Card>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button onClick={() => { setPreview(null); setResult(null); setError(null); }} variant="secondary" className="w-full">
                <RefreshCw className="w-4 h-4" />
                Refazer foto
              </Button>
              <Button onClick={saveMeal} disabled={saving} className="w-full">
                {saving ? <LoadingBall size="sm" /> : <Save className="w-4 h-4" />}
                {saving ? "Salvando..." : "Salvar refeição"}
              </Button>
            </div>
          </>
        )}
      </section>
    </AppPageShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="fl-card-soft p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function MacroBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}
