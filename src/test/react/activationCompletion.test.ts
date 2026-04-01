import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
const clearOnboardingDraft = vi.fn();

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

vi.mock("../../react-app/utils/onboardingDraft", () => ({
  clearOnboardingDraft: () => clearOnboardingDraft(),
}));

import {
  completeActivationAndReturnToLogin,
  resolveActivationCompletionCopy,
} from "../../react-app/utils/activationCompletion";

describe("activationCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("logs out and redirects to login when the session shutdown succeeds", async () => {
    const navigate = vi.fn();
    const logout = vi.fn();
    const completionCopy = resolveActivationCompletionCopy({
      origin: "checkout",
      outcome: "vip",
    });

    apiMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await completeActivationAndReturnToLogin({
      navigate,
      logout,
      notice: completionCopy.loginNotice,
      preLogoutDelayMs: 0,
    });

    expect(result).toEqual({ ok: true });
    expect(clearOnboardingDraft).toHaveBeenCalled();
    expect(apiMock).toHaveBeenCalledWith("/api/logout");
    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("keeps the user on the current page when the logout request fails", async () => {
    const navigate = vi.fn();
    const logout = vi.fn();
    const completionCopy = resolveActivationCompletionCopy({
      origin: "onboarding",
      outcome: "paid",
    });

    apiMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "fail" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await completeActivationAndReturnToLogin({
      navigate,
      logout,
      notice: completionCopy.loginNotice,
      preLogoutDelayMs: 0,
    });

    expect(result).toEqual({
      ok: false,
      errorMessage:
        "A ativacao foi concluida, mas nao foi possivel encerrar a sessao com seguranca. Tente novamente para ir ao login.",
    });
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("fitloot_activation_notice")).toBeNull();
  });
});
