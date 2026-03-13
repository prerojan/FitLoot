import { useNavigate } from "react-router";
import { ShoppingBag, Swords, Target, TrendingUp, User } from "lucide-react";
import { ROUTE_PATHS } from "@/react-app/constants/auth";

interface BottomNavProps {
  active: "missions" | "shop" | "arena" | "ranking" | "profile";
}

const NAV_ITEMS = [
  { id: "missions", label: "Missoes", icon: Target, path: ROUTE_PATHS.dashboard },
  { id: "shop", label: "Loja", icon: ShoppingBag, path: ROUTE_PATHS.shop },
  { id: "arena", label: "Arena", icon: Swords, path: ROUTE_PATHS.minigames },
  { id: "ranking", label: "Ranking", icon: TrendingUp, path: ROUTE_PATHS.ranking },
  { id: "profile", label: "Perfil", icon: User, path: ROUTE_PATHS.profile },
] as const;

export default function BottomNav({ active }: BottomNavProps) {
  const navigate = useNavigate();

  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div className="fl-bottom-nav-shell px-2 py-2">
        <div className="flex items-center justify-between gap-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon, path }) => {
            const isActive = active === id;

            return (
              <button
                key={id}
                type="button"
                onClick={() => navigate(path)}
                className={`fl-bottom-nav-item ${isActive ? "fl-bottom-nav-item-active" : ""}`}
                aria-label={label}
              >
                <Icon className="h-5 w-5" />
                <span className="fl-bottom-nav-label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
