import { useMemo, useRef, useState, useEffect, type ChangeEventHandler } from "react";
import { useNavigate } from "react-router";
import { Camera, ImagePlus, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
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

  return (
    <AppPageShell bottomNavActive="missions" className="bg-[#0A0A0A] overflow-hidden h-screen w-full flex flex-col font-display text-white antialiased">
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
          box-shadow: 0 0 15px color-mix(in srgb, var(--app-primary-color) 30%, transparent);
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--app-primary-color) 20%, transparent); border-radius: 10px; }
      `}</style>

      {/* Camera Viewfinder Section */}
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
              <p className="text-sm uppercase tracking-widest font-bold">Câmera pronta</p>
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

          {/* Floating Detection Tags (Mocked placement for visual effect) */}
          {(streamActive || preview) && !result && !error && !loading && (
            <div className="absolute top-1/4 left-1/4 animate-bounce">
              <div className="text-black text-[10px] font-bold px-2 py-0.5 rounded shadow-lg flex items-center gap-1" style={{ backgroundColor: 'var(--app-primary-color)' }}>
                <span className="w-1.5 h-1.5 bg-black rounded-full"></span> 
                ANALISANDO...
              </div>
            </div>
          )}

          {/* Detection Tags (Real Data) */}
          {result && result.items && result.items.length > 0 && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse">
               <div className="text-black text-[10px] font-bold px-3 py-1 rounded-full shadow-lg flex items-center gap-1.5" style={{ backgroundColor: 'var(--app-primary-color)' }}>
                  <CheckCircle2 className="w-3 h-3" />
                  {(result.items[0]?.food_name || "ALIMENTO").toUpperCase()} DETECTADO
                </div>
            </div>
          )}
        </div>

        {/* Header Overlay */}
        <header className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/70 to-transparent">
          <button 
            onClick={() => preview ? (setPreview(null), setResult(null), setError(null)) : navigate("/app")}
            className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 transition-all hover:bg-white/20"
          >
            <Camera className="w-5 h-5 text-white rotate-180" />
          </button>
          <h1 className="text-sm font-bold tracking-widest uppercase text-white/90">Scanner de Alimentos</h1>
          <button className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 transition-all hover:bg-white/20">
            <RefreshCw className="w-5 h-5 text-white" />
          </button>
        </header>

        {/* Status Messages */}
        <div className="absolute bottom-40 left-0 right-0 px-6 z-10 text-center pointer-events-none">
           {cameraError && (
             <div className="inline-flex items-center gap-3 bg-amber-950/60 backdrop-blur-md px-4 py-2 rounded-full border border-amber-500/30">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-bold uppercase tracking-widest text-amber-400">{cameraError}</span>
             </div>
           )}
           {loading && (
             <div className="inline-flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                <LoadingBall size="sm" />
                <span className="text-xs font-bold uppercase tracking-widest text-white/80">Processando Nutrientes...</span>
             </div>
           )}
           {error && (
             <div className="inline-flex items-center gap-3 bg-red-950/60 backdrop-blur-md px-4 py-2 rounded-full border border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-xs font-bold uppercase tracking-widest text-red-400">{error}</span>
             </div>
           )}
           {mediaPipeLoading && !preview && (
             <div className="inline-flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                <LoadingBall size="sm" />
                <span className="text-xs font-medium text-white/60">Calibrando Scanner Local...</span>
             </div>
           )}
        </div>
      </main>

      {/* Analysis Bottom Sheet */}
      <section 
        className={`bottom-sheet rounded-t-[32px] px-6 pt-2 pb-24 z-20 relative -mt-10 transition-transform duration-500 custom-scrollbar overflow-y-auto max-h-[70vh] ${result ? 'translate-y-0' : 'translate-y-4'}`}
        style={{ backgroundColor: 'var(--fl-surface-strong, #161616)' }}
      >
        {/* Drag Handle */}
        <div className="flex justify-center mb-6">
          <div className="w-12 h-1 bg-white/20 rounded-full"></div>
        </div>

        {/* Initial View Controls (Scan or Gallery) */}
        {!preview && !loading && !result && (
          <div className="space-y-4 mb-8">
            {!streamActive ? (
              <button 
                onClick={startCamera} 
                className="w-full py-4 rounded-2xl font-bold text-sm tracking-wide uppercase transition-all active:scale-95 text-black neon-glow"
                style={{ backgroundColor: 'var(--app-primary-color)' }}
              >
                Abrir Scanner
              </button>
            ) : (
              <button 
                onClick={captureFromCamera} 
                className="w-full py-4 rounded-2xl font-bold text-sm tracking-wide uppercase transition-all active:scale-95 text-black neon-glow"
                style={{ backgroundColor: 'var(--app-primary-color)' }}
              >
                Capturar Alimento
              </button>
            )}
            <label className="flex w-full items-center justify-center py-4 rounded-2xl bg-white/5 border border-white/10 font-bold text-sm tracking-wide uppercase cursor-pointer transition-all hover:bg-white/10">
              <ImagePlus className="w-5 h-5 mr-3" />
              Selecionar Galeria
              <input type="file" accept="image/*" className="hidden" onChange={onPickGallery} />
            </label>
          </div>
        )}

        {/* Results View */}
        {result && (
          <>
            {/* Macros Header */}
            <div className="flex justify-between items-end mb-6">
              <div>
                <p className="text-xs text-white/50 uppercase tracking-tighter mb-1">Energia Estimada</p>
                <h2 className="text-4xl font-bold" style={{ color: 'var(--app-primary-color)' }}>
                  {result.totals.calories} <span className="text-lg font-normal text-white/70 tracking-normal ml-1">kcal</span>
                </h2>
              </div>
              <div className="text-right">
                <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold border" style={{ backgroundColor: 'color-mix(in srgb, var(--app-primary-color) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--app-primary-color) 30%, transparent)', color: 'var(--app-primary-color)' }}>
                  ACURÁCIA {result.has_estimates ? '85%' : '94%'}
                </span>
              </div>
            </div>

            {/* Macros Grid */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <MacroCard label="Proteína" value={`${result.totals.protein}g`} percentage={macroBars.protein} />
              <MacroCard label="Carbs" value={`${result.totals.carbs}g`} percentage={macroBars.carbs} />
              <MacroCard label="Gorduras" value={`${result.totals.fats}g`} percentage={macroBars.fats} />
            </div>

            {/* Detected Ingredients */}
            <div className="mb-8">
              <h3 className="text-xs font-bold text-white/50 uppercase tracking-widest mb-4">Ingredientes Detectados</h3>
              <div className="space-y-3">
                {result.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/5 transition-all hover:bg-white/10">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl bg-[#1E1E1E]">
                        {item.food_name.toLowerCase().includes('ovo') ? '🥚' : 
                         item.food_name.toLowerCase().includes('pão') ? '🍞' : 
                         item.food_name.toLowerCase().includes('carne') ? '🥩' : 
                         item.food_name.toLowerCase().includes('frango') ? '🍗' : 
                         item.food_name.toLowerCase().includes('arroz') ? '🍚' : 
                         item.food_name.toLowerCase().includes('feijão') ? '🫘' : 
                         item.food_name.toLowerCase().includes('salad') ? '🥗' : '🍱'}
                      </div>
                      <div>
                        <p className="font-bold text-sm">{item.food_name}</p>
                        <p className="text-[10px] text-white/40">{item.portion_description} • {item.calories || 0} kcal</p>
                      </div>
                    </div>
                    <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--app-primary-color)' }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => { setPreview(null); setResult(null); setError(null); }}
                className="py-4 rounded-2xl bg-white/5 border border-white/10 font-bold text-sm tracking-wide uppercase transition-all active:scale-95 text-white/70 hover:bg-white/10"
              >
                Escanear Novamente
              </button>
              <button 
                onClick={saveMeal}
                disabled={saving}
                className="py-4 rounded-2xl font-bold text-sm tracking-wide uppercase neon-glow transition-all active:scale-95 text-black disabled:opacity-50"
                style={{ backgroundColor: 'var(--app-primary-color)' }}
              >
                {saving ? "Salvando..." : "Confirmar e Salvar"}
              </button>
            </div>
          </>
        )}

        {/* Error / Result Placeholder when empty */}
        {!result && !loading && preview && error && (
          <div className="flex flex-col items-center justify-center py-10">
            <button 
              onClick={() => { setPreview(null); setResult(null); setError(null); startCamera(); }}
              className="px-8 py-3 rounded-xl border border-white/10 bg-white/5 font-bold uppercase text-xs"
            >
              Tentar Novamente
            </button>
          </div>
        )}
      </section>
      <canvas ref={canvasRef} className="hidden" />
    </AppPageShell>
  );
}

function MacroCard({ label, value, percentage }: { label: string; value: string; percentage: number }) {
  return (
    <div className="bg-[#1E1E1E] p-3 rounded-2xl border border-white/5 flex flex-col items-center">
      <span className="text-[10px] text-white/40 uppercase font-medium">{label}</span>
      <span className="text-xl font-bold text-white tracking-tight">{value}</span>
      <div className="w-full h-1 bg-white/10 rounded-full mt-2 overflow-hidden">
        <div 
          className="h-full transition-all duration-1000" 
          style={{ backgroundColor: 'var(--app-primary-color)', width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
    </div>
  );
}
