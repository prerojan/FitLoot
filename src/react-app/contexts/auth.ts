import { createContext, useContext } from "react";
import type { AuthContextType } from "@/react-app/types/auth";

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
