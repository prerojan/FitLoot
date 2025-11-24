import { useEffect, useState } from "react";
import { useAuth } from "@/react-app/App";
import { useNavigate } from "react-router";
import BottomNav from "@/react-app/components/BottomNav";
import { Users, Search, UserPlus, Check, X, Swords, TrendingUp, Loader2 } from "lucide-react";

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

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    loadFriends();
  }, [user, navigate]);

  const loadFriends = async () => {
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        fetch("/api/friends/list"),
        fetch("/api/friends/requests")
      ]);

      if (friendsRes.ok) {
        const data = await friendsRes.json();
        setFriends(data);
      }

      if (requestsRes.ok) {
        const data = await requestsRes.json();
        setPendingRequests(data);
      }
    } catch (error) {
      console.error("Error loading friends:", error);
    } finally {
      setLoading(false);
    }
  };

  const searchUsers = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);
      }
    } catch (error) {
      console.error("Error searching users:", error);
    } finally {
      setSearching(false);
    }
  };

  const sendFriendRequest = async (friendUserId: string) => {
    try {
      const response = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friend_user_id: friendUserId })
      });

      if (response.ok) {
        alert("Solicitação enviada!");
        setSearchQuery("");
        setSearchResults([]);
      }
    } catch (error) {
      console.error("Error sending friend request:", error);
    }
  };

  const acceptFriendRequest = async (requestId: number) => {
    try {
      const response = await fetch(`/api/friends/${requestId}/accept`, {
        method: "POST"
      });

      if (response.ok) {
        loadFriends();
      }
    } catch (error) {
      console.error("Error accepting request:", error);
    }
  };

  const rejectFriendRequest = async (requestId: number) => {
    try {
      const response = await fetch(`/api/friends/${requestId}/reject`, {
        method: "POST"
      });

      if (response.ok) {
        loadFriends();
      }
    } catch (error) {
      console.error("Error rejecting request:", error);
    }
  };

  const createChallenge = (friendUserId: string) => {
    navigate(`/minigames?challenge=${friendUserId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <Users className="w-8 h-8 text-emerald-600" />
            <h1 className="text-3xl font-bold text-gray-900">Amigos</h1>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Buscar usuários por username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchUsers()}
              className="w-full pl-12 pr-4 py-3 rounded-full border-2 border-gray-200 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={searchUsers}
              disabled={searching}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-emerald-500 text-white px-6 py-2 rounded-full hover:bg-emerald-600 disabled:opacity-50"
            >
              {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : "Buscar"}
            </button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mt-4 bg-white rounded-2xl shadow-lg p-4 space-y-2">
              {searchResults.map((result) => (
                <div key={result.user_id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-xl">
                  <div>
                    <div className="font-bold text-gray-900">{result.username}</div>
                    <div className="text-sm text-gray-500">{result.full_name}</div>
                    <div className="text-xs text-emerald-600">Nível {result.level}</div>
                  </div>
                  <button
                    onClick={() => sendFriendRequest(result.user_id)}
                    className="bg-emerald-500 text-white px-4 py-2 rounded-full hover:bg-emerald-600 flex items-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    Adicionar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6">
        {/* Pending Requests */}
        {pendingRequests.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Solicitações Pendentes ({pendingRequests.length})</h2>
            <div className="space-y-3">
              {pendingRequests.map((request) => (
                <div key={request.id} className="bg-white rounded-2xl p-4 shadow-lg flex items-center justify-between">
                  <div>
                    <div className="font-bold text-gray-900">{request.friend_username}</div>
                    <div className="text-sm text-gray-500">{request.friend_full_name}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => acceptFriendRequest(request.id)}
                      className="bg-emerald-500 text-white p-2 rounded-full hover:bg-emerald-600"
                    >
                      <Check className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => rejectFriendRequest(request.id)}
                      className="bg-red-500 text-white p-2 rounded-full hover:bg-red-600"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friends List */}
        <h2 className="text-xl font-bold text-gray-900 mb-4">Meus Amigos ({friends.length})</h2>
        
        {friends.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Você ainda não tem amigos adicionados</p>
            <p className="text-gray-400 text-sm">Use a busca acima para encontrar usuários</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {friends.map((friend) => (
              <div key={friend.id} className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow">
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
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-600 text-white py-3 rounded-full font-semibold hover:shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <Swords className="w-5 h-5" />
                  Desafiar para Mini-Game
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav active="friends" />
    </div>
  );
}
