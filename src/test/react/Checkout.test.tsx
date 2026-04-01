import React from "react";
import { MemoryRouter } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const logout = vi.fn();
const apiMock = vi.fn();

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

vi.mock("../../react-app/utils/onboardingDraft", () => ({
  clearOnboardingDraft: vi.fn(),
}));

import Checkout from "../../react-app/pages/Checkout";

describe("Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
