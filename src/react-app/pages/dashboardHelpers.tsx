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
    <div className="mb-4 flex items-center justify-between gap-4">
      <h2 className="text-base font-bold sm:text-lg" style={{ color: "var(--fl-color-text)" }}>
        {title}
      </h2>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="min-h-11 text-[0.72rem] font-bold transition-colors hover:opacity-80 sm:min-h-0 sm:text-xs"
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
    <div className="flex min-h-[9rem] flex-col justify-between rounded-[1.5rem] p-4 sm:min-h-[10rem] sm:rounded-[1.75rem] sm:p-5" style={PANEL_STYLE}>
      <div className="flex items-start justify-between gap-4">
        <span
          className="text-[0.68rem] font-black uppercase tracking-[0.22em]"
          style={{ color: "var(--fl-color-text-muted)" }}
        >
          {label}
        </span>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" }}
        >
          <MaterialIcon name={icon} className="text-xl" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-[1.7rem] font-bold sm:text-2xl" style={{ color: "var(--fl-color-text)" }}>
          {loading ? <LoadingBall size="sm" /> : value}
        </div>
        {sublabel ? (
          <div
            className="text-[0.68rem] font-bold uppercase tracking-[0.2em]"
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
