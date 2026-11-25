import {
  directSources,
  fetchDccForecast,
  fetchHailZones,
  fetchStations,
  type DataSources,
  type DccForecastDay,
  type HailZone,
  type LatLng,
  type Station,
} from '@alerta/core';

import { TtlCache } from './cache';

/** Todo lo que la API necesita leer de las fuentes oficiales. */
export type ServerSources = DataSources & {
  dccForecast: () => Promise<DccForecastDay[]>;
  stations: () => Promise<Station[]>;
  /** Zonas con granizo del día (carpeta AAAAMMDD en UTC). */
  hailZones: (folder: string) => Promise<HailZone[]>;
};

/** Cada cuánto se vuelve a consultar cada fuente, como mucho. */
export const TTL = {
  radar: 60_000, // una pasada nueva cada ~2 min
  strikes: 30_000,
  alerts: 5 * 60_000, // el SMN limita los pedidos seguidos
  forecast: 10 * 60_000,
  dccForecast: 30 * 60_000,
  stations: 10 * 60_000,
  hailZones: 2 * 60_000,
};

/** Fuentes con caché compartida entre todos los clientes de la API. */
export function createCachedSources(cache = new TtlCache(), base: ServerSources = rawSources): ServerSources {
  return {
    radar: () => cache.get('radar', TTL.radar, base.radar),
    strikes: () => cache.get('strikes', TTL.strikes, base.strikes),
    alerts: () => cache.get('alerts', TTL.alerts, base.alerts),
    // El pronóstico por punto se agrupa en celdas de ~2 km.
    forecast: (p: LatLng) => {
      const key = `forecast:${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      return cache.get(key, TTL.forecast, () => base.forecast({ lat: +p.lat.toFixed(2), lng: +p.lng.toFixed(2) }));
    },
    dccForecast: () => cache.get('dccForecast', TTL.dccForecast, base.dccForecast),
    stations: () => cache.get('stations', TTL.stations, base.stations),
    hailZones: (folder) => cache.get(`hailZones:${folder}`, TTL.hailZones, () => base.hailZones(folder)),
  };
}

export const rawSources: ServerSources = {
  ...directSources,
  dccForecast: fetchDccForecast,
  stations: fetchStations,
  hailZones: fetchHailZones,
};
