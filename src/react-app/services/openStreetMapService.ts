/**
 * Camada de mapas do frontend.
 * O cliente não fala mais direto com provedores públicos; toda leitura externa
 * passa pelo Worker em `/api/maps/*`.
 */

import type {
  MapCoordinate,
  MapDirectionsProfile,
  MapDirectionsResponse,
  MapGeocodeResult,
  MapPoiResult,
  MapTileConfig,
} from "@/shared/mapTypes";
import { fetchJson } from "@/react-app/utils/api";

export type OSMConfig = MapTileConfig;
export type NominatimResult = MapGeocodeResult;

export interface OSMMarker {
  id: string;
  longitude: number;
  latitude: number;
  title?: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface OSMRoute {
  id: string;
  coordinates: [number, number][];
  color?: string;
  width?: number;
  opacity?: number;
}

type MapProviderStatus = {
  initialized: boolean;
  tileServer: string;
  geocoderServer: string;
  directionsProvider: string;
};

const DEFAULT_OSM_CONFIG: OSMConfig = {
  center: [-46.6333, -23.5505],
  zoom: 12,
  maxZoom: 19,
  minZoom: 1,
  tileSize: 256,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  tileUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};

const MAP_REQUEST_TIMEOUT_MS = 8_000;
const DIRECTIONS_REQUEST_TIMEOUT_MS = 10_000;

function normalizeLookupText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function roundCoordinate(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildDirectionsQuery(
  start: MapCoordinate,
  end: MapCoordinate,
  profile: MapDirectionsProfile,
): string {
  const params = new URLSearchParams();
  params.set("start", `${roundCoordinate(start[0])},${roundCoordinate(start[1])}`);
  params.set("end", `${roundCoordinate(end[0])},${roundCoordinate(end[1])}`);
  params.set("profile", profile);
  return params.toString();
}

function buildStaticMapSvgDataUrl(
  center: MapCoordinate,
  width: number,
  height: number,
  markers?: OSMMarker[],
): string {
  const safeWidth = Math.max(160, Math.round(width));
  const safeHeight = Math.max(120, Math.round(height));
  const markerItems = Array.isArray(markers) ? markers : [];
  const markersByAxis = markerItems.map((marker) => ({
    longitude: marker.longitude,
    latitude: marker.latitude,
    color: marker.color ?? "#10b981",
  }));
  const allLongitudes = [center[0], ...markersByAxis.map((marker) => marker.longitude)];
  const allLatitudes = [center[1], ...markersByAxis.map((marker) => marker.latitude)];
  const minLongitude = Math.min(...allLongitudes);
  const maxLongitude = Math.max(...allLongitudes);
  const minLatitude = Math.min(...allLatitudes);
  const maxLatitude = Math.max(...allLatitudes);
  const longitudeRange = Math.max(0.002, maxLongitude - minLongitude);
  const latitudeRange = Math.max(0.002, maxLatitude - minLatitude);
  const padding = 28;

  const toSvgPoint = (coordinate: MapCoordinate): { x: number; y: number } => ({
    x: padding + ((coordinate[0] - minLongitude) / longitudeRange) * (safeWidth - padding * 2),
    y: padding + (1 - ((coordinate[1] - minLatitude) / latitudeRange)) * (safeHeight - padding * 2),
  });

  const readCssVariable = (variableName: string, fallback: string): string => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return fallback;
    }

    const resolvedValue = window.getComputedStyle(document.documentElement)
      .getPropertyValue(variableName)
      .trim();
    return resolvedValue.length > 0 ? resolvedValue : fallback;
  };

  const isDarkTheme = typeof document !== "undefined"
    && document.documentElement.getAttribute("data-theme") === "dark";

  const palette = {
    background: isDarkTheme
      ? "#0b1117"
      : readCssVariable("--app-bg-color", "#f5fbf8"),
    surface: isDarkTheme
      ? "rgba(16,24,32,0.96)"
      : readCssVariable("--fl-surface-strong", "rgba(255,255,255,0.94)"),
    surfaceMuted: isDarkTheme
      ? "rgba(15,23,32,0.88)"
      : readCssVariable("--fl-surface-muted", "rgba(244,248,246,0.82)"),
    border: isDarkTheme
      ? "rgba(229,231,235,0.1)"
      : readCssVariable("--fl-border-soft", "rgba(15,23,42,0.08)"),
    accent: readCssVariable("--app-primary-color", "#10b981"),
    accentSoft: readCssVariable("--app-secondary-color", "#14b8a6"),
  };

  const centerPoint = toSvgPoint(center);
  const markerCircles = markerItems.map((marker) => {
    const point = toSvgPoint([marker.longitude, marker.latitude]);
    return `
      <circle cx="${point.x}" cy="${point.y}" r="9" fill="${marker.color ?? "#10b981"}" fill-opacity="0.92" />
      <circle cx="${point.x}" cy="${point.y}" r="4.2" fill="#ffffff" />
    `;
  }).join("");

  const streetLines = Array.from({ length: 7 }, (_, index) => {
    const vertical = padding + ((safeWidth - padding * 2) / 6) * index;
    const horizontal = padding + ((safeHeight - padding * 2) / 6) * index;
    const diagonalOffset = ((safeWidth - padding * 2) / 10) * (index % 3);
    return `
      <line x1="${vertical}" y1="${padding}" x2="${vertical}" y2="${safeHeight - padding}" stroke="${isDarkTheme ? "rgba(229,231,235,0.3)" : "rgba(255,255,255,0.12)"}" />
      <line x1="${padding}" y1="${horizontal}" x2="${safeWidth - padding}" y2="${horizontal}" stroke="${isDarkTheme ? "rgba(229,231,235,0.3)" : "rgba(255,255,255,0.12)"}" />
      <line x1="${padding + diagonalOffset}" y1="${safeHeight - padding}" x2="${safeWidth - diagonalOffset}" y2="${padding}" stroke="${isDarkTheme ? "rgba(209,213,219,0.18)" : "rgba(255,255,255,0.07)"}" />
    `;
  }).join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${palette.surface}" />
          <stop offset="100%" stop-color="${palette.background}" />
        </linearGradient>
        <radialGradient id="accent" cx="50%" cy="18%" r="80%">
          <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.12" />
          <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="roads" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${isDarkTheme ? "rgba(229,231,235,0.34)" : palette.border}" />
          <stop offset="100%" stop-color="${isDarkTheme ? "rgba(209,213,219,0.2)" : palette.accentSoft}" stop-opacity="${isDarkTheme ? "1" : "0.2"}" />
        </linearGradient>
      </defs>
      <rect width="${safeWidth}" height="${safeHeight}" rx="28" fill="url(#bg)" />
      <rect width="${safeWidth}" height="${safeHeight}" rx="28" fill="url(#accent)" />
      <rect x="1" y="1" width="${safeWidth - 2}" height="${safeHeight - 2}" rx="27" fill="none" stroke="${palette.border}" />
      <g stroke-width="1.6" stroke="url(#roads)" stroke-linecap="round">
        ${streetLines}
      </g>
      <circle cx="${centerPoint.x}" cy="${centerPoint.y}" r="16" fill="${palette.accent}" fill-opacity="0.08" />
      <circle cx="${centerPoint.x}" cy="${centerPoint.y}" r="7" fill="${palette.accent}" />
      ${markerCircles}
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

class OpenStreetMapService {
  private config: OSMConfig = DEFAULT_OSM_CONFIG;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      const config = await fetchJson<OSMConfig>("/api/maps/config", {
        timeoutMs: MAP_REQUEST_TIMEOUT_MS,
        orchestrationKey: "maps:config",
        orchestrationPolicy: "join",
        requestClass: "background",
      });
      this.config = {
        ...DEFAULT_OSM_CONFIG,
        ...config,
      };
      this.initialized = true;
    })()
      .finally(() => {
        if (!this.initialized) {
          this.initializationPromise = null;
        }
      });

    return this.initializationPromise;
  }

  getConfig(): OSMConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<OSMConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  async geocode(address: string): Promise<NominatimResult[]> {
    await this.initialize();
    const normalizedAddress = normalizeLookupText(address);
    if (normalizedAddress.length < 2) {
      return [];
    }

    const params = new URLSearchParams({
      q: normalizedAddress,
      limit: "5",
    });

    return fetchJson<NominatimResult[]>(`/api/maps/geocode?${params.toString()}`, {
      timeoutMs: MAP_REQUEST_TIMEOUT_MS,
      orchestrationKey: `maps:geocode:${normalizedAddress.toLowerCase()}`,
      orchestrationPolicy: "join",
    });
  }

  async reverseGeocode(longitude: number, latitude: number): Promise<NominatimResult[]> {
    await this.initialize();
    const params = new URLSearchParams({
      lon: String(roundCoordinate(longitude, 6)),
      lat: String(roundCoordinate(latitude, 6)),
    });

    return fetchJson<NominatimResult[]>(`/api/maps/reverse?${params.toString()}`, {
      timeoutMs: MAP_REQUEST_TIMEOUT_MS,
      orchestrationKey: `maps:reverse:${params.toString()}`,
      orchestrationPolicy: "join",
    });
  }

  async getDirections(
    start: MapCoordinate,
    end: MapCoordinate,
    profile: MapDirectionsProfile = "foot-walking",
  ): Promise<{
    distance: number;
    duration: number;
    geometry: MapCoordinate[];
    provider: MapDirectionsResponse["provider"];
    usedFallbackRoute: boolean;
  }> {
    await this.initialize();
    const query = buildDirectionsQuery(start, end, profile);
    const response = await fetchJson<MapDirectionsResponse>(`/api/maps/directions?${query}`, {
      timeoutMs: DIRECTIONS_REQUEST_TIMEOUT_MS,
      orchestrationKey: `maps:directions:${query}`,
      orchestrationPolicy: "join",
      requestClass: "background",
    });

    return {
      distance: response.distance,
      duration: response.duration,
      geometry: response.geometry,
      provider: response.provider,
      usedFallbackRoute: response.used_fallback_route,
    };
  }

  async searchNearby(
    center: MapCoordinate,
    query: string,
    radius = 1000,
  ): Promise<NominatimResult[]> {
    await this.initialize();
    const results = await this.geocode(query);

    return results.filter((result) => {
      const distance = this.calculateDistance(
        center,
        [result.longitude, result.latitude],
      );
      return distance <= radius;
    });
  }

  async getStaticImage(
    center: MapCoordinate,
    _zoom: number,
    width = 600,
    height = 400,
    markers?: OSMMarker[],
  ): Promise<string> {
    await this.initialize();
    return buildStaticMapSvgDataUrl(center, width, height, markers);
  }

  getTileUrl(): string {
    return this.config.tileUrlTemplate;
  }

  validateCoordinates(longitude: number, latitude: number): boolean {
    return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
  }

  calculateDistance(point1: MapCoordinate, point2: MapCoordinate): number {
    const earthRadiusMeters = 6_371_000;
    const phi1 = (point1[1] * Math.PI) / 180;
    const phi2 = (point2[1] * Math.PI) / 180;
    const deltaPhi = ((point2[1] - point1[1]) * Math.PI) / 180;
    const deltaLambda = ((point2[0] - point1[0]) * Math.PI) / 180;

    const haversine =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2)
      + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

    return earthRadiusMeters * centralAngle;
  }

  async searchPOI(
    center: MapCoordinate,
    tags: Record<string, string>,
    radius = 1000,
  ): Promise<MapPoiResult[]> {
    await this.initialize();
    return fetchJson<MapPoiResult[]>("/api/maps/poi", {
      method: "POST",
      body: JSON.stringify({
        center,
        radius,
        tags,
      }),
      timeoutMs: MAP_REQUEST_TIMEOUT_MS,
      orchestrationKey: `maps:poi:${center.join(",")}:${radius}:${JSON.stringify(tags)}`,
      orchestrationPolicy: "join",
      requestClass: "background",
    });
  }

  getStatus(): MapProviderStatus {
    let tileServer = "";
    try {
      tileServer = new URL(this.config.tileUrlTemplate.replace("{s}.", "").replace("{z}", "0").replace("{x}", "0").replace("{y}", "0")).origin;
    } catch {
      tileServer = this.config.tileUrlTemplate;
    }

    return {
      initialized: this.initialized,
      tileServer,
      geocoderServer: "/api/maps/geocode",
      directionsProvider: "/api/maps/directions",
    };
  }
}

export const openStreetMapService = new OpenStreetMapService();
export default openStreetMapService;
