export const API_URL = "https://fitloot-worker.suportefitloot.workers.dev";

export async function api(path: string, options: RequestInit = {}) {
    return fetch(`${API_URL}${path}`, {
        ...options,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
    });
}