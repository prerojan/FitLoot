import type { ReactNode } from "react";
import { useLocation } from "react-router";
import BottomNav from "@/react-app/components/BottomNav";
import DesktopAppNavbar from "@/react-app/components/DesktopAppNavbar";
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
  const hideNavigation = missionExecutionOpen || missionDetailsOpen;

  return (
    <div
      className={cn("fl-app-page", hideNavigation ? "pb-0" : undefined, className)}
      data-route={location.pathname}
    >
      {!hideNavigation ? <DesktopAppNavbar profile={profile} progression={progression} /> : null}
      <div className={cn("relative fl-z-card", contentClassName)}>
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
