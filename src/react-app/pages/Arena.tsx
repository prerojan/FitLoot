import { Swords, Trophy, Users, Zap } from "lucide-react";
import BottomNav from "@/react-app/components/BottomNav";

export default function Arena() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 pt-8 pb-6 rounded-b-3xl shadow-xl">
        <div className="flex items-center gap-3">
          <Swords className="w-8 h-8" />
          <div>
            <h1 className="text-3xl font-bold">Arena</h1>
            <p className="text-emerald-100">Desafie seus limites</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="fl-card p-8 text-center space-y-6">
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
      </div>

      <BottomNav active="arena" />
    </div>
  );
}
