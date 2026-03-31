import React from "react";
import { MemoryRouter } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const logout = vi.fn();
const apiMock = vi.fn();
const scheduleReloadIntoAppEntry = vi.fn(() => 123);

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("../../react-app/auth/context", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "user@example.com",
      name: "Teste",
      onboarding_completed: 0,
      plan_id: "pro" as const,
      plan_status: "pending" as const,
      payment_method: "pix" as const,
    },
    logout,
  }),
}));

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

vi.mock("../../react-app/utils/onboardingDraft", () => ({
  clearOnboardingDraft: vi.fn(),
}));

vi.mock("../../react-app/utils/appEntryNavigation", () => ({
  scheduleReloadIntoAppEntry: (...args: Parameters<typeof scheduleReloadIntoAppEntry>) =>
    scheduleReloadIntoAppEntry(...args),
}));

import PaymentPending from "../../react-app/pages/PaymentPending";

describe("PaymentPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules an app reload when payment is approved", async () => {
    apiMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          plan_id: "pro",
          plan_status: "active",
          payment_method: "pix",
          amount: 1990,
          has_access: true,
          checkout_url: "https://pay.cakto.com.br/teste",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    render(
      <MemoryRouter>
        <PaymentPending />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/api/subscription/status");
    });

    await waitFor(() => {
      expect(scheduleReloadIntoAppEntry).toHaveBeenCalledWith(500);
    });

    expect(
      screen.getByText(/Seu acesso foi liberado. Atualizando o app agora/i),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith("/home", { replace: true });
  });
});
