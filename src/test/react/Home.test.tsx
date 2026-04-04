import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkAuth = vi.fn(async () => undefined);
const toggleThemeMode = vi.fn();
const apiMock = vi.fn();

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

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

import Home from "../../react-app/pages/Home";
import { queueActivationNotice } from "../../react-app/utils/activationNotice";

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("shows the activation notice on the login screen exactly once", async () => {
    const user = userEvent.setup();

    queueActivationNotice({
      title: "Conta criada e acesso liberado",
      message: "Sua conta foi criada e o pagamento foi aprovado. Faca login para entrar no app.",
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
      screen.getByText(/Faca login para entrar no app/i),
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
});
