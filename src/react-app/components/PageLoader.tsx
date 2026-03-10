import LoadingBall from "@/react-app/components/LoadingBall";

type PageLoaderProps = {
  fullScreen?: boolean | undefined;
  className?: string | undefined;
};

export default function PageLoader({ fullScreen = true, className }: PageLoaderProps) {
  const wrapperClass = fullScreen
    ? "flex items-center justify-center min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50"
    : "flex items-center justify-center py-6";

  const safeClassName = typeof className === "string" ? className : "";

  return (
    <div className={`${wrapperClass} ${safeClassName}`.trim()}>
      <LoadingBall size={fullScreen ? "lg" : "md"} />
    </div>
  );
}
