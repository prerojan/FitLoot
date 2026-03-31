type ValidationResult<TBlueprint> = {
  blueprints: TBlueprint[];
  invalidCount: number;
  totalCount: number;
};

type StructuredPlanRetryParams<TPlanDraft, TBlueprint> = {
  buildPrompt: (retryReason?: string) => string;
  buildInvalidRatioRetryReason: (invalidRatio: number) => string;
  getErrorMessage: (error: unknown) => string;
  maxAttempts?: number;
  requestPlan: (prompt: string) => Promise<TPlanDraft>;
  validatePlan: (planDraft: TPlanDraft) => ValidationResult<TBlueprint>;
};

export type StructuredPlanRetryResult<TBlueprint> = {
  accepted: boolean;
  validation: ValidationResult<TBlueprint> | null;
};

const DEFAULT_INVALID_RATIO_THRESHOLD = 0.3;
const DEFAULT_MAX_ATTEMPTS = 2;

export async function requestValidatedStructuredPlanWithRetry<
  TPlanDraft,
  TBlueprint,
>(
  params: StructuredPlanRetryParams<TPlanDraft, TBlueprint>,
): Promise<StructuredPlanRetryResult<TBlueprint>> {
  const maxAttempts = Math.max(1, params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  let retryReason = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const planDraft = await params.requestPlan(
        params.buildPrompt(retryReason || undefined),
      );
      const validation = params.validatePlan(planDraft);
      const invalidRatio = validation.totalCount > 0
        ? validation.invalidCount / validation.totalCount
        : 0;
      const isLastAttempt = attempt >= maxAttempts - 1;

      if (
        invalidRatio > DEFAULT_INVALID_RATIO_THRESHOLD &&
        !isLastAttempt
      ) {
        retryReason = params.buildInvalidRatioRetryReason(invalidRatio);
        continue;
      }

      return {
        accepted: invalidRatio <= DEFAULT_INVALID_RATIO_THRESHOLD,
        validation: invalidRatio <= DEFAULT_INVALID_RATIO_THRESHOLD
          ? validation
          : null,
      };
    } catch (error) {
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (isLastAttempt) {
        break;
      }
      retryReason = `A resposta anterior falhou: ${params.getErrorMessage(error)}`;
    }
  }

  return {
    accepted: false,
    validation: null,
  };
}
