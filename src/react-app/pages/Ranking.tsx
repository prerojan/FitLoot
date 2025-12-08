import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/App";
import BottomNav from "@/react-app/components/BottomNav";
import { Trophy, Medal, Crown, Flame, Zap } from "lucide-react";
import { api } from "@/react-app/utils/api";

export default function Ranking() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ranking, setRanking] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    loadRanking();
  }, [user, navigate]);

  const loadRanking = async () => {
    try {
      const response = await api("/api/ranking/global");
      const data = await response.json();
      setRanking(data);
    } catch (error) {
      console.error("Error loading ranking:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center">
        <div className="text-emerald-600">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 pt-8 pb-6 rounded-b-3xl shadow-xl">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full mb-4">
            <Trophy className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold mb-1">Ranking Global</h1>
          <p className="text-emerald-100">Top atletas do FitLoot</p>
        </div>

        {/* Top 3 Podium */}
        {ranking.length >= 3 && (
          <div className="flex items-end justify-center gap-2 mb-6">
            {/* 2nd Place */}
            <PodiumCard
              position={2}
              player={ranking[1]}
              height="h-24"
            />
            
            {/* 1st Place */}
            <PodiumCard
              position={1}
              player={ranking[0]}
              height="h-32"
            />
            
            {/* 3rd Place */}
            <PodiumCard
              position={3}
              player={ranking[2]}
              height="h-20"
            />
          </div>
        )}
      </div>

      {/* Rankings List */}
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
  player: any;
  height: string;
}) {
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
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl p-3 mb-2 text-center shadow-xl">
        <div className="flex justify-center mb-2">
          {getMedalIcon()}
        </div>
        <p className="font-bold text-gray-900 text-sm truncate">{player.username}</p>
        <p className="text-xs text-gray-600">Nv {player.level}</p>
        <div className="flex items-center justify-center gap-1 mt-2 text-xs text-emerald-600">
          <Flame className="w-3 h-3" />
          <span>{player.current_streak}d</span>
        </div>
      </div>
      <div className={`bg-gradient-to-b ${getBgColor()} ${height} rounded-t-xl flex items-center justify-center font-bold text-white text-xl shadow-lg`}>
        {position}
      </div>
    </div>
  );
}

function RankingCard({ position, player }: { position: number; player: any }) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg flex items-center gap-4 hover:shadow-xl transition-all">
      <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold text-lg rounded-xl flex-shrink-0">
        {position}
      </div>

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
    </div>
  );
}
