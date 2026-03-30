import { Clock3 } from "lucide-react";
import LoadingBall from "@/react-app/components/LoadingBall";
import { formatMealType, formatSavedFoodTime } from "./helpers";
import type { SavedFoodEntry } from "./types";

type SavedFoodsLibraryPanelProps = {
  libraryOpen: boolean;
  savedFoods: SavedFoodEntry[];
  savedFoodsLoading: boolean;
  savedFoodsError: string | null;
  scannerLibrarySurfaceClass: string;
  onRefresh: () => Promise<void> | void;
};

export default function SavedFoodsLibraryPanel({
  libraryOpen,
  savedFoods,
  savedFoodsLoading,
  savedFoodsError,
  scannerLibrarySurfaceClass,
  onRefresh,
}: SavedFoodsLibraryPanelProps) {
  return (
    <div className={`absolute left-4 right-4 z-30 transition-all duration-300 ${libraryOpen ? "bottom-28 opacity-100 translate-y-0" : "bottom-24 pointer-events-none opacity-0 translate-y-6"}`}>
      <div className={`overflow-hidden rounded-[1.75rem] border border-white/10 ${scannerLibrarySurfaceClass}`}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/55">Biblioteca salva</p>
            <h3 className="mt-1 text-sm font-bold text-white">Alimentos registrados hoje</h3>
          </div>
          <button
            type="button"
            onClick={() => { void onRefresh(); }}
            className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/75 transition-opacity hover:opacity-80"
          >
            Atualizar
          </button>
        </div>

        <div className="custom-scrollbar max-h-56 space-y-2 overflow-y-auto px-3 py-3">
          {savedFoodsLoading ? (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-5">
              <LoadingBall size="sm" />
              <span className="text-xs font-bold uppercase tracking-widest text-white/70">Carregando biblioteca</span>
            </div>
          ) : savedFoodsError ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-950/35 px-4 py-4 text-center text-xs font-bold uppercase tracking-widest text-red-300">
              {savedFoodsError}
            </div>
          ) : savedFoods.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-white/75">Nenhum alimento salvo hoje</p>
              <p className="mt-2 text-[11px] text-white/55">Quando voce confirmar uma analise, ela aparece aqui.</p>
            </div>
          ) : (
            savedFoods.map((food) => (
              <div key={food.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{food.food_name}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
                    <span>{formatMealType(food.meal_type)}</span>
                    <span className="h-1 w-1 rounded-full bg-white/35"></span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="h-3 w-3" />
                      {formatSavedFoodTime(food)}
                    </span>
                  </div>
                </div>
                <div className="ml-4 rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  {food.calories ?? 0} kcal
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
