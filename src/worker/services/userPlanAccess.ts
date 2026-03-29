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
    Number(user.onboarding_completed) !== 1 ||
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

export async function getUserAuthRecordById(
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
