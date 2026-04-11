import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DivIcon,
  LayerGroup,
  Map as LeafletMap,
  Marker,
  Polyline,
  TileLayer,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed } from "lucide-react";

import {
  distanceMissionRoutePreviewConfig,
  projectDistanceMissionRouteCoordinate,
  projectDistanceMissionRoutePoints,
  type DistanceMissionRoutePreviewData,
} from "@/react-app/services/distanceMissionRoute";
import { openStreetMapService } from "@/react-app/services/openStreetMapService";
import type { MapCoordinate } from "@/shared/mapTypes";

const CHECKPOINT_REACHED_RADIUS_METERS = 40;

type RouteMissionLeafletMapProps = {
  preview: DistanceMissionRoutePreviewData;
  interactive?: boolean;
  variant?: "details" | "execution" | "screen";
  className?: string;
  userLocation?: MapCoordinate | null;
  traveledCoordinates?: MapCoordinate[];
  bottomInsetPx?: number;
};

type ThemeMode = "light" | "dark";

type RouteLayerRefs = {
  routeShadow: Polyline | null;
  routeMain: Polyline | null;
  progressTrail: Polyline | null;
  startMarker: Marker | null;
  checkpointMarker: Marker | null;
  endMarker: Marker | null;
  userMarker: Marker | null;
};

function readThemeMode(): ThemeMode {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function resolveMapAccentColor(): string {
  if (typeof window === "undefined") {
    return "#10b981";
  }

  const color = window.getComputedStyle(document.documentElement)
    .getPropertyValue("--app-primary-color")
    .trim();
  return color.length > 0 ? color : "#10b981";
}

function resolveFitBoundsOptions(
  variant: RouteMissionLeafletMapProps["variant"],
  interactive: boolean,
  previewZoom: number,
  bottomInsetPx = 0,
) {
  if (variant === "details") {
    return {
      animate: false,
      maxZoom: Math.min(previewZoom, 15),
      paddingTopLeft: [28, 58] as [number, number],
      paddingBottomRight: [28, 116] as [number, number],
    };
  }

  if (variant === "execution" || variant === "screen") {
    const bottomPadding = Math.max(128, Math.round(bottomInsetPx) + 28);
    return {
      animate: false,
      maxZoom: Math.min(previewZoom, 15),
      paddingTopLeft: [48, 58] as [number, number],
      paddingBottomRight: [48, bottomPadding] as [number, number],
    };
  }

  return {
    animate: false,
    maxZoom: Math.min(previewZoom, interactive ? 16 : 15),
    paddingTopLeft: [42, 38] as [number, number],
    paddingBottomRight: [42, 38] as [number, number],
  };
}

function toLatLngs(coordinates: MapCoordinate[]): [number, number][] {
  return coordinates.map(([longitude, latitude]) => [latitude, longitude]);
}

function syncPolyline(
  polyline: Polyline | null,
  latLngs: [number, number][],
): void {
  polyline?.setLatLngs(latLngs);
}

function syncMarker(
  marker: Marker | null,
  latLng: [number, number] | null,
): void {
  if (!marker || !latLng) {
    return;
  }

  marker.setLatLng(latLng);
}

function resolveUserHeadingDegrees(traveledLatLngs: [number, number][]): number {
  if (traveledLatLngs.length < 2) {
    return 0;
  }

  const previousPoint = traveledLatLngs[traveledLatLngs.length - 2];
  const currentPoint = traveledLatLngs[traveledLatLngs.length - 1];
  if (!previousPoint || !currentPoint) {
    return 0;
  }

  const deltaX = currentPoint[1] - previousPoint[1];
  const deltaY = currentPoint[0] - previousPoint[0];
  if (Math.abs(deltaX) <= 0.000001 && Math.abs(deltaY) <= 0.000001) {
    return 0;
  }

  return (Math.atan2(deltaX, -deltaY) * 180) / Math.PI;
}

function createUserArrowIcon(
  leafletModule: typeof import("leaflet"),
  headingDegrees: number,
  accentColor: string,
): DivIcon {
  return leafletModule.divIcon({
    className: "fl-route-user-arrow-icon",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `
      <div
        style="
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: rotate(${headingDegrees}deg);
        "
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path
            d="M11 2.5L18.2 18.5L11 15.2L3.8 18.5Z"
            fill="${accentColor}"
            stroke="#ffffff"
            stroke-width="1.8"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    `,
  });
}

function createRouteSymbolIcon(
  leafletModule: typeof import("leaflet"),
  options: {
    tone: "checkpoint" | "end";
  },
): DivIcon {
  const { tone } = options;

  const iconMarkup = tone === "checkpoint"
    ? `
      <svg width="30" height="42" viewBox="0 0 30 42" aria-hidden="true" style="filter: drop-shadow(0 10px 18px rgba(15,23,42,0.42));">
        <path d="M15 2C8.4 2 3 7.4 3 14C3 22.4 10.7 30.3 15 38C19.3 30.3 27 22.4 27 14C27 7.4 21.6 2 15 2Z" fill="#f8fafc" stroke="#0f172a" stroke-width="2" />
        <circle cx="15" cy="14" r="7.2" fill="none" stroke="#0f172a" stroke-width="3" />
        <circle cx="15" cy="14" r="2.6" fill="#0f172a" />
      </svg>
    `
    : `
      <svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true" style="filter: drop-shadow(0 10px 18px rgba(15,23,42,0.42));">
        <path d="M7 3V34" stroke="#f8fafc" stroke-width="3.2" stroke-linecap="round" />
        <path d="M9 5H24V19H9Z" fill="#f8fafc" stroke="#0f172a" stroke-width="2" stroke-linejoin="round" />
        <path d="M9 5H16.5V12H9Z" fill="#0f172a" />
        <path d="M16.5 12H24V19H16.5Z" fill="#0f172a" />
        <path d="M16.5 5H24V12H16.5Z" fill="#ffffff" />
        <path d="M9 12H16.5V19H9Z" fill="#ffffff" />
      </svg>
    `;

  return leafletModule.divIcon({
    className: "fl-route-marker-symbol-icon",
    iconSize: [tone === "checkpoint" ? 30 : 30, tone === "checkpoint" ? 42 : 38],
    iconAnchor: tone === "checkpoint" ? [15, 38] : [7, 34],
    html: `
      <div style="display:flex;align-items:center;justify-content:center;pointer-events:none;">
        ${iconMarkup}
      </div>
    `,
  });
}

function areLatLngsEquivalent(
  firstPoint: [number, number] | null,
  secondPoint: [number, number] | null,
): boolean {
  return Boolean(
    firstPoint
    && secondPoint
    && Math.abs(firstPoint[0] - secondPoint[0]) <= 0.00001
    && Math.abs(firstPoint[1] - secondPoint[1]) <= 0.00001,
  );
}

function hasReachedRouteCheckpoint(
  checkpoint: MapCoordinate,
  userLocation: MapCoordinate | null,
  traveledCoordinates: MapCoordinate[],
): boolean {
  const coordinatesToEvaluate = userLocation ? [...traveledCoordinates, userLocation] : traveledCoordinates;
  return coordinatesToEvaluate.some((coordinate) => (
    openStreetMapService.calculateDistance(coordinate, checkpoint) <= CHECKPOINT_REACHED_RADIUS_METERS
  ));
}

function findClosestRouteCoordinate(
  routeCoordinates: MapCoordinate[],
  targetCoordinate: MapCoordinate,
): MapCoordinate {
  let closestCoordinate = routeCoordinates[0] ?? targetCoordinate;
  let closestDistance = Number.POSITIVE_INFINITY;

  routeCoordinates.forEach((routeCoordinate) => {
    const distance = openStreetMapService.calculateDistance(routeCoordinate, targetCoordinate);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestCoordinate = routeCoordinate;
    }
  });

  return closestCoordinate;
}

function findClosestRouteCoordinateIndex(
  routeCoordinates: MapCoordinate[],
  targetCoordinate: MapCoordinate,
): number {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  routeCoordinates.forEach((routeCoordinate, index) => {
    const distance = openStreetMapService.calculateDistance(routeCoordinate, targetCoordinate);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function resolveDetailFocusRouteCoordinates(
  routeCoordinates: MapCoordinate[],
  checkpointCoordinate: MapCoordinate,
): MapCoordinate[] {
  if (routeCoordinates.length < 2) {
    return routeCoordinates;
  }

  const checkpointIndex = Math.max(1, findClosestRouteCoordinateIndex(routeCoordinates, checkpointCoordinate));
  const focusCoordinates = routeCoordinates.slice(0, checkpointIndex + 1);
  return focusCoordinates.length >= 2 ? focusCoordinates : routeCoordinates;
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

function normalizeProjectedRoutePointsToViewport(
  points: Array<{ x: number; y: number }>,
  viewport: {
    width: number;
    height: number;
  },
  padding: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  },
): Array<{ x: number; y: number }> {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1) {
    return [{
      x: viewport.width / 2,
      y: (padding.top + ((viewport.height - padding.bottom))) / 2,
    }];
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const routeWidth = Math.max(1, maxX - minX);
  const routeHeight = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, viewport.width - padding.left - padding.right);
  const availableHeight = Math.max(1, viewport.height - padding.top - padding.bottom);
  const scale = Math.min(availableWidth / routeWidth, availableHeight / routeHeight);
  const scaledWidth = routeWidth * scale;
  const scaledHeight = routeHeight * scale;
  const offsetX = padding.left + ((availableWidth - scaledWidth) / 2) - (minX * scale);
  const offsetY = padding.top + ((availableHeight - scaledHeight) / 2) - (minY * scale);

  return points.map((point) => ({
    x: (point.x * scale) + offsetX,
    y: (point.y * scale) + offsetY,
  }));
}

function renderFallbackRouteSymbol(
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

function renderRouteFallbackPolyline(
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
    showEndMarker = true,
  } = options ?? {};
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const startPoint = points[0];
  const fallbackEndPoint = points[points.length - 1] ?? null;
  const resolvedEndPoint = endPoint ?? fallbackEndPoint;
  const overlapsStartAndEnd = Boolean(
    startPoint
    && resolvedEndPoint
    && Math.abs(startPoint.x - resolvedEndPoint.x) <= 6
    && Math.abs(startPoint.y - resolvedEndPoint.y) <= 6,
  );

  return (
    <>
      <polyline
        points={polyline}
        fill="none"
        stroke="rgba(15,23,42,0.22)"
        strokeWidth={22}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.96}
      />
      <polyline
        points={polyline}
        fill="none"
        stroke="var(--app-primary-color)"
        strokeWidth={9.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={1}
      />
      {renderFallbackRouteSymbol(checkpointPoint, "checkpoint")}
      {!overlapsStartAndEnd && showEndMarker
        ? renderFallbackRouteSymbol(resolvedEndPoint, "end")
        : null}
    </>
  );
}

function RouteMissionLeafletMapComponent({
  preview,
  interactive = false,
  variant = "details",
  className = "",
  userLocation = null,
  traveledCoordinates = [],
  bottomInsetPx = 0,
}: RouteMissionLeafletMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);
  const leafletModuleRef = useRef<typeof import("leaflet") | null>(null);
  const routeLayerRefs = useRef<RouteLayerRefs>({
    routeShadow: null,
    routeMain: null,
    progressTrail: null,
    startMarker: null,
    checkpointMarker: null,
    endMarker: null,
    userMarker: null,
  });
  const fittedRouteKeyRef = useRef<string | null>(null);
  const isProgrammaticMapMoveRef = useRef(false);
  const programmaticMoveTimeoutRef = useRef<number | null>(null);
  const hasAutoCenteredOnUserRef = useRef(false);

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [mapReady, setMapReady] = useState(false);
  const [routeLayerReady, setRouteLayerReady] = useState(false);
  const [baseLayerReady, setBaseLayerReady] = useState(false);
  const [followUser, setFollowUser] = useState(interactive);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: distanceMissionRoutePreviewConfig.width,
    height: distanceMissionRoutePreviewConfig.height,
  }));

  const routeLatLngs = useMemo(() => toLatLngs(preview.coordinates), [preview.coordinates]);
  const traveledLatLngs = useMemo(() => toLatLngs(traveledCoordinates), [traveledCoordinates]);
  const userLatLng = useMemo<[number, number] | null>(() => (
    userLocation ? [userLocation[1], userLocation[0]] : null
  ), [userLocation]);
  const startLatLng = useMemo<[number, number]>(
    () => [preview.origin[1], preview.origin[0]],
    [preview.origin],
  );
  const snappedCheckpointCoordinate = useMemo(
    () => findClosestRouteCoordinate(preview.coordinates, preview.checkpoint),
    [preview.checkpoint, preview.coordinates],
  );
  const detailFocusRouteCoordinates = useMemo(
    () => resolveDetailFocusRouteCoordinates(preview.coordinates, snappedCheckpointCoordinate),
    [preview.coordinates, snappedCheckpointCoordinate],
  );
  const snappedEndCoordinate = useMemo(
    () => findClosestRouteCoordinate(preview.coordinates, preview.returnOrigin),
    [preview.coordinates, preview.returnOrigin],
  );
  const checkpointLatLng = useMemo<[number, number]>(
    () => [snappedCheckpointCoordinate[1], snappedCheckpointCoordinate[0]],
    [snappedCheckpointCoordinate],
  );
  const endLatLng = useMemo<[number, number]>(
    () => [snappedEndCoordinate[1], snappedEndCoordinate[0]],
    [snappedEndCoordinate],
  );
  const checkpointReached = useMemo(
    () => hasReachedRouteCheckpoint(preview.checkpoint, userLocation, traveledCoordinates),
    [preview.checkpoint, traveledCoordinates, userLocation],
  );
  const focusRouteLatLngs = useMemo(
    () => toLatLngs(variant === "details" ? detailFocusRouteCoordinates : preview.coordinates),
    [detailFocusRouteCoordinates, preview.coordinates, variant],
  );
  const startAndEndSharePoint = useMemo(
    () => areLatLngsEquivalent(startLatLng, endLatLng),
    [endLatLng, startLatLng],
  );
  const projectedRoutePoints = useMemo(() => {
    const projectedPoints = projectDistanceMissionRoutePoints(
      preview,
      viewportSize.width,
      viewportSize.height,
    );

    if (variant !== "details") {
      return projectedPoints;
    }

    const focusedPoints = projectedPoints.slice(0, detailFocusRouteCoordinates.length);
    return normalizeProjectedRoutePointsToViewport(focusedPoints, viewportSize, {
      left: 28,
      right: 28,
      top: 58,
      bottom: 116,
    });
  }, [
    detailFocusRouteCoordinates.length,
    preview,
    variant,
    viewportSize,
  ]);
  const projectedCheckpointPoint = useMemo(
    () => (
      variant === "details"
        ? projectedRoutePoints[projectedRoutePoints.length - 1] ?? null
        : findClosestProjectedPointOnPolyline(
            projectedRoutePoints,
            projectDistanceMissionRouteCoordinate(
              preview,
              viewportSize.width,
              viewportSize.height,
              preview.checkpoint,
            ),
          )
    ),
    [preview, projectedRoutePoints, variant, viewportSize.height, viewportSize.width],
  );
  const projectedEndPoint = useMemo(
    () => (
      variant === "details"
        ? null
        : findClosestProjectedPointOnPolyline(
            projectedRoutePoints,
            projectDistanceMissionRouteCoordinate(
              preview,
              viewportSize.width,
              viewportSize.height,
              preview.returnOrigin,
            ),
          )
    ),
    [preview, projectedRoutePoints, variant, viewportSize.height, viewportSize.width],
  );
  const previewKey = useMemo(() => [
    preview.missionId,
    preview.generatedAt,
    preview.origin[0].toFixed(5),
    preview.origin[1].toFixed(5),
    preview.checkpoint[0].toFixed(5),
    preview.checkpoint[1].toFixed(5),
    preview.returnOrigin[0].toFixed(5),
    preview.returnOrigin[1].toFixed(5),
    preview.coordinates.length,
  ].join(":"), [
    preview.checkpoint,
    preview.coordinates.length,
    preview.generatedAt,
    preview.missionId,
    preview.origin,
    preview.returnOrigin,
  ]);
  const fitBoundsVariant = variant === "screen" ? "execution" : variant;
  const fittedRouteKey = useMemo(
    () => `${previewKey}:${fitBoundsVariant}:${variant === "details" ? detailFocusRouteCoordinates.length : preview.coordinates.length}`,
    [
      detailFocusRouteCoordinates.length,
      fitBoundsVariant,
      preview.coordinates.length,
      previewKey,
      variant,
    ],
  );
  const showInteractiveFallback = interactive
    ? !routeLayerReady
    : !(mapReady && routeLayerReady && baseLayerReady);
  const showStreetLoadingChip = interactive && mapReady && routeLayerReady && !baseLayerReady;
  const markProgrammaticMapMove = useCallback((durationMs = 750) => {
    if (typeof window === "undefined") {
      return;
    }

    isProgrammaticMapMoveRef.current = true;
    if (programmaticMoveTimeoutRef.current !== null) {
      window.clearTimeout(programmaticMoveTimeoutRef.current);
    }
    programmaticMoveTimeoutRef.current = window.setTimeout(() => {
      isProgrammaticMapMoveRef.current = false;
      programmaticMoveTimeoutRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeMode(readThemeMode());
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => () => {
    if (typeof window !== "undefined" && programmaticMoveTimeoutRef.current !== null) {
      window.clearTimeout(programmaticMoveTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    setFollowUser(interactive);
    hasAutoCenteredOnUserRef.current = false;
  }, [interactive, previewKey]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return;
    }

    const syncViewportSize = () => {
      const nextWidth = Math.max(1, Math.round(element.clientWidth || distanceMissionRoutePreviewConfig.width));
      const nextHeight = Math.max(1, Math.round(element.clientHeight || distanceMissionRoutePreviewConfig.height));

      setViewportSize((current) => (
        current.width === nextWidth && current.height === nextHeight
          ? current
          : {
              width: nextWidth,
              height: nextHeight,
            }
      ));
    };

    syncViewportSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncViewportSize);
      return () => {
        window.removeEventListener("resize", syncViewportSize);
      };
    }

    const observer = new ResizeObserver(() => {
      syncViewportSize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let localMap: LeafletMap | null = null;

    const setupMap = async () => {
      const leafletModule = await import("leaflet");
      const initialMarkerPosition: [number, number] = [0, 0];
      let mapTileConfig = openStreetMapService.getConfig();

      try {
        await openStreetMapService.initialize();
        mapTileConfig = openStreetMapService.getConfig();
      } catch {
        mapTileConfig = openStreetMapService.getConfig();
      }

      if (cancelled || !containerRef.current) {
        return;
      }

      leafletModuleRef.current = leafletModule;
      setRouteLayerReady(false);
      setBaseLayerReady(false);

      localMap = leafletModule.map(containerRef.current, {
        attributionControl: false,
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        tapHold: false,
        preferCanvas: true,
      });
      localMap.setView([preview.center[1], preview.center[0]], preview.zoom, {
        animate: false,
      });

      const tileLayer = leafletModule.tileLayer(mapTileConfig.tileUrlTemplate, {
        attribution: mapTileConfig.attribution,
        minZoom: mapTileConfig.minZoom,
        maxZoom: mapTileConfig.maxZoom,
        tileSize: mapTileConfig.tileSize,
        opacity: 1,
        detectRetina: true,
        updateWhenIdle: true,
        keepBuffer: 1,
      });
      tileLayer.on("tileload", () => {
        if (!cancelled) {
          setBaseLayerReady(true);
        }
      });
      tileLayer.on("load", () => {
        if (!cancelled) {
          setBaseLayerReady(true);
        }
      });
      tileLayer.addTo(localMap);
      tileLayerRef.current = tileLayer;

      const routePane = localMap.createPane("fitloot-route-pane");
      routePane.style.zIndex = "460";
      routePane.style.pointerEvents = "none";

      const markerPane = localMap.createPane("fitloot-route-marker-pane");
      markerPane.style.zIndex = "470";
      markerPane.style.pointerEvents = "none";

      const layerGroup = leafletModule.layerGroup().addTo(localMap);
      layerGroupRef.current = layerGroup;

      routeLayerRefs.current = {
        routeShadow: leafletModule.polyline([], {
          pane: "fitloot-route-pane",
          color: "rgba(15,23,42,0.24)",
          weight: interactive ? 15 : 12,
          opacity: 0.96,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layerGroup),
        routeMain: leafletModule.polyline([], {
          pane: "fitloot-route-pane",
          color: resolveMapAccentColor(),
          weight: interactive ? 8 : 6.25,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layerGroup),
        progressTrail: leafletModule.polyline([], {
          pane: "fitloot-route-pane",
          color: "#ffffff",
          weight: interactive ? 6.75 : 5,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layerGroup),
        startMarker: leafletModule.marker(initialMarkerPosition, {
          pane: "fitloot-route-marker-pane",
          interactive: false,
          keyboard: false,
          opacity: 0,
          icon: leafletModule.divIcon({
            className: "fl-route-marker-start-hidden",
            iconSize: [1, 1],
            html: "",
          }),
        }).addTo(layerGroup),
        checkpointMarker: leafletModule.marker(initialMarkerPosition, {
          pane: "fitloot-route-marker-pane",
          interactive: false,
          keyboard: false,
          icon: createRouteSymbolIcon(leafletModule, {
            tone: "checkpoint",
          }),
        }).addTo(layerGroup),
        endMarker: leafletModule.marker(initialMarkerPosition, {
          pane: "fitloot-route-marker-pane",
          interactive: false,
          keyboard: false,
          icon: createRouteSymbolIcon(leafletModule, {
            tone: "end",
          }),
        }).addTo(layerGroup),
        userMarker: leafletModule.marker(initialMarkerPosition, {
          pane: "fitloot-route-marker-pane",
          interactive: false,
          keyboard: false,
          opacity: 0,
          icon: createUserArrowIcon(
            leafletModule,
            0,
            resolveMapAccentColor(),
          ),
        }).addTo(layerGroup),
      };

      mapRef.current = localMap;
      setMapReady(true);
    };

    void setupMap();

    return () => {
      cancelled = true;
      fittedRouteKeyRef.current = null;
      setMapReady(false);
      setRouteLayerReady(false);
      setBaseLayerReady(false);
      routeLayerRefs.current = {
        routeShadow: null,
        routeMain: null,
        progressTrail: null,
        startMarker: null,
        checkpointMarker: null,
        endMarker: null,
        userMarker: null,
      };
      layerGroupRef.current = null;
      tileLayerRef.current = null;
      if (localMap) {
        localMap.remove();
      }
      mapRef.current = null;
    };
  }, [interactive, preview.center, preview.zoom, variant]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    window.setTimeout(() => {
      map.invalidateSize();
    }, 0);
  }, [mapReady, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    const map = mapRef.current;
    if (!interactive || !map || !mapReady) {
      return;
    }

    if (!routeLayerReady) {
      map.dragging.disable();
      map.doubleClickZoom.disable();
      map.scrollWheelZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
      map.touchZoom.disable();
      return;
    }

    map.dragging.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    map.touchZoom.enable();

    const handleUserViewportGesture = () => {
      if (isProgrammaticMapMoveRef.current) {
        return;
      }

      hasAutoCenteredOnUserRef.current = true;
      setFollowUser(false);
    };

    map.on("dragstart", handleUserViewportGesture);
    map.on("zoomstart", handleUserViewportGesture);

    return () => {
      map.off("dragstart", handleUserViewportGesture);
      map.off("zoomstart", handleUserViewportGesture);
    };
  }, [interactive, mapReady, routeLayerReady]);

  useEffect(() => {
    const leafletModule = leafletModuleRef.current;
    const map = mapRef.current;
    if (!leafletModule || !map || routeLatLngs.length === 0) {
      setRouteLayerReady(false);
      return;
    }

    const accentColor = resolveMapAccentColor();
    routeLayerRefs.current.routeMain?.setStyle({ color: accentColor });
    syncPolyline(routeLayerRefs.current.routeShadow, routeLatLngs);
    syncPolyline(routeLayerRefs.current.routeMain, routeLatLngs);
    syncPolyline(routeLayerRefs.current.progressTrail, traveledLatLngs);

    routeLayerRefs.current.startMarker?.setOpacity(0);
    routeLayerRefs.current.checkpointMarker?.setIcon(createRouteSymbolIcon(leafletModule, {
      tone: "checkpoint",
    }));
    routeLayerRefs.current.endMarker?.setIcon(createRouteSymbolIcon(leafletModule, {
      tone: "end",
    }));
    syncMarker(routeLayerRefs.current.startMarker, startLatLng);
    syncMarker(routeLayerRefs.current.checkpointMarker, checkpointLatLng);
    syncMarker(routeLayerRefs.current.endMarker, endLatLng);
    routeLayerRefs.current.endMarker?.setOpacity(
      variant === "details" || startAndEndSharePoint || (interactive && !checkpointReached) ? 0 : 1,
    );

    if (userLatLng) {
      const headingDegrees = resolveUserHeadingDegrees(traveledLatLngs);
      routeLayerRefs.current.userMarker?.setIcon(
        createUserArrowIcon(leafletModule, headingDegrees, accentColor),
      );
      routeLayerRefs.current.userMarker?.setOpacity(1);
      syncMarker(routeLayerRefs.current.userMarker, userLatLng);
    } else {
      routeLayerRefs.current.userMarker?.setOpacity(0);
    }

    setRouteLayerReady(true);

    if (fittedRouteKeyRef.current === fittedRouteKey) {
      return;
    }

    fittedRouteKeyRef.current = fittedRouteKey;
    const bounds = leafletModule.latLngBounds(
      variant === "details" && focusRouteLatLngs.length >= 2
        ? focusRouteLatLngs
        : routeLatLngs,
    );
    const fitBoundsOptions = resolveFitBoundsOptions(
      fitBoundsVariant,
      interactive,
      preview.zoom,
      bottomInsetPx,
    );

    window.setTimeout(() => {
      map.invalidateSize();
      markProgrammaticMapMove(420);
      if (bounds.isValid()) {
        map.fitBounds(bounds, fitBoundsOptions);
      } else {
        map.setView([preview.center[1], preview.center[0]], preview.zoom);
      }
    }, 0);
  }, [
    interactive,
    preview.center,
    preview.zoom,
    fittedRouteKey,
    previewKey,
    routeLatLngs,
    checkpointReached,
    checkpointLatLng,
    focusRouteLatLngs,
    endLatLng,
    markProgrammaticMapMove,
    startAndEndSharePoint,
    startLatLng,
    themeMode,
    traveledLatLngs,
    userLatLng,
    fitBoundsVariant,
    bottomInsetPx,
    variant,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!interactive || !map || !mapReady || !followUser || !userLatLng || !userLocation) {
      return;
    }

    const currentCenter = map.getCenter();
    const distanceToUserMeters = openStreetMapService.calculateDistance(
      [currentCenter.lng, currentCenter.lat],
      userLocation,
    );
    const desiredZoom = Math.max(map.getZoom(), Math.min(preview.zoom + 2, 17));
    const shouldZoomToUser = !hasAutoCenteredOnUserRef.current || map.getZoom() < desiredZoom - 0.5;

    if (!shouldZoomToUser && distanceToUserMeters <= 8) {
      return;
    }

    hasAutoCenteredOnUserRef.current = true;
    markProgrammaticMapMove(900);
    if (shouldZoomToUser) {
      map.flyTo(userLatLng, desiredZoom, {
        animate: true,
        duration: 0.85,
      });
      return;
    }

    map.panTo(userLatLng, {
      animate: true,
      duration: 0.65,
    });
  }, [
    followUser,
    interactive,
    mapReady,
    markProgrammaticMapMove,
    preview.zoom,
    userLatLng,
    userLocation,
    bottomInsetPx,
  ]);

  return (
    <div
      ref={wrapperRef}
      className={`fl-route-leaflet-map fl-route-leaflet-map--${variant} ${mapReady ? "is-ready" : ""} ${className}`.trim()}
      data-theme={themeMode}
      style={{
        backgroundColor: themeMode === "dark" ? "#05070b" : "#e5e7eb",
        ["--fl-route-controls-bottom" as string]:
          `${Math.max(12, Math.round(bottomInsetPx) + 12)}px`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 z-[3] transition-opacity duration-300"
        aria-hidden="true"
        style={{
          opacity: showInteractiveFallback ? 1 : 0,
        }}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
          preserveAspectRatio="none"
        >
          {renderRouteFallbackPolyline(projectedRoutePoints, {
            checkpointPoint: projectedCheckpointPoint,
            endPoint: projectedEndPoint,
            showEndMarker: variant !== "details" && (!interactive || checkpointReached),
          })}
        </svg>
      </div>
      {showStreetLoadingChip ? (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[2] -translate-x-1/2">
          <div
            className="rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{
              background:
                "color-mix(in srgb, var(--app-bg-color) 78%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--fl-color-text) 12%, transparent)",
              color:
                "color-mix(in srgb, var(--fl-color-text) 80%, transparent)",
              backdropFilter: "blur(16px)",
            }}
          >
            Carregando ruas
          </div>
        </div>
      ) : null}
      {interactive ? (
        <div
          className="absolute right-3 z-[4] pointer-events-auto"
          style={{
            bottom: `${Math.max(12, Math.round(bottomInsetPx) + 12)}px`,
          }}
        >
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-full border shadow-xl transition-transform active:scale-95"
            style={{
              background: "color-mix(in srgb, var(--app-bg-color) 82%, transparent)",
              borderColor: followUser
                ? "color-mix(in srgb, var(--app-primary-color) 34%, transparent)"
                : "color-mix(in srgb, var(--fl-color-text) 14%, transparent)",
              color: followUser ? "var(--app-primary-color)" : "var(--fl-color-text)",
              backdropFilter: "blur(16px)",
            }}
            onClick={() => {
              setFollowUser((current) => {
                const nextValue = !current;
                if (nextValue) {
                  hasAutoCenteredOnUserRef.current = false;
                }
                return nextValue;
              });
            }}
            aria-pressed={followUser}
            aria-label={followUser ? "Desativar acompanhamento do mapa" : "Recentralizar no usuario"}
          >
            <LocateFixed className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="absolute inset-0 z-[1] h-full w-full"
        style={{
          touchAction: interactive ? "none" : "auto",
          cursor: interactive ? "grab" : "default",
        }}
      />
    </div>
  );
}

const RouteMissionLeafletMap = memo(RouteMissionLeafletMapComponent);

export default RouteMissionLeafletMap;
