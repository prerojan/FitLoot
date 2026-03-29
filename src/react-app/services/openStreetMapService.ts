/**
 * Serviço base de mapas e rotas usado pelo frontend.
 * Centraliza geocoding, rota, POI e configuração visual do OpenStreetMap.
 */

export interface OSMConfig {
  center: [number, number];
  zoom: number;
  maxZoom: number;
  minZoom: number;
  tileSize: number;
  attribution: string;
}

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

export interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address: {
    house_number?: string;
    road?: string;
    suburb?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
  boundingbox: [string, string, string, string];
}

// Mantém a configuração externa de rota em um único ponto.
const OPENROUTESERVICE_CONFIG = {
  API_KEY: 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjZhYThlNWM4NDNhNzRiNzdiMTEwZjg3ZjRmMzIxM2E4IiwiaCI6Im11cm11cjY0In0=',
  BASE_URL: 'https://api.openrouteservice.org/v2',
};

class OpenStreetMapService {
  private config: OSMConfig;
  private isInitialized: boolean = false;

  constructor() {
    this.config = {
      center: [-46.6333, -23.5505], // São Paulo, Brazil
      zoom: 12,
      maxZoom: 19,
      minZoom: 1,
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    };
  }

  // Valida a disponibilidade mínima dos provedores antes do uso.
  async initialize(): Promise<void> {
    try {
      const response = await fetch('https://nominatim.openstreetmap.org/search?q=sao+paulo&format=json&limit=1');
      
      if (!response.ok) {
        throw new Error('OpenStreetMap services are not available');
      }

      this.isInitialized = true;
      console.log('OpenStreetMap service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize OpenStreetMap service:', error);
      throw new Error('Failed to initialize OpenStreetMap service');
    }
  }

  // Expõe a configuração visual ativa do serviço.
  getConfig(): OSMConfig {
    if (!this.isInitialized) {
      throw new Error('OpenStreetMap service is not initialized');
    }
    return { ...this.config };
  }

  // Permite ajustar a configuração sem recriar a instância.
  updateConfig(updates: Partial<OSMConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Converte endereço em coordenadas usando o Nominatim.
  async geocode(address: string): Promise<NominatimResult[]> {
    if (!this.isInitialized) {
      throw new Error('OpenStreetMap service is not initialized');
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=5&addressdetails=1`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'FitLoot App/1.0'
        }
      });
      
      if (!response.ok) {
        throw new Error('Geocoding request failed');
      }

      const data = await response.json();
      return data || [];
    } catch (error) {
      console.error('Geocoding failed:', error);
      throw new Error('Failed to geocode address');
    }
  }

  // Converte coordenadas em endereço usando o Nominatim.
  async reverseGeocode(longitude: number, latitude: number): Promise<NominatimResult[]> {
    if (!this.isInitialized) {
      throw new Error('OpenStreetMap service is not initialized');
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'FitLoot App/1.0'
        }
      });
      
      if (!response.ok) {
        throw new Error('Reverse geocoding request failed');
      }

      const data = await response.json();
      return data ? [data] : [];
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
      throw new Error('Failed to reverse geocode coordinates');
    }
  }

  // Busca rota real e cai para linha reta apenas quando o provedor falha.
  async getDirections(
    start: [number, number],
    end: [number, number],
    profile: 'foot-walking' | 'cycling-regular' | 'driving-car' = 'foot-walking'
  ): Promise<{
    distance: number;
    duration: number;
    geometry: [number, number][];
  }> {
    if (!this.isInitialized) {
      throw new Error('OpenStreetMap service is not initialized');
    }

    try {
      if (OPENROUTESERVICE_CONFIG.API_KEY) {
        const url = `${OPENROUTESERVICE_CONFIG.BASE_URL}/directions/${profile}?` +
          `api_key=${OPENROUTESERVICE_CONFIG.API_KEY}&` +
          `start=${start[0]},${start[1]}&` +
          `end=${end[0]},${end[1]}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error('OpenRouteService request failed');
        }

        const data = await response.json();
        
        if (!data.features || data.features.length === 0) {
          throw new Error('No route found');
        }

        const route = data.features[0];
        const geometry = route.geometry.coordinates as [number, number][];
        
        return {
          distance: route.properties.segments[0].distance,
          duration: route.properties.segments[0].duration,
          geometry,
        };
      }
      
      console.warn('Using fallback straight-line route. Get OpenRouteService API key for real directions.');
      
      const distance = this.calculateDistance(start, end);
      const duration = distance / (profile === 'foot-walking' ? 1.4 : profile === 'cycling-regular' ? 4.2 : 8.3);
      
      const geometry = [start, end];
      
      return {
        distance,
        duration,
        geometry,
      };
    } catch (error) {
      console.error('Directions failed:', error);
      throw new Error('Failed to get directions');
    }
  }

  // Reaproveita o geocoding e filtra os resultados por distância.
  async searchNearby(
    center: [number, number],
    query: string,
    radius: number = 1000 // meters
  ): Promise<NominatimResult[]> {
    if (!this.isInitialized) {
      throw new Error('OpenStreetMap service is not initialized');
    }

    try {
      const nominatimResults = await this.geocode(query);
      
      const nearbyResults = nominatimResults.filter(result => {
        const resultCoords: [number, number] = [parseFloat(result.lon), parseFloat(result.lat)];
        const distance = this.calculateDistance(center, resultCoords);
        return distance <= radius;
      });

      return nearbyResults;
    } catch (error) {
      console.error('Nearby search failed:', error);
      throw new Error('Failed to search nearby places');
    }
  }

  // Gera uma imagem estática para previews e fallbacks.
  async getStaticImage(
    center: [number, number],
    zoom: number,
    width: number = 600,
    height: number = 400,
    markers?: OSMMarker[]
  ): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('OpenStreetMap service is not initialized');
    }

    try {
      let staticMapUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${center[1]},${center[0]}&zoom=${zoom}&size=${width}x${height}&maptype=mapnik`;
      
      if (markers && markers.length > 0) {
        const markerParams = markers.map(marker => 
          `${marker.latitude},${marker.longitude},${marker.color || 'red'}`
        ).join('|');
        staticMapUrl += `&markers=${markerParams}`;
      }

      return staticMapUrl;
    } catch (error) {
      console.error('Failed to generate static map image:', error);
      throw new Error('Failed to generate static map image');
    }
  }

  // Expõe a URL de tiles usada na camada visual.
  getTileUrl(): string {
    return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  }

  // Garante que coordenadas inválidas não avancem no fluxo.
  validateCoordinates(longitude: number, latitude: number): boolean {
    return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
  }

  // Calcula distância em metros pela fórmula de Haversine.
  calculateDistance(
    point1: [number, number],
    point2: [number, number]
  ): number {
    const earthRadiusMeters = 6371e3;
    const phi1 = (point1[1] * Math.PI) / 180;
    const phi2 = (point2[1] * Math.PI) / 180;
    const deltaPhi = ((point2[1] - point1[1]) * Math.PI) / 180;
    const deltaLambda = ((point2[0] - point1[0]) * Math.PI) / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMeters * c;
  }

  // Busca pontos de interesse diretamente no Overpass.
  async searchPOI(
    center: [number, number],
    tags: Record<string, string>,
    radius: number = 1000
  ): Promise<Array<{
    id: string;
    lat: number;
    lon: number;
    tags: Record<string, string>;
  }>> {
    if (!this.isInitialized) {
      throw new Error('OpenStreetMap service is not initialized');
    }

    try {
      const tagQuery = Object.entries(tags)
        .map(([key, value]) => `"${key}"="${value}"`)
        .join(' and ');
      
      const query = `
        [out:json];
        (
          node[${tagQuery}](around:${radius},${center[1]},${center[0]});
          way[${tagQuery}](around:${radius},${center[1]},${center[0]});
          relation[${tagQuery}](around:${radius},${center[1]},${center[0]});
        );
        out geom;
      `;

      const url = 'https://overpass-api.de/api/interpreter';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'FitLoot App/1.0'
        },
        body: `data=${encodeURIComponent(query)}`
      });

      if (!response.ok) {
        throw new Error('POI search failed');
      }

      const data = await response.json();
      return data.elements || [];
    } catch (error) {
      console.error('POI search failed:', error);
      throw new Error('Failed to search for points of interest');
    }
  }

  // Expõe o estado atual dos provedores usados pelo serviço.
  getStatus(): {
    initialized: boolean;
    tileServer: string;
    nominatimServer: string;
  } {
    return {
      initialized: this.isInitialized,
      tileServer: 'https://tile.openstreetmap.org',
      nominatimServer: 'https://nominatim.openstreetmap.org',
    };
  }
}

export const openStreetMapService = new OpenStreetMapService();
export default openStreetMapService;
