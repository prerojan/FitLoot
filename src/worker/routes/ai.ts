import { Hono, type Context, type MiddlewareHandler } from "hono";

import {
  AiAnalyzeFoodRequestSchema,
  AiChatRequestSchema,
} from "../../shared/types";
import { MISSION_LIMITS } from "../../constants/missionMetrics";
import { assertString, safeGet } from "../../utils/typeHelpers";
import { toStatusCode } from "../httpHelpers";
import {
  getErrorMessage,
  internalErrorResponse,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import {
  getOpenRouterApiKey,
  getOpenRouterVisionModel,
} from "../core/providerConfig";
import type {
  AppContext,
  Env,
} from "../core/types";

type OpenAIChatCompletionResponseLike = {
  choices?: Array<{
    message?: {
      content?: string | null | undefined;
    } | null | undefined;
  }> | undefined;
};

type ApiErrorCode =
  | "SERVICE_NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE"
  | "RATE_LIMITED";

type ApiIntegrationErrorLike = Error & {
  code: ApiErrorCode;
  status: number;
  details?: string | undefined;
};

type ApiIntegrationErrorConstructor = new (
  code: ApiErrorCode,
  status: number,
  message: string,
  details?: string | undefined,
) => ApiIntegrationErrorLike;

type FriendlyErrorResponse = {
  status: number;
  payload: Record<string, unknown>;
};

type AiMissionGenerationResult = {
  missions: unknown[];
  fallback: boolean;
  error: string | null;
};

type StructuredMissionPlanResult = {
  already_active: boolean;
  used_ai: boolean;
  invalid_ratio: number | null | undefined;
  missions: unknown[];
};

type TimeoutMsByService = {
  openrouter: number;
  anthropic?: number | undefined;
  usda: number;
  rapidapi: number;
};

type AiRouteDeps = {
  ApiIntegrationError: ApiIntegrationErrorConstructor;
  authMiddleware: MiddlewareHandler<AppContext>;
  callOpenAIChatWithFallback: (
    c: Context<AppContext>,
    messages: Array<{ role: string; content: string }>,
    maxTokens?: number,
    jsonMode?: boolean,
  ) => Promise<OpenAIChatCompletionResponseLike>;
  ensureMissionJobSchema: (db: D1Database) => Promise<void>;
  ensureUserCounterRow: (db: D1Database, userId: string) => Promise<void>;
  enforceRateLimit: (key: string) => void;
  fetchJsonWithTimeout: <T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ) => Promise<T>;
  generateStructuredMissionPlanForUser: (
    env: Env,
    db: D1Database,
    userId: string,
    options: {
      isAiSpecial: boolean;
      dailyTarget: number;
      weeklyTarget: number;
      monthlyTarget: number;
    },
  ) => Promise<StructuredMissionPlanResult>;
  logUserEvent: (
    db: D1Database,
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  repairActivatedProfileState: (params: {
    db: D1Database;
    env: Env;
    user: AppContext["Variables"]["user"];
  }) => Promise<Record<string, unknown> | null>;
  maybeApplyTrainingPlanPreferenceFromChat: (
    c: Context<AppContext>,
    params: {
      userId: string;
      userMessage: string;
      mainGoal: string;
      conditioning: string;
      equipment: string;
      injuries: string;
      trainingFrequency: number;
      existingPlanJson: string | null;
      activePreferences: unknown;
    },
  ) => Promise<unknown | null>;
  normalizeConditioning: (value: unknown) => string;
  normalizeMatchText: (value: string) => string;
  normalizeTrainingFrequencyInput: (value: unknown) => number;
  normalizeTrainingPlanChatPreferences: (value: unknown) => unknown;
  onChatMessage: (db: D1Database, userId: string, sessionCount: number) => Promise<void>;
  parseJsonObjectFromModelContent: <T extends Record<string, unknown>>(content: string) => T | null;
  parseStoredPlanRecord: (planJson: string | null | undefined) => { chat_preferences?: unknown } | null;
  requestOpenRouterVisionStructuredContent: (
    apiKey: string,
    env: Pick<Env, "OPENROUTER_HTTP_REFERER" | "OPENROUTER_APP_TITLE" | "FRONTEND_ORIGIN">,
    model: string,
    prompt: string,
    imageDataUrl: string,
    maxTokens: number,
    timeoutMs: number,
  ) => Promise<string>;
  summarizeTrainingPlanChatPreferences: (preferences: unknown) => string;
  timeoutMsByService: TimeoutMsByService;
  toFriendlyErrorResponse: (error: unknown) => FriendlyErrorResponse;
  unlockAchievementIfNeeded: (
    db: D1Database,
    userId: string,
    achievementName: string,
    progressCurrent: number,
    progressRequired: number,
  ) => Promise<void>;
};

// Route registration for AI mission generation, chat, recommendations, workout suggestions, and food analysis.
export function registerAiRoutes(
  app: Hono<AppContext>,
  deps: AiRouteDeps,
): void {
  const {
    ApiIntegrationError,
    authMiddleware,
    callOpenAIChatWithFallback,
    ensureMissionJobSchema,
    ensureUserCounterRow,
    enforceRateLimit,
    fetchJsonWithTimeout,
    generateStructuredMissionPlanForUser,
    logUserEvent,
    repairActivatedProfileState,
    maybeApplyTrainingPlanPreferenceFromChat,
    normalizeConditioning,
    normalizeMatchText,
    normalizeTrainingFrequencyInput,
    normalizeTrainingPlanChatPreferences,
    onChatMessage,
    parseJsonObjectFromModelContent,
    parseStoredPlanRecord,
    requestOpenRouterVisionStructuredContent,
    summarizeTrainingPlanChatPreferences,
    timeoutMsByService,
    toFriendlyErrorResponse,
    unlockAchievementIfNeeded,
  } = deps;

  const isRecoverableChatProviderError = (
    error: unknown,
  ): error is ApiIntegrationErrorLike =>
    error instanceof ApiIntegrationError
    && (
      error.code === "SERVICE_NOT_CONFIGURED"
      || error.code === "AUTH_FAILED"
      || error.code === "RATE_LIMITED"
      || error.code === "TIMEOUT"
      || error.code === "UPSTREAM_ERROR"
      || error.code === "INVALID_RESPONSE"
    );

  const buildChatProviderFallbackMessage = (params: {
    userMessage: string;
    mode: string;
    mainGoal: string;
    conditioning: string;
    level: number;
    xp: number;
    streakDays: number;
    attributes: {
      strength: number;
      constitution: number;
      vitality: number;
      dexterity: number;
      focus: number;
    };
  }): string => {
    const normalizedText = params.userMessage
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    const mainGoal = params.mainGoal.replaceAll("_", " ").trim();
    const conditioning = params.conditioning.trim();

    const contextParts: string[] = [];
    if (mainGoal.length > 0) {
      contextParts.push(`Seu foco atual e ${mainGoal}.`);
    }
    if (conditioning.length > 0) {
      contextParts.push(`Seu nivel atual e ${conditioning}.`);
    }

    const asksForStatus =
      normalizedText.includes("status")
      || normalizedText.includes("stats")
      || normalizedText.includes("atributo")
      || normalizedText.includes("nivel")
      || normalizedText.includes("xp")
      || normalizedText.includes("streak")
      || normalizedText.includes("evolucao");
    if (asksForStatus) {
      return [
        "Estou com instabilidade temporaria no servico de IA externo, mas aqui vai seu status atual.",
        `Nivel: ${params.level}.`,
        `XP: ${params.xp}.`,
        `Streak: ${params.streakDays} dias.`,
        `Atributos -> Forca: ${params.attributes.strength}, Constituicao: ${params.attributes.constitution}, Vitalidade: ${params.attributes.vitality}, Destreza: ${params.attributes.dexterity}, Foco: ${params.attributes.focus}.`,
        "Se quiser, te passo agora os 2 melhores ajustes para subir esses stats mais rapido.",
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }

    let actionGuidance =
      "Me manda em uma frase o resultado que voce quer hoje e eu te devolvo um passo a passo objetivo.";

    if (
      normalizedText.includes("treino")
      || normalizedText.includes("exercicio")
      || normalizedText.includes("serie")
    ) {
      actionGuidance =
        "Enquanto estabilizo a IA, priorize aquecimento de 5 minutos, 3 blocos principais com tecnica limpa e descanso curto entre series. Se quiser, eu monto um treino fechado em seguida.";
    } else if (
      normalizedText.includes("aliment")
      || normalizedText.includes("dieta")
      || normalizedText.includes("caloria")
      || normalizedText.includes("nutri")
    ) {
      actionGuidance =
        "Enquanto estabilizo a IA, mantenha uma refeicao com proteina magra, carboidrato simples de medir e agua suficiente. Se quiser, eu monto um ajuste alimentar por refeicao em seguida.";
    } else if (
      normalizedText.includes("dor")
      || normalizedText.includes("lesao")
      || normalizedText.includes("machuc")
    ) {
      actionGuidance =
        "Como regra de seguranca, reduza intensidade, evite movimentos com dor aguda e procure avaliacao profissional se a dor persistir. Se quiser, eu te sugiro uma alternativa de baixo impacto.";
    } else if (params.mode === "suporte") {
      actionGuidance =
        "Me diga o objetivo imediato desta conversa e a restricao principal (tempo, equipamento ou dor) que eu te passo uma orientacao direta agora.";
    }

    return [
      "Estou com instabilidade temporaria no servico de IA externo, mas sigo te atendendo por aqui.",
      ...contextParts,
      actionGuidance,
      "Se puder, tente reenviar a mesma mensagem em alguns segundos para eu te responder com a geracao completa.",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const generateMissionPlanWithRecovery = async (
    env: Env,
    db: D1Database,
    user: AppContext["Variables"]["user"],
  ): Promise<StructuredMissionPlanResult> => {
    const options = {
      isAiSpecial: false,
      dailyTarget: MISSION_LIMITS.daily,
      weeklyTarget: MISSION_LIMITS.weekly,
      monthlyTarget: MISSION_LIMITS.monthly,
    } as const;

    try {
      return await generateStructuredMissionPlanForUser(
        env,
        db,
        user.id,
        options,
      );
    } catch (error) {
      if (getErrorMessage(error) !== "MISSION_GENERATION_PROFILE_INCOMPLETE") {
        throw error;
      }

      const recoveredProfile = await repairActivatedProfileState({
        db,
        env,
        user,
      });
      if (!recoveredProfile) {
        throw error;
      }

      return generateStructuredMissionPlanForUser(
        env,
        db,
        user.id,
        options,
      );
    }
  };

type USDAResponse = {
  foods?: Array<{
    description?: string | undefined;
    foodNutrients?: Array<{ nutrientName?: string | undefined; value?: number | undefined }>;
  }>;
};

type RapidApiNutritionResponse = Array<{
  name?: string | undefined;
  calories?: number | undefined;
  protein_g?: number | undefined;
  carbohydrates_total_g?: number | undefined;
  fat_total_g?: number | undefined;
}>;

// Consulta a base oficial do USDA quando a análise pode usar dados públicos.
async function searchFoodOnUSDA(c: import("hono").Context<AppContext>, query: string) {
  if (!c.env.USDA_API_KEY) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "USDA não configurada.");
  }
  enforceRateLimit(`usda:${c.get("user")?.id ?? "anon"}`);
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", c.env.USDA_API_KEY);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", "1");
  return fetchJsonWithTimeout<USDAResponse>(url.toString(), { method: "GET" }, timeoutMsByService.usda);
}

// Usa a RapidAPI como fallback quando o USDA não devolve resultado útil.
async function searchFoodOnRapidApi(c: import("hono").Context<AppContext>, query: string) {
  if (!c.env.RAPID_API_KEY) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "RapidAPI não configurada.");
  }
  const host = c.env.RAPID_API_HOST || "nutrition-by-api-ninjas.p.rapidapi.com";
  enforceRateLimit(`rapidapi:${c.get("user")?.id ?? "anon"}`);
  const url = `https://${host}/v1/nutrition?query=${encodeURIComponent(query)}`;
  return fetchJsonWithTimeout<RapidApiNutritionResponse>(
    url,
    {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": c.env.RAPID_API_KEY,
        "X-RapidAPI-Host": host,
      },
    },
    timeoutMsByService.rapidapi
  );
}

// Extrai macros básicos quando o OCR identifica um rótulo nutricional legível.
function parseNutritionFromOcrLabel(text: string) {
  if (!text) return null;

  const normalize = (value?: string | undefined) => (value ? Number(value.replace(",", ".")) : null);
  const kcal = normalize(safeGet(text.match(/(\d+[.,]?\d*)\s*kcal/i) ?? [], 1));
  const kJ = normalize(safeGet(text.match(/(\d+[.,]?\d*)\s*kj/i) ?? [], 1));
  const protein = normalize(safeGet(text.match(/prote[ií]n[aa]s?[^\d]*(\d+[.,]?\d*)\s*g/i) ?? [], 1));
  const carbs = normalize(safeGet(text.match(/carboidratos?[^\d]*(\d+[.,]?\d*)\s*g/i) ?? [], 1));
  const fats = normalize(safeGet(text.match(/gorduras?(?:\s+totais?)?[^\d]*(\d+[.,]?\d*)\s*g/i) ?? [], 1));

  if ([kcal, kJ, protein, carbs, fats].every((item) => item === null)) {
    return null;
  }

  return {
    calories: kcal,
    energy_kj: kJ,
    protein,
    carbs,
    fats,
  };
}

const KCAL_PER_GRAM_PROTEIN = 4;
const KCAL_PER_GRAM_CARBS = 4;
const KCAL_PER_GRAM_FATS = 9;

function calculateMacroEnergyPercentages(totals: {
  protein: number;
  carbs: number;
  fats: number;
}) {
  const proteinEnergy = Math.max(0, totals.protein) * KCAL_PER_GRAM_PROTEIN;
  const carbsEnergy = Math.max(0, totals.carbs) * KCAL_PER_GRAM_CARBS;
  const fatsEnergy = Math.max(0, totals.fats) * KCAL_PER_GRAM_FATS;
  const totalEnergy = proteinEnergy + carbsEnergy + fatsEnergy;

  if (totalEnergy <= 0) {
    return {
      protein: 0,
      carbs: 0,
      fats: 0,
    };
  }

  return {
    protein: Number(((proteinEnergy / totalEnergy) * 100).toFixed(1)),
    carbs: Number(((carbsEnergy / totalEnergy) * 100).toFixed(1)),
    fats: Number(((fatsEnergy / totalEnergy) * 100).toFixed(1)),
  };
}

// Enfileira a geração personalizada de missões sem bloquear a resposta da rota.
app.post("/api/ai/generate-missions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    await ensureMissionJobSchema(c.env.fitloot_db);
    await c.req.json().catch(() => ({}));
    const jobId = crypto.randomUUID();

    await c.env.fitloot_db.prepare(
      `INSERT INTO mission_generation_jobs (id, user_id, status, result_json, error_message, updated_at)
       VALUES (?, ?, 'processing', NULL, NULL, datetime('now'))`
    ).bind(jobId, user.id).run();

    c.executionCtx.waitUntil((async () => {
      try {
        const result = await generateMissionPlanWithRecovery(
          c.env,
          c.env.fitloot_db,
          user,
        );
        const payload: AiMissionGenerationResult & {
          generated: boolean;
          used_ai: boolean;
          invalid_ratio: number | null | undefined;
          code?: string | undefined;
        } = {
          missions: result.missions,
          fallback: !result.used_ai,
          error: null,
          generated: !result.already_active,
          used_ai: result.used_ai,
          invalid_ratio: result.invalid_ratio,
          code: result.already_active ? "MISSIONS_ALREADY_ACTIVE" : undefined,
        };
        await c.env.fitloot_db.prepare(
          `UPDATE mission_generation_jobs
             SET status = 'completed', result_json = ?, error_message = NULL, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`
        ).bind(JSON.stringify(payload), jobId, user.id).run();
      } catch (jobError) {
        console.error("[/api/ai/generate-missions][job]", {
          message: getErrorMessage(jobError),
          userId: user.id,
          jobId,
        });
        await c.env.fitloot_db.prepare(
          `UPDATE mission_generation_jobs
             SET status = 'failed', error_message = ?, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`
        ).bind(getErrorMessage(jobError), jobId, user.id).run();
      }
    })());

    return c.json({
      success: true,
      status: "processing",
      job_id: jobId,
    }, 202);
  } catch (routeError) {
    console.error("[/api/ai/generate-missions]", {
      message: getErrorMessage(routeError),
      userId: user.id,
    });

    if (isMissingSchemaError(routeError)) {
      return schemaMismatchResponse(c);
    }

    return internalErrorResponse(c);
  }
});

// Retorna o andamento da geração assíncrona de missões do usuário.
app.get("/api/ai/generate-missions/status", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const jobId = String(c.req.query("job_id") ?? "").trim();
  if (!jobId) {
    return c.json({ error: "job_id obrigatório" }, 400);
  }

  try {
    await ensureMissionJobSchema(c.env.fitloot_db);
    const job = await c.env.fitloot_db.prepare(
      `SELECT id, status, result_json, error_message, created_at, updated_at
       FROM mission_generation_jobs
       WHERE id = ? AND user_id = ?`
    ).bind(jobId, user.id).first<{
      id: string;
      status: string;
      result_json: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>();

    if (!job) {
      return c.json({ error: "Job não encontrado" }, 404);
    }

    if (job.status === "completed") {
      const parsed = job.result_json
        ? JSON.parse(job.result_json) as (AiMissionGenerationResult & {
          generated?: boolean | undefined;
          used_ai?: boolean | undefined;
          invalid_ratio?: number | null | undefined;
          code?: string | undefined;
        })
        : null;
      return c.json({
        success: true,
        status: "completed",
        missions: parsed?.missions ?? [],
        fallback: Boolean(parsed?.fallback),
        error: parsed?.error ?? null,
        generated: parsed?.generated ?? true,
        used_ai: parsed?.used_ai ?? false,
        invalid_ratio: parsed?.invalid_ratio ?? null,
        code: parsed?.code,
        job_id: job.id,
      });
    }

    if (job.status === "failed") {
      return c.json({
        success: false,
        status: "failed",
        error: job.error_message ?? "Falha ao gerar missoes",
        job_id: job.id,
      }, 500);
    }

    return c.json({
      success: true,
      status: "processing",
      job_id: job.id,
      updated_at: job.updated_at,
    }, 202);
  } catch (error) {
    console.error("[/api/ai/generate-missions/status]", {
      message: getErrorMessage(error),
      userId: user.id,
      jobId,
    });
    if (isMissingSchemaError(error)) {
      return schemaMismatchResponse(c);
    }
    return internalErrorResponse(c);
  }
});

// Centraliza o chatbot com contexto de perfil, progresso e plano ativo.
app.post("/api/ai/chat", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const raw = await c.req.json();
    const parsed = AiChatRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
    }
    const { message: userMessage, history: conversationHistory = [], mode = "suporte", session_count } = parsed.data;

    await ensureUserCounterRow(c.env.fitloot_db, user.id);
    const currentCounter = await c.env.fitloot_db.prepare("SELECT chat_messages, repeated_message_streak, last_chat_message FROM user_event_counters WHERE user_id = ?")
      .bind(user.id).first<{ chat_messages: number; repeated_message_streak: number; last_chat_message: string | null }>();
    const sameMessage = (currentCounter?.last_chat_message ?? "") === userMessage;
    const nextRepeat = sameMessage ? Number(currentCounter?.repeated_message_streak ?? 0) + 1 : 1;
    await c.env.fitloot_db.prepare(
      `UPDATE user_event_counters SET
        chat_messages = COALESCE(chat_messages, 0) + 1,
        repeated_message_streak = ?,
        last_chat_message = ?,
        updated_at = datetime('now')
      WHERE user_id = ?`
    ).bind(nextRepeat, userMessage, user.id).run();
    await logUserEvent(c.env.fitloot_db, user.id, 'chat_message', { size: userMessage.length, repeated: sameMessage });
    await onChatMessage(c.env.fitloot_db, user.id, Number(session_count ?? (Number(currentCounter?.chat_messages ?? 0) + 1)));
    if (Number(session_count ?? 0) >= 100) {
      await unlockAchievementIfNeeded(c.env.fitloot_db, user.id, "Conversa de Louco", Number(session_count), 100);
    }

    const [profile, progression, attributes, trainingPlanRow] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT weekly_plan_json, training_frequency FROM user_training_plans WHERE user_id = ?")
        .bind(user.id)
        .first<{ weekly_plan_json: string | null; training_frequency: number | null }>(),
    ]);
    const activeTrainingPlan = parseStoredPlanRecord(trainingPlanRow?.weekly_plan_json);
    const activeChatPlanPreferences = normalizeTrainingPlanChatPreferences(activeTrainingPlan?.chat_preferences);
    const activeChatPlanSummary = summarizeTrainingPlanChatPreferences(activeChatPlanPreferences);
    const profileMainGoal = typeof profile?.main_goal === "string" ? profile.main_goal : "";
    const profileConditioning = normalizeConditioning(profile?.initial_conditioning);
    const profileEquipment = typeof profile?.equipment === "string" ? profile.equipment : "";
    const profileInjuries = typeof profile?.injuries === "string" ? profile.injuries : "";
    const trainingFrequency = normalizeTrainingFrequencyInput(trainingPlanRow?.training_frequency);

    const systemPrompt = `Você é o assistente oficial do app FitBot.
Sua função é responder de forma útil, natural, objetiva e agradável, ajudando o usuário com treino, evolução física, hábitos, alimentação e uso do app.

REGRAS DE COMPORTAMENTO

1. TOM DE VOZ
- Fale de forma humana, natural, clara e amigável.
- Seja acolhedor, mas sem exagero.
- Evite linguagem robótica.
- Evite parecer um coach caricato ou motivacional demais.
- Evite excesso de entusiasmo, emojis e frases decoradas.

2. OBJETIVIDADE
- Responda exatamente o que o usuário pediu.
- Não acrescente explicações longas sem necessidade.
- Não desvie do assunto.
- Não invente contexto extra.
- Se a pergunta for simples, responda de forma simples.

3. PERSONALIZAÇÃO
- Personalize a resposta quando isso realmente agregar valor.
- Use o nome do usuário com moderação.
- Nunca repita o nome do usuário em toda mensagem.
- Só use o nome em momentos específicos: primeira saudação, incentivo pontual, contexto em que a personalização melhora a experiência.
- Na maior parte do tempo, responda sem citar o nome.

4. ESTILO DE RESPOSTA
- Prefira respostas curtas ou médias.
- Só faça respostas longas quando o usuário pedir detalhes.
- Evite introduções desnecessárias.
- Vá direto ao ponto.
- Organize a resposta com clareza.
- Quando útil, divida em etapas simples.

5. PROIBIÇÕES DE ESTILO
- Não use frases como "Estou aqui pronto para ajudar você a evoluir", "Vamos nessa rumo ao seu objetivo", "bora ganhar XP", "estou aqui para te acompanhar nessa jornada".
- Não transforme toda resposta em mensagem motivacional.
- Não tente ser engraçado o tempo todo.
- Não use o nome do usuário repetidamente.
- Não enfeite respostas com texto desnecessário.

6. QUANDO O USUÁRIO MANDAR MENSAGEM CONFUSA
- Peça esclarecimento de forma curta e natural.
- Tom: "Não entendi muito bem. Me explica de outro jeito?" ou "Pode reformular? Quero te responder certo."
- Não faça textos longos para dizer que não entendeu.

7. QUANDO O USUÁRIO FIZER PERGUNTA DIRETA
- Responda diretamente, sem introdução.

8. QUANDO O USUÁRIO PEDIR AJUDA PRÁTICA
- Entregue ação concreta: treino, ajuste de rotina, sugestão alimentar, explicação objetiva.
- Menos fala inspiracional, mais utilidade.

9. QUANDO NÃO SOUBER OU FALTAR CONTEXTO
- Admita de forma simples e peça apenas a informação necessária.
- Não invente.

10. FORMATO IDEAL
- Pergunta simples -> resposta curta
- Pergunta prática -> resposta objetiva com passos
- Pergunta complexa -> resposta clara, sem enrolação
- Dúvida emocional -> resposta acolhedora, mas sóbria

11. REGRA FINAL
Antes de responder, avalie: Estou respondendo exatamente o que foi pedido? Estou sendo mais longo do que preciso? Estou usando o nome sem necessidade? Estou parecendo natural ou teatral? Se estiver teatral ou motivacional demais, simplifique.

INSTRUÇÕES EXTRAS DE ESTILO
- Não use mais de 1 emoji por resposta, e apenas quando combinar naturalmente.
- Responda primeiro, explique depois se necessário.
- Se a pergunta for curta, a resposta também deve ser curta.
- Se o usuário estiver irritado ou impaciente, seja ainda mais direto.
- NUNCA use markdown na resposta. Não use **, *, |, #, ---, tabelas ou qualquer símbolo de formatação. Escreva em texto puro e natural.

Contexto do usuário:
- Nome: ${profile?.full_name}
- Nível: ${progression?.level}
- XP: ${progression?.xp}
- Streak: ${progression?.current_streak} dias
- Objetivo: ${profileMainGoal}
- Condicionamento: ${profileConditioning}
- Preferência ativa para próximas gerações: ${activeChatPlanSummary || "nenhuma"}
- Força: ${attributes?.strength}
- Modo: ${mode}`;

    const normalizedHistory = conversationHistory
      .filter((msg) => {
        const role = typeof msg?.role === "string" ? msg.role : "";
        const content = typeof msg?.content === "string" ? msg.content : "";
        return (
          content.trim().length > 0 &&
          (role === "assistant" || role === "user" || role === "system")
        );
      })
      .map((msg) => ({
        role: typeof msg.role === "string" ? msg.role : "user",
        content: typeof msg.content === "string" ? msg.content : "",
      }))
      .slice(-16);
    const dedupedHistory =
      normalizedHistory.length > 0 &&
      normalizedHistory[normalizedHistory.length - 1]?.role === "user" &&
      normalizeMatchText(normalizedHistory[normalizedHistory.length - 1]?.content ?? "") ===
        normalizeMatchText(userMessage)
        ? normalizedHistory.slice(0, -1)
        : normalizedHistory;
    const compactSystemPrompt = `Você é o FitBot. Responda em português do Brasil, de forma útil, curta e direta, sem markdown. Se faltar contexto, peça só o necessário.

Contexto do usuário:
- Nome: ${profile?.full_name}
- Objetivo: ${profileMainGoal}
- Condicionamento: ${profileConditioning}
- Preferência ativa: ${activeChatPlanSummary || "nenhuma"}
- Modo: ${mode}`;

    const primaryMessages = [
      { role: "system", content: systemPrompt },
      ...dedupedHistory,
      { role: "user", content: userMessage },
    ];

    let content = "";
    let usedDegradedFallback = false;

    try {
      let openaiData: OpenAIChatCompletionResponseLike;
      try {
        openaiData = await callOpenAIChatWithFallback(c, primaryMessages);
      } catch (primaryError) {
        console.warn("[ai-chat][primary]", {
          userId: user.id,
          message: getErrorMessage(primaryError),
          details: primaryError instanceof ApiIntegrationError ? primaryError.details : undefined,
        });

        if (
          !(primaryError instanceof ApiIntegrationError) ||
          primaryError.code === "RATE_LIMITED" ||
          primaryError.code === "SERVICE_NOT_CONFIGURED" ||
          primaryError.code === "AUTH_FAILED"
        ) {
          throw primaryError;
        }

        openaiData = await callOpenAIChatWithFallback(
          c,
          [
            { role: "system", content: compactSystemPrompt },
            ...dedupedHistory.slice(-8),
            { role: "user", content: userMessage },
          ],
          700,
        );
      }

      content =
        (
          safeGet(openaiData.choices ?? [], 0) as
            | { message?: { content?: string | null | undefined } | null | undefined }
            | undefined
        )?.message?.content ?? "";
    } catch (chatProviderError) {
      if (!isRecoverableChatProviderError(chatProviderError)) {
        throw chatProviderError;
      }

      usedDegradedFallback = true;
      content = buildChatProviderFallbackMessage({
        userMessage,
        mode,
        mainGoal: profileMainGoal,
        conditioning: profileConditioning,
        level: Number(progression?.level ?? 0),
        xp: Number(progression?.xp ?? 0),
        streakDays: Number(progression?.current_streak ?? 0),
        attributes: {
          strength: Number(attributes?.strength ?? 0),
          constitution: Number(attributes?.constitution ?? 0),
          vitality: Number(attributes?.vitality ?? 0),
          dexterity: Number(attributes?.dexterity ?? 0),
          focus: Number(attributes?.focus ?? 0),
        },
      });

      console.warn("[ai-chat][degraded-fallback]", {
        userId: user.id,
        code: chatProviderError.code,
        status: chatProviderError.status,
        details: chatProviderError.details,
      });

      try {
        await logUserEvent(c.env.fitloot_db, user.id, "chat_provider_degraded", {
          code: chatProviderError.code,
          status: chatProviderError.status,
        });
      } catch (loggingError) {
        console.warn("[ai-chat][degraded-fallback][log-failed]", {
          userId: user.id,
          message: getErrorMessage(loggingError),
        });
      }
    }
    const appliedPlanPreference = await maybeApplyTrainingPlanPreferenceFromChat(c, {
      userId: user.id,
      userMessage,
      mainGoal: profileMainGoal,
      conditioning: profileConditioning,
      equipment: profileEquipment,
      injuries: profileInjuries,
      trainingFrequency,
      existingPlanJson: trainingPlanRow?.weekly_plan_json ?? null,
      activePreferences: activeChatPlanPreferences,
    });
    const planPreferenceNotice = appliedPlanPreference
      ? `\n\nAjuste salvo para as próximas missões: ${summarizeTrainingPlanChatPreferences(appliedPlanPreference)}.`
      : "";

    const degradedFallbackNotice = usedDegradedFallback
      ? "\n\nObservacao: resposta entregue em modo de contingencia devido a instabilidade temporaria do provedor de IA."
      : "";

    return c.json({ message: `${content}${planPreferenceNotice}${degradedFallbackNotice}`.trim() });
  } catch (error) {
    console.error("[ai-chat]", {
      userId: user.id,
      message: getErrorMessage(error),
      details: error instanceof ApiIntegrationError ? error.details : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    });
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});

type AiRecommendationsPayload = {
  next_skill_recommendation: {
    name: string;
    reason: string;
  };
  weak_attribute: {
    name: string;
    suggestion: string;
  };
  training_focus: {
    type: string;
    reason: string;
  };
  motivation_message: string;
};

type AiRecommendationSkillRow = {
  name: string;
  total_reps: number;
  best_reps: number;
};

function toRoundedNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

// Gera recomendações úteis mesmo quando o provider externo falha ou degrada.
function buildFallbackRecommendations(params: {
  level: number;
  streak: number;
  goal: string | null | undefined;
  attributes: {
    strength: number;
    constitution: number;
    vitality: number;
    dexterity: number;
    focus: number;
  };
  skills: AiRecommendationSkillRow[];
}): AiRecommendationsPayload {
  const goal = typeof params.goal === "string" ? params.goal : "";
  const focusByGoal: Record<string, { type: string; reason: string }> = {
    perder_peso: {
      type: "Condicionamento",
      reason: "Aumente a frequência de sessões dinâmicas para elevar o gasto calórico com consistência.",
    },
    ganhar_massa: {
      type: "Força progressiva",
      reason: "Priorize sobrecarga gradual e execução controlada para sustentar ganho de massa.",
    },
    resistencia: {
      type: "Volume e resistência",
      reason: "Blocos mais longos e descansos menores ajudam a consolidar sua resistência.",
    },
    calistenia: {
      type: "Técnica de base",
      reason: "Fortalecer movimentos fundamentais melhora o controle corporal para a progressão na calistenia.",
    },
    saude_geral: {
      type: "Constância semanal",
      reason: "Rotina equilibrada e aderente costuma gerar o melhor resultado para saúde geral.",
    },
  };

  const weakestAttributeCandidates: Array<{ name: string; value: number; suggestion: string }> = [
    {
      name: "Força",
      value: params.attributes.strength,
      suggestion: "Inclua exercícios compostos e aumente a carga ou repetições de forma gradual.",
    },
    {
      name: "Constituição",
      value: params.attributes.constitution,
      suggestion: "Combine volume moderado com recuperação consistente para aguentar mais sessões na semana.",
    },
    {
      name: "Vitalidade",
      value: params.attributes.vitality,
      suggestion: "Mantenha cardio leve e pausas bem distribuídas para melhorar energia ao longo do treino.",
    },
    {
      name: "Destreza",
      value: params.attributes.dexterity,
      suggestion: "Trabalhe controle de movimento e amplitude para ganhar precisão e mobilidade.",
    },
    {
      name: "Foco",
      value: params.attributes.focus,
      suggestion: "Use treinos curtos com meta clara para aumentar concentração e regularidade.",
    },
  ];
  const weakestAttribute = weakestAttributeCandidates.sort((left, right) => left.value - right.value)[0];

  const topSkill = params.skills[0] ?? null;
  const focus = focusByGoal[goal] ?? {
    type: "Evolução equilibrada",
    reason: "A melhor recomendação agora é sustentar consistência e ajustar o treino com base no seu progresso recente.",
  };

  return {
    next_skill_recommendation: topSkill
      ? {
        name: topSkill.name,
        reason: `Você já construiu base em ${topSkill.name}. Vale aprofundar essa skill enquanto mantém progressão controlada nas demais.`,
      }
      : {
        name: "Fundamentos de corpo livre",
        reason: "Comece pelas skills básicas para construir repertório técnico e facilitar as próximas evoluções.",
      },
    weak_attribute: {
      name: weakestAttribute.name,
      suggestion: weakestAttribute.suggestion,
    },
    training_focus: focus,
    motivation_message:
      params.streak >= 7
        ? `Você já acumula ${params.streak} dias de streak. O melhor próximo passo é proteger essa consistência enquanto sobe o nível.`
        : `Seu nível ${params.level} já mostra progresso. Mantenha constância nos próximos dias para transformar ritmo em resultado.`,
  };
}

// Mescla a resposta externa com o fallback local para evitar payload quebrado.
function mergeRecommendationsWithFallback(
  raw: unknown,
  fallback: AiRecommendationsPayload,
): AiRecommendationsPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }

  const data = raw as Record<string, unknown>;
  const nextSkill = data.next_skill_recommendation;
  const weakAttribute = data.weak_attribute;
  const trainingFocus = data.training_focus;

  const nextSkillRecord =
    nextSkill && typeof nextSkill === "object" && !Array.isArray(nextSkill)
      ? nextSkill as Record<string, unknown>
      : null;
  const weakAttributeRecord =
    weakAttribute && typeof weakAttribute === "object" && !Array.isArray(weakAttribute)
      ? weakAttribute as Record<string, unknown>
      : null;
  const trainingFocusRecord =
    trainingFocus && typeof trainingFocus === "object" && !Array.isArray(trainingFocus)
      ? trainingFocus as Record<string, unknown>
      : null;

  return {
    next_skill_recommendation: {
      name:
        typeof nextSkillRecord?.name === "string" && nextSkillRecord.name.trim().length > 0
          ? nextSkillRecord.name.trim()
          : fallback.next_skill_recommendation.name,
      reason:
        typeof nextSkillRecord?.reason === "string" && nextSkillRecord.reason.trim().length > 0
          ? nextSkillRecord.reason.trim()
          : fallback.next_skill_recommendation.reason,
    },
    weak_attribute: {
      name:
        typeof weakAttributeRecord?.name === "string" && weakAttributeRecord.name.trim().length > 0
          ? weakAttributeRecord.name.trim()
          : fallback.weak_attribute.name,
      suggestion:
        typeof weakAttributeRecord?.suggestion === "string" && weakAttributeRecord.suggestion.trim().length > 0
          ? weakAttributeRecord.suggestion.trim()
          : fallback.weak_attribute.suggestion,
    },
    training_focus: {
      type:
        typeof trainingFocusRecord?.type === "string" && trainingFocusRecord.type.trim().length > 0
          ? trainingFocusRecord.type.trim()
          : fallback.training_focus.type,
      reason:
        typeof trainingFocusRecord?.reason === "string" && trainingFocusRecord.reason.trim().length > 0
          ? trainingFocusRecord.reason.trim()
          : fallback.training_focus.reason,
    },
    motivation_message:
      typeof data.motivation_message === "string" && data.motivation_message.trim().length > 0
        ? data.motivation_message.trim()
        : fallback.motivation_message,
  };
}

// Entrega recomendações de skill, atributo fraco e foco de treino.
app.get("/api/ai/recommendations", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const [profile, progression, attributes, skills, completedMissions] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_attributes WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare(`
        SELECT s.*, us.total_reps, us.best_reps 
        FROM skills s
        INNER JOIN user_skills us ON s.id = us.skill_id
        WHERE us.user_id = ?
        ORDER BY us.total_reps DESC
      `).bind(user.id).all(),
      c.env.fitloot_db.prepare(`
        SELECT COUNT(*) as count 
        FROM missions 
        WHERE user_id = ? AND is_completed = 1
      `).bind(user.id).first(),
    ]);

    const skillRows = Array.isArray(skills.results)
      ? (skills.results as Array<{ name?: unknown; total_reps?: unknown; best_reps?: unknown }>)
        .map((skill) => ({
          name: typeof skill.name === "string" && skill.name.trim().length > 0 ? skill.name.trim() : "Skill sem nome",
          total_reps: toRoundedNumber(skill.total_reps),
          best_reps: toRoundedNumber(skill.best_reps),
        }))
      : [];

    const userStats = {
      level: toRoundedNumber(progression?.level),
      total_missions: toRoundedNumber(completedMissions?.count),
      streak: toRoundedNumber(progression?.current_streak),
    };

    const fallbackRecommendations = buildFallbackRecommendations({
      level: userStats.level,
      streak: userStats.streak,
      goal: typeof profile?.main_goal === "string" ? profile.main_goal : null,
      attributes: {
        strength: toRoundedNumber(attributes?.strength),
        constitution: toRoundedNumber(attributes?.constitution),
        vitality: toRoundedNumber(attributes?.vitality),
        dexterity: toRoundedNumber(attributes?.dexterity),
        focus: toRoundedNumber(attributes?.focus),
      },
      skills: skillRows,
    });

    const prompt = `Analise este perfil fitness gamificado e gere recomendações personalizadas em JSON.
Nível: ${progression?.level}
XP: ${progression?.xp}
Missões completas: ${completedMissions?.count}
Streak: ${progression?.current_streak}
Objetivo: ${profile?.main_goal}
Atributos: força ${attributes?.strength}, constituição ${attributes?.constitution}, vitalidade ${attributes?.vitality}, destreza ${attributes?.dexterity}, foco ${attributes?.focus}
Skills: ${skillRows.slice(0, 5).map((skill) => `${skill.name}:${skill.total_reps}`).join(",")}`;

    if (!getOpenRouterApiKey(c.env)) {
      return c.json({
        success: true,
        recommendations: fallbackRecommendations,
        user_stats: userStats,
        degraded: true,
        source: "fallback",
      });
    }

    let recommendations = fallbackRecommendations;
    let degraded = false;

    try {
      const openaiData = await callOpenAIChatWithFallback(c, [{ role: "user", content: prompt }], 1000, true);
      const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "{}";
      recommendations = mergeRecommendationsWithFallback(
        parseJsonObjectFromModelContent<Record<string, unknown>>(content) ?? {},
        fallbackRecommendations,
      );
    } catch (error) {
      degraded = true;
      console.error("[/api/ai/recommendations][upstream]", {
        userId: user.id,
        message: getErrorMessage(error),
      });
    }

    return c.json({
      success: true,
      recommendations,
      user_stats: userStats,
      degraded,
      source: degraded ? "fallback" : "ai",
    });
  } catch (error) {
    console.error("[/api/ai/recommendations]", {
      userId: user.id,
      message: getErrorMessage(error),
    });
    return c.json({
      success: true,
      recommendations: buildFallbackRecommendations({
        level: 1,
        streak: 0,
        goal: null,
        attributes: {
          strength: 0,
          constitution: 0,
          vitality: 0,
          dexterity: 0,
          focus: 0,
        },
        skills: [],
      }),
      user_stats: {
        level: 1,
        total_missions: 0,
        streak: 0,
      },
      degraded: true,
      source: "fallback",
    });
  }
});

// Gera sugestões rápidas de treino com base no estado recente do usuário.
app.get("/api/ai/workout-suggestions", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const [profile, progression, metrics] = await Promise.all([
      c.env.fitloot_db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM user_progression WHERE user_id = ?").bind(user.id).first(),
      c.env.fitloot_db.prepare("SELECT * FROM daily_metrics WHERE user_id = ? ORDER BY date DESC LIMIT 1").bind(user.id).first(),
    ]);

    const prompt = `Sugira treino em JSON com workout_type, duration_minutes, intensity, exercises e motivation. Contexto: nível ${progression?.level}, objetivo ${profile?.main_goal}, passos ${metrics?.steps || 0}, calorias ${metrics?.calories_burned || 0}.`;

    const openaiData = await callOpenAIChatWithFallback(c, [{ role: "user", content: prompt }], 900, true);
    const content = safeGet(openaiData.choices ?? [], 0)?.message?.content ?? "{}";
    const workout = parseJsonObjectFromModelContent<Record<string, unknown>>(content) ?? {};

    return c.json({
      success: true,
      workout,
    });
  } catch (error) {
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});

type IdentifiedFoodItem = {
  food_name: string;
  portion_description?: string | undefined;
  portion_multiplier?: number | undefined;
};

function isIdentifiedFoodItem(item: unknown): item is IdentifiedFoodItem {
  if (!item || typeof item !== "object") return false;
  const value = item as { food_name?: unknown };
  return typeof value.food_name === "string" && value.food_name.trim().length > 0;
}

// Pede ao modelo visual uma lista simples de alimentos visíveis na foto.
async function identifyFoodItemsFromImage(
  c: import("hono").Context<AppContext>,
  params: {
    imageBase64: string;
    imageMimeType?: string | undefined;
    foodDescription?: string | undefined;
    ocrText?: string | undefined;
  },
): Promise<{ items: IdentifiedFoodItem[]; foodDescription?: string | undefined }> {
  const apiKey = getOpenRouterApiKey(c.env);
  if (!apiKey) {
    throw new ApiIntegrationError("SERVICE_NOT_CONFIGURED", 503, "OpenRouter não configurado.");
  }

  const normalizedImageBase64 = params.imageBase64.trim();
  if (normalizedImageBase64.length === 0) {
    return { items: [], foodDescription: params.foodDescription };
  }

  const prompt = [
    "Analise a foto de uma refeição e responda APENAS JSON com o formato {\"food_description\":\"\",\"items\":[{\"food_name\":\"\",\"portion_description\":\"\",\"portion_multiplier\":1}]}.",
    "Liste somente alimentos visivelmente presentes.",
    "Use nomes simples e porções curtas, como porção média, 1 unidade, 1 concha ou 1 colher.",
    params.foodDescription ? `Contexto textual informado pelo app: ${params.foodDescription}` : "",
    params.ocrText ? `Texto OCR disponível: ${params.ocrText}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  const content = await requestOpenRouterVisionStructuredContent(
    apiKey,
    c.env,
    getOpenRouterVisionModel(c.env),
    prompt,
    `data:${params.imageMimeType?.trim() || "image/jpeg"};base64,${normalizedImageBase64}`,
    700,
    timeoutMsByService.openrouter,
  );

  const parsed = (parseJsonObjectFromModelContent(content) ?? {}) as {
    items?: unknown[];
    food_description?: unknown;
  };

  const items = Array.isArray(parsed.items) ? parsed.items.filter(isIdentifiedFoodItem) : [];
  const foodDescription = typeof parsed.food_description === "string" && parsed.food_description.trim().length > 0
    ? parsed.food_description.trim()
    : params.foodDescription;

  return {
    items,
    foodDescription,
  };
}

// Orquestra a análise alimentar com visão, OCR e fallbacks nutricionais.
app.post("/api/ai/analyze-food", authMiddleware, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const raw = await c.req.json();
    const parsed = AiAnalyzeFoodRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
    }

    const { food_description, identified_items = [], image_base64, image_mime_type, ocr_text } = parsed.data;
    let items: IdentifiedFoodItem[] = identified_items.filter(isIdentifiedFoodItem);
    let resolvedFoodDescription = typeof food_description === "string" && food_description.trim().length > 0
      ? food_description.trim()
      : undefined;

    if (items.length === 0 && image_base64) {
      try {
        const imageIdentification = await identifyFoodItemsFromImage(c, {
          imageBase64: image_base64,
          imageMimeType: image_mime_type,
          foodDescription: resolvedFoodDescription,
          ocrText: ocr_text,
        });
        if (imageIdentification.items.length > 0) {
          items = imageIdentification.items;
        }
        if (imageIdentification.foodDescription) {
          resolvedFoodDescription = imageIdentification.foodDescription;
        }
      } catch (imageError) {
        console.warn("[analyze-food][vision-fallback]", {
          message: getErrorMessage(imageError),
        });
      }
    }

    if (items.length === 0 && resolvedFoodDescription) {
      const identifyPrompt = `Analise a refeição e responda APENAS em JSON no formato {"items":[{"food_name":"","portion_description":"","portion_multiplier":1}]}.
Contexto textual: ${resolvedFoodDescription || "não informado"}
Texto OCR do rótulo: ${ocr_text || "não identificado"}.`;
      const aiData = await callOpenAIChatWithFallback(c, [{ role: "user", content: identifyPrompt }], 700, true);
      const aiContent = safeGet(aiData.choices ?? [], 0)?.message?.content ?? "{}";
      const identified = (parseJsonObjectFromModelContent(aiContent) ?? {}) as {
        items?: Array<{ food_name?: string | undefined; portion_description?: string | undefined; portion_multiplier?: number | undefined }>;
      };
      items = (identified.items ?? []).filter(isIdentifiedFoodItem);
    }

    const ocrNutrition = parseNutritionFromOcrLabel(ocr_text ?? "");

    if (items.length === 0 && !ocrNutrition) {
      throw new ApiIntegrationError("INVALID_RESPONSE", 422, "Não foi possível identificar alimentos na imagem. Tente novamente com outra foto.");
    }

    const analyzedItems: Array<{
      food_name: string;
      portion_description: string;
      calories: number | null;
      protein: number | null;
      carbs: number | null;
      fats: number | null;
      energy_kj: number | null;
      source: "usda" | "rapidapi" | "estimate" | "ocr_label";
      warning?: string | undefined;
    }> = [];

    for (const item of items) {
      const query = assertString(item.food_name).trim();
      if (!query) {
        continue;
      }
      const multiplier = Number(item.portion_multiplier ?? 1);

      try {
        const usda = await searchFoodOnUSDA(c, query);
        const first = safeGet(usda.foods ?? [], 0);
        if (!first) throw new Error("not-found");
        const nutrients = first.foodNutrients ?? [];
        const byName = (name: string) => nutrients.find((n) => n.nutrientName?.toLowerCase() === name.toLowerCase())?.value ?? null;

        const calories = byName("Energy");
        const protein = byName("Protein");
        const carbs = byName("Carbohydrate, by difference");
        const fats = byName("Total lipid (fat)");

        analyzedItems.push({
          food_name: query,
          portion_description: item.portion_description || "porção estimada",
          calories: calories !== null ? Math.round(calories * multiplier) : null,
          energy_kj: calories !== null ? Math.round(calories * 4.184 * multiplier) : null,
          protein: protein !== null ? Number((protein * multiplier).toFixed(1)) : null,
          carbs: carbs !== null ? Number((carbs * multiplier).toFixed(1)) : null,
          fats: fats !== null ? Number((fats * multiplier).toFixed(1)) : null,
          source: "usda",
        });
      } catch (itemError) {
        console.warn(`[analyze-food][usda-fallback] ${query}`, itemError);
        try {
          const rapidResult = await searchFoodOnRapidApi(c, query);
          const firstRapid = safeGet(rapidResult ?? [], 0);
          if (!firstRapid) {
            throw new Error("rapidapi-not-found");
          }

          const rapidCalories = Number(firstRapid.calories ?? 0);
          const rapidProtein = Number(firstRapid.protein_g ?? 0);
          const rapidCarbs = Number(firstRapid.carbohydrates_total_g ?? 0);
          const rapidFats = Number(firstRapid.fat_total_g ?? 0);

          analyzedItems.push({
            food_name: query,
            portion_description: item.portion_description || "porção estimada",
            calories: Number.isFinite(rapidCalories) ? Math.round(rapidCalories * multiplier) : null,
            energy_kj: Number.isFinite(rapidCalories) ? Math.round(rapidCalories * 4.184 * multiplier) : null,
            protein: Number.isFinite(rapidProtein) ? Number((rapidProtein * multiplier).toFixed(1)) : null,
            carbs: Number.isFinite(rapidCarbs) ? Number((rapidCarbs * multiplier).toFixed(1)) : null,
            fats: Number.isFinite(rapidFats) ? Number((rapidFats * multiplier).toFixed(1)) : null,
            source: "rapidapi",
            warning: "Alimento não encontrado no USDA. Valores retornados pela RapidAPI.",
          });
        } catch (rapidError) {
          console.warn(`[analyze-food][rapidapi-fallback] ${query}`, rapidError);
          const estimatePrompt = `Estime APENAS JSON com calories, protein, carbs, fats para ${query} (${item.portion_description || "porção média"}).`;
          const fallbackData = await callOpenAIChatWithFallback(c, [{ role: "user", content: estimatePrompt }], 350, true);
          const estimate = (parseJsonObjectFromModelContent(
            safeGet(fallbackData.choices ?? [], 0)?.message?.content ?? "{}",
          ) ?? {}) as {
            calories?: number | undefined;
            protein?: number | undefined;
            carbs?: number | undefined;
            fats?: number | undefined;
          };

          analyzedItems.push({
            food_name: query,
            portion_description: item.portion_description || "porção estimada",
            calories: estimate.calories ?? null,
            energy_kj: estimate.calories ? Math.round(estimate.calories * 4.184) : null,
            protein: estimate.protein ?? null,
            carbs: estimate.carbs ?? null,
            fats: estimate.fats ?? null,
            source: "estimate",
            warning: "Alimento não encontrado no USDA/RapidAPI. Valores estimados por IA.",
          });
        }
      }
    }

    if (ocrNutrition) {
      analyzedItems.push({
        food_name: "Rótulo identificado",
        portion_description: "dados extraídos do rótulo",
        calories: ocrNutrition.calories,
        energy_kj: ocrNutrition.energy_kj,
        protein: ocrNutrition.protein,
        carbs: ocrNutrition.carbs,
        fats: ocrNutrition.fats,
        source: "ocr_label",
      });
    }

    const totals = analyzedItems.reduce(
      (acc, item) => {
        acc.calories += item.calories ?? 0;
        acc.energy_kj += item.energy_kj ?? 0;
        acc.protein += item.protein ?? 0;
        acc.carbs += item.carbs ?? 0;
        acc.fats += item.fats ?? 0;
        return acc;
      },
      { calories: 0, energy_kj: 0, protein: 0, carbs: 0, fats: 0 }
    );

    const percentages = calculateMacroEnergyPercentages(totals);

    return c.json({
      success: true,
      ocr_text: ocr_text || undefined,
      food_description: resolvedFoodDescription,
      items: analyzedItems,
      totals: {
        calories: Math.round(totals.calories),
        energy_kj: Math.round(totals.energy_kj),
        protein: Number(totals.protein.toFixed(1)),
        carbs: Number(totals.carbs.toFixed(1)),
        fats: Number(totals.fats.toFixed(1)),
        macro_percentages: percentages,
      },
      has_estimates: analyzedItems.some((item) => item.source !== "usda"),
      estimation_warning: analyzedItems.some((item) => item.source === "estimate")
        ? "Alguns alimentos não foram encontrados no USDA/RapidAPI e foram estimados por IA."
        : undefined,
    });
  } catch (error) {
    console.error("[analyze-food]", error);
    const friendly = toFriendlyErrorResponse(error);
    return c.json(friendly.payload, toStatusCode(friendly.status));
  }
});
}
