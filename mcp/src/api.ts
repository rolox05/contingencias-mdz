/**
 * Cliente mínimo de la API REST de Alerta Mendoza (carpeta server/).
 *
 * El servidor MCP no consulta las fuentes oficiales por su cuenta: todo pasa por
 * la API, que tiene la caché compartida. Así los agentes no agregan carga sobre
 * el SMN ni sobre Contingencias.
 */

export class ApiCallError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type Query = Record<string, string | number | boolean | undefined>;

export type RequestOptions = { query?: Query; body?: unknown; headers?: Record<string, string> };

export type ApiClient = {
  get<T = unknown>(path: string, query?: Query): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
  request<T = unknown>(method: string, path: string, opts?: RequestOptions): Promise<T>;
};

export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 25_000): ApiClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const { query, body } = opts;
    const url = new URL(base + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...opts.headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiCallError('API_UNREACHABLE', `No se pudo contactar la API en ${base}.`, 0);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!res.ok) {
      throw new ApiCallError(data?.error?.code ?? 'API_ERROR', data?.error?.message ?? `HTTP ${res.status}`, res.status);
    }
    return data as T;
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    request,
  };
}
