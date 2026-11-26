import type { LatLng } from './geo';

/**
 * Pronósticos guardados por lugar. Cada pronóstico queda asociado al punto para el
 * que se pidió: así nunca se muestra el de otro lugar (por ejemplo, si una consulta
 * vieja termina después de cambiar de ubicación) y volver a un lugar reciente es
 * instantáneo.
 */
export type ForecastEntry<T> = { data: T; at: number };
export type ForecastCache<T> = Record<string, ForecastEntry<T>>;

/** Clave del punto (~100 m). */
export function pointKey(p: LatLng): string {
  return `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
}

/** Agrega o reemplaza el pronóstico de un punto, conservando los `maxEntries` más nuevos. */
export function storeForecast<T>(
  cache: ForecastCache<T>,
  key: string,
  data: T,
  at: number,
  maxEntries = 8,
): ForecastCache<T> {
  const next = { ...cache, [key]: { data, at } };
  const keys = Object.keys(next);
  if (keys.length <= maxEntries) return next;
  const keep = keys.sort((a, b) => next[b].at - next[a].at).slice(0, maxEntries);
  return Object.fromEntries(keep.map((k) => [k, next[k]]));
}

/** Pronóstico del punto, o null si no hay (nunca el de otro lugar). */
export function forecastFor<T>(cache: ForecastCache<T>, p: LatLng): T | null {
  return cache[pointKey(p)]?.data ?? null;
}

/** true si el pronóstico del punto falta o tiene más de `maxAgeMs`. */
export function forecastIsStale<T>(cache: ForecastCache<T>, p: LatLng, now: number, maxAgeMs: number): boolean {
  const entry = cache[pointKey(p)];
  return !entry || now - entry.at >= maxAgeMs;
}
