import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openStreetMapServiceMock } = vi.hoisted(() => ({
  openStreetMapServiceMock: {
    initialize: vi.fn(),
    geocode: vi.fn(),
    reverseGeocode: vi.fn(),
    getDirections: vi.fn(),
    searchNearby: vi.fn(),
    getStaticImage: vi.fn(),
    calculateDistance: vi.fn(),
    getConfig: vi.fn(),
    getTileUrl: vi.fn(),
  },
}));

vi.mock("../../react-app/services/openStreetMapService", () => ({
  openStreetMapService: openStreetMapServiceMock,
}));

import useMapService from "../../react-app/hooks/useMapService";

describe("useMapService", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    openStreetMapServiceMock.initialize.mockResolvedValue(undefined);
    openStreetMapServiceMock.geocode.mockResolvedValue([
      {
        place_id: 1,
        display_name: "Parque Ibirapuera, Sao Paulo",
        lon: "-46.6576",
        lat: "-23.5874",
        address: {
          road: "Avenida Pedro Alvares Cabral",
          city: "Sao Paulo",
          state: "SP",
          country: "Brasil",
        },
      },
    ]);
    openStreetMapServiceMock.getDirections.mockResolvedValue({
      distance: 3000,
      duration: 1800,
      geometry: [[-46.63, -23.55], [-46.65, -23.58]],
    });
    openStreetMapServiceMock.searchNearby.mockResolvedValue([]);
    openStreetMapServiceMock.getStaticImage.mockResolvedValue("https://maps.example/static");
    openStreetMapServiceMock.calculateDistance.mockReturnValue(3000);
    openStreetMapServiceMock.getConfig.mockReturnValue({
      center: [-46.6333, -23.5505],
      zoom: 12,
      maxZoom: 19,
      minZoom: 1,
      tileSize: 256,
      attribution: "OSM",
    });
    openStreetMapServiceMock.getTileUrl.mockReturnValue("https://tile.openstreetmap.org/{z}/{x}/{y}.png");

    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) => {
          success({
            coords: {
              latitude: -23.5505,
              longitude: -46.6333,
            },
          } as GeolocationPosition);
        }),
      },
    });
  });

  it("initializes the service, resolves geolocation, and formats search results", async () => {
    const { result } = renderHook(() => useMapService());

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });

    expect(result.current.userLocation).toEqual([-46.6333, -23.5505]);

    let searchResults: Awaited<ReturnType<typeof result.current.searchLocation>> = [];
    await act(async () => {
      searchResults = await result.current.searchLocation("ibirapuera");
    });

    expect(openStreetMapServiceMock.initialize).toHaveBeenCalledTimes(1);
    expect(openStreetMapServiceMock.geocode).toHaveBeenCalledWith("ibirapuera");
    expect(searchResults).toEqual([
      {
        id: "1",
        placeName: "Parque Ibirapuera, Sao Paulo",
        coordinates: [-46.6576, -23.5874],
        address: "Avenida Pedro Alvares Cabral, Sao Paulo, SP, Brasil",
      },
    ]);
  });
});
