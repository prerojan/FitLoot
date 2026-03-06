const rawApiUrl = import.meta.env.VITE_API_URL?.trim() ?? "";
export const API_URL = rawApiUrl.endsWith("/") ? rawApiUrl.slice(0, -1) : rawApiUrl;

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
