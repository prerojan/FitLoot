import { describe, expect, it } from "vitest";

import { resolveOnboardingErrorMessage } from "../../react-app/pages/onboarding/helpers";

describe("onboarding helpers - resolveOnboardingErrorMessage", () => {
  it("returns a plain string error unchanged", () => {
    expect(resolveOnboardingErrorMessage("Erro ao criar conta.", "Fallback")).toBe("Erro ao criar conta.");
  });

  it("extracts a nested error message from structured payloads", () => {
    expect(
      resolveOnboardingErrorMessage(
        {
          error: {
            message: "Conta criada, mas o onboarding nao foi preparado.",
          },
        },
        "Fallback",
      ),
    ).toBe("Conta criada, mas o onboarding nao foi preparado.");
  });

  it("extracts the first issue message from array-based payloads", () => {
    expect(
      resolveOnboardingErrorMessage(
        {
          issues: [{ message: "Username ja esta em uso." }],
        },
        "Fallback",
      ),
    ).toBe("Username ja esta em uso.");
  });

  it("falls back when the payload does not contain readable text", () => {
    expect(resolveOnboardingErrorMessage({ code: "INTERNAL_ERROR" }, "Fallback")).toBe("Fallback");
  });
});
