import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/react-app/contexts/auth";
import { useNavigate } from "react-router";
import AppPageShell from "@/react-app/components/AppPageShell";
import { Badge } from "@/react-app/components/ui/badge";
import { Avatar } from "@/react-app/components/ui/avatar";
import { Button } from "@/react-app/components/ui/button";
import { Card } from "@/react-app/components/ui/card";
import { Users, Search, UserPlus, Check, X, Swords, TrendingUp } from "lucide-react";
import LoadingBall from "@/react-app/components/LoadingBall";
import { api } from "@/react-app/utils/api";

interface Friend {
  id: number;
  friend_user_id: string;
  friend_username: string;
  friend_full_name: string;
  friend_level: number;
  friend_xp: number;
  friend_streak: number;
  status: string;
}

interface SearchResult {
  user_id: string;
  username: string;
  full_name: string;
  level: number;
  xp: number;
}

export default function Friends() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Friend[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const loadFriends = useCallback(async () => {
    try {
      setError(null);
      const [friendsRes, requestsRes] = await Promise.all([
        api("/api/friends"),
        api("/api/friends/requests")
      ]);

      if (friendsRes.status === 401 || friendsRes.status === 403 || requestsRes.status === 401 || requestsRes.status === 403) {
        navigate("/app");
        return;
      }

      if (!friendsRes.ok || !requestsRes.ok) {
        throw new Error("Falha ao carregar amigos.");
      }

      const friendsData = await friendsRes.json();
      const requestsData = await requestsRes.json();
      setFriends(Array.isArray(friendsData) ? friendsData : []);
      setPendingRequests(Array.isArray(requestsData) ? requestsData : []);
    } catch (loadError) {
      console.error("Error loading friends:", loadError);
      setError("Não foi possível carregar a lista de amigos agora.");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

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
      const response = await api(`/api/friends/search?username=${encodeURIComponent(searchQuery)}`);
      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }
      if (!response.ok) {
        throw new Error("Falha na busca de usuários.");
      }
      const data = await response.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (searchError) {
      console.error("Error searching users:", searchError);
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
        body: JSON.stringify({ friend_user_id: friendUserId })
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        setError(payload?.error || "Não foi possível enviar solicitação de amizade.");
        return;
      }

      setSearchQuery("");
      setSearchResults([]);
    } catch (error) {
      console.error("Error sending friend request:", error);
    }
  };

  const acceptFriendRequest = async (requestId: number) => {
    try {
      const response = await api(`/api/friends/accept`, {
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
        setError(payload?.error || "Não foi possível aceitar a solicitação.");
        return;
      }

      void loadFriends();
    } catch (error) {
      console.error("Error accepting request:", error);
    }
  };

  const rejectFriendRequest = async (requestId: number) => {
    try {
      const response = await api(`/api/friends/reject`, {
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
        setError(payload?.error || "Não foi possível recusar a solicitação.");
        return;
      }

      void loadFriends();
    } catch (error) {
      console.error("Error rejecting request:", error);
    }
  };

  const createChallenge = (friendUserId: string) => {
    navigate(`/minigames?challenge=${friendUserId}`);
  };

  if (loading) {
    return (
      <AppPageShell bottomNavActive="arena" className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
        <div className="fl-app-container py-6 sm:py-10">
          <div className="fl-card flex items-center justify-center p-6">
            <LoadingBall size="md" />
          </div>
        </div>
      </AppPageShell>
    );
  }

  if (error) {
    return (
      <AppPageShell bottomNavActive="arena" className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
        <div className="fl-app-container py-10 text-center sm:py-12">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => { setLoading(true); void loadFriends(); }} className="fl-btn-primary rounded-xl px-4 py-2">
            Tentar novamente
          </button>
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell bottomNavActive="arena" className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
      <section className="fl-app-container py-4 sm:py-6">
        <div className="rounded-[1.75rem] border border-white/60 bg-white/80 px-4 py-5 shadow-xl backdrop-blur-sm sm:rounded-[2rem] sm:px-6 sm:py-6">
          <div className="flex items-center gap-3 mb-4">
            <Users className="h-7 w-7 text-emerald-600 sm:h-8 sm:w-8" />
            <h1 className="fl-title-page">Amigos</h1>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Buscar usuÃ¡rios por username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchUsers()}
              className="min-h-11 w-full rounded-full border-2 border-gray-200 py-3 pl-12 pr-[7.5rem] focus:border-emerald-500 focus:outline-none sm:pr-32"
            />
            <Button
              onClick={searchUsers}
              disabled={searching}
              variant="primary"
              className="absolute right-2 top-1/2 flex min-h-10 min-w-[88px] -translate-y-1/2 items-center justify-center rounded-full disabled:opacity-50 sm:min-w-[96px]"
            >
              {searching ? "..." : "Buscar"}
            </Button>
          </div>

          {searchResults.length > 0 && (
            <Card className="mt-4 p-4 space-y-2">
              {searchResults.map((result) => (
                <div key={result.user_id} className="flex flex-col gap-3 rounded-xl p-3 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar name={result.full_name || result.username} className="h-10 w-10 text-sm bg-emerald-100 text-emerald-700" />
                    <div>
                      <div className="font-bold text-gray-900">{result.username}</div>
                      <div className="text-sm text-gray-500">{result.full_name}</div>
                      <Badge className="mt-1">NÃ­vel {result.level}</Badge>
                    </div>
                  </div>
                  <Button
                    onClick={() => sendFriendRequest(result.user_id)}
                    variant="primary"
                    className="flex min-h-11 items-center gap-2 rounded-full px-4 py-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    Adicionar
                  </Button>
                </div>
              ))}
            </Card>
          )}
        </div>
      </section>

      <section className="fl-app-container py-2 pb-6 sm:py-3">
        {pendingRequests.length > 0 && (
          <div className="mb-6">
            <h2 className="fl-title-card mb-4">SolicitaÃ§Ãµes Pendentes ({pendingRequests.length})</h2>
            <div className="space-y-3">
              {pendingRequests.map((request) => (
                <div key={request.id} className="fl-card flex items-center justify-between gap-3 p-4">
                  <div>
                    <div className="font-bold text-gray-900">{request.friend_username}</div>
                    <div className="text-sm text-gray-500">{request.friend_full_name}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => acceptFriendRequest(request.id)}
                      className="fl-btn-primary min-h-11 min-w-11 rounded-full p-2"
                    >
                      <Check className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => rejectFriendRequest(request.id)}
                      className="min-h-11 min-w-11 rounded-full bg-red-500 p-2 text-white hover:bg-red-600"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <h2 className="fl-title-card mb-4">Meus Amigos ({friends.length})</h2>
        
        {friends.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">VocÃª ainda nÃ£o tem amigos adicionados</p>
            <p className="text-gray-400 text-sm">Use a busca acima para encontrar usuÃ¡rios</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {friends.map((friend) => (
              <div key={friend.id} className="fl-card p-5 transition-shadow hover:shadow-xl sm:p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="font-bold text-xl text-gray-900">{friend.friend_username}</div>
                    <div className="text-sm text-gray-500">{friend.friend_full_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-emerald-600">Nv. {friend.friend_level}</div>
                    <div className="text-xs text-gray-500">{friend.friend_xp} XP</div>
                  </div>
                </div>

                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-4 h-4 text-orange-500" />
                    <span className="text-sm font-semibold text-gray-700">
                      {friend.friend_streak} dias de streak
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => createChallenge(friend.friend_user_id)}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-600 py-3 font-semibold text-white transition-all hover:shadow-lg"
                >
                  <Swords className="w-5 h-5" />
                  Desafiar para Mini-Game
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppPageShell>
  );
}





