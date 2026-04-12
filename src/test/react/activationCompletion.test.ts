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
    const refreshAuth = vi.fn(async () => ({
      state: "authenticated" as const,
      source: "bootstrap" as const,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Teste",
        onboarding_completed: 1,
        plan_id: "vip" as const,
        plan_status: "active" as const,
        payment_method: "card" as const,
      },
    }));
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
        "A ativacao foi concluida, mas nao foi possivel concluir a transicao da sua sessao agora. Tente novamente em instantes.",
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(refreshAuth).toHaveBeenCalled();
  });

  it("keeps the user on the current page when auth refresh finishes without a usable session", async () => {
    const navigate = vi.fn();
    const refreshAuth = vi.fn(async () => ({ state: "unavailable" as const }));

    const result = await completeActivationAndEnterApp({
      navigate,
      refreshAuth,
      preEnterAppDelayMs: 0,
    });

    expect(result).toEqual({
      ok: false,
      errorMessage:
        "A ativacao foi concluida, mas nao foi possivel concluir a transicao da sua sessao agora. Tente novamente em instantes.",
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("queues the activation notice before redirecting when one is provided", async () => {
    const navigate = vi.fn();
    const refreshAuth = vi.fn(async () => ({
      state: "authenticated" as const,
      source: "bootstrap" as const,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Teste",
        onboarding_completed: 1,
        plan_id: "pro" as const,
        plan_status: "active" as const,
        payment_method: "card" as const,
      },
    }));

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

  it("supports returning to login after clearing the current session", async () => {
    const navigate = vi.fn();
    const finalizeSessionTransition = vi.fn(async () => undefined);

    const result = await completeActivationAndEnterApp({
      navigate,
      finalizeSessionTransition,
      destinationPath: "/login",
      preEnterAppDelayMs: 0,
      activationNotice: {
        title: "Conta criada e acesso liberado",
        message: "Faca login para entrar no app.",
        tone: "success",
        downloadLabel: "Baixar app Android",
        downloadHref: "https://fitloot.vercel.app/FitLoot.apk",
      },
    });

    expect(result).toEqual({ ok: true });
    expect(finalizeSessionTransition).toHaveBeenCalled();
    expect(sessionStorage.getItem("fitloot_activation_notice")).toContain("Baixar app Android");
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});
