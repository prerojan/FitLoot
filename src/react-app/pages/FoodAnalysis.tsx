import { useMemo, useRef, useState, type ChangeEventHandler } from "react";
import { useNavigate } from "react-router";
import { Camera, ImagePlus, Loader2, RefreshCw, Save, AlertTriangle, CheckCircle2 } from "lucide-react";
import BottomNav from "@/react-app/components/BottomNav";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
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
  warning?: string;
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
  has_estimates?: boolean;
  estimation_warning?: string;
};

type IdentifiedItem = {
  food_name: string;
  portion_description: string;
  portion_multiplier: number;
};

type MediaPipeCategory = {
  categoryName?: string;
  score?: number;
};

type MediaPipeDetectionResult = {
  detections?: Array<{
    categories?: MediaPipeCategory[];
  }>;
};

type MediaPipeObjectDetector = {
  detect: (image: HTMLImageElement) => MediaPipeDetectionResult;
};

type MediaPipeFilesetResolver = {
  forVisionTasks: (path: string) => Promise<unknown>;
};

type MediaPipeObjectDetectorFactory = {
  createFromOptions: (vision: unknown, options: Record<string, unknown>) => Promise<MediaPipeObjectDetector>;
};

declare global {
  interface Window {
    FilesetResolver?: MediaPipeFilesetResolver;
    ObjectDetector?: MediaPipeObjectDetectorFactory;
  }
}

let detectorPromise: Promise<MediaPipeObjectDetector> | null = null;

async function getFoodDetector() {
  if (!window.FilesetResolver || !window.ObjectDetector) {
    throw new Error("MediaPipe Vision não carregado. Verifique o script vision_bundle.mjs no index.html.");
  }

  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await window.FilesetResolver!.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      return window.ObjectDetector!.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite",
        },
        scoreThreshold: 0.35,
        maxResults: 5,
        runningMode: "IMAGE",
      });
    })();
  }

  return detectorPromise;
}

function toIdentifiedItems(result: MediaPipeDetectionResult): IdentifiedItem[] {
  const detections = result.detections ?? [];
  return detections
    .flatMap((detection) => detection.categories ?? [])
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
  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [saving, setSaving] = useState(false);

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

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamActive(false);
  };

  const identifyFoodWithMediaPipe = async (image: HTMLImageElement) => {
    const detector = await getFoodDetector();
    const detection = detector.detect(image);
    const items = toIdentifiedItems(detection);

    if (items.length === 0) {
      throw new Error("Não foi possível identificar alimentos com o modelo local. Tente outra foto.");
    }

    return items;
  };

  const runAnalysis = async (base64: string) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
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

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Falha ao analisar alimento");
      }
      setResult(data as AnalysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível analisar a foto.");
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

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
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 pt-8 pb-6 rounded-b-3xl shadow-xl">
        <h1 className="text-2xl font-bold">Análise de alimentos</h1>
        <p className="text-emerald-100 text-sm mt-1">Foto por câmera ou galeria, com MediaPipe + USDA + fallback</p>
      </div>

      <div className="px-6 py-6 space-y-4">
        <Card tone="soft" className="p-4 space-y-3">
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
              <label className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-gray-200 py-3 px-4 cursor-pointer font-medium text-gray-700">
                <ImagePlus className="w-4 h-4" />
                Selecionar da galeria
                <input type="file" accept="image/*" className="hidden" onChange={onPickGallery} />
              </label>
            </>
          )}

          {cameraError && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-700 text-sm">{cameraError}</div>
          )}

          {streamActive && <video ref={videoRef} className="w-full rounded-2xl" autoPlay playsInline muted />}
          {preview && <img src={preview} alt="Prévia do alimento" className="w-full rounded-2xl" />}
          <canvas ref={canvasRef} className="hidden" />
        </Card>

        {loading && (
          <Card tone="soft" className="p-6">
            <div className="flex items-center justify-center gap-2 text-emerald-700">
              <Loader2 className="w-5 h-5 animate-spin" />
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

            <Card className="p-5 space-y-4">
              <h2 className="fl-title-card">Resumo nutricional</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="🔥 Calorias" value={`${result.totals.calories} kcal`} />
                <Metric label="⚡ Energia" value={`${result.totals.energy_kj} kJ`} />
                <Metric label="💪 Proteínas" value={`${result.totals.protein} g`} />
                <Metric label="🌾 Carboidratos" value={`${result.totals.carbs} g`} />
                <Metric label="🥑 Gorduras" value={`${result.totals.fats} g`} />
              </div>

              <MacroBar label={`Proteínas ${macroBars.protein}%`} value={macroBars.protein} color="bg-blue-500" />
              <MacroBar label={`Carboidratos ${macroBars.carbs}%`} value={macroBars.carbs} color="bg-emerald-500" />
              <MacroBar label={`Gorduras ${macroBars.fats}%`} value={macroBars.fats} color="bg-amber-500" />
            </Card>

            <Card className="p-5 space-y-3">
              <h3 className="font-semibold text-gray-900">Itens identificados</h3>
              {result.items.map((item, idx) => (
                <div key={`${item.food_name}-${idx}`} className="rounded-xl border border-gray-200 p-3 text-sm">
                  <p className="font-semibold text-gray-900">{item.food_name}</p>
                  <p className="text-gray-600">{item.portion_description}</p>
                  <p className="text-gray-700 mt-1">{item.calories ?? "-"} kcal • P {item.protein ?? "-"}g • C {item.carbs ?? "-"}g • G {item.fats ?? "-"}g</p>
                  {item.source !== "usda" && <p className="text-amber-600 mt-1">Fonte: {item.source === "estimate" ? "estimativa IA" : item.source === "rapidapi" ? "RapidAPI" : "OCR do rótulo"}</p>}
                </div>
              ))}
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => { setPreview(null); setResult(null); setError(null); }} variant="secondary" className="w-full">
                <RefreshCw className="w-4 h-4" />
                Refazer foto
              </Button>
              <Button onClick={saveMeal} disabled={saving} className="w-full">
                <Save className="w-4 h-4" />
                {saving ? "Salvando..." : "Salvar refeição"}
              </Button>
            </div>
          </>
        )}
      </div>

      <BottomNav active="missions" />
    </div>
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
