import { useNavigate } from "react-router";
import { ShoppingBag, Swords, Target, TrendingUp, User } from "lucide-react";
import { ROUTE_PATHS } from "@/react-app/auth/constants";
import { useArenaNotificationBadge } from "@/react-app/contexts/useArenaNotificationBadge";
import { navigateProtectedRoute } from "@/react-app/services/appNavigation";

interface BottomNavProps {
  active: "missions" | "shop" | "arena" | "ranking" | "profile";
}

const NAV_ITEMS = [
  { id: "missions", label: "Missões", icon: Target, path: ROUTE_PATHS.dashboard },
  { id: "shop", label: "Loja", icon: ShoppingBag, path: ROUTE_PATHS.shop },
  { id: "arena", label: "Arena", icon: Swords, path: ROUTE_PATHS.minigames },
  { id: "ranking", label: "Ranking", icon: TrendingUp, path: ROUTE_PATHS.ranking },
  { id: "profile", label: "Perfil", icon: User, path: ROUTE_PATHS.profile },
] as const;

export default function BottomNav({ active }: BottomNavProps) {
  const navigate = useNavigate();
  const { hasPending } = useArenaNotificationBadge();

  return (
    <div className="fl-z-nav fixed bottom-4 left-1/2 -translate-x-1/2">
      <div className="fl-bottom-nav-shell px-2 py-2">
        {/* Navegacao principal mobile entre os destinos fixos da app. */}
        <div className="flex items-center justify-between gap-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon, path }) => {
            const isActive = active === id;

            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  void navigateProtectedRoute(navigate, path);
                }}
                className={`fl-bottom-nav-item ${isActive ? "fl-bottom-nav-item-active" : ""}`}
                aria-label={label}
              >
                <span className="relative flex shrink-0">
                  <Icon className="h-5 w-5 shrink-0" />
                  {id === "arena" && hasPending ? (
                    <span
                      className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full"
                      style={{
                        backgroundColor: "var(--app-primary-color)",
                        boxShadow: "0 0 16px color-mix(in srgb, var(--app-primary-color) 36%, transparent)",
                      }}
                    />
                  ) : null}
                </span>
                <span className="fl-bottom-nav-label truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
