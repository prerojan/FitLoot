import type { Env } from "./types";
import {
  DEFAULT_ANTHROPIC_CHAT_MODEL,
  DEFAULT_HUGGING_FACE_CHAT_MODEL,
  DEFAULT_HUGGING_FACE_VISION_MODEL,
} from "./constants";

export function getHuggingFaceApiKey(env: Pick<Env, "HF_TOKEN" | "HUGGING_FACE_API_KEY">): string | null {
  const direct = typeof env.HUGGING_FACE_API_KEY === "string" ? env.HUGGING_FACE_API_KEY.trim() : "";
  if (direct.length > 0) return direct;

  const legacy = typeof env.HF_TOKEN === "string" ? env.HF_TOKEN.trim() : "";
  return legacy.length > 0 ? legacy : null;
}

export function getHuggingFaceChatModel(
  env: Pick<Env, "HF_CHAT_MODEL" | "HUGGING_FACE_CHAT_MODEL">,
): string {
  const direct = typeof env.HUGGING_FACE_CHAT_MODEL === "string"
    ? env.HUGGING_FACE_CHAT_MODEL.trim()
    : "";
  if (direct.length > 0) return direct;

  const legacy = typeof env.HF_CHAT_MODEL === "string" ? env.HF_CHAT_MODEL.trim() : "";
  return legacy.length > 0 ? legacy : DEFAULT_HUGGING_FACE_CHAT_MODEL;
}

export function getHuggingFaceVisionModel(env: Pick<Env, "HUGGING_FACE_VISION_MODEL">): string {
  const configured = typeof env.HUGGING_FACE_VISION_MODEL === "string" ? env.HUGGING_FACE_VISION_MODEL.trim() : "";
  return configured.length > 0 ? configured : DEFAULT_HUGGING_FACE_VISION_MODEL;
}

export function getAnthropicApiKey(env: Pick<Env, "ANTHROPIC_API_KEY">): string | null {
  const configured = typeof env.ANTHROPIC_API_KEY === "string" ? env.ANTHROPIC_API_KEY.trim() : "";
  return configured.length > 0 ? configured : null;
}

export function getAnthropicChatModel(env: Pick<Env, "ANTHROPIC_CHAT_MODEL">): string {
  const configured = typeof env.ANTHROPIC_CHAT_MODEL === "string" ? env.ANTHROPIC_CHAT_MODEL.trim() : "";
  return configured.length > 0 ? configured : DEFAULT_ANTHROPIC_CHAT_MODEL;
}
