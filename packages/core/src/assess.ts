import type { LatLng } from './geo';
import { fetchStrikes, summarizeLightning, type LightningSummary, type Strike } from './lightning';
import { fetchPointForecast, type PointForecast } from './openmeteo';
import { fetchRadarFrames, loadRaster, type RadarFrame } from './radar';
import {
  DBZ_PALETTE,
  HAIL_PALETTE,
  inRadarCoverage,
  scanAround,
  type Raster,
  type RasterScan,
} from './radarMath';
import { alertCovers, fetchSmnAlerts, type SmnAlert, type SmnResult } from './smn';
import { threatFor, trackStorms, type StormCell, type StormThreat } from './stormMotion';

import { computeRisk, RADAR_RINGS, type Risk } from './engine';

/**
 * Cálculo del riesgo sin depender de la pantalla: lo usa la app abierta y también
 * la revisión periódica en segundo plano que dispara los avisos.
 */

export type Place = LatLng & { label: string; source: 'gps' | 'manual' | 'default' };

export type Rasters = {
  dbz: Raster | null;
  hail: Raster | null;
  /** Celdas de tormenta de la última pasada, con su movimiento. */
  cells: StormCell[];
};

export const EMPTY_RASTERS: Rasters = { dbz: null, hail: null, cells: [] };

const RADAR_STALE_MS = 20 * 60_000;

export function radarIsFresh(frames: RadarFrame[], now: number): boolean {
  const latest = frames[frames.length - 1];
  return !!latest && now - latest.time < RADAR_STALE_MS;
}

// El seguimiento de tormentas se calcula una vez por pasada nueva.
let trackCache: { key: string; cells: StormCell[] } | null = null;

/** Últimas pasadas del radar y las imágenes necesarias para evaluar el riesgo. */
export async function loadRadarSnapshot(): Promise<RadarSnapshot> {
  const frames = await fetchRadarFrames(24);
  const latest = frames[frames.length - 1];
  if (!latest) return { frames, rasters: EMPTY_RASTERS };
  // Pasadas de referencia para medir el movimiento: unos 10 y 20 minutos antes.
  const ago = (min: number) =>
    [...frames].reverse().find((f) => latest.time - f.time >= min * 60_000) ?? null;
  const near = ago(8);
  const far = ago(18);
  const [dbz, hail, nearDbz, farDbz] = await Promise.all([
    loadRaster(latest.dbz),
    latest.hail ? loadRaster(latest.hail).catch(() => null) : null,
    near ? loadRaster(near.dbz).catch(() => null) : null,
    far && far !== near ? loadRaster(far.dbz).catch(() => null) : null,
  ]);

  const key = `${latest.key}|${near?.key}|${far?.key}`;
  if (trackCache?.key !== key) {
    const history = [];
    if (near && nearDbz) history.push({ raster: nearDbz, minutesAgo: (latest.time - near.time) / 60_000 });
    if (far && farDbz) history.push({ raster: farDbz, minutesAgo: (latest.time - far.time) / 60_000 });
    trackCache = { key, cells: trackStorms(dbz, history) };
  }
  return { frames, rasters: { dbz, hail, cells: trackCache.cells } };
}

export function alertsForPlace(alerts: SmnAlert[], place: LatLng, now: number): SmnAlert[] {
  return alerts.filter((a) => a.expires > now && alertCovers(a, place));
}

export type RiskInputs = {
  place: LatLng;
  now: number;
  rasters: Rasters;
  radarFresh: boolean;
  strikes: Strike[] | null;
  myAlerts: SmnAlert[];
  forecast: PointForecast | null;
};

/** Lo que se midió en el punto, además del riesgo resultante. */
export type Evaluation = {
  risk: Risk;
  radar: {
    covered: boolean;
    fresh: boolean;
    dbz: RasterScan | null;
    hail: RasterScan | null;
    threat: StormThreat | null;
  };
  lightning: LightningSummary | null;
};

export function evaluateRisk(input: RiskInputs): Evaluation {
  const { place, rasters } = input;
  const covered = inRadarCoverage(place);
  const scan = (raster: Raster | null, hail: boolean) =>
    covered && raster
      ? scanAround(raster, place, hail ? HAIL_PALETTE : DBZ_PALETTE, {
          rings: RADAR_RINGS,
          nearestMin: hail ? 50 : 45,
          support: hail ? 2 : 4,
        })
      : null;
  const radar = {
    covered,
    fresh: input.radarFresh,
    dbz: scan(rasters.dbz, false),
    hail: scan(rasters.hail, true),
    threat: covered ? threatFor(rasters.cells, place) : null,
  };
  const lightning = input.strikes ? summarizeLightning(input.strikes, place) : null;
  const risk = computeRisk({
    now: input.now,
    radar,
    lightning,
    alerts: input.myAlerts,
    forecast: input.forecast,
  });
  return { risk, radar, lightning };
}

export function buildRisk(input: RiskInputs): Risk {
  return evaluateRisk(input).risk;
}

function settle<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export type RadarSnapshot = { frames: RadarFrame[]; rasters: Rasters };

/**
 * De dónde salen los datos. Por defecto se consultan las fuentes oficiales;
 * el servidor pasa versiones con caché y la app puede leer las alertas de la API.
 */
export type DataSources = {
  radar: () => Promise<RadarSnapshot>;
  strikes: () => Promise<Strike[]>;
  forecast: (place: LatLng) => Promise<PointForecast>;
  alerts: () => Promise<SmnResult>;
};

export const directSources: DataSources = {
  radar: loadRadarSnapshot,
  strikes: fetchStrikes,
  forecast: fetchPointForecast,
  alerts: fetchSmnAlerts,
};

export type SourceReport = {
  ok: boolean;
  /** Momento del dato más reciente de la fuente (ms epoch), si se conoce. */
  observedAt: number | null;
};

export type Assessment = Evaluation & {
  myAlerts: SmnAlert[];
  now: number;
  forecast: PointForecast | null;
  /** Estado de cada fuente: si respondió y qué tan nuevo es su dato. */
  sources: {
    radar: SourceReport;
    lightning: SourceReport;
    alerts: SourceReport & { complete: boolean };
    forecast: SourceReport;
  };
};

/**
 * Consulta todas las fuentes y calcula el riesgo para un lugar. Cada fuente tiene
 * un tiempo máximo: en segundo plano el sistema da poco tiempo (unos 30 s en iOS).
 */
export async function assessPlace(
  place: Place | LatLng,
  sources: DataSources = directSources,
  budgetMs = 20_000,
): Promise<Assessment> {
  const [radar, strikes, forecast, smn] = await Promise.all([
    settle(sources.radar(), budgetMs),
    settle(sources.strikes(), budgetMs),
    settle(sources.forecast(place), budgetMs),
    settle(sources.alerts(), budgetMs),
  ]);
  const now = Date.now();
  const myAlerts = alertsForPlace(smn?.alerts ?? [], place, now);
  const evaluation = evaluateRisk({
    place,
    now,
    rasters: radar?.rasters ?? EMPTY_RASTERS,
    radarFresh: radar ? radarIsFresh(radar.frames, now) : false,
    strikes,
    myAlerts,
    forecast,
  });
  const latestFrame = radar?.frames[radar.frames.length - 1];
  return {
    ...evaluation,
    myAlerts,
    now,
    forecast,
    sources: {
      radar: { ok: !!radar, observedAt: latestFrame?.time ?? null },
      lightning: {
        ok: !!strikes,
        observedAt: strikes && strikes.length > 0 ? Math.max(...strikes.map((s) => s.time)) : null,
      },
      alerts: { ok: !!smn, observedAt: null, complete: smn?.complete ?? false },
      forecast: { ok: !!forecast, observedAt: null },
    },
  };
}
