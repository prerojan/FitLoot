import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Crown, Trophy } from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Avatar } from "@/react-app/components/ui/avatar";
import { useAuth } from "@/react-app/auth/context";
import { ApiRequestError } from "@/react-app/utils/api";
import {
  hydrateCachedResource,
  refreshCachedResource,
  shouldRefreshCachedResource,
} from "@/react-app/utils/cachedResourceLoader";
import type { RankingPlayer, TrainingRank, UserProfile } from "@/shared/types";

type RankingMode = "global" | "friends";

type RankingEntry = {
  userId?: string | undefined;
  username: string;
  full_name: string;
  avatar_url?: string | null | undefined;
  level: number;
  xp: number;
  current_streak: number;
  training_rank: TrainingRank;
  training_rank_score: number;
};
const SECONDARY_PROFILE_CACHE_TTL_MS = 5 * 60_000;

function normalizeRankingEntry(player: RankingPlayer): RankingEntry {
  return {
    userId: player.user_id,
    username: player.username,
    full_name: player.full_name,
    avatar_url: player.avatar_url ?? null,
    level: player.level,
    xp: player.xp,
    current_streak: player.current_streak,
    training_rank: player.training_rank ?? "iniciante",
    training_rank_score: Number(player.training_rank_score ?? 0),
  };
}

function sortRankingEntries(entries: RankingEntry[]): RankingEntry[] {
  return [...entries].sort((left, right) => {
    if (right.training_rank_score !== left.training_rank_score) {
      return right.training_rank_score - left.training_rank_score;
    }
    if (right.level !== left.level) {
      return right.level - left.level;
    }
    if (right.xp !== left.xp) {
      return right.xp - left.xp;
    }
    return left.username.localeCompare(right.username, "pt-BR", {
      sensitivity: "base",
    });
  });
}

function formatTrainingRankLabel(rank: TrainingRank): string {
  switch (rank) {
    case "avancado":
      return "Avancado";
    case "intermediario":
      return "Intermediario";
    default:
      return "Iniciante";
  }
}

export default function Ranking() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RankingMode>("global");

  // Carrega ranking e perfil em paralelo, reaproveitando cache quando disponivel.
  const loadRanking = useCallback(async (currentMode: RankingMode) => {
    setError(null);

    const rankingPath = currentMode === "global" ? "/api/ranking/global" : "/api/ranking/friends";
    const cachedRanking = hydrateCachedResource<RankingPlayer[]>(
      rankingPath,
      (payload) => {
        const normalizedCachedList = Array.isArray(payload)
          ? sortRankingEntries(payload.map(normalizeRankingEntry))
          : [];
        setRanking(normalizedCachedList);
        setLoading(false);
      },
    );
    const cachedProfile = hydrateCachedResource<UserProfile>(
      "/api/profile",
      (payload) => {
        setProfile(payload);
      },
      SECONDARY_PROFILE_CACHE_TTL_MS,
    );

    try {
      const primaryTasks: Array<Promise<unknown>> = [];
      const secondaryTasks: Array<Promise<unknown>> = [];

      if (shouldRefreshCachedResource(cachedRanking)) {
        primaryTasks.push(
          refreshCachedResource<RankingPlayer[]>(rankingPath, (payload) => {
            const normalizedRanking = Array.isArray(payload)
              ? sortRankingEntries(payload.map(normalizeRankingEntry))
              : [];
            setRanking(normalizedRanking);
          }),
        );
      }

      if (shouldRefreshCachedResource(cachedProfile)) {
        secondaryTasks.push(
          refreshCachedResource<UserProfile>("/api/profile", (payload) => {
            setProfile(payload);
          }),
        );
      }

      if (primaryTasks.length > 0) {
        await Promise.all(primaryTasks);
      }

      setLoading(false);

      if (secondaryTasks.length > 0) {
        void Promise.allSettled(secondaryTasks);
      }
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app");
        return;
      }

      console.error("Error loading ranking:", loadError);
      if (!cachedRanking.hasCached) {
        setError("Nao foi possivel carregar o ranking agora.");
        setRanking([]);
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  // Recarrega o ranking sempre que o modo ou a sessao mudam.
  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }

    void loadRanking(mode);
  }, [loadRanking, mode, navigate, user]);

  const currentUsername = profile?.username ?? null;
  const top3 = ranking.slice(0, 3);
  const others = ranking.slice(3);
  const isCurrentUserEntry = useCallback((entry: RankingEntry) => {
    if (entry.userId && user?.id) return entry.userId === user.id;
    if (currentUsername) return entry.username === currentUsername;
    return false;
  }, [currentUsername, user?.id]);

  const currentUserEntry = ranking.find(isCurrentUserEntry) ?? null;
  const currentUserPosition = currentUserEntry
    ? ranking.findIndex((entry) => isCurrentUserEntry(entry)) + 1
    : 0;

  if (loading && ranking.length === 0) {
    return (
      <AppPageShell bottomNavActive="ranking" className="fl-theme-page">
        <div className="flex flex-1 items-center justify-center">
          <LoadingBall size="md" />
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell bottomNavActive="ranking" className="fl-theme-page">
      <div className="flex flex-1 min-w-0 flex-col overflow-y-auto p-4 pb-[98px] sm:p-6 lg:p-8">
        {/* Cabecalho contextual do ranking atual. */}
        <header className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 sm:mb-8">
          <div className="min-w-0">
            <h1 className="mb-1 truncate text-xl font-bold uppercase tracking-[0.15em] sm:text-2xl sm:tracking-[0.2em]">
              {mode === "global" ? "Ranking Global" : "Ranking de Amigos"}
            </h1>
            <p className="fl-theme-text-muted truncate text-[9px] font-bold uppercase tracking-widest sm:text-[10px]">
              Posicoes definidas pelo rank de treinamento.
            </p>
          </div>
        </header>

        {error ? (
          <div
            className="mb-8 rounded-3xl border px-5 py-4 text-[11px] font-bold uppercase tracking-widest"
            style={{
              borderColor: "color-mix(in srgb, var(--app-primary-color) 24%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--app-primary-color) 10%, transparent)",
              color: "var(--app-primary-color)",
            }}
          >
            {error}
          </div>
        ) : null}

        {/* Alterna entre o ranking global e a visao apenas de amigos. */}
        <div className="mb-6 sm:mb-10">
          <div className="fl-theme-surface-soft mx-auto flex min-w-0 max-w-[320px] rounded-2xl p-1.5">
            <button
              type="button"
              onClick={() => setMode("global")}
              className="flex-1 rounded-xl py-3 text-[10px] font-bold uppercase tracking-widest transition-all"
              style={{
                backgroundColor: mode === "global" ? "var(--app-primary-color)" : undefined,
                color: mode === "global" ? "var(--fl-nav-item-active-text)" : "var(--fl-color-text-muted)",
              }}
            >
              Global
            </button>
            <button
              type="button"
              onClick={() => setMode("friends")}
              className="flex-1 rounded-xl py-3 text-[10px] font-bold uppercase tracking-widest transition-all"
              style={{
                backgroundColor: mode === "friends" ? "var(--app-primary-color)" : undefined,
                color: mode === "friends" ? "var(--fl-nav-item-active-text)" : "var(--fl-color-text-muted)",
              }}
            >
              Amigos
            </button>
          </div>
        </div>

        {/* Resume a posicao atual do usuario para orientar a leitura da tabela. */}
        {currentUserEntry ? (
          <section className="fl-theme-surface mb-6 min-w-0 rounded-[1.5rem] p-4 sm:mb-10 sm:rounded-[2rem] sm:p-6">
            <div className="mb-4 flex items-center gap-3 sm:mb-5">
              <Trophy className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" style={{ color: "var(--app-primary-color)" }} />
              <h2 className="truncate text-[9px] font-bold uppercase tracking-[0.2em] sm:text-[10px] sm:tracking-[0.3em]">
                Sua posicao atual
              </h2>
            </div>
            <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 sm:gap-4">
              <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 sm:gap-4">
                <div className="size-10 shrink-0 overflow-hidden rounded-full border sm:size-14" style={{ borderColor: "var(--fl-border-soft)" }}>
                  <Avatar
                    src={currentUserEntry.avatar_url ?? null}
                    name={currentUserEntry.username}
                    className="h-full w-full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate whitespace-nowrap text-[clamp(0.72rem,3vw,1.125rem)] font-bold tracking-tight">
                    Voce ({currentUserEntry.username})
                  </p>
                  <p className="fl-theme-text-muted truncate whitespace-nowrap text-[clamp(0.38rem,1.7vw,0.625rem)] font-bold uppercase tracking-[0.14em] sm:tracking-[0.2em]">
                    {currentUserEntry.current_streak} dias de streak
                  </p>
                </div>
              </div>
              <div className="min-w-0 shrink-0 text-right">
                <p
                  className="whitespace-nowrap text-[clamp(1.1rem,5vw,1.875rem)] font-bold tracking-tight"
                  style={{ color: "var(--app-primary-color)" }}
                >
                  #{currentUserPosition}
                </p>
                <p className="fl-theme-text-muted whitespace-nowrap text-[clamp(0.36rem,1.55vw,0.625rem)] font-bold uppercase tracking-[0.12em] sm:tracking-[0.2em]">
                  {`${formatTrainingRankLabel(currentUserEntry.training_rank)} - Score ${currentUserEntry.training_rank_score}`}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* Destaque do podium com os tres melhores colocados. */}
        <div className="mx-auto mb-16 flex w-full max-w-[720px] min-w-0 items-end justify-center gap-1.5 px-1 pt-10 sm:mb-24 sm:gap-6 sm:px-4 sm:pt-14">
          <PodiumCard entry={top3[1]} position={2} highlightColor="#64748b" />
          <PodiumCard entry={top3[0]} position={1} highlightColor="var(--app-primary-color)" featured />
          <PodiumCard entry={top3[2]} position={3} highlightColor="#92400e" />
        </div>

        {/* Lista completa dos demais competidores e fallback vazio. */}
        <div className="mx-auto mb-8 flex w-full max-w-[800px] flex-col gap-4">
          <div className="fl-theme-text-muted flex items-center px-4 py-2 text-[10px] font-bold uppercase tracking-[0.3em] sm:px-6">
            <span className="w-8 sm:w-10">POS</span>
            <span className="flex-1 px-4">USUARIO</span>
            <span className="text-right">RANK</span>
          </div>

          {others.map((player, index) => {
            const position = index + 4;
            const isCurrentUser = isCurrentUserEntry(player);

            return (
              <div
                key={`${player.username}-${position}`}
                className={`relative flex min-w-0 items-center rounded-2xl border p-3 transition-all duration-300 sm:p-4 ${isCurrentUser ? "overflow-hidden" : ""}`}
                style={{
                  borderColor: isCurrentUser
                    ? "color-mix(in srgb, var(--app-primary-color) 30%, transparent)"
                    : "var(--fl-border-soft)",
                  backgroundColor: isCurrentUser
                    ? "color-mix(in srgb, var(--app-primary-color) 8%, transparent)"
                    : "color-mix(in srgb, var(--fl-surface-muted) 70%, transparent)",
                }}
              >
                {isCurrentUser ? (
                  <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: "var(--app-primary-color)" }} />
                ) : null}
                <span
                  className="w-6 shrink-0 text-[10px] font-bold sm:w-10 sm:text-sm"
                  style={{ color: isCurrentUser ? "var(--app-primary-color)" : "var(--fl-color-text-muted)" }}
                >
                  {position}
                </span>
                <div
                  className="mx-2 size-10 shrink-0 overflow-hidden rounded-full border sm:mx-4 sm:size-12"
                  style={{ borderColor: isCurrentUser ? "var(--app-primary-color)" : "var(--fl-border-soft)" }}
                >
                  <Avatar src={player.avatar_url ?? null} name={player.username} className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold tracking-tight">
                    {isCurrentUser ? `Voce (${player.username})` : player.username}
                  </p>
                  <p className="fl-theme-text-muted mt-0.5 text-[10px] font-bold uppercase tracking-[0.15em]">
                    {player.current_streak} dias de streak
                  </p>
                </div>
                <div className="min-w-0 shrink-0 text-right">
                  <p className="truncate text-xs font-bold sm:text-base">
                    {formatTrainingRankLabel(player.training_rank).toUpperCase()}
                  </p>
                  <p
                    className="truncate text-[8px] font-bold uppercase tracking-[0.1em] sm:text-[10px] sm:tracking-[0.15em]"
                    style={{ color: "var(--app-primary-color)" }}
                  >
                    {`Score ${player.training_rank_score} - LVL ${player.level}`}
                  </p>
                </div>
              </div>
            );
          })}

          {ranking.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Trophy className="fl-theme-text-soft mb-6 h-16 w-16" />
              <p className="fl-theme-text-muted text-[11px] font-bold uppercase tracking-[0.2em]">
                Nenhum competidor encontrado.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </AppPageShell>
  );
}

function PodiumCard({
  entry,
  position,
  highlightColor,
  featured = false,
}: {
  entry: RankingEntry | undefined;
  position: number;
  highlightColor: string;
  featured?: boolean;
}) {
  // Renderiza a versao compacta de cada faixa do podium.
  if (!entry) return <div className="flex-1" />;

  return (
    <div className={`flex flex-1 flex-col items-center ${featured ? "-mt-10 max-w-[140px] sm:-mt-12 sm:max-w-[180px]" : "max-w-[100px] sm:max-w-[140px]"}`}>
      <div className="relative mb-5">
        {featured ? (
          <Crown className="absolute -top-10 left-1/2 h-12 w-12 -translate-x-1/2" style={{ color: highlightColor }} />
        ) : null}
        <div className={`overflow-hidden rounded-full border-4 ${featured ? "size-20 sm:size-28" : "size-12 sm:size-20"}`} style={{ borderColor: highlightColor }}>
          <Avatar src={entry.avatar_url ?? null} name={entry.username} className="h-full w-full" />
        </div>
        <div
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 truncate rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] sm:px-4 sm:py-1 sm:text-[9px] sm:tracking-[0.2em]"
          style={{ backgroundColor: highlightColor, color: "var(--fl-nav-item-active-text)" }}
        >
          {position === 1 ? "Campeao" : `${position}o`}
        </div>
      </div>
      <div
        className={`w-full rounded-t-[1.5rem] border-x border-t p-2 text-center sm:rounded-t-[2rem] sm:p-4 ${featured ? "h-28 sm:h-40" : "h-24 sm:h-30"}`}
        style={{
          borderColor: "var(--fl-border-soft)",
          backgroundColor: featured
            ? "color-mix(in srgb, var(--app-primary-color) 10%, transparent)"
            : "color-mix(in srgb, var(--fl-surface-muted) 70%, transparent)",
        }}
      >
        <p className="truncate text-sm font-bold sm:text-base">{entry.username}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-primary-color)" }}>
          {formatTrainingRankLabel(entry.training_rank)}
        </p>
        <div className="mt-2 space-y-1 text-center">
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] sm:text-[10px]">
            LVL {entry.level}
          </p>
          <p className="fl-theme-text-muted text-[8px] font-bold uppercase tracking-[0.12em] sm:text-[9px]">
            Score {entry.training_rank_score}
          </p>
        </div>
      </div>
    </div>
  );
}
