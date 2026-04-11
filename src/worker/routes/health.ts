import { Hono, type MiddlewareHandler } from "hono";

import { hasCoreSchema } from "../core/database";
import {
  getMapTileUrlTemplate,
  getOpenRouterApiKey,
  getOpenRouterChatModel,
  getOpenRouteServiceApiKey,
  getOpenRouterVisionModel,
} from "../core/providerConfig";
import type { AppContext } from "../core/types";

type HealthRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
};

// Route registration for health and provider diagnostics.
export function registerHealthRoutes(
  app: Hono<AppContext>,
  { authMiddleware }: HealthRouteDeps,
): void {
  app.get("/health", async (c) => {
    const host = new URL(c.req.url).hostname;
    const schemaReady = await hasCoreSchema(c.env.fitloot_db);
    const environment =
      host === "localhost" || host === "127.0.0.1" ? "local" : "production";

    return c.json({
      ok: true,
      timestamp: new Date().toISOString(),
      hasOpenRouter: Boolean(getOpenRouterApiKey(c.env)),
      hasOpenRouteService: Boolean(getOpenRouteServiceApiKey(c.env)),
      openRouterChatModel: getOpenRouterChatModel(c.env),
      hasOpenAI: false,
      hasUSDA: Boolean(c.env.USDA_API_KEY),
      hasRapidAPI: Boolean(c.env.RAPID_API_KEY),
      hasVision: Boolean(getOpenRouterApiKey(c.env)),
      hasDB: Boolean(c.env.fitloot_db),
      hasCoreSchema: schemaReady,
      mapTileTemplate: getMapTileUrlTemplate(c.env),
      environment,
    });
  });

  app.get("/api/health/external", authMiddleware, async (c) => {
    return c.json({
      openrouter: Boolean(getOpenRouterApiKey(c.env)),
      openrouteservice: Boolean(getOpenRouteServiceApiKey(c.env)),
      openai: false,
      usda: Boolean(c.env.USDA_API_KEY),
      rapidapi: Boolean(c.env.RAPID_API_KEY),
      google_vision: false,
      openrouter_vision: Boolean(getOpenRouterApiKey(c.env)),
      openrouter_chat_model: getOpenRouterChatModel(c.env),
      anthropic: Boolean(c.env.ANTHROPIC_API_KEY),
    });
  });

  app.get("/api/health/openai", authMiddleware, async (c) =>
    c.json({ ok: false, deprecated: true }),
  );
  app.get("/api/health/openrouter", authMiddleware, async (c) =>
    c.json({ ok: Boolean(getOpenRouterApiKey(c.env)) }),
  );
  app.get("/api/health/usda", authMiddleware, async (c) =>
    c.json({ ok: Boolean(c.env.USDA_API_KEY) }),
  );
  app.get("/api/health/rapidapi", authMiddleware, async (c) =>
    c.json({ ok: Boolean(c.env.RAPID_API_KEY) }),
  );
  app.get("/api/health/vision", authMiddleware, async (c) =>
    c.json({
      ok: Boolean(getOpenRouterApiKey(c.env)),
      provider: "openrouter",
      model: getOpenRouterVisionModel(c.env),
    }),
  );
}
