import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Search, UserPlus, Users, X } from "lucide-react";
import LoadingBall from "@/react-app/components/LoadingBall";
import { Avatar } from "@/react-app/components/ui/avatar";
import { Badge } from "@/react-app/components/ui/badge";
import { Button } from "@/react-app/components/ui/button";
import { Card } from "@/react-app/components/ui/card";
import { ROUTE_PATHS } from "@/react-app/auth/constants";
import { api } from "@/react-app/utils/api";

type Friend = {
  id: number;
  friend_user_id: string;
  friend_username: string;
  friend_full_name: string;
  friend_level: number;
  friend_xp: number;
  friend_streak: number;
  status?: string | undefined;
};

type SearchResult = {
  user_id: string;
  username: string;
  full_name: string;
  level: number;
  xp: number;
};

const FRIENDS_CACHE_TTL_MS = 60_000;

let friendsCache:
  | {
      cachedAt: number;
      friends: Friend[];
      pending: Friend[];
    }
  | null = null;

export default function ProfileFriendsPanel() {
  const navigate = useNavigate();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Friend[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyCachedFriends = useCallback((cache: { friends: Friend[]; pending: Friend[] }) => {
    setFriends(cache.friends);
    setPendingRequests(cache.pending);
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

      setFriends(nextFriends);
      setPendingRequests(nextPending);
      friendsCache = { cachedAt: Date.now(), friends: nextFriends, pending: nextPending };
    } catch {
      setError("Nao foi possivel carregar a lista de amigos agora.");
    } finally {
      setLoading(false);
    }
  }, [applyCachedFriends, navigate]);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

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
        throw new Error("Falha na busca de usuarios.");
      }
      const payload = (await response.json()) as SearchResult[];
      setSearchResults(Array.isArray(payload) ? payload : []);
    } catch {
      setError("Nao foi possivel buscar usuarios agora.");
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
        setError(payload?.error ?? "Nao foi possivel enviar solicitacao.");
        return;
      }

      setSearchQuery("");
      setSearchResults([]);
      await loadFriends(true);
    } catch {
      setError("Nao foi possivel enviar solicitacao.");
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
        setError(payload?.error ?? "Nao foi possivel responder a solicitacao.");
        return;
      }

      await loadFriends(true);
    } catch {
      setError("Nao foi possivel responder a solicitacao.");
    }
  };

  if (loading) {
    return (
      <div className="fl-card p-8 flex items-center justify-center">
        <LoadingBall size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between gap-3">
          <span>{error}</span>
          <Button className="rounded-lg px-3 py-1 text-xs" onClick={() => { void loadFriends(true); }}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-lg font-bold text-gray-900">Buscar amigos</h3>
        <div className="relative flex items-center gap-2">
          <Search className="absolute left-4 text-gray-400 w-5 h-5 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar usuarios por username..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchUsers();
              }
            }}
            className="w-full h-12 pl-12 pr-4 rounded-full border-2 border-gray-200 focus:border-emerald-500 focus:outline-none"
          />
          <Button
            onClick={() => { void searchUsers(); }}
            disabled={searching}
            className="h-12 min-w-[110px] rounded-full"
          >
            {searching ? <LoadingBall size="sm" /> : "Buscar"}
          </Button>
        </div>

        {searchResults.length > 0 ? (
          <Card className="p-3 space-y-2">
            {searchResults.map((result) => (
              <div key={result.user_id} className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <Avatar name={result.full_name || result.username} className="h-10 w-10 text-sm bg-emerald-100 text-emerald-700" />
                  <div>
                    <div className="font-semibold text-gray-900">{result.username}</div>
                    <div className="text-xs text-gray-500">{result.full_name}</div>
                    <Badge className="mt-1">Nivel {result.level}</Badge>
                  </div>
                </div>
                <Button className="px-4 py-2 rounded-full" onClick={() => { void sendFriendRequest(result.user_id); }}>
                  <UserPlus className="w-4 h-4" />
                  Adicionar
                </Button>
              </div>
            ))}
          </Card>
        ) : null}
      </div>

      {pendingRequests.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-gray-900">Solicitacoes pendentes ({pendingRequests.length})</h3>
          {pendingRequests.map((request) => (
            <div key={request.id} className="fl-card p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">{request.friend_username}</p>
                <p className="text-xs text-gray-500">{request.friend_full_name}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { void respondRequest(request.id, true); }} className="fl-btn-primary rounded-full p-2" aria-label="Aceitar">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => { void respondRequest(request.id, false); }} className="rounded-full p-2 bg-red-500 text-white hover:bg-red-600" aria-label="Recusar">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Meus amigos ({friends.length})</h3>
          <Button variant="secondary" onClick={() => navigate(ROUTE_PATHS.minigames)}>
            Ver Arena
          </Button>
        </div>

        {friends.length === 0 ? (
          <div className="fl-card p-6 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Voce ainda nao tem amigos adicionados.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {friends.map((friend) => (
              <div key={friend.id} className="fl-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-gray-900">{friend.friend_username}</p>
                  <p className="text-sm text-emerald-700 font-semibold">Nv {friend.friend_level}</p>
                </div>
                <p className="text-xs text-gray-500">{friend.friend_full_name}</p>
                <p className="text-xs text-gray-500 mt-2">{friend.friend_xp} XP • {friend.friend_streak} dias de streak</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
