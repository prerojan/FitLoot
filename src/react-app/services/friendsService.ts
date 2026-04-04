import { api } from "@/react-app/utils/api";

const FRIENDS_CACHE_TTL_MS = 10_000;

export type Friend = {
  id: number;
  friend_user_id: string;
  friend_username: string;
  friend_full_name: string;
  friend_level: number;
  friend_xp: number;
  friend_streak: number;
  status?: string | undefined;
  is_online?: boolean | undefined;
};

export type FriendSearchResult = {
  user_id: string;
  username: string;
  full_name: string;
  level: number;
  xp: number;
};

export type FriendsBundle = {
  friends: Friend[];
  pending: Friend[];
};

type FriendsApiErrorCode = "UNAUTHORIZED" | "REQUEST_FAILED";

export class FriendsApiError extends Error {
  readonly code: FriendsApiErrorCode;
  readonly status: number;

  constructor(code: FriendsApiErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let friendsCache: { cachedAt: number; bundle: FriendsBundle } | null = null;
let inflightBundle: Promise<FriendsBundle> | null = null;

function isUnauthorized(status: number): boolean {
  return status === 401 || status === 403;
}

function cloneBundle(bundle: FriendsBundle): FriendsBundle {
  return {
    friends: [...bundle.friends],
    pending: [...bundle.pending],
  };
}

async function parseApiErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string | undefined }
    | null;
  return payload?.error?.trim() || fallbackMessage;
}

function toFriendsArray(payload: unknown): Friend[] {
  return Array.isArray(payload) ? (payload as Friend[]) : [];
}

async function assertSuccessfulResponse(
  response: Response,
  fallbackMessage: string,
): Promise<void> {
  if (isUnauthorized(response.status)) {
    throw new FriendsApiError("UNAUTHORIZED", response.status, "Sessão expirada.");
  }

  if (response.ok) return;

  throw new FriendsApiError(
    "REQUEST_FAILED",
    response.status,
    await parseApiErrorMessage(response, fallbackMessage),
  );
}

export function clearFriendsCache(): void {
  friendsCache = null;
}

export async function fetchFriendsBundle(
  options: { forceRefresh?: boolean } = {},
): Promise<FriendsBundle> {
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && friendsCache) {
    const age = Date.now() - friendsCache.cachedAt;
    if (age < FRIENDS_CACHE_TTL_MS) {
      return cloneBundle(friendsCache.bundle);
    }
  }

  if (inflightBundle) {
    return inflightBundle;
  }

  inflightBundle = (async () => {
    const [friendsRes, requestsRes] = await Promise.all([
      api("/api/friends"),
      api("/api/friends/requests"),
    ]);

    if (
      isUnauthorized(friendsRes.status) ||
      isUnauthorized(requestsRes.status)
    ) {
      throw new FriendsApiError("UNAUTHORIZED", 401, "Sessão expirada.");
    }

    if (!friendsRes.ok || !requestsRes.ok) {
      const fallbackMessage = "Falha ao carregar amigos.";
      const friendsErrorMessage = friendsRes.ok
        ? fallbackMessage
        : await parseApiErrorMessage(friendsRes, fallbackMessage);
      const requestsErrorMessage = requestsRes.ok
        ? fallbackMessage
        : await parseApiErrorMessage(requestsRes, fallbackMessage);
      throw new FriendsApiError(
        "REQUEST_FAILED",
        Math.max(friendsRes.status, requestsRes.status),
        friendsErrorMessage.length >= requestsErrorMessage.length
          ? friendsErrorMessage
          : requestsErrorMessage,
      );
    }

    const friendsData = toFriendsArray(await friendsRes.json().catch(() => []));
    const requestsData = toFriendsArray(await requestsRes.json().catch(() => []));
    const bundle = {
      friends: friendsData,
      pending: requestsData,
    };

    friendsCache = {
      cachedAt: Date.now(),
      bundle,
    };

    return cloneBundle(bundle);
  })();

  try {
    return await inflightBundle;
  } finally {
    inflightBundle = null;
  }
}

export async function searchUsersByUsername(
  query: string,
): Promise<FriendSearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const response = await api(
    `/api/friends/search?username=${encodeURIComponent(normalized)}`,
  );
  await assertSuccessfulResponse(response, "Falha na busca de usuários.");

  const payload = (await response.json().catch(() => [])) as FriendSearchResult[];
  return Array.isArray(payload) ? payload : [];
}

export async function sendFriendRequest(friendUserId: string): Promise<void> {
  const response = await api("/api/friends/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ friend_user_id: friendUserId }),
  });
  await assertSuccessfulResponse(response, "Não foi possível enviar solicitação.");
  clearFriendsCache();
}

export async function respondFriendRequest(
  requestId: number,
  accept: boolean,
): Promise<void> {
  const response = await api(accept ? "/api/friends/accept" : "/api/friends/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId }),
  });
  await assertSuccessfulResponse(
    response,
    "Não foi possível responder a solicitação.",
  );
  clearFriendsCache();
}

export async function removeFriend(friendUserId: string): Promise<void> {
  const response = await api(`/api/friends/${encodeURIComponent(friendUserId)}`, {
    method: "DELETE",
  });
  await assertSuccessfulResponse(
    response,
    "Nao foi possivel remover este amigo.",
  );
  clearFriendsCache();
}
