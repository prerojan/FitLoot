import { Swords, Trophy, Users, Zap } from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";

export default function Arena() {
  return (
    <AppPageShell bottomNavActive="arena">
      <main className="mx-auto flex w-full max-w-[48rem] flex-1 items-center justify-center px-4 pb-[98px] pt-4 sm:px-5 md:px-8 md:py-8 min-w-0">
        {/* Placeholder centralizado enquanto a experiencia competitiva continua em construcao. */}
        <section className="w-full py-2 sm:py-4 md:py-6 min-w-0">
          <div
            className="mx-auto max-w-[36rem] space-y-4 sm:space-y-6 rounded-[1.5rem] border p-4 sm:p-8 text-center min-w-0"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-strong) 96%, transparent), color-mix(in srgb, var(--fl-surface-muted) 72%, transparent))",
              borderColor: "color-mix(in srgb, var(--app-primary-color) 12%, var(--fl-border-soft))",
              boxShadow: "0 18px 44px color-mix(in srgb, var(--app-primary-color) 10%, transparent)",
            }}
          >
            <div
              className="mx-auto inline-flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl shrink-0"
              style={{
                background: "color-mix(in srgb, var(--app-primary-color) 12%, transparent)",
                color: "var(--app-primary-color)",
              }}
            >
              <Swords className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <div className="min-w-0">
              <p className="text-base sm:text-lg font-bold truncate" style={{ color: "var(--fl-color-text)" }}>
                Em breve
              </p>
              <p
                className="text-xs sm:text-sm truncate text-wrap"
                style={{ color: "var(--fl-color-text-muted)" }}
              >
                Mini-games e desafios chegando em breve
              </p>
            </div>
            <div className="space-y-3 text-left">
              <div
                className="flex items-center gap-3 rounded-xl border p-3"
                style={{
                  borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, var(--fl-border-soft))",
                  background: "color-mix(in srgb, var(--fl-surface-muted) 56%, transparent)",
                }}
              >
                <Trophy className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  Ranking de Arena
                </span>
              </div>
              <div
                className="flex items-center gap-3 rounded-xl border p-3"
                style={{
                  borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, var(--fl-border-soft))",
                  background: "color-mix(in srgb, var(--fl-surface-muted) 56%, transparent)",
                }}
              >
                <Users className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  Desafios de Amigos
                </span>
              </div>
              <div
                className="flex items-center gap-3 rounded-xl border p-3"
                style={{
                  borderColor: "color-mix(in srgb, var(--app-primary-color) 10%, var(--fl-border-soft))",
                  background: "color-mix(in srgb, var(--fl-surface-muted) 56%, transparent)",
                }}
              >
                <Zap className="w-5 h-5" style={{ color: "var(--app-primary-color)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--fl-color-text)" }}>
                  Torneios
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </AppPageShell>
  );
}
