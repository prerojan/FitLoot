import { api, isApiTimeoutError, isExpectedApiCancellation } from "@/react-app/utils/api";

const FRIENDS_CACHE_TTL_MS = 10_000;

export type Friend = {
  id: number;
  friend_user_id: string;
  friend_username: string;
  friend_full_name: string;
  friend_avatar_url?: string | null | undefined;
  friend_level: number;
  friend_xp: number;
  friend_streak: number;
  status?: string | undefined;
  is_online?: boolean | undefined;
  last_heartbeat_at?: string | null | undefined;
};

export type FriendSearchResult = {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url?: string | null | undefined;
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

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "t", "yes", "online"].includes(normalized)) return true;
    if (["0", "false", "f", "no", "offline"].includes(normalized)) return false;
  }
  return undefined;
}

function isRecentHeartbeat(value: unknown, windowMs = 10 * 60 * 1000): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed <= windowMs;
}

function normalizeFriend(raw: unknown): Friend | null {
  if (!raw || typeof raw !== "object") return null;

  const friend = raw as Record<string, unknown>;
  const lastHeartbeatAt =
    typeof friend.last_heartbeat_at === "string" && friend.last_heartbeat_at.trim().length > 0
      ? friend.last_heartbeat_at
      : null;
  const normalizedIsOnline = coerceBoolean(friend.is_online) ?? isRecentHeartbeat(lastHeartbeatAt);

  return {
    id: Number(friend.id ?? 0),
    friend_user_id: String(friend.friend_user_id ?? ""),
    friend_username: String(friend.friend_username ?? ""),
    friend_full_name: String(friend.friend_full_name ?? friend.friend_username ?? ""),
    friend_avatar_url:
      typeof friend.friend_avatar_url === "string" && friend.friend_avatar_url.trim().length > 0
        ? friend.friend_avatar_url
        : null,
    friend_level: Math.max(0, Number(friend.friend_level ?? 0)),
    friend_xp: Math.max(0, Number(friend.friend_xp ?? 0)),
    friend_streak: Math.max(0, Number(friend.friend_streak ?? 0)),
    status: typeof friend.status === "string" ? friend.status : undefined,
    is_online: normalizedIsOnline,
    last_heartbeat_at: lastHeartbeatAt,
  };
}

function toFriendsArray(payload: unknown): Friend[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map(normalizeFriend)
    .filter((friend): friend is Friend => friend !== null && friend.friend_user_id.length > 0);
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

function parseFriendsRequestError(error: unknown): never {
  if (isExpectedApiCancellation(error)) {
    throw error;
  }

  if (isApiTimeoutError(error)) {
    throw new FriendsApiError("REQUEST_FAILED", 504, error.message || "Tempo limite na API social.");
  }

  if (error instanceof FriendsApiError) {
    throw error;
  }

  throw new FriendsApiError("REQUEST_FAILED", 500, "Falha na API social.");
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
      api("/api/friends", {
        orchestrationKey: "friends:list",
        orchestrationPolicy: "join",
        requestClass: "background",
      }),
      api("/api/friends/requests", {
        orchestrationKey: "friends:requests",
        orchestrationPolicy: "join",
        requestClass: "background",
      }),
    ]).catch((error) => parseFriendsRequestError(error));

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
    {
      orchestrationKey: "friends:search",
      orchestrationPolicy: "replace",
      requestClass: "background",
    },
  ).catch((error) => parseFriendsRequestError(error));
  await assertSuccessfulResponse(response, "Falha na busca de usuários.");

  const payload = (await response.json().catch(() => [])) as FriendSearchResult[];
  return Array.isArray(payload)
    ? payload.map((result) => ({
        ...result,
        avatar_url:
          typeof result?.avatar_url === "string" && result.avatar_url.trim().length > 0
            ? result.avatar_url
            : null,
      }))
    : [];
}

export async function sendFriendRequest(friendUserId: string): Promise<void> {
  const response = await api("/api/friends/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ friend_user_id: friendUserId }),
  }).catch((error) => parseFriendsRequestError(error));
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
  }).catch((error) => parseFriendsRequestError(error));
  await assertSuccessfulResponse(
    response,
    "Não foi possível responder a solicitação.",
  );
  clearFriendsCache();
}

export async function removeFriend(friendUserId: string): Promise<void> {
  const response = await api(`/api/friends/${encodeURIComponent(friendUserId)}`, {
    method: "DELETE",
  }).catch((error) => parseFriendsRequestError(error));
  await assertSuccessfulResponse(
    response,
    "Nao foi possivel remover este amigo.",
  );
  clearFriendsCache();
}
