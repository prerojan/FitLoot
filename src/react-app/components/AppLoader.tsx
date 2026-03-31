type AppLoaderSize = "sm" | "md" | "lg";

type AppLoaderProps = {
  size?: AppLoaderSize;
  className?: string | undefined;
};

const SIZE_CLASS_MAP: Record<AppLoaderSize, string> = {
  sm: "is-sm",
  md: "is-md",
  lg: "is-lg",
};

export default function AppLoader({ size = "md", className }: AppLoaderProps) {
  // Normaliza o loader principal da app com tamanhos previsiveis.
  const sizeClass = SIZE_CLASS_MAP[size];
  const safeClassName = typeof className === "string" ? className : "";

  return (
    <span
      className={`loading ${sizeClass} ${safeClassName}`.trim()}
      role="status"
      aria-label="Carregando"
    >
      <svg
        viewBox="0 0 80 40"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <polyline
          id="back"
          stroke="currentColor"
          points="0.157 23.954, 14 23.954, 21.843 8.765, 29.988 35.243, 43.432 1.913, 50.640 23.954, 64 23.954, 72 23.954"
        />
        <polyline
          id="front"
          points="0.157 23.954, 14 23.954, 21.843 8.765, 29.988 35.243, 43.432 1.913, 50.640 23.954, 64 23.954, 72 23.954"
        />
      </svg>
    </span>
  );
}
