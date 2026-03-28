import { Route, Routes } from "react-router";

import { ROUTE_PATHS } from "../constants/auth";
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

export default function AppRoutes() {
  return (
    <Routes>
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
      <Route
        path={ROUTE_PATHS.home}
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.dashboard}
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.profile}
        element={
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.titles}
        element={
          <ProtectedRoute>
            <Titles />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.friends}
        element={
          <ProtectedRoute>
            <Friends />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.shop}
        element={
          <ProtectedRoute>
            <Shop />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.ranking}
        element={
          <ProtectedRoute>
            <Ranking />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.achievements}
        element={
          <ProtectedRoute>
            <Achievements />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.minigames}
        element={
          <ProtectedRoute>
            <MiniGames />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.aiChat}
        element={
          <ProtectedRoute>
            <AIChat />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.foodAnalysis}
        element={
          <ProtectedRoute>
            <FoodAnalysis />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTE_PATHS.healthTest}
        element={
          <ProtectedRoute>
            <HealthTest />
          </ProtectedRoute>
        }
      />
      <Route path={ROUTE_PATHS.wildcard} element={<NotFoundPage />} />
    </Routes>
  );
}
