import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerAiRoutes } from "../../worker/routes/ai";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import { createAuthMiddleware, createExecutionContext, createJsonRequest, createTestEnv } from "./testUtils";

class TestApiIntegrationError extends Error {
  code: "SERVICE_NOT_CONFIGURED" | "AUTH_FAILED" | "TIMEOUT" | "UPSTREAM_ERROR" | "INVALID_RESPONSE" | "RATE_LIMITED";
  status: number;
  details?: string | undefined;

  constructor(
    code: "SERVICE_NOT_CONFIGURED" | "AUTH_FAILED" | "TIMEOUT" | "UPSTREAM_ERROR" | "INVALID_RESPONSE" | "RATE_LIMITED",
    status: number,
    message: string,
    details?: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function createAiDeps(overrides: Record<string, unknown> = {}) {
  return {
    ApiIntegrationError: TestApiIntegrationError,
    authMiddleware: createAuthMiddleware(),
    callOpenAIChatWithFallback: vi.fn(async () => ({
      choices: [{ message: { content: "Resposta do provider" } }],
    })),
    ensureMissionJobSchema: vi.fn(async () => undefined),
    ensureUserCounterRow: vi.fn(async () => undefined),
    enforceRateLimit: vi.fn(() => undefined),
    fetchJsonWithTimeout: vi.fn(async () => ({})),
    generateAiMissionsForUser: vi.fn(async () => ({
      missions: [],
      fallback: false,
      error: null,
    })),
    logUserEvent: vi.fn(async () => undefined),
    maybeApplyTrainingPlanPreferenceFromChat: vi.fn(async () => null),
    normalizeConditioning: vi.fn((value: unknown) => String(value ?? "")),
    normalizeMatchText: vi.fn((value: string) => value.trim().toLowerCase()),
    normalizeTrainingFrequencyInput: vi.fn((value: unknown) => Number(value ?? 0)),
    normalizeTrainingPlanChatPreferences: vi.fn((value: unknown) => value),
    onChatMessage: vi.fn(async () => undefined),
    parseJsonObjectFromModelContent: vi.fn((content: string) => {
      try {
        return JSON.parse(content) as Record<string, unknown>;
      } catch {
        return null;
      }
    }),
    parseStoredPlanRecord: vi.fn(() => null),
    requestHuggingFaceVisionStructuredContent: vi.fn(async () => "{}"),
    summarizeTrainingPlanChatPreferences: vi.fn((value: unknown) => (value ? "ajuste salvo" : "")),
    timeoutMsByService: {
      huggingface: 10_000,
      anthropic: 10_000,
      usda: 10_000,
      rapidapi: 10_000,
    },
    toFriendlyErrorResponse: vi.fn((error: unknown) => ({
      status: error instanceof TestApiIntegrationError ? error.status : 500,
      payload: {
        error: error instanceof Error ? error.message : "Erro desconhecido",
      },
    })),
    unlockAchievementIfNeeded: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ai routes", () => {
  it("retries the chat request with the compact prompt after an upstream failure", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT chat_messages, repeated_message_streak, last_chat_message FROM user_event_counters",
        first: {
          chat_messages: 2,
          repeated_message_streak: 0,
          last_chat_message: null,
        },
      },
      {
        match: "UPDATE user_event_counters SET",
        run: { success: true, meta: {} },
      },
      {
        match: "SELECT * FROM user_profiles WHERE user_id = ?",
        first: {
          full_name: "Ana",
          main_goal: "ganhar_massa",
          initial_conditioning: "iniciante",
          equipment: "halteres",
          injuries: "",
        },
      },
      {
        match: "SELECT * FROM user_progression WHERE user_id = ?",
        first: {
          level: 4,
          xp: 120,
          current_streak: 3,
        },
      },
      {
        match: "SELECT * FROM user_attributes WHERE user_id = ?",
        first: {
          strength: 12,
        },
      },
      {
        match: "SELECT weekly_plan_json, training_frequency FROM user_training_plans WHERE user_id = ?",
        first: {
          weekly_plan_json: null,
          training_frequency: 3,
        },
      },
    ]);
    const env = createTestEnv(db);
    const callOpenAIChatWithFallback = vi
      .fn()
      .mockRejectedValueOnce(new TestApiIntegrationError("UPSTREAM_ERROR", 502, "Falha upstream"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Resposta fallback" } }],
      });
    const deps = createAiDeps({
      callOpenAIChatWithFallback,
    });
    const app = new Hono<AppContext>();
    registerAiRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/ai/chat", {
        method: "POST",
        body: {
          message: "Me ajuda com meu treino",
          history: [],
          mode: "suporte",
          session_count: 3,
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ message: "Resposta fallback" });
    expect(callOpenAIChatWithFallback).toHaveBeenCalledTimes(2);
  });

  it("returns a degraded chat response instead of 502 when providers are temporarily unavailable", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT chat_messages, repeated_message_streak, last_chat_message FROM user_event_counters",
        first: {
          chat_messages: 2,
          repeated_message_streak: 0,
          last_chat_message: null,
        },
      },
      {
        match: "UPDATE user_event_counters SET",
        run: { success: true, meta: {} },
      },
      {
        match: "SELECT * FROM user_profiles WHERE user_id = ?",
        first: {
          full_name: "Ana",
          main_goal: "ganhar_massa",
          initial_conditioning: "iniciante",
          equipment: "halteres",
          injuries: "",
        },
      },
      {
        match: "SELECT * FROM user_progression WHERE user_id = ?",
        first: {
          level: 4,
          xp: 120,
          current_streak: 3,
        },
      },
      {
        match: "SELECT * FROM user_attributes WHERE user_id = ?",
        first: {
          strength: 12,
        },
      },
      {
        match: "SELECT weekly_plan_json, training_frequency FROM user_training_plans WHERE user_id = ?",
        first: {
          weekly_plan_json: null,
          training_frequency: 3,
        },
      },
    ]);
    const env = createTestEnv(db);
    const callOpenAIChatWithFallback = vi
      .fn()
      .mockRejectedValueOnce(new TestApiIntegrationError("UPSTREAM_ERROR", 502, "Falha upstream"))
      .mockRejectedValueOnce(new TestApiIntegrationError("UPSTREAM_ERROR", 502, "Falha upstream"));
    const logUserEvent = vi.fn(async () => undefined);
    const deps = createAiDeps({
      callOpenAIChatWithFallback,
      logUserEvent,
    });
    const app = new Hono<AppContext>();
    registerAiRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/ai/chat", {
        method: "POST",
        body: {
          message: "Me ajuda com meu treino",
          history: [],
          mode: "suporte",
          session_count: 3,
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(typeof payload.message).toBe("string");
    expect(payload.message).toContain("instabilidade temporaria no servico de IA externo");
    expect(payload.message).toContain("modo de contingencia");
    expect(callOpenAIChatWithFallback).toHaveBeenCalledTimes(2);
    expect(logUserEvent).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "chat_provider_degraded",
      expect.objectContaining({
        code: "UPSTREAM_ERROR",
        status: 502,
      }),
    );
  });

  it("keeps chat available in degraded mode when provider configuration is missing", async () => {
    const { db } = createMockD1Database([
      {
        match: "SELECT chat_messages, repeated_message_streak, last_chat_message FROM user_event_counters",
        first: {
          chat_messages: 2,
          repeated_message_streak: 0,
          last_chat_message: null,
        },
      },
      {
        match: "UPDATE user_event_counters SET",
        run: { success: true, meta: {} },
      },
      {
        match: "SELECT * FROM user_profiles WHERE user_id = ?",
        first: {
          full_name: "Ana",
          main_goal: "saude_geral",
          initial_conditioning: "iniciante",
          equipment: "",
          injuries: "",
        },
      },
      {
        match: "SELECT * FROM user_progression WHERE user_id = ?",
        first: {
          level: 2,
          xp: 40,
          current_streak: 1,
        },
      },
      {
        match: "SELECT * FROM user_attributes WHERE user_id = ?",
        first: {
          strength: 4,
          constitution: 5,
          vitality: 6,
          dexterity: 3,
          focus: 4,
        },
      },
      {
        match: "SELECT weekly_plan_json, training_frequency FROM user_training_plans WHERE user_id = ?",
        first: {
          weekly_plan_json: null,
          training_frequency: 2,
        },
      },
    ]);
    const env = createTestEnv(db);
    const callOpenAIChatWithFallback = vi
      .fn()
      .mockRejectedValue(
        new TestApiIntegrationError(
          "SERVICE_NOT_CONFIGURED",
          503,
          "Nenhum provedor de IA configurado.",
        ),
      );
    const deps = createAiDeps({
      callOpenAIChatWithFallback,
    });
    const app = new Hono<AppContext>();
    registerAiRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/ai/chat", {
        method: "POST",
        body: {
          message: "como estao meus status",
          history: [],
          mode: "suporte",
          session_count: 1,
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(typeof payload.message).toBe("string");
    expect(payload.message).toContain("instabilidade temporaria no servico de IA externo");
    expect(payload.message).toContain("modo de contingencia");
    expect(callOpenAIChatWithFallback).toHaveBeenCalledTimes(1);
  });

  it("falls back from USDA to RapidAPI during food analysis when the primary lookup fails", async () => {
    const { db } = createMockD1Database([]);
    const env = createTestEnv(db);
    const fetchJsonWithTimeout = vi.fn(async (url: string) => {
      if (url.includes("api.nal.usda.gov")) {
        throw new Error("USDA unavailable");
      }

      return [
        {
          name: "banana",
          calories: 89,
          protein_g: 1.1,
          carbohydrates_total_g: 22.8,
          fat_total_g: 0.3,
        },
      ];
    });
    const deps = createAiDeps({
      fetchJsonWithTimeout,
    });
    const app = new Hono<AppContext>();
    registerAiRoutes(app, deps);
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      createJsonRequest("/api/ai/analyze-food", {
        method: "POST",
        body: {
          identified_items: [
            {
              food_name: "banana",
              portion_description: "1 unidade",
              portion_multiplier: 1,
            },
          ],
        },
      }),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      food_name: "banana",
      source: "rapidapi",
      calories: 89,
    });
    expect(payload.totals).toMatchObject({
      calories: 89,
      protein: 1.1,
      carbs: 22.8,
      fats: 0.3,
    });
    expect(payload.has_estimates).toBe(true);
  });
});
