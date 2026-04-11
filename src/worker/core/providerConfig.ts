import type { Env } from "./types";
import {
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_MAP_TILE_ATTRIBUTION,
  DEFAULT_MAP_TILE_URL_TEMPLATE,
  DEFAULT_OPENROUTER_CHAT_MODEL,
  DEFAULT_OPENROUTESERVICE_BASE_URL,
  DEFAULT_OPENROUTER_VISION_MODEL,
} from "./constants";

export function getOpenRouterApiKey(env: Pick<Env, "OPENROUTER_API_KEY">): string | null {
  const configured = typeof env.OPENROUTER_API_KEY === "string" ? env.OPENROUTER_API_KEY.trim() : "";
  return configured.length > 0 ? configured : null;
}

export function getOpenRouterChatModel(
  env: Pick<Env, "OPENROUTER_CHAT_MODEL">,
): string {
  const configured = typeof env.OPENROUTER_CHAT_MODEL === "string"
    ? env.OPENROUTER_CHAT_MODEL.trim()
    : "";
  return configured.length > 0 ? configured : DEFAULT_OPENROUTER_CHAT_MODEL;
}

export function getOpenRouterVisionModel(env: Pick<Env, "OPENROUTER_VISION_MODEL">): string {
  const configured = typeof env.OPENROUTER_VISION_MODEL === "string"
    ? env.OPENROUTER_VISION_MODEL.trim()
    : "";
  return configured.length > 0 ? configured : DEFAULT_OPENROUTER_VISION_MODEL;
}

export function getOpenRouterHttpReferer(
  env: Pick<Env, "OPENROUTER_HTTP_REFERER" | "FRONTEND_ORIGIN">,
): string | null {
  const direct = typeof env.OPENROUTER_HTTP_REFERER === "string"
    ? env.OPENROUTER_HTTP_REFERER.trim()
    : "";
  if (direct.length > 0) return direct;

  const fallback = typeof env.FRONTEND_ORIGIN === "string" ? env.FRONTEND_ORIGIN.trim() : "";
  return fallback.length > 0 ? fallback : null;
}

export function getOpenRouterAppTitle(env: Pick<Env, "OPENROUTER_APP_TITLE">): string {
  const configured = typeof env.OPENROUTER_APP_TITLE === "string" ? env.OPENROUTER_APP_TITLE.trim() : "";
  return configured.length > 0 ? configured : "FitLoot";
}

export function getOpenRouteServiceApiKey(
  env: Pick<Env, "OPENROUTESERVICE_API_KEY">,
): string | null {
  const configured = typeof env.OPENROUTESERVICE_API_KEY === "string"
    ? env.OPENROUTESERVICE_API_KEY.trim()
    : "";
  return configured.length > 0 ? configured : null;
}

export function getOpenRouteServiceBaseUrl(
  env: Pick<Env, "OPENROUTESERVICE_BASE_URL">,
): string {
  const configured = typeof env.OPENROUTESERVICE_BASE_URL === "string"
    ? env.OPENROUTESERVICE_BASE_URL.trim()
    : "";
  return configured.length > 0 ? configured : DEFAULT_OPENROUTESERVICE_BASE_URL;
}

export function getMapTileUrlTemplate(
  env: Pick<Env, "MAP_TILE_URL_TEMPLATE">,
): string {
  const configured = typeof env.MAP_TILE_URL_TEMPLATE === "string"
    ? env.MAP_TILE_URL_TEMPLATE.trim()
    : "";
  return configured.length > 0 ? configured : DEFAULT_MAP_TILE_URL_TEMPLATE;
}

export function getMapTileAttribution(
  env: Pick<Env, "MAP_TILE_ATTRIBUTION">,
): string {
  const configured = typeof env.MAP_TILE_ATTRIBUTION === "string"
    ? env.MAP_TILE_ATTRIBUTION.trim()
    : "";
  return configured.length > 0 ? configured : DEFAULT_MAP_TILE_ATTRIBUTION;
}

export function getAnthropicApiKey(env: Pick<Env, "ANTHROPIC_API_KEY">): string | null {
  const configured = typeof env.ANTHROPIC_API_KEY === "string" ? env.ANTHROPIC_API_KEY.trim() : "";
  return configured.length > 0 ? configured : null;
}

export function getAnthropicChatModel(env: Pick<Env, "ANTHROPIC_CHAT_MODEL">): string {
  const configured = typeof env.ANTHROPIC_CHAT_MODEL === "string" ? env.ANTHROPIC_CHAT_MODEL.trim() : "";
  return configured.length > 0 ? configured : DEFAULT_ANTHROPIC_CHAT_MODEL;
}
