import AppLoader from "./AppLoader";

type LoadingBallSize = "sm" | "md" | "lg";

type LoadingBallProps = {
  size?: LoadingBallSize;
  className?: string | undefined;
};

export default function LoadingBall({ size = "md", className }: LoadingBallProps) {
  // Mantem compatibilidade com o nome antigo do componente.
  return <AppLoader size={size} className={className} />;
}
