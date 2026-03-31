import { describe, expect, it, vi } from "vitest";
import { requestValidatedStructuredPlanWithRetry } from "../../worker/services/structuredPlanRetry";

describe("structuredPlanRetry", () => {
  it("aceita plano validado quando a taxa invalida fica no limite permitido", async () => {
    const requestPlan = vi.fn(async () => ({ id: "draft-1" }));
    const result = await requestValidatedStructuredPlanWithRetry({
      buildPrompt: () => "prompt",
      buildInvalidRatioRetryReason: (invalidRatio) => `retry ${invalidRatio}`,
      getErrorMessage: (error) => String(error),
      requestPlan,
      validatePlan: () => ({
        blueprints: [{ id: 1 }],
        invalidCount: 3,
        totalCount: 10,
      }),
    });

    expect(requestPlan).toHaveBeenCalledTimes(1);
    expect(result.accepted).toBe(true);
    expect(result.validation?.blueprints).toEqual([{ id: 1 }]);
  });

  it("refaz a tentativa apos resposta invalida e usa o motivo no prompt seguinte", async () => {
    const requestPlan = vi
      .fn()
      .mockResolvedValueOnce({ id: "draft-1" })
      .mockResolvedValueOnce({ id: "draft-2" });
    const validatePlan = vi
      .fn()
      .mockReturnValueOnce({
        blueprints: [{ id: 1 }],
        invalidCount: 6,
        totalCount: 10,
      })
      .mockReturnValueOnce({
        blueprints: [{ id: 2 }],
        invalidCount: 1,
        totalCount: 10,
      });
    const prompts: string[] = [];

    const result = await requestValidatedStructuredPlanWithRetry({
      buildPrompt: (retryReason?: string) => {
        prompts.push(retryReason ?? "");
        return retryReason ? `prompt:${retryReason}` : "prompt:initial";
      },
      buildInvalidRatioRetryReason: (invalidRatio) =>
        `ratio:${Math.round(invalidRatio * 100)}`,
      getErrorMessage: (error) => String(error),
      requestPlan,
      validatePlan,
    });

    expect(requestPlan).toHaveBeenCalledTimes(2);
    expect(prompts).toEqual(["", "ratio:60"]);
    expect(result.accepted).toBe(true);
    expect(result.validation?.blueprints).toEqual([{ id: 2 }]);
  });
});
