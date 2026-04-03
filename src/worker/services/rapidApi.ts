import type { Env } from "../core/types";

export type RapidApiKeyEnv = Pick<Env, "RAPID_API_KEY">;

export function resolveRapidApiKey(env: RapidApiKeyEnv): string | null {
  const apiKey =
    typeof env.RAPID_API_KEY === "string" ? env.RAPID_API_KEY.trim() : "";
  return apiKey.length > 0 ? apiKey : null;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutErrorMessage = "rapidapi-timeout",
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(timeoutErrorMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function rapidRequestJson<T>(
  url: string,
  host: string,
  env: RapidApiKeyEnv,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const apiKey = resolveRapidApiKey(env);
  if (!apiKey) {
    throw new Error("rapidapi-key-missing");
  }

  const headers = new Headers(init.headers);
  headers.set("X-RapidAPI-Key", apiKey);
  headers.set("X-RapidAPI-Host", host);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const response = await fetchWithTimeout(
    url,
    {
      ...init,
      headers,
    },
    timeoutMs,
  );

  if (!response.ok) {
    const reason = await response.text().catch(() => "");
    const trimmedReason = reason.trim();
    throw new Error(
      trimmedReason.length > 0
        ? `rapidapi-request-failed:${host}:${response.status}:${trimmedReason}`
        : `rapidapi-request-failed:${host}:${response.status}`,
    );
  }

  return (await response.json()) as T;
}
