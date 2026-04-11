import { memo, useMemo, type ReactNode } from "react";
import { Clock3, LocateFixed, MapPinned, Route } from "lucide-react";
import useDistanceMissionRoutePreview, {
  type DistanceMissionRoutePreviewLoadStrategy,
} from "@/react-app/hooks/useDistanceMissionRoutePreview";
import RouteMissionLeafletMap from "@/react-app/components/mission-card/RouteMissionLeafletMap";
import {
  distanceMissionRoutePreviewConfig,
  type DistanceMissionRoutePreviewData,
  formatDistanceMissionAmount,
  formatDistanceMissionDuration,
  projectDistanceMissionRouteCoordinate,
  projectDistanceMissionRoutePoints,
  resolveDistanceMissionActivityLabel,
  resolveDistanceMissionMinimumDurationSeconds,
  resolveDistanceMissionTargetMeters,
} from "@/react-app/services/distanceMissionRoute";
import type { MapCoordinate } from "@/shared/mapTypes";
import type { Mission } from "@/shared/types";

type DistanceMissionRoutePreviewProps = {
  mission: Mission;
  variant?: "card" | "details" | "execution" | "screen";
  loadStrategy?: DistanceMissionRoutePreviewLoadStrategy;
  className?: string;
  showStats?: boolean;
  showTopChips?: boolean;
  children?: ReactNode;
  routeStateOverride?: {
    preview: DistanceMissionRoutePreviewData | null;
    loading: boolean;
    error: string | null;
  };
  userLocation?: MapCoordinate | null;
  traveledCoordinates?: MapCoordinate[];
  mapBottomInsetPx?: number;
};

function resolveVariantClasses(
  variant: DistanceMissionRoutePreviewProps["variant"],
): string {
  if (variant === "screen") {
    return "h-full min-h-full";
  }
  if (variant === "execution") {
    return "aspect-[16/10] sm:aspect-[16/9]";
  }

  return "aspect-video";
}

function renderPreviewRouteSymbol(
  point: { x: number; y: number } | null | undefined,
  tone: "checkpoint" | "end",
) {
  if (!point) {
    return null;
  }

  return (
    <g>
      {tone === "checkpoint" ? (
        <>
          <path
            d={`M ${point.x} ${point.y - 36}
                C ${point.x - 6.6} ${point.y - 36}, ${point.x - 12} ${point.y - 30.6}, ${point.x - 12} ${point.y - 24}
                C ${point.x - 12} ${point.y - 15.6}, ${point.x - 4.3} ${point.y - 7.7}, ${point.x} ${point.y}
                C ${point.x + 4.3} ${point.y - 7.7}, ${point.x + 12} ${point.y - 15.6}, ${point.x + 12} ${point.y - 24}
                C ${point.x + 12} ${point.y - 30.6}, ${point.x + 6.6} ${point.y - 36}, ${point.x} ${point.y - 36} Z`}
            fill="#f8fafc"
            stroke="#0f172a"
            strokeWidth={2}
            style={{ filter: "drop-shadow(0 10px 18px rgba(15,23,42,0.42))" }}
          />
          <circle cx={point.x} cy={point.y - 24} r={7.2} fill="none" stroke="#0f172a" strokeWidth={3} />
          <circle cx={point.x} cy={point.y - 24} r={2.6} fill="#0f172a" />
        </>
      ) : (
        <>
          <line
            x1={point.x - 8}
            y1={point.y - 31}
            x2={point.x - 8}
            y2={point.y}
            stroke="#f8fafc"
            strokeWidth={3.2}
            strokeLinecap="round"
            style={{ filter: "drop-shadow(0 10px 18px rgba(15,23,42,0.42))" }}
          />
          <path
            d={`M ${point.x - 6} ${point.y - 29} H ${point.x + 9} V ${point.y - 15} H ${point.x - 6} Z`}
            fill="#f8fafc"
            stroke="#0f172a"
            strokeWidth={2}
            style={{ filter: "drop-shadow(0 10px 18px rgba(15,23,42,0.42))" }}
          />
          <rect x={point.x - 6} y={point.y - 29} width={7.5} height={7} fill="#0f172a" />
          <rect x={point.x + 1.5} y={point.y - 22} width={7.5} height={7} fill="#0f172a" />
        </>
      )}
    </g>
  );
}

function findClosestProjectedPointOnPolyline(
  points: Array<{ x: number; y: number }>,
  target: { x: number; y: number } | null,
): { x: number; y: number } | null {
  if (!target || points.length === 0) {
    return null;
  }

  if (points.length === 1) {
    return points[0] ?? null;
  }

  let closestPoint: { x: number; y: number } | null = null;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }

    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const segmentLengthSquared = (deltaX * deltaX) + (deltaY * deltaY);
    const interpolation = segmentLengthSquared <= 0.00001
      ? 0
      : Math.max(0, Math.min(1, (
        ((target.x - start.x) * deltaX) + ((target.y - start.y) * deltaY)
      ) / segmentLengthSquared));

    const projectedPoint = {
      x: start.x + (deltaX * interpolation),
      y: start.y + (deltaY * interpolation),
    };
    const distanceSquared =
      ((target.x - projectedPoint.x) ** 2) + ((target.y - projectedPoint.y) ** 2);

    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closestPoint = projectedPoint;
    }
  }

  return closestPoint ?? target;
}

function renderPreviewPolyline(
  points: Array<{ x: number; y: number }>,
  options?: {
    checkpointPoint?: { x: number; y: number } | null;
    endPoint?: { x: number; y: number } | null;
    showEndMarker?: boolean;
  },
) {
  if (points.length < 2) {
    return null;
  }

  const {
    checkpointPoint = null,
    endPoint = null,
    showEndMarker = false,
  } = options ?? {};
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const startPoint = points[0];
  const fallbackEndPoint = points[points.length - 1] ?? null;
  const resolvedEndPoint = endPoint ?? fallbackEndPoint;
  const overlapsStartAndEnd = Boolean(
    startPoint
    && resolvedEndPoint
    && Math.abs(startPoint.x - resolvedEndPoint.x) <= 8
    && Math.abs(startPoint.y - resolvedEndPoint.y) <= 8,
  );

  return (
    <>
      <polyline
        points={polyline}
        fill="none"
        stroke="rgba(15,23,42,0.22)"
        strokeWidth={26}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.98}
      />
      <polyline
        points={polyline}
        fill="none"
        stroke="var(--app-primary-color)"
        strokeWidth={12.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={1}
      />
      {renderPreviewRouteSymbol(checkpointPoint, "checkpoint")}
      {!overlapsStartAndEnd && showEndMarker
        ? renderPreviewRouteSymbol(resolvedEndPoint, "end")
        : null}
    </>
  );
}

function DistanceMissionRoutePreviewComponent({
  mission,
  variant = "details",
  loadStrategy = "eager",
  className = "",
  showStats = true,
  showTopChips = true,
  children,
  routeStateOverride,
  userLocation = null,
  traveledCoordinates = [],
  mapBottomInsetPx,
}: DistanceMissionRoutePreviewProps) {
  const previewHookState = useDistanceMissionRoutePreview(mission, {
    loadStrategy,
    disabled: Boolean(routeStateOverride),
  });
  const preview = routeStateOverride?.preview ?? previewHookState.preview;
  const loading = routeStateOverride ? routeStateOverride.loading : previewHookState.loading;
  const error = routeStateOverride?.error ?? previewHookState.error;
  const loadPreview = previewHookState.loadPreview;
  const showPassivePlaceholder = routeStateOverride
    ? false
    : previewHookState.showPassivePlaceholder;
  const locationPrecision = previewHookState.locationPrecision;

  const targetDistanceMeters =
    preview?.targetDistanceMeters ??
    resolveDistanceMissionTargetMeters(mission);
  const routeDistanceMeters =
    preview?.routeDistanceMeters ?? targetDistanceMeters;
  const minimumDurationSeconds =
    preview?.minimumDurationSeconds ??
    resolveDistanceMissionMinimumDurationSeconds(mission);
  const activityLabel = resolveDistanceMissionActivityLabel(mission);
  const isScreenVariant = variant === "screen";
  const usesInteractiveMap =
    Boolean(preview) &&
    (variant === "details" || variant === "execution" || variant === "screen");
  const projectedPoints = useMemo(() => {
    if (!preview || usesInteractiveMap) {
      return [];
    }

    return projectDistanceMissionRoutePoints(
      preview,
      distanceMissionRoutePreviewConfig.width,
      distanceMissionRoutePreviewConfig.height,
    );
  }, [preview, usesInteractiveMap]);
  const projectedCheckpointPoint = useMemo(() => {
    if (!preview || usesInteractiveMap) {
      return null;
    }

    const projectedTarget = projectDistanceMissionRouteCoordinate(
      preview,
      distanceMissionRoutePreviewConfig.width,
      distanceMissionRoutePreviewConfig.height,
      preview.checkpoint,
    );
    return findClosestProjectedPointOnPolyline(projectedPoints, projectedTarget);
  }, [preview, projectedPoints, usesInteractiveMap]);
  const projectedEndPoint = useMemo(() => {
    if (!preview || usesInteractiveMap) {
      return null;
    }

    const projectedTarget = projectDistanceMissionRouteCoordinate(
      preview,
      distanceMissionRoutePreviewConfig.width,
      distanceMissionRoutePreviewConfig.height,
      preview.returnOrigin,
    );
    return findClosestProjectedPointOnPolyline(projectedPoints, projectedTarget);
  }, [preview, projectedPoints, usesInteractiveMap]);
  const hasStaticPreviewImage = Boolean(preview?.staticMapUrl) && !usesInteractiveMap;
  const previewSurfaceStyle = {
    backgroundColor: "var(--app-bg-color)",
    backgroundImage: hasStaticPreviewImage
      ? [
          "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-strong) 8%, transparent), color-mix(in srgb, var(--app-bg-color) 6%, transparent))",
          `url("${preview?.staticMapUrl ?? ""}")`,
          "radial-gradient(circle at 18% 18%, color-mix(in srgb, var(--app-primary-color) 12%, transparent), transparent 28%)",
        ].join(",")
      : [
          "radial-gradient(circle at 18% 18%, color-mix(in srgb, var(--app-primary-color) 12%, transparent), transparent 28%)",
          "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-strong) 94%, transparent), color-mix(in srgb, var(--app-bg-color) 92%, transparent))",
          "linear-gradient(color-mix(in srgb, var(--fl-color-text) 10%, transparent) 1px, transparent 1px)",
          "linear-gradient(90deg, color-mix(in srgb, var(--fl-color-text) 10%, transparent) 1px, transparent 1px)",
        ].join(","),
    backgroundSize: hasStaticPreviewImage ? "auto, cover, auto" : "auto, auto, 32px 32px, 32px 32px",
    backgroundPosition: hasStaticPreviewImage ? "center, center, center" : "center, center, center, center",
    backgroundRepeat: hasStaticPreviewImage ? "no-repeat, no-repeat, no-repeat" : "no-repeat, no-repeat, no-repeat, no-repeat",
  } as const;
  const showPreviewChrome = !loading || Boolean(preview);

  return (
    <div
      className={`relative overflow-hidden ${isScreenVariant ? "" : "rounded-[28px] border"} ${resolveVariantClasses(variant)} ${className}`.trim()}
      style={{
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-strong) 100%, transparent), color-mix(in srgb, var(--app-bg-color) 92%, transparent))",
        borderColor: isScreenVariant
          ? "transparent"
          : "var(--fl-border-soft)",
      }}
    >
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={previewSurfaceStyle}
      />

      {usesInteractiveMap && preview ? (
        <RouteMissionLeafletMap
          preview={preview}
          interactive={variant === "execution" || variant === "screen"}
          variant={variant === "execution" ? "execution" : variant}
          className="absolute inset-0 h-full w-full"
          userLocation={userLocation}
          traveledCoordinates={traveledCoordinates}
          {...(typeof mapBottomInsetPx === "number"
            ? { bottomInsetPx: mapBottomInsetPx }
            : {})}
        />
      ) : null}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: usesInteractiveMap
            ? "transparent"
            : "linear-gradient(180deg, rgba(255,255,255,0), rgba(255,255,255,0.03))",
        }}
      />

      {preview && !usesInteractiveMap ? (
        <svg
          className="absolute inset-0 z-[1] h-full w-full"
          viewBox={`0 0 ${distanceMissionRoutePreviewConfig.width} ${distanceMissionRoutePreviewConfig.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {renderPreviewPolyline(projectedPoints, {
            checkpointPoint: projectedCheckpointPoint,
            endPoint: projectedEndPoint,
          })}
        </svg>
      ) : null}

      {showTopChips && showPreviewChrome ? (
        <div
          className="absolute left-[11px] right-[11px] top-4 flex items-start justify-between gap-3 sm:left-[11px] sm:right-[11px] sm:top-5"
        >
          <div
            className="rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] backdrop-blur-md"
            style={{
              background:
                "color-mix(in srgb, var(--app-bg-color) 72%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--fl-color-text) 12%, transparent)",
              color: "var(--fl-color-text)",
            }}
          >
            {activityLabel}
          </div>
          <div
            className="rounded-full px-3 py-1.5 text-[11px] font-semibold backdrop-blur-md"
            style={{
              background:
                "color-mix(in srgb, var(--app-bg-color) 72%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--fl-color-text) 12%, transparent)",
              color:
                "color-mix(in srgb, var(--fl-color-text) 88%, transparent)",
            }}
          >
            {preview?.locationPrecision === "approximate" ||
            locationPrecision === "approximate"
              ? "GPS aproximado"
              : "GPS preciso"}
          </div>
        </div>
      ) : null}

      {showStats && showPreviewChrome ? (
        <div
          className="absolute inset-x-5 bottom-4 rounded-[24px] p-3 backdrop-blur-md sm:inset-x-6 sm:bottom-5"
          style={{
            background:
              "color-mix(in srgb, var(--app-bg-color) 76%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--fl-color-text) 12%, transparent)",
            color: "var(--fl-color-text)",
          }}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <MapPinned
                className="h-4 w-4 shrink-0"
                style={{
                  color:
                    "color-mix(in srgb, var(--fl-color-text) 78%, transparent)",
                }}
              />
              <div>
                <p
                  className="text-[10px] uppercase tracking-[0.2em]"
                  style={{
                    color:
                      "color-mix(in srgb, var(--fl-color-text) 66%, transparent)",
                  }}
                >
                  Meta
                </p>
                <p className="text-sm font-semibold">
                  {formatDistanceMissionAmount(targetDistanceMeters)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Route
                className="h-4 w-4 shrink-0"
                style={{
                  color:
                    "color-mix(in srgb, var(--fl-color-text) 78%, transparent)",
                }}
              />
              <div>
                <p
                  className="text-[10px] uppercase tracking-[0.2em]"
                  style={{
                    color:
                      "color-mix(in srgb, var(--fl-color-text) 66%, transparent)",
                  }}
                >
                  Rota sugerida
                </p>
                <p className="text-sm font-semibold">
                  {formatDistanceMissionAmount(routeDistanceMeters)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock3
                className="h-4 w-4 shrink-0"
                style={{
                  color:
                    "color-mix(in srgb, var(--fl-color-text) 78%, transparent)",
                }}
              />
              <div>
                <p
                  className="text-[10px] uppercase tracking-[0.2em]"
                  style={{
                    color:
                      "color-mix(in srgb, var(--fl-color-text) 66%, transparent)",
                  }}
                >
                  Tempo minimo
                </p>
                <p className="text-sm font-semibold">
                  {formatDistanceMissionDuration(minimumDurationSeconds)}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showPreviewChrome ? children : null}

      {loading && !preview ? (
        <div
          className="absolute inset-0 z-[3] flex items-center justify-center px-6 backdrop-blur-[2px]"
          style={{
            background:
              "color-mix(in srgb, var(--app-bg-color) 34%, transparent)",
          }}
        >
          <div
            className="mx-auto max-w-[18rem] rounded-full px-4 py-2 text-center text-xs font-semibold"
            style={{
              background:
                "color-mix(in srgb, var(--app-bg-color) 78%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--fl-color-text) 14%, transparent)",
              color: "var(--fl-color-text)",
            }}
          >
            Carregando rota sugerida...
          </div>
        </div>
      ) : null}

      {!preview && !loading ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
          <div
            className="max-w-xs rounded-[24px] px-5 py-4 backdrop-blur-md"
            style={{
              background:
                "color-mix(in srgb, var(--app-bg-color) 80%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--fl-color-text) 12%, transparent)",
              color: "var(--fl-color-text)",
            }}
          >
            <div
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
              style={{
                background:
                  "color-mix(in srgb, var(--fl-color-text) 10%, transparent)",
              }}
            >
              <LocateFixed className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold">
              {showPassivePlaceholder
                ? "A rota sugerida aparece assim que a localizacao estiver disponivel."
                : "Nao foi possivel carregar a rota sugerida agora."}
            </p>
            <p
              className="mt-2 text-xs leading-relaxed"
              style={{
                color:
                  "color-mix(in srgb, var(--fl-color-text) 72%, transparent)",
              }}
            >
              {showPassivePlaceholder
                ? "Ao abrir a missao, o app usa sua posicao atual para montar um percurso compativel com a meta."
                : (error ??
                  "Verifique a permissao de localizacao para montar o preview do percurso.")}
            </p>
            {!showPassivePlaceholder ? (
              <button
                type="button"
                onClick={() => {
                  void loadPreview({ forceRefresh: true });
                }}
                className="mt-4 inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
                style={{
                  background:
                    "color-mix(in srgb, var(--fl-color-text) 10%, transparent)",
                  border:
                    "1px solid color-mix(in srgb, var(--fl-color-text) 12%, transparent)",
                  color: "var(--fl-color-text)",
                }}
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
