import { ApiRequestError } from "@/react-app/utils/api";

export type ProfilePrimaryTaskKey = "profile" | "attributes" | "progression";

type ResolveProfilePrimaryLoadStateParams = {
  cachedProfileHasCached: boolean;
  cachedProgressionHasCached: boolean;
  primaryTasks: Array<{ key: ProfilePrimaryTaskKey }>;
  primaryResults: PromiseSettledResult<unknown>[];
};

export function resolveProfilePrimaryLoadState({
  cachedProfileHasCached,
  cachedProgressionHasCached,
  primaryTasks,
  primaryResults,
}: ResolveProfilePrimaryLoadStateParams): {
  shouldNavigateToApp: boolean;
  shouldShowCriticalError: boolean;
} {
  const shouldNavigateToApp = primaryResults.some(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof ApiRequestError &&
      (result.reason.status === 401 || result.reason.status === 403),
  );

  if (shouldNavigateToApp) {
    return {
      shouldNavigateToApp: true,
      shouldShowCriticalError: false,
    };
  }

  const failedPrimaryKeys = new Set(
    primaryResults.flatMap((result, index) =>
      result.status === "rejected" ? [primaryTasks[index]?.key] : [],
    ),
  );

  const hasCriticalData =
    (cachedProfileHasCached || !failedPrimaryKeys.has("profile")) &&
    (cachedProgressionHasCached || !failedPrimaryKeys.has("progression"));

  return {
    shouldNavigateToApp: false,
    shouldShowCriticalError: !hasCriticalData,
  };
}
