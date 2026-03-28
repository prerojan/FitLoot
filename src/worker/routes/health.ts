import { Hono, type MiddlewareHandler } from "hono";

import { hasCoreSchema } from "../core/database";
import {
  getHuggingFaceApiKey,
  getHuggingFaceVisionModel,
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
      hasHuggingFace: Boolean(getHuggingFaceApiKey(c.env)),
      hasOpenAI: false,
      hasUSDA: Boolean(c.env.USDA_API_KEY),
      hasRapidAPI: Boolean(c.env.RAPID_API_KEY),
      hasVision: false,
      hasDB: Boolean(c.env.fitloot_db),
      hasCoreSchema: schemaReady,
      environment,
    });
  });

  app.get("/api/health/external", authMiddleware, async (c) => {
    return c.json({
      huggingface: Boolean(getHuggingFaceApiKey(c.env)),
      openai: false,
      usda: Boolean(c.env.USDA_API_KEY),
      rapidapi: Boolean(c.env.RAPID_API_KEY),
      google_vision: false,
      huggingface_vision: Boolean(getHuggingFaceApiKey(c.env)),
      anthropic: Boolean(c.env.ANTHROPIC_API_KEY),
    });
  });

  app.get("/api/health/openai", authMiddleware, async (c) =>
    c.json({ ok: false, deprecated: true }),
  );
  app.get("/api/health/huggingface", authMiddleware, async (c) =>
    c.json({ ok: Boolean(getHuggingFaceApiKey(c.env)) }),
  );
  app.get("/api/health/usda", authMiddleware, async (c) =>
    c.json({ ok: Boolean(c.env.USDA_API_KEY) }),
  );
  app.get("/api/health/rapidapi", authMiddleware, async (c) =>
    c.json({ ok: Boolean(c.env.RAPID_API_KEY) }),
  );
  app.get("/api/health/vision", authMiddleware, async (c) =>
    c.json({
      ok: Boolean(getHuggingFaceApiKey(c.env)),
      provider: "huggingface_router",
      model: getHuggingFaceVisionModel(c.env),
    }),
  );
}
