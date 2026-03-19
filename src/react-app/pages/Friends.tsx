import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { 
  Check, 
  Search, 
  UserPlus, 
  X, 
  Flame, 
  MoreVertical,
  UserPlus2,
  Clock,
  ShieldCheck,
  TrendingUp
} from "lucide-react";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Avatar } from "@/react-app/components/ui/avatar";
import { Button } from "@/react-app/components/ui/button";
import { ROUTE_PATHS } from "@/react-app/constants/auth";
import { api } from "@/react-app/utils/api";
import AppPageShell from "@/react-app/components/AppPageShell";
import { useAuth } from "@/react-app/contexts/auth";

type Friend = {
  id: number;
  friend_user_id: string;
  friend_username: string;
  friend_full_name: string;
  friend_level: number;
  friend_xp: number;
  friend_streak: number;
  status?: string | undefined;
  is_online?: boolean; // Mocked for design
};

type SearchResult = {
  user_id: string;
  username: string;
  full_name: string;
  level: number;
  xp: number;
};

type TabType = 'friends' | 'received' | 'sent';

const FRIENDS_CACHE_TTL_MS = 60_000;

let friendsCache:
  | {
      cachedAt: number;
      friends: Friend[];
      pending: Friend[];
    }
  | null = null;

export default function Friends() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<Friend[]>([]);
  const [sentRequests] = useState<Friend[]>([]); // Mocked sent requests as API doesn't fully support separate sent list yet
  const [activeTab, setActiveTab] = useState<TabType>('friends');
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyCachedFriends = useCallback((cache: { friends: Friend[]; pending: Friend[] }) => {
    // We add a mock is_online for visual flair as requested by premium design
    setFriends(cache.friends.map(f => ({ ...f, is_online: Math.random() > 0.4 })));
    setReceivedRequests(cache.pending);
    setLoading(false);
  }, []);

  const loadFriends = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && friendsCache) {
      applyCachedFriends({ friends: friendsCache.friends, pending: friendsCache.pending });
      if (Date.now() - friendsCache.cachedAt < FRIENDS_CACHE_TTL_MS) {
        return;
      }
    }

    try {
      setError(null);
      const [friendsRes, requestsRes] = await Promise.all([
        api("/api/friends"),
        api("/api/friends/requests"),
      ]);

      if (friendsRes.status === 401 || friendsRes.status === 403 || requestsRes.status === 401 || requestsRes.status === 403) {
        navigate("/app");
        return;
      }

      if (!friendsRes.ok || !requestsRes.ok) {
        throw new Error("Falha ao carregar amigos.");
      }

      const friendsData = (await friendsRes.json()) as Friend[];
      const requestsData = (await requestsRes.json()) as Friend[];
      const nextFriends = Array.isArray(friendsData) ? friendsData : [];
      const nextPending = Array.isArray(requestsData) ? requestsData : [];

      setFriends(nextFriends.map(f => ({ ...f, is_online: Math.random() > 0.4 })));
      setReceivedRequests(nextPending);
      friendsCache = { cachedAt: Date.now(), friends: nextFriends, pending: nextPending };
    } catch {
      setError("Não foi possível carregar a lista de amigos agora.");
    } finally {
      setLoading(false);
    }
  }, [applyCachedFriends, navigate]);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    void loadFriends();
  }, [user, navigate, loadFriends]);

  const searchUsers = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const response = await api(`/api/friends/search?username=${encodeURIComponent(searchQuery.trim())}`);
      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }
      if (!response.ok) {
        throw new Error("Falha na busca de usuários.");
      }
      const payload = (await response.json()) as SearchResult[];
      setSearchResults(Array.isArray(payload) ? payload : []);
    } catch {
      setError("Não foi possível buscar usuários agora.");
    } finally {
      setSearching(false);
    }
  };

  const sendFriendRequest = async (friendUserId: string) => {
    try {
      const response = await api("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friend_user_id: friendUserId }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        setError(payload?.error ?? "Não foi possível enviar solicitação.");
        return;
      }

      setSearchQuery("");
      setSearchResults([]);
      setActiveTab('friends');
      await loadFriends(true);
    } catch {
      setError("Não foi possível enviar solicitação.");
    }
  };

  const respondRequest = async (requestId: number, accept: boolean) => {
    try {
      const response = await api(accept ? "/api/friends/accept" : "/api/friends/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        setError(payload?.error ?? "Não foi possível responder a solicitação.");
        return;
      }

      await loadFriends(true);
    } catch {
      setError("Não foi possível responder a solicitação.");
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

  const onlineFriends = friends.filter(f => f.is_online);
  const offlineFriends = friends.filter(f => !f.is_online);

  return (
    <AppPageShell bottomNavActive="arena" className="bg-[#0A0A0A]">
      <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden bg-[#0A0A0A]">
        
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8">
          
          {/* Header */}
          <header className="mb-10">
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight uppercase tracking-[0.2em] mb-2 leading-none">Social Hub</h1>
            <p className="font-bold text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--app-primary-color)' }}>Sua rede de elite e alianças estratégicas.</p>
            {error && (
              <div className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-bold uppercase tracking-widest">
                {error}
              </div>
            )}
          </header>

          {/* Search Area */}
          <div className="relative mb-10 group">
            <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
              <Search className="w-5 h-5 text-slate-500 group-focus-within:text-primary transition-colors" />
            </div>
            <input 
              type="text" 
              placeholder="Buscar por username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
              className="w-full bg-[#161616] border border-white/5 rounded-2xl py-5 pl-14 pr-6 text-white placeholder-slate-600 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-sm font-medium"
            />
            <button 
              onClick={searchUsers}
              disabled={searching}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-black px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg"
              style={{ backgroundColor: 'var(--app-primary-color)' }}
            >
              {searching ? <LoadingBall size="sm" /> : 'Buscar'}
            </button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mb-12 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Resultados da Busca</h3>
                <button onClick={() => setSearchResults([])} className="text-[10px] font-bold text-primary uppercase tracking-widest hover:underline" style={{ color: 'var(--app-primary-color)' }}>Limpar</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {searchResults.map((result) => (
                  <div key={result.user_id} className="bg-[#161616] border border-white/5 rounded-2xl p-4 flex items-center justify-between group hover:border-primary/20 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="size-12 rounded-full border-2 border-white/5 overflow-hidden group-hover:border-primary/30 transition-all">
                        <Avatar name={result.username} className="w-full h-full" />
                      </div>
                      <div>
                        <h4 className="text-white font-bold text-sm tracking-tight">{result.username}</h4>
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>Lv {result.level}</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => sendFriendRequest(result.user_id)}
                      className="p-2.5 rounded-xl bg-white/5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-all"
                    >
                      <UserPlus className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-8 mb-8 border-b border-white/5 overflow-x-auto no-scrollbar">
            <button 
              onClick={() => setActiveTab('friends')}
              className={`pb-4 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative whitespace-nowrap ${activeTab === 'friends' ? 'text-primary' : 'text-slate-500 hover:text-slate-300'}`}
              style={{ color: activeTab === 'friends' ? 'var(--app-primary-color)' : '' }}
            >
              Meus Amigos ({friends.length})
              {activeTab === 'friends' && <div className="absolute bottom-0 left-0 w-full h-0.5 shadow-[0_0_12px_var(--app-primary-color)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>}
            </button>
            <button 
              onClick={() => setActiveTab('received')}
              className={`pb-4 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative whitespace-nowrap ${activeTab === 'received' ? 'text-primary' : 'text-slate-500 hover:text-slate-300'}`}
              style={{ color: activeTab === 'received' ? 'var(--app-primary-color)' : '' }}
            >
              Pedidos Recebidos ({receivedRequests.length})
              {activeTab === 'received' && <div className="absolute bottom-0 left-0 w-full h-0.5 shadow-[0_0_12px_var(--app-primary-color)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>}
            </button>
            <button 
              onClick={() => setActiveTab('sent')}
              className={`pb-4 text-[10px] font-bold uppercase tracking-[0.2em] transition-all relative whitespace-nowrap ${activeTab === 'sent' ? 'text-primary' : 'text-slate-500 hover:text-slate-300'}`}
              style={{ color: activeTab === 'sent' ? 'var(--app-primary-color)' : '' }}
            >
              Pedidos Enviados ({sentRequests.length})
              {activeTab === 'sent' && <div className="absolute bottom-0 left-0 w-full h-0.5 shadow-[0_0_12px_var(--app-primary-color)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>}
            </button>
          </div>

          {/* List Content */}
          <div className="space-y-12 pb-24">
            {activeTab === 'friends' && (
              <>
                {/* Online Friends */}
                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <div className="size-1.5 rounded-full animate-pulse shadow-[0_0_8px_var(--app-primary-color)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>
                    <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Amigos Online — {onlineFriends.length}</h2>
                  </div>
                  
                  {onlineFriends.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                      {onlineFriends.map((friend) => (
                        <div key={friend.id} className="bg-[#161616] border border-white/5 rounded-[2rem] p-5 group hover:border-primary/30 transition-all relative overflow-hidden">
                          <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="text-slate-600 hover:text-white"><MoreVertical className="w-4 h-4" /></button>
                          </div>
                          <div className="flex items-center gap-4 mb-4">
                            <div className="relative size-14 shrink-0">
                              <div className="w-full h-full rounded-full border-2 overflow-hidden shadow-[0_0_15px_rgba(var(--app-primary-color-rgb),0.2)]" style={{ borderColor: 'var(--app-primary-color)' }}>
                                <Avatar name={friend.friend_username} className="w-full h-full" />
                              </div>
                              <div className="absolute -bottom-1 -right-1 size-5 rounded-full bg-[#161616] flex items-center justify-center border border-white/10">
                                <ShieldCheck className="w-3 h-3" style={{ color: 'var(--app-primary-color)' }} />
                              </div>
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-white font-bold text-base tracking-tight truncate">{friend.friend_username}</h4>
                              <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'var(--app-primary-color)' }}>RANK ELITE</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between pt-4 border-t border-white/5">
                            <div className="flex flex-col">
                              <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">STREAK</span>
                              <div className="flex items-center gap-1.5" style={{ color: 'var(--app-primary-color)' }}>
                                <Flame className="w-4 h-4 fill-current" />
                                <span className="text-sm font-black tracking-tight">{friend.friend_streak}</span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">NÍVEL</span>
                              <span className="text-sm font-black text-white">{friend.friend_level}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-600 text-[11px] font-bold italic uppercase tracking-widest py-12 text-center border border-dashed border-white/5 rounded-3xl">Nenhum guerreiro online no momento.</p>
                  )}
                </section>

                {/* Offline Friends */}
                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <div className="size-1.5 rounded-full bg-slate-700"></div>
                    <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Offline — {offlineFriends.length}</h2>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {offlineFriends.map((friend) => (
                      <div key={friend.id} className="bg-[#161616]/40 border border-white/5 rounded-xl p-4 flex items-center justify-between opacity-60 hover:opacity-100 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="size-11 rounded-full border border-white/10 overflow-hidden grayscale">
                            <Avatar name={friend.friend_username} className="w-full h-full" />
                          </div>
                          <div>
                            <h4 className="text-slate-200 font-bold text-sm tracking-tight truncate max-w-[120px]">{friend.friend_username}</h4>
                            <span className="text-slate-600 text-[9px] font-bold uppercase tracking-widest">Lv {friend.friend_level} • {friend.friend_streak}d</span>
                          </div>
                        </div>
                        <button className="p-2 rounded-lg text-slate-600 hover:text-white transition-colors">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {activeTab === 'received' && (
              <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                {receivedRequests.length > 0 ? (
                  <div className="space-y-4 max-w-2xl mx-auto">
                    {receivedRequests.map((request) => (
                      <div key={request.id} className="bg-[#161616] border border-white/5 rounded-3xl p-6 flex flex-col sm:flex-row items-center gap-6 group hover:border-primary/30 transition-all">
                        <div className="size-16 rounded-full border-2 border-white/5 overflow-hidden group-hover:border-primary/20 transition-all">
                          <Avatar name={request.friend_username} className="w-full h-full text-xl" />
                        </div>
                        <div className="flex-1 text-center sm:text-left">
                          <h4 className="text-white font-bold text-lg mb-1">{request.friend_username}</h4>
                          <div className="flex items-center justify-center sm:justify-start gap-4">
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>LVL {request.friend_level}</span>
                            <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">{request.friend_streak} Dias de Streak</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={() => respondRequest(request.id, true)}
                            className="text-black px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg"
                            style={{ backgroundColor: 'var(--app-primary-color)' }}
                          >
                            Aceitar
                          </button>
                          <button 
                            onClick={() => respondRequest(request.id, false)}
                            className="bg-[#222] text-white px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-red-950 hover:text-red-500 transition-all"
                          >
                            Recusar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <UserPlus2 className="size-16 text-white/5 mb-6" />
                    <p className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.2em]">Nenhum pedido pendente por agora.</p>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'sent' && (
              <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <Clock className="size-16 text-white/5 mb-6" />
                  <p className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.2em]">Sua lista de pedidos enviados está vazia.</p>
                  <Button variant="outline" className="mt-8 border-white/5 text-slate-400 hover:text-white" onClick={() => setActiveTab('friends')}>Voltar ao Hub</Button>
                </div>
              </section>
            )}

          </div>

        </div>

        {/* Sidebar Info */}
        <aside className="w-full md:w-[340px] border-l border-white/5 bg-[#0a0a0a]/50 p-6 md:p-8 flex flex-col gap-8 hidden lg:flex">
          
          <section className="space-y-6">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Pedidos Pendentes</h3>
            {receivedRequests.length > 0 ? (
              <div className="space-y-3">
                {receivedRequests.slice(0, 3).map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-3 bg-[#161616] rounded-2xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.friend_username} className="size-8 text-[10px]" />
                      <span className="text-white font-bold text-xs truncate max-w-[80px]">{r.friend_username}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => respondRequest(r.id, true)} className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary hover:text-black transition-all" style={{ color: 'var(--app-primary-color)' }}>
                        <Check className="size-3.5" />
                      </button>
                      <button onClick={() => respondRequest(r.id, false)} className="p-1.5 rounded-lg bg-white/5 text-slate-500 hover:bg-red-500/20 hover:text-red-500 transition-all">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {receivedRequests.length > 3 && (
                  <button onClick={() => setActiveTab('received')} className="w-full text-center text-[10px] font-black text-slate-600 uppercase tracking-widest hover:text-primary transition-colors">Ver todos os {receivedRequests.length} pedidos</button>
                )}
              </div>
            ) : (
              <p className="text-[10px] font-bold text-slate-700 italic">Limpo por enquanto.</p>
            )}
          </section>

          <section className="relative group overflow-hidden rounded-[2.5rem]">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent opacity-50 transition-opacity group-hover:opacity-80" style={{ background: 'linear-gradient(to bottom right, color-mix(in srgb, var(--app-primary-color) 20%, transparent), transparent, transparent)' }}></div>
            <div className="relative p-8 bg-[#161616] border border-white/10 flex flex-col items-center text-center">
              <div className="size-16 rounded-3xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <UserPlus2 className="size-8 shadow-[0_0_15px_var(--app-primary-color)]" style={{ color: 'var(--app-primary-color)' }} />
              </div>
              <h4 className="text-white font-bold text-xl mb-2 tracking-tight">Cresça sua Guilda</h4>
              <p className="text-slate-500 text-[10px] font-bold leading-relaxed uppercase tracking-widest mb-6">Convide aliados para ganhar bônus de XP e loot exclusivo em missões.</p>
              <button 
                className="w-full bg-white text-black py-4 rounded-xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-primary transition-all shadow-xl"
                onClick={() => navigate(ROUTE_PATHS.minigames)}
              >
                Ir para Arena
              </button>
            </div>
          </section>

          <section className="bg-primary/5 border border-primary/10 rounded-[2rem] p-6" style={{ borderColor: 'color-mix(in srgb, var(--app-primary-color) 10%, transparent)', backgroundColor: 'color-mix(in srgb, var(--app-primary-color) 5%, transparent)' }}>
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp className="size-5" style={{ color: 'var(--app-primary-color)' }} />
              <h3 className="text-[10px] font-bold text-white uppercase tracking-[0.2em]">Atividade Recente</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="size-1.5 rounded-full" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>
                <p className="text-slate-400 text-[10px] leading-relaxed"><span className="text-white font-bold">Você</span> adicionou <span className="text-white font-bold">IronGuts</span> como amigo.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="size-1.5 rounded-full bg-slate-700"></div>
                <p className="text-slate-400 text-[10px] leading-relaxed"><span className="text-white font-bold">FitLoot</span> atualizou os servidores sociais.</p>
              </div>
            </div>
          </section>

        </aside>

      </div>
    </AppPageShell>
  );
}
