import { Swords, Trophy, Users, Zap } from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";

export default function Arena() {
  return (
    <AppPageShell bottomNavActive="arena" className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
      <main className="mx-auto max-w-[48rem] px-4 pb-[98px] pt-4 sm:px-5 md:px-8 md:pt-8 min-w-0">
      <section className="fl-app-container py-2 sm:py-4 md:py-6 min-w-0">
        <div className="rounded-[1.5rem] sm:rounded-[2rem] bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-5 text-white shadow-xl sm:px-6 sm:py-6 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <Swords className="h-6 w-6 sm:h-8 sm:w-8 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white truncate">Arena</h1>
              <p className="text-xs sm:text-base text-emerald-100 truncate">Desafie seus limites</p>
            </div>
          </div>
        </div>
      </section>

        <section className="py-2 sm:py-4 md:py-6 min-w-0">
        <div className="fl-card space-y-4 sm:space-y-6 p-4 sm:p-8 text-center min-w-0">
          <div className="inline-flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 mx-auto shrink-0">
            <Swords className="w-7 h-7 sm:w-8 sm:h-8" />
          </div>
          <div className="min-w-0">
            <p className="text-base sm:text-lg font-bold text-gray-900 truncate">Em breve</p>
            <p className="text-xs sm:text-sm text-gray-500 truncate text-wrap">Mini-games e desafios chegando em breve</p>
          </div>
          <div className="space-y-3 text-left">
            <div className="rounded-xl border border-gray-200 p-3 flex items-center gap-3">
              <Trophy className="w-5 h-5 text-yellow-500" />
              <span className="text-sm font-medium text-gray-700">Ranking de Arena</span>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 flex items-center gap-3">
              <Users className="w-5 h-5 text-emerald-600" />
              <span className="text-sm font-medium text-gray-700">Desafios de Amigos</span>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 flex items-center gap-3">
              <Zap className="w-5 h-5 text-teal-600" />
              <span className="text-sm font-medium text-gray-700">Torneios</span>
            </div>
          </div>
          </div>
        </section>
      </main>
    </AppPageShell>
  );
}
