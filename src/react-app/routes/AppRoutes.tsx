import { Outlet, Route, Routes } from "react-router";

import { ROUTE_PATHS } from "../auth/constants";
import AndroidNotificationBridge from "../components/AndroidNotificationBridge";
import { RewardNotificationsProvider } from "../contexts/rewardNotifications";
import { SocialChatNotificationsProvider } from "../contexts/socialChatNotifications";
import { AppEntryRoute, ProtectedRoute, PublicAuthRoute } from "./guards";
import {
  Achievements,
  AIChat,
  Checkout,
  Dashboard,
  FoodAnalysis,
  Friends,
  HealthTest,
  HomePage,
  LandingPage,
  MiniGames,
  NotFoundPage,
  Onboarding,
  PaymentPending,
  Profile,
  Ranking,
  Shop,
  Titles,
} from "./lazyPages";

function ProtectedAppArea() {
  return (
    <ProtectedRoute>
      <RewardNotificationsProvider>
        <SocialChatNotificationsProvider>
          <AndroidNotificationBridge />
          <Outlet />
        </SocialChatNotificationsProvider>
      </RewardNotificationsProvider>
    </ProtectedRoute>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* Entradas publicas. */}
      <Route path={ROUTE_PATHS.landing} element={<LandingPage />} />
      <Route path={ROUTE_PATHS.publicLanding} element={<LandingPage />} />
      <Route
        path={ROUTE_PATHS.login}
        element={
          <PublicAuthRoute>
            <HomePage />
          </PublicAuthRoute>
        }
      />
      <Route path={ROUTE_PATHS.app} element={<AppEntryRoute />} />
      <Route path={ROUTE_PATHS.onboarding} element={<Onboarding />} />
      {/* Fluxo de pagamento acessivel para usuarios autenticados sem plano. */}
      <Route
        path={ROUTE_PATHS.payment}
        element={
          <ProtectedRoute>
            <Checkout />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.paymentPending}
        element={
          <ProtectedRoute>
            <PaymentPending />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.checkout}
        element={
          <ProtectedRoute>
            <Checkout />
          </ProtectedRoute>
        }
      />
      {/* Area autenticada principal. */}
      <Route element={<ProtectedAppArea />}>
        <Route path={ROUTE_PATHS.home} element={<Dashboard />} />
        <Route path={ROUTE_PATHS.dashboard} element={<Dashboard />} />
        <Route path={ROUTE_PATHS.profile} element={<Profile />} />
        <Route path={ROUTE_PATHS.titles} element={<Titles />} />
        <Route path={ROUTE_PATHS.friends} element={<Friends />} />
        <Route path={ROUTE_PATHS.shop} element={<Shop />} />
        <Route path={ROUTE_PATHS.ranking} element={<Ranking />} />
        <Route path={ROUTE_PATHS.achievements} element={<Achievements />} />
        <Route path={ROUTE_PATHS.minigames} element={<MiniGames />} />
        <Route path={ROUTE_PATHS.aiChat} element={<AIChat />} />
        <Route path={ROUTE_PATHS.foodAnalysis} element={<FoodAnalysis />} />
        <Route path={ROUTE_PATHS.healthTest} element={<HealthTest />} />
      </Route>
      {/* Fallback final de navegacao. */}
      <Route path={ROUTE_PATHS.wildcard} element={<NotFoundPage />} />
    </Routes>
  );
}
