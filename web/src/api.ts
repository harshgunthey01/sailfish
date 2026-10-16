const base = "/api/v1";

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown) =>
    req<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(p: string, body?: unknown) =>
    req<T>(p, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(p: string, body?: unknown) =>
    req<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(p: string) => req<T>(p, { method: "DELETE" }),
};

// ---- DigitalOcean GenAI model routers (live control plane) ----
export interface RouterPolicy {
  task_slug?: string;
  models?: string[];
  selection_policy?: { prefer?: string };
  custom_task?: { name?: string; description?: string };
}
export interface RemoteModelRouter {
  uuid: string;
  name: string;
  description?: string;
  regions?: string[];
  created_at?: string;
  updated_at?: string;
  config?: { fallback_models?: string[]; policies?: RouterPolicy[] };
}
export interface RouterPayload {
  name: string;
  description?: string;
  fallback_models: string[];
  policies?: RouterPolicy[];
  regions?: string[];
}

export const routerApi = {
  list: () => api.get<{ routers: RemoteModelRouter[]; source: string }>("/model-routers"),
  get: (uuid: string) => api.get<{ router: RemoteModelRouter }>(`/model-routers/${uuid}`),
  create: (payload: RouterPayload) =>
    api.post<{ router: RemoteModelRouter }>("/model-routers", payload),
  update: (uuid: string, payload: RouterPayload) =>
    api.put<{ router: RemoteModelRouter }>(`/model-routers/${uuid}`, payload),
  remove: (uuid: string) => api.delete<{ ok: boolean }>(`/model-routers/${uuid}`),
};
