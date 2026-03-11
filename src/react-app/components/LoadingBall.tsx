type LoadingBallSize = "sm" | "md" | "lg";

type LoadingBallProps = {
  size?: LoadingBallSize;
  className?: string | undefined;
};

const SIZE_CLASS_MAP: Record<LoadingBallSize, string> = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-6 w-6",
};

export default function LoadingBall({ size = "md", className }: LoadingBallProps) {
  const sizeClass = SIZE_CLASS_MAP[size];
  const safeClassName = typeof className === "string" ? className : "";

  return (
    <span
      className={`relative inline-flex ${sizeClass} ${safeClassName}`.trim()}
      role="status"
      aria-label="Carregando"
    >
      <span className={`absolute inline-flex rounded-full bg-emerald-300 opacity-70 animate-ping ${sizeClass}`} />
      <span className={`relative inline-flex rounded-full bg-emerald-600 ${sizeClass}`} />
    </span>
  );
}
