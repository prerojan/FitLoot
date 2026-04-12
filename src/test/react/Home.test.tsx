import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const checkAuth = vi.fn(async () => ({
  state: "authenticated" as const,
  source: "bootstrap" as const,
  user: {
    id: "user-1",
    email: "user@example.com",
    name: "Teste",
    onboarding_completed: 0,
    plan_id: "basic" as const,
    plan_status: "pending" as const,
    payment_method: "none" as const,
  },
}));
const toggleThemeMode = vi.fn();
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
    user: null,
    loading: false,
    checkAuth,
  }),
}));

vi.mock("../../react-app/contexts/theme", () => ({
  useTheme: () => ({
    themeMode: "dark",
    toggleThemeMode,
  }),
}));

vi.mock("../../react-app/services/authService", () => ({
  resolveAuthenticatedStartRoute: vi.fn(() => "/checkout"),
}));

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

import Home from "../../react-app/pages/Home";
import { queueActivationNotice } from "../../react-app/utils/activationNotice";

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("shows the activation notice on the login screen exactly once", async () => {
    const user = userEvent.setup();

    queueActivationNotice({
      title: "Conta criada e acesso liberado",
      message: "Sua conta foi criada e o pagamento foi aprovado. Preparando sua entrada no app.",
      badge: "Acesso liberado",
      tone: "success",
      downloadLabel: "Baixar app Android",
      downloadHref: "https://fitloot.vercel.app/FitLoot.apk?v=teste",
      downloadFileName: "FitLoot.apk",
    });

    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Conta criada e acesso liberado/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Preparando sua entrada no app/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Baixar app Android/i })).toHaveAttribute(
      "href",
      "https://fitloot.vercel.app/FitLoot.apk?v=teste",
    );

    await user.click(screen.getByRole("button", { name: /Fechar/i }));

    expect(
      screen.queryByText(/Conta criada e acesso liberado/i),
    ).not.toBeInTheDocument();
  });

  it("routes only after the authenticated session is actually restored", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/^Email$/i), "user@example.com");
    await user.type(screen.getByLabelText(/^Senha$/i), "password123");
    await user.click(screen.getByRole("button", { name: /Inicializar sessao/i }));

    expect(checkAuth).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/checkout", { replace: true });
  });

  it("does not navigate when login succeeds but session restoration stays unavailable", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    checkAuth.mockResolvedValueOnce({ state: "unavailable" as const });

    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/^Email$/i), "user@example.com");
    await user.type(screen.getByLabelText(/^Senha$/i), "password123");
    await user.click(screen.getByRole("button", { name: /Inicializar sessao/i }));

    expect(navigate).not.toHaveBeenCalled();
    expect(
      screen.getByText(/nao foi possivel carregar sua sessao agora/i),
    ).toBeInTheDocument();
  });
});
