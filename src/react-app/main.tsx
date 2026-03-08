import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/react-app/index.css";
import App from "@/react-app/App.tsx";
import { applyProfileTheme, getStoredProfileTheme } from "@/react-app/utils/theme";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root not found");
}

applyProfileTheme(getStoredProfileTheme());

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
