import { describe, expect, it, vi } from "vitest";
import { createTrainingPlanPreferencesService } from "../../worker/services/trainingPlanPreferences";

class TestApiIntegrationError extends Error {
  details?: string | undefined;
}

describe("trainingPlanPreferences service", () => {
  it("persists a chat-driven training plan preference for future mission generations", async () => {
    const buildInitialTrainingPlan = vi.fn(async () => ({
      weekly: {
        segunda: { focus: "forca", muscles: ["peito"], exercises: ["Push-up"] },
      },
    }));
    const upsertTrainingPlan = vi.fn(async () => undefined);
    const callOpenAIChatWithFallback = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_update_training_plan: true,
              plan_focus: "forca",
              routine_style: "treinos curtos",
              summary: "priorizar força com sessões curtas",
              constraints: ["sem treinos longos"],
            }),
          },
        },
      ],
    }));

    const service = createTrainingPlanPreferencesService({
      ApiIntegrationError: TestApiIntegrationError,
      buildInitialTrainingPlan,
      callOpenAIChatWithFallback,
      currentWeekKey: () => "2026-W14",
      getErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
      normalizeTrainingPlanChatPreferences: (value) => {
        if (!value || typeof value !== "object") return null;
        const data = value as Record<string, unknown>;
        return {
          plan_focus: typeof data.plan_focus === "string" ? data.plan_focus : null,
          routine_style: typeof data.routine_style === "string" ? data.routine_style : null,
          summary: typeof data.summary === "string" ? data.summary : null,
          constraints: Array.isArray(data.constraints)
            ? data.constraints.filter((item): item is string => typeof item === "string")
            : [],
          user_request: typeof data.user_request === "string" ? data.user_request : null,
          updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
        };
      },
      parseJsonObjectFromModelContent: (content) => JSON.parse(content) as Record<string, unknown>,
      parseStoredPlanRecord: () => ({
        weekly: {
          segunda: { focus: "forca", muscles: ["peito"], exercises: ["Push-up"] },
        },
      }),
      serializeTrainingPlanChatPreferences: (preferences) => preferences,
      summarizeTrainingPlanChatPreferences: (preferences) =>
        preferences && typeof preferences === "object"
          ? String((preferences as Record<string, unknown>).summary ?? "")
          : "",
      upsertTrainingPlan,
    });

    const result = await service.maybeApplyTrainingPlanPreferenceFromChat(
      {
        env: { fitloot_db: {} as D1Database },
      } as never,
      {
        userId: "user-1",
        userMessage: "Quero ajustar meu plano para focar em força com treinos curtos daqui pra frente",
        mainGoal: "ganhar_massa",
        conditioning: "intermediario",
        equipment: "halteres",
        injuries: "",
        trainingFrequency: 4,
        existingPlanJson: null,
        activePreferences: null,
      },
    );

    expect(result).toMatchObject({
      plan_focus: "forca",
      routine_style: "treinos curtos",
      summary: "priorizar força com sessões curtas",
      constraints: ["sem treinos longos"],
    });
    expect(callOpenAIChatWithFallback).toHaveBeenCalledTimes(1);
    expect(upsertTrainingPlan).toHaveBeenCalledTimes(1);
    expect(buildInitialTrainingPlan).not.toHaveBeenCalled();
  });

  it("ignores ordinary chat messages that do not request plan changes", async () => {
    const service = createTrainingPlanPreferencesService({
      ApiIntegrationError: TestApiIntegrationError,
      buildInitialTrainingPlan: vi.fn(async () => ({})),
      callOpenAIChatWithFallback: vi.fn(async () => ({ choices: [] })),
      currentWeekKey: () => "2026-W14",
      getErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
      normalizeTrainingPlanChatPreferences: () => null,
      parseJsonObjectFromModelContent: () => null,
      parseStoredPlanRecord: () => null,
      serializeTrainingPlanChatPreferences: (preferences) => preferences,
      summarizeTrainingPlanChatPreferences: () => "",
      upsertTrainingPlan: vi.fn(async () => undefined),
    });

    const result = await service.maybeApplyTrainingPlanPreferenceFromChat(
      {
        env: { fitloot_db: {} as D1Database },
      } as never,
      {
        userId: "user-1",
        userMessage: "Como estão meus stats hoje?",
        mainGoal: "ganhar_massa",
        conditioning: "intermediario",
        equipment: "halteres",
        injuries: "",
        trainingFrequency: 4,
        existingPlanJson: null,
        activePreferences: null,
      },
    );

    expect(result).toBeNull();
  });
});
