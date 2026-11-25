/**
 * Acceso HTTP configurable. La app y el servidor comparten este módulo:
 * - la versión web de la app redirige los hosts sin CORS a su proxy (`resolveUrl`);
 * - el servidor se identifica con un User-Agent propio.
 */
export type HttpConfig = {
  /** Reescribe la URL antes de pedirla (por ejemplo, para pasar por un proxy). */
  resolveUrl?: (url: string) => string;
  /** Cabeceras extra en cada pedido. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

let config: HttpConfig = {};

export function configureHttp(next: HttpConfig): void {
  config = { ...config, ...next };
}

/** Hosts oficiales que no envían cabeceras CORS (no se pueden leer desde un navegador). */
export const NO_CORS_HOSTS = [
  'www2.contingencias.mendoza.gov.ar',
  'agrometeo.mendoza.gov.ar',
  'ssl.smn.gob.ar',
];

export function resolveUrl(url: string): string {
  return config.resolveUrl ? config.resolveUrl(url) : url;
}

/** Agrega un parámetro que cambia cada `seconds` para evitar respuestas cacheadas. */
export function fresh(url: string, seconds = 60): string {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  return `${url}${url.includes('?') ? '&' : '?'}_=${bucket}`;
}

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function request(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const doFetch = config.fetch ?? fetch;
    const res = await doFetch(resolveUrl(url), { signal: controller.signal, headers: config.headers });
    if (!res.ok) throw new HttpError(res.status);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  return (await request(url, timeoutMs)).json() as Promise<T>;
}

export async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  return (await request(url, timeoutMs)).text();
}

export async function fetchBuffer(url: string, timeoutMs = 20000): Promise<ArrayBuffer> {
  return (await request(url, timeoutMs)).arrayBuffer();
}

/** Ejecuta tareas con un máximo de `limit` en paralelo. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
