// API клиенті: барлық сұраныстар Bearer токенмен.
const TOKEN_KEY = "gha_admin_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiError extends Error {
  status?: number;
  details?: string[];
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let resp: Response;
  try {
    resp = await fetch(path, { ...init, headers });
  } catch {
    const err = new Error("Серверге қосылу мүмкін болмады. Сервер іске қосылған ба?") as ApiError;
    throw err;
  }
  if (resp.status === 401 && !path.includes("/auth/login")) {
    clearToken();
  }
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error((body as { error?: string }).error ?? `Қате: HTTP ${resp.status}`) as ApiError;
    err.status = resp.status;
    err.details = (body as { details?: string[] }).details;
    throw err;
  }
  return body as T;
}

export const api = {
  get: <T,>(p: string) => request<T>(p),
  post: <T,>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T,>(p: string, body?: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  del: <T,>(p: string) => request<T>(p, { method: "DELETE" }),
};

/** Файлды токенмен жүктеу (PDF/CSV/скриншот). */
export function authedUrl(path: string): string {
  return path; // скриншоттар мен есептер <img>/<a> арқылы токпен ашылады
}

export async function fetchBlob(path: string): Promise<Blob> {
  const resp = await fetch(path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!resp.ok) throw new Error(`Жүктеу қатесі: HTTP ${resp.status}`);
  return resp.blob();
}
