import type { Context } from "hono";

import {
  buildTrackedCheckoutUrl,
  fetchCaktoOrderById,
  fetchLatestCaktoOrderByCustomer,
  parseCaktoWebhookPayload,
  type CaktoOrderSnapshot,
} from "./cakto";
import {
  CAKTO_PLAN_CATALOG,
  CHECKOUT_PLAN_CATALOG,
  WEBHOOK_SUPPORTED_EVENTS,
} from "../core/constants";
import {
  createInvalidPromoCodeError,
  getErrorMessage,
} from "../core/errors";
import { purgeIncompleteOnboardingData } from "../core/database";
import type { PromoCodeEffect } from "../../shared/types";
import type {
  AppContext,
  CaktoWebhookEventStatus,
  CheckoutPaymentMethod,
  CheckoutStartResult,
  Env,
  PlanStatus,
  PromoApplyResult,
  PromoCodeRecord,
  PromoCodeUsageRecord,
  PromoValidationSuccess,
  PublicPlanId,
  SubscriptionEventLogEntry,
  SubscriptionMetadata,
  SubscriptionRecord,
  UserPaymentMethod,
} from "../core/types";
import {
  getUserAuthRecordById,
  hasPlanAccess,
  isPublicPlanId,
  normalizePlanId,
  normalizePlanStatus,
  normalizeUserPaymentMethod,
  updateUserPlanState,
} from "./userPlanAccess";

const encoder = new TextEncoder();

// Centralizes the full subscription lifecycle: promo codes, checkout bootstrap, and webhook reconciliation.
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  return null;
}

function isPromoCodeEffect(value: string): value is PromoCodeEffect {
  return (
    value === "activate_vip" ||
    value === "discount_percent" ||
    value === "discount_fixed" ||
    value === "free_months" ||
    value === "unlock_feature"
  );
}

export function normalizePromoCodeValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

// Promo-code helpers normalize raw records and availability before any subscription mutation runs.
function parsePromoCodeExpiryTimestamp(value: string | null): number | null {
  if (!value) return null;
  const normalizedValue = /[zZ]|[+-]\d{2}:\d{2}$/.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalizedValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPromoCodeCurrentlyAvailable(record: PromoCodeRecord): boolean {
  if (Number(record.active) !== 1) {
    return false;
  }

  const expiresAt = parsePromoCodeExpiryTimestamp(record.expires_at);
  if (record.expires_at && expiresAt !== null && expiresAt <= Date.now()) {
    return false;
  }

  if (record.expires_at && expiresAt === null) {
    return false;
  }

  return record.max_uses === null || Number(record.uses_count) < Number(record.max_uses);
}

function toPromoValidationSuccess(record: PromoCodeRecord): PromoValidationSuccess | null {
  const effect = record.effect;
  if (!isPromoCodeEffect(effect)) {
    return null;
  }

  return {
    promoCodeId: Number(record.id),
    code: record.code,
    description: record.description,
    effect,
    effectValue: record.effect_value,
  };
}

export function matchesVipActivationCode(env: Env, code: string): boolean {
  const configuredCode = normalizePromoCodeValue(env.VIP_ACTIVATION_CODE);
  if (!configuredCode) return true;
  return configuredCode.toUpperCase() === code.toUpperCase();
}

async function getPromoCodeByCode(db: D1Database, code: string): Promise<PromoCodeRecord | null> {
  return db
    .prepare(
      `SELECT
        id,
        code,
        description,
        effect,
        effect_value,
        max_uses,
        uses_count,
        active,
        expires_at,
        created_at
      FROM promo_codes
      WHERE UPPER(code) = UPPER(?)
      LIMIT 1`
    )
    .bind(code)
    .first<PromoCodeRecord>();
}

export async function validatePromoCodeRecord(db: D1Database, code: string): Promise<PromoValidationSuccess | null> {
  const normalizedCode = normalizePromoCodeValue(code);
  if (!normalizedCode) return null;

  const promoCodeRecord = await getPromoCodeByCode(db, normalizedCode);
  if (!promoCodeRecord || !isPromoCodeCurrentlyAvailable(promoCodeRecord)) {
    return null;
  }

  return toPromoValidationSuccess(promoCodeRecord);
}

async function getPromoCodeUsageByUser(
  db: D1Database,
  promoCodeId: number,
  userId: string,
): Promise<PromoCodeUsageRecord | null> {
  return db
    .prepare(
      `SELECT
        id,
        promo_code_id,
        user_id,
        subscription_id,
        applied_effect,
        applied_value,
        created_at,
        updated_at
      FROM promo_code_usages
      WHERE promo_code_id = ? AND user_id = ?
      LIMIT 1`
    )
    .bind(promoCodeId, userId)
    .first<PromoCodeUsageRecord>();
}

async function incrementPromoCodeUsesCount(db: D1Database, promoCodeId: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE promo_codes
      SET uses_count = uses_count + 1
      WHERE id = ?
        AND active = 1
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
        AND (max_uses IS NULL OR uses_count < max_uses)`
  ).bind(promoCodeId).run();

  return Number(result.meta.changes ?? 0) > 0;
}

async function createPromoCodeUsage(
  db: D1Database,
  params: {
    promoCodeId: number;
    userId: string;
    effect: PromoCodeEffect;
    effectValue: string | null;
    subscriptionId?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO promo_code_usages (
      promo_code_id,
      user_id,
      subscription_id,
      applied_effect,
      applied_value,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(
    params.promoCodeId,
    params.userId,
    params.subscriptionId ?? null,
    params.effect,
    params.effectValue,
  ).run();
}

async function attachPromoCodeUsageToSubscription(
  db: D1Database,
  promoCodeId: number,
  userId: string,
  subscriptionId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE promo_code_usages
      SET subscription_id = COALESCE(subscription_id, ?),
          updated_at = datetime('now')
      WHERE promo_code_id = ? AND user_id = ?`
  ).bind(subscriptionId, promoCodeId, userId).run();
}

export async function applyPromoCodeForUser(
  db: D1Database,
  env: Env,
  params: {
    userId: string;
    code: string;
    markOnboardingCompleted?: boolean;
  },
): Promise<PromoApplyResult | null> {
  const normalizedCode = normalizePromoCodeValue(params.code);
  if (!normalizedCode) {
    return null;
  }

  const promoValidation = await validatePromoCodeRecord(db, normalizedCode);
  if (!promoValidation) {
    return null;
  }

  if (promoValidation.effect === "activate_vip" && !matchesVipActivationCode(env, normalizedCode)) {
    return null;
  }

  const existingUsage = await getPromoCodeUsageByUser(db, promoValidation.promoCodeId, params.userId);
  const alreadyUsed = Boolean(existingUsage);

  if (!alreadyUsed) {
    const incremented = await incrementPromoCodeUsesCount(db, promoValidation.promoCodeId);
    if (!incremented) {
      return null;
    }

    await createPromoCodeUsage(db, {
      promoCodeId: promoValidation.promoCodeId,
      userId: params.userId,
      effect: promoValidation.effect,
      effectValue: promoValidation.effectValue,
    });
  }

  if (promoValidation.effect === "activate_vip") {
    const existingVipSubscription =
      alreadyUsed && existingUsage?.subscription_id
        ? await getSubscriptionById(db, existingUsage.subscription_id)
        : null;
    const vipSubscription = existingVipSubscription ?? await ensureSubscriptionRecord(db, {
      id: crypto.randomUUID(),
      userId: params.userId,
      planId: "vip",
      status: "active",
      paymentMethod: "card",
      amount: 0,
      eventType: alreadyUsed ? "vip.activated.reused" : "vip.activated",
      source: "checkout",
      metadata: {
        promo_code: promoValidation.code,
        promo_description: promoValidation.description,
        promo_effect: promoValidation.effect,
        promo_effect_value: promoValidation.effectValue ?? undefined,
      },
    });

    if (!vipSubscription) {
      throw new Error("Failed to activate VIP promo code.");
    }

    if (!existingVipSubscription || !existingUsage?.subscription_id) {
      await attachPromoCodeUsageToSubscription(db, promoValidation.promoCodeId, params.userId, vipSubscription.id);
    }
    await updateUserPlanState(db, params.userId, {
      planId: "vip",
      status: "active",
      paymentMethod: "card",
      markOnboardingCompleted: true,
    });

    return {
      applied: true,
      already_used: alreadyUsed,
      promo_code_id: promoValidation.promoCodeId,
      code: promoValidation.code,
      description: promoValidation.description,
      effect: promoValidation.effect,
      effect_value: promoValidation.effectValue,
      vip_activated: true,
      message: "Plano VIP ativado com sucesso.",
      subscription_id: vipSubscription.id,
      plan_id: "vip",
      plan_status: "active",
      payment_method: "card",
    };
  }

  return {
    applied: true,
    already_used: alreadyUsed,
    promo_code_id: promoValidation.promoCodeId,
    code: promoValidation.code,
    description: promoValidation.description,
    effect: promoValidation.effect,
    effect_value: promoValidation.effectValue,
    vip_activated: false,
    message: "Código promocional aplicado ao checkout.",
  };
}

// Serialization helpers preserve structured event and metadata state inside subscription rows.

function parseSubscriptionEventLog(raw: string | null): SubscriptionEventLogEntry[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry) => isRecord(entry))
      .map((entry) => {
        const type = typeof entry.type === "string" ? entry.type : "unknown";
        const source = entry.source === "webhook" ? "webhook" : "checkout";
        const status = normalizePlanStatus(typeof entry.status === "string" ? entry.status : "pending");
        const receivedAt = typeof entry.received_at === "string" ? entry.received_at : new Date().toISOString();
        return {
          type,
          source,
          status,
          received_at: receivedAt,
        } satisfies SubscriptionEventLogEntry;
      });
  } catch {
    return [];
  }
}

function serializeSubscriptionEventLog(entries: SubscriptionEventLogEntry[]): string {
  return JSON.stringify(entries.slice(-100));
}

function parseSubscriptionMetadata(raw: string | null): SubscriptionMetadata {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const metadata: SubscriptionMetadata = {};
    if (typeof parsed.customer_name === "string") metadata.customer_name = parsed.customer_name;
    if (typeof parsed.external_status === "string") metadata.external_status = parsed.external_status;
    if (typeof parsed.failure_reason === "string") metadata.failure_reason = parsed.failure_reason;
    if (typeof parsed.last_event_id === "string") metadata.last_event_id = parsed.last_event_id;
    if (typeof parsed.last_event_type === "string") metadata.last_event_type = parsed.last_event_type;
    if (typeof parsed.checkout_tracking_id === "string") metadata.checkout_tracking_id = parsed.checkout_tracking_id;
    if (typeof parsed.checkout_tracking_user_id === "string") metadata.checkout_tracking_user_id = parsed.checkout_tracking_user_id;
    if (typeof parsed.checkout_tracking_plan_id === "string" && isPublicPlanId(parsed.checkout_tracking_plan_id)) {
      metadata.checkout_tracking_plan_id = parsed.checkout_tracking_plan_id;
    }
    if (typeof parsed.promo_code === "string") metadata.promo_code = parsed.promo_code;
    if (typeof parsed.promo_description === "string") metadata.promo_description = parsed.promo_description;
    const promoEffect = parsed.promo_effect;
    if (typeof promoEffect === "string" && isPromoCodeEffect(promoEffect)) {
      metadata.promo_effect = promoEffect;
    }
    if (typeof parsed.promo_effect_value === "string") metadata.promo_effect_value = parsed.promo_effect_value;
    return metadata;
  } catch {
    return {};
  }
}

function serializeSubscriptionMetadata(metadata: SubscriptionMetadata): string {
  return JSON.stringify(metadata);
}

const SUBSCRIPTION_SELECT_SQL = `SELECT
  id,
  user_id,
  plan_id,
  status,
  payment_method,
  amount,
  external_order_id,
  external_subscription_id,
  customer_email,
  checkout_url,
  product_id,
  started_at,
  expires_at,
  metadata_json,
  webhook_event_log,
  created_at,
  updated_at
FROM subscriptions`;

async function getSubscriptionById(db: D1Database, subscriptionId: string): Promise<SubscriptionRecord | null> {
  return db
    .prepare(`${SUBSCRIPTION_SELECT_SQL} WHERE id = ?`)
    .bind(subscriptionId)
    .first<SubscriptionRecord>();
}

async function getSubscriptionByExternalOrderId(
  db: D1Database,
  externalOrderId: string,
): Promise<SubscriptionRecord | null> {
  return db
    .prepare(`${SUBSCRIPTION_SELECT_SQL} WHERE external_order_id = ?`)
    .bind(externalOrderId)
    .first<SubscriptionRecord>();
}

export async function getLatestSubscriptionByUser(db: D1Database, userId: string): Promise<SubscriptionRecord | null> {
  return db
    .prepare(`${SUBSCRIPTION_SELECT_SQL} WHERE user_id = ? ORDER BY datetime(updated_at) DESC LIMIT 1`)
    .bind(userId)
    .first<SubscriptionRecord>();
}

async function getUserIdByEmail(db: D1Database, email: string): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const row = await db
    .prepare("SELECT id FROM users WHERE lower(email) = ? LIMIT 1")
    .bind(normalizedEmail)
    .first<{ id: string }>();

  return row?.id ?? null;
}

async function recordCaktoWebhookReceipt(
  db: D1Database,
  params: {
    eventId: string;
    eventType: string;
    externalOrderId?: string | null;
    identifiedUserId?: string | null;
    customerEmail?: string | null;
    payloadJson: string;
  },
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT id FROM cakto_webhook_events WHERE id = ? LIMIT 1")
    .bind(params.eventId)
    .first<{ id: string }>();
  if (existing?.id) {
    return false;
  }

  await db.prepare(
    `INSERT INTO cakto_webhook_events (
      id,
      event_type,
      external_order_id,
      identified_user_id,
      customer_email,
      status,
      payload_json,
      received_at
    ) VALUES (?, ?, ?, ?, ?, 'received', ?, datetime('now'))`
  ).bind(
    params.eventId,
    params.eventType,
    params.externalOrderId ?? null,
    params.identifiedUserId ?? null,
    params.customerEmail ?? null,
    params.payloadJson,
  ).run();

  return true;
}

async function updateCaktoWebhookEventStatus(
  db: D1Database,
  eventId: string,
  params: {
    status: CaktoWebhookEventStatus;
    externalOrderId?: string | null;
    identifiedUserId?: string | null;
    customerEmail?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `UPDATE cakto_webhook_events
      SET status = ?,
          external_order_id = COALESCE(?, external_order_id),
          identified_user_id = COALESCE(?, identified_user_id),
          customer_email = COALESCE(?, customer_email),
          error_message = ?,
          processed_at = CASE WHEN ? IN ('processed', 'ignored', 'failed') THEN datetime('now') ELSE processed_at END
      WHERE id = ?`
  ).bind(
    params.status,
    params.externalOrderId ?? null,
    params.identifiedUserId ?? null,
    params.customerEmail ?? null,
    params.errorMessage ?? null,
    params.status,
    eventId,
  ).run();
}

async function ensureSubscriptionRecord(
  db: D1Database,
  params: {
    id?: string | null;
    externalOrderId?: string | null;
    status: PlanStatus;
    eventType: string;
    source: "checkout" | "webhook";
    userId?: string | null;
    planId?: string | null;
    paymentMethod?: string | null;
    amount?: number | null;
    externalSubscriptionId?: string | null;
    customerEmail?: string | null;
    checkoutUrl?: string | null;
    productId?: string | null;
    startedAt?: string | null;
    expiresAt?: string | null;
    metadata?: SubscriptionMetadata | null;
  },
): Promise<SubscriptionRecord | null> {
  const existing =
    (params.externalOrderId ? await getSubscriptionByExternalOrderId(db, params.externalOrderId) : null) ??
    (params.id ? await getSubscriptionById(db, params.id) : null);
  const recordId = existing?.id ?? params.id ?? crypto.randomUUID();
  const nextUserId = params.userId ?? existing?.user_id ?? null;
  const nextPlanId = params.planId ?? existing?.plan_id ?? null;
  const nextPaymentMethodRaw = params.paymentMethod ?? existing?.payment_method ?? null;
  const nextAmountRaw = params.amount ?? existing?.amount ?? null;
  const nextAmount = parseInteger(nextAmountRaw);
  const nextExternalOrderId = params.externalOrderId ?? existing?.external_order_id ?? null;
  const nextExternalSubscriptionId = params.externalSubscriptionId ?? existing?.external_subscription_id ?? null;
  const nextCustomerEmail = params.customerEmail ?? existing?.customer_email ?? null;
  const nextCheckoutUrl = params.checkoutUrl ?? existing?.checkout_url ?? null;
  const nextProductId = params.productId ?? existing?.product_id ?? null;
  const nextStartedAt = params.startedAt ?? existing?.started_at ?? null;
  const nextExpiresAt = params.expiresAt ?? existing?.expires_at ?? null;

  if (!nextUserId || !nextPlanId || !nextPaymentMethodRaw || nextAmount === null) {
    return null;
  }

  const nextPaymentMethod = normalizeUserPaymentMethod(nextPaymentMethodRaw);
  if (nextPaymentMethod === "none") {
    return null;
  }

  const nextStatus = normalizePlanStatus(params.status);
  const nextLog = parseSubscriptionEventLog(existing?.webhook_event_log ?? null);
  nextLog.push({
    type: params.eventType,
    source: params.source,
    status: nextStatus,
    received_at: new Date().toISOString(),
  });
  const serializedLog = serializeSubscriptionEventLog(nextLog);
  const nextMetadata: SubscriptionMetadata = {
    ...parseSubscriptionMetadata(existing?.metadata_json ?? null),
    ...(params.metadata ?? {}),
  };
  const serializedMetadata = serializeSubscriptionMetadata(nextMetadata);

  if (existing) {
    await db.prepare(
      `UPDATE subscriptions
      SET user_id = ?, plan_id = ?, status = ?, payment_method = ?, amount = ?, external_order_id = ?, external_subscription_id = ?, customer_email = ?, checkout_url = ?, product_id = ?, started_at = ?, expires_at = ?, metadata_json = ?, webhook_event_log = ?, updated_at = datetime('now')
      WHERE id = ?`
    ).bind(
      nextUserId,
      nextPlanId,
      nextStatus,
      nextPaymentMethod,
      nextAmount,
      nextExternalOrderId,
      nextExternalSubscriptionId,
      nextCustomerEmail,
      nextCheckoutUrl,
      nextProductId,
      nextStartedAt,
      nextExpiresAt,
      serializedMetadata,
      serializedLog,
      recordId,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO subscriptions (
        id, user_id, plan_id, status, payment_method, amount, external_order_id, external_subscription_id, customer_email, checkout_url, product_id, started_at, expires_at, metadata_json, webhook_event_log, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(
      recordId,
      nextUserId,
      nextPlanId,
      nextStatus,
      nextPaymentMethod,
      nextAmount,
      nextExternalOrderId,
      nextExternalSubscriptionId,
      nextCustomerEmail,
      nextCheckoutUrl,
      nextProductId,
      nextStartedAt,
      nextExpiresAt,
      serializedMetadata,
      serializedLog,
    ).run();
  }

  return getSubscriptionById(db, recordId);
}

async function syncUserPlanFromSubscription(
  db: D1Database,
  subscription: SubscriptionRecord,
  options?: {
    preserveActiveAccess?: boolean;
    keepCurrentState?: boolean;
    markOnboardingCompleted?: boolean;
  },
): Promise<void> {
  const preserveActiveAccess = options?.preserveActiveAccess === true;
  const keepCurrentState = options?.keepCurrentState === true;
  const currentUser = await getUserAuthRecordById(db, subscription.user_id);

  if (keepCurrentState && currentUser) {
    return;
  }

  const nextPlanId = normalizePlanId(subscription.plan_id);
  const nextStatus = normalizePlanStatus(subscription.status);
  const nextPaymentMethod = normalizeUserPaymentMethod(subscription.payment_method);

  if (preserveActiveAccess && currentUser && hasPlanAccess(currentUser.plan_id, currentUser.plan_status)) {
    await updateUserPlanState(db, subscription.user_id, {
      planId: currentUser.plan_id,
      status: currentUser.plan_status,
      paymentMethod: nextPaymentMethod === "none" ? currentUser.payment_method : nextPaymentMethod,
      markOnboardingCompleted: options?.markOnboardingCompleted ?? false,
    });
    return;
  }

  await updateUserPlanState(db, subscription.user_id, {
    planId: nextPlanId,
    status: nextStatus,
    paymentMethod: nextPaymentMethod,
    markOnboardingCompleted: options?.markOnboardingCompleted ?? false,
  });
}

export function resolveCheckoutAmount(planId: PublicPlanId): number {
  return CHECKOUT_PLAN_CATALOG[planId].amount;
}

export function resolveCheckoutUrl(planId: PublicPlanId): string {
  return CHECKOUT_PLAN_CATALOG[planId].checkout_url;
}

export function resolveCheckoutProductId(planId: PublicPlanId): string {
  return CHECKOUT_PLAN_CATALOG[planId].product_id;
}

// Checkout bootstrap resolves the payable offer and persists the pending subscription anchor before redirecting out.
export async function startCheckoutForUser(
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
): Promise<CheckoutStartResult> {
  const normalizedPromoCode = normalizePromoCodeValue(params.promoCode);
  const appliedPromo =
    normalizedPromoCode.length > 0
      ? await applyPromoCodeForUser(db, env, {
        userId: params.userId,
        code: normalizedPromoCode,
        markOnboardingCompleted: params.markOnboardingCompleted,
      })
      : null;

  if (normalizedPromoCode.length > 0 && !appliedPromo) {
    throw createInvalidPromoCodeError();
  }

  if (appliedPromo?.vip_activated) {
    return {
      checkout_status: "vip_active",
      plan_id: "vip",
      plan_status: "active",
      payment_method: appliedPromo.payment_method ?? "card",
      amount: 0,
      checkout_url: null,
      product_id: null,
      subscription_id: appliedPromo.subscription_id ?? crypto.randomUUID(),
      message: "Código promocional aplicado. Seu acesso VIP foi liberado.",
    };
  }

  const subscriptionId = crypto.randomUUID();
  const amount = resolveCheckoutAmount(params.planId);
  const checkoutUrl = buildTrackedCheckoutUrl(resolveCheckoutUrl(params.planId), {
    checkoutId: subscriptionId,
    userId: params.userId,
    planId: params.planId,
  });
  const productId = resolveCheckoutProductId(params.planId);
  const pendingSubscription = await ensureSubscriptionRecord(db, {
    id: subscriptionId,
    userId: params.userId,
    planId: params.planId,
    status: "pending",
    paymentMethod: params.paymentMethod,
    amount,
    eventType: "checkout.started",
    source: "checkout",
    checkoutUrl,
    productId,
    metadata: {
      checkout_tracking_id: subscriptionId,
      checkout_tracking_user_id: params.userId,
      checkout_tracking_plan_id: params.planId,
      last_event_type: "checkout.started",
      promo_code: appliedPromo?.code,
      promo_description: appliedPromo?.description,
      promo_effect: appliedPromo?.effect,
      promo_effect_value: appliedPromo?.effect_value ?? undefined,
    },
  });

  if (!pendingSubscription) {
    throw new Error("Failed to create pending checkout.");
  }

  if (appliedPromo) {
    await attachPromoCodeUsageToSubscription(db, appliedPromo.promo_code_id, params.userId, pendingSubscription.id);
  }

  await updateUserPlanState(db, params.userId, {
    planId: params.planId,
    status: "pending",
    paymentMethod: params.paymentMethod,
    markOnboardingCompleted: false,
  });

  return {
    checkout_status: "pending",
    plan_id: params.planId,
    plan_status: "pending",
    payment_method: params.paymentMethod,
    amount,
    checkout_url: checkoutUrl,
    product_id: productId,
    subscription_id: subscriptionId,
    message: "Pagamento iniciado. Aguarde a confirmação para liberar o acesso.",
  };
}

type CaktoUserSyncMode = "apply";

// Webhook helpers translate external payment events back into the local subscription and plan-access model.
function resolveCaktoSyncMode(
  eventType: string,
): { status: PlanStatus; syncMode: CaktoUserSyncMode; paymentMethod: UserPaymentMethod | null } {
  switch (eventType) {
    case "purchase_approved":
    case "subscription_created":
    case "subscription_renewed":
      return { status: "active", syncMode: "apply", paymentMethod: null };
    case "subscription_canceled":
      return { status: "cancelled", syncMode: "apply", paymentMethod: null };
    case "purchase_refused":
      return { status: "failed", syncMode: "apply", paymentMethod: null };
    case "checkout_abandonment":
      return { status: "pending", syncMode: "apply", paymentMethod: null };
    default:
      return { status: "pending", syncMode: "apply", paymentMethod: null };
  }
}

function normalizeExternalStatusLabel(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function statusIncludesAnyToken(
  status: string,
  tokens: readonly string[],
): boolean {
  return tokens.some((token) => status.includes(token));
}

function resolveCaktoEventTypeFromSnapshot(
  snapshot: CaktoOrderSnapshot,
): string | null {
  if (snapshot.eventType) return snapshot.eventType;

  const normalizedStatus = normalizeExternalStatusLabel(snapshot.externalStatus);

  if (normalizedStatus) {
    if (
      statusIncludesAnyToken(normalizedStatus, [
        "approved",
        "aprovado",
        "paid",
        "pago",
        "success",
        "succeeded",
        "completed",
        "confirmed",
        "confirmado",
        "active",
        "ativo",
      ])
    ) {
      return "purchase_approved";
    }

    if (
      statusIncludesAnyToken(normalizedStatus, [
        "refused",
        "recusado",
        "declined",
        "denied",
        "rejected",
        "failed",
        "falha",
        "error",
        "erro",
      ])
    ) {
      return "purchase_refused";
    }

    if (
      statusIncludesAnyToken(normalizedStatus, [
        "cancel",
        "cancelado",
        "cancelled",
        "canceled",
        "voided",
      ])
    ) {
      return "subscription_canceled";
    }

    if (
      statusIncludesAnyToken(normalizedStatus, [
        "expired",
        "expirado",
        "abandon",
        "abandoned",
        "abandono",
      ])
    ) {
      return "purchase_refused";
    }

    if (
      statusIncludesAnyToken(normalizedStatus, [
        "pending",
        "pendente",
        "processing",
        "processando",
        "waiting",
        "aguardando",
        "analysis",
        "analise",
      ])
    ) {
      return "checkout_abandonment";
    }
  }

  if (snapshot.failureReason) {
    return "purchase_refused";
  }

  return null;
}

export async function reconcilePendingSubscriptionForUser(
  db: D1Database,
  env: Env,
  params: {
    userId: string;
    customerEmail?: string | null;
    latestSubscription?: SubscriptionRecord | null;
  },
): Promise<void> {
  const currentUser = await getUserAuthRecordById(db, params.userId);
  if (!currentUser || currentUser.plan_status !== "pending") {
    return;
  }

  const latestSubscription =
    params.latestSubscription ?? (await getLatestSubscriptionByUser(db, params.userId));
  const fallbackCustomerEmail =
    (typeof params.customerEmail === "string" &&
      params.customerEmail.trim().length > 0
      ? params.customerEmail.trim()
      : null) ??
    latestSubscription?.customer_email ??
    currentUser.email;

  let snapshot: CaktoOrderSnapshot | null = null;

  if (latestSubscription?.external_order_id) {
    snapshot = await fetchCaktoOrderById(
      env,
      latestSubscription.external_order_id,
      CAKTO_PLAN_CATALOG,
    );
  }

  if (!snapshot && fallbackCustomerEmail) {
    snapshot = await fetchLatestCaktoOrderByCustomer(
      env,
      fallbackCustomerEmail,
      CAKTO_PLAN_CATALOG,
    );
  }

  if (!snapshot) {
    return;
  }

  const enrichedSnapshot = await enrichCaktoSnapshotFromApi(env, snapshot);
  const eventType = resolveCaktoEventTypeFromSnapshot(enrichedSnapshot);
  if (!eventType) {
    return;
  }

  const syncRule = resolveCaktoSyncMode(eventType);
  const effectivePlanId =
    enrichedSnapshot.planId ??
    (latestSubscription && isPublicPlanId(latestSubscription.plan_id)
      ? latestSubscription.plan_id
      : null);
  const effectiveAmount =
    enrichedSnapshot.amountCents ??
    (latestSubscription ? Number(latestSubscription.amount) : null) ??
    (effectivePlanId ? resolveCheckoutAmount(effectivePlanId) : null);
  const paymentMethod =
    syncRule.paymentMethod ??
    (enrichedSnapshot.paymentMethod !== "none"
      ? enrichedSnapshot.paymentMethod
      : normalizeUserPaymentMethod(latestSubscription?.payment_method));

  if (!effectivePlanId || effectiveAmount === null || paymentMethod === "none") {
    return;
  }

  const subscription = await ensureSubscriptionRecord(db, {
    id: latestSubscription?.id ?? enrichedSnapshot.tracking.checkoutId ?? null,
    externalOrderId:
      enrichedSnapshot.externalOrderId ??
      latestSubscription?.external_order_id ??
      null,
    externalSubscriptionId:
      enrichedSnapshot.externalSubscriptionId ??
      latestSubscription?.external_subscription_id ??
      null,
    userId: params.userId,
    planId: effectivePlanId,
    status: syncRule.status,
    paymentMethod,
    amount: effectiveAmount,
    customerEmail: enrichedSnapshot.customerEmail ?? fallbackCustomerEmail,
    checkoutUrl:
      enrichedSnapshot.checkoutUrl ?? latestSubscription?.checkout_url ?? null,
    productId:
      enrichedSnapshot.productId ?? latestSubscription?.product_id ?? null,
    startedAt:
      enrichedSnapshot.startedAt ??
      latestSubscription?.started_at ??
      (syncRule.status === "active" ? new Date().toISOString() : null),
    expiresAt: enrichedSnapshot.expiresAt ?? latestSubscription?.expires_at ?? null,
    eventType: `status.reconcile.${eventType}`,
    source: "webhook",
    metadata: {
      customer_name: enrichedSnapshot.customerName ?? undefined,
      external_status: enrichedSnapshot.externalStatus ?? undefined,
      failure_reason: enrichedSnapshot.failureReason ?? undefined,
      last_event_type: eventType,
      checkout_tracking_id: enrichedSnapshot.tracking.checkoutId ?? undefined,
      checkout_tracking_user_id: params.userId,
      checkout_tracking_plan_id: effectivePlanId,
    },
  });

  if (!subscription) {
    return;
  }

  await syncUserPlanFromSubscription(db, subscription, {
    markOnboardingCompleted: syncRule.status === "active",
  });

  const refreshedUser = await getUserAuthRecordById(db, params.userId);
  const isIncompleteOnboarding =
    Number(refreshedUser?.onboarding_completed ?? 0) !== 1;
  if (
    isIncompleteOnboarding &&
    (syncRule.status === "failed" ||
      syncRule.status === "cancelled" ||
      syncRule.status === "expired")
  ) {
    await purgeIncompleteOnboardingData(db, params.userId);
  }
}

function mergeCaktoOrderSnapshots(primary: CaktoOrderSnapshot, fallback: CaktoOrderSnapshot | null): CaktoOrderSnapshot {
  if (!fallback) return primary;

  return {
    eventType: primary.eventType ?? fallback.eventType,
    eventId: primary.eventId ?? fallback.eventId,
    secret: primary.secret ?? fallback.secret,
    externalOrderId: primary.externalOrderId ?? fallback.externalOrderId,
    externalSubscriptionId: primary.externalSubscriptionId ?? fallback.externalSubscriptionId,
    checkoutUrl: primary.checkoutUrl ?? fallback.checkoutUrl,
    customerEmail: primary.customerEmail ?? fallback.customerEmail,
    customerName: primary.customerName ?? fallback.customerName,
    paymentMethod: primary.paymentMethod !== "none" ? primary.paymentMethod : fallback.paymentMethod,
    planId: primary.planId ?? fallback.planId,
    productId: primary.productId ?? fallback.productId,
    productName: primary.productName ?? fallback.productName,
    amountCents: primary.amountCents ?? fallback.amountCents,
    externalStatus: primary.externalStatus ?? fallback.externalStatus,
    startedAt: primary.startedAt ?? fallback.startedAt,
    expiresAt: primary.expiresAt ?? fallback.expiresAt,
    failureReason: primary.failureReason ?? fallback.failureReason,
    tracking: {
      checkoutId: primary.tracking.checkoutId ?? fallback.tracking.checkoutId,
      userId: primary.tracking.userId ?? fallback.tracking.userId,
      planId: primary.tracking.planId ?? fallback.tracking.planId,
    },
    rawEvent: primary.rawEvent,
    rawData: Object.keys(primary.rawData).length > 0 ? primary.rawData : fallback.rawData,
  };
}

async function hashWebhookBody(rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(rawBody));
  return toHex(digest);
}

async function resolveCaktoWebhookEventId(snapshot: CaktoOrderSnapshot, rawBody: string): Promise<string> {
  if (snapshot.eventId) return snapshot.eventId;
  const hashed = await hashWebhookBody(rawBody);
  return `${snapshot.eventType ?? "unknown"}:${hashed}`;
}

async function resolveWebhookUserIdFromSnapshot(db: D1Database, snapshot: CaktoOrderSnapshot): Promise<string | null> {
  if (snapshot.tracking.userId) {
    const trackedUser = await getUserAuthRecordById(db, snapshot.tracking.userId);
    if (trackedUser?.id) return trackedUser.id;
  }

  if (snapshot.customerEmail) {
    return getUserIdByEmail(db, snapshot.customerEmail);
  }

  return null;
}

async function resolveSubscriptionAnchorId(
  db: D1Database,
  snapshot: CaktoOrderSnapshot,
  userId: string | null,
): Promise<string | null> {
  if (snapshot.tracking.checkoutId) {
    return snapshot.tracking.checkoutId;
  }

  if (!userId) return null;

  const latest = await getLatestSubscriptionByUser(db, userId);
  if (!latest) return null;
  if (normalizePlanStatus(latest.status) !== "pending") return null;
  if (snapshot.planId && latest.plan_id !== snapshot.planId) return null;
  return latest.id;
}

async function enrichCaktoSnapshotFromApi(
  env: Env,
  snapshot: CaktoOrderSnapshot,
): Promise<CaktoOrderSnapshot> {
  const shouldFetchByOrderId =
    Boolean(snapshot.externalOrderId) &&
    (!snapshot.customerEmail || !snapshot.planId || snapshot.amountCents === null || snapshot.paymentMethod === "none");

  if (shouldFetchByOrderId && snapshot.externalOrderId) {
    try {
      const order = await fetchCaktoOrderById(env, snapshot.externalOrderId, CAKTO_PLAN_CATALOG);
      return mergeCaktoOrderSnapshots(snapshot, order);
    } catch (error) {
      console.error("[cakto][order-by-id]", {
        orderId: snapshot.externalOrderId,
        message: getErrorMessage(error),
      });
    }
  }

  const shouldFetchByCustomer =
    Boolean(snapshot.customerEmail) &&
    (!snapshot.externalOrderId || !snapshot.planId || snapshot.amountCents === null);

  if (shouldFetchByCustomer && snapshot.customerEmail) {
    try {
      const order = await fetchLatestCaktoOrderByCustomer(env, snapshot.customerEmail, CAKTO_PLAN_CATALOG);
      return mergeCaktoOrderSnapshots(snapshot, order);
    } catch (error) {
      console.error("[cakto][order-by-customer]", {
        customerEmail: snapshot.customerEmail,
        message: getErrorMessage(error),
      });
    }
  }

  return snapshot;
}

export async function processCaktoWebhook(
  c: Context<AppContext>,
  rawBody: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const initialSnapshot = parseCaktoWebhookPayload(payload, CAKTO_PLAN_CATALOG);
  const eventType = initialSnapshot.eventType;
  const eventId = await resolveCaktoWebhookEventId(initialSnapshot, rawBody);

  if (!eventType || !WEBHOOK_SUPPORTED_EVENTS.has(eventType)) {
    const registered = await recordCaktoWebhookReceipt(c.env.fitloot_db, {
      eventId,
      eventType: eventType ?? "unknown",
      externalOrderId: initialSnapshot.externalOrderId,
      customerEmail: initialSnapshot.customerEmail,
      payloadJson: rawBody,
    });
    if (registered) {
      await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
        status: "ignored",
        externalOrderId: initialSnapshot.externalOrderId,
        customerEmail: initialSnapshot.customerEmail,
      });
    }
    return;
  }

  const registered = await recordCaktoWebhookReceipt(c.env.fitloot_db, {
    eventId,
    eventType,
    externalOrderId: initialSnapshot.externalOrderId,
    customerEmail: initialSnapshot.customerEmail,
    payloadJson: rawBody,
  });

  if (!registered) {
    console.info("[cakto][webhook][duplicate]", { eventId, eventType });
    return;
  }

  console.info("[cakto][webhook][payload]", {
    eventId,
    eventType,
    payload,
  });

  await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
    status: "processing",
    externalOrderId: initialSnapshot.externalOrderId,
    customerEmail: initialSnapshot.customerEmail,
  });

  try {
    const snapshot = await enrichCaktoSnapshotFromApi(c.env, initialSnapshot);
    const userId = await resolveWebhookUserIdFromSnapshot(c.env.fitloot_db, snapshot);
    if (!userId) {
      await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
        status: "failed",
        externalOrderId: snapshot.externalOrderId,
        customerEmail: snapshot.customerEmail,
        errorMessage: "USER_NOT_IDENTIFIED",
      });
      return;
    }

    const currentUser = await getUserAuthRecordById(c.env.fitloot_db, userId);
    const isIncompleteOnboarding = Number(currentUser?.onboarding_completed ?? 0) !== 1;
    const anchorId = await resolveSubscriptionAnchorId(c.env.fitloot_db, snapshot, userId);
    const latestSubscription = await getLatestSubscriptionByUser(c.env.fitloot_db, userId);
    const effectivePlanId =
      snapshot.planId ??
      (latestSubscription && isPublicPlanId(latestSubscription.plan_id) ? latestSubscription.plan_id : null);
    const effectiveAmount =
      snapshot.amountCents ??
      (latestSubscription ? Number(latestSubscription.amount) : null) ??
      (effectivePlanId ? resolveCheckoutAmount(effectivePlanId) : null);
    const syncRule = resolveCaktoSyncMode(eventType);
    const paymentMethod =
      syncRule.paymentMethod ??
      (snapshot.paymentMethod !== "none" ? snapshot.paymentMethod : normalizeUserPaymentMethod(latestSubscription?.payment_method));

    if (!effectivePlanId || effectiveAmount === null || paymentMethod === "none") {
      await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
        status: "failed",
        externalOrderId: snapshot.externalOrderId,
        identifiedUserId: userId,
        customerEmail: snapshot.customerEmail,
        errorMessage: "INSUFFICIENT_CHECKOUT_CONTEXT",
      });
      return;
    }

    const subscription = await ensureSubscriptionRecord(c.env.fitloot_db, {
      id: anchorId,
      externalOrderId: snapshot.externalOrderId,
      externalSubscriptionId: snapshot.externalSubscriptionId,
      userId,
      planId: effectivePlanId,
      status: syncRule.status,
      paymentMethod,
      amount: effectiveAmount,
      customerEmail: snapshot.customerEmail,
      checkoutUrl: snapshot.checkoutUrl,
      productId: snapshot.productId,
      startedAt: snapshot.startedAt ?? (syncRule.status === "active" ? new Date().toISOString() : null),
      expiresAt: snapshot.expiresAt,
      eventType,
      source: "webhook",
      metadata: {
        customer_name: snapshot.customerName ?? undefined,
        external_status: snapshot.externalStatus ?? undefined,
        failure_reason: snapshot.failureReason ?? undefined,
        last_event_id: eventId,
        last_event_type: eventType,
        checkout_tracking_id: snapshot.tracking.checkoutId ?? undefined,
        checkout_tracking_user_id: userId,
        checkout_tracking_plan_id: effectivePlanId,
      },
    });

    if (!subscription) {
      await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
        status: "failed",
        externalOrderId: snapshot.externalOrderId,
        identifiedUserId: userId,
        customerEmail: snapshot.customerEmail,
        errorMessage: "SUBSCRIPTION_UPSERT_FAILED",
      });
      return;
    }

    await syncUserPlanFromSubscription(c.env.fitloot_db, subscription, {
      markOnboardingCompleted: syncRule.status === "active",
    });

    if (
      isIncompleteOnboarding &&
      (syncRule.status === "failed" || syncRule.status === "cancelled" || syncRule.status === "expired")
    ) {
      await purgeIncompleteOnboardingData(c.env.fitloot_db, userId);
    }

    await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
      status: "processed",
      externalOrderId: snapshot.externalOrderId,
      identifiedUserId: userId,
      customerEmail: snapshot.customerEmail,
    });
  } catch (error) {
    console.error("[cakto][webhook][process]", {
      message: getErrorMessage(error),
      payload,
    });
    await updateCaktoWebhookEventStatus(c.env.fitloot_db, eventId, {
      status: "failed",
      externalOrderId: initialSnapshot.externalOrderId,
      customerEmail: initialSnapshot.customerEmail,
      errorMessage: getErrorMessage(error),
    });
  }
}


