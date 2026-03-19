import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Crown, Filter as FilterIcon, Trophy } from "lucide-react";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Avatar } from "@/react-app/components/ui/avatar";
import { useAuth } from "@/react-app/contexts/auth";
import { ApiRequestError, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
import type { RankingPlayer, UserProfile } from "@/shared/types";

type RankingMode = "global" | "friends";

type FriendRankingRow = {
  friend_username: string;
  friend_full_name: string;
  friend_level: number;
  friend_xp: number;
  friend_streak: number;
};

type RankingEntry = {
  username: string;
  full_name: string;
  level: number;
  xp: number;
  current_streak: number;
};

function normalizeRankingEntry(player: RankingPlayer | FriendRankingRow): RankingEntry {
  if ("friend_username" in player) {
    return {
      username: player.friend_username,
      full_name: player.friend_full_name,
      level: player.friend_level,
      xp: player.friend_xp,
      current_streak: player.friend_streak,
    };
  }

  return {
    username: player.username,
    full_name: player.full_name,
    level: player.level,
    xp: player.xp,
    current_streak: player.current_streak,
  };
}

export default function Ranking() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RankingMode>("global");

  const loadRanking = useCallback(async (currentMode: RankingMode) => {
    setError(null);

    const rankingPath = currentMode === "global" ? "/api/ranking/global" : "/api/friends";
    const cachedRanking = readCachedJson<Array<RankingPlayer | FriendRankingRow>>(rankingPath);
    const cachedProfile = readCachedJson<UserProfile>("/api/profile");

    if (cachedRanking) {
      const cachedList = Array.isArray(cachedRanking.data)
        ? cachedRanking.data.map(normalizeRankingEntry)
        : [];
      setRanking(cachedList);
      setLoading(false);
    }

    if (cachedProfile) {
      setProfile(cachedProfile.data);
    }

    try {
      const [nextRanking, nextProfile] = await Promise.all([
        fetchAndCacheJson<Array<RankingPlayer | FriendRankingRow>>(rankingPath),
        fetchAndCacheJson<UserProfile>("/api/profile"),
      ]);

      setRanking(Array.isArray(nextRanking) ? nextRanking.map(normalizeRankingEntry) : []);
      setProfile(nextProfile);
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app");
        return;
      }

      console.error("Error loading ranking:", loadError);
      if (!cachedRanking) {
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
  }, [loadRanking, mode, navigate, user]);

  const currentUsername = profile?.username ?? null;
  const top3 = ranking.slice(0, 3);
  const others = ranking.slice(3);
  const currentUserEntry = currentUsername
    ? ranking.find((entry) => entry.username === currentUsername) ?? null
    : null;
  const currentUserPosition = currentUsername
    ? ranking.findIndex((entry) => entry.username === currentUsername) + 1
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
      <div className="flex flex-1 flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="mb-1 text-2xl font-bold uppercase tracking-[0.2em]">
              {mode === "global" ? "Ranking Global" : "Ranking de Amigos"}
            </h1>
            <p className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-widest">
              Os guerreiros mais consistentes do FitLoot.
            </p>
          </div>
          <button className="fl-theme-surface-soft rounded-2xl p-3.5 fl-theme-text-muted transition-all hover:opacity-90">
            <FilterIcon className="h-5 w-5" />
          </button>
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

        <div className="mb-10">
          <div className="fl-theme-surface-soft flex max-w-[320px] rounded-2xl p-1.5">
            <button
              type="button"
              onClick={() => setMode("global")}
              className="flex-1 rounded-xl py-3 text-[10px] font-bold uppercase tracking-widest transition-all"
              style={{ backgroundColor: mode === "global" ? "var(--app-primary-color)" : undefined, color: mode === "global" ? "var(--fl-nav-item-active-text)" : "var(--fl-color-text-muted)" }}
            >
              Global
            </button>
            <button
              type="button"
              onClick={() => setMode("friends")}
              className="flex-1 rounded-xl py-3 text-[10px] font-bold uppercase tracking-widest transition-all"
              style={{ backgroundColor: mode === "friends" ? "var(--app-primary-color)" : undefined, color: mode === "friends" ? "var(--fl-nav-item-active-text)" : "var(--fl-color-text-muted)" }}
            >
              Amigos
            </button>
          </div>
        </div>

        {currentUserEntry ? (
          <section className="fl-theme-surface mb-10 rounded-[2rem] p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3">
              <Trophy className="h-5 w-5" style={{ color: "var(--app-primary-color)" }} />
              <h2 className="text-[10px] font-bold uppercase tracking-[0.3em]">Sua posição atual</h2>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <div className="size-14 overflow-hidden rounded-full border" style={{ borderColor: "var(--fl-border-soft)" }}>
                  <Avatar
                    name={currentUserEntry.username}
                    className="h-full w-full"
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold tracking-tight">
                    Você ({currentUserEntry.username})
                  </p>
                  <p className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">
                    {currentUserEntry.current_streak} dias de streak
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold tracking-tight" style={{ color: "var(--app-primary-color)" }}>
                  #{currentUserPosition}
                </p>
                <p className="fl-theme-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">
                  {`LVL ${currentUserEntry.level} • ${(currentUserEntry.xp / 1000).toFixed(1)}K XP`}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <div className="mx-auto mb-12 flex w-full max-w-[720px] items-end justify-center gap-2 px-2 pt-10 sm:gap-6 sm:px-4">
          <PodiumCard entry={top3[1]} position={2} highlightColor="#64748b" />
          <PodiumCard entry={top3[0]} position={1} highlightColor="var(--app-primary-color)" featured />
          <PodiumCard entry={top3[2]} position={3} highlightColor="#92400e" />
        </div>

        <div className="mx-auto mb-8 flex w-full max-w-[800px] flex-col gap-4">
          <div className="flex items-center px-4 py-2 text-[10px] font-bold uppercase tracking-[0.3em] fl-theme-text-muted sm:px-6">
            <span className="w-8 sm:w-10">POS</span>
            <span className="flex-1 px-4">USUÁRIO</span>
            <span className="text-right">EXPERIÊNCIA</span>
          </div>

          {others.map((player, index) => {
            const position = index + 4;
            const isCurrentUser = player.username === currentUsername;

            return (
              <div
                key={`${player.username}-${position}`}
                className={`relative flex items-center rounded-2xl border p-4 transition-all duration-300 ${isCurrentUser ? "overflow-hidden" : ""}`}
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
                  className="w-8 text-sm font-bold sm:w-10"
                  style={{ color: isCurrentUser ? "var(--app-primary-color)" : "var(--fl-color-text-muted)" }}
                >
                  {position}
                </span>
                <div
                  className="mx-4 size-12 shrink-0 overflow-hidden rounded-full border"
                  style={{ borderColor: isCurrentUser ? "var(--app-primary-color)" : "var(--fl-border-soft)" }}
                >
                  <Avatar name={player.username} className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold tracking-tight">
                    {isCurrentUser ? `Você (${player.username})` : player.username}
                  </p>
                  <p className="fl-theme-text-muted mt-0.5 text-[10px] font-bold uppercase tracking-[0.15em]">
                    {player.current_streak} dias de streak
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold">LVL {player.level}</p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--app-primary-color)" }}>
                    {(player.xp / 1000).toFixed(1)}K XP
                  </p>
                </div>
              </div>
            );
          })}

          {ranking.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Trophy className="mb-6 h-16 w-16 fl-theme-text-soft" />
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
  if (!entry) return <div className="flex-1" />;

  return (
    <div className={`flex flex-1 flex-col items-center ${featured ? "-mt-8 max-w-[180px]" : "max-w-[140px]"}`}>
      <div className="relative mb-5">
        {featured ? (
          <Crown className="absolute -top-10 left-1/2 h-12 w-12 -translate-x-1/2" style={{ color: highlightColor }} />
        ) : null}
        <div className={`overflow-hidden rounded-full border-4 ${featured ? "size-28" : "size-20"}`} style={{ borderColor: highlightColor }}>
          <Avatar name={entry.username} className="h-full w-full" />
        </div>
        <div
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-[9px] font-bold uppercase tracking-[0.2em]"
          style={{ backgroundColor: highlightColor, color: "var(--fl-nav-item-active-text)" }}
        >
          {position === 1 ? "Campeão" : `${position}º`}
        </div>
      </div>
      <div
        className={`w-full rounded-t-[2rem] border-x border-t p-4 text-center ${featured ? "h-36" : "h-24"}`}
        style={{
          borderColor: "var(--fl-border-soft)",
          backgroundColor: featured
            ? "color-mix(in srgb, var(--app-primary-color) 10%, transparent)"
            : "color-mix(in srgb, var(--fl-surface-muted) 70%, transparent)",
        }}
      >
        <p className="truncate text-sm font-bold sm:text-base">{entry.username}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--app-primary-color)" }}>
          LVL {entry.level}
        </p>
      </div>
    </div>
  );
}
