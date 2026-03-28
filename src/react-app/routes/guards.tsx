import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { ROUTE_PATHS } from "../constants/auth";
import { useAuth } from "../contexts/auth";
import { hasPlanAccess, resolveAuthenticatedStartRoute } from "../services/authService";
import RouteLoader from "./RouteLoader";

const BILLING_ROUTE_PATHS = new Set<string>([
  ROUTE_PATHS.payment,
  ROUTE_PATHS.paymentPending,
  ROUTE_PATHS.checkout,
]);

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteLoader />;
  }

  if (!user) {
    return <Navigate to={ROUTE_PATHS.login} replace />;
  }

  if (!hasPlanAccess(user) && !BILLING_ROUTE_PATHS.has(location.pathname)) {
    return <Navigate to={ROUTE_PATHS.checkout} replace />;
  }

  return <>{children}</>;
}

export function PublicAuthRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <RouteLoader />;
  }

  if (user) {
    return <Navigate to={resolveAuthenticatedStartRoute(user)} replace />;
  }

  return <>{children}</>;
}

export function AppEntryRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <RouteLoader />;
  }

  if (!user) {
    return <Navigate to={ROUTE_PATHS.login} replace />;
  }

  return <Navigate to={resolveAuthenticatedStartRoute(user)} replace />;
}
