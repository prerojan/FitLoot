import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Avatar } from "./ui/avatar";
import LoadingBall from "./LoadingBall";
import { useAuth } from "@/react-app/contexts/auth";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
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
  const navigate = useNavigate();
  const location = useLocation();
  const [resolvedProfile, setResolvedProfile] = useState<UserProfile | null>(() => profile ?? readCachedJson<UserProfile>("/api/profile")?.data ?? null);
  const [resolvedProgression, setResolvedProgression] = useState<UserProgression | null>(() => progression ?? readCachedJson<UserProgression>("/api/progression")?.data ?? null);
  const [levelLoading, setLevelLoading] = useState(() => !progression && !readCachedJson<UserProgression>("/api/progression"));

  useEffect(() => {
    ensureMaterialSymbolsLoaded();
  }, []);

  useEffect(() => {
    if (profile) {
      setResolvedProfile(profile);
    }
  }, [profile]);

  useEffect(() => {
    if (progression) {
      setResolvedProgression(progression);
      setLevelLoading(false);
    }
  }, [progression]);

  useEffect(() => {
    let cancelled = false;

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

      try {
        if (!profile && (!cachedProfile || cachedProfile.stale)) {
          const payload = await fetchAndCacheJson<UserProfile>("/api/profile");
          if (!cancelled) {
            setResolvedProfile(payload);
          }
        }

        if (!progression && (!cachedProgression || cachedProgression.stale)) {
          const payload = await fetchAndCacheJson<UserProgression>("/api/progression");
          if (!cancelled) {
            setResolvedProgression(payload);
            setLevelLoading(false);
          }
        }
      } catch {
        if (!cancelled && !cachedProgression) {
          setLevelLoading(false);
        }
      }
    };

    void hydrateChrome();

    return () => {
      cancelled = true;
    };
  }, [profile, progression, user?.id]);

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
        <button type="button" onClick={() => navigate(ROUTE_PATHS.dashboard)} className="flex min-w-0 items-center gap-3 lg:gap-4" aria-label="Abrir dashboard">
          <div className="shrink-0" style={{ color: "var(--app-primary-color)" }}>
            <svg fill="none" viewBox="0 0 48 48" className="h-8 w-8" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4H17.3334V17.3334H30.6666V30.6666H44V44H4V4Z" fill="currentColor" />
            </svg>
          </div>
          <span className="truncate text-lg font-bold uppercase tracking-[0.12em] lg:text-xl" style={{ color: "var(--fl-color-text)" }}>
            FitLoot
          </span>
        </button>

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
                  onClick={() => navigate(item.path)}
                  className="flex items-center gap-2 rounded-2xl px-3 py-3 text-sm font-bold transition-colors hover:opacity-85 lg:px-4"
                  style={isActive ? {
                    background: "var(--app-primary-color)",
                    color: "var(--fl-nav-item-active-text)",
                    boxShadow: "0 0 22px color-mix(in srgb, var(--app-primary-color) 34%, transparent)",
                  } : { color: "var(--fl-nav-item-muted)" }}
                >
                  <MaterialIcon name={item.icon} filled={isActive} className="text-xl" />
                  <span className="hidden lg:inline">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3 lg:gap-4">
          <button
            type="button"
            onClick={() => navigate(ROUTE_PATHS.profile, { state: { openSettings: true } })}
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
          <button type="button" onClick={() => navigate(ROUTE_PATHS.profile)} className="rounded-full" aria-label="Abrir perfil">
            <span className="flex rounded-full border-2 p-[2px]" style={{ borderColor: "var(--app-primary-color)" }}>
              <Avatar src={user?.avatar_url ?? null} name={avatarName} className="h-10 w-10 object-cover" />
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
