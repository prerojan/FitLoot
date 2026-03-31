type MacroCardProps = {
  label: string;
  value: string;
  percentage: number;
};

export default function MacroCard({ label, value, percentage }: MacroCardProps) {
  return (
    <div className="fl-theme-surface p-3 rounded-2xl flex flex-col items-center">
      <span className="text-[10px] fl-theme-text-muted uppercase font-medium">{label}</span>
      <span className="text-xl font-bold tracking-tight">{value}</span>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--fl-color-text) 8%, transparent)" }}>
        <div
          className="h-full transition-all duration-1000"
          style={{ backgroundColor: "var(--app-primary-color)", width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
    </div>
  );
}
