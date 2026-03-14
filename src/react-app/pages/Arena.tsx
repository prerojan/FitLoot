import { Swords, Trophy, Users, Zap } from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";

export default function Arena() {
  return (
    <AppPageShell bottomNavActive="arena" className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
      <section className="fl-app-container py-4 sm:py-6">
        <div className="rounded-[1.75rem] bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-5 text-white shadow-xl sm:rounded-[2rem] sm:px-6 sm:py-6">
          <div className="flex items-center gap-3">
            <Swords className="h-7 w-7 sm:h-8 sm:w-8" />
            <div>
              <h1 className="fl-title-page text-white">Arena</h1>
              <p className="text-sm text-emerald-100 sm:text-base">Desafie seus limites</p>
            </div>
          </div>
        </div>
      </section>

      <section className="fl-app-container py-4 sm:py-6">
        <div className="fl-card space-y-5 p-5 text-center sm:space-y-6 sm:p-8">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 mx-auto">
            <Swords className="w-8 h-8" />
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">Em breve</p>
            <p className="text-sm text-gray-500">Mini-games e desafios chegando em breve</p>
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
    </AppPageShell>
  );
}
