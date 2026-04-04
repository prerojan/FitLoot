import { describe, expect, it } from "vitest";

import type { UserAuthRecord } from "../../worker/core/types";
import { shouldPurgeUserOnLogout } from "../../worker/services/userPlanAccess";

function buildUser(overrides?: Partial<UserAuthRecord>): UserAuthRecord {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "Teste",
    avatar_url: null,
    onboarding_completed: 0,
    plan_id: "basic",
    plan_status: "failed",
    payment_method: "none",
    ...overrides,
  };
}

describe("userPlanAccess - shouldPurgeUserOnLogout", () => {
  it("purges only incomplete users without active access", () => {
    expect(shouldPurgeUserOnLogout(buildUser())).toBe(true);
  });

  it("keeps active accounts even before onboarding reconciliation finishes", () => {
    expect(
      shouldPurgeUserOnLogout(
        buildUser({
          onboarding_completed: 0,
          plan_id: "vip",
          plan_status: "active",
          payment_method: "card",
        }),
      ),
    ).toBe(false);
  });

  it("keeps established accounts on a normal logout even without an active plan", () => {
    expect(
      shouldPurgeUserOnLogout(
        buildUser({
          onboarding_completed: 1,
          plan_id: "basic",
          plan_status: "cancelled",
        }),
      ),
    ).toBe(false);
  });
});
