import type { NavigateFunction } from "react-router";

import { ROUTE_PATHS } from "@/react-app/auth/constants";
import type { AuthCheckResult } from "@/react-app/auth/types";
import { queueActivationNotice, type ActivationNotice } from "@/react-app/utils/activationNotice";
import { clearOnboardingDraft } from "@/react-app/utils/onboardingDraft";

export type ActivationFlowOrigin = "onboarding" | "checkout";
export type ActivationOutcome = "vip" | "paid";

export type ActivationCompletionCopy = {
  localTitle: string;
  localMessage: string;
  badge?: string;
};

type CompleteActivationAndEnterAppParams = {
  navigate: NavigateFunction;
  refreshAuth?: (() => Promise<AuthCheckResult>) | undefined;
  finalizeSessionTransition?: (() => Promise<void>) | undefined;
  onBeforeEnterApp?: (() => void) | undefined;
  preEnterAppDelayMs?: number | undefined;
  activationNotice?: ActivationNotice | undefined;
  destinationPath?: string | undefined;
};

type ActivationCompletionResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

const DEFAULT_PRE_ENTER_APP_DELAY_MS = 650;

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
        "Sua conta foi criada e o VIP foi ativado com sucesso. Preparando sua entrada no app.",
      badge: "VIP ativo",
    };
  }

  if (origin === "checkout" && outcome === "vip") {
    return {
      localTitle: "VIP ativado com sucesso",
      localMessage:
        "Seu VIP foi ativado com sucesso. Preparando sua entrada no app.",
      badge: "VIP ativo",
    };
  }

  if (origin === "onboarding") {
    return {
      localTitle: "Conta criada e acesso liberado",
      localMessage:
        "Sua conta foi criada e o pagamento foi aprovado. Preparando sua entrada no app.",
      badge: "Acesso liberado",
    };
  }

  return {
    localTitle: "Pagamento aprovado",
    localMessage:
      "Seu pagamento foi aprovado e o acesso foi liberado. Preparando sua entrada no app.",
    badge: "Acesso liberado",
  };
}

export async function completeActivationAndEnterApp(
  params: CompleteActivationAndEnterAppParams,
): Promise<ActivationCompletionResult> {
  params.onBeforeEnterApp?.();
  clearOnboardingDraft();

  await wait(params.preEnterAppDelayMs ?? DEFAULT_PRE_ENTER_APP_DELAY_MS);

  try {
    if (params.finalizeSessionTransition) {
      await params.finalizeSessionTransition();
    } else if (params.refreshAuth) {
      const authResult = await params.refreshAuth();
      if (authResult.state !== "authenticated") {
        throw new Error(`ACTIVATION_TRANSITION_${authResult.state.toUpperCase()}`);
      }
    } else {
      throw new Error("ACTIVATION_TRANSITION_HANDLER_MISSING");
    }
  } catch {
    return {
      ok: false,
      errorMessage:
        "A ativacao foi concluida, mas nao foi possivel concluir a transicao da sua sessao agora. Tente novamente em instantes.",
    };
  }

  if (params.activationNotice) {
    queueActivationNotice(params.activationNotice);
  }

  params.navigate(params.destinationPath ?? ROUTE_PATHS.app, { replace: true });
  return { ok: true };
}
