import { bearingDeg, distanceKm, type LatLng } from './geo';
import { fetchJson, fresh } from './http';

const URL = 'https://www2.contingencias.mendoza.gov.ar/rayos/rayos.json';

/** Región de interés: Mendoza y alrededores. El archivo trae todo el país. */
const REGION = { south: -39, north: -30, west: -72, east: -64.5 };

export type Strike = { id: number; lat: number; lng: number; energy: number; time: number };

type RawStrike = { id: number; lat: number | string; lng?: number | string; lon?: number | string; e: number; fecha: string };

/** "HH:MM:SS" en UTC → ms epoch, asumiendo que es de las últimas 24 h. */
function strikeTime(fecha: string, now: number): number {
  const [h, m, s] = fecha.split(':').map(Number);
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h || 0, m || 0, s || 0);
  if (t > now + 5 * 60_000) t -= 24 * 3600_000;
  return t;
}

/** Descargas eléctricas de los últimos minutos (sensor GLM del satélite GOES-19). */
export async function fetchStrikes(): Promise<Strike[]> {
  const raw = await fetchJson<RawStrike[]>(fresh(URL, 20));
  const now = Date.now();
  const out: Strike[] = [];
  for (const r of raw) {
    const lat = Number(r.lat);
    const lng = Number(r.lng ?? r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < REGION.south || lat > REGION.north || lng < REGION.west || lng > REGION.east) continue;
    out.push({ id: r.id, lat, lng, energy: Number(r.e) || 0, time: strikeTime(r.fecha, now) });
  }
  return out;
}

export type LightningSummary = {
  nearestKm: number | null;
  nearestBearing: number | null;
  within10: number;
  within25: number;
  within50: number;
};

export function summarizeLightning(strikes: Strike[], center: LatLng): LightningSummary {
  const summary: LightningSummary = {
    nearestKm: null,
    nearestBearing: null,
    within10: 0,
    within25: 0,
    within50: 0,
  };
  for (const s of strikes) {
    const km = distanceKm(center, s);
    if (km <= 10) summary.within10++;
    if (km <= 25) summary.within25++;
    if (km <= 50) summary.within50++;
    if (summary.nearestKm === null || km < summary.nearestKm) {
      summary.nearestKm = km;
      summary.nearestBearing = bearingDeg(center, s);
    }
  }
  return summary;
}
