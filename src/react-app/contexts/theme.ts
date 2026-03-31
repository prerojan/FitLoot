import { createContext, useContext } from "react";
import { DEFAULT_APP_THEME_MODE, type AppThemeMode } from "@/react-app/theme/appTheme";

export interface ThemeContextValue {
  themeMode: AppThemeMode;
  setThemeMode: (mode: AppThemeMode) => void;
  toggleThemeMode: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  themeMode: DEFAULT_APP_THEME_MODE,
  setThemeMode: () => {
    return undefined;
  },
  toggleThemeMode: () => {
    return undefined;
  },
});

export const useTheme = () => useContext(ThemeContext);
