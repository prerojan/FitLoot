import AppLoader from "@/react-app/components/AppLoader";

type PageLoaderProps = {
  fullScreen?: boolean | undefined;
  className?: string | undefined;
};

export default function PageLoader({ fullScreen = true, className }: PageLoaderProps) {
  const wrapperClass = fullScreen
    ? "flex min-h-screen items-center justify-center bg-[var(--app-bg-color)] px-6"
    : "flex items-center justify-center py-6";

  const safeClassName = typeof className === "string" ? className : "";

  return (
    <div className={`${wrapperClass} ${safeClassName}`.trim()}>
      <AppLoader size={fullScreen ? "lg" : "md"} />
    </div>
  );
}
