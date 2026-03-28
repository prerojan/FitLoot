import { createContext, useContext } from "react";

import type { AuthContextType } from "./types";

// Canonical auth context used by route guards and authenticated pages.
export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  checkAuth: async () => {
    return undefined;
  },
  logout: () => {
    return undefined;
  },
});

export const useAuth = () => useContext(AuthContext);
