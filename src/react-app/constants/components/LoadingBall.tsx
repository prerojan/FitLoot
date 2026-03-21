import AppLoader from "@/react-app/components/AppLoader";

type LoadingBallSize = "sm" | "md" | "lg";

type LoadingBallProps = {
  size?: LoadingBallSize;
  className?: string | undefined;
};

export default function LoadingBall({ size = "md", className }: LoadingBallProps) {
  return <AppLoader size={size} className={className} />;
}
