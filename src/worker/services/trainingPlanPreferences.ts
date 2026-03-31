import type { Context } from "hono";

import type { ConditioningLevel } from "../../shared/types";
import type { AppContext } from "../core/types";

type OpenAIChatCompletionResponseLike = {
  choices?: Array<{
    message?: {
      content?: string | null | undefined;
    } | null | undefined;
  }> | undefined;
};

type ApiIntegrationErrorLike = Error & {
  details?: string | undefined;
};

type ApiIntegrationErrorConstructor = new (...args: unknown[]) => ApiIntegrationErrorLike;

type TrainingPlanChatPreferences = {
  plan_focus?: string | null | undefined;
  routine_style?: string | null | undefined;
  summary?: string | null | undefined;
  constraints?: string[] | null | undefined;
  user_request?: string | null | undefined;
  updated_at?: string | null | undefined;
};

type TrainingPlanPreferencesDeps = {
  ApiIntegrationError: ApiIntegrationErrorConstructor;
  buildInitialTrainingPlan: (
    env: AppContext["Bindings"],
    mainGoal: string | null | undefined,
    conditioning: ConditioningLevel,
    equipment: string | null | undefined,
    injuries: string | null | undefined,
    trainingFrequency: number | null | undefined,
  ) => Promise<Record<string, unknown>>;
  callOpenAIChatWithFallback: (
    c: Context<AppContext>,
    messages: Array<{ role: string; content: string }>,
    maxTokens?: number,
    jsonMode?: boolean,
  ) => Promise<OpenAIChatCompletionResponseLike>;
  currentWeekKey: () => string;
  getErrorMessage: (error: unknown) => string;
  normalizeTrainingPlanChatPreferences: (value: unknown) => TrainingPlanChatPreferences | null;
  parseJsonObjectFromModelContent: <T extends Record<string, unknown>>(
    content: string,
  ) => T | null;
  parseStoredPlanRecord: (
    planJson: string | null | undefined,
  ) => Record<string, unknown> | null;
  serializeTrainingPlanChatPreferences: (preferences: unknown) => unknown;
  summarizeTrainingPlanChatPreferences: (preferences: unknown) => string;
  upsertTrainingPlan: (
    db: D1Database,
    userId: string,
    plan: Record<string, unknown>,
    mainGoal: string | null,
    conditioning: ConditioningLevel,
    equipment: string | null,
    injuries: string | null,
    trainingFrequency: number | null | undefined,
  ) => Promise<void>;
};

export function createTrainingPlanPreferencesService(
  deps: TrainingPlanPreferencesDeps,
) {
  function shouldInspectTrainingPlanPreferenceRequest(message: string): boolean {
    const normalized = message
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim()
      .toLowerCase();
    if (normalized.length === 0) return false;

    const planContextKeywords = [
      "plano",
      "rotina",
      "missao",
      "missoes",
      "proxim",
      "daqui pra frente",
      "a partir de agora",
    ];
    const changeIntentKeywords = [
      "adicion",
      "inclu",
      "apli",
      "salv",
      "ajust",
      "muda",
      "troca",
      "substit",
      "adapt",
      "configur",
      "quero",
      "prefiro",
      "deixa",
      "usa",
      "use",
    ];
    const focusKeywords = [
      "foco",
      "forca",
      "resistencia",
      "resist",
      "condicion",
      "mobilidade",
      "flexibilidade",
      "hipertrof",
      "massa",
      "emagrec",
      "curta",
      "rapido",
    ];

    const hasPlanContext = planContextKeywords.some((keyword) =>
      normalized.includes(keyword),
    );
    const hasChangeIntent = changeIntentKeywords.some((keyword) =>
      normalized.includes(keyword),
    );
    const hasFocusKeyword = focusKeywords.some((keyword) =>
      normalized.includes(keyword),
    );
    const mentionsTraining = normalized.includes("treino");

    return (hasPlanContext && hasChangeIntent)
      || (hasFocusKeyword && hasChangeIntent && (hasPlanContext || mentionsTraining));
  }

  async function maybeApplyTrainingPlanPreferenceFromChat(
    c: Context<AppContext>,
    params: {
      userId: string;
      userMessage: string;
      mainGoal: string;
      conditioning: ConditioningLevel;
      equipment: string;
      injuries: string;
      trainingFrequency: number;
      existingPlanJson: string | null;
      activePreferences: TrainingPlanChatPreferences | null;
    },
  ): Promise<TrainingPlanChatPreferences | null> {
    if (!shouldInspectTrainingPlanPreferenceRequest(params.userMessage)) {
      return null;
    }

    const currentPreferenceSummary = deps.summarizeTrainingPlanChatPreferences(
      params.activePreferences,
    );
    const classificationPrompt = [
      "Analise se a mensagem do usuario pede para alterar a abordagem do plano de treino futuro que orienta a geracao das proximas missoes.",
      "Considere como alteracao valida pedidos como foco em forca, resistencia, hipertrofia, condicionamento, emagrecimento, mobilidade, flexibilidade, rotina curta, treinos rapidos ou adaptacao da rotina.",
      "Nao marque alteracao quando o usuario estiver apenas tirando uma duvida geral, pedindo explicacao de exercicio, falando de dor sem pedir mudanca de plano, ou comentando desempenho sem pedir ajuste futuro.",
      "Se houver nova preferencia, ela substitui a anterior.",
      "Responda APENAS JSON valido neste formato:",
      '{"should_update_training_plan":false,"plan_focus":null,"routine_style":null,"summary":null,"constraints":[]}',
    ].join("\n");

    const classificationUserMessage = [
      `Mensagem do usuario: ${params.userMessage}`,
      `Objetivo atual: ${params.mainGoal}`,
      `Condicionamento atual: ${params.conditioning}`,
      `Treinos por semana: ${params.trainingFrequency}`,
      currentPreferenceSummary.length > 0
        ? `Preferencia ativa atual: ${currentPreferenceSummary}`
        : "Preferencia ativa atual: nenhuma",
    ].join("\n");

    try {
      const classificationResponse = await deps.callOpenAIChatWithFallback(
        c,
        [
          { role: "system", content: classificationPrompt },
          { role: "user", content: classificationUserMessage },
        ],
        220,
        true,
      );
      const rawContent =
        classificationResponse.choices?.[0]?.message?.content ?? "";
      const parsed = deps.parseJsonObjectFromModelContent<Record<string, unknown>>(
        rawContent,
      );
      const shouldUpdateTrainingPlan = parsed
        ? parsed.should_update_training_plan === true
          || parsed.should_update_training_plan === "true"
        : false;
      if (!shouldUpdateTrainingPlan || !parsed) {
        return null;
      }

      const normalizedPreferences =
        deps.normalizeTrainingPlanChatPreferences({
          plan_focus: parsed.plan_focus,
          routine_style: parsed.routine_style,
          summary: parsed.summary,
          constraints: parsed.constraints,
          user_request: params.userMessage,
          updated_at: new Date().toISOString(),
        });
      if (!normalizedPreferences) {
        return null;
      }

      const existingPlan =
        deps.parseStoredPlanRecord(params.existingPlanJson)
        ?? ((await deps.buildInitialTrainingPlan(
          c.env,
          params.mainGoal,
          params.conditioning,
          params.equipment,
          params.injuries,
          params.trainingFrequency,
        )) as Record<string, unknown>);

      const nextPlan: Record<string, unknown> = {
        ...existingPlan,
        chat_preferences: deps.serializeTrainingPlanChatPreferences(
          normalizedPreferences,
        ),
        profile_hash: "",
        week_key: deps.currentWeekKey(),
      };

      await deps.upsertTrainingPlan(
        c.env.fitloot_db,
        params.userId,
        nextPlan,
        params.mainGoal,
        params.conditioning,
        params.equipment,
        params.injuries,
        params.trainingFrequency,
      );

      return normalizedPreferences;
    } catch (error) {
      console.warn("[ai-chat][plan-preference]", {
        userId: params.userId,
        message: deps.getErrorMessage(error),
        details:
          error instanceof deps.ApiIntegrationError ? error.details : undefined,
      });
      return null;
    }
  }

  return {
    maybeApplyTrainingPlanPreferenceFromChat,
    shouldInspectTrainingPlanPreferenceRequest,
  };
}
