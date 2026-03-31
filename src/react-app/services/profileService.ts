import { api } from "@/react-app/utils/api";
import type { UserProfileTheme } from "@/react-app/types/profile";

export async function fetchProfileTheme(): Promise<UserProfileTheme | null> {
  // Busca apenas o recorte de tema do perfil para aplicacao visual imediata.
  const response = await api("/api/profile");
  if (!response.ok) return null;
  return (await response.json()) as UserProfileTheme;
}
