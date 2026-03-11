import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/react-app/contexts/auth";
import { useNavigate, useSearchParams } from "react-router";
import BottomNav from "@/react-app/components/BottomNav";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Swords, Trophy, Clock, Zap, Target, Users, ChevronRight } from "lucide-react";
import { ApiRequestError, api, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";

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

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    void loadGames();
    void loadSkills();
  }, [user, navigate, loadGames, loadSkills]);

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

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (response.ok) {
        alert("Desafio criado com sucesso!");
        setShowCreateForm(false);
        void loadGames();
      } else {
        const responseError = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        alert(responseError?.error || "Erro ao criar desafio");
      }
    } catch (error) {
      console.error("Error creating challenge:", error);
      alert("Erro ao criar desafio");
    }
  };

  const acceptChallenge = async (gameId: number) => {
    try {
      const response = await api(`/api/mini-games/${gameId}/accept`, {
        method: "POST"
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (response.ok) {
        void loadGames();
      } else {
        const responseError = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        setError(responseError?.error || "Não foi possível aceitar o desafio.");
      }
    } catch (acceptError) {
      console.error("Error accepting challenge:", acceptError);
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

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (response.ok) {
        const result = await response.json();
        if (result.winner) {
          alert(result.winner === user?.id ? "Você venceu!" : "Desafio finalizado.");
        }
        void loadGames();
      } else {
        const responseError = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        setError(responseError?.error || "Não foi possível concluir o desafio.");
      }
    } catch (error) {
      console.error("Error completing challenge:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-red-50 pb-24">
        <div className="px-6 py-10">
          <div className="fl-card p-6 flex items-center justify-center">
            <LoadingBall size="md" />
          </div>
        </div>
        <BottomNav active="arena" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-red-50 pb-24">
        <div className="px-6 py-12 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => { setLoading(true); void loadSkills(); void loadGames(); }} className="fl-btn-primary rounded-xl px-4 py-2">
            Tentar novamente
          </button>
        </div>
        <BottomNav active="arena" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-red-50 pb-24">
        <div className="px-6 py-12 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => { setLoading(true); void loadSkills(); void loadGames(); }} className="fl-btn-primary rounded-xl px-4 py-2">
            Tentar novamente
          </button>
        </div>
        <BottomNav active="friends" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-red-50 pb-24">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Swords className="w-8 h-8 text-purple-600" />
              <h1 className="fl-title-page">Mini-Games</h1>
            </div>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="bg-gradient-to-r from-purple-500 to-pink-600 text-white px-6 py-3 rounded-full font-semibold hover:shadow-lg transition-all flex items-center gap-2"
            >
              <Zap className="w-5 h-5" />
              Novo Desafio
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6">
        {/* Create Challenge Form */}
        {showCreateForm && (
          <div className="bg-white rounded-3xl shadow-2xl p-8 mb-6 animate-fadeIn">
            <h2 className="fl-title-section mb-6">Criar Novo Desafio</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Oponente</label>
                <div className="flex gap-4">
                  <button
                    onClick={() => setOpponentType('friend')}
                    className={`flex-1 py-3 rounded-xl font-semibold transition-all ${
                      opponentType === 'friend'
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    disabled={!!challengeUserId}
                  >
                    <Users className="w-5 h-5 inline mr-2" />
                    Amigo
                  </button>
                  <button
                    onClick={() => setOpponentType('random')}
                    className={`flex-1 py-3 rounded-xl font-semibold transition-all ${
                      opponentType === 'random'
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    disabled={!!challengeUserId}
                  >
                    <Zap className="w-5 h-5 inline mr-2" />
                    Aleatório
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Habilidade</label>
                <select
                  value={selectedSkill || ''}
                  onChange={(e) => setSelectedSkill(parseInt(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">Selecione uma habilidade</option>
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name} ({skill.difficulty})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Meta de Repetições: {targetReps}
                </label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={targetReps}
                  onChange={(e) => setTargetReps(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                <h3 className="font-bold text-purple-900 mb-2">Recompensas</h3>
                <div className="space-y-1 text-sm text-purple-700">
                  <div>🏆 Vencedor: {targetReps * 5} XP + {targetReps} Pontos</div>
                  <div>🎖️ Perdedor: {Math.floor(targetReps * 2.5)} XP + {Math.floor(targetReps / 2)} Pontos</div>
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-full font-semibold hover:bg-gray-300"
                >
                  Cancelar
                </button>
                <button
                  onClick={createChallenge}
                  className="flex-1 bg-gradient-to-r from-purple-500 to-pink-600 text-white py-3 rounded-full font-semibold hover:shadow-lg"
                >
                  Criar Desafio
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active Challenges */}
        <h2 className="fl-title-card mb-4">Desafios Ativos ({activeGames.length})</h2>
        
        {activeGames.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-3xl shadow-lg">
            <Swords className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Nenhum desafio ativo</p>
            <p className="text-gray-400 text-sm">Crie um novo desafio para começar!</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            {activeGames.map((game) => {
              const isChallenger = game.challenger_user_id === user?.id;
              const isPending = game.status === 'pending';
              const isActive = game.status === 'active';
              
              return (
                <div key={game.id} className="fl-card p-6 hover:shadow-xl transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
                      isPending ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {isPending ? 'Aguardando' : 'Em Andamento'}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <Clock className="w-4 h-4" />
                      {new Date(game.deadline).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="space-y-3 mb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Desafiante:</span>
                      <span className={`font-bold ${isChallenger ? 'text-purple-600' : 'text-gray-900'}`}>
                        {game.challenger_username} {isChallenger && '(Você)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Desafiado:</span>
                      <span className={`font-bold ${!isChallenger ? 'text-purple-600' : 'text-gray-900'}`}>
                        {game.challenged_username} {!isChallenger && '(Você)'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-5 h-5 text-purple-600" />
                      <span className="font-bold text-gray-900">{game.skill_name}</span>
                    </div>
                    <div className="text-2xl font-bold text-purple-600">
                      {game.target_reps} repetições
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm mb-4">
                    <div className="flex items-center gap-1">
                      <Trophy className="w-4 h-4 text-yellow-500" />
                      <span className="text-gray-600">Vencedor:</span>
                      <span className="font-bold text-gray-900">{game.xp_reward} XP</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Zap className="w-4 h-4 text-emerald-500" />
                      <span className="font-bold text-gray-900">{game.points_reward} Pontos</span>
                    </div>
                  </div>

                  {isPending && !isChallenger && (
                    <button
                      onClick={() => acceptChallenge(game.id)}
                      className="w-full bg-gradient-to-r from-purple-500 to-pink-600 text-white py-3 rounded-full font-semibold hover:shadow-lg flex items-center justify-center gap-2"
                    >
                      Aceitar Desafio
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}

                  {isActive && (
                    <button
                      onClick={() => {
                        const reps = parseInt(prompt(`Quantas repetições você completou?`) || '0');
                        const time = parseInt(prompt(`Quanto tempo levou (segundos)?`) || '0');
                        if (reps > 0 && time > 0) {
                          completeChallenge(game.id, reps, time);
                        }
                      }}
                      className="fl-btn-primary w-full py-3 rounded-full hover:shadow-lg flex items-center justify-center gap-2"
                    >
                      Completar Desafio
                      <Trophy className="w-5 h-5" />
                    </button>
                  )}

                  {isPending && isChallenger && (
                    <div className="text-center text-sm text-gray-500">
                      Aguardando oponente aceitar...
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Completed Games */}
        {completedGames.length > 0 && (
          <>
            <h2 className="fl-title-card mb-4">Histórico Recente</h2>
            <div className="space-y-3">
              {completedGames.map((game) => {
                const isWinner = game.winner_user_id === user?.id;
                return (
                  <div key={game.id} className="bg-white rounded-xl p-4 shadow-md flex items-center justify-between">
                    <div>
                      <div className="font-bold text-gray-900">{game.skill_name}</div>
                      <div className="text-sm text-gray-500">
                        {game.challenger_username} vs {game.challenged_username}
                      </div>
                    </div>
                    <div className={`px-4 py-2 rounded-full font-bold ${
                      isWinner ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {isWinner ? '🏆 Vitória' : '🎖️ Participação'}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <BottomNav active="arena" />
    </div>
  );
}


