import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  resolveAuthenticatedStartRoute: vi.fn(() => "/app"),
}));

vi.mock("../../react-app/utils/api", () => ({
  api: vi.fn(),
  fetchJson: vi.fn(),
  isApiTimeoutError: vi.fn(() => false),
  isExpectedApiCancellation: vi.fn(() => false),
}));

vi.mock("../../react-app/utils/onboardingDraft", () => ({
  saveOnboardingDraft: vi.fn(),
}));

import Onboarding from "../../react-app/pages/Onboarding";

describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the opening step and advances to the goal selection step", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Transforme seu treino em/i)).toBeInTheDocument();
    expect(checkAuth).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Comecar/i }));

    expect(screen.getByText(/Qual e o seu/i)).toBeInTheDocument();
    expect(screen.getAllByText(/objetivo/i).length).toBeGreaterThan(0);
  });
});
