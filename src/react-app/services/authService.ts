import { api } from "@/react-app/utils/api";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import type { User } from "@/react-app/types/auth";

export async function fetchCurrentUser(): Promise<User | null> {
  const response = await api("/api/users/me");
  if (!response.ok) return null;
  return (await response.json()) as User;
}

export async function notifyAppOpen(): Promise<void> {
  await api("/api/app/open", { method: "POST" });
}

export function prefetchCoreRoutes(): void {
  void import(`@/react-app/pages/Dashboard`);
  void import(`@/react-app/pages/Profile`);
  void import(`@/react-app/pages/Friends`);
}

export function resolveAuthenticatedStartRoute(user: User): string {
  return user.onboarding_completed === 1 ? ROUTE_PATHS.home : ROUTE_PATHS.onboarding;
}
