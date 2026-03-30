/**
 * Hook unificado para mapa, geolocalizacao e rotas.
 * Mantem o OpenStreetMap como fonte principal para a camada visual.
 */

import { useState, useEffect, useCallback } from "react";
import { openStreetMapService, OSMConfig, OSMMarker } from "../services/openStreetMapService";
import type { NominatimResult } from "../services/openStreetMapService";

export interface MapState {
  center: [number, number];
  zoom: number;
  markers: OSMMarker[];
  isLoading: boolean;
  error: string | null;
}

export interface SearchResult {
  id: string;
  placeName: string;
  coordinates: [number, number];
  address: string;
}

export interface UseMapServiceOptions {
  defaultCenter?: [number, number];
  defaultZoom?: number;
  enableGeolocation?: boolean;
}

export const useMapService = (options: UseMapServiceOptions = {}) => {
  const {
    defaultCenter = [-46.6333, -23.5505], // Sao Paulo
    defaultZoom = 12,
    enableGeolocation = true,
  } = options;

  const [mapState, setMapState] = useState<MapState>({
    center: defaultCenter,
    zoom: defaultZoom,
    markers: [],
    isLoading: false,
    error: null,
  });

  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  // Resolve a localizacao atual usando a API nativa do navegador.
  const getCurrentLocation = useCallback(async (): Promise<[number, number] | null> => {
    if (!navigator.geolocation) {
      console.warn("Geolocalizacao nao suportada pelo navegador");
      return null;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000, // 5 minutes
          },
        );
      });

      const coordinates: [number, number] = [
        position.coords.longitude,
        position.coords.latitude,
      ];

      setUserLocation(coordinates);
      setMapState((prev) => ({ ...prev, center: coordinates }));
      return coordinates;
    } catch (err) {
      console.warn("Falha ao obter localizacao:", err);
      return null;
    }
  }, []);

  // Inicializa o servico e, quando permitido, tenta buscar a posicao atual.
  const initialize = useCallback(async (): Promise<void> => {
    try {
      setMapState((prev) => ({ ...prev, isLoading: true, error: null }));

      await openStreetMapService.initialize();
      setIsInitialized(true);

      if (enableGeolocation) {
        await getCurrentLocation();
      }

      setMapState((prev) => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Falha ao inicializar mapa";
      setMapState((prev) => ({ ...prev, isLoading: false, error: errorMessage }));
    }
  }, [enableGeolocation, getCurrentLocation]);

  // Consolida o endereco do Nominatim em uma string amigavel.
  const formatAddress = (address: NominatimResult["address"] | undefined): string => {
    if (!address) return "Endereco desconhecido";
    const parts: string[] = [];

    if (address.house_number && address.road) {
      parts.push(`${address.house_number} ${address.road}`);
    } else if (address.road) {
      parts.push(address.road);
    }

    if (address.suburb) parts.push(address.suburb);
    if (address.city) parts.push(address.city);
    if (address.state) parts.push(address.state);
    if (address.postcode) parts.push(address.postcode);
    if (address.country) parts.push(address.country);

    return parts.join(", ") || "Endereco desconhecido";
  };

  // Executa geocoding textual e adapta a resposta para o formato consumido pela UI.
  const searchLocation = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!isInitialized) {
      throw new Error("Servico de mapa nao inicializado");
    }

    try {
      setMapState((prev) => ({ ...prev, isLoading: true, error: null }));

      const results = await openStreetMapService.geocode(query);

      const searchResults: SearchResult[] = results.map((result) => ({
        id: result.place_id.toString(),
        placeName: result.display_name,
        coordinates: [parseFloat(result.lon), parseFloat(result.lat)],
        address: formatAddress(result.address),
      }));

      setMapState((prev) => ({ ...prev, isLoading: false }));
      return searchResults;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Falha na busca de localizacao";
      setMapState((prev) => ({ ...prev, isLoading: false, error: errorMessage }));
      return [];
    }
  }, [isInitialized]);

  // Converte coordenadas em um endereco legivel para exibicao.
  const reverseGeocode = useCallback(async (coordinates: [number, number]): Promise<string> => {
    if (!isInitialized) {
      throw new Error("Servico de mapa nao inicializado");
    }

    try {
      const results = await openStreetMapService.reverseGeocode(coordinates[0], coordinates[1]);

      if (results.length > 0) {
        return results[0]?.display_name || "Localizacao desconhecida";
      }

      return "Localizacao desconhecida";
    } catch (err) {
      console.warn("Falha no reverse geocoding:", err);
      return "Localizacao desconhecida";
    }
  }, [isInitialized]);

  // Mantem a colecao local de marcadores exibidos no mapa.
  const addMarker = useCallback((marker: OSMMarker): void => {
    setMapState((prev) => ({
      ...prev,
      markers: [...prev.markers, marker],
    }));
  }, []);

  const removeMarker = useCallback((markerId: string): void => {
    setMapState((prev) => ({
      ...prev,
      markers: prev.markers.filter((marker) => marker.id !== markerId),
    }));
  }, []);

  const clearMarkers = useCallback((): void => {
    setMapState((prev) => ({ ...prev, markers: [] }));
  }, []);

  // Atualiza o viewport sem recriar o restante do estado.
  const updateView = useCallback((center: [number, number], zoom?: number): void => {
    setMapState((prev) => ({
      ...prev,
      center,
      zoom: zoom !== undefined ? zoom : prev.zoom,
    }));
  }, []);

  // Busca rota entre dois pontos e normaliza a resposta para o app.
  const getDirections = useCallback(async (
    start: [number, number],
    end: [number, number],
    profile: "foot-walking" | "cycling-regular" | "driving-car" = "foot-walking",
  ): Promise<{
    distance: number;
    duration: number;
    coordinates: [number, number][];
  }> => {
    if (!isInitialized) {
      throw new Error("Servico de mapa nao inicializado");
    }

    try {
      const directions = await openStreetMapService.getDirections(start, end, profile);

      return {
        distance: directions.distance,
        duration: directions.duration,
        coordinates: directions.geometry || [],
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Falha ao obter direcoes";
      setMapState((prev) => ({ ...prev, error: errorMessage }));
      throw err;
    }
  }, [isInitialized]);

  // Filtra resultados proximos a um centro ja conhecido.
  const searchNearby = useCallback(async (
    center: [number, number],
    query: string,
    radius: number = 1000,
  ): Promise<SearchResult[]> => {
    if (!isInitialized) {
      throw new Error("Servico de mapa nao inicializado");
    }

    try {
      setMapState((prev) => ({ ...prev, isLoading: true, error: null }));

      const results = await openStreetMapService.searchNearby(center, query, radius);

      const searchResults: SearchResult[] = results.map((result) => ({
        id: result.place_id.toString(),
        placeName: result.display_name,
        coordinates: [parseFloat(result.lon), parseFloat(result.lat)],
        address: formatAddress(result.address),
      }));

      setMapState((prev) => ({ ...prev, isLoading: false }));
      return searchResults;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Falha na busca nearby";
      setMapState((prev) => ({ ...prev, isLoading: false, error: errorMessage }));
      return [];
    }
  }, [isInitialized]);

  // Gera uma URL estatica para previews e fallbacks visuais.
  const getStaticMapUrl = useCallback((
    center: [number, number],
    zoom: number,
    width: number = 600,
    height: number = 400,
    markers?: OSMMarker[],
  ): Promise<string> => {
    if (!isInitialized) {
      throw new Error("Servico de mapa nao inicializado");
    }

    return openStreetMapService.getStaticImage(center, zoom, width, height, markers);
  }, [isInitialized]);

  // Reexpoe o calculo de distancia para consumidores do hook.
  const calculateDistance = useCallback((
    point1: [number, number],
    point2: [number, number],
  ): number => {
    return openStreetMapService.calculateDistance(point1, point2);
  }, []);

  // Repassa a configuracao base do mapa para componentes visuais.
  const getMapConfig = useCallback((): OSMConfig => {
    if (!isInitialized) {
      throw new Error("Servico de mapa nao inicializado");
    }

    return openStreetMapService.getConfig();
  }, [isInitialized]);

  // Expoe a URL de tiles usada pela camada Leaflet.
  const getTileUrl = useCallback((): string => {
    return openStreetMapService.getTileUrl();
  }, []);

  // Inicializa o servico assim que o hook entra em uso.
  useEffect(() => {
    void initialize();
  }, [initialize]);

  return {
    // Estado exposto
    mapState,
    userLocation,
    isInitialized,

    // Acoes de mapa
    initialize,
    getCurrentLocation,
    searchLocation,
    reverseGeocode,
    addMarker,
    removeMarker,
    clearMarkers,
    updateView,
    getDirections,
    searchNearby,
    getStaticMapUrl,
    calculateDistance,

    // Configuracao visual
    getMapConfig,
    getTileUrl,

    // Derivados prontos para consumo
    hasUserLocation: !!userLocation,
    markerCount: mapState.markers.length,
  };
};

export default useMapService;
