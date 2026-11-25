/**
 * Caché en memoria para las fuentes oficiales.
 *
 * - Cada clave se refresca como mucho una vez por `ttlMs`, sin importar cuántos
 *   clientes pidan el dato: así el SMN y Contingencias reciben un pedido por
 *   período en lugar de uno por usuario.
 * - Si varios pedidos llegan mientras se descarga, comparten la misma descarga.
 * - Si la fuente falla, se sigue sirviendo el último dato bueno durante `staleMs`.
 */

type Entry<T> = {
  value?: T;
  fetchedAt: number;
  pending?: Promise<T>;
};

export type CacheStats = Record<string, { ageSeconds: number | null; hasValue: boolean }>;

export class TtlCache {
  private entries = new Map<string, Entry<unknown>>();

  constructor(private readonly now: () => number = Date.now) {}

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>, staleMs = ttlMs * 10): Promise<T> {
    const entry = this.entries.get(key) as Entry<T> | undefined;
    const age = entry ? this.now() - entry.fetchedAt : Infinity;
    if (entry && entry.value !== undefined && age < ttlMs) return entry.value;
    if (entry?.pending) return entry.pending;

    const pending = load().then(
      (value) => {
        this.entries.set(key, { value, fetchedAt: this.now() });
        return value;
      },
      (error) => {
        const previous = this.entries.get(key) as Entry<T> | undefined;
        if (previous) delete previous.pending;
        if (previous?.value !== undefined && this.now() - previous.fetchedAt < staleMs) {
          return previous.value;
        }
        throw error;
      },
    );
    this.entries.set(key, { ...(entry ?? { fetchedAt: 0 }), pending });
    return pending;
  }

  stats(): CacheStats {
    const out: CacheStats = {};
    for (const [key, entry] of this.entries) {
      out[key] = {
        hasValue: entry.value !== undefined,
        ageSeconds: entry.value !== undefined ? Math.round((this.now() - entry.fetchedAt) / 1000) : null,
      };
    }
    return out;
  }
}
