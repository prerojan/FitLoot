import React from "react";
import { MemoryRouter } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const logout = vi.fn();
const apiMock = vi.fn();
const completeActivationAndEnterApp = vi.fn(async () => ({ ok: true as const }));
const getHostContextMock = vi.fn();

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
      plan_id: "basic" as const,
      plan_status: "cancelled" as const,
      payment_method: "none" as const,
    },
    logout,
  }),
}));

vi.mock("../../react-app/contexts/theme", () => ({
  useTheme: () => ({
    themeMode: "dark",
    toggleThemeMode: vi.fn(),
  }),
}));

vi.mock("../../react-app/services/authService", () => ({
  fetchCurrentUser: vi.fn(async () => null),
  hasPlanAccess: vi.fn(() => false),
}));

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

vi.mock("../../react-app/services/runtime/hostRuntime", () => ({
  getHostContext: () => getHostContextMock(),
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
    localMessage: "Sua conta foi criada e o pagamento foi aprovado. Faca login para entrar no app.",
    badge: "Acesso liberado",
  }),
}));

import Checkout from "../../react-app/pages/Checkout";

describe("Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHostContextMock.mockReturnValue({
      platform: "android",
      webMode: "remote",
      buildType: "prod",
      networkOnline: true,
      capabilities: {
        camera: true,
        gallery: true,
        healthMetrics: true,
        offlineQueue: true,
        lifecycleEvents: true,
        location: true,
      },
    });
  });

  it("starts activation through /api/checkout/start even when the user just came from onboarding", async () => {
    const user = userEvent.setup();

    apiMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "Falha controlada para validar o endpoint",
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    render(
      <MemoryRouter>
        <Checkout />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Continuar para o checkout/i }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/api/checkout/start", {
        method: "POST",
        body: JSON.stringify({
          plan_id: "pro",
          payment_method: "pix",
          promo_code: undefined,
        }),
      });
    });

    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/onboarding",
      expect.anything(),
    );
    expect(
      screen.getByText(/Falha controlada para validar o endpoint/i),
    ).toBeInTheDocument();
  });

  it("returns onboarding activations to login with the queued success notice flow", async () => {
    const user = userEvent.setup();

    apiMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          checkout_status: "vip_active",
          plan_status: "active",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    render(
      <MemoryRouter>
        <Checkout />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Continuar para o checkout/i }));

    await waitFor(() => {
      expect(completeActivationAndEnterApp).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationPath: "/login",
          finalizeSessionTransition: expect.any(Function),
        }),
      );
    });

    expect(
      screen.getByRole("link", { name: /Baixar app Android/i }),
    ).toBeInTheDocument();
  });
});
