import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import BottomNav from "@/react-app/components/BottomNav";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Avatar } from "@/react-app/components/ui/avatar";
import { Card } from "@/react-app/components/ui/card";
import { Trophy, Medal, Crown, Flame, Zap } from "lucide-react";
import { ApiRequestError, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";
import type { RankingPlayer } from "@/shared/types";
import { safeGet } from "@/utils/typeHelpers";

export default function Ranking() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ranking, setRanking] = useState<RankingPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  const loadRanking = useCallback(async () => {
    setError(null);
    const cacheRanking = readCachedJson<RankingPlayer[]>("/api/ranking/global");

    if (cacheRanking) {
      setRanking(Array.isArray(cacheRanking.data) ? cacheRanking.data : []);
      setLoading(false);
      if (!cacheRanking.stale) {
        return;
      }
    }

    try {
      const data = await fetchAndCacheJson<RankingPlayer[]>("/api/ranking/global");
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
    void loadRanking();
  }, [user, navigate, loadRanking]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
        <div className="px-6 py-10">
          <div className="fl-card p-6 flex items-center justify-center">
            <LoadingBall size="md" />
          </div>
        </div>
        <BottomNav active="ranking" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
        <div className="px-6 py-12 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={loadRanking} className="fl-btn-primary rounded-xl px-4 py-2">
            Tentar novamente
          </button>
        </div>
        <BottomNav active="ranking" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
        <div className="px-6 py-12 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={loadRanking} className="fl-btn-primary rounded-xl px-4 py-2">
            Tentar novamente
          </button>
        </div>
        <BottomNav active="ranking" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 pt-8 pb-6 rounded-b-3xl shadow-xl">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full mb-4">
            <Trophy className="w-8 h-8" />
          </div>
          <h1 className="fl-title-page text-white mb-1">Ranking Global</h1>
          <p className="text-emerald-100">Top atletas do FitLoot</p>
        </div>

        {safeGet(ranking, 0) && safeGet(ranking, 1) && safeGet(ranking, 2) && (
          <div className="flex items-end justify-center gap-2 mb-6">
            <PodiumCard position={2} player={safeGet(ranking, 1)} height="h-24" />
            <PodiumCard position={1} player={safeGet(ranking, 0)} height="h-32" />
            <PodiumCard position={3} player={safeGet(ranking, 2)} height="h-20" />
          </div>
        )}
      </div>

      <div className="px-6 py-6 space-y-3">
        {ranking.slice(3).map((player, index) => (
          <RankingCard key={index} position={index + 4} player={player} />
        ))}

        {ranking.length === 0 && (
          <div className="text-center py-12">
            <Trophy className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Nenhum atleta no ranking ainda</p>
          </div>
        )}
      </div>

      <BottomNav active="ranking" />
    </div>
  );
}

function PodiumCard({
  position,
  player,
  height,
}: {
  position: number;
  player: RankingPlayer | undefined;
  height: string;
}) {
  if (!player) {
    return null;
  }
  const getMedalIcon = () => {
    if (position === 1) return <Crown className="w-6 h-6 text-yellow-400" />;
    if (position === 2) return <Medal className="w-5 h-5 text-gray-300" />;
    return <Medal className="w-5 h-5 text-orange-400" />;
  };

  const getBgColor = () => {
    if (position === 1) return "from-yellow-400 to-yellow-500";
    if (position === 2) return "from-gray-300 to-gray-400";
    return "from-orange-400 to-orange-500";
  };

  return (
    <div className="flex-1 max-w-[100px]">
      <Card tone="soft" className="p-3 mb-2 text-center shadow-xl">
        <div className="flex justify-center mb-2">{getMedalIcon()}</div>
        <p className="font-bold text-gray-900 text-sm truncate">{player.username}</p>
        <p className="text-xs text-gray-600">Nv {player.level}</p>
        <div className="flex items-center justify-center gap-1 mt-2 text-xs text-emerald-600">
          <Flame className="w-3 h-3" />
          <span>{player.current_streak}d</span>
        </div>
      </Card>
      <div className={`bg-gradient-to-b ${getBgColor()} ${height} rounded-t-xl flex items-center justify-center font-bold text-white text-xl shadow-lg`}>
        {position}
      </div>
    </div>
  );
}

function RankingCard({ position, player }: { position: number; player: RankingPlayer }) {
  return (
    <Card tone="soft" className="p-4 flex items-center gap-4 hover:shadow-xl transition-all">
      <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold text-lg rounded-xl flex-shrink-0">
        {position}
      </div>

      <Avatar name={player.full_name || player.username} className="h-11 w-11 bg-emerald-100 text-emerald-700 text-sm" />

      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-gray-900 truncate">{player.username}</h3>
        <p className="text-sm text-gray-600">{player.full_name}</p>
      </div>

      <div className="text-right">
        <div className="flex items-center gap-1 text-emerald-600 font-bold mb-1">
          <Zap className="w-4 h-4" />
          <span>Nv {player.level}</span>
        </div>
        <div className="flex items-center gap-1 text-orange-600 text-sm">
          <Flame className="w-3 h-3" />
          <span>{player.current_streak}d</span>
        </div>
      </div>
    </Card>
  );
}


