import { api } from "@/react-app/utils/api";

export async function triggerRouteNotFoundAchievement(): Promise<void> {
  await api("/api/events/route-not-found", { method: "POST" });
}
