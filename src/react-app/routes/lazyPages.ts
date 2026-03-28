import { lazy } from "react";

export const HomePage = lazy(() => import("../pages/Home"));
export const Onboarding = lazy(() => import("../pages/Onboarding"));
export const Checkout = lazy(() => import("../pages/Checkout"));
export const PaymentPending = lazy(() => import("../pages/PaymentPending"));
export const Dashboard = lazy(() => import("../pages/Dashboard"));
export const Profile = lazy(() => import("../pages/Profile"));
export const Titles = lazy(() => import("../pages/Titles"));
export const Friends = lazy(() => import("../pages/Friends"));
export const Shop = lazy(() => import("../pages/Shop"));
export const Ranking = lazy(() => import("../pages/Ranking"));
export const MiniGames = lazy(() => import("../pages/MiniGames"));
export const AIChat = lazy(() => import("../pages/AIChat"));
export const Achievements = lazy(() => import("../pages/Achievements"));
export const FoodAnalysis = lazy(() => import("../pages/FoodAnalysis"));
export const HealthTest = lazy(() => import("../pages/HealthTest"));
export const LandingPage = lazy(() => import("../pages/Landing"));
export const NotFoundPage = lazy(() => import("../pages/NotFound"));
