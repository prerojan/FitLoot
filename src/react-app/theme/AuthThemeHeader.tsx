import { Moon, Sun, Zap } from "lucide-react";

import type { AuthColorScheme } from "./authColorScheme";

type AuthThemeHeaderProps = {
  colorScheme: AuthColorScheme;
  onToggleColorScheme: () => void;
};

// Canonical themed header for the authentication and onboarding flows.
export function AuthThemeHeader({
  colorScheme,
  onToggleColorScheme,
}: AuthThemeHeaderProps) {
  const nextThemeLabel = colorScheme === "dark" ? "tema claro" : "tema escuro";

  return (
    <header className="fl-auth-header py-2 sm:py-4">
      <div className="fl-auth-logo">
        <div className="fl-auth-logo-mark">
          <Zap className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.3} />
        </div>
        <div>
          <p className="text-lg font-bold tracking-tight sm:text-xl">FitLoot</p>
          <p className="text-xs text-[var(--fl-auth-subtle)]">
            Treino, progresso e recompensas
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleColorScheme}
        className="fl-auth-toggle"
        aria-label={`Alternar para ${nextThemeLabel}`}
        title={`Alternar para ${nextThemeLabel}`}
      >
        {colorScheme === "dark" ? (
          <Sun className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.2} />
        ) : (
          <Moon className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.2} />
        )}
      </button>
    </header>
  );
}
