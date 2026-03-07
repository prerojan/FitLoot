const DEFAULT_PROD_API_URL = "https://fitloot-worker.suportefitloot.workers.dev";
const DEFAULT_DEV_API_URL = "http://localhost:8787";

const rawApiUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
const resolvedApiUrl = rawApiUrl || (import.meta.env.PROD ? DEFAULT_PROD_API_URL : DEFAULT_DEV_API_URL);

export const API_URL = resolvedApiUrl.endsWith("/") ? resolvedApiUrl.slice(0, -1) : resolvedApiUrl;

export async function api(path: string, options: RequestInit = {}) {
    const requestPath = path.startsWith("/") ? path : `/${path}`;
    const url = API_URL ? `${API_URL}${requestPath}` : requestPath;

    return fetch(url, {
        ...options,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
    });
}
