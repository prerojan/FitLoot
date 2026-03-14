import type { ReactNode } from "react";
import BottomNav from "@/react-app/components/BottomNav";
import DesktopAppNavbar from "@/react-app/components/DesktopAppNavbar";
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
  return (
    <div className={cn("fl-app-page", className)}>
      <DesktopAppNavbar profile={profile} progression={progression} />
      <div className={cn("relative fl-z-card", contentClassName)}>
        {children}
      </div>
      <div className="md:hidden">
        <BottomNav active={bottomNavActive} />
      </div>
    </div>
  );
}
