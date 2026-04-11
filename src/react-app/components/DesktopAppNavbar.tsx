import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Avatar } from "./ui/avatar";
import LoadingBall from "./LoadingBall";
import { useAuth } from "@/react-app/auth/context";
import { ROUTE_PATHS } from "@/react-app/auth/constants";
import { useSocialChatNotifications } from "@/react-app/contexts/useSocialChatNotifications";
import { MaterialIcon } from "@/react-app/pages/dashboardHelpers";
import {
  DESKTOP_NAV_ITEMS,
  ensureMaterialSymbolsLoaded,
} from "@/react-app/pages/dashboardUtils";
import type { UserProfile, UserProgression } from "@/shared/types";
import {
  fetchAndCacheJson,
  readCachedJson,
} from "@/react-app/utils/api";
import { cn } from "@/react-app/utils";
import { navigateProtectedRoute } from "@/react-app/services/appNavigation";

type DesktopAppNavbarProps = {
  profile?: UserProfile | null | undefined;
  progression?: UserProgression | null | undefined;
  className?: string | undefined;
};

export default function DesktopAppNavbar({
  profile,
  progression,
  className,
}: DesktopAppNavbarProps) {
  const { user } = useAuth();
  const { pendingCount } = useSocialChatNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const [resolvedProfile, setResolvedProfile] = useState<UserProfile | null>(() => profile ?? readCachedJson<UserProfile>("/api/profile")?.data ?? null);
  const [resolvedProgression, setResolvedProgression] = useState<UserProgression | null>(() => progression ?? readCachedJson<UserProgression>("/api/progression")?.data ?? null);
  const [levelLoading, setLevelLoading] = useState(() => !progression && !readCachedJson<UserProgression>("/api/progression"));

  // Garante os icones do Material Symbols para a navegacao desktop.
  useEffect(() => {
    ensureMaterialSymbolsLoaded();
  }, []);

  // Prioriza o perfil recebido por props quando a tela ja o tem carregado.
  useEffect(() => {
    if (profile) {
      setResolvedProfile(profile);
    }
  }, [profile]);

  // Prioriza a progressao recebida por props para evitar recarga desnecessaria.
  useEffect(() => {
    if (progression) {
      setResolvedProgression(progression);
      setLevelLoading(false);
    }
  }, [progression]);

  // Hidrata o chrome da navegacao com cache e refresh em segundo plano.
  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleHandle: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const hydrateChrome = async () => {
      const cachedProfile = readCachedJson<UserProfile>("/api/profile");
      const cachedProgression = readCachedJson<UserProgression>("/api/progression");

      if (!cancelled && cachedProfile) {
        setResolvedProfile(cachedProfile.data);
      }
      if (!cancelled && cachedProgression) {
        setResolvedProgression(cachedProgression.data);
        setLevelLoading(false);
      }

      const needsProfileFetch =
        Boolean(user?.id) &&
        !profile &&
        !cachedProfile &&
        !user?.name &&
        !user?.avatar_url;
      const needsProgressionFetch = Boolean(user?.id) && !progression && !cachedProgression;

      if (!needsProfileFetch && !needsProgressionFetch) {
        return;
      }

      const runRefresh = async () => {
        const tasks: Array<Promise<void>> = [];

        if (needsProfileFetch) {
          tasks.push(
            fetchAndCacheJson<UserProfile>("/api/profile")
              .then((payload) => {
                if (!cancelled) {
                  setResolvedProfile(payload);
                }
              })
              .catch(() => undefined),
          );
        }

        if (needsProgressionFetch) {
          tasks.push(
            fetchAndCacheJson<UserProgression>("/api/progression")
              .then((payload) => {
                if (!cancelled) {
                  setResolvedProgression(payload);
                }
              })
              .catch(() => undefined)
              .finally(() => {
                if (!cancelled) {
                  setLevelLoading(false);
                }
              }),
          );
        }

        if (tasks.length === 0) {
          if (!cancelled && needsProgressionFetch) {
            setLevelLoading(false);
          }
          return;
        }

        await Promise.allSettled(tasks);
      };

      if (typeof idleWindow.requestIdleCallback === "function") {
        idleHandle = idleWindow.requestIdleCallback(() => {
          void runRefresh();
        }, { timeout: 1_500 });
        return;
      }

      timeoutId = window.setTimeout(() => {
        void runRefresh();
      }, 900);
    };

    void hydrateChrome();

    return () => {
      cancelled = true;
      if (idleHandle !== null && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [profile, progression, user?.avatar_url, user?.id, user?.name]);

  const avatarName = resolvedProfile?.full_name ?? user?.name ?? resolvedProfile?.username ?? "FitLoot";

  return (
    <header
      className={cn("fl-z-nav sticky top-0 hidden md:block", className)}
      style={{
        background:
          "radial-gradient(circle at top right, var(--fl-nav-ambient), transparent 42%), linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-gradient-top) 94%, transparent), color-mix(in srgb, var(--fl-surface-gradient-bottom) 96%, transparent))",
        borderBottom: "1px solid color-mix(in srgb, var(--app-primary-color) 18%, transparent)",
        backdropFilter: "blur(18px)",
        boxShadow: "0 18px 44px color-mix(in srgb, var(--app-primary-color) 8%, transparent)",
      }}
    >
      <div className="fl-app-container grid grid-cols-[auto_1fr_auto] items-center gap-4 py-4 lg:gap-6">
        {/* Marca e atalho principal de retorno ao dashboard. */}
        <button
          type="button"
          onClick={() => {
            void navigateProtectedRoute(navigate, ROUTE_PATHS.dashboard);
          }}
          className="flex min-w-0 items-center gap-3 lg:gap-4"
          aria-label="Abrir dashboard"
        >
          <div className="shrink-0" style={{ color: "var(--app-primary-color)" }}>
            <svg fill="none" viewBox="0 0 48 48" className="h-8 w-8" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4H17.3334V17.3334H30.6666V30.6666H44V44H4V4Z" fill="currentColor" />
            </svg>
          </div>
          <span className="truncate text-lg font-bold uppercase tracking-[0.12em] lg:text-xl" style={{ color: "var(--fl-color-text)" }}>
            FitLoot
          </span>
        </button>

        {/* Nivel atual e navegacao desktop entre as areas principais. */}
        <div className="flex min-w-0 items-center justify-center gap-3 lg:gap-4">
          <div
            className="inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.2em] lg:text-xs"
            style={{
              borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-gradient-top) 88%, transparent), color-mix(in srgb, var(--fl-surface-gradient-bottom) 92%, transparent))",
              color: "var(--fl-color-text)",
            }}
          >
            {levelLoading ? <LoadingBall size="sm" /> : `LVL ${resolvedProgression?.level ?? 1}`}
          </div>

          <nav className="flex min-w-0 items-center gap-1">
            {DESKTOP_NAV_ITEMS.map((item) => {
              const isActive = item.matches.some((path) => path === location.pathname);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    void navigateProtectedRoute(navigate, item.path);
                  }}
                  className="flex items-center gap-2 rounded-2xl px-3 py-3 text-sm font-bold transition-colors hover:opacity-85 lg:px-4"
                  style={isActive ? {
                    background: "var(--app-primary-color)",
                    color: "var(--fl-nav-item-active-text)",
                    boxShadow: "0 0 22px color-mix(in srgb, var(--app-primary-color) 34%, transparent)",
                  } : { color: "var(--fl-nav-item-muted)" }}
                >
                  <span className="relative flex shrink-0">
                    <MaterialIcon name={item.icon} filled={isActive} className="text-xl" />
                    {item.path === ROUTE_PATHS.minigames && pendingCount > 0 ? (
                      <span
                        className="absolute -right-2 -top-2 flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black"
                        style={{
                          backgroundColor: isActive ? "var(--fl-nav-item-active-text)" : "var(--app-primary-color)",
                          color: isActive ? "var(--app-primary-color)" : "var(--fl-nav-item-active-text)",
                        }}
                      >
                        {pendingCount > 9 ? "9+" : pendingCount}
                      </span>
                    ) : null}
                  </span>
                  <span className="hidden lg:inline">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Acoes rapidas de configuracao e acesso ao perfil. */}
        <div className="flex items-center gap-3 lg:gap-4">
          <button
            type="button"
            onClick={() => {
              void navigateProtectedRoute(navigate, ROUTE_PATHS.profile, { state: { openSettings: true } });
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{
              background:
                "radial-gradient(circle at top right, color-mix(in srgb, var(--app-primary-color) 12%, transparent), transparent 48%), linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-gradient-top) 88%, transparent), color-mix(in srgb, var(--fl-surface-gradient-bottom) 92%, transparent))",
              color: "var(--app-primary-color)",
              border: "1px solid color-mix(in srgb, var(--app-primary-color) 16%, transparent)",
            }}
            aria-label="Abrir configuracoes"
          >
            <MaterialIcon name="settings" filled className="text-2xl" />
          </button>
          <button
            type="button"
            onClick={() => {
              void navigateProtectedRoute(navigate, ROUTE_PATHS.profile);
            }}
            className="rounded-full"
            aria-label="Abrir perfil"
          >
            <span className="flex rounded-full border-2 p-[2px]" style={{ borderColor: "var(--app-primary-color)" }}>
              <Avatar src={user?.avatar_url ?? null} name={avatarName} className="h-10 w-10 object-cover" />
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
