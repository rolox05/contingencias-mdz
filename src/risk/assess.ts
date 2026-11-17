import type { LatLng } from '@/data/geo';
import { fetchStrikes, summarizeLightning, type Strike } from '@/data/lightning';
import { fetchPointForecast, type PointForecast } from '@/data/openmeteo';
import { fetchRadarFrames, loadRaster, type RadarFrame } from '@/data/radar';
import { DBZ_PALETTE, HAIL_PALETTE, inRadarCoverage, scanAround, type Raster } from '@/data/radarMath';
import { alertCovers, fetchSmnAlerts, type SmnAlert } from '@/data/smn';
import { threatFor, trackStorms, type StormCell } from '@/data/stormMotion';

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
export async function loadRadarSnapshot(): Promise<{ frames: RadarFrame[]; rasters: Rasters }> {
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

export function buildRisk(input: {
  place: LatLng;
  now: number;
  rasters: Rasters;
  radarFresh: boolean;
  strikes: Strike[] | null;
  myAlerts: SmnAlert[];
  forecast: PointForecast | null;
}): Risk {
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
  const dbz = scan(rasters.dbz, false);
  const hail = scan(rasters.hail, true);
  return computeRisk({
    now: input.now,
    radar: {
      covered,
      fresh: input.radarFresh,
      dbz,
      hail,
      threat: covered ? threatFor(rasters.cells, place) : null,
    },
    lightning: input.strikes ? summarizeLightning(input.strikes, place) : null,
    alerts: input.myAlerts,
    forecast: input.forecast,
  });
}

function settle<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export type Assessment = { risk: Risk; myAlerts: SmnAlert[]; now: number };

/**
 * Consulta todas las fuentes y calcula el riesgo para un lugar. Cada fuente tiene
 * un tiempo máximo: en segundo plano el sistema da poco tiempo (unos 30 s en iOS).
 */
export async function assessPlace(place: Place, budgetMs = 20_000): Promise<Assessment> {
  const [radar, strikes, forecast, smn] = await Promise.all([
    settle(loadRadarSnapshot(), budgetMs),
    settle(fetchStrikes(), budgetMs),
    settle(fetchPointForecast(place), budgetMs),
    settle(fetchSmnAlerts(), budgetMs),
  ]);
  const now = Date.now();
  const myAlerts = alertsForPlace(smn?.alerts ?? [], place, now);
  const risk = buildRisk({
    place,
    now,
    rasters: radar?.rasters ?? EMPTY_RASTERS,
    radarFresh: radar ? radarIsFresh(radar.frames, now) : false,
    strikes,
    myAlerts,
    forecast,
  });
  return { risk, myAlerts, now };
}
