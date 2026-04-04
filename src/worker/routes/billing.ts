import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  CheckoutStartRequestSchema,
  PromoCodeRequestSchema,
} from "../../shared/types";
import { resolveWebhookSecret } from "../services/cakto";
import {
  databaseNotInitializedResponse,
  hasCoreSchema,
} from "../core/database";
import {
  getErrorMessage,
  isInvalidPromoCodeError,
  isMissingSchemaError,
  schemaMismatchResponse,
} from "../core/errors";
import type {
  AppContext,
  CheckoutPaymentMethod,
  CheckoutStartResult,
  Env,
  PlanId,
  PlanStatus,
  PromoApplyResult,
  PromoValidationSuccess,
  PublicPlanId,
  SubscriptionRecord,
  UserAuthRecord,
  UserPaymentMethod,
} from "../core/types";
import type { WithTransaction } from "./contracts";

type BillingRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  applyPromoCodeForUser: (
    db: D1Database,
    env: Env,
    params: {
      userId: string;
      code: string;
      markOnboardingCompleted: boolean;
    },
  ) => Promise<PromoApplyResult | null>;
  getLatestSubscriptionByUser: (
    db: D1Database,
    userId: string,
  ) => Promise<SubscriptionRecord | null>;
  getUserAuthRecordById: (
    db: D1Database,
    userId: string,
  ) => Promise<UserAuthRecord | null>;
  hasPlanAccess: (planId: PlanId, planStatus: PlanStatus) => boolean;
  matchesVipActivationCode: (env: Env, code: string) => boolean;
  normalizePlanStatus: (value: string | null | undefined) => PlanStatus;
  normalizePromoCodeValue: (value: string | null | undefined) => string;
  normalizePublicPlanIdFromValue: (
    value: string | null | undefined,
  ) => PublicPlanId | null;
  normalizeUserPaymentMethod: (
    value: string | null | undefined,
  ) => UserPaymentMethod;
  processCaktoWebhook: (
    c: import("hono").Context<AppContext>,
    rawBody: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  reconcilePendingSubscriptionForUser: (
    db: D1Database,
    env: Env,
    params: {
      userId: string;
      customerEmail?: string | null;
      latestSubscription?: SubscriptionRecord | null;
    },
  ) => Promise<void>;
  resolveCheckoutAmount: (planId: PublicPlanId) => number;
  resolveCheckoutProductId: (planId: PublicPlanId) => string;
  resolveCheckoutUrl: (planId: PublicPlanId) => string;
  startCheckoutForUser: (
    db: D1Database,
    env: Env,
    params: {
      userId: string;
      planId: PublicPlanId;
      paymentMethod: CheckoutPaymentMethod;
      cardNumber?: string | undefined;
      cardHolderName?: string | undefined;
      cardExpiry?: string | undefined;
      promoCode?: string | undefined;
      markOnboardingCompleted: boolean;
    },
  ) => Promise<CheckoutStartResult>;
  validatePromoCodeRecord: (
    db: D1Database,
    code: string,
  ) => Promise<PromoValidationSuccess | null>;
  withTransaction: WithTransaction;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTransientDatabaseError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("query read timeout") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("read etimedout") ||
    message.includes("socket hang up") ||
    message.includes("connection terminated")
  );
}

async function runWithTransientRetry<T>(
  task: () => Promise<T>,
  maxAttempts = 2,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 160 * attempt);
      });
    }
  }

  throw new Error("TRANSIENT_RETRY_EXHAUSTED");
}

const PENDING_RECONCILE_COOLDOWN_MS = 30_000;
const pendingReconcileState = new Map<
  string,
  { lastAttemptAt: number; inflight: Promise<void> | null }
>();

function schedulePendingSubscriptionReconcile(
  c: import("hono").Context<AppContext>,
  deps: Pick<
    BillingRouteDeps,
    "reconcilePendingSubscriptionForUser"
  >,
  params: {
    userId: string;
    customerEmail?: string | null;
    latestSubscription?: SubscriptionRecord | null;
  },
): void {
  const now = Date.now();
  const existing =
    pendingReconcileState.get(params.userId) ?? {
      lastAttemptAt: 0,
      inflight: null,
    };

  if (existing.inflight) return;
  if (now - existing.lastAttemptAt < PENDING_RECONCILE_COOLDOWN_MS) return;

  const run = deps
    .reconcilePendingSubscriptionForUser(c.env.fitloot_db, c.env, params)
    .catch((error) => {
      if (isTransientDatabaseError(error)) {
        console.warn("[subscription-status][cakto-reconcile-transient]", {
          userId: params.userId,
          message: getErrorMessage(error),
        });
        return;
      }
      console.error("[subscription-status][cakto-reconcile]", {
        userId: params.userId,
        message: getErrorMessage(error),
      });
    })
    .finally(() => {
      const current = pendingReconcileState.get(params.userId);
      if (!current) return;
      pendingReconcileState.set(params.userId, {
        lastAttemptAt: current.lastAttemptAt,
        inflight: null,
      });
    });

  pendingReconcileState.set(params.userId, {
    lastAttemptAt: now,
    inflight: run,
  });
  c.executionCtx.waitUntil(run);
}

async function hasOnboardingCheckoutState(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const [
    profile,
    attributes,
    progression,
    trainingPlan,
  ] = await Promise.all([
    db.prepare("SELECT user_id FROM user_profiles WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first<{ user_id: string | null }>(),
    db.prepare("SELECT user_id FROM user_attributes WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first<{ user_id: string | null }>(),
    db.prepare("SELECT user_id FROM user_progression WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first<{ user_id: string | null }>(),
    db.prepare("SELECT user_id FROM user_training_plans WHERE user_id = ? LIMIT 1")
      .bind(userId)
      .first<{ user_id: string | null }>(),
  ]);

  return Boolean(
    profile?.user_id &&
      attributes?.user_id &&
      progression?.user_id &&
      trainingPlan?.user_id,
  );
}

// Registra as rotas de promo, checkout, assinatura e webhooks de pagamento.
export function registerBillingRoutes(
  app: Hono<AppContext>,
  {
    authMiddleware,
    applyPromoCodeForUser,
    getLatestSubscriptionByUser,
    getUserAuthRecordById,
    hasPlanAccess,
    matchesVipActivationCode,
    normalizePlanStatus,
    normalizePromoCodeValue,
    normalizePublicPlanIdFromValue,
    normalizeUserPaymentMethod,
    processCaktoWebhook,
    reconcilePendingSubscriptionForUser,
    resolveCheckoutAmount,
    resolveCheckoutProductId,
    resolveCheckoutUrl,
    startCheckoutForUser,
    validatePromoCodeRecord,
    withTransaction,
  }: BillingRouteDeps,
): void {
  // Valida um cupom sem consumi-lo, para o frontend antecipar a resposta do checkout.
  app.post(
    "/api/promo/validate",
    zValidator("json", PromoCodeRequestSchema),
    async (c) => {
      const schemaReady = await hasCoreSchema(c.env.fitloot_db);
      if (!schemaReady) {
        return databaseNotInitializedResponse(c);
      }

      try {
        const data = c.req.valid("json");
        const promoValidation = await validatePromoCodeRecord(
          c.env.fitloot_db,
          data.code,
        );

        if (!promoValidation) {
          return c.json(
            { valid: false, message: "Código inválido ou expirado" },
            200,
          );
        }

        if (
          promoValidation.effect === "activate_vip" &&
          !matchesVipActivationCode(
            c.env,
            normalizePromoCodeValue(data.code),
          )
        ) {
          return c.json(
            { valid: false, message: "Código inválido ou expirado" },
            200,
          );
        }

        return c.json({
          valid: true,
          description: promoValidation.description,
          effect: promoValidation.effect,
          effect_value: promoValidation.effectValue,
        });
      } catch (error) {
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }
        if (isTransientDatabaseError(error)) {
          return c.json(
            {
              error:
                "Servico temporariamente indisponivel para iniciar o checkout.",
              code: "CHECKOUT_TRANSIENT_DB_ERROR",
            },
            503,
          );
        }

        throw error;
      }
    },
  );

  // Aplica o cupom autenticado e devolve o usuário já atualizado.
  app.post(
    "/api/promo/apply",
    authMiddleware,
    zValidator("json", PromoCodeRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      try {
        const data = c.req.valid("json");
        const onboardingReady = await runWithTransientRetry(() =>
          hasOnboardingCheckoutState(c.env.fitloot_db, user.id),
        );

        if (!onboardingReady) {
          return c.json(
            {
              error:
                "Seu onboarding ainda nao foi persistido por completo. Refaça a etapa de criacao da conta antes de ativar o acesso.",
              code: "ONBOARDING_STATE_INCOMPLETE",
            },
            409,
          );
        }

        const appliedPromo = await withTransaction(
          c.env.fitloot_db,
          async () =>
            applyPromoCodeForUser(c.env.fitloot_db, c.env, {
              userId: user.id,
              code: data.code,
              markOnboardingCompleted: Number(user.onboarding_completed) === 1,
            }),
          c.env,
        );

        if (!appliedPromo) {
          return c.json(
            { valid: false, message: "Código inválido ou expirado" },
            400,
          );
        }

        const refreshedUser = await getUserAuthRecordById(
          c.env.fitloot_db,
          user.id,
        );
        return c.json({
          success: true,
          valid: true,
          ...appliedPromo,
          user: refreshedUser,
        });
      } catch (error) {
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }

        throw error;
      }
    },
  );

  // Inicia o checkout persistindo a tentativa com o método de pagamento escolhido.
  app.post(
    "/api/checkout/start",
    authMiddleware,
    zValidator("json", CheckoutStartRequestSchema),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);

      try {
        const data = c.req.valid("json");
        const onboardingReady = await hasOnboardingCheckoutState(
          c.env.fitloot_db,
          user.id,
        );

        if (!onboardingReady) {
          return c.json(
            {
              error:
                "Seu onboarding ainda nao foi persistido por completo. Refaça a etapa de criacao da conta antes de ativar o acesso.",
              code: "ONBOARDING_STATE_INCOMPLETE",
            },
            409,
          );
        }

        const checkoutResult = await withTransaction(
          c.env.fitloot_db,
          async () =>
            startCheckoutForUser(c.env.fitloot_db, c.env, {
              userId: user.id,
              planId: data.plan_id,
              paymentMethod: data.payment_method,
              cardNumber: data.card_number,
              cardHolderName: data.card_holder_name,
              cardExpiry: data.card_expiry,
              promoCode: data.promo_code,
              markOnboardingCompleted: true,
            }),
          c.env,
        );

        const refreshedUser = await getUserAuthRecordById(
          c.env.fitloot_db,
          user.id,
        );

        return c.json({
          success: true,
          ...checkoutResult,
          user: refreshedUser,
        });
      } catch (error) {
        if (isInvalidPromoCodeError(error)) {
          return c.json({ error: "Código inválido ou expirado" }, 400);
        }
        if (isMissingSchemaError(error)) {
          return schemaMismatchResponse(c);
        }

        throw error;
      }
    },
  );

  // Resume o estado efetivo da assinatura e do plano atualmente ativo.
  app.get("/api/subscription/status", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    let latestSubscription: SubscriptionRecord | null = null;
    let refreshedUser: UserAuthRecord | null = null;
    let usedTransientSnapshot = false;

    try {
      [latestSubscription, refreshedUser] = await runWithTransientRetry(
        () =>
          Promise.all([
            getLatestSubscriptionByUser(c.env.fitloot_db, user.id),
            getUserAuthRecordById(c.env.fitloot_db, user.id),
          ]),
        3,
      );
    } catch (error) {
      if (!isTransientDatabaseError(error)) {
        throw error;
      }

      usedTransientSnapshot = true;
      refreshedUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url ?? null,
        onboarding_completed: user.onboarding_completed,
        plan_id: user.plan_id,
        plan_status: user.plan_status,
        payment_method: user.payment_method,
      };
      console.warn("[subscription-status][transient-fallback]", {
        userId: user.id,
        message: getErrorMessage(error),
      });
    }

    if (!refreshedUser) {
      return c.json(
        { error: "Usuário não encontrado", code: "USER_NOT_FOUND" },
        404,
      );
    }

    if (!usedTransientSnapshot && refreshedUser.plan_status === "pending") {
      schedulePendingSubscriptionReconcile(
        c,
        { reconcilePendingSubscriptionForUser },
        {
          userId: user.id,
          customerEmail: refreshedUser.email,
          latestSubscription,
        },
      );
    }

    if (!refreshedUser) {
      return c.json(
        { error: "Usuario nao encontrado", code: "USER_NOT_FOUND" },
        404,
      );
    }

    const effectivePublicPlanId =
      normalizePublicPlanIdFromValue(latestSubscription?.plan_id ?? null) ??
      normalizePublicPlanIdFromValue(refreshedUser.plan_id);
    const currentPlanAmount = effectivePublicPlanId
      ? resolveCheckoutAmount(effectivePublicPlanId)
      : 0;
    const checkoutUrl =
      latestSubscription?.checkout_url ??
      (effectivePublicPlanId
        ? resolveCheckoutUrl(effectivePublicPlanId)
        : null);
    const productId =
      latestSubscription?.product_id ??
      (effectivePublicPlanId
        ? resolveCheckoutProductId(effectivePublicPlanId)
        : null);

    return c.json({
      plan_id: refreshedUser.plan_id,
      plan_status: refreshedUser.plan_status,
      payment_method: refreshedUser.payment_method,
      has_access:
        Number(refreshedUser.onboarding_completed) === 1 &&
        hasPlanAccess(refreshedUser.plan_id, refreshedUser.plan_status),
      amount: latestSubscription
        ? Number(latestSubscription.amount)
        : currentPlanAmount,
      checkout_url: checkoutUrl,
      product_id: productId,
      subscription: latestSubscription
        ? {
            id: latestSubscription.id,
            status: normalizePlanStatus(latestSubscription.status),
            payment_method: normalizeUserPaymentMethod(
              latestSubscription.payment_method,
            ),
            amount: Number(latestSubscription.amount),
            external_order_id: latestSubscription.external_order_id,
            external_subscription_id:
              latestSubscription.external_subscription_id,
            customer_email: latestSubscription.customer_email,
            started_at: latestSubscription.started_at,
            expires_at: latestSubscription.expires_at,
            updated_at: latestSubscription.updated_at,
          }
        : null,
    });
  });

  // Normaliza o webhook da Cakto e delega o processamento assíncrono.
  async function handleCaktoWebhookRequest(
    c: import("hono").Context<AppContext>,
  ) {
    const rawBody = await c.req.text();

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!isRecord(parsed)) {
        return c.json({ received: true, ignored: true }, 200);
      }
      payload = parsed;
    } catch {
      return c.json({ received: true, ignored: true }, 200);
    }

    const configuredSecret =
      (typeof c.env.CAKTO_WEBHOOK_SECRET === "string" &&
        c.env.CAKTO_WEBHOOK_SECRET.trim()) ||
      (typeof c.env.WEBHOOK_SECRET === "string" &&
        c.env.WEBHOOK_SECRET.trim()) ||
      "";
    const receivedSecret = resolveWebhookSecret(payload, c.req.raw.headers);

    if (configuredSecret && receivedSecret !== configuredSecret) {
      return c.json(
        {
          error: "Unauthorized",
          code: "CAKTO_WEBHOOK_SECRET_INVALID",
        },
        401,
      );
    }

    c.executionCtx.waitUntil(processCaktoWebhook(c, rawBody, payload));
    return c.json({ received: true }, 200);
  }

  app.post("/api/cakto/webhook", async (c) => handleCaktoWebhookRequest(c));
  app.post("/api/webhook/payment", async (c) =>
    handleCaktoWebhookRequest(c),
  );
}
