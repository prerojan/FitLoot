import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerMapRoutes } from "../../worker/routes/maps";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import { createExecutionContext, createTestEnv } from "./testUtils";

describe("map routes", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns public map config with tile template and attribution", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db, {
      MAP_TILE_URL_TEMPLATE: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      MAP_TILE_ATTRIBUTION: "&copy; Test attribution",
    });
    const app = new Hono<AppContext>();
    registerMapRoutes(app);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/maps/config"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      center: [-46.6333, -23.5505],
      zoom: 12,
      tileUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; Test attribution",
    });
  });

  it("normalizes nominatim search results", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([
        {
          place_id: 123,
          lat: "-23.5505",
          lon: "-46.6333",
          display_name: "Sao Paulo, Brasil",
          address: {
            city: "Sao Paulo",
            state: "Sao Paulo",
            country: "Brasil",
          },
          boundingbox: ["-23.7", "-23.4", "-46.8", "-46.3"],
        },
      ]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const app = new Hono<AppContext>();
    registerMapRoutes(app);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/maps/geocode?q=sao%20paulo"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        place_id: 123,
        display_name: "Sao Paulo, Brasil",
        latitude: -23.5505,
        longitude: -46.6333,
        address: {
          city: "Sao Paulo",
          state: "Sao Paulo",
          country: "Brasil",
        },
        boundingbox: [-23.7, -23.4, -46.8, -46.3],
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to straight-line directions when ORS is not configured", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db, {
      OPENROUTESERVICE_API_KEY: undefined,
    });
    const app = new Hono<AppContext>();
    registerMapRoutes(app);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/maps/directions?start=-46.6333,-23.5505&end=-46.62,-23.56&profile=foot-walking"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: "fallback",
      used_fallback_route: true,
      geometry: [
        [-46.6333, -23.5505],
        [-46.62, -23.56],
      ],
    });
  });

  it("uses openrouteservice when the provider returns a valid geojson route", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        features: [
          {
            geometry: {
              coordinates: [
                [-46.6333, -23.5505],
                [-46.628, -23.555],
                [-46.62, -23.56],
              ],
            },
            properties: {
              segments: [
                {
                  distance: 1980,
                  duration: 1320,
                },
              ],
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { db } = createMockD1Database([]);
    const env = createTestEnv(db, {
      OPENROUTESERVICE_API_KEY: "ors-test-key",
      OPENROUTESERVICE_BASE_URL: "https://api.openrouteservice.org/v2",
    });
    const app = new Hono<AppContext>();
    registerMapRoutes(app);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/maps/directions?start=-46.6333,-23.5505&end=-46.62,-23.56"),
      env,
      executionCtx,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: "openrouteservice",
      used_fallback_route: false,
      distance: 1980,
      duration: 1320,
      geometry: [
        [-46.6333, -23.5505],
        [-46.628, -23.555],
        [-46.62, -23.56],
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
