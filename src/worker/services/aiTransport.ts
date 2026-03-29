import { safeGet } from "../../utils/typeHelpers";
import { HUGGING_FACE_CHAT_MODEL } from "../core/constants";
import { getErrorMessage } from "../core/errors";
import {
  getAnthropicApiKey,
  getAnthropicChatModel,
  getHuggingFaceApiKey,
} from "../core/providerConfig";
import type { AppContext } from "../core/types";

export type ApiErrorCode =
  | "SERVICE_NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE"
  | "RATE_LIMITED";

export class ApiIntegrationError extends Error {
  code: ApiErrorCode;
  status: number;
  details?: string | undefined;

  constructor(code: ApiErrorCode, status: number, message: string, details?: string | undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_CALLS = 20;
const RATE_LIMIT_MAX_KEYS = 2_000;
export const timeoutMsByService = {
  huggingface: 12000,
  anthropic: 12000,
  usda: 8000,
  rapidapi: 8000,
} as const;

const requestRateMap = new Map<string, number[]>();
let rateMapLastCleanupAt = 0;

function cleanupRateLimitMap(now: number): void {
  if (now - rateMapLastCleanupAt < RATE_LIMIT_WINDOW_MS) return;

  for (const [mapKey, hits] of requestRateMap.entries()) {
    const validHits = hits.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
    if (validHits.length === 0) {
      requestRateMap.delete(mapKey);
    } else if (validHits.length !== hits.length) {
      requestRateMap.set(mapKey, validHits);
    }
  }

  if (requestRateMap.size > RATE_LIMIT_MAX_KEYS) {
    const overflow = requestRateMap.size - RATE_LIMIT_MAX_KEYS;
    const iterator = requestRateMap.keys();
    for (let index = 0; index < overflow; index += 1) {
      const keyToDelete = iterator.next().value;
      if (typeof keyToDelete === "string") {
        requestRateMap.delete(keyToDelete);
      }
    }
  }

  rateMapLastCleanupAt = now;
}

export function enforceRateLimit(key: string) {
  const now = Date.now();
  cleanupRateLimitMap(now);
  const hits = requestRateMap.get(key) ?? [];
  const validHits = hits.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (validHits.length >= RATE_LIMIT_MAX_CALLS) {
    throw new ApiIntegrationError("RATE_LIMITED", 429, "Muitas requisições externas. Tente novamente em instantes.");
  }
  validHits.push(now);
  requestRateMap.set(key, validHits);
}

export function toFriendlyErrorResponse(error: unknown) {
  if (error instanceof ApiIntegrationError) {
    return {
      status: error.status,
      payload: {
        error: error.message,
        code: error.code,
      },
    };
  }
  return {
    status: 500,
    payload: {
      error: "Serviço temporariamente indisponível. Tente novamente em alguns instantes.",
      code: "UPSTREAM_ERROR" satisfies ApiErrorCode,
    },
  };
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const responseText = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new ApiIntegrationError(
        "AUTH_FAILED",
        502,
        "Falha de autenticação com serviço externo.",
        responseText.slice(0, 500),
      );
    }
    if (response.status === 429) {
      throw new ApiIntegrationError(
        "RATE_LIMITED",
        429,
        "Servi\u00e7o externo em limite tempor\u00e1rio. Tente novamente em instantes.",
        responseText.slice(0, 500),
      );
    }
    if (!response.ok) {
      throw new ApiIntegrationError(
        "UPSTREAM_ERROR",
        502,
        "Falha ao consultar serviço externo.",
        responseText.slice(0, 500),
      );
    }
    try {
      return JSON.parse(responseText) as T;
    } catch {
      throw new ApiIntegrationError(
        "INVALID_RESPONSE",
        502,
        "Servi\u00e7o externo retornou resposta inv\u00e1lida.",
        responseText.slice(0, 500),
      );
    }
  } catch (error) {
    if (error instanceof ApiIntegrationError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new ApiIntegrationError("TIMEOUT", 504, "Tempo de resposta excedido em serviço externo.");
    }
    throw new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar serviço externo.");
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRetryHuggingFaceError(error: unknown): boolean {
  return error instanceof ApiIntegrationError
    && (
      error.code === "RATE_LIMITED"
      || error.code === "TIMEOUT"
      || error.code === "UPSTREAM_ERROR"
      || error.code === "INVALID_RESPONSE"
    );
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function buildJsonOnlyRouterMessages(messages: Array<{ role: string; content: string }>) {
  const reminder = "Responda somente JSON valido, sem markdown, sem comentarios e sem texto extra.";
  if (messages[0]?.role === "system") {
    return [
      { ...messages[0], content: `${messages[0].content}\n\n${reminder}` },
      ...messages.slice(1),
    ];
  }
  return [{ role: "system", content: reminder }, ...messages];
}

export async function requestHuggingFaceStructuredContent(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  logLabel: string,
  timeoutMs: number,
): Promise<string> {
  const attempts = [
    { responseFormat: true, requestMessages: messages, label: `${logLabel}:json-mode` },
    {
      responseFormat: false,
      requestMessages: buildJsonOnlyRouterMessages(messages),
      label: `${logLabel}:json-retry`,
    },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const completion = await fetchJsonWithTimeout<OpenAIChatCompletionResponse>(
        "https://router.huggingface.co/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: HUGGING_FACE_CHAT_MODEL,
            messages: attempt.requestMessages,
            max_tokens: maxTokens,
            ...(attempt.responseFormat ? { response_format: { type: "json_object" } } : {}),
          }),
        },
        timeoutMs,
      );
      const rawContent = safeGet(completion.choices ?? [], 0)?.message?.content ?? "";
      if (rawContent.trim().length > 0) {
        return rawContent;
      }
      lastError = new ApiIntegrationError(
        "INVALID_RESPONSE",
        502,
        "Servi\u00e7o externo retornou conte\u00fado vazio.",
      );
    } catch (error) {
      lastError = error;
      console.warn(`[${attempt.label}]`, {
        message: getErrorMessage(error),
        details: error instanceof ApiIntegrationError ? error.details : undefined,
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar serviço externo.");
}

async function requestHuggingFaceChatCompletion(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  timeoutMs: number,
): Promise<OpenAIChatCompletionResponse> {
  const attempts = [
    { maxTokens, label: "chat-primary" },
    { maxTokens: Math.min(maxTokens, 700), label: "chat-retry" },
  ];

  let lastError: unknown = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      const completion = await fetchJsonWithTimeout<OpenAIChatCompletionResponse>(
        "https://router.huggingface.co/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: HUGGING_FACE_CHAT_MODEL,
            messages,
            max_tokens: attempt.maxTokens,
          }),
        },
        timeoutMs,
      );
      const rawContent = safeGet(completion.choices ?? [], 0)?.message?.content ?? "";
      if (rawContent.trim().length > 0) {
        return completion;
      }
      lastError = new ApiIntegrationError("INVALID_RESPONSE", 502, "Servi\u00e7o externo retornou conte\u00fado vazio.");
    } catch (error) {
      lastError = error;
      console.warn(`[huggingface:${attempt.label}]`, {
        message: getErrorMessage(error),
        details: error instanceof ApiIntegrationError ? error.details : undefined,
      });
      if (!shouldRetryHuggingFaceError(error) || index === attempts.length - 1) {
        break;
      }
      await waitForRetry(450 * (index + 1));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar serviço externo.");
}

export async function requestHuggingFaceVisionStructuredContent(
  apiKey: string,
  model: string,
  prompt: string,
  imageDataUrl: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const completion = await fetchJsonWithTimeout<OpenAIChatCompletionResponse>(
    "https://router.huggingface.co/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${prompt}\nResponda somente JSON valido, sem markdown e sem texto extra.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
    },
    timeoutMs,
  );

  const rawContent = safeGet(completion.choices ?? [], 0)?.message?.content ?? "";
  if (rawContent.trim().length === 0) {
    throw new ApiIntegrationError("INVALID_RESPONSE", 502, "Servi\u00e7o externo retornou conte\u00fado vazio.");
  }

  return rawContent;
}

type AnthropicMessageContentBlock = {
  type?: string | undefined;
  text?: string | undefined;
};

type AnthropicMessagesResponse = {
  content?: AnthropicMessageContentBlock[] | undefined;
};

function extractAnthropicTextContent(response: AnthropicMessagesResponse): string {
  return (Array.isArray(response.content) ? response.content : [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function buildAnthropicMessages(
  messages: Array<{ role: string; content: string }>,
  jsonMode: boolean,
): {
  system?: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const normalizedMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const message of messages) {
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (content.length === 0) continue;

    if (message.role === "system") {
      systemParts.push(content);
      continue;
    }

    normalizedMessages.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content,
    });
  }

  if (jsonMode) {
    systemParts.push("Responda somente JSON valido, sem markdown, sem comentarios e sem texto extra.");
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: normalizedMessages,
  };
}

async function requestAnthropicCompletion(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  timeoutMs: number,
  jsonMode: boolean,
): Promise<OpenAIChatCompletionResponse> {
  const attempts = [
    { maxTokens, label: "anthropic-primary" },
    { maxTokens: Math.min(maxTokens, 700), label: "anthropic-retry" },
  ];

  let lastError: unknown = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      const payload = buildAnthropicMessages(messages, jsonMode);
      const completion = await fetchJsonWithTimeout<AnthropicMessagesResponse>(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: attempt.maxTokens,
            ...(payload.system ? { system: payload.system } : {}),
            messages: payload.messages,
          }),
        },
        timeoutMs,
      );
      const rawContent = extractAnthropicTextContent(completion);
      if (rawContent.trim().length > 0) {
        return {
          choices: [{ message: { content: rawContent } }],
        };
      }
      lastError = new ApiIntegrationError("INVALID_RESPONSE", 502, "Servi\u00e7o externo retornou conte\u00fado vazio.");
    } catch (error) {
      lastError = error;
      console.warn(`[anthropic:${attempt.label}]`, {
        message: getErrorMessage(error),
        details: error instanceof ApiIntegrationError ? error.details : undefined,
      });
      if (!(error instanceof ApiIntegrationError) || index === attempts.length - 1) {
        break;
      }
      if (
        error.code !== "RATE_LIMITED" &&
        error.code !== "TIMEOUT" &&
        error.code !== "UPSTREAM_ERROR" &&
        error.code !== "INVALID_RESPONSE" &&
        error.code !== "AUTH_FAILED"
      ) {
        break;
      }
      await waitForRetry(450 * (index + 1));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar servi\u00e7o externo.");
}

export async function fetchResponseWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiIntegrationError("TIMEOUT", 504, "Tempo de resposta excedido em serviço externo.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callHuggingFaceChat(
  c: import("hono").Context<AppContext>,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1000,
  jsonMode = false
) {
  const apiKey = getHuggingFaceApiKey(c.env);
  if (!apiKey) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "Hugging Face não configurada.");
  }
  enforceRateLimit(`huggingface:${c.get("user")?.id ?? "anon"}`);
  if (jsonMode) {
    const content = await requestHuggingFaceStructuredContent(
      apiKey,
      messages,
      maxTokens,
      "callOpenAIChat",
      timeoutMsByService.huggingface,
    );
    const structuredResponse: OpenAIChatCompletionResponse = {
      choices: [{ message: { content } }],
    };
    return structuredResponse;
  }
  return requestHuggingFaceChatCompletion(
    apiKey,
    messages,
    maxTokens,
    timeoutMsByService.huggingface,
  );
}

function shouldFallbackToNextChatProvider(error: unknown): boolean {
  if (!(error instanceof ApiIntegrationError)) {
    return true;
  }

  return (
    error.code === "AUTH_FAILED" ||
    error.code === "RATE_LIMITED" ||
    error.code === "TIMEOUT" ||
    error.code === "UPSTREAM_ERROR" ||
    error.code === "INVALID_RESPONSE" ||
    error.code === "SERVICE_NOT_CONFIGURED"
  );
}

export async function callOpenAIChatWithFallback(
  c: import("hono").Context<AppContext>,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1000,
  jsonMode = false,
) {
  const providers: Array<{
    name: "huggingface" | "anthropic";
    execute: () => Promise<OpenAIChatCompletionResponse>;
  }> = [];

  const huggingFaceApiKey = getHuggingFaceApiKey(c.env);
  if (huggingFaceApiKey) {
    providers.push({
      name: "huggingface",
      execute: () => callHuggingFaceChat(c, messages, maxTokens, jsonMode),
    });
  }

  const anthropicApiKey = getAnthropicApiKey(c.env);
  if (anthropicApiKey) {
    providers.push({
      name: "anthropic",
      execute: () => requestAnthropicCompletion(
        anthropicApiKey,
        getAnthropicChatModel(c.env),
        messages,
        maxTokens,
        timeoutMsByService.anthropic,
        jsonMode,
      ),
    });
  }

  if (providers.length === 0) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "Nenhum provedor de IA configurado.");
  }

  const userId = c.get("user")?.id ?? "anon";
  let lastError: unknown = null;

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    try {
      if (provider.name === "anthropic") {
        enforceRateLimit(`anthropic:${userId}`);
      }
      return await provider.execute();
    } catch (error) {
      lastError = error;
      console.warn(`[callOpenAIChat:${provider.name}]`, {
        userId,
        message: getErrorMessage(error),
        details: error instanceof ApiIntegrationError ? error.details : undefined,
      });

      if (!shouldFallbackToNextChatProvider(error) || index === providers.length - 1) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiIntegrationError("UPSTREAM_ERROR", 502, "Falha ao consultar servi\u00e7o externo.");
}

export interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | undefined;
    };
  }>;
}
