import AppLoader from "@/react-app/components/AppLoader";

type PageLoaderProps = {
  fullScreen?: boolean | undefined;
  className?: string | undefined;
};

export default function PageLoader({ fullScreen = true, className }: PageLoaderProps) {
  const wrapperClass = fullScreen
    ? "fixed inset-0 fl-z-modal flex items-center justify-center px-6 backdrop-blur-sm"
    : "flex items-center justify-center py-6";

  const safeClassName = typeof className === "string" ? className : "";

  return (
    <div
      className={`${wrapperClass} ${safeClassName}`.trim()}
      style={fullScreen ? { background: "color-mix(in srgb, var(--app-bg-color) 88%, transparent)" } : undefined}
    >
      <AppLoader size={fullScreen ? "lg" : "md"} />
    </div>
  );
}
