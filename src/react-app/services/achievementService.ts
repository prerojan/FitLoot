import { api } from "@/react-app/utils/api";

export async function triggerRouteNotFoundAchievement(): Promise<void> {
  // Dispara no backend a conquista especial vinculada a rota inexistente.
  await api("/api/events/route-not-found", {
    method: "POST",
    requestClass: "background",
    orchestrationKey: "achievement:route-not-found",
    orchestrationPolicy: "join",
  });
}
