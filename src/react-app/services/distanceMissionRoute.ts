import {
  openStreetMapService,
  type OSMMarker,
} from "@/react-app/services/openStreetMapService";
import {
  locationRuntimeService,
  type RuntimeLocation,
} from "@/react-app/services/runtime/locationRuntimeService";
import type { MapDirectionsProfile } from "@/shared/mapTypes";
import { estimateRouteMissionDurationSecondsFromMeters } from "@/shared/routeMissionDuration";
import type { Mission } from "@/shared/types";

type RouteCoordinate = [number, number];

export type DistanceMissionRoutePreviewData = {
  missionId: number;
  targetDistanceMeters: number;
  routeDistanceMeters: number;
  minimumDurationSeconds: number;
  origin: RouteCoordinate;
  returnOrigin: RouteCoordinate;
  checkpoint: RouteCoordinate;
  coordinates: RouteCoordinate[];
  center: RouteCoordinate;
  zoom: number;
  staticMapUrl: string | null;
  locationPrecision: "precise" | "approximate" | "unavailable";
  generatedAt: string;
  usedFallbackRoute: boolean;
  profile: MapDirectionsProfile;
  routeMode: "round_trip" | "return_to_origin";
};

type CachedDistanceMissionRoutePreview = {
  data: DistanceMissionRoutePreviewData;
  expiresAt: number;
};

type PreviewViewport = {
  center: RouteCoordinate;
  zoom: number;
};

type GeneratedRouteLeg = {
  coordinates: RouteCoordinate[];
  distance: number;
  duration: number;
  usedFallbackRoute: boolean;
};

type BuildDistanceMissionRoutePreviewOptions = {
  mission: Mission;
  origin: RouteCoordinate;
  returnOrigin?: RouteCoordinate;
  targetDistanceMeters?: number;
  locationPrecision?: DistanceMissionRoutePreviewData["locationPrecision"];
};

const DISTANCE_ROUTE_CACHE_TTL_MS = 10 * 60_000;
const MIN_TARGET_DISTANCE_METERS = 800;
const MIN_CHECKPOINT_DISTANCE_METERS = 250;
const STATIC_MAP_WIDTH = 960;
const STATIC_MAP_HEIGHT = 540;
const STATIC_MAP_PADDING = 52;
const MAX_STATIC_MAP_ZOOM = 16;
const MIN_STATIC_MAP_ZOOM = 11;
const START_LOCATION_MAX_AGE_MS = 20_000;
const START_LOCATION_MAX_ACCURACY_METERS = 250;
const PREVIEW_LOCATION_MAX_AGE_MS = 3 * 60_000;
const RETURN_TO_ORIGIN_DISTANCE_RATIO = 1.15;
const DIRECT_RETURN_DISTANCE_BUFFER_METERS = 80;
const COORDINATE_MATCH_TOLERANCE = 0.000015;

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

export function resolveDistanceMissionMinimumDurationSeconds(mission: Mission): number {
  const targetDistanceMeters = resolveDistanceMissionTargetMeters(mission);
  return estimateRouteMissionDurationSecondsFromMeters(
    targetDistanceMeters,
    mission.activity_kind,
  );
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

export function resolveDistanceMissionDirectionsProfile(
  mission: Mission,
): MapDirectionsProfile {
  if (mission.activity_kind === "running") {
    return "foot-walking";
  }

  return "foot-walking";
}

export function toRouteCoordinate(location: Pick<RuntimeLocation, "longitude" | "latitude">): RouteCoordinate {
  return [location.longitude, location.latitude];
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

function coordinatesMatch(first: RouteCoordinate, second: RouteCoordinate): boolean {
  return (
    Math.abs(first[0] - second[0]) <= COORDINATE_MATCH_TOLERANCE
    && Math.abs(first[1] - second[1]) <= COORDINATE_MATCH_TOLERANCE
  );
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

function calculateBearingRadians(
  start: RouteCoordinate,
  end: RouteCoordinate,
): number {
  const latitudeStart = (start[1] * Math.PI) / 180;
  const latitudeEnd = (end[1] * Math.PI) / 180;
  const longitudeDelta = ((end[0] - start[0]) * Math.PI) / 180;

  const y = Math.sin(longitudeDelta) * Math.cos(latitudeEnd);
  const x =
    Math.cos(latitudeStart) * Math.sin(latitudeEnd)
    - Math.sin(latitudeStart) * Math.cos(latitudeEnd) * Math.cos(longitudeDelta);

  return Math.atan2(y, x);
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

function resolveFallbackDurationSeconds(
  mission: Mission,
  distanceMeters: number,
): number {
  return estimateRouteMissionDurationSecondsFromMeters(
    distanceMeters,
    mission.activity_kind,
  );
}

function buildFallbackRouteLeg(
  mission: Mission,
  start: RouteCoordinate,
  end: RouteCoordinate,
): GeneratedRouteLeg {
  const distance = openStreetMapService.calculateDistance(start, end);
  return {
    coordinates: coordinatesMatch(start, end) ? [start] : [start, end],
    distance,
    duration: resolveFallbackDurationSeconds(mission, distance),
    usedFallbackRoute: true,
  };
}

async function requestRouteLeg(
  mission: Mission,
  start: RouteCoordinate,
  end: RouteCoordinate,
  profile: MapDirectionsProfile,
): Promise<GeneratedRouteLeg> {
  if (coordinatesMatch(start, end)) {
    return {
      coordinates: [start],
      distance: 0,
      duration: 0,
      usedFallbackRoute: false,
    };
  }

  try {
    const directions = await openStreetMapService.getDirections(start, end, profile);
    const coordinates = directions.geometry.length > 0 ? directions.geometry : [start, end];
    return {
      coordinates,
      distance: Math.max(0, directions.distance),
      duration: Math.max(0, directions.duration),
      usedFallbackRoute: directions.usedFallbackRoute,
    };
  } catch {
    return buildFallbackRouteLeg(mission, start, end);
  }
}

function mergeRouteCoordinates(routeLegs: RouteCoordinate[][]): RouteCoordinate[] {
  const merged: RouteCoordinate[] = [];

  for (const routeLeg of routeLegs) {
    for (const coordinate of routeLeg) {
      const lastCoordinate = merged[merged.length - 1];
      if (lastCoordinate && coordinatesMatch(lastCoordinate, coordinate)) {
        continue;
      }

      merged.push(coordinate);
    }
  }

  return merged;
}

function resolveDetourCheckpoint(
  mission: Mission,
  origin: RouteCoordinate,
  returnOrigin: RouteCoordinate,
  targetDistanceMeters: number,
): RouteCoordinate {
  const directDistanceToReturn = openStreetMapService.calculateDistance(origin, returnOrigin);
  const seedBearing = createDeterministicBearingRadians(mission);

  if (coordinatesMatch(origin, returnOrigin)) {
    const checkpointDistanceMeters = Math.max(
      MIN_CHECKPOINT_DISTANCE_METERS,
      Math.round(targetDistanceMeters / 2),
    );
    return destinationFromDistance(origin, checkpointDistanceMeters, seedBearing);
  }

  const shouldReturnDirectly =
    targetDistanceMeters <= directDistanceToReturn * RETURN_TO_ORIGIN_DISTANCE_RATIO
    || (targetDistanceMeters - directDistanceToReturn) <= DIRECT_RETURN_DISTANCE_BUFFER_METERS;
  if (shouldReturnDirectly) {
    return returnOrigin;
  }

  const detourDistanceMeters = Math.max(
    MIN_CHECKPOINT_DISTANCE_METERS,
    Math.round((targetDistanceMeters - directDistanceToReturn) / 2),
  );
  const bearingToReturn = calculateBearingRadians(origin, returnOrigin);
  const turnDirection = Math.sin(seedBearing) >= 0 ? 1 : -1;
  const detourBearing = bearingToReturn + turnDirection * (Math.PI / 2.6);

  return destinationFromDistance(origin, detourDistanceMeters, detourBearing);
}

export function isRuntimeLocationFresh(
  location: RuntimeLocation | null,
  maxAgeMs = START_LOCATION_MAX_AGE_MS,
): boolean {
  if (!location) {
    return false;
  }

  const timestampMs = Date.parse(location.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return false;
  }

  return Math.max(0, Date.now() - timestampMs) <= maxAgeMs;
}

export function validateDistanceMissionStartLocation(
  location: RuntimeLocation | null,
): string | null {
  if (!location) {
    return "Ative a localizacao para iniciar esta missao de distancia.";
  }

  if (
    location.precision === "approximate"
    && location.accuracyMeters > START_LOCATION_MAX_ACCURACY_METERS
  ) {
    return "O GPS ainda esta instavel. Aguarde alguns segundos e tente novamente.";
  }

  return null;
}

function isPreviewLocationUsable(location: RuntimeLocation | null): location is RuntimeLocation {
  if (!location) {
    return false;
  }

  return isRuntimeLocationFresh(location, PREVIEW_LOCATION_MAX_AGE_MS);
}

function resolveDistanceMissionPreviewLocation(): RuntimeLocation | null {
  const runtimeLocation = locationRuntimeService.getState().location;
  return isPreviewLocationUsable(runtimeLocation) ? runtimeLocation : null;
}

function toPlanarMeters(
  coordinate: RouteCoordinate,
  referenceLatitude: number,
): { x: number; y: number } {
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude = Math.cos((referenceLatitude * Math.PI) / 180) * 111_320;

  return {
    x: coordinate[0] * metersPerDegreeLongitude,
    y: coordinate[1] * metersPerDegreeLatitude,
  };
}

function calculateDistanceToSegmentMeters(
  point: RouteCoordinate,
  segmentStart: RouteCoordinate,
  segmentEnd: RouteCoordinate,
): number {
  const referenceLatitude = (point[1] + segmentStart[1] + segmentEnd[1]) / 3;
  const pointMeters = toPlanarMeters(point, referenceLatitude);
  const startMeters = toPlanarMeters(segmentStart, referenceLatitude);
  const endMeters = toPlanarMeters(segmentEnd, referenceLatitude);

  const segmentVectorX = endMeters.x - startMeters.x;
  const segmentVectorY = endMeters.y - startMeters.y;
  const segmentLengthSquared = segmentVectorX ** 2 + segmentVectorY ** 2;

  if (segmentLengthSquared <= 0) {
    return Math.hypot(pointMeters.x - startMeters.x, pointMeters.y - startMeters.y);
  }

  const projection = (
    ((pointMeters.x - startMeters.x) * segmentVectorX)
    + ((pointMeters.y - startMeters.y) * segmentVectorY)
  ) / segmentLengthSquared;
  const clampedProjection = Math.max(0, Math.min(1, projection));

  const projectedX = startMeters.x + segmentVectorX * clampedProjection;
  const projectedY = startMeters.y + segmentVectorY * clampedProjection;

  return Math.hypot(pointMeters.x - projectedX, pointMeters.y - projectedY);
}

export function calculateDistanceToRouteMeters(
  point: RouteCoordinate,
  coordinates: RouteCoordinate[],
): number {
  if (coordinates.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (coordinates.length === 1) {
    const singleCoordinate = coordinates[0];
    return singleCoordinate
      ? openStreetMapService.calculateDistance(point, singleCoordinate)
      : Number.POSITIVE_INFINITY;
  }

  let smallestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < coordinates.length; index += 1) {
    const segmentStart = coordinates[index - 1];
    const segmentEnd = coordinates[index];
    if (!segmentStart || !segmentEnd) {
      continue;
    }
    const nextDistance = calculateDistanceToSegmentMeters(point, segmentStart, segmentEnd);
    if (nextDistance < smallestDistance) {
      smallestDistance = nextDistance;
    }
  }

  return smallestDistance;
}

async function buildDistanceMissionRoutePreview(
  options: BuildDistanceMissionRoutePreviewOptions,
): Promise<DistanceMissionRoutePreviewData> {
  const {
    mission,
    origin,
    returnOrigin = origin,
    targetDistanceMeters = resolveDistanceMissionTargetMeters(mission),
    locationPrecision = "precise",
  } = options;

  await openStreetMapService.initialize();

  const normalizedTargetDistance = Math.max(MIN_TARGET_DISTANCE_METERS, Math.round(targetDistanceMeters));
  const profile = resolveDistanceMissionDirectionsProfile(mission);
  const checkpoint = resolveDetourCheckpoint(mission, origin, returnOrigin, normalizedTargetDistance);
  const shouldReturnDirectly = coordinatesMatch(checkpoint, returnOrigin);

  const [outboundLeg, inboundLeg] = await Promise.all([
    requestRouteLeg(mission, origin, checkpoint, profile),
    shouldReturnDirectly
      ? Promise.resolve<GeneratedRouteLeg>({
          coordinates: [returnOrigin],
          distance: 0,
          duration: 0,
          usedFallbackRoute: false,
        })
      : requestRouteLeg(mission, checkpoint, returnOrigin, profile),
  ]);

  const coordinates = mergeRouteCoordinates([
    outboundLeg.coordinates,
    inboundLeg.coordinates,
  ]);
  const viewport = resolveRouteViewport(coordinates.length > 0 ? coordinates : [origin, returnOrigin]);
  const staticMapMarkers: OSMMarker[] = [
    {
      id: "origin",
      longitude: origin[0],
      latitude: origin[1],
      color: "#10b981",
    },
    {
      id: "checkpoint",
      longitude: checkpoint[0],
      latitude: checkpoint[1],
      color: "#22c55e",
    },
  ];

  if (!coordinatesMatch(returnOrigin, origin)) {
    staticMapMarkers.push({
      id: "return-origin",
      longitude: returnOrigin[0],
      latitude: returnOrigin[1],
      color: "#34d399",
    });
  }

  const staticMapUrl = await openStreetMapService.getStaticImage(
    viewport.center,
    viewport.zoom,
    STATIC_MAP_WIDTH,
    STATIC_MAP_HEIGHT,
    staticMapMarkers,
  );

  return {
    missionId: mission.id,
    targetDistanceMeters: normalizedTargetDistance,
    routeDistanceMeters: Math.max(1, Math.round(outboundLeg.distance + inboundLeg.distance)),
    minimumDurationSeconds: Math.max(60, Math.round(outboundLeg.duration + inboundLeg.duration)),
    origin,
    returnOrigin,
    checkpoint,
    coordinates,
    center: viewport.center,
    zoom: viewport.zoom,
    staticMapUrl,
    locationPrecision,
    generatedAt: new Date().toISOString(),
    usedFallbackRoute: outboundLeg.usedFallbackRoute || inboundLeg.usedFallbackRoute,
    profile,
    routeMode: shouldReturnDirectly ? "return_to_origin" : "round_trip",
  };
}

async function generateDistanceMissionRoutePreview(
  mission: Mission,
  location: RuntimeLocation,
): Promise<DistanceMissionRoutePreviewData> {
  return buildDistanceMissionRoutePreview({
    mission,
    origin: toRouteCoordinate(location),
    locationPrecision: location.precision,
  });
}

export async function buildDistanceMissionSessionRoutePreview(
  mission: Mission,
  options: {
    origin: RuntimeLocation;
    returnOrigin?: RouteCoordinate;
    targetDistanceMeters?: number;
  },
): Promise<DistanceMissionRoutePreviewData> {
  return buildDistanceMissionRoutePreview({
    mission,
    origin: toRouteCoordinate(options.origin),
    ...(options.returnOrigin ? { returnOrigin: options.returnOrigin } : {}),
    ...(typeof options.targetDistanceMeters === "number"
      ? { targetDistanceMeters: options.targetDistanceMeters }
      : {}),
    locationPrecision: options.origin.precision,
  });
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
    const cachedPreviewLocation = resolveDistanceMissionPreviewLocation();
    const location = cachedPreviewLocation ?? await locationRuntimeService.getCurrentLocation();
    const usableLocation = isPreviewLocationUsable(location)
      ? location
      : resolveDistanceMissionPreviewLocation();

    if (!usableLocation) {
      throw new Error("Ative a localizacao para carregar a rota sugerida.");
    }

    const cacheKey = resolveCacheKey(mission, usableLocation);
    const cachedEntry = previewCache.get(cacheKey);
    if (!options?.forceRefresh && cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.data;
    }

    const data = await generateDistanceMissionRoutePreview(mission, usableLocation);
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
  return preview.coordinates.map((coordinate) => (
    projectDistanceMissionRouteCoordinate(preview, width, height, coordinate)
  ));
}

export function projectDistanceMissionRouteCoordinate(
  preview: DistanceMissionRoutePreviewData,
  width: number,
  height: number,
  coordinate: RouteCoordinate,
): ProjectedRoutePoint {
  const centerPoint = worldPointAtZoom(preview.center, preview.zoom);
  const worldPoint = worldPointAtZoom(coordinate, preview.zoom);
  return {
    x: width / 2 + (worldPoint.x - centerPoint.x),
    y: height / 2 + (worldPoint.y - centerPoint.y),
  };
}

export const distanceMissionRoutePreviewConfig = {
  width: STATIC_MAP_WIDTH,
  height: STATIC_MAP_HEIGHT,
};
