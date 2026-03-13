type PublicPlanId = "basic" | "pro" | "annual";
type UserPaymentMethod = "none" | "card" | "pix";

export type CaktoPlanCatalog = Record<
  PublicPlanId,
  {
    productId: string;
    checkoutUrl: string;
  }
>;

export type CaktoWebhookEventType =
  | "purchase_approved"
  | "purchase_refused"
  | "subscription_created"
  | "subscription_renewed"
  | "subscription_canceled"
  | "checkout_abandonment";

export type CaktoTrackingContext = {
  checkoutId: string | null;
  userId: string | null;
  planId: PublicPlanId | null;
};

export type CaktoOrderSnapshot = {
  eventType: CaktoWebhookEventType | null;
  eventId: string | null;
  secret: string | null;
  externalOrderId: string | null;
  externalSubscriptionId: string | null;
  checkoutUrl: string | null;
  customerEmail: string | null;
  customerName: string | null;
  paymentMethod: UserPaymentMethod;
  planId: PublicPlanId | null;
  productId: string | null;
  productName: string | null;
  amountCents: number | null;
  externalStatus: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  failureReason: string | null;
  tracking: CaktoTrackingContext;
  rawEvent: Record<string, unknown>;
  rawData: Record<string, unknown>;
};

type CaktoTokenResponse = {
  access_token?: string | undefined;
  token?: string | undefined;
  expires_in?: number | string | undefined;
};

type CaktoEnv = {
  CAKTO_CLIENT_ID?: string | undefined;
  CAKTO_CLIENT_SECRET?: string | undefined;
};

const TOKEN_ENDPOINT = "https://api.cakto.com.br/public_api/token/";
const ORDERS_ENDPOINT = "https://api.cakto.com.br/public_api/orders/";
const TOKEN_REFRESH_LEEWAY_MS = 60_000;

let cachedToken: { value: string; expiresAt: number } | null = null;
let inflightTokenPromise: Promise<string> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeString(value: unknown): string | null {
  return hasText(value) ? value.trim() : null;
}

function normalizeIsoDate(value: unknown): string | null {
  if (!hasText(value)) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseCurrencyToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (!Number.isInteger(value)) {
      return Math.round(value * 100);
    }
    return Math.abs(value) <= 1000 ? Math.round(value * 100) : Math.round(value);
  }

  if (!hasText(value)) return null;

  const compact = value.replace(/\s+/g, "").replace(/[^\d,.-]/g, "");
  if (!compact) return null;

  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const decimalSeparatorIndex = Math.max(lastComma, lastDot);
  const hasDecimalSeparator = decimalSeparatorIndex >= 0;

  let normalized = compact;
  if (hasDecimalSeparator) {
    const fractionalDigits = compact.length - decimalSeparatorIndex - 1;
    if (fractionalDigits > 0 && fractionalDigits <= 2) {
      const integerPart = compact.slice(0, decimalSeparatorIndex).replace(/[.,]/g, "");
      const fractionPart = compact.slice(decimalSeparatorIndex + 1).replace(/[^\d]/g, "");
      normalized = `${integerPart || "0"}.${fractionPart.padEnd(2, "0").slice(0, 2)}`;
    } else {
      normalized = compact.replace(/[.,]/g, "");
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (hasDecimalSeparator && normalized.includes(".")) {
    return Math.round(parsed * 100);
  }

  return Math.abs(parsed) <= 1000 ? Math.round(parsed * 100) : Math.round(parsed);
}

function normalizePaymentMethod(value: unknown): UserPaymentMethod {
  if (!hasText(value)) return "none";

  const normalized = value.trim().toLowerCase();
  if (normalized === "pix") return "pix";
  if (normalized === "card" || normalized === "credit_card" || normalized === "cartao" || normalized === "cartao_credito") {
    return "card";
  }
  return "none";
}

function normalizePublicPlanId(value: unknown): PublicPlanId | null {
  if (!hasText(value)) return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === "free" || normalized === "basic" || normalized === "basico") return "basic";
  if (normalized === "pro" || normalized === "premium") return "pro";
  if (normalized === "annual" || normalized === "elite") return "annual";
  return null;
}

function normalizeWebhookEventType(value: unknown): CaktoWebhookEventType | null {
  if (!hasText(value)) return null;

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "purchase_approved":
    case "purchase_refused":
    case "subscription_created":
    case "subscription_renewed":
    case "subscription_canceled":
    case "checkout_abandonment":
      return normalized;
    default:
      return null;
  }
}

function resolveEventId(payload: Record<string, unknown>, data: Record<string, unknown>): string | null {
  const candidates = [
    payload.event_id,
    payload.id,
    data.event_id,
    data.webhook_event_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
    if (hasText(candidate)) {
      return candidate.trim();
    }
  }

  return null;
}

function readNestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return isRecord(value) ? value : {};
}

function readTrackingFromCheckoutUrl(checkoutUrl: string | null): CaktoTrackingContext {
  if (!checkoutUrl) {
    return { checkoutId: null, userId: null, planId: null };
  }

  try {
    const url = new URL(checkoutUrl);
    return {
      checkoutId: normalizeString(url.searchParams.get("fitloot_checkout_id")),
      userId: normalizeString(url.searchParams.get("fitloot_user_id")),
      planId: normalizePublicPlanId(url.searchParams.get("fitloot_plan_id")),
    };
  } catch {
    return { checkoutId: null, userId: null, planId: null };
  }
}

function resolvePlanIdFromCatalog(productId: string | null, productName: string | null, catalog: CaktoPlanCatalog): PublicPlanId | null {
  const catalogEntries = Object.entries(catalog) as Array<[PublicPlanId, { productId: string; checkoutUrl: string }]>;

  if (productId) {
    const productMatch = catalogEntries.find(([, plan]) => plan.productId === productId);
    if (productMatch) return productMatch[0];
  }

  if (productName) {
    const planMatch = normalizePublicPlanId(productName);
    if (planMatch) return planMatch;
  }

  return null;
}

function resolveFailureReason(data: Record<string, unknown>): string | null {
  const candidates = [
    data.reason,
    data.failureReason,
    data.refusal_reason,
  ];

  for (const candidate of candidates) {
    if (hasText(candidate)) return candidate.trim();
  }

  return null;
}

export function buildTrackedCheckoutUrl(
  checkoutUrl: string,
  tracking: { checkoutId: string; userId: string; planId: PublicPlanId },
): string {
  const url = new URL(checkoutUrl);
  url.searchParams.set("fitloot_checkout_id", tracking.checkoutId);
  url.searchParams.set("fitloot_user_id", tracking.userId);
  url.searchParams.set("fitloot_plan_id", tracking.planId);
  return url.toString();
}

export function resolveWebhookSecret(
  payload: Record<string, unknown>,
  headers: Headers,
): string | null {
  const payloadSecret = normalizeString(payload.secret);
  if (payloadSecret) return payloadSecret;

  const headerCandidates = [
    headers.get("x-cakto-secret"),
    headers.get("x-webhook-secret"),
    headers.get("x-secret"),
    headers.get("authorization"),
  ];

  for (const candidate of headerCandidates) {
    if (!hasText(candidate)) continue;
    const normalized = candidate.toLowerCase().startsWith("bearer ")
      ? candidate.slice(7).trim()
      : candidate.trim();
    if (normalized) return normalized;
  }

  return null;
}

export function parseCaktoWebhookPayload(
  payload: Record<string, unknown>,
  catalog: CaktoPlanCatalog,
): CaktoOrderSnapshot {
  const data = readNestedRecord(payload, "data");
  const customer = readNestedRecord(data, "customer");
  const product = readNestedRecord(data, "product");
  const subscription = readNestedRecord(data, "subscription");
  const eventType = normalizeWebhookEventType(payload.event ?? payload.type);
  const checkoutUrl = normalizeString(data.checkoutUrl ?? data.checkout_url);
  const productId = normalizeString(product.id ?? product.product_id ?? data.product_id);
  const productName = normalizeString(product.name ?? product.title ?? data.product_name);
  const tracking = readTrackingFromCheckoutUrl(checkoutUrl);
  const planId =
    tracking.planId ??
    normalizePublicPlanId(data.plan_id) ??
    resolvePlanIdFromCatalog(productId, productName, catalog);

  return {
    eventType,
    eventId: resolveEventId(payload, data),
    secret: normalizeString(payload.secret),
    externalOrderId: normalizeString(data.id ?? data.order_id),
    externalSubscriptionId: normalizeString(subscription.id ?? data.subscription_id),
    checkoutUrl,
    customerEmail: normalizeString(customer.email ?? data.customer_email ?? data.email),
    customerName: normalizeString(customer.name ?? data.customer_name ?? data.name),
    paymentMethod: normalizePaymentMethod(data.paymentMethod ?? data.payment_method),
    planId,
    productId,
    productName,
    amountCents: parseCurrencyToCents(data.amount ?? data.baseAmount ?? data.total),
    externalStatus: normalizeString(data.status),
    startedAt: normalizeIsoDate(data.paidAt ?? data.createdAt ?? data.approvedAt ?? data.subscription_started_at),
    expiresAt: normalizeIsoDate(
      data.due_date ??
      data.expiresAt ??
      data.subscription_expires_at ??
      subscription.currentPeriodEnd ??
      subscription.nextBillingAt
    ),
    failureReason: resolveFailureReason(data),
    tracking,
    rawEvent: payload,
    rawData: data,
  };
}

export async function getCaktoAccessToken(env: CaktoEnv): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt - TOKEN_REFRESH_LEEWAY_MS) {
    return cachedToken.value;
  }

  if (inflightTokenPromise) {
    return inflightTokenPromise;
  }

  const clientId = normalizeString(env.CAKTO_CLIENT_ID);
  const clientSecret = normalizeString(env.CAKTO_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error("CAKTO credentials are not configured.");
  }

  inflightTokenPromise = (async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`Failed to obtain Cakto token (${response.status}).`);
    }

    const payload = (await response.json()) as CaktoTokenResponse;
    const token = normalizeString(payload.access_token ?? payload.token);
    if (!token) {
      throw new Error("Cakto token response did not include an access token.");
    }

    const expiresInSeconds = Number(payload.expires_in ?? 3600);
    cachedToken = {
      value: token,
      expiresAt: Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600) * 1000,
    };
    return token;
  })();

  try {
    return await inflightTokenPromise;
  } finally {
    inflightTokenPromise = null;
  }
}

async function fetchCaktoJson<T>(env: CaktoEnv, endpoint: string, searchParams?: URLSearchParams): Promise<T> {
  const token = await getCaktoAccessToken(env);
  const url = searchParams && searchParams.toString().length > 0
    ? `${endpoint}?${searchParams.toString()}`
    : endpoint;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Cakto API request failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

export async function fetchCaktoOrderById(
  env: CaktoEnv,
  orderId: string,
  catalog: CaktoPlanCatalog,
): Promise<CaktoOrderSnapshot | null> {
  const normalizedOrderId = normalizeString(orderId);
  if (!normalizedOrderId) return null;

  const response = await fetchCaktoJson<Record<string, unknown>>(env, `${ORDERS_ENDPOINT}${normalizedOrderId}/`);
  if (!isRecord(response)) return null;
  return parseCaktoWebhookPayload({ data: response }, catalog);
}

export async function fetchLatestCaktoOrderByCustomer(
  env: CaktoEnv,
  customer: string,
  catalog: CaktoPlanCatalog,
): Promise<CaktoOrderSnapshot | null> {
  const normalizedCustomer = normalizeString(customer);
  if (!normalizedCustomer) return null;

  const searchParams = new URLSearchParams({
    customer: normalizedCustomer,
    ordering: "-createdAt",
    limit: "1",
  });

  const response = await fetchCaktoJson<unknown>(env, ORDERS_ENDPOINT, searchParams);
  const results = isRecord(response) && Array.isArray(response.results)
    ? response.results
    : Array.isArray(response)
      ? response
      : [];
  const first = results.find((entry) => isRecord(entry));
  if (!first || !isRecord(first)) return null;
  return parseCaktoWebhookPayload({ data: first }, catalog);
}
