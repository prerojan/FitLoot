import { useEffect, useState } from "react";

const AUTH_THEME_STORAGE_KEY = "fitloot_auth_theme";

export type AuthColorScheme = "light" | "dark";

function resolveInitialColorScheme(): AuthColorScheme {
  // Resolve o tema inicial do funil auth respeitando storage e preferencia do SO.
  if (typeof window === "undefined") {
    return "dark";
  }

  const storedColorScheme = localStorage.getItem(AUTH_THEME_STORAGE_KEY);
  if (storedColorScheme === "light" || storedColorScheme === "dark") {
    return storedColorScheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Canonical auth palette hook for login, onboarding, and checkout surfaces.
export function useAuthColorScheme() {
  const [colorScheme, setColorScheme] = useState<AuthColorScheme>(
    resolveInitialColorScheme,
  );

  // Sincroniza a classe global do funil auth sempre que o esquema muda.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("fitloot-auth-light", "fitloot-auth-dark");
    root.classList.add(`fitloot-auth-${colorScheme}`);
    root.style.colorScheme = colorScheme;
    localStorage.setItem(AUTH_THEME_STORAGE_KEY, colorScheme);

    return () => {
      root.classList.remove("fitloot-auth-light", "fitloot-auth-dark");
      root.style.removeProperty("color-scheme");
    };
  }, [colorScheme]);

  return {
    colorScheme,
    toggleColorScheme: () => {
      // Alterna entre claro e escuro mantendo a mesma API para os consumidores.
      setColorScheme((currentColorScheme) =>
        currentColorScheme === "dark" ? "light" : "dark",
      );
    },
  };
}
