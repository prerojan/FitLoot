import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/react-app/contexts/auth";
import { useNavigate } from "react-router";
import { 
  Trophy, 
  Lock, 
  Search, 
  Star,
  Flame,
  Zap,
  CheckCircle2,
  X,
  Award,
  Crown
} from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import { fetchAndCacheJson } from "@/react-app/utils/api";
import type { AchievementWithUnlock, UserProfile, UserProgression } from "@/shared/types";

type Rarity = 'ALL' | 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

const RARITY_CONFIG = {
  'COMMON': { color: '#00ff7b', label: 'Comum', shadow: 'rgba(0, 255, 123, 0.2)' },
  'RARE': { color: '#0070dd', label: 'Raro', shadow: 'rgba(0, 112, 221, 0.2)' },
  'EPIC': { color: '#a335ee', label: 'Épico', shadow: 'rgba(163, 53, 238, 0.2)' },
  'LEGENDARY': { color: '#ff8000', label: 'Lendário', shadow: 'rgba(255, 128, 0, 0.2)' },
};

export default function Achievements() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [achievements, setAchievements] = useState<AchievementWithUnlock[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRarity, setActiveRarity] = useState<Rarity>('ALL');
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAchievement, setSelectedAchievement] = useState<AchievementWithUnlock | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [ach, prof, prog] = await Promise.all([
        fetchAndCacheJson<AchievementWithUnlock[]>("/api/achievements"),
        fetchAndCacheJson<UserProfile>("/api/profile"),
        fetchAndCacheJson<UserProgression>("/api/progression"),
      ]);
      
      setAchievements(Array.isArray(ach) ? ach : []);
      setProfile(prof);
      setProgression(prog);
    } catch (err) {
      console.error("Error loading achievements data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    void loadData();
  }, [user, navigate, loadData]);

  const filteredAchievements = useMemo(() => {
    return achievements.filter(a => {
      const matchesRarity = activeRarity === 'ALL' || a.rarity === activeRarity;
      const matchesSearch = a.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           (a.description || "").toLowerCase().includes(searchQuery.toLowerCase());
      return matchesRarity && matchesSearch;
    });
  }, [achievements, activeRarity, searchQuery]);

  const unlockedCount = achievements.filter(a => a.unlocked === 1).length;
  const progressPercent = achievements.length > 0 ? (unlockedCount / achievements.length) * 100 : 0;

  if (loading) {
    return (
      <AppPageShell bottomNavActive="missions" className="bg-[#0A0A0A]">
        <div className="flex-1 flex items-center justify-center">
          <LoadingBall size="md" />
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell bottomNavActive="missions" className="bg-[#0A0A0A]" profile={profile ?? undefined} progression={progression ?? undefined}>
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0A0A0A]">
        
        {/* Scrollable Layout */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8">
          
          {/* Header & Stats Widget */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 mb-12">
            <div>
              <header className="mb-8">
                <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight uppercase tracking-[0.2em] mb-2 leading-none">Hall of Fame</h1>
                <p className="font-bold text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--app-primary-color)' }}>Seu legado imortalizado em conquistas épicas.</p>
              </header>
              
              <div className="flex flex-wrap gap-4">
                <div className="bg-[#161616] border border-white/5 rounded-2xl p-5 flex items-center gap-4 min-w-[200px]">
                  <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center" style={{ backgroundColor: 'rgba(var(--app-primary-color-rgb), 0.1)' }}>
                    <Trophy className="size-6" style={{ color: 'var(--app-primary-color)' }} />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Concluídas</span>
                    <span className="text-2xl font-black text-white">{unlockedCount} / {achievements.length}</span>
                  </div>
                </div>
                <div className="bg-[#161616] border border-white/5 rounded-2xl p-5 flex items-center gap-4 min-w-[200px]">
                  <div className="size-12 rounded-xl bg-orange-500/10 flex items-center justify-center">
                    <Flame className="size-6 text-orange-500" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Rank Atual</span>
                    <span className="text-2xl font-black text-white">ELITE IV</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-primary/5 border border-primary/10 rounded-[2.5rem] p-8 relative overflow-hidden" style={{ backgroundColor: 'rgba(var(--app-primary-color-rgb), 0.05)', borderColor: 'rgba(var(--app-primary-color-rgb), 0.1)' }}>
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-black text-white uppercase tracking-[0.3em]">Dominação Total</h3>
                  <span className="text-xl font-black text-primary" style={{ color: 'var(--app-primary-color)' }}>{Math.round(progressPercent)}%</span>
                </div>
                <div className="h-4 bg-white/5 rounded-full overflow-hidden mb-6 border border-white/5">
                  <div 
                    className="h-full bg-primary shadow-[0_0_15px_var(--app-primary-color)] transition-all duration-1000" 
                    style={{ width: `${progressPercent}%`, backgroundColor: 'var(--app-primary-color)' }}
                  ></div>
                </div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-loose">Desbloqueie mais de <span className="text-white">50 conquistas</span> para atingir o Rank de Lenda Viva.</p>
              </div>
              <Crown className="absolute -bottom-6 -right-6 size-32 text-primary/5 rotate-12" style={{ color: 'rgba(var(--app-primary-color-rgb), 0.05)' }} />
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-10">
            <div className="flex p-1 bg-[#161616] rounded-2xl border border-white/5 w-full md:w-auto overflow-x-auto no-scrollbar">
              <button 
                onClick={() => setActiveRarity('ALL')}
                className={`px-6 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeRarity === 'ALL' ? 'bg-primary text-black' : 'text-slate-500 hover:text-slate-300'}`}
                style={{ backgroundColor: activeRarity === 'ALL' ? 'var(--app-primary-color)' : '' }}
              >
                Todos
              </button>
              {(Object.keys(RARITY_CONFIG) as (keyof typeof RARITY_CONFIG)[]).map((rarity) => (
                <button 
                  key={rarity}
                  onClick={() => setActiveRarity(rarity)}
                  className={`px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap ${activeRarity === rarity ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                  style={{ backgroundColor: activeRarity === rarity ? RARITY_CONFIG[rarity].color : '' }}
                >
                  {RARITY_CONFIG[rarity].label}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-80 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-500 group-focus-within:text-primary transition-colors" />
              <input 
                type="text" 
                placeholder="Filtrar conquistas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#161616]/50 border border-white/5 rounded-2xl py-3 pl-11 pr-4 text-white text-[11px] font-bold tracking-widest uppercase placeholder-slate-700 focus:outline-none focus:border-primary/30 transition-all"
              />
            </div>
          </div>

          {/* Achievements Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-24">
            {filteredAchievements.map((achievement) => {
              const rarityStyle = RARITY_CONFIG[achievement.rarity as keyof typeof RARITY_CONFIG] || RARITY_CONFIG.COMMON;
              const isLocked = achievement.unlocked !== 1;

              return (
                <div 
                  key={achievement.id}
                  onClick={() => setSelectedAchievement(achievement)}
                  className={`bg-[#161616] border rounded-[2rem] p-6 cursor-pointer transition-all duration-300 group relative overflow-hidden flex flex-col h-full ${isLocked ? 'grayscale opacity-40 border-white/5 hover:opacity-70' : 'hover:border-primary/40 hover:scale-[1.02] border-white/5 active:scale-95'}`}
                >
                  {/* Card Background Glow */}
                  {!isLocked && (
                    <div 
                      className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity pointer-events-none"
                      style={{ background: `radial-gradient(circle at center, ${rarityStyle.color}, transparent)` }}
                    ></div>
                  )}

                  <div className="flex items-start justify-between mb-6">
                    <div className="size-14 rounded-2xl bg-black/40 border border-white/5 flex items-center justify-center p-3 relative shadow-inner">
                      {isLocked ? (
                        <Lock className="size-6 text-slate-700" />
                      ) : (
                        <Award className="size-8" style={{ color: rarityStyle.color }} />
                      )}
                    </div>
                    {!isLocked && (
                      <div className="size-6 rounded-full bg-primary/20 flex items-center justify-center" style={{ backgroundColor: 'rgba(var(--app-primary-color-rgb), 0.2)' }}>
                        <CheckCircle2 className="size-3.5 text-primary" style={{ color: 'var(--app-primary-color)' }} />
                      </div>
                    )}
                  </div>

                  <div className="mb-4 flex-1">
                    <h4 className="text-white font-black text-sm uppercase tracking-tight mb-2 leading-tight">{achievement.name}</h4>
                    <p className="text-slate-500 text-[10px] font-bold leading-relaxed tracking-wider line-clamp-2 uppercase">{achievement.description || ""}</p>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-white/5">
                    <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-white/5 text-slate-400">{rarityStyle.label}</span>
                    <div className="flex items-center gap-1">
                      <Zap className="size-3 text-primary animate-pulse" style={{ color: 'var(--app-primary-color)' }} />
                      <span className="text-xs font-black text-white">+50 XP</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredAchievements.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Star className="size-16 text-white/5 mb-6 animate-spin-slow" />
              <p className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.2em]">Nenhuma conquista encontrada neste setor.</p>
            </div>
          )}
        </div>
      </div>

      {/* Achievement Detail Modal */}
      {selectedAchievement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative w-full max-w-lg bg-[#0d0d0d] border border-white/10 rounded-[3rem] p-8 shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden">
            
            {/* Modal Background Glow */}
            <div 
              className="absolute -top-32 -left-32 size-64 blur-[100px] opacity-20"
              style={{ backgroundColor: RARITY_CONFIG[selectedAchievement.rarity as keyof typeof RARITY_CONFIG]?.color || 'var(--app-primary-color)' }}
            ></div>

            <button 
              onClick={() => setSelectedAchievement(null)}
              className="absolute top-6 right-6 p-2 rounded-full bg-white/5 text-slate-500 hover:text-white transition-colors z-10"
            >
              <X className="size-6" />
            </button>

            <div className="relative z-10 flex flex-col items-center text-center">
              <div 
                className={`size-32 rounded-[2.5rem] bg-black/60 border-2 p-8 mb-8 shadow-2xl transition-transform duration-700 animate-in zoom-in-50 ${selectedAchievement.unlocked !== 1 ? 'grayscale border-white/10' : ''}`}
                style={{ borderColor: selectedAchievement.unlocked === 1 ? RARITY_CONFIG[selectedAchievement.rarity as keyof typeof RARITY_CONFIG]?.color : '' }}
              >
                <Award className="size-full" style={{ color: selectedAchievement.unlocked === 1 ? RARITY_CONFIG[selectedAchievement.rarity as keyof typeof RARITY_CONFIG]?.color : '#333' }} />
              </div>

              <span className="text-[10px] font-black uppercase tracking-[0.4em] mb-3" style={{ color: selectedAchievement.unlocked === 1 ? RARITY_CONFIG[selectedAchievement.rarity as keyof typeof RARITY_CONFIG]?.color : '#666' }}>
                Conquista {RARITY_CONFIG[selectedAchievement.rarity as keyof typeof RARITY_CONFIG]?.label || 'Comum'}
              </span>
              
              <h2 className="text-white text-3xl font-black uppercase tracking-tight mb-4">{selectedAchievement.name}</h2>
              <p className="text-slate-400 text-sm font-medium leading-relaxed mb-8 px-6">{selectedAchievement.description || ""}</p>

              <div className="grid grid-cols-2 gap-4 w-full mb-8">
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest block mb-1">Recompensa</span>
                  <div className="flex items-center justify-center gap-2">
                    <Zap className="size-4 text-primary" style={{ color: 'var(--app-primary-color)' }} />
                    <span className="text-xl font-black text-white">+50 XP</span>
                  </div>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                  <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest block mb-1">Status</span>
                  <span className={`text-sm font-black uppercase tracking-widest ${selectedAchievement.unlocked === 1 ? 'text-primary' : 'text-slate-600'}`} style={{ color: selectedAchievement.unlocked === 1 ? 'var(--app-primary-color)' : '' }}>
                    {selectedAchievement.unlocked === 1 ? 'Conquistado' : 'Bloqueado'}
                  </span>
                </div>
              </div>

              {selectedAchievement.unlocked === 1 ? (
                <button 
                  onClick={() => setSelectedAchievement(null)}
                  className="w-full bg-primary text-black py-5 rounded-2xl text-[12px] font-black uppercase tracking-[0.3em] hover:scale-[1.02] active:scale-95 transition-all shadow-2xl"
                  style={{ backgroundColor: 'var(--app-primary-color)' }}
                >
                  Honrar Conquista
                </button>
              ) : (
                <div className="w-full py-5 rounded-2xl border border-white/5 text-[10px] font-black text-slate-700 uppercase tracking-[0.2em]">
                  Continue treinando para desbloquear
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </AppPageShell>
  );
}
