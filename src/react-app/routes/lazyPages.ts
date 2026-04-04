import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { ROUTE_PATHS } from "../auth/constants";

type PreloadableRouteComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  preload: () => Promise<{ default: T }>;
  isPreloaded: () => boolean;
};

type RoutePreloader = {
  preload: () => Promise<unknown>;
  isPreloaded: () => boolean;
};

function lazyWithPreload<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): PreloadableRouteComponent<T> {
  let loaded = false;
  let pendingLoad: Promise<{ default: T }> | null = null;

  const preload = () => {
    if (!pendingLoad) {
      pendingLoad = loader()
        .then((module) => {
          loaded = true;
          return module;
        })
        .catch((error) => {
          pendingLoad = null;
          throw error;
        });
    }

    return pendingLoad;
  };

  const Component = lazy(preload) as PreloadableRouteComponent<T>;
  Component.preload = preload;
  Component.isPreloaded = () => loaded;
  return Component;
}

function normalizeRoutePath(path: string): string {
  const [pathname] = path.split(/[?#]/, 1);
  return pathname || path;
}

// Mantem o mapa de carregamento sob demanda das paginas principais.
const HomePageRoute = lazyWithPreload(() => import("../pages/Home"));
const OnboardingRoute = lazyWithPreload(() => import("../pages/Onboarding"));
const CheckoutRoute = lazyWithPreload(() => import("../pages/Checkout"));
const PaymentPendingRoute = lazyWithPreload(() => import("../pages/PaymentPending"));
const DashboardRoute = lazyWithPreload(() => import("../pages/Dashboard"));
const ProfileRoute = lazyWithPreload(() => import("../pages/Profile"));
const TitlesRoute = lazyWithPreload(() => import("../pages/Titles"));
const FriendsRoute = lazyWithPreload(() => import("../pages/Friends"));
const ShopRoute = lazyWithPreload(() => import("../pages/Shop"));
const RankingRoute = lazyWithPreload(() => import("../pages/Ranking"));
const MiniGamesRoute = lazyWithPreload(() => import("../pages/Arena"));
const AIChatRoute = lazyWithPreload(() => import("../pages/AIChat"));
const AchievementsRoute = lazyWithPreload(() => import("../pages/Achievements"));
const FoodAnalysisRoute = lazyWithPreload(() => import("../pages/FoodAnalysis"));
const HealthTestRoute = lazyWithPreload(() => import("../pages/HealthTest"));
const LandingPageRoute = lazyWithPreload(() => import("../pages/Landing"));
const NotFoundPageRoute = lazyWithPreload(() => import("../pages/NotFound"));

export const HomePage = HomePageRoute;
export const Onboarding = OnboardingRoute;
export const Checkout = CheckoutRoute;
export const PaymentPending = PaymentPendingRoute;
export const Dashboard = DashboardRoute;
export const Profile = ProfileRoute;
export const Titles = TitlesRoute;
export const Friends = FriendsRoute;
export const Shop = ShopRoute;
export const Ranking = RankingRoute;
export const MiniGames = MiniGamesRoute;
export const AIChat = AIChatRoute;
export const Achievements = AchievementsRoute;
export const FoodAnalysis = FoodAnalysisRoute;
export const HealthTest = HealthTestRoute;
export const LandingPage = LandingPageRoute;
export const NotFoundPage = NotFoundPageRoute;

const PROTECTED_ROUTE_PRELOADERS: Record<string, RoutePreloader> = {
  [ROUTE_PATHS.home]: DashboardRoute,
  [ROUTE_PATHS.dashboard]: DashboardRoute,
  [ROUTE_PATHS.profile]: ProfileRoute,
  [ROUTE_PATHS.titles]: TitlesRoute,
  [ROUTE_PATHS.friends]: FriendsRoute,
  [ROUTE_PATHS.shop]: ShopRoute,
  [ROUTE_PATHS.ranking]: RankingRoute,
  [ROUTE_PATHS.achievements]: AchievementsRoute,
  [ROUTE_PATHS.minigames]: MiniGamesRoute,
  [ROUTE_PATHS.aiChat]: AIChatRoute,
  [ROUTE_PATHS.foodAnalysis]: FoodAnalysisRoute,
  [ROUTE_PATHS.healthTest]: HealthTestRoute,
};

export function preloadProtectedRoute(path: string): Promise<unknown> | null {
  const route = PROTECTED_ROUTE_PRELOADERS[normalizeRoutePath(path)];
  return route ? route.preload() : null;
}

export function hasProtectedRouteChunk(path: string): boolean {
  const route = PROTECTED_ROUTE_PRELOADERS[normalizeRoutePath(path)];
  return route ? route.isPreloaded() : false;
}
