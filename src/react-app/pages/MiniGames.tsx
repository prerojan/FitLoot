import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/react-app/contexts/auth";
import { useNavigate, useSearchParams } from "react-router";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import { 
  Swords, 
  Trophy, 
  Clock, 
  Zap, 
  Target, 
  Users, 
  ChevronRight, 
  Search as SearchIcon, 
  UserPlus as UserPlusIcon, 
  Check, 
  X, 
  Shield, 
  Info as InfoIcon,
  Plus as PlusIcon
} from "lucide-react";
import { ApiRequestError, api, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
import { Avatar } from "@/react-app/components/ui/avatar";

interface MiniGame {
  id: number;
  challenger_user_id: string;
  challenger_username: string;
  challenged_user_id: string;
  challenged_username: string;
  skill_name: string;
  target_reps: number;
  status: string;
  winner_user_id: string | null;
  xp_reward: number;
  points_reward: number;
  deadline: string;
  created_at: string;
}

interface MiniGameSkill {
  id: number;
  name: string;
  category: string;
  difficulty: string;
}

interface Friend {
  id: number;
  friend_user_id: string;
  friend_username: string;
  friend_full_name: string;
  status: string;
}

interface SearchResult {
  user_id: string;
  username: string;
  full_name: string;
  level: number;
}

export default function MiniGames() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const challengeUserId = searchParams.get('challenge');
  
  const [activeGames, setActiveGames] = useState<MiniGame[]>([]);
  const [completedGames, setCompletedGames] = useState<MiniGame[]>([]);
  const [skills, setSkills] = useState<MiniGameSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(!!challengeUserId);
  const [error, setError] = useState<string | null>(null);
  
  // Arena Dashboard States
  const [pendingRequests, setPendingRequests] = useState<Friend[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [viewMode, setViewMode] = useState<'live' | 'tournaments'>('live');

  // Create challenge form
  const [selectedSkill, setSelectedSkill] = useState<number | null>(null);
  const [targetReps, setTargetReps] = useState(20);
  const [opponentType, setOpponentType] = useState<'friend' | 'random'>(challengeUserId ? 'friend' : 'random');

  const loadGames = useCallback(async () => {
    setError(null);
    const cacheGames = readCachedJson<MiniGame[]>("/api/mini-games/active");

    if (cacheGames) {
      const list = Array.isArray(cacheGames.data) ? cacheGames.data : [];
      setActiveGames(list.filter((game) => game.status !== "completed"));
      setCompletedGames(list.filter((game) => game.status === "completed").slice(0, 10));
      setLoading(false);
      if (!cacheGames.stale) {
        return;
      }
    }

    try {
      const data = await fetchAndCacheJson<MiniGame[]>("/api/mini-games/active");
      const list = Array.isArray(data) ? data : [];
      setActiveGames(list.filter((game) => game.status !== "completed"));
      setCompletedGames(list.filter((game) => game.status === "completed").slice(0, 10));
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app");
        return;
      }
      console.error("Error loading games:", loadError);
      if (!cacheGames) {
        setError("Não foi possível carregar os mini-games agora.");
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const loadSkills = useCallback(async () => {
    const cacheSkills = readCachedJson<MiniGameSkill[]>("/api/skills");
    if (cacheSkills) {
      setSkills(Array.isArray(cacheSkills.data) ? cacheSkills.data : []);
      if (!cacheSkills.stale) return;
    }

    try {
      const data = await fetchAndCacheJson<MiniGameSkill[]>("/api/skills");
      setSkills(Array.isArray(data) ? data : []);
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app");
        return;
      }
      console.error("Error loading skills:", loadError);
      if (!cacheSkills) {
        setError("Não foi possível carregar habilidades para desafio.");
      }
    }
  }, [navigate]);

  const loadArenaData = useCallback(async () => {
    try {
      const requestsRes = await api("/api/friends/requests");

      if (requestsRes.status === 401) {
        navigate("/app");
        return;
      }

      if (requestsRes.ok) {
        const requestsData = await requestsRes.json();
        setPendingRequests(Array.isArray(requestsData) ? requestsData : []);
      }
    } catch (err) {
      console.error("Error loading arena dashboard data:", err);
    }
  }, [navigate]);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    void loadGames();
    void loadSkills();
    void loadArenaData();
  }, [user, navigate, loadGames, loadSkills, loadArenaData]);

  const searchUsers = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const response = await api(`/api/friends/search?username=${encodeURIComponent(searchQuery.trim())}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error searching users:", err);
    } finally {
      setSearching(false);
    }
  };

  const sendFriendRequest = async (friendUserId: string) => {
    try {
      const response = await api("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friend_user_id: friendUserId })
      });
      if (response.ok) {
        setSearchQuery("");
        setSearchResults([]);
        alert("Solicitação enviada!");
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.error || "Erro ao enviar solicitação.");
      }
    } catch (err) {
      console.error("Error sending request:", err);
    }
  };

  const manageRequest = async (requestId: number, accept: boolean) => {
    try {
      const response = await api(accept ? "/api/friends/accept" : "/api/friends/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      });
      if (response.ok) {
        void loadArenaData();
      }
    } catch (err) {
      console.error("Error managing request:", err);
    }
  };

  const createChallenge = async () => {
    if (!selectedSkill) {
      alert("Selecione uma habilidade!");
      return;
    }

    try {
      const response = await api("/api/mini-games/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenged_user_id: challengeUserId || null,
          skill_id: selectedSkill,
          target_reps: targetReps,
          opponent_type: opponentType
        })
      });

      if (response.ok) {
        alert("Desafio criado com sucesso!");
        setShowCreateForm(false);
        void loadGames();
      } else {
        const responseError = await response.json().catch(() => ({}));
        alert(responseError?.error || "Erro ao criar desafio");
      }
    } catch (error) {
      console.error("Error creating challenge:", error);
    }
  };

  const acceptChallenge = async (gameId: number) => {
    try {
      const response = await api(`/api/mini-games/${gameId}/accept`, {
        method: "POST"
      });
      if (response.ok) {
        void loadGames();
      }
    } catch (err) {
      console.error("Error accepting challenge:", err);
    }
  };

  const completeChallenge = async (gameId: number, repsCompleted: number, timeSeconds: number) => {
    try {
      const response = await api(`/api/mini-games/${gameId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reps_completed: repsCompleted,
          time_seconds: timeSeconds
        })
      });
      if (response.ok) {
        void loadGames();
      }
    } catch (err) {
      console.error("Error completing challenge:", err);
    }
  };

  if (loading) {
    return (
      <AppPageShell bottomNavActive="arena" className="bg-[#0A0A0A]">
        <div className="flex-1 flex items-center justify-center">
          <LoadingBall size="md" />
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell bottomNavActive="arena" className="bg-[#0A0A0A]">
      <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar p-6 sm:p-8">
        
        {/* Header Hero Section */}
        <section className="mb-12">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between mb-10">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-white uppercase tracking-[0.2em] mb-2">Battle Ground</h1>
              <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">A glória espera por você no Coliseu Digital.</p>
            </div>
            
            <div className="flex bg-[#161616] p-1.5 rounded-full border border-white/5 self-start">
              <button 
                onClick={() => setViewMode('live')}
                className={`px-6 py-2.5 rounded-full font-bold text-[10px] uppercase tracking-[0.15em] transition-all duration-300 ${viewMode === 'live' ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-slate-500 hover:text-slate-300'}`}
                style={{ backgroundColor: viewMode === 'live' ? 'var(--app-primary-color)' : '' }}
              >
                Duelos Ao Vivo
              </button>
              <button 
                onClick={() => setViewMode('tournaments')}
                className={`px-6 py-2.5 rounded-full font-bold text-[10px] uppercase tracking-[0.15em] transition-all duration-300 ${viewMode === 'tournaments' ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'text-slate-500 hover:text-slate-300'}`}
                style={{ backgroundColor: viewMode === 'tournaments' ? 'var(--app-primary-color)' : '' }}
              >
                Torneios
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Live Battle Cards */}
            {activeGames.map((game) => (
              <BattleCard 
                key={game.id} 
                game={game} 
                onAccept={acceptChallenge} 
                onComplete={completeChallenge} 
                userId={user?.id || ""} 
              />
            ))}

            {/* Create Duel Card */}
            <button 
              onClick={() => setShowCreateForm(true)}
              className="flex flex-col justify-center items-center p-8 rounded-[2.5rem] border-2 border-dashed border-white/10 bg-[#161616]/30 group hover:border-primary/30 hover:bg-primary/[0.02] transition-all duration-500 min-h-[220px]"
            >
              <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-5 group-hover:scale-110 group-hover:bg-primary/20 transition-all duration-500">
                <PlusIcon className="w-8 h-8 text-primary" style={{ color: 'var(--app-primary-color)' }} />
              </div>
              <h4 className="font-bold text-white uppercase text-[11px] tracking-[0.25em]">Criar Duelo Privado</h4>
              <p className="text-slate-500 text-[9px] text-center mt-3 uppercase tracking-widest leading-relaxed max-w-[200px]">Desafie um guerreiro específico e defina as regras do combate.</p>
            </button>
          </div>
        </section>

        {/* Modal Overlay for Challenge Creation */}
        {showCreateForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/90 backdrop-blur-md animate-fadeIn">
            <div className="bg-[#111111] border border-white/10 w-full max-w-xl rounded-[3rem] p-10 shadow-3xl">
               <div className="flex justify-between items-start mb-10">
                 <div>
                   <h2 className="text-2xl font-bold text-white uppercase tracking-[0.2em] mb-2">Novo Desafio</h2>
                   <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Configure os parâmetros da sua vitória.</p>
                 </div>
                 <button onClick={() => setShowCreateForm(false)} className="text-slate-500 hover:text-white transition-colors">
                   <X className="w-6 h-6" />
                 </button>
               </div>
               
               <div className="space-y-10">
                 <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.25em] mb-5">Seletor de Oponente</label>
                    <div className="flex gap-4">
                       <button onClick={() => setOpponentType('friend')} className={`flex-1 py-4 rounded-2xl font-bold text-[10px] uppercase tracking-widest transition-all border ${opponentType === 'friend' ? 'bg-primary text-black border-primary' : 'bg-[#0A0A0A] text-slate-500 border-white/5 hover:border-white/10'}`} style={{ backgroundColor: opponentType === 'friend' ? 'var(--app-primary-color)' : '', borderColor: opponentType === 'friend' ? 'var(--app-primary-color)' : '' }}>Amigo</button>
                       <button onClick={() => setOpponentType('random')} className={`flex-1 py-4 rounded-2xl font-bold text-[10px] uppercase tracking-widest transition-all border ${opponentType === 'random' ? 'bg-primary text-black border-primary' : 'bg-[#0A0A0A] text-slate-500 border-white/5 hover:border-white/10'}`} style={{ backgroundColor: opponentType === 'random' ? 'var(--app-primary-color)' : '', borderColor: opponentType === 'random' ? 'var(--app-primary-color)' : '' }}>Aleatório</button>
                    </div>
                 </div>
                 
                 <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.25em] mb-4">Habilidade Especial</label>
                    <div className="relative">
                      <select 
                        value={selectedSkill || ''} 
                        onChange={(e) => setSelectedSkill(parseInt(e.target.value))}
                        className="w-full bg-[#0A0A0A] border border-white/5 rounded-2xl p-5 text-white text-[11px] font-bold uppercase tracking-widest focus:ring-1 focus:ring-primary focus:outline-none appearance-none"
                      >
                        <option value="">Selecione Técnica de Combate...</option>
                        {skills.map(s => <option key={s.id} value={s.id}>{s.name} ({s.difficulty})</option>)}
                      </select>
                      <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 rotate-90" />
                    </div>
                 </div>
                 
                 <div>
                    <div className="flex justify-between items-center mb-5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.25em]">Meta de Intensidade</label>
                      <span className="text-primary font-bold text-lg tracking-widest" style={{ color: 'var(--app-primary-color)' }}>{targetReps} REPS</span>
                    </div>
                    <input type="range" min="10" max="100" step="5" value={targetReps} onChange={(e) => setTargetReps(parseInt(e.target.value))} className="w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-primary" style={{ accentColor: 'var(--app-primary-color)' }} />
                 </div>
                 
                 <div className="flex gap-4 pt-6">
                    <button onClick={createChallenge} className="flex-1 py-5 rounded-full font-bold text-xs uppercase tracking-[0.25em] bg-primary text-black shadow-xl shadow-primary/20 hover:scale-[1.02] transition-all duration-300" style={{ backgroundColor: 'var(--app-primary-color)' }}>Lançar Desafio</button>
                 </div>
               </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Main Content Column */}
          <div className="lg:col-span-8 space-y-12">
            <section>
              <div className="flex items-center gap-3 mb-8">
                <SearchIcon className="w-5 h-5 text-primary" style={{ color: 'var(--app-primary-color)' }} />
                <h3 className="text-xl font-bold tracking-tight text-white uppercase tracking-[0.2em]">Encontrar Guerreiros</h3>
              </div>
              
              <div className="bg-[#161616] border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
                 <div className="p-6 border-b border-white/5 flex gap-4 bg-[#0A0A0A]/30">
                    <div className="relative flex-1">
                       <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                       <input 
                         type="text" 
                         placeholder="Username ou Ranking..." 
                         value={searchQuery}
                         onChange={(e) => setSearchQuery(e.target.value)}
                         onKeyPress={(e) => e.key === 'Enter' && searchUsers()}
                         className="w-full bg-[#0A0A0A] border border-white/5 rounded-2xl pl-12 pr-4 py-4 text-xs font-bold uppercase tracking-widest text-white placeholder:text-slate-700 focus:ring-1 focus:ring-primary focus:outline-none transition-all"
                       />
                    </div>
                    <button onClick={searchUsers} className="bg-primary px-8 rounded-2xl text-black text-[10px] font-bold uppercase tracking-[0.2em] hover:brightness-110 transition-all transition-all duration-300" style={{ backgroundColor: 'var(--app-primary-color)' }}>
                      {searching ? "..." : "Buscar"}
                    </button>
                 </div>
                 
                 <div className="divide-y divide-white/5">
                    {searchResults.length === 0 ? (
                      <div className="p-16 text-center">
                        <Users className="w-12 h-12 text-white/5 mx-auto mb-5" />
                        <p className="text-[10px] text-slate-600 font-bold uppercase tracking-[0.2em]">Inicie uma busca e encontre novos rivais.</p>
                      </div>
                    ) : (
                      searchResults.map((res) => (
                        <div key={res.user_id} className="p-6 flex items-center justify-between hover:bg-white/[0.02] transition-colors group">
                           <div className="flex items-center gap-5">
                              <Avatar name={res.full_name || res.username} className="size-14 rounded-full border border-white/10 bg-[#0A0A0A]" />
                              <div>
                                 <h5 className="font-bold text-white group-hover:text-primary transition-colors text-base tracking-tight">{res.username}</h5>
                                 <div className="flex items-center gap-2 mt-1.5">
                                    <Badge className="bg-primary/10 text-primary border border-primary/20 text-[8px] font-bold uppercase px-2 py-0.5" style={{ color: 'var(--app-primary-color)' }}>Nv. {res.level}</Badge>
                                    <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.1em]">{res.level > 10 ? 'Mestre da Arena' : 'Explorador'}</p>
                                 </div>
                              </div>
                           </div>
                           <button onClick={() => sendFriendRequest(res.user_id)} className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-black px-8 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] transition-all duration-300" style={{ color: 'var(--app-primary-color)' }}>Desafiar</button>
                        </div>
                      ))
                    )}
                 </div>
              </div>
            </section>
          </div>

          {/* Sidebar Column */}
          <div className="lg:col-span-4 space-y-10">
            <section>
              <div className="flex items-center gap-3 mb-8">
                <UserPlusIcon className="w-5 h-5 text-primary" style={{ color: 'var(--app-primary-color)' }} />
                <h3 className="text-xl font-bold tracking-tight text-white uppercase tracking-[0.2em]">Solicitações</h3>
              </div>
              
              <div className="flex flex-col gap-5">
                {pendingRequests.length === 0 ? (
                  <div className="p-10 text-center bg-[#161616] rounded-3xl border border-dashed border-white/5">
                    <InfoIcon className="w-10 h-10 text-white/5 mx-auto mb-4" />
                    <p className="text-[9px] text-slate-600 font-bold uppercase tracking-[0.2em]">Nenhuma solicitação de duelo recebida.</p>
                  </div>
                ) : (
                  pendingRequests.map((req) => (
                    <div key={req.id} className="bg-[#161616] border border-white/5 p-6 rounded-[2.5rem] shadow-xl group">
                       <div className="flex items-center gap-4 mb-6">
                         <Avatar name={req.friend_full_name} className="size-12 rounded-full border border-white/10 shadow-lg" />
                         <div>
                            <h5 className="font-bold text-sm text-white tracking-tight">{req.friend_username}</h5>
                            <p className="text-[9px] text-primary font-bold uppercase tracking-[0.2em] mt-1" style={{ color: 'var(--app-primary-color)' }}>Desafio Recebido</p>
                         </div>
                       </div>
                       <div className="flex gap-3">
                          <button onClick={() => manageRequest(req.id, true)} className="flex-1 bg-primary text-black font-bold py-3.5 rounded-2xl text-[10px] uppercase tracking-[0.2em] hover:brightness-110 transition-all duration-300 shadow-lg shadow-primary/10" style={{ backgroundColor: 'var(--app-primary-color)' }}>Aceitar</button>
                          <button onClick={() => manageRequest(req.id, false)} className="flex-1 bg-white/5 text-slate-500 font-bold py-3.5 rounded-2xl text-[10px] uppercase tracking-[0.2em] hover:bg-white/10 hover:text-white transition-all duration-300">Recusar</button>
                       </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Tournament Side Banner */}
            <section>
              <div className="rounded-[3rem] bg-gradient-to-br from-[#122017] to-[#0A0A0A] border border-white/5 p-10 text-white overflow-hidden relative group shadow-3xl">
                <div className="absolute top-0 right-0 w-40 h-40 bg-primary/20 blur-[80px] -mr-20 -mt-20 group-hover:bg-primary/30 transition-all duration-700" style={{ backgroundColor: 'rgba(57, 224, 121, 0.2)' }}></div>
                <Trophy className="absolute -right-8 -bottom-8 size-48 text-white/5 group-hover:scale-110 group-hover:text-primary/10 transition-all duration-700" />
                
                <h3 className="text-2xl font-bold mb-3 tracking-tighter uppercase italic">Weekend Brawl</h3>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-8 ml-1" style={{ color: 'var(--app-primary-color)' }}>Season 4 • Final Match</p>
                
                <div className="space-y-4 mb-10 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <div className="flex items-center gap-3">
                    <div className="size-1.5 rounded-full bg-primary" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>
                    <span>Prize Pool: 50,000 Points</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="size-1.5 rounded-full bg-primary" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>
                    <span>Data: 23 Março, 20:00</span>
                  </div>
                </div>

                <button className="w-full bg-white text-black font-bold py-4 rounded-full text-[10px] uppercase tracking-[0.3em] shadow-2xl hover:bg-primary hover:text-black hover:scale-[1.03] active:scale-95 transition-all duration-300" style={{ ':hover': { backgroundColor: 'var(--app-primary-color)' } } as any}>
                  Pré-registrar
                </button>
              </div>
            </section>
          </div>
        </div>

        {/* Desktop Footer */}
        <footer className="mt-32 pt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-slate-600 text-[10px] font-bold uppercase tracking-[0.3em] gap-8 pb-16">
          <p>© 2024 FitLoot Arena • Desafie Seus Limites.</p>
          <div className="flex gap-10">
            <a href="#" className="hover:text-primary transition-all duration-300">Regras do Coliseu</a>
            <a href="#" className="hover:text-primary transition-all duration-300">Suporte</a>
            <a href="#" className="hover:text-primary transition-all duration-300">Condições</a>
          </div>
        </footer>
      </div>
    </AppPageShell>
  );
}

function BattleCard({ game, onAccept, onComplete, userId }: { 
  game: MiniGame, 
  onAccept: (id: number) => void, 
  onComplete: (id: number, r: number, t: number) => void,
  userId: string 
}) {
  const isChallenger = game.challenger_user_id === userId;
  const isPending = game.status === 'pending';
  const isActive = game.status === 'active';

  return (
    <div className="relative group overflow-hidden rounded-[3rem] bg-[#161616] border border-white/10 transition-all duration-500 hover:shadow-3xl hover:shadow-primary/10 hover:border-primary/20">
      <div 
        className="aspect-[16/10] w-full bg-cover bg-center group-hover:scale-110 transition-transform duration-1000 opacity-50 grayscale group-hover:grayscale-0" 
        style={{ backgroundImage: `url('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&q=80')` }}
      ></div>
      <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/60 to-transparent"></div>
      
      <div className="absolute top-6 left-6 flex gap-2">
        <span className={`px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] border shadow-2xl ${isPending ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 'bg-primary/10 text-primary border-primary/20'}`} style={{ color: isPending ? '' : 'var(--app-primary-color)', borderColor: isPending ? '' : 'rgba(57, 224, 121, 0.2)' }}>
          {isPending ? 'Aguardando' : 'Live Arena'}
        </span>
      </div>

      <div className="absolute bottom-0 left-0 p-8 w-full">
        <div className="flex justify-between items-end gap-4">
          <div className="flex-1">
            <h4 className="text-xl font-bold text-white mb-2 tracking-tight group-hover:text-primary transition-colors">{game.skill_name}</h4>
            <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
               <span className="flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-amber-500" /> {game.points_reward} Loot</span>
               <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-primary" style={{ color: 'var(--app-primary-color)' }} /> {game.target_reps} Reps</span>
            </div>
            <p className="text-[10px] text-slate-600 mt-4 tracking-[0.15em] uppercase font-bold">vs {isChallenger ? game.challenged_username : game.challenger_username}</p>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            {isPending && !isChallenger && (
              <button onClick={() => onAccept(game.id)} className="bg-primary text-black font-bold py-3 px-8 rounded-2xl text-[10px] uppercase tracking-[0.2em] shadow-xl hover:scale-105 active:scale-95 transition-all duration-300" style={{ backgroundColor: 'var(--app-primary-color)' }}>Aceitar</button>
            )}
            
            {isActive && (
              <button 
                onClick={() => {
                  const r = parseInt(prompt(`Meta: ${game.target_reps}. Quantas completou?`) || '0');
                  const t = parseInt(prompt(`Tempo (seg)?`) || '0');
                  if (r > 0) onComplete(game.id, r, t);
                }}
                className="bg-primary text-black font-bold py-3 px-8 rounded-2xl text-[10px] uppercase tracking-[0.2em] shadow-xl hover:scale-105 active:scale-95 transition-all duration-300"
                style={{ backgroundColor: 'var(--app-primary-color)' }}
              >
                Vencer
              </button>
            )}
            
            {isPending && isChallenger && (
              <div className="bg-white/5 border border-white/5 py-3 px-6 rounded-2xl">
                 <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest animate-pulse">Pendente</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
