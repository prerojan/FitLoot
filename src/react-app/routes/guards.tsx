import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { ROUTE_PATHS } from "../auth/constants";
import { useAuth } from "../auth/context";
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

  // Mantem a navegacao suspensa enquanto a sessao esta sendo resolvida.
  if (loading) {
    return <RouteLoader />;
  }

  // Redireciona visitantes anonimos para a entrada publica.
  if (!user) {
    return <Navigate to={ROUTE_PATHS.login} replace />;
  }

  // Permite pagamento sem liberar o restante da area protegida.
  if (!hasPlanAccess(user) && !BILLING_ROUTE_PATHS.has(location.pathname)) {
    return <Navigate to={ROUTE_PATHS.checkout} replace />;
  }

  return <>{children}</>;
}

export function PublicAuthRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  // Usa o mesmo carregador ate resolver a sessao atual.
  if (loading) {
    return <RouteLoader />;
  }

  // Impede retorno para a tela publica apos autenticacao.
  if (user) {
    return <Navigate to={resolveAuthenticatedStartRoute(user)} replace />;
  }

  return <>{children}</>;
}

export function AppEntryRoute() {
  const { user, loading } = useAuth();

  // Resolve o destino inicial correto antes de entrar no app.
  if (loading) {
    return <RouteLoader />;
  }

  if (!user) {
    return <Navigate to={ROUTE_PATHS.login} replace />;
  }

  return <Navigate to={resolveAuthenticatedStartRoute(user)} replace />;
}
