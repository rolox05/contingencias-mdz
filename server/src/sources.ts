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

/**
 * Tope de llamadas a una fuente. Open-Meteo permite en su plan gratuito (no comercial)
 * menos de 10.000 llamadas por día, 5.000 por hora y 600 por minuto: se usa un margen
 * por debajo. Con muchas suscripciones en lugares distintos, el tope evita pasarse:
 * cuando se alcanza, el pronóstico queda como "no disponible" y el riesgo se calcula
 * con el resto de las fuentes.
 */
export class CallBudget {
  private calls: number[] = [];

  constructor(
    private readonly limits = { perMinute: 500, perHour: 4000, perDay: 8000 },
    private readonly now: () => number = Date.now,
  ) {}

  take(): boolean {
    const t = this.now();
    this.calls = this.calls.filter((c) => t - c < 86_400_000);
    const within = (ms: number) => this.calls.filter((c) => t - c < ms).length;
    if (
      this.calls.length >= this.limits.perDay ||
      within(3_600_000) >= this.limits.perHour ||
      within(60_000) >= this.limits.perMinute
    ) {
      return false;
    }
    this.calls.push(t);
    return true;
  }

  used(): { lastMinute: number; lastHour: number; lastDay: number } {
    const t = this.now();
    const count = (ms: number) => this.calls.filter((c) => t - c < ms).length;
    return { lastMinute: count(60_000), lastHour: count(3_600_000), lastDay: count(86_400_000) };
  }
}

export class BudgetExceededError extends Error {}

/** Fuentes con caché compartida entre todos los clientes de la API. */
export function createCachedSources(
  cache = new TtlCache(),
  base: ServerSources = rawSources,
  forecastBudget = new CallBudget(),
): ServerSources {
  return {
    radar: () => cache.get('radar', TTL.radar, base.radar),
    strikes: () => cache.get('strikes', TTL.strikes, base.strikes),
    alerts: () => cache.get('alerts', TTL.alerts, base.alerts),
    // El pronóstico por punto se agrupa en celdas de ~2 km.
    forecast: (p: LatLng) => {
      const key = `forecast:${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      return cache.get(key, TTL.forecast, () => {
        if (!forecastBudget.take()) throw new BudgetExceededError('Tope diario de Open-Meteo alcanzado');
        return base.forecast({ lat: +p.lat.toFixed(2), lng: +p.lng.toFixed(2) });
      });
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
