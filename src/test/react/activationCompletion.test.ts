import { beforeEach, describe, expect, it, vi } from "vitest";

const clearOnboardingDraft = vi.fn();

vi.mock("../../react-app/utils/onboardingDraft", () => ({
  clearOnboardingDraft: () => clearOnboardingDraft(),
}));

import {
  completeActivationAndEnterApp,
  resolveActivationCompletionCopy,
} from "../../react-app/utils/activationCompletion";

describe("activationCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("refreshes auth and redirects to the app when activation succeeds", async () => {
    const navigate = vi.fn();
    const refreshAuth = vi.fn(async () => undefined);
    const completionCopy = resolveActivationCompletionCopy({
      origin: "checkout",
      outcome: "vip",
    });

    const result = await completeActivationAndEnterApp({
      navigate,
      refreshAuth,
      preEnterAppDelayMs: 0,
    });

    expect(result).toEqual({ ok: true });
    expect(clearOnboardingDraft).toHaveBeenCalled();
    expect(refreshAuth).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/app", { replace: true });
    expect(completionCopy.badge).toBe("VIP ativo");
  });

  it("keeps the user on the current page when auth refresh fails", async () => {
    const navigate = vi.fn();
    const refreshAuth = vi.fn(async () => {
      throw new Error("refresh failed");
    });

    const result = await completeActivationAndEnterApp({
      navigate,
      refreshAuth,
      preEnterAppDelayMs: 0,
    });

    expect(result).toEqual({
      ok: false,
      errorMessage:
        "A ativacao foi concluida, mas nao foi possivel atualizar sua sessao agora. Tente entrar no app novamente em instantes.",
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(refreshAuth).toHaveBeenCalled();
  });

  it("queues the activation notice before redirecting when one is provided", async () => {
    const navigate = vi.fn();
    const refreshAuth = vi.fn(async () => undefined);

    const result = await completeActivationAndEnterApp({
      navigate,
      refreshAuth,
      preEnterAppDelayMs: 0,
      activationNotice: {
        title: "Conta criada e acesso liberado",
        message: "Seu app ja pode ser baixado.",
        tone: "success",
        downloadLabel: "Baixar app Android",
        downloadHref: "https://fitloot.vercel.app/FitLoot.apk?v=teste",
      },
    });

    expect(result).toEqual({ ok: true });
    expect(sessionStorage.getItem("fitloot_activation_notice")).toContain("Baixar app Android");
    expect(navigate).toHaveBeenCalledWith("/app", { replace: true });
  });
});
