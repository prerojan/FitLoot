import { memo, useMemo, type ReactNode } from "react";
import { Clock3, LocateFixed, MapPinned, Route } from "lucide-react";
import useDistanceMissionRoutePreview, {
  type DistanceMissionRoutePreviewLoadStrategy,
} from "@/react-app/hooks/useDistanceMissionRoutePreview";
import {
  distanceMissionRoutePreviewConfig,
  formatDistanceMissionAmount,
  formatDistanceMissionDuration,
  projectDistanceMissionRoutePoints,
  resolveDistanceMissionActivityLabel,
  resolveDistanceMissionTargetMeters,
} from "@/react-app/services/distanceMissionRoute";
import type { Mission } from "@/shared/types";

type DistanceMissionRoutePreviewProps = {
  mission: Mission;
  variant?: "card" | "details" | "execution";
  loadStrategy?: DistanceMissionRoutePreviewLoadStrategy;
  className?: string;
  showStats?: boolean;
  children?: ReactNode;
};

function resolveVariantClasses(variant: DistanceMissionRoutePreviewProps["variant"]): string {
  if (variant === "execution") {
    return "aspect-[16/10] sm:aspect-[16/9]";
  }

  return "aspect-video";
}

function renderPreviewPolyline(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) {
    return null;
  }

  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const startPoint = points[0];
  const endPoint = points[points.length - 1];
  const checkpoint = points[Math.max(1, Math.floor(points.length / 2))];

  return (
    <>
      <polyline
        points={polyline}
        fill="none"
        stroke="rgba(255,255,255,0.92)"
        strokeWidth={22}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.22}
      />
      <polyline
        points={polyline}
        fill="none"
        stroke="var(--app-primary-color)"
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.94}
      />
      {startPoint ? (
        <circle
          cx={startPoint.x}
          cy={startPoint.y}
          r={14}
          fill="#ffffff"
          stroke="var(--app-primary-color)"
          strokeWidth={6}
        />
      ) : null}
      {checkpoint ? (
        <circle
          cx={checkpoint.x}
          cy={checkpoint.y}
          r={11}
          fill="var(--app-primary-color)"
          stroke="#ffffff"
          strokeWidth={5}
        />
      ) : null}
      {endPoint ? (
        <circle
          cx={endPoint.x}
          cy={endPoint.y}
          r={14}
          fill="#ffffff"
          stroke="var(--app-primary-color)"
          strokeWidth={6}
        />
      ) : null}
    </>
  );
}

function DistanceMissionRoutePreviewComponent({
  mission,
  variant = "details",
  loadStrategy = "eager",
  className = "",
  showStats = true,
  children,
}: DistanceMissionRoutePreviewProps) {
  const {
    preview,
    loading,
    error,
    loadPreview,
    showPassivePlaceholder,
    locationPrecision,
  } = useDistanceMissionRoutePreview(mission, { loadStrategy });

  const targetDistanceMeters = preview?.targetDistanceMeters ?? resolveDistanceMissionTargetMeters(mission);
  const routeDistanceMeters = preview?.routeDistanceMeters ?? targetDistanceMeters;
  const minimumDurationSeconds = preview?.minimumDurationSeconds ?? Math.max(60, Math.round(targetDistanceMeters / 1.4));
  const activityLabel = resolveDistanceMissionActivityLabel(mission);
  const projectedPoints = useMemo(() => {
    if (!preview) {
      return [];
    }

    return projectDistanceMissionRoutePoints(
      preview,
      distanceMissionRoutePreviewConfig.width,
      distanceMissionRoutePreviewConfig.height,
    );
  }, [preview]);

  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border ${resolveVariantClasses(variant)} ${className}`.trim()}
      style={{
        background:
          "radial-gradient(circle at top, color-mix(in srgb, var(--app-primary-color) 18%, transparent), transparent 46%), linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-muted) 92%, transparent), color-mix(in srgb, var(--fl-surface-strong) 96%, transparent))",
        borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
      }}
    >
      {preview?.staticMapUrl ? (
        <img
          src={preview.staticMapUrl}
          alt={`Rota sugerida para ${activityLabel.toLowerCase()}`}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : null}

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_38%),linear-gradient(180deg,_rgba(8,12,20,0.14),_rgba(8,12,20,0.56))]" />

      {preview ? (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${distanceMissionRoutePreviewConfig.width} ${distanceMissionRoutePreviewConfig.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {renderPreviewPolyline(projectedPoints)}
        </svg>
      ) : null}

      <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3">
        <div className="rounded-full border border-white/16 bg-black/28 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] text-white backdrop-blur-md">
          {activityLabel}
        </div>
        <div className="rounded-full border border-white/16 bg-black/28 px-3 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur-md">
          {preview?.locationPrecision === "approximate" || locationPrecision === "approximate"
            ? "GPS aproximado"
            : "GPS preciso"}
        </div>
      </div>

      {showStats ? (
        <div className="absolute inset-x-4 bottom-4 rounded-[24px] border bg-black/35 p-3 text-white backdrop-blur-md">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <MapPinned className="h-4 w-4 shrink-0 text-white/80" />
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">Meta</p>
                <p className="text-sm font-semibold">{formatDistanceMissionAmount(targetDistanceMeters)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Route className="h-4 w-4 shrink-0 text-white/80" />
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">Rota sugerida</p>
                <p className="text-sm font-semibold">{formatDistanceMissionAmount(routeDistanceMeters)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 shrink-0 text-white/80" />
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">Tempo minimo</p>
                <p className="text-sm font-semibold">{formatDistanceMissionDuration(minimumDurationSeconds)}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {children}

      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/28 backdrop-blur-[2px]">
          <div className="rounded-full border border-white/20 bg-black/35 px-4 py-2 text-xs font-semibold text-white">
            Carregando rota sugerida...
          </div>
        </div>
      ) : null}

      {!preview && !loading ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <div className="max-w-xs rounded-[24px] border border-white/12 bg-black/38 px-5 py-4 text-white backdrop-blur-md">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
              <LocateFixed className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold">
              {showPassivePlaceholder
                ? "A rota sugerida aparece assim que a localizacao estiver disponivel."
                : "Nao foi possivel carregar a rota sugerida agora."}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-white/72">
              {showPassivePlaceholder
                ? "Ao abrir a missao, o app usa sua posicao atual para montar um percurso compativel com a meta."
                : error ?? "Verifique a permissao de localizacao para montar o preview do percurso."}
            </p>
            {!showPassivePlaceholder ? (
              <button
                type="button"
                onClick={() => { void loadPreview({ forceRefresh: true }); }}
                className="mt-4 inline-flex items-center justify-center rounded-full border border-white/16 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                Tentar novamente
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DistanceMissionRoutePreview = memo(DistanceMissionRoutePreviewComponent);

export default DistanceMissionRoutePreview;
