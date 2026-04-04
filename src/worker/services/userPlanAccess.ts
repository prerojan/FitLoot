import { PLAN_GUARD_EXEMPT_PATHS } from "../core/constants";
import { hasTableColumn } from "../core/database";
import type {
  CheckoutPaymentMethod,
  PlanId,
  PlanStatus,
  PublicPlanId,
  UserAuthRecord,
  UserPaymentMethod,
} from "../core/types";

function isPublicPlanIdValue(value: string): value is PublicPlanId {
  return value === "basic" || value === "pro" || value === "annual";
}

function isPlanStatusValue(value: string): value is PlanStatus {
  return (
    value === "pending" ||
    value === "active" ||
    value === "cancelled" ||
    value === "failed" ||
    value === "expired"
  );
}

function isCheckoutPaymentMethodValue(
  value: string,
): value is CheckoutPaymentMethod {
  return value === "card" || value === "pix";
}

function isUserPaymentMethodValue(value: string): value is UserPaymentMethod {
  return value === "none" || isCheckoutPaymentMethodValue(value);
}

export function isPublicPlanId(value: string): value is PublicPlanId {
  return isPublicPlanIdValue(value);
}

export function normalizePlanId(
  value: string | null | undefined,
): PlanId {
  if (value === "vip") return "vip";
  if (typeof value === "string" && isPublicPlanIdValue(value)) return value;
  if (typeof value === "string" && value.trim().toLowerCase() === "free") {
    return "basic";
  }
  return "basic";
}

export function normalizePlanStatus(
  value: string | null | undefined,
): PlanStatus {
  if (typeof value === "string" && isPlanStatusValue(value)) return value;
  return "failed";
}

export function normalizeUserPaymentMethod(
  value: string | null | undefined,
): UserPaymentMethod {
  if (typeof value === "string" && isUserPaymentMethodValue(value)) {
    return value;
  }
  return "none";
}

export function hasPlanAccess(
  planId: PlanId,
  planStatus: PlanStatus,
): boolean {
  return planId === "vip" || planStatus === "active";
}

export function shouldBypassPlanGuard(path: string): boolean {
  return PLAN_GUARD_EXEMPT_PATHS.has(path);
}

export function resolvePlanRedirectPath(
  onboardingCompleted: number,
  planStatus: PlanStatus,
): "/checkout" | "/payment/pending" {
  if (Number(onboardingCompleted) !== 1) return "/checkout";
  return planStatus === "pending" ? "/payment/pending" : "/checkout";
}

export function shouldPurgeUserOnLogout(user: UserAuthRecord): boolean {
  return (
    Number(user.onboarding_completed) !== 1 &&
    !hasPlanAccess(user.plan_id, user.plan_status)
  );
}

export function isReusableIncompleteAccount(
  user: Pick<UserAuthRecord, "onboarding_completed" | "plan_id" | "plan_status"> | null,
): boolean {
  if (!user) return false;
  return (
    Number(user.onboarding_completed) !== 1 &&
    !hasPlanAccess(user.plan_id, user.plan_status)
  );
}

export function normalizePublicPlanIdFromValue(
  value: string | null | undefined,
): PublicPlanId | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "free" || normalized === "basic") return "basic";
  if (normalized === "pro" || normalized === "premium") return "pro";
  if (normalized === "annual" || normalized === "elite") return "annual";
  return null;
}

let authRecordQueryMode: "unknown" | "modern" | "legacy" = "unknown";
let planUpdateMode: "unknown" | "modern" | "legacy" = "unknown";

function isMissingColumnError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .trim();
  return (
    (message.includes("column") && message.includes("does not exist")) ||
    message.includes("no such column") ||
    message.includes("missing plan columns")
  );
}

function isTransientDatabaseError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .trim();
  return (
    message.includes("query read timeout") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("connection terminated") ||
    message.includes("connect etimedout") ||
    message.includes("read etimedout") ||
    message.includes("socket hang up")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getUserAuthRecordByIdLegacy(
  db: D1Database,
  userId: string,
): Promise<UserAuthRecord | null> {
  const [
    onboardingColumnExists,
    planIdColumnExists,
    planStatusColumnExists,
    paymentMethodColumnExists,
  ] = await Promise.all([
    hasTableColumn(db, "users", "onboarding_completed"),
    hasTableColumn(db, "users", "plan_id"),
    hasTableColumn(db, "users", "plan_status"),
    hasTableColumn(db, "users", "payment_method"),
  ]);

  const userRecord = await db
    .prepare(
      `SELECT
        id,
        email,
        name,
        avatar_url,
        ${onboardingColumnExists ? "COALESCE(onboarding_completed, 0)" : "0"} as onboarding_completed,
        ${planIdColumnExists ? "COALESCE(plan_id, 'basic')" : "'basic'"} as plan_id,
        ${planStatusColumnExists ? "COALESCE(plan_status, 'failed')" : "'failed'"} as plan_status,
        ${paymentMethodColumnExists ? "COALESCE(payment_method, 'none')" : "'none'"} as payment_method
      FROM users
      WHERE id = ?`,
    )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      name: string;
      avatar_url: string | null;
      onboarding_completed: number;
      plan_id: string;
      plan_status: string;
      payment_method: string;
    }>();

  if (!userRecord) return null;

  return {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    avatar_url: userRecord.avatar_url,
    onboarding_completed:
      Number(userRecord.onboarding_completed) === 1 ? 1 : 0,
    plan_id: normalizePlanId(userRecord.plan_id),
    plan_status: normalizePlanStatus(userRecord.plan_status),
    payment_method: normalizeUserPaymentMethod(userRecord.payment_method),
  };
}

async function getUserAuthRecordByIdModern(
  db: D1Database,
  userId: string,
): Promise<UserAuthRecord | null> {
  const userRecord = await db
    .prepare(
      `SELECT
        id,
        email,
        name,
        avatar_url,
        COALESCE(onboarding_completed, 0) as onboarding_completed,
        COALESCE(plan_id, 'basic') as plan_id,
        COALESCE(plan_status, 'failed') as plan_status,
        COALESCE(payment_method, 'none') as payment_method
      FROM users
      WHERE id = ?`,
    )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      name: string;
      avatar_url: string | null;
      onboarding_completed: number;
      plan_id: string;
      plan_status: string;
      payment_method: string;
    }>();

  if (!userRecord) return null;

  return {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    avatar_url: userRecord.avatar_url,
    onboarding_completed:
      Number(userRecord.onboarding_completed) === 1 ? 1 : 0,
    plan_id: normalizePlanId(userRecord.plan_id),
    plan_status: normalizePlanStatus(userRecord.plan_status),
    payment_method: normalizeUserPaymentMethod(userRecord.payment_method),
  };
}

export async function getUserAuthRecordById(
  db: D1Database,
  userId: string,
): Promise<UserAuthRecord | null> {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (authRecordQueryMode === "legacy") {
        return await getUserAuthRecordByIdLegacy(db, userId);
      }

      const result = await getUserAuthRecordByIdModern(db, userId);
      authRecordQueryMode = "modern";
      return result;
    } catch (error) {
      if (isMissingColumnError(error)) {
        authRecordQueryMode = "legacy";
        continue;
      }

      const shouldRetry =
        attempt < maxAttempts && isTransientDatabaseError(error);
      if (!shouldRetry) {
        throw error;
      }
      await sleep(120 * attempt);
    }
  }

  return null;
}

async function updateUserPlanStateLegacy(
  db: D1Database,
  userId: string,
  params: {
    planId: PlanId;
    status: PlanStatus;
    paymentMethod: UserPaymentMethod;
    markOnboardingCompleted: boolean;
  },
): Promise<void> {
  const [
    planIdColumnExists,
    planStatusColumnExists,
    paymentMethodColumnExists,
    onboardingColumnExists,
  ] = await Promise.all([
    hasTableColumn(db, "users", "plan_id"),
    hasTableColumn(db, "users", "plan_status"),
    hasTableColumn(db, "users", "payment_method"),
    params.markOnboardingCompleted
      ? hasTableColumn(db, "users", "onboarding_completed")
      : Promise.resolve(false),
  ]);

  if (!planIdColumnExists || !planStatusColumnExists) {
    throw new Error("Users table is missing plan columns.");
  }

  const assignments = ["plan_id = ?", "plan_status = ?"];
  const values: Array<string> = [params.planId, params.status];

  if (paymentMethodColumnExists) {
    assignments.push("payment_method = ?");
    values.push(params.paymentMethod);
  }

  if (params.markOnboardingCompleted && onboardingColumnExists) {
    assignments.push("onboarding_completed = 1");
  }

  await db
    .prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values, userId)
    .run();
}

async function updateUserPlanStateModern(
  db: D1Database,
  userId: string,
  params: {
    planId: PlanId;
    status: PlanStatus;
    paymentMethod: UserPaymentMethod;
    markOnboardingCompleted: boolean;
  },
): Promise<void> {
  const assignments = [
    "plan_id = ?",
    "plan_status = ?",
    "payment_method = ?",
  ];
  const values: Array<string> = [params.planId, params.status, params.paymentMethod];

  if (params.markOnboardingCompleted) {
    assignments.push("onboarding_completed = 1");
  }

  await db
    .prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values, userId)
    .run();
}

export async function updateUserPlanState(
  db: D1Database,
  userId: string,
  params: {
    planId: PlanId;
    status: PlanStatus;
    paymentMethod: UserPaymentMethod;
    markOnboardingCompleted: boolean;
  },
): Promise<void> {
  if (planUpdateMode === "legacy") {
    return updateUserPlanStateLegacy(db, userId, params);
  }

  try {
    await updateUserPlanStateModern(db, userId, params);
    planUpdateMode = "modern";
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }
    planUpdateMode = "legacy";
    await updateUserPlanStateLegacy(db, userId, params);
  }
}
