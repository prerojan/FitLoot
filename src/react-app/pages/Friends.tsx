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
import { ROUTE_PATHS } from "@/react-app/auth/constants";
import AppPageShell from "@/react-app/components/AppPageShell";
import { useAuth } from "@/react-app/auth/context";
import {
  fetchFriendsBundle,
  type Friend,
  FriendsApiError,
  respondFriendRequest as respondFriendRequestApi,
  searchUsersByUsername,
  sendFriendRequest as sendFriendRequestApi,
  type FriendSearchResult as SearchResult,
} from "@/react-app/services/friendsService";

type TabType = 'friends' | 'received' | 'sent';

export default function Friends() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [receivedRequests, setReceivedRequests] = useState<Friend[]>([]);
  const [sentRequests] = useState<Friend[]>([]); // Mantem a aba enquanto a API nao expoe enviados.
  const [activeTab, setActiveTab] = useState<TabType>('friends');
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFriendsError = useCallback((rawError: unknown, fallbackMessage: string) => {
    if (rawError instanceof FriendsApiError) {
      if (rawError.code === "UNAUTHORIZED") {
        navigate("/app");
        return;
      }
      setError(rawError.message || fallbackMessage);
      return;
    }

    setError(fallbackMessage);
  }, [navigate]);

  const loadFriends = useCallback(async (forceRefresh = false) => {
    try {
      setError(null);
      const bundle = await fetchFriendsBundle({ forceRefresh });
      setFriends(bundle.friends);
      setReceivedRequests(bundle.pending);
    } catch (error) {
      handleFriendsError(error, "Nao foi possivel carregar a lista de amigos agora.");
    } finally {
      setLoading(false);
    }
  }, [handleFriendsError]);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    void loadFriends();
  }, [user, navigate, loadFriends]);

  useEffect(() => {
    if (!user) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadFriends(true);
    }, 40_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [user, loadFriends]);

  const searchUsers = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const payload = await searchUsersByUsername(searchQuery.trim());
      setSearchResults(payload);
    } catch (error) {
      handleFriendsError(error, "Nao foi possivel buscar usuarios agora.");
    } finally {
      setSearching(false);
    }
  };

  const handleSendFriendRequest = async (friendUserId: string) => {
    try {
      await sendFriendRequestApi(friendUserId);

      setSearchQuery("");
      setSearchResults([]);
      setActiveTab("friends");
      await loadFriends(true);
    } catch (error) {
      handleFriendsError(error, "Nao foi possivel enviar solicitacao.");
    }
  };

  const respondRequest = async (requestId: number, accept: boolean) => {
    try {
      await respondFriendRequestApi(requestId, accept);
      await loadFriends(true);
    } catch (error) {
      handleFriendsError(error, "Nao foi possivel responder a solicitacao.");
    }
  };

  if (loading) {
    return (
      <AppPageShell bottomNavActive="arena" className="fl-theme-page">
        <div className="flex-1 flex items-center justify-center">
          <LoadingBall size="md" />
        </div>
      </AppPageShell>
    );
  }

  const onlineFriends = friends.filter(f => f.is_online);
  const offlineFriends = friends.filter(f => !f.is_online);

  return (
    <AppPageShell bottomNavActive="arena" className="fl-theme-page">
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden md:flex-row">
        
        {/* Conteudo principal */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 pb-[98px] sm:p-6 md:p-8 min-w-0">
          
          {/* Cabecalho */}
          <header className="mb-6 sm:mb-10 min-w-0">
            <h1 className="mb-1 sm:mb-2 text-2xl sm:text-4xl lg:text-5xl font-black leading-none tracking-[0.1em] sm:tracking-[0.2em] truncate" style={{ color: "var(--fl-color-text)" }}>Social Hub</h1>
            <p className="font-bold text-[9px] sm:text-[10px] uppercase tracking-[0.2em] sm:tracking-[0.3em] truncate">Sua rede de elite e alianças estratégicas.</p>
            {error && (
              <div className="mt-4 p-3 sm:p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest">
                {error}
              </div>
            )}
          </header>

          {/* Busca */}
          <div className="relative mb-8 sm:mb-10 group min-w-0">
            <div className="absolute inset-y-0 left-4 sm:left-5 flex items-center pointer-events-none">
              <Search className="w-4 h-4 sm:w-5 sm:h-5 transition-colors group-focus-within:text-primary" style={{ color: "var(--fl-color-text-muted)" }} />
            </div>
            <input 
              type="text" 
              placeholder="Buscar por username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
              className="fl-theme-input w-full rounded-2xl py-4 sm:py-5 pl-11 sm:pl-14 pr-4 sm:pr-6 placeholder-slate-600 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-xs sm:text-sm font-medium"
            />
            <button 
              onClick={searchUsers}
              disabled={searching}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl px-4 sm:px-6 py-2 sm:py-2.5 text-[9px] sm:text-[10px] font-black uppercase tracking-widest shadow-lg transition-all hover:scale-105 active:scale-95"
              style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
            >
              {searching ? <LoadingBall size="sm" /> : 'Buscar'}
            </button>
          </div>

          {/* Resultados da busca */}
          {searchResults.length > 0 && (
            <div className="mb-12 space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--fl-color-text-muted)" }}>Resultados da Busca</h3>
                <button onClick={() => setSearchResults([])} className="text-[10px] font-bold text-primary uppercase tracking-widest hover:underline" style={{ color: 'var(--app-primary-color)' }}>Limpar</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {searchResults.map((result) => (
                  <div key={result.user_id} className="fl-theme-surface rounded-2xl p-4 flex items-center justify-between group hover:border-primary/20 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="size-12 overflow-hidden rounded-full border-2 transition-all group-hover:opacity-90" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, var(--fl-border-soft))" }}>
                        <Avatar name={result.username} className="w-full h-full" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold tracking-tight" style={{ color: "var(--fl-color-text)" }}>{result.username}</h4>
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>Lv {result.level}</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleSendFriendRequest(result.user_id)}
                      className="fl-theme-surface-soft rounded-xl p-2.5 fl-theme-text-muted transition-opacity hover:opacity-85"
                    >
                      <UserPlus className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Abas */}
          <div className="mb-8 flex gap-8 overflow-x-auto border-b no-scrollbar" style={{ borderColor: "var(--fl-border-soft)" }}>
            <button 
              onClick={() => setActiveTab('friends')}
              className="relative whitespace-nowrap pb-4 text-[10px] font-bold uppercase tracking-[0.2em] transition-opacity hover:opacity-85"
              style={{ color: activeTab === 'friends' ? 'var(--app-primary-color)' : 'var(--fl-color-text-muted)' }}
            >
              Meus Amigos ({friends.length})
              {activeTab === 'friends' && <div className="absolute bottom-0 left-0 w-full h-0.5 shadow-[0_0_12px_var(--app-primary-color)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>}
            </button>
            <button 
              onClick={() => setActiveTab('received')}
              className="relative whitespace-nowrap pb-4 text-[10px] font-bold uppercase tracking-[0.2em] transition-opacity hover:opacity-85"
              style={{ color: activeTab === 'received' ? 'var(--app-primary-color)' : 'var(--fl-color-text-muted)' }}
            >
              Pedidos Recebidos ({receivedRequests.length})
              {activeTab === 'received' && <div className="absolute bottom-0 left-0 w-full h-0.5 shadow-[0_0_12px_var(--app-primary-color)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>}
            </button>
            <button 
              onClick={() => setActiveTab('sent')}
              className="relative whitespace-nowrap pb-4 text-[10px] font-bold uppercase tracking-[0.2em] transition-opacity hover:opacity-85"
              style={{ color: activeTab === 'sent' ? 'var(--app-primary-color)' : 'var(--fl-color-text-muted)' }}
            >
              Pedidos Enviados ({sentRequests.length})
              {activeTab === 'sent' && <div className="absolute bottom-0 left-0 w-full h-0.5 shadow-[0_0_12px_var(--app-primary-color)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>}
            </button>
          </div>

          {/* Conteudo da aba */}
          <div className="space-y-12 pb-8">
            {activeTab === 'friends' && (
              <>
                {/* Amigos online */}
                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <div className="size-1.5 rounded-full animate-pulse shadow-[0_0_8px_var(--app-primary-color)]" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>
                    <h2 className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: "var(--fl-color-text-muted)" }}>Amigos Online — {onlineFriends.length}</h2>
                  </div>
                  
                  {onlineFriends.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 min-w-0">
                      {onlineFriends.map((friend) => (
                        <div key={friend.id} className="fl-theme-surface rounded-[1.5rem] sm:rounded-[2rem] p-4 sm:p-5 group hover:border-primary/30 transition-all relative overflow-hidden min-w-0">
                          <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="fl-theme-text-muted transition-opacity hover:opacity-85"><MoreVertical className="w-4 h-4" /></button>
                          </div>
                          <div className="flex items-center gap-4 mb-4">
                            <div className="relative size-14 shrink-0">
                              <div className="w-full h-full rounded-full border-2 overflow-hidden shadow-[0_0_15px_rgba(var(--app-primary-color-rgb),0.2)]" style={{ borderColor: 'var(--app-primary-color)' }}>
                                <Avatar name={friend.friend_username} className="w-full h-full" />
                              </div>
                              <div className="fl-theme-surface absolute -bottom-1 -right-1 size-5 flex items-center justify-center rounded-full">
                                <ShieldCheck className="w-3 h-3" style={{ color: 'var(--app-primary-color)' }} />
                              </div>
                            </div>
                            <div className="min-w-0">
                              <h4 className="truncate text-base font-bold tracking-tight" style={{ color: "var(--fl-color-text)" }}>{friend.friend_username}</h4>
                              <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'var(--app-primary-color)' }}>RANK ELITE</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between border-t pt-4" style={{ borderColor: "var(--fl-border-soft)" }}>
                            <div className="flex flex-col">
                              <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">STREAK</span>
                              <div className="flex items-center gap-1.5" style={{ color: 'var(--app-primary-color)' }}>
                                <Flame className="w-4 h-4 fill-current" />
                                <span className="text-sm font-black tracking-tight">{friend.friend_streak}</span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-3">
                              <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">NÍVEL</span>
                              <span className="text-sm font-black" style={{ color: "var(--fl-color-text)" }}>{friend.friend_level}</span>
                              <button
                                type="button"
                                onClick={() => navigate(`${ROUTE_PATHS.minigames}?challenge=${friend.friend_user_id}`)}
                                className="rounded-full px-4 py-2 text-[9px] font-black uppercase tracking-[0.18em]"
                                style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}
                              >
                                Desafiar
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-3xl border border-dashed py-12 text-center text-[11px] font-bold italic uppercase tracking-widest" style={{ borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text-muted)" }}>Nenhum guerreiro online no momento.</p>
                  )}
                </section>

                {/* Amigos offline */}
                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <div className="size-1.5 rounded-full bg-slate-700"></div>
                    <h2 className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: "var(--fl-color-text-muted)" }}>Offline — {offlineFriends.length}</h2>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {offlineFriends.map((friend) => (
                      <div key={friend.id} className="fl-theme-surface-muted rounded-xl p-4 flex items-center justify-between opacity-60 hover:opacity-100 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="size-11 overflow-hidden rounded-full border grayscale" style={{ borderColor: "var(--fl-border-soft)" }}>
                            <Avatar name={friend.friend_username} className="w-full h-full" />
                          </div>
                          <div>
                            <h4 className="max-w-[120px] truncate text-sm font-bold tracking-tight" style={{ color: "var(--fl-color-text)" }}>{friend.friend_username}</h4>
                            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>Lv {friend.friend_level} • {friend.friend_streak}d</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`${ROUTE_PATHS.minigames}?challenge=${friend.friend_user_id}`)}
                            className="rounded-lg px-3 py-2 text-[9px] font-black uppercase tracking-[0.16em]"
                            style={{ backgroundColor: "var(--app-primary-color)", color: "var(--fl-nav-item-active-text)" }}
                          >
                            Duelo
                          </button>
                          <button className="rounded-lg p-2 fl-theme-text-muted transition-opacity hover:opacity-85">
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
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
                      <div key={request.id} className="fl-theme-surface rounded-3xl p-6 flex flex-col sm:flex-row items-center gap-6 group hover:border-primary/30 transition-all">
                        <div className="size-16 overflow-hidden rounded-full border-2 transition-opacity group-hover:opacity-90" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 16%, var(--fl-border-soft))" }}>
                          <Avatar name={request.friend_username} className="w-full h-full text-xl" />
                        </div>
                        <div className="flex-1 text-center sm:text-left">
                          <h4 className="mb-1 text-lg font-bold" style={{ color: "var(--fl-color-text)" }}>{request.friend_username}</h4>
                          <div className="flex items-center justify-center sm:justify-start gap-4">
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>LVL {request.friend_level}</span>
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>{request.friend_streak} Dias de Streak</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={() => respondRequest(request.id, true)}
                            className="rounded-full px-6 py-3 text-[10px] font-black uppercase tracking-widest shadow-lg transition-all hover:scale-105 active:scale-95"
                            style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
                          >
                            Aceitar
                          </button>
                          <button 
                            onClick={() => respondRequest(request.id, false)}
                            className="fl-theme-input px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-red-950 hover:text-red-500 transition-all"
                          >
                            Recusar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <UserPlus2 className="mb-6 size-16 fl-theme-text-soft" />
                    <p className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.2em]">Nenhum pedido pendente por agora.</p>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'sent' && (
              <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <Clock className="mb-6 size-16 fl-theme-text-soft" />
                  <p className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.2em]">Sua lista de pedidos enviados está vazia.</p>
                  <Button variant="outline" className="mt-8 border-[var(--fl-border-soft)] text-[var(--fl-color-text-muted)] hover:opacity-85" onClick={() => setActiveTab('friends')}>Voltar ao Hub</Button>
                </div>
              </section>
            )}

          </div>

        </div>

        {/* Painel lateral */}
        <aside className="hidden w-full flex-col gap-8 border-l p-6 md:w-[340px] md:p-8 lg:flex" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 78%, transparent)" }}>
          
          <section className="space-y-6">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: "var(--fl-color-text-muted)" }}>Pedidos Pendentes</h3>
            {receivedRequests.length > 0 ? (
              <div className="space-y-3">
                {receivedRequests.slice(0, 3).map((r) => (
                  <div key={r.id} className="fl-theme-surface flex items-center justify-between p-3 rounded-2xl">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.friend_username} className="size-8 text-[10px]" />
                      <span className="max-w-[80px] truncate text-xs font-bold" style={{ color: "var(--fl-color-text)" }}>{r.friend_username}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => respondRequest(r.id, true)} className="rounded-lg p-1.5 transition-opacity hover:opacity-90" style={{ backgroundColor: 'color-mix(in srgb, var(--app-primary-color) 18%, transparent)', color: 'var(--fl-nav-item-active-text)' }}>
                        <Check className="size-3.5" />
                      </button>
                      <button onClick={() => respondRequest(r.id, false)} className="fl-theme-surface-soft rounded-lg p-1.5 fl-theme-text-muted transition-colors hover:bg-red-500/20 hover:text-red-500">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {receivedRequests.length > 3 && (
                  <button onClick={() => setActiveTab('received')} className="w-full text-center text-[10px] font-black uppercase tracking-widest transition-colors hover:text-primary" style={{ color: "var(--fl-color-text-muted)" }}>Ver todos os {receivedRequests.length} pedidos</button>
                )}
              </div>
            ) : (
              <p className="text-[10px] font-bold italic" style={{ color: "var(--fl-color-text-muted)" }}>Limpo por enquanto.</p>
            )}
          </section>

          <section className="relative group overflow-hidden rounded-[2.5rem]">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent opacity-50 transition-opacity group-hover:opacity-80" style={{ background: 'linear-gradient(to bottom right, color-mix(in srgb, var(--app-primary-color) 20%, transparent), transparent, transparent)' }}></div>
            <div className="fl-theme-surface relative p-8 flex flex-col items-center text-center">
              <div className="size-16 rounded-3xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <UserPlus2 className="size-8 shadow-[0_0_15px_var(--app-primary-color)]" style={{ color: 'var(--app-primary-color)' }} />
              </div>
              <h4 className="mb-2 text-xl font-bold tracking-tight" style={{ color: "var(--fl-color-text)" }}>Cresça sua Guilda</h4>
              <p className="mb-6 text-[10px] font-bold uppercase tracking-widest leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}>Convide aliados para ganhar bônus de XP e loot exclusivo em missões.</p>
              <button 
                className="w-full rounded-xl py-4 text-[11px] font-black uppercase tracking-[0.2em] transition-all shadow-xl hover:opacity-90"
                style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}
                onClick={() => navigate(ROUTE_PATHS.minigames)}
              >
                Ir para Arena
              </button>
            </div>
          </section>

          <section className="bg-primary/5 border border-primary/10 rounded-[2rem] p-6" style={{ borderColor: 'color-mix(in srgb, var(--app-primary-color) 10%, transparent)', backgroundColor: 'color-mix(in srgb, var(--app-primary-color) 5%, transparent)' }}>
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp className="size-5" style={{ color: 'var(--app-primary-color)' }} />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--fl-color-text)" }}>Atividade Recente</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="size-1.5 rounded-full" style={{ backgroundColor: 'var(--app-primary-color)' }}></div>
                <p className="text-[10px] leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}><span style={{ color: "var(--fl-color-text)" }} className="font-bold">Você</span> adicionou <span style={{ color: "var(--fl-color-text)" }} className="font-bold">IronGuts</span> como amigo.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="size-1.5 rounded-full bg-slate-700"></div>
                <p className="text-[10px] leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}><span style={{ color: "var(--fl-color-text)" }} className="font-bold">FitLoot</span> atualizou os servidores sociais.</p>
              </div>
            </div>
          </section>

        </aside>

      </div>
    </AppPageShell>
  );
}

