import type { NavigateFunction } from "react-router";

import { ROUTE_PATHS } from "@/react-app/auth/constants";
import type { ActivationNotice } from "@/react-app/utils/activationNotice";
import {
  clearActivationNotice,
  queueActivationNotice,
} from "@/react-app/utils/activationNotice";
import { api } from "@/react-app/utils/api";
import { clearOnboardingDraft } from "@/react-app/utils/onboardingDraft";

export type ActivationFlowOrigin = "onboarding" | "checkout";
export type ActivationOutcome = "vip" | "paid";

export type ActivationCompletionCopy = {
  localTitle: string;
  localMessage: string;
  loginNotice: ActivationNotice;
};

type CompleteActivationAndReturnToLoginParams = {
  navigate: NavigateFunction;
  logout: () => void;
  notice: ActivationNotice;
  onBeforeLogout?: (() => void) | undefined;
  preLogoutDelayMs?: number | undefined;
};

type ActivationCompletionResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

const DEFAULT_PRE_LOGOUT_DELAY_MS = 650;

function wait(delayMs: number): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export function resolveActivationCompletionCopy(params: {
  origin: ActivationFlowOrigin;
  outcome: ActivationOutcome;
}): ActivationCompletionCopy {
  const { origin, outcome } = params;

  if (origin === "onboarding" && outcome === "vip") {
    return {
      localTitle: "Conta criada e VIP ativado",
      localMessage:
        "Sua conta foi criada e o VIP foi ativado com sucesso. Encerrando sua sessao para levar voce ao login.",
      loginNotice: {
        title: "Conta criada e VIP ativado",
        message:
          "Sua conta foi criada e o VIP foi ativado com sucesso. Faca login para entrar no app.",
        badge: "VIP ativo",
        tone: "success",
      },
    };
  }

  if (origin === "checkout" && outcome === "vip") {
    return {
      localTitle: "VIP ativado com sucesso",
      localMessage:
        "Seu VIP foi ativado com sucesso. Encerrando sua sessao para levar voce ao login.",
      loginNotice: {
        title: "VIP ativado com sucesso",
        message: "Seu VIP foi ativado com sucesso. Faca login para entrar no app.",
        badge: "VIP ativo",
        tone: "success",
      },
    };
  }

  if (origin === "onboarding") {
    return {
      localTitle: "Conta criada e acesso liberado",
      localMessage:
        "Sua conta foi criada e o pagamento foi aprovado. Encerrando sua sessao para levar voce ao login.",
      loginNotice: {
        title: "Conta criada e acesso liberado",
        message:
          "Sua conta foi criada e o pagamento foi aprovado. Faca login para entrar no app.",
        badge: "Acesso liberado",
        tone: "success",
      },
    };
  }

  return {
    localTitle: "Pagamento aprovado",
    localMessage:
      "Seu pagamento foi aprovado e o acesso foi liberado. Encerrando sua sessao para levar voce ao login.",
    loginNotice: {
      title: "Pagamento aprovado",
      message: "Seu acesso foi liberado com sucesso. Faca login para entrar no app.",
      badge: "Acesso liberado",
      tone: "success",
    },
  };
}

export async function completeActivationAndReturnToLogin(
  params: CompleteActivationAndReturnToLoginParams,
): Promise<ActivationCompletionResult> {
  params.onBeforeLogout?.();
  clearOnboardingDraft();
  queueActivationNotice(params.notice);

  await wait(params.preLogoutDelayMs ?? DEFAULT_PRE_LOGOUT_DELAY_MS);

  try {
    const response = await api("/api/logout");
    if (!response.ok) {
      throw new Error(`logout_failed:${response.status}`);
    }
  } catch {
    clearActivationNotice();
    return {
      ok: false,
      errorMessage:
        "A ativacao foi concluida, mas nao foi possivel encerrar a sessao com seguranca. Tente novamente para ir ao login.",
    };
  }

  params.logout();
  params.navigate(ROUTE_PATHS.login, { replace: true });
  return { ok: true };
}
