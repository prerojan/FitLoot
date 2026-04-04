import { Swords, Trophy, Users, Zap } from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";

export default function Arena() {
  return (
    <AppPageShell bottomNavActive="arena">
      <main className="mx-auto max-w-[48rem] px-4 pb-[98px] pt-4 sm:px-5 md:px-8 md:pt-8 min-w-0">
        {/* Hero simples da arena enquanto a experiencia competitiva continua em construcao. */}
        <section className="fl-app-container py-2 sm:py-4 md:py-6 min-w-0">
          <div
            className="relative overflow-hidden rounded-[1.5rem] sm:rounded-[2rem] px-4 py-5 shadow-xl sm:px-6 sm:py-6 min-w-0"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--app-primary-color) 90%, #042f2e) 0%, color-mix(in srgb, var(--app-primary-color) 58%, var(--fl-surface-strong)) 100%)",
              color: "var(--fl-nav-item-active-text)",
              boxShadow: "0 24px 56px color-mix(in srgb, var(--app-primary-color) 20%, transparent)",
            }}
          >
            <div
              className="pointer-events-none absolute -right-10 -top-14 h-36 w-36 rounded-full"
              style={{
                background: "radial-gradient(circle, color-mix(in srgb, white 18%, transparent) 0%, transparent 72%)",
              }}
            />
            <div
              className="pointer-events-none absolute -bottom-16 left-8 h-32 w-32 rounded-full"
              style={{
                background: "radial-gradient(circle, color-mix(in srgb, var(--app-primary-color) 24%, transparent) 0%, transparent 76%)",
              }}
            />
            <div className="flex items-center gap-3 min-w-0">
              <Swords className="h-6 w-6 sm:h-8 sm:w-8 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold truncate">Arena</h1>
                <p
                  className="text-xs sm:text-base truncate"
                  style={{ color: "color-mix(in srgb, var(--fl-nav-item-active-text) 72%, transparent)" }}
                >
                  Desafie seus limites
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Placeholder funcional com os modulos competitivos que serao liberados depois. */}
        <section className="py-2 sm:py-4 md:py-6 min-w-0">
          <div
            className="space-y-4 sm:space-y-6 rounded-[1.5rem] border p-4 sm:p-8 text-center min-w-0"
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
