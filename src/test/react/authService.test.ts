import { describe, expect, it } from "vitest";
import { hasPlanAccess, resolveAuthenticatedStartRoute } from "../../react-app/services/authService";

describe("authService routing", () => {
  it("routes users with paid access to dashboard", () => {
    const route = resolveAuthenticatedStartRoute({
      id: "u1",
      email: "user@example.com",
      name: "User",
      onboarding_completed: 1,
      plan_id: "pro",
      plan_status: "active",
      payment_method: "card",
    });

    expect(route).toBe("/dashboard");
  });

  it("keeps checkout route when access is not granted", () => {
    const route = resolveAuthenticatedStartRoute({
      id: "u2",
      email: "user2@example.com",
      name: "User2",
      onboarding_completed: 0,
      plan_id: "basic",
      plan_status: "pending",
      payment_method: "none",
    });

    expect(route).toBe("/checkout");
  });

  it("requires onboarding completion and active/vip status", () => {
    expect(
      hasPlanAccess({
        id: "u3",
        email: "u3@example.com",
        name: "U3",
        onboarding_completed: 1,
        plan_id: "vip",
        plan_status: "pending",
        payment_method: "card",
      }),
    ).toBe(true);

    expect(
      hasPlanAccess({
        id: "u4",
        email: "u4@example.com",
        name: "U4",
        onboarding_completed: 0,
        plan_id: "vip",
        plan_status: "active",
        payment_method: "card",
      }),
    ).toBe(false);
  });
});
