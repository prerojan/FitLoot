import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

import type { AppContext } from "../core/types";
import {
  getMapTileAttribution,
  getMapTileUrlTemplate,
  getOpenRouteServiceApiKey,
  getOpenRouteServiceBaseUrl,
} from "../core/providerConfig";
import { fetchResponseWithTimeout } from "../services/aiTransport";
import {
  MapDirectionsProfileSchema,
  MapPoiSearchRequestSchema,
  type MapCoordinate,
  type MapDirectionsProfile,
  type MapDirectionsResponse,
  type MapGeocodeResult,
  type MapPoiResult,
  type MapTileConfig,
} from "../../shared/mapTypes";

const DEFAULT_MAP_CENTER: MapCoordinate = [-46.6333, -23.5505];
const DEFAULT_MAP_ZOOM = 12;
const DEFAULT_MAP_MIN_ZOOM = 1;
const DEFAULT_MAP_MAX_ZOOM = 19;
const DEFAULT_TILE_SIZE = 256;
const MAP_PROVIDER_TIMEOUT_MS = 8_000;
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const OVERPASS_BASE_URL = "https://overpass-api.de/api/interpreter";

const geocodeQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(8).optional(),
});

const reverseQuerySchema = z.object({
  lon: z.coerce.number().finite().min(-180).max(180),
  lat: z.coerce.number().finite().min(-90).max(90),
});

const directionsQuerySchema = z.object({
  start: z.string().trim().min(3).max(80),
  end: z.string().trim().min(3).max(80),
  profile: MapDirectionsProfileSchema.optional(),
});

function buildMapConfig(c: { env: AppContext["Bindings"] }): MapTileConfig {
  return {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM,
    maxZoom: DEFAULT_MAP_MAX_ZOOM,
    minZoom: DEFAULT_MAP_MIN_ZOOM,
    tileSize: DEFAULT_TILE_SIZE,
    attribution: getMapTileAttribution(c.env),
    tileUrlTemplate: getMapTileUrlTemplate(c.env),
  };
}

function resolvePreferredLanguage(acceptLanguageHeader: string | undefined): string {
  const primary = (acceptLanguageHeader ?? "pt-BR,pt;q=0.9,en;q=0.8")
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return primary ?? "pt-BR";
}

function buildProviderHeaders(c: {
  req: { header: (name: string) => string | undefined };
  env: Pick<AppContext["Bindings"], "FRONTEND_ORIGIN">;
}): Headers {
  const headers = new Headers({
    Accept: "application/json",
  });
  const preferredLanguage = resolvePreferredLanguage(c.req.header("Accept-Language"));
  headers.set("Accept-Language", preferredLanguage);

  const requestOrigin = c.req.header("Origin")?.trim();
  const referer = requestOrigin && requestOrigin.length > 0
    ? requestOrigin
    : c.env.FRONTEND_ORIGIN?.trim();
  if (referer) {
    headers.set("Referer", referer);
  }

  return headers;
}

function parseCoordinatePair(value: string): MapCoordinate | null {
  const [longitudeRaw, latitudeRaw] = value.split(",");
  const longitude = Number(longitudeRaw);
  const latitude = Number(latitudeRaw);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null;
  }

  return [longitude, latitude];
}

function calculateDistanceMeters(start: MapCoordinate, end: MapCoordinate): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeStart = (start[1] * Math.PI) / 180;
  const latitudeEnd = (end[1] * Math.PI) / 180;
  const deltaLatitude = ((end[1] - start[1]) * Math.PI) / 180;
  const deltaLongitude = ((end[0] - start[0]) * Math.PI) / 180;

  const haversine =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2)
    + Math.cos(latitudeStart)
      * Math.cos(latitudeEnd)
      * Math.sin(deltaLongitude / 2)
      * Math.sin(deltaLongitude / 2);
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return earthRadiusMeters * centralAngle;
}

function buildFallbackDirections(
  start: MapCoordinate,
  end: MapCoordinate,
  profile: MapDirectionsProfile,
): MapDirectionsResponse {
  const distance = calculateDistanceMeters(start, end);
  const metersPerSecond = profile === "driving-car"
    ? 8.3
    : profile === "cycling-regular"
      ? 4.2
      : 1.4;

  return {
    distance,
    duration: distance / metersPerSecond,
    geometry: [start, end],
    provider: "fallback",
    used_fallback_route: true,
  };
}

function normalizeGeocodeResults(payload: unknown): MapGeocodeResult[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((entry): MapGeocodeResult[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const longitude = Number(record.lon);
    const latitude = Number(record.lat);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return [];
    }

    const boundingboxRaw = Array.isArray(record.boundingbox) ? record.boundingbox : null;
    const boundingbox = boundingboxRaw && boundingboxRaw.length === 4
      ? [
          Number(boundingboxRaw[0]),
          Number(boundingboxRaw[1]),
          Number(boundingboxRaw[2]),
          Number(boundingboxRaw[3]),
        ] as [number, number, number, number]
      : null;

    return [{
      place_id: typeof record.place_id === "number" || typeof record.place_id === "string"
        ? record.place_id
        : String(record.osm_id ?? `${latitude}:${longitude}`),
      display_name: typeof record.display_name === "string" ? record.display_name : "Localizacao desconhecida",
      latitude,
      longitude,
      address: typeof record.address === "object" && record.address !== null
        ? record.address as MapGeocodeResult["address"]
        : undefined,
      boundingbox,
    }];
  });
}

function normalizeReverseResult(payload: unknown): MapGeocodeResult[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  return normalizeGeocodeResults([payload]);
}

function normalizePoiResults(payload: unknown): MapPoiResult[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const elements = Array.isArray((payload as { elements?: unknown }).elements)
    ? (payload as { elements: unknown[] }).elements
    : [];

  return elements.flatMap((entry): MapPoiResult[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const latitude = typeof record.lat === "number"
      ? record.lat
      : typeof record.center === "object" && record.center !== null && typeof (record.center as { lat?: unknown }).lat === "number"
        ? Number((record.center as { lat: number }).lat)
        : NaN;
    const longitude = typeof record.lon === "number"
      ? record.lon
      : typeof record.center === "object" && record.center !== null && typeof (record.center as { lon?: unknown }).lon === "number"
        ? Number((record.center as { lon: number }).lon)
        : NaN;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return [];
    }

    return [{
      id: String(record.id ?? `${latitude}:${longitude}`),
      latitude,
      longitude,
      tags: typeof record.tags === "object" && record.tags !== null
        ? Object.fromEntries(
            Object.entries(record.tags as Record<string, unknown>)
              .filter(([, value]) => typeof value === "string")
              .map(([key, value]) => [key, value as string]),
          )
        : {},
    }];
  });
}

async function readJsonResponse<T>(
  response: Response,
): Promise<T> {
  return response.json() as Promise<T>;
}

async function requestOpenRouteServiceDirections(
  c: {
    env: AppContext["Bindings"];
  },
  start: MapCoordinate,
  end: MapCoordinate,
  profile: MapDirectionsProfile,
): Promise<MapDirectionsResponse | null> {
  const apiKey = getOpenRouteServiceApiKey(c.env);
  if (!apiKey) {
    return null;
  }

  const url = `${getOpenRouteServiceBaseUrl(c.env)}/directions/${profile}/geojson`;

  try {
    const response = await fetchResponseWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json, application/geo+json",
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [start, end],
        }),
      },
      MAP_PROVIDER_TIMEOUT_MS,
    );

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.warn("[maps][directions][openrouteservice]", {
        status: response.status,
        message: details.slice(0, 240),
      });
      return null;
    }

    const payload = await readJsonResponse<{
      features?: Array<{
        geometry?: { coordinates?: unknown };
        properties?: {
          segments?: Array<{
            distance?: number;
            duration?: number;
          }>;
        };
      }>;
    }>(response);

    const route = payload.features?.[0];
    const geometry = Array.isArray(route?.geometry?.coordinates)
      ? route.geometry.coordinates.flatMap((coordinate): MapCoordinate[] => {
          if (!Array.isArray(coordinate) || coordinate.length < 2) {
            return [];
          }

          const longitude = Number(coordinate[0]);
          const latitude = Number(coordinate[1]);
          if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
            return [];
          }

          return [[longitude, latitude]];
        })
      : [];

    const segment = Array.isArray(route?.properties?.segments)
      ? route.properties.segments[0]
      : undefined;

    if (geometry.length < 2 || !segment) {
      return null;
    }

    return {
      distance: Number(segment.distance ?? 0),
      duration: Number(segment.duration ?? 0),
      geometry,
      provider: "openrouteservice",
      used_fallback_route: false,
    };
  } catch (error) {
    console.warn("[maps][directions][openrouteservice]", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export function registerMapRoutes(app: Hono<AppContext>): void {
  app.get("/api/maps/config", async (c) => {
    return c.json(buildMapConfig(c));
  });

  app.get("/api/maps/geocode", zValidator("query", geocodeQuerySchema), async (c) => {
    const { q, limit = 5 } = c.req.valid("query");
    const url = new URL(`${NOMINATIM_BASE_URL}/search`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", resolvePreferredLanguage(c.req.header("Accept-Language")));

    try {
      const response = await fetchResponseWithTimeout(
        url.toString(),
        {
          headers: buildProviderHeaders(c),
        },
        MAP_PROVIDER_TIMEOUT_MS,
      );

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        console.warn("[maps][geocode][nominatim]", {
          status: response.status,
          message: details.slice(0, 240),
        });
        return c.json({ error: "Nao foi possivel localizar este endereco agora." }, 503);
      }

      const payload = await readJsonResponse<unknown>(response);
      return c.json(normalizeGeocodeResults(payload));
    } catch (error) {
      console.warn("[maps][geocode][nominatim]", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return c.json({ error: "Nao foi possivel localizar este endereco agora." }, 503);
    }
  });

  app.get("/api/maps/reverse", zValidator("query", reverseQuerySchema), async (c) => {
    const { lon, lat } = c.req.valid("query");
    const url = new URL(`${NOMINATIM_BASE_URL}/reverse`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", resolvePreferredLanguage(c.req.header("Accept-Language")));

    try {
      const response = await fetchResponseWithTimeout(
        url.toString(),
        {
          headers: buildProviderHeaders(c),
        },
        MAP_PROVIDER_TIMEOUT_MS,
      );

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        console.warn("[maps][reverse][nominatim]", {
          status: response.status,
          message: details.slice(0, 240),
        });
        return c.json({ error: "Nao foi possivel converter esta localizacao agora." }, 503);
      }

      const payload = await readJsonResponse<unknown>(response);
      return c.json(normalizeReverseResult(payload));
    } catch (error) {
      console.warn("[maps][reverse][nominatim]", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return c.json({ error: "Nao foi possivel converter esta localizacao agora." }, 503);
    }
  });

  app.get("/api/maps/directions", zValidator("query", directionsQuerySchema), async (c) => {
    const { start, end, profile = "foot-walking" } = c.req.valid("query");
    const startCoordinate = parseCoordinatePair(start);
    const endCoordinate = parseCoordinatePair(end);
    if (!startCoordinate || !endCoordinate) {
      return c.json({ error: "Coordenadas invalidas para rota." }, 400);
    }

    const liveRoute = await requestOpenRouteServiceDirections(
      c,
      startCoordinate,
      endCoordinate,
      profile,
    );

    return c.json(liveRoute ?? buildFallbackDirections(startCoordinate, endCoordinate, profile));
  });

  app.post("/api/maps/poi", zValidator("json", MapPoiSearchRequestSchema), async (c) => {
    const { center, radius = 1000, tags } = c.req.valid("json");
    const tagQuery = Object.entries(tags)
      .map(([key, value]) => `["${key}"="${value}"]`)
      .join("");
    const query = `[out:json];
(
  node${tagQuery}(around:${radius},${center[1]},${center[0]});
  way${tagQuery}(around:${radius},${center[1]},${center[0]});
  relation${tagQuery}(around:${radius},${center[1]},${center[0]});
);
out center tags;`;

    try {
      const response = await fetchResponseWithTimeout(
        OVERPASS_BASE_URL,
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(buildProviderHeaders(c).entries()),
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: `data=${encodeURIComponent(query)}`,
        },
        MAP_PROVIDER_TIMEOUT_MS,
      );

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        console.warn("[maps][poi][overpass]", {
          status: response.status,
          message: details.slice(0, 240),
        });
        return c.json({ error: "Nao foi possivel buscar pontos proximos agora." }, 503);
      }

      const payload = await readJsonResponse<unknown>(response);
      return c.json(normalizePoiResults(payload));
    } catch (error) {
      console.warn("[maps][poi][overpass]", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return c.json({ error: "Nao foi possivel buscar pontos proximos agora." }, 503);
    }
  });
}
