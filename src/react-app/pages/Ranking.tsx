import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Avatar } from "@/react-app/components/ui/avatar";
import { 
  Trophy, 
  Medal, 
  Crown, 
  Flame, 
  Zap, 
  Filter as FilterIcon,
  Search as SearchIcon
} from "lucide-react";
import { ApiRequestError, api, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
import type { RankingPlayer } from "@/shared/types";

type RankingMode = 'global' | 'friends';

export default function Ranking() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ranking, setRanking] = useState<RankingPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RankingMode>('global');

  const loadRanking = useCallback(async (currentMode: RankingMode) => {
    setError(null);
    const apiPath = currentMode === 'global' ? "/api/ranking/global" : "/api/friends";
    const cacheRanking = readCachedJson<RankingPlayer[]>(apiPath);

    if (cacheRanking) {
      setRanking(Array.isArray(cacheRanking.data) ? cacheRanking.data : []);
      setLoading(false);
      if (!cacheRanking.stale) return;
    }

    try {
      const data = await fetchAndCacheJson<RankingPlayer[]>(apiPath);
      setRanking(Array.isArray(data) ? data : []);
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app");
        return;
      }
      console.error("Error loading ranking:", loadError);
      if (!cacheRanking) {
        setError("Não foi possível carregar o ranking agora.");
        setRanking([]);
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    void loadRanking(mode);
  }, [user, navigate, loadRanking, mode]);

  if (loading && ranking.length === 0) {
    return (
      <AppPageShell bottomNavActive="ranking" className="bg-[#0A0A0A]">
        <div className="flex-1 flex items-center justify-center">
          <LoadingBall size="md" />
        </div>
      </AppPageShell>
    );
  }

  const top3 = ranking.slice(0, 3);
  const others = ranking.slice(3);

  return (
    <AppPageShell bottomNavActive="ranking" className="bg-[#0A0A0A]">
      <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar p-6 sm:p-8">
        
        {/* Header Section */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight uppercase tracking-[0.2em] mb-1">Ranking Global</h1>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Os guerreiros mais implacáveis do FitLoot.</p>
          </div>
          <button className="p-3.5 rounded-2xl bg-[#161616] border border-white/5 text-slate-400 hover:text-white hover:bg-white/5 transition-all">
            <FilterIcon className="w-5 h-5" />
          </button>
        </header>

        {/* Mode Toggle */}
        <div className="mb-12">
          <div className="flex p-1.5 bg-[#161616] rounded-2xl border border-white/5 max-w-[300px]">
            <button 
              onClick={() => setMode('global')}
              className={`flex-1 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all duration-300 ${mode === 'global' ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-slate-400 hover:text-slate-200'}`}
              style={{ backgroundColor: mode === 'global' ? 'var(--app-primary-color)' : '' }}
            >
              Global
            </button>
            <button 
              onClick={() => setMode('friends')}
              className={`flex-1 py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all duration-300 ${mode === 'friends' ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-slate-400 hover:text-slate-200'}`}
              style={{ backgroundColor: mode === 'friends' ? 'var(--app-primary-color)' : '' }}
            >
              Amigos
            </button>
          </div>
        </div>

        {/* Podium Section */}
        <div className="mb-16 flex items-end justify-center gap-2 sm:gap-6 pt-10 px-4">
          {/* Rank 2 */}
          {top3[1] && (
            <div className="flex flex-col items-center flex-1 max-w-[140px]">
              <div className="relative mb-5 group">
                <div className="size-16 sm:size-20 rounded-full border-4 border-slate-600 overflow-hidden shadow-2xl group-hover:scale-105 transition-transform duration-500">
                  <Avatar name={top3[1].username} className="w-full h-full text-lg" />
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-slate-600 text-white px-3 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest shadow-lg">2º</div>
              </div>
              <div className="h-24 sm:h-28 w-full bg-[#161616]/40 rounded-t-2xl flex flex-col items-center justify-center p-3 border-t border-x border-white/5 backdrop-blur-sm">
                <span className="text-[10px] sm:text-xs font-bold text-white truncate w-full text-center mb-1">{top3[1].username}</span>
                <span className="text-[9px] sm:text-[10px] font-bold text-primary uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>LVL {top3[1].level}</span>
              </div>
            </div>
          )}

          {/* Rank 1 */}
          {top3[0] && (
            <div className="flex flex-col items-center flex-1 max-w-[180px] -mt-8">
              <div className="relative mb-6 group">
                <Crown className="absolute -top-8 sm:-top-10 left-1/2 -translate-x-1/2 text-primary w-10 h-10 sm:w-12 sm:h-12 animate-bounce transition-transform" style={{ color: 'var(--app-primary-color)' }} />
                <div className="size-20 sm:size-28 rounded-full border-4 border-primary overflow-hidden shadow-[0_0_30px_rgba(var(--app-primary-color-rgb),0.3)] group-hover:scale-105 transition-transform duration-500" style={{ borderColor: 'var(--app-primary-color)' }}>
                  <Avatar name={top3[0].username} className="w-full h-full text-2xl" />
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-primary text-black px-4 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] shadow-xl whitespace-nowrap" style={{ backgroundColor: 'var(--app-primary-color)' }}>CAMPEÃO</div>
              </div>
              <div className="h-30 sm:h-36 w-full bg-primary/10 rounded-t-[2.5rem] flex flex-col items-center justify-center p-4 border-x border-t border-primary/20 backdrop-blur-md">
                <span className="text-sm sm:text-base font-bold text-white truncate w-full text-center mb-1 tracking-tight">{top3[0].username}</span>
                <span className="text-[10px] sm:text-xs font-bold text-primary uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>LVL {top3[0].level}</span>
              </div>
            </div>
          )}

          {/* Rank 3 */}
          {top3[2] && (
            <div className="flex flex-col items-center flex-1 max-w-[140px]">
              <div className="relative mb-5 group">
                <div className="size-16 sm:size-20 rounded-full border-4 border-orange-900 overflow-hidden shadow-2xl group-hover:scale-105 transition-transform duration-500">
                  <Avatar name={top3[2].username} className="w-full h-full text-lg" />
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-orange-900 text-white px-3 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest shadow-lg">3º</div>
              </div>
              <div className="h-20 sm:h-24 w-full bg-[#161616]/40 rounded-t-2xl flex flex-col items-center justify-center p-3 border-t border-x border-white/5 backdrop-blur-sm">
                <span className="text-[10px] sm:text-xs font-bold text-white truncate w-full text-center mb-1">{top3[2].username}</span>
                <span className="text-[9px] sm:text-[10px] font-bold text-primary uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>LVL {top3[2].level}</span>
              </div>
            </div>
          )}
        </div>

        {/* Leaderboard List */}
        <div className="flex flex-col gap-4 mb-24 max-w-[800px] mx-auto w-full">
          <div className="flex items-center px-6 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">
            <span className="w-8 sm:w-10">POS</span>
            <span className="flex-1 px-4">USUÁRIO</span>
            <span className="text-right">EXPERIÊNCIA</span>
          </div>

          {others.map((player, idx) => {
            const position = idx + 4;
            const isMe = player.username === user?.username;
            
            return (
              <div 
                key={player.username}
                className={`flex items-center p-4 sm:p-5 rounded-2xl border transition-all duration-300 group ${isMe ? 'bg-primary/5 border-primary/30 relative overflow-hidden' : 'bg-[#161616]/40 border-white/5 hover:border-white/10'}`}
              >
                {isMe && <div className="absolute left-0 top-0 bottom-0 w-1 sm:w-1.5 bg-primary" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>}
                
                <span className={`w-8 sm:w-10 font-bold text-sm ${isMe ? 'text-primary' : 'text-slate-500'}`} style={{ color: isMe ? 'var(--app-primary-color)' : '' }}>{position}</span>
                
                <div className={`size-10 sm:size-12 rounded-full overflow-hidden mx-2 sm:mx-4 shrink-0 transition-transform duration-500 group-hover:scale-110 ${isMe ? 'border-2 border-primary shadow-[0_0_15px_rgba(var(--app-primary-color-rgb),0.2)]' : 'border border-white/10'}`} style={{ borderColor: isMe ? 'var(--app-primary-color)' : '' }}>
                  <Avatar name={player.username} className="w-full h-full" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className={`text-sm sm:text-base font-bold truncate ${isMe ? 'text-white' : 'text-slate-200'}`}>{isMe ? `Você (${player.username})` : player.username}</p>
                  <p className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mt-0.5 ${isMe ? 'text-primary' : 'text-slate-500'}`} style={{ color: isMe ? 'var(--app-primary-color)' : '' }}>
                    {isMe ? 'TOP 5% GLOBALMENTE' : 'ATLETA ELITE'}
                  </p>
                </div>
                
                <div className="text-right shrink-0">
                  <p className="text-sm sm:text-base font-bold text-white mb-0.5">LVL {player.level}</p>
                  <p className="text-[10px] font-bold text-primary uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>
                    {(player.xp / 1000).toFixed(1)}K XP
                  </p>
                </div>
              </div>
            );
          })}

          {ranking.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Trophy className="w-16 h-16 text-white/5 mb-6" />
              <p className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.2em]">Nenhum competidor encontrado.</p>
            </div>
          )}
        </div>

      </div>
    </AppPageShell>
  );
}
