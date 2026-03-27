import type { ReactNode } from "react";
import { useLocation } from "react-router";
import BottomNav from "./BottomNav";
import DesktopAppNavbar from "./DesktopAppNavbar";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import { useAppChrome } from "@/react-app/contexts/appChrome";
import type { UserProfile, UserProgression } from "@/shared/types";
import { cn } from "@/react-app/utils";

type AppPageShellProps = {
  bottomNavActive: React.ComponentProps<typeof BottomNav>["active"];
  children: ReactNode;
  className?: string | undefined;
  contentClassName?: string | undefined;
  profile?: UserProfile | null | undefined;
  progression?: UserProgression | null | undefined;
};

const CHROMELESS_ROUTES = new Set<string>([
  ROUTE_PATHS.aiChat,
  ROUTE_PATHS.achievements,
  ROUTE_PATHS.foodAnalysis,
  ROUTE_PATHS.titles,
]);

export default function AppPageShell({
  bottomNavActive,
  children,
  className,
  contentClassName,
  profile,
  progression,
}: AppPageShellProps) {
  const location = useLocation();
  const { missionDetailsOpen, missionExecutionOpen } = useAppChrome();
  const hideNavigation =
    missionExecutionOpen ||
    missionDetailsOpen ||
    CHROMELESS_ROUTES.has(location.pathname);

  return (
    <div
      className={cn("fl-app-page", hideNavigation ? "pb-0" : undefined, className)}
      data-route={location.pathname}
    >
      {!hideNavigation ? <DesktopAppNavbar profile={profile} progression={progression} /> : null}
      <div className="fl-theme-backdrop" aria-hidden="true">
        <div className="fl-theme-backdrop-orb fl-theme-backdrop-orb-primary absolute -left-24 top-6 h-72 w-72" />
        <div className="fl-theme-backdrop-orb fl-theme-backdrop-orb-secondary absolute right-[-5rem] top-16 h-80 w-80" />
        <div className="fl-theme-backdrop-orb fl-theme-backdrop-orb-tertiary absolute bottom-[-6rem] left-1/2 h-96 w-96 -translate-x-1/2" />
      </div>
      <div className={cn("relative z-10 flex min-h-0 min-w-0 flex-1 flex-col", contentClassName)}>
        {children}
      </div>
      {!hideNavigation ? (
        <div className="md:hidden">
          <BottomNav active={bottomNavActive} />
        </div>
      ) : null}
    </div>
  );
}
