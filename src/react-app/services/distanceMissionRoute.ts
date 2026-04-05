import { openStreetMapService } from "@/react-app/services/openStreetMapService";
import {
  locationRuntimeService,
  type RuntimeLocation,
} from "@/react-app/services/runtime/locationRuntimeService";
import type { Mission } from "@/shared/types";

type RouteCoordinate = [number, number];

export type DistanceMissionRoutePreviewData = {
  missionId: number;
  targetDistanceMeters: number;
  routeDistanceMeters: number;
  minimumDurationSeconds: number;
  origin: RouteCoordinate;
  checkpoint: RouteCoordinate;
  coordinates: RouteCoordinate[];
  center: RouteCoordinate;
  zoom: number;
  staticMapUrl: string | null;
  locationPrecision: "precise" | "approximate" | "unavailable";
  generatedAt: string;
  usedFallbackRoute: boolean;
};

type CachedDistanceMissionRoutePreview = {
  data: DistanceMissionRoutePreviewData;
  expiresAt: number;
};

type PreviewViewport = {
  center: RouteCoordinate;
  zoom: number;
};

const DISTANCE_ROUTE_CACHE_TTL_MS = 10 * 60_000;
const STATIC_MAP_WIDTH = 960;
const STATIC_MAP_HEIGHT = 540;
const STATIC_MAP_PADDING = 52;
const MIN_TARGET_DISTANCE_METERS = 800;
const MIN_CHECKPOINT_DISTANCE_METERS = 250;
const FALLBACK_WALKING_SPEED_METERS_PER_SECOND = 1.4;
const MAX_STATIC_MAP_ZOOM = 16;
const MIN_STATIC_MAP_ZOOM = 11;

const previewCache = new Map<string, CachedDistanceMissionRoutePreview>();
const previewPromiseCache = new Map<number, Promise<DistanceMissionRoutePreviewData>>();

function normalizeLookupText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isDistanceRouteMission(mission: Mission): boolean {
  if (mission.type !== "daily") {
    return false;
  }

  if (mission.execution_mode === "route_tracking") {
    return true;
  }

  return (
    mission.metric_type === "distance_meters"
    && (mission.activity_kind === "walking" || mission.activity_kind === "running")
  );
}

export function resolveDistanceMissionTargetMeters(mission: Mission): number {
  const metricValue = Number(mission.metric_value ?? mission.target_reps ?? mission.target_time ?? 0);
  if (Number.isFinite(metricValue) && metricValue > 0) {
    return Math.max(MIN_TARGET_DISTANCE_METERS, Math.round(metricValue));
  }

  const goalText = normalizeLookupText(mission.goal);
  const numberMatch = goalText.match(/(\d+(?:[.,]\d+)?)/);
  const rawValue = numberMatch?.[1];
  if (!rawValue) {
    return 3_000;
  }

  const numericValue = Number.parseFloat(rawValue.replace(",", "."));
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 3_000;
  }

  if (goalText.includes("km")) {
    return Math.max(MIN_TARGET_DISTANCE_METERS, Math.round(numericValue * 1000));
  }

  return Math.max(MIN_TARGET_DISTANCE_METERS, Math.round(numericValue));
}

export function formatDistanceMissionAmount(valueInMeters: number): string {
  if (valueInMeters >= 1000) {
    return `${(valueInMeters / 1000).toLocaleString("pt-BR", {
      minimumFractionDigits: valueInMeters % 1000 === 0 ? 0 : 1,
      maximumFractionDigits: 1,
    })} km`;
  }

  return `${Math.round(valueInMeters).toLocaleString("pt-BR")} m`;
}

export function formatDistanceMissionDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.max(1, Math.round((safeSeconds % 3600) / 60));

  if (hours <= 0) {
    return `${minutes} min`;
  }

  return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}

export function resolveDistanceMissionActivityLabel(mission: Mission): string {
  if (mission.activity_kind === "running") {
    return "Corrida";
  }
  if (mission.activity_kind === "walking") {
    return "Caminhada";
  }

  const composedText = normalizeLookupText(
    [mission.title, mission.description, mission.goal, mission.exercise_category, mission.exercise_name]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" "),
  );

  if (
    composedText.includes("corrida")
    || composedText.includes("run")
    || composedText.includes("running")
    || composedText.includes("trote")
  ) {
    return "Corrida";
  }

  if (composedText.includes("caminhada") || composedText.includes("walk")) {
    return "Caminhada";
  }

  return "Percurso";
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function resolveCacheKey(mission: Mission, location: RuntimeLocation): string {
  return [
    mission.id,
    resolveDistanceMissionTargetMeters(mission),
    mission.cycle_date ?? "no-cycle",
    roundCoordinate(location.longitude),
    roundCoordinate(location.latitude),
  ].join(":");
}

function createDeterministicBearingRadians(mission: Mission): number {
  const seedSource = `${mission.id}:${mission.cycle_date ?? mission.created_at ?? mission.updated_at ?? "fitloot"}`;
  let hash = 0;
  for (let index = 0; index < seedSource.length; index += 1) {
    hash = ((hash << 5) - hash + seedSource.charCodeAt(index)) | 0;
  }

  const normalized = Math.abs(hash % 360);
  return (normalized * Math.PI) / 180;
}

function destinationFromDistance(
  origin: RouteCoordinate,
  distanceMeters: number,
  bearingRadians: number,
): RouteCoordinate {
  const earthRadiusMeters = 6_371_000;
  const latitudeRadians = (origin[1] * Math.PI) / 180;
  const longitudeRadians = (origin[0] * Math.PI) / 180;
  const angularDistance = distanceMeters / earthRadiusMeters;

  const destinationLatitude = Math.asin(
    Math.sin(latitudeRadians) * Math.cos(angularDistance)
      + Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );

  const destinationLongitude = longitudeRadians + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
    Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(destinationLatitude),
  );

  return [
    (destinationLongitude * 180) / Math.PI,
    (destinationLatitude * 180) / Math.PI,
  ];
}

function buildRoundTripCoordinates(
  origin: RouteCoordinate,
  checkpoint: RouteCoordinate,
  outboundCoordinates: RouteCoordinate[],
): RouteCoordinate[] {
  if (outboundCoordinates.length === 0) {
    return [origin, checkpoint, origin];
  }

  if (outboundCoordinates.length === 1) {
    return [origin, checkpoint, origin];
  }

  const returnCoordinates = [...outboundCoordinates].reverse().slice(1);
  return [...outboundCoordinates, ...returnCoordinates];
}

function mercatorY(latitude: number): number {
  const safeLatitude = Math.max(Math.min(latitude, 85.05112878), -85.05112878);
  const radians = (safeLatitude * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function resolveRouteViewport(coordinates: RouteCoordinate[]): PreviewViewport {
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  const latitudes = coordinates.map((coordinate) => coordinate[1]);

  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);

  const center: RouteCoordinate = [
    (minLongitude + maxLongitude) / 2,
    (minLatitude + maxLatitude) / 2,
  ];

  const paddedWidth = Math.max(1, STATIC_MAP_WIDTH - STATIC_MAP_PADDING * 2);
  const paddedHeight = Math.max(1, STATIC_MAP_HEIGHT - STATIC_MAP_PADDING * 2);

  const longitudeFraction = Math.max((maxLongitude - minLongitude) / 360, 0.000001);
  const latitudeFraction = Math.max((mercatorY(maxLatitude) - mercatorY(minLatitude)) / (2 * Math.PI), 0.000001);

  const zoomLongitude = Math.log2(paddedWidth / (256 * longitudeFraction));
  const zoomLatitude = Math.log2(paddedHeight / (256 * latitudeFraction));
  const zoom = Math.max(
    MIN_STATIC_MAP_ZOOM,
    Math.min(MAX_STATIC_MAP_ZOOM, Math.floor(Math.min(zoomLongitude, zoomLatitude))),
  );

  return {
    center,
    zoom,
  };
}

async function resolveStaticMapUrl(
  viewport: PreviewViewport,
  origin: RouteCoordinate,
  checkpoint: RouteCoordinate,
): Promise<string | null> {
  try {
    return await openStreetMapService.getStaticImage(
      viewport.center,
      viewport.zoom,
      STATIC_MAP_WIDTH,
      STATIC_MAP_HEIGHT,
      [
        {
          id: "start",
          longitude: origin[0],
          latitude: origin[1],
          color: "green",
        },
        {
          id: "checkpoint",
          longitude: checkpoint[0],
          latitude: checkpoint[1],
          color: "red",
        },
      ],
    );
  } catch {
    return null;
  }
}

async function generateDistanceMissionRoutePreview(
  mission: Mission,
  location: RuntimeLocation,
): Promise<DistanceMissionRoutePreviewData> {
  await openStreetMapService.initialize();

  const origin: RouteCoordinate = [location.longitude, location.latitude];
  const targetDistanceMeters = resolveDistanceMissionTargetMeters(mission);
  const checkpointDistanceMeters = Math.max(
    MIN_CHECKPOINT_DISTANCE_METERS,
    Math.round(targetDistanceMeters / 2),
  );
  const bearing = createDeterministicBearingRadians(mission);
  const checkpoint = destinationFromDistance(origin, checkpointDistanceMeters, bearing);

  let outboundCoordinates: RouteCoordinate[] = [];
  let routeDistanceMeters = targetDistanceMeters;
  let minimumDurationSeconds = Math.round(targetDistanceMeters / FALLBACK_WALKING_SPEED_METERS_PER_SECOND);
  let usedFallbackRoute = false;

  try {
    const directions = await openStreetMapService.getDirections(origin, checkpoint, "foot-walking");
    outboundCoordinates = directions.geometry;
    routeDistanceMeters = Math.max(1, Math.round(directions.distance * 2));
    minimumDurationSeconds = Math.max(60, Math.round(directions.duration * 2));
  } catch {
    usedFallbackRoute = true;
    outboundCoordinates = [origin, checkpoint];
  }

  const coordinates = buildRoundTripCoordinates(origin, checkpoint, outboundCoordinates);
  const viewport = resolveRouteViewport(coordinates);
  const staticMapUrl = await resolveStaticMapUrl(viewport, origin, checkpoint);

  return {
    missionId: mission.id,
    targetDistanceMeters,
    routeDistanceMeters,
    minimumDurationSeconds,
    origin,
    checkpoint,
    coordinates,
    center: viewport.center,
    zoom: viewport.zoom,
    staticMapUrl,
    locationPrecision: location.precision,
    generatedAt: new Date().toISOString(),
    usedFallbackRoute,
  };
}

export function clearDistanceMissionRoutePreviewCache(missionId?: number): void {
  if (typeof missionId !== "number" || !Number.isFinite(missionId)) {
    previewCache.clear();
    previewPromiseCache.clear();
    return;
  }

  for (const key of previewCache.keys()) {
    if (key.startsWith(`${missionId}:`)) {
      previewCache.delete(key);
    }
  }

  previewPromiseCache.delete(missionId);
}

export function findCachedDistanceMissionRoutePreview(
  missionId: number,
): DistanceMissionRoutePreviewData | null {
  if (!Number.isFinite(missionId) || missionId <= 0) {
    return null;
  }

  const now = Date.now();
  let freshestEntry: CachedDistanceMissionRoutePreview | null = null;

  for (const [key, entry] of previewCache.entries()) {
    if (!key.startsWith(`${missionId}:`)) {
      continue;
    }

    if (entry.expiresAt <= now) {
      previewCache.delete(key);
      continue;
    }

    if (!freshestEntry || entry.expiresAt > freshestEntry.expiresAt) {
      freshestEntry = entry;
    }
  }

  return freshestEntry?.data ?? null;
}

export async function getDistanceMissionRoutePreview(
  mission: Mission,
  options?: { forceRefresh?: boolean },
): Promise<DistanceMissionRoutePreviewData> {
  if (!isDistanceRouteMission(mission)) {
    throw new Error("Preview de rota disponivel apenas para missoes diarias de distancia.");
  }

  if (!options?.forceRefresh) {
    const cachedPreview = findCachedDistanceMissionRoutePreview(mission.id);
    if (cachedPreview) {
      return cachedPreview;
    }
  }

  const inflight = previewPromiseCache.get(mission.id);
  if (!options?.forceRefresh && inflight) {
    return inflight;
  }

  const previewPromise = (async () => {
    const location = await locationRuntimeService.getCurrentLocation();
    if (!location) {
      throw new Error("Ative a localizacao para carregar a rota sugerida.");
    }

    const cacheKey = resolveCacheKey(mission, location);
    const cachedEntry = previewCache.get(cacheKey);
    if (!options?.forceRefresh && cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.data;
    }

    const data = await generateDistanceMissionRoutePreview(mission, location);
    previewCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + DISTANCE_ROUTE_CACHE_TTL_MS,
    });
    return data;
  })()
    .finally(() => {
      previewPromiseCache.delete(mission.id);
    });

  previewPromiseCache.set(mission.id, previewPromise);
  return previewPromise;
}

type ProjectedRoutePoint = {
  x: number;
  y: number;
};

function worldPointAtZoom(coordinate: RouteCoordinate, zoom: number): ProjectedRoutePoint {
  const scale = 256 * (2 ** zoom);
  const latitudeRadians = (Math.max(Math.min(coordinate[1], 85.05112878), -85.05112878) * Math.PI) / 180;

  return {
    x: ((coordinate[0] + 180) / 360) * scale,
    y:
      (0.5 - Math.log((1 + Math.sin(latitudeRadians)) / (1 - Math.sin(latitudeRadians))) / (4 * Math.PI))
      * scale,
  };
}

export function projectDistanceMissionRoutePoints(
  preview: DistanceMissionRoutePreviewData,
  width: number,
  height: number,
): ProjectedRoutePoint[] {
  const centerPoint = worldPointAtZoom(preview.center, preview.zoom);

  return preview.coordinates.map((coordinate) => {
    const worldPoint = worldPointAtZoom(coordinate, preview.zoom);
    return {
      x: width / 2 + (worldPoint.x - centerPoint.x),
      y: height / 2 + (worldPoint.y - centerPoint.y),
    };
  });
}

export const distanceMissionRoutePreviewConfig = {
  width: STATIC_MAP_WIDTH,
  height: STATIC_MAP_HEIGHT,
};
