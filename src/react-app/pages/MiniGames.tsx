import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/react-app/auth/context";
import { useRewardNotifications } from "@/react-app/contexts/useRewardNotifications";
import { useNavigate, useSearchParams } from "react-router";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import {
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
  Plus as PlusIcon,
} from "lucide-react";
import type { RewardNotification } from "@/shared/types";
import { ApiRequestError, api, clearJsonCache, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
import { Avatar } from "@/react-app/components/ui/avatar";
import { Badge } from "@/react-app/components/ui/badge";

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

interface FriendRequest {
  id: number;
  friend_user_id: string;
  friend_username: string;
  friend_full_name: string;
  friend_avatar_url?: string | null;
}

interface SearchResult {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url?: string | null;
  level: number;
}

type OpponentType = "friend" | "random";
type ViewMode = "live" | "tournaments";
type SelectedOpponent = { userId: string; username: string } | null;

export default function MiniGames() {
  const { user } = useAuth();
  const { pushRewardNotifications } = useRewardNotifications();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const challengeUserId = searchParams.get("challenge");

  const [activeGames, setActiveGames] = useState<MiniGame[]>([]);
  const [completedGames, setCompletedGames] = useState<MiniGame[]>([]);
  const [skills, setSkills] = useState<MiniGameSkill[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(Boolean(challengeUserId));
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [selectedSkill, setSelectedSkill] = useState<number | null>(null);
  const [targetReps, setTargetReps] = useState(20);
  const [opponentType, setOpponentType] = useState<OpponentType>(challengeUserId ? "friend" : "random");
  const [selectedOpponent, setSelectedOpponent] = useState<SelectedOpponent>(
    challengeUserId ? { userId: challengeUserId, username: "Rival selecionado" } : null,
  );

  const liveGames = useMemo(
    () => activeGames.filter((game) => game.status === "pending" || game.status === "active"),
    [activeGames],
  );
  const acceptedGames = useMemo(() => liveGames.filter((game) => game.status === "active"), [liveGames]);
  const pendingGames = useMemo(() => liveGames.filter((game) => game.status === "pending"), [liveGames]);

  const loadGames = useCallback(async () => {
    // Carrega duelos ativos e historico recente com preferencia por cache.
    setError(null);
    const cacheGames = readCachedJson<MiniGame[]>("/api/mini-games/active");

    if (cacheGames) {
      const list = Array.isArray(cacheGames.data) ? cacheGames.data : [];
      setActiveGames(list.filter((game) => game.status !== "completed"));
      setCompletedGames(list.filter((game) => game.status === "completed").slice(0, 10));
      setLoading(false);
      if (!cacheGames.stale) return;
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
        setError("Nao foi possivel carregar os duelos agora.");
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const loadSkills = useCallback(async () => {
    // Carrega as habilidades disponiveis para criacao de duelos.
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
        setError("Nao foi possivel carregar as habilidades da arena.");
      }
    }
  }, [navigate]);

  const loadArenaData = useCallback(async () => {
    // Recupera solicitacoes pendentes usadas no painel lateral da arena.
    try {
      const response = await api("/api/friends/requests");

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to load requests");
      }

      const payload = (await response.json()) as FriendRequest[];
      setPendingRequests(Array.isArray(payload) ? payload : []);
    } catch (loadError) {
      console.error("Error loading arena requests:", loadError);
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
  }, [user, navigate, loadArenaData, loadGames, loadSkills]);

  const searchUsers = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const response = await api(`/api/friends/search?username=${encodeURIComponent(searchQuery.trim())}`);

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const payload = (await response.json()) as SearchResult[];
      setSearchResults(Array.isArray(payload) ? payload : []);
    } catch (searchError) {
      console.error("Error searching users:", searchError);
      setError("Nao foi possivel buscar rivais agora.");
    } finally {
      setSearching(false);
    }
  };

  const prepareChallenge = (friendUserId: string) => {
    const opponent = searchResults.find((result) => result.user_id === friendUserId);
    setSelectedOpponent({
      userId: friendUserId,
      username: opponent?.username ?? "Rival selecionado",
    });
    setOpponentType("friend");
    setShowCreateForm(true);
    setError(null);
  };

  const manageRequest = async (requestId: number, accept: boolean) => {
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
        throw new Error("Request response failed");
      }

      await loadArenaData();
    } catch (requestError) {
      console.error("Error managing request:", requestError);
      setError("Nao foi possivel responder a solicitacao agora.");
    }
  };

  const createChallenge = async () => {
    // Cria um novo duelo com rival definido ou fila aleatoria.
    if (!selectedSkill) {
      setError("Selecione uma habilidade antes de criar o duelo.");
      return;
    }

    if (opponentType === "friend" && !selectedOpponent?.userId) {
      setError("Selecione um rival antes de criar um duelo privado.");
      return;
    }

    try {
      setError(null);
      const response = await api("/api/mini-games/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenged_user_id: opponentType === "friend" ? selectedOpponent?.userId ?? challengeUserId ?? null : null,
          skill_id: selectedSkill,
          target_reps: targetReps,
          opponent_type: opponentType,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        setError(payload?.error ?? "Nao foi possivel criar o desafio.");
        return;
      }

      setShowCreateForm(false);
      setSearchResults([]);
      setSearchQuery("");
      setSelectedSkill(null);
      setTargetReps(20);
      clearJsonCache("/api/mini-games/active");
      await loadGames();
    } catch (challengeError) {
      console.error("Error creating challenge:", challengeError);
      setError("Nao foi possivel criar o desafio agora.");
    }
  };

  const acceptChallenge = async (gameId: number) => {
    try {
      const response = await api(`/api/mini-games/${gameId}/accept`, { method: "POST" });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        throw new Error("Accept failed");
      }

      clearJsonCache("/api/mini-games/active");
      await loadGames();
    } catch (acceptError) {
      console.error("Error accepting challenge:", acceptError);
      setError("Nao foi possivel aceitar o duelo agora.");
    }
  };

  const completeChallenge = async (gameId: number, repsCompleted: number, timeSeconds: number) => {
    try {
      const response = await api(`/api/mini-games/${gameId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reps_completed: repsCompleted,
          time_seconds: timeSeconds,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        throw new Error("Complete failed");
      }

      const payload = (await response.json()) as {
        reward_events?: RewardNotification[] | undefined;
      };
      pushRewardNotifications(payload.reward_events);
      clearJsonCache("/api/mini-games/active");
      await loadGames();
    } catch (completeError) {
      console.error("Error completing challenge:", completeError);
      setError("Nao foi possivel concluir o duelo agora.");
    }
  };

  if (loading) {
    return (
      <AppPageShell bottomNavActive="arena" className="fl-theme-page">
        <div className="flex flex-1 items-center justify-center">
          <LoadingBall size="md" />
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell bottomNavActive="arena" className="fl-theme-page">
      <div className="flex flex-1 flex-col overflow-y-auto p-6 sm:p-8">
        {/* Hero da arena, modos e contadores resumidos. */}
        <section className="mb-12">
          <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="mb-2 text-4xl font-bold uppercase tracking-[0.2em]">Battle Ground</h1>
              <p className="fl-theme-text-muted text-xs font-bold uppercase tracking-widest">
                A gloria espera por voce no coliseu digital.
              </p>
            </div>

            <div className="fl-theme-surface-soft mx-auto flex self-start rounded-full p-1.5">
              <button
                type="button"
                onClick={() => setViewMode("live")}
                className={`rounded-full px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-all duration-300 ${viewMode === "live" ? "text-black shadow-lg shadow-primary/20" : "fl-theme-text-muted"}`}
                style={{ backgroundColor: viewMode === "live" ? "var(--app-primary-color)" : undefined }}
              >
                Duelos Ao Vivo
              </button>
              <button
                type="button"
                onClick={() => setViewMode("tournaments")}
                className={`rounded-full px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-all duration-300 ${viewMode === "tournaments" ? "text-black shadow-lg shadow-primary/20" : "fl-theme-text-muted"}`}
                style={{ backgroundColor: viewMode === "tournaments" ? "var(--app-primary-color)" : undefined }}
              >
                Torneios
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <SummaryCard icon={Trophy} label="Duelos ativos" value={String(acceptedGames.length)} helper="Confrontos em andamento" />
            <SummaryCard icon={Clock} label="Pendentes" value={String(pendingGames.length)} helper="Esperando resposta" />
            <SummaryCard icon={Zap} label="Historico" value={String(completedGames.length)} helper="Resultados recentes" />
          </div>
        </section>

        {/* Estado de erro recuperavel da arena. */}
        {error ? (
          <div className="mb-8 rounded-3xl border px-5 py-4 text-[11px] font-bold uppercase tracking-widest" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 24%, transparent)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)", color: "var(--app-primary-color)" }}>
            {error}
          </div>
        ) : null}

        {/* Modal de criacao de duelo. */}
        {showCreateForm ? (
          <div className="fl-z-modal fixed inset-0 flex items-center justify-center bg-black/90 p-6 backdrop-blur-md">
            <div className="fl-theme-surface w-full max-w-xl rounded-[3rem] p-10 shadow-3xl">
              <div className="mb-10 flex items-start justify-between">
                <div>
                  <h2 className="mb-2 text-2xl font-bold uppercase tracking-[0.2em]">Novo Desafio</h2>
                  <p className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-widest">
                    Configure os parametros da sua vitoria.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="fl-theme-text-muted transition-colors hover:opacity-80"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-10">
                <div>
                  <label className="fl-theme-text-muted mb-5 block text-[10px] font-bold uppercase tracking-[0.25em]">
                    Seletor de Oponente
                  </label>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setOpponentType("friend")}
                      className={`flex-1 rounded-2xl border py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${opponentType === "friend" ? "text-black" : "fl-theme-input fl-theme-text-muted"}`}
                      style={{ backgroundColor: opponentType === "friend" ? "var(--app-primary-color)" : undefined, borderColor: opponentType === "friend" ? "var(--app-primary-color)" : undefined }}
                    >
                      Amigo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpponentType("random");
                        setSelectedOpponent(null);
                      }}
                      className={`flex-1 rounded-2xl border py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${opponentType === "random" ? "text-black" : "fl-theme-input fl-theme-text-muted"}`}
                      style={{ backgroundColor: opponentType === "random" ? "var(--app-primary-color)" : undefined, borderColor: opponentType === "random" ? "var(--app-primary-color)" : undefined }}
                    >
                      Aleatorio
                    </button>
                  </div>

                  {opponentType === "friend" ? (
                    <div className="mt-4 rounded-2xl border px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 68%, transparent)", color: selectedOpponent ? "var(--app-primary-color)" : "var(--fl-color-text-muted)" }}>
                      {selectedOpponent ? `Rival selecionado: ${selectedOpponent.username}` : "Escolha um rival pela busca abaixo."}
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="fl-theme-text-muted mb-4 block text-[10px] font-bold uppercase tracking-[0.25em]">
                    Habilidade Especial
                  </label>
                  <div className="relative">
                    <select
                      value={selectedSkill ?? ""}
                      onChange={(event) => setSelectedSkill(Number.parseInt(event.target.value, 10))}
                      className="fl-theme-input w-full appearance-none rounded-2xl p-5 text-[11px] font-bold uppercase tracking-widest focus:outline-none"
                    >
                      <option value="">Selecione Tecnica de Combate...</option>
                      {skills.map((skill) => (
                        <option key={skill.id} value={skill.id}>
                          {skill.name} ({skill.difficulty})
                        </option>
                      ))}
                    </select>
                    <ChevronRight className="absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 fl-theme-text-muted" />
                  </div>
                </div>

                <div>
                  <div className="mb-5 flex items-center justify-between">
                    <label className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-[0.25em]">
                      Meta de Intensidade
                    </label>
                    <span className="text-lg font-bold tracking-widest" style={{ color: "var(--app-primary-color)" }}>
                      {targetReps} REPS
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={targetReps}
                    onChange={(event) => setTargetReps(Number.parseInt(event.target.value, 10))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/5 accent-primary"
                    style={{ accentColor: "var(--app-primary-color)" }}
                  />
                </div>

                <div className="flex gap-4 pt-6">
                  <button
                    type="button"
                    onClick={createChallenge}
                    className="flex-1 rounded-full py-5 text-xs font-bold uppercase tracking-[0.25em] text-black shadow-xl shadow-primary/20 transition-all duration-300 hover:scale-[1.02]"
                    style={{ backgroundColor: "var(--app-primary-color)" }}
                  >
                    Lancar Desafio
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12">
          <div className="space-y-12 lg:col-span-8">
            <section>
              {/* Busca e selecao de rivais. */}
              <div className="mb-8 flex items-center gap-3">
                <SearchIcon className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
                <h3 className="text-xl font-bold uppercase tracking-[0.2em]">Encontrar Guerreiros</h3>
              </div>

              <div className="fl-theme-surface overflow-hidden rounded-[2.5rem] shadow-2xl">
                <div className="flex gap-4 border-b p-6" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 35%, transparent)" }}>
                  <div className="relative flex-1">
                    <SearchIcon className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 fl-theme-text-muted" />
                    <input
                      type="text"
                      placeholder="Username ou ranking..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void searchUsers();
                      }}
                      className="fl-theme-input w-full rounded-2xl py-4 pl-12 pr-4 text-xs font-bold uppercase tracking-widest focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void searchUsers();
                    }}
                    className="rounded-2xl px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition-all duration-300 hover:brightness-110"
                    style={{ backgroundColor: "var(--app-primary-color)" }}
                  >
                    {searching ? "..." : "Buscar"}
                  </button>
                </div>

                <div className="divide-y divide-white/5">
                  {searchResults.length === 0 ? (
                    <div className="p-16 text-center">
                      <Users className="mx-auto mb-5 h-12 w-12 text-white/5" />
                      <p className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">
                        Inicie uma busca e encontre novos rivais.
                      </p>
                    </div>
                  ) : (
                    searchResults.map((result) => (
                      <div key={result.user_id} className="group flex items-center justify-between p-6 transition-colors hover:bg-white/[0.02]">
                        <div className="flex items-center gap-5">
                          <Avatar src={result.avatar_url ?? null} name={result.full_name || result.username} className="size-14 rounded-full border border-white/10" />
                          <div>
                            <h5 className="text-base font-bold tracking-tight transition-colors group-hover:text-primary">{result.username}</h5>
                            <div className="mt-1.5 flex items-center gap-2">
                              <Badge className="border border-primary/20 bg-primary/10 px-2 py-0.5 text-[8px] font-bold uppercase" style={{ color: "var(--app-primary-color)" }}>
                                Nv. {result.level}
                              </Badge>
                              <p className="fl-theme-text-muted text-[9px] font-bold uppercase tracking-[0.1em]">
                                {result.level > 10 ? "Mestre da Arena" : "Explorador"}
                              </p>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => prepareChallenge(result.user_id)}
                          className="rounded-2xl border px-8 py-3 text-[10px] font-bold uppercase tracking-[0.2em] transition-all duration-300 hover:text-black"
                          style={{ color: "var(--app-primary-color)", borderColor: "color-mix(in srgb, var(--app-primary-color) 20%, transparent)", backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}
                          onMouseEnter={(event) => {
                            event.currentTarget.style.backgroundColor = "var(--app-primary-color)";
                          }}
                          onMouseLeave={(event) => {
                            event.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--app-primary-color) 10%, transparent)";
                          }}
                        >
                          Selecionar rival
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
            {viewMode === "live" ? (
              <section>
                {/* Duelos ativos e criacao rapida. */}
                <div className="mb-8 flex items-center gap-3">
                  <Target className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
                  <h3 className="text-xl font-bold uppercase tracking-[0.2em]">Duelos em Curso</h3>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {liveGames.map((game) => (
                    <BattleCard
                      key={game.id}
                      game={game}
                      onAccept={acceptChallenge}
                      onComplete={completeChallenge}
                      userId={user?.id ?? ""}
                    />
                  ))}

                  <button
                    type="button"
                    onClick={() => setShowCreateForm(true)}
                    className="fl-theme-surface-soft flex min-h-[220px] flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed p-8 transition-all duration-500 hover:border-primary/30 hover:bg-primary/[0.02]"
                  >
                    <div className="mb-5 flex size-16 items-center justify-center rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
                      <PlusIcon className="h-8 w-8" style={{ color: "var(--app-primary-color)" }} />
                    </div>
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.25em]">Criar Duelo Privado</h4>
                    <p className="fl-theme-text-muted mt-3 max-w-[200px] text-center text-[9px] uppercase tracking-widest leading-relaxed">
                      Desafie um guerreiro especifico e defina as regras do combate.
                    </p>
                  </button>
                </div>

                {liveGames.length === 0 ? (
                  <div className="fl-theme-surface-muted mt-6 rounded-[2rem] p-8 text-center">
                    <Check className="mx-auto mb-4 h-10 w-10" style={{ color: "var(--app-primary-color)" }} />
                    <p className="text-[10px] font-bold uppercase tracking-[0.25em]">
                      Nenhum duelo ativo no momento.
                    </p>
                  </div>
                ) : null}
              </section>
            ) : (
              <section>
                {/* Historico e agenda promocional de torneios. */}
                <div className="mb-8 flex items-center gap-3">
                  <Check className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
                  <h3 className="text-xl font-bold uppercase tracking-[0.2em]">Historico de Torneios</h3>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {completedGames.map((game) => (
                    <TournamentResultCard key={game.id} game={game} userId={user?.id ?? ""} />
                  ))}

                  <div className="rounded-[3rem] border p-8" style={{ borderColor: "var(--fl-border-soft)", background: "linear-gradient(160deg, color-mix(in srgb, var(--app-primary-color) 12%, transparent), color-mix(in srgb, var(--fl-surface-strong) 96%, transparent))" }}>
                    <div className="mb-6 inline-flex rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ borderColor: "color-mix(in srgb, var(--app-primary-color) 18%, transparent)", color: "var(--app-primary-color)" }}>
                      Agenda da Arena
                    </div>
                    <h4 className="mb-2 text-2xl font-bold uppercase tracking-tight">Weekend Brawl</h4>
                    <p className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">Season 4 • Final Match</p>
                    <div className="mt-8 space-y-4 text-[10px] font-bold uppercase tracking-widest">
                      <div className="flex items-center gap-3">
                        <Zap className="h-4 w-4" style={{ color: "var(--app-primary-color)" }} />
                        <span>Prize Pool: 50.000 Points</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Clock className="h-4 w-4" style={{ color: "var(--app-primary-color)" }} />
                        <span>23 Marco, 20:00</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="mt-8 w-full rounded-full py-4 text-[10px] font-bold uppercase tracking-[0.3em] text-black shadow-2xl transition-all duration-300 hover:scale-[1.03] active:scale-95"
                      style={{ backgroundColor: "var(--app-primary-color)" }}
                    >
                      Pre-registrar
                    </button>
                  </div>
                </div>

                {completedGames.length === 0 ? (
                  <div className="fl-theme-surface-muted mt-6 rounded-[2rem] p-8 text-center">
                    <Clock className="mx-auto mb-4 h-10 w-10" style={{ color: "var(--app-primary-color)" }} />
                    <p className="text-[10px] font-bold uppercase tracking-[0.25em]">
                      Ainda nao existem resultados finalizados para exibir.
                    </p>
                  </div>
                ) : null}
              </section>
            )}
          </div>

          <div className="space-y-10 lg:col-span-4">
            <section>
              {/* Painel lateral com convites e atalhos. */}
              <div className="mb-8 flex items-center gap-3">
                <UserPlusIcon className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
                <h3 className="text-xl font-bold uppercase tracking-[0.2em]">Solicitacoes</h3>
              </div>

              <div className="flex flex-col gap-5">
                {pendingRequests.length === 0 ? (
                  <div className="fl-theme-surface-muted rounded-3xl border border-dashed p-10 text-center">
                    <InfoIcon className="mx-auto mb-4 h-10 w-10 text-white/5" />
                    <p className="fl-theme-text-muted text-[9px] font-bold uppercase tracking-[0.2em]">
                      Nenhuma solicitacao de duelo recebida.
                    </p>
                  </div>
                ) : (
                  pendingRequests.map((request) => (
                    <div key={request.id} className="fl-theme-surface rounded-[2.5rem] p-6 shadow-xl">
                      <div className="mb-6 flex items-center gap-4">
                        <Avatar src={request.friend_avatar_url ?? null} name={request.friend_full_name} className="size-12 rounded-full border border-white/10 shadow-lg" />
                        <div>
                          <h5 className="text-sm font-bold tracking-tight">{request.friend_username}</h5>
                          <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--app-primary-color)" }}>
                            Desafio Recebido
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            void manageRequest(request.id, true);
                          }}
                          className="flex-1 rounded-2xl py-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition-all duration-300 hover:brightness-110"
                          style={{ backgroundColor: "var(--app-primary-color)" }}
                        >
                          Aceitar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void manageRequest(request.id, false);
                          }}
                          className="fl-theme-input fl-theme-text-muted flex-1 rounded-2xl py-3.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-all duration-300 hover:opacity-90"
                        >
                          Recusar
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
            <section className="fl-theme-surface-muted rounded-[3rem] p-8">
              <div className="mb-4 flex items-center gap-3">
                <Trophy className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.3em]">Estado da Arena</h3>
              </div>
              <div className="space-y-4 text-[10px] font-bold uppercase tracking-widest">
                <ArenaMetric label="Duelos ao vivo" value={acceptedGames.length} />
                <ArenaMetric label="Aguardando" value={pendingGames.length} />
                <ArenaMetric label="Resultados" value={completedGames.length} />
              </div>
            </section>
          </div>
        </div>

        <footer className="mt-24 flex flex-col items-center justify-between gap-8 border-t border-white/5 pb-16 pt-12 text-[10px] font-bold uppercase tracking-[0.3em] md:flex-row">
          <p className="fl-theme-text-muted">© 2026 FitLoot Arena • Desafie seus limites.</p>
          <div className="flex gap-10 fl-theme-text-muted">
            <a href="#" className="transition-all duration-300 hover:text-primary">Regras</a>
            <a href="#" className="transition-all duration-300 hover:text-primary">Suporte</a>
            <a href="#" className="transition-all duration-300 hover:text-primary">Condicoes</a>
          </div>
        </footer>
      </div>
    </AppPageShell>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="fl-theme-surface rounded-[2rem] p-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
          <Icon className="h-6 w-6" style={{ color: "var(--app-primary-color)" }} />
        </div>
        <span className="text-3xl font-bold tracking-tight">{value}</span>
      </div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--app-primary-color)" }}>
        {label}
      </p>
      <p className="fl-theme-text-muted text-xs font-medium">{helper}</p>
    </div>
  );
}

function ArenaMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border px-4 py-3" style={{ borderColor: "var(--fl-border-soft)" }}>
      <span className="fl-theme-text-muted">{label}</span>
      <span style={{ color: "var(--app-primary-color)" }}>{value}</span>
    </div>
  );
}

function BattleCard({
  game,
  onAccept,
  onComplete,
  userId,
}: {
  game: MiniGame;
  onAccept: (id: number) => void;
  onComplete: (id: number, reps: number, timeSeconds: number) => void;
  userId: string;
}) {
  const isChallenger = game.challenger_user_id === userId;
  const isPending = game.status === "pending";
  const isActive = game.status === "active";

  return (
    <div className="relative overflow-hidden rounded-[3rem] border transition-all duration-500 hover:border-primary/20 hover:shadow-3xl hover:shadow-primary/10" style={{ borderColor: "var(--fl-border-soft)", background: "linear-gradient(180deg, color-mix(in srgb, var(--fl-surface-muted) 84%, transparent), color-mix(in srgb, var(--fl-surface-strong) 96%, transparent))" }}>
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      <div className="relative p-8">
        <div className="mb-8 flex items-center justify-between gap-3">
          <span className="rounded-full border px-4 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em]" style={{ borderColor: isPending ? "rgba(245, 158, 11, 0.3)" : "color-mix(in srgb, var(--app-primary-color) 20%, transparent)", color: isPending ? "#f59e0b" : "var(--app-primary-color)", backgroundColor: isPending ? "rgba(245, 158, 11, 0.12)" : "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" }}>
            {isPending ? "Aguardando" : "Live Arena"}
          </span>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] fl-theme-text-muted">
            <Clock className="h-4 w-4" />
            <span>{new Date(game.deadline).toLocaleDateString("pt-BR")}</span>
          </div>
        </div>

        <h4 className="mb-2 text-2xl font-bold tracking-tight">{game.skill_name}</h4>
        <div className="mb-6 flex items-center gap-4 text-[10px] font-bold uppercase tracking-[0.15em] fl-theme-text-muted">
          <span className="flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5 text-amber-500" /> {game.points_reward} Loot
          </span>
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" style={{ color: "var(--app-primary-color)" }} /> {game.target_reps} Reps
          </span>
        </div>

        <p className="mb-8 text-[10px] font-bold uppercase tracking-[0.15em] fl-theme-text-muted">
          vs {isChallenger ? game.challenged_username : game.challenger_username}
        </p>

        <div className="flex flex-col items-end gap-2">
          {isPending && !isChallenger ? (
            <button
              type="button"
              onClick={() => onAccept(game.id)}
              className="rounded-2xl px-8 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-black shadow-xl transition-all duration-300 hover:scale-105 active:scale-95"
              style={{ backgroundColor: "var(--app-primary-color)" }}
            >
              Aceitar
            </button>
          ) : null}

          {isActive ? (
            <button
              type="button"
              onClick={() => {
                const reps = Number.parseInt(prompt(`Meta: ${game.target_reps}. Quantas completou?`) ?? "0", 10);
                const time = Number.parseInt(prompt("Tempo em segundos?") ?? "0", 10);
                if (reps > 0) onComplete(game.id, reps, time);
              }}
              className="rounded-2xl px-8 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-black shadow-xl transition-all duration-300 hover:scale-105 active:scale-95"
              style={{ backgroundColor: "var(--app-primary-color)" }}
            >
              Vencer
            </button>
          ) : null}

          {isPending && isChallenger ? (
            <div className="rounded-2xl border px-6 py-3" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 70%, transparent)" }}>
              <span className="fl-theme-text-muted animate-pulse text-[9px] font-bold uppercase tracking-widest">Pendente</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TournamentResultCard({ game, userId }: { game: MiniGame; userId: string }) {
  const didWin = game.winner_user_id === userId;

  return (
    <div className="fl-theme-surface rounded-[2.5rem] p-7">
      <div className="mb-5 flex items-center justify-between">
        <span className="rounded-full border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em]" style={{ borderColor: didWin ? "color-mix(in srgb, var(--app-primary-color) 20%, transparent)" : "rgba(239, 68, 68, 0.25)", backgroundColor: didWin ? "color-mix(in srgb, var(--app-primary-color) 10%, transparent)" : "rgba(239, 68, 68, 0.12)", color: didWin ? "var(--app-primary-color)" : "#ef4444" }}>
          {didWin ? "Vitoria" : "Derrota"}
        </span>
        <span className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">
          {new Date(game.created_at).toLocaleDateString("pt-BR")}
        </span>
      </div>

      <h4 className="mb-2 text-xl font-bold tracking-tight">{game.skill_name}</h4>
      <p className="fl-theme-text-muted mb-6 text-[10px] font-bold uppercase tracking-[0.2em]">
        Contra {game.challenger_user_id === userId ? game.challenged_username : game.challenger_username}
      </p>

      <div className="grid grid-cols-3 gap-3 text-center">
        <ResultMetric label="Meta" value={`${game.target_reps}`} />
        <ResultMetric label="XP" value={`${game.xp_reward}`} />
        <ResultMetric label="Loot" value={`${game.points_reward}`} />
      </div>
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border px-3 py-4" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 62%, transparent)" }}>
      <p className="fl-theme-text-muted mb-1 text-[9px] font-bold uppercase tracking-[0.15em]">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
