import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/react-app/index.css";
import App from "@/react-app/App.tsx";
import { initializeAppThemeMode } from "@/react-app/theme/appTheme";
import { applyProfileTheme, getStoredProfileTheme } from "@/react-app/theme/profileTheme";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root not found");
}

const initialThemeMode = initializeAppThemeMode();
applyProfileTheme(getStoredProfileTheme());

createRoot(rootElement).render(
  <StrictMode>
    <App initialThemeMode={initialThemeMode} />
  </StrictMode>
);
