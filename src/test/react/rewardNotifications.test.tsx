import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
const clearJsonCacheMock = vi.fn();
let mockedUser:
  | {
      id: string;
      email: string;
      name: string;
      onboarding_completed: number;
      plan_id: "basic" | "pro" | "annual" | "vip";
      plan_status: "pending" | "active" | "cancelled" | "failed" | "expired";
      payment_method: "none" | "card" | "pix";
    }
  | null = null;

vi.mock("../../react-app/auth/context", () => ({
  useAuth: () => ({
    user: mockedUser,
  }),
}));

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
  clearJsonCache: (...args: Parameters<typeof clearJsonCacheMock>) => clearJsonCacheMock(...args),
}));

vi.mock("../../react-app/components/LevelUpModal", () => ({
  default: () => null,
}));

import { RewardNotificationsProvider } from "../../react-app/contexts/rewardNotifications";

function renderProvider() {
  return render(
    <RewardNotificationsProvider>
      <div>child</div>
    </RewardNotificationsProvider>,
  );
}

describe("RewardNotificationsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockedUser = null;
  });

  it("loads pending notifications once on app entry and refreshes only on explicit event", async () => {
    mockedUser = {
      id: "user-1",
      email: "user@example.com",
      name: "User",
      onboarding_completed: 1,
      plan_id: "vip",
      plan_status: "active",
      payment_method: "card",
    };

    apiMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    );

    renderProvider();

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledTimes(1);
      expect(apiMock).toHaveBeenCalledWith("/api/reward-notifications/pending");
    });

    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(apiMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("fitloot:refresh-rewards"));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledTimes(2);
    });
  });

  it("does not query reward notifications when the user still lacks released access", async () => {
    mockedUser = {
      id: "user-2",
      email: "pending@example.com",
      name: "Pending",
      onboarding_completed: 1,
      plan_id: "pro",
      plan_status: "pending",
      payment_method: "pix",
    };

    renderProvider();

    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(apiMock).not.toHaveBeenCalled();
  });
});
