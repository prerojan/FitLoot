import type { ReactNode } from "react";
import LoadingBall from "@/react-app/components/LoadingBall";
import { PANEL_STYLE } from "@/react-app/pages/dashboardUtils";

export function MaterialIcon({
  name,
  className,
  filled = false,
}: {
  name: string;
  className?: string | undefined;
  filled?: boolean | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined leading-none ${className ?? ""}`}
      style={{
        fontVariationSettings: filled
          ? "'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 24"
          : "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24",
      }}
    >
      {name}
    </span>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}) {
  return (
    <div className="mb-2 sm:mb-4 flex flex-nowrap items-center justify-between gap-2 sm:gap-3 min-w-0">
      <h2 className="min-w-0 text-sm sm:text-base md:text-lg lg:text-xl font-bold truncate" style={{ color: "var(--fl-color-text)" }}>
        {title}
      </h2>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="min-h-9 sm:min-h-0 text-[10px] sm:text-xs font-bold transition-colors hover:opacity-80 shrink-0"
          style={{ color: "var(--fl-color-text-muted)" }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  icon,
  sublabel,
  footer,
  loading,
}: {
  label: string;
  value: string;
  icon: string;
  sublabel?: string | undefined;
  footer?: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="flex min-h-[7.5rem] sm:min-h-[9rem] md:min-h-[10rem] flex-col justify-between rounded-[1.25rem] sm:rounded-[1.5rem] md:rounded-[1.75rem] p-2 sm:p-3 md:p-5 min-w-0" style={PANEL_STYLE}>
      <div className="flex items-start justify-between gap-2 md:gap-4 min-w-0">
        <span
          className="text-[9px] sm:text-[10px] md:text-xs font-black uppercase tracking-[0.22em] truncate"
          style={{ color: "var(--fl-color-text-muted)" }}
        >
          {label}
        </span>
        <div
          className="flex h-8 w-8 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}
        >
          <MaterialIcon name={icon} className="text-lg md:text-xl" />
        </div>
      </div>
      <div className="space-y-0.5 sm:space-y-1 md:space-y-2 min-w-0">
        <div className="text-lg sm:text-xl md:text-2xl lg:text-[1.7rem] font-bold truncate" style={{ color: "var(--fl-color-text)" }}>
          {loading ? <LoadingBall size="sm" /> : value}
        </div>
        {sublabel ? (
          <div
            className="text-[9px] sm:text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] truncate"
            style={{ color: "var(--fl-color-text-muted)" }}
          >
            {sublabel}
          </div>
        ) : null}
        {footer}
      </div>
    </div>
  );
}
