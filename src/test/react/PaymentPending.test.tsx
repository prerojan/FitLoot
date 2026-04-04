import React from "react";
import { MemoryRouter } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const logout = vi.fn();
const apiMock = vi.fn();
const completeActivationAndEnterApp = vi.fn(async () => ({ ok: true as const }));

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
    checkAuth: vi.fn(async () => undefined),
    logout,
  }),
}));

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

vi.mock("../../react-app/utils/onboardingDraft", () => ({
  clearOnboardingDraft: vi.fn(),
}));

vi.mock("../../react-app/utils/activationCompletion", () => ({
  completeActivationAndEnterApp: (
    ...args: Parameters<typeof completeActivationAndEnterApp>
  ) => completeActivationAndEnterApp(...args),
  resolveActivationCompletionCopy: () => ({
    localTitle: "Conta criada e acesso liberado",
    localMessage: "Sua conta foi criada e o pagamento foi aprovado. Preparando sua entrada no app.",
    badge: "Acesso liberado",
  }),
}));

import PaymentPending from "../../react-app/pages/PaymentPending";

describe("PaymentPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the shared activation finalizer when payment approval grants access", async () => {
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
      expect(completeActivationAndEnterApp).toHaveBeenCalled();
    });

    expect(completeActivationAndEnterApp).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationPath: "/login",
        finalizeSessionTransition: expect.any(Function),
      }),
    );

    expect(
      screen.getByText(/Conta criada e acesso liberado/i),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith("/home", { replace: true });
  });
});
