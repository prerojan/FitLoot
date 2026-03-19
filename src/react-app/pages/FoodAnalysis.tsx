import { useMemo, useRef, useState, useEffect, type ChangeEventHandler } from "react";
import { useNavigate } from "react-router";
import { Camera, AlertTriangle, CheckCircle2, Bolt, ShieldCheck, ImageIcon, ArrowLeft } from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";
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
  const handleBack = () => navigate(-1);

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

      {/* Welcome Screen (Initial State) */}
      {(!streamActive && !preview && !result) ? (
        <div className="flex-1 flex flex-col relative z-20 overflow-y-auto custom-scrollbar pb-4 min-w-0">
          {/* Header */}
          <header className="sticky top-0 z-10 flex items-center justify-between border-b p-3 sm:p-4 lg:p-6 backdrop-blur-md" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 84%, transparent)" }}>
            <button 
              onClick={handleBack}
              className="fl-theme-surface-soft flex h-10 w-10 items-center justify-center rounded-full fl-theme-text-muted transition-opacity hover:opacity-85"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-[0.68rem] font-bold uppercase tracking-[0.2em] sm:text-xs" style={{ color: "var(--fl-color-text)" }}>Scanner de Alimentos</h1>
            <div className="w-10 h-10" /> {/* Spacer */}
          </header>

          {/* Hero Section */}
          <div className="px-4 py-6 text-center sm:px-6 sm:py-10 min-w-0">
            <h2 className="mb-1 text-2xl sm:text-4xl font-bold tracking-tight">Scanner IA</h2>
            <p className="text-[11px] sm:text-sm font-medium" style={{ color: 'var(--app-primary-color)' }}>
              Selecione o portal de entrada para análise
            </p>
          </div>

          {/* Cards Section */}
          <div className="flex-1 space-y-6 px-4 sm:space-y-8 sm:px-6">
            {/* Primary Card - Camera */}
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
                  onClick={startCamera}
                  className="neon-glow flex w-full items-center justify-center gap-2 sm:gap-3 rounded-2xl py-3.5 sm:py-4 text-[11px] sm:text-sm font-bold uppercase tracking-widest transition-all active:scale-95"
                  style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
                >
                  <Bolt className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
                  Iniciar Scan
                </button>
              </div>
            </div>

            {/* Secondary Card - Gallery */}
            <button 
              onClick={() => {
                const input = document.getElementById('gallery-input');
                if (input) input.click();
              }}
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
              <input type="file" id="gallery-input" accept="image/*" className="hidden" onChange={onPickGallery} />
            </button>
          </div>

          {/* Footer Badge */}
          <div className="mt-auto flex justify-center px-4 pb-6 pt-8 sm:px-6 sm:pb-8">
            <div className="fl-theme-surface-soft inline-flex items-center gap-2 rounded-full px-4 py-2 backdrop-blur-sm">
              <ShieldCheck className="w-4 h-4" style={{ color: 'var(--app-primary-color)' }} />
              <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--fl-color-text-muted)" }}>Tecnologia Neural Ativa</span>
            </div>
          </div>
        </div>
      ) : result ? (
        /* Results Screen (Full screen, no black void) */
        <div className="custom-scrollbar flex flex-1 flex-col overflow-y-auto p-3 pb-4 sm:p-4 sm:pb-5 lg:p-6 animate-in fade-in slide-in-from-bottom-5 duration-500 min-w-0" style={{ backgroundColor: "var(--app-bg-color)" }}>
          {/* Header */}
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

          {/* Energy Display */}
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

          {/* Macros Grid */}
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

          {/* Ingredients Section */}
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

          {/* Action Buttons (Fixed or scroll end) */}
          <div className="mt-auto grid grid-cols-2 gap-3 pt-4 sm:gap-4">
            <button 
              onClick={() => { setPreview(null); setResult(null); setError(null); startCamera(); }}
              className="fl-theme-input h-14 rounded-2xl border font-bold text-xs tracking-widest uppercase transition-opacity active:scale-95 hover:opacity-85"
              style={{ borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}
            >
              Repetir Scan
            </button>
            <button 
              onClick={saveMeal}
              disabled={saving}
              className="neon-glow h-14 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
            >
              {saving ? "Registrando..." : "Confirmar e Salvar"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Camera Viewfinder Section (Active Scanner) */}
          <main className="relative flex-1 overflow-hidden">
            {/* Simulated Camera Feed / Video Source */}
            <div className="absolute inset-0 z-0 overflow-hidden flex items-center justify-center bg-black">
              {!preview && streamActive ? (
                <video ref={videoRef} className="h-full w-full object-cover" autoPlay playsInline muted />
              ) : preview ? (
                <img src={preview} alt="Captured food" className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-4 text-slate-500">
                  <Camera className="w-16 h-16 opacity-20" />
                  <p className="text-sm uppercase tracking-widest font-bold">Iniciando Sensor...</p>
                </div>
              )}

              {/* Scanning Overlay Effects */}
              <div className="absolute inset-0 bg-black/20"></div>

              {/* Scanner Frame Corners */}
              <div className="absolute inset-10 border-2 border-transparent pointer-events-none" style={{ animation: "pulse-border 2s infinite" }}>
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 rounded-tl-xl" style={{ borderColor: 'var(--app-primary-color)' }}></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 rounded-tr-xl" style={{ borderColor: 'var(--app-primary-color)' }}></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 rounded-bl-xl" style={{ borderColor: 'var(--app-primary-color)' }}></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 rounded-br-xl" style={{ borderColor: 'var(--app-primary-color)' }}></div>
                <div className="scanner-line"></div>
              </div>
            </div>

            {/* Header Overlay (In Scanner) */}
            <header className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/70 to-transparent">
              <button 
                onClick={() => {
                  if (preview) {
                    setPreview(null);
                    setResult(null);
                    setError(null);
                    void startCamera();
                    return;
                  }
                  stopCamera();
                  setStreamActive(false);
                  handleBack();
                }}
                className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 transition-all hover:bg-white/20"
                aria-label="Voltar"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <h1 className="text-sm font-bold tracking-widest uppercase text-white/90">AI Vision ACTIVE</h1>
              <div className="w-10 h-10" />
            </header>

            {/* Status Messages */}
            <div className="absolute bottom-32 left-0 right-0 px-6 z-10 text-center pointer-events-none">
              {cameraError && (
                <div className="inline-flex items-center gap-3 bg-red-950/60 backdrop-blur-md px-4 py-2 rounded-full border border-red-500/30">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-bold uppercase tracking-widest text-red-400">{cameraError}</span>
                </div>
              )}
              {loading && (
                <div className="inline-flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                    <LoadingBall size="sm" />
                    <span className="text-xs font-bold uppercase tracking-widest text-white/80">Sincronizando Macros...</span>
                </div>
              )}
              {error && (
                <div className="inline-flex items-center gap-3 bg-red-950/60 backdrop-blur-md px-4 py-2 rounded-full border border-red-500/30">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-bold uppercase tracking-widest text-red-400">{error}</span>
                </div>
              )}
            </div>

            {/* Capture Control (Visible when in scanner but no result) */}
            {!preview && streamActive && !loading && (
               <div className="absolute bottom-10 left-0 right-0 flex justify-center z-20">
                 <button 
                  onClick={captureFromCamera}
                  className="w-20 h-20 rounded-full border-4 border-white/20 flex items-center justify-center bg-white/10 active:scale-95 transition-all p-1"
                >
                  <div className="w-full h-full rounded-full bg-white opacity-80 shadow-lg"></div>
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
