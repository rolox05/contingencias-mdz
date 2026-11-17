import { distanceKm, type LatLng } from './geo';
import { fetchJson, fresh } from './http';
import { RADAR_BASE } from './radar';

/** Datos de la Dirección de Contingencias Climáticas (DCC) del Gobierno de Mendoza. */
const AGRO = 'https://agrometeo.mendoza.gov.ar/api';

export type DccForecastDay = {
  /** Fecha local "AAAA-MM-DD". */
  date: string;
  text: string;
  max: number;
  min: number;
  /** 0 = sin alerta, 1 = alerta amarilla, 2 = alerta roja (según la DCC). */
  alert: 0 | 1 | 2;
  icon: string;
};

type RawForecast = {
  fecha: string;
  pronostico: string;
  maxima: number;
  minima: number;
  alerta: number;
  imagenNombre: string;
};

/** Pronóstico diario para Mendoza elaborado por los meteorólogos de la DCC. */
export async function fetchDccForecast(): Promise<DccForecastDay[]> {
  const raw = await fetchJson<RawForecast[]>(fresh(`${AGRO}/pronostico.php`, 600));
  return raw.map((d) => ({
    date: d.fecha,
    text: d.pronostico,
    max: Number(d.maxima),
    min: Number(d.minima),
    alert: d.alerta === 2 ? 2 : d.alerta === 1 ? 1 : 0,
    icon: d.imagenNombre ?? '',
  }));
}

export type Station = LatLng & {
  id: string;
  name: string;
  /** Momento de la medición (ms epoch). */
  time: number;
  temp: number | null;
  humidity: number | null;
  windKmh: number | null;
  windDir: number | null;
  windDirText: string;
  rainMm: number | null;
};

type RawStation = {
  estacion: string;
  lat: string;
  lng: string;
  Nombre: string;
  fechaIngles: string;
  tempAire: string | null;
  humedad: string | null;
  direccionViento: string | null;
  velocidadViento: string | null;
  precipitacion: string | null;
  direccionVientoTexto?: string;
};

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "AAAA-MM-DD HH:MM:SS" en hora de Mendoza (UTC-3) → ms epoch. */
function mendozaTime(value: string): number {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5]);
}

/** Última medición de cada estación de la red agrometeorológica provincial. */
export async function fetchStations(): Promise<Station[]> {
  const raw = await fetchJson<RawStation[]>(fresh(`${AGRO}/todas_instantaneas.json`, 300));
  const out: Station[] = [];
  for (const r of raw) {
    const lat = num(r.lat);
    const lng = num(r.lng);
    const time = mendozaTime(r.fechaIngles ?? '');
    if (lat === null || lng === null || !Number.isFinite(time)) continue;
    out.push({
      id: r.estacion,
      name: r.Nombre,
      lat,
      lng,
      time,
      temp: num(r.tempAire),
      humidity: num(r.humedad),
      windKmh: num(r.velocidadViento),
      windDir: num(r.direccionViento),
      windDirText: r.direccionVientoTexto ?? '',
      rainMm: num(r.precipitacion),
    });
  }
  return out;
}

/** Estación más cercana con datos recientes (menos de 2 horas). */
export function nearestStation(
  stations: Station[],
  p: LatLng,
  maxKm = 40,
): { station: Station; km: number } | null {
  const cutoff = Date.now() - 2 * 3600_000;
  let best: { station: Station; km: number } | null = null;
  for (const station of stations) {
    if (station.time < cutoff || station.temp === null) continue;
    const km = distanceKm(p, station);
    if (km <= maxKm && (!best || km < best.km)) best = { station, km };
  }
  return best;
}

export type HailZone = {
  department: string;
  place: string;
  areaKm2: number;
  probMax: number;
  /** Horas UTC "HH:MM" de inicio y fin del evento sobre la zona. */
  startUtc: string;
  endUtc: string;
};

type RawHailZone = {
  departamento?: string;
  paraje_referencia?: string;
  area_impacto_km2?: number;
  prob_max?: number;
  hora_inicio?: string;
  hora_fin?: string;
};

/**
 * Zonas con granizo detectado por el radar durante el día (reporte experimental
 * de la DCC). `folder` es la carpeta del día en formato AAAAMMDD (UTC).
 */
export async function fetchHailZones(folder: string): Promise<HailZone[]> {
  const raw = await fetchJson<RawHailZone[]>(
    fresh(`${RADAR_BASE}/${folder}/manga_afectacion_diaria.json`, 120),
  );
  if (!Array.isArray(raw)) return [];
  return raw
    .map((z) => ({
      department: z.departamento || 'Sin departamento',
      place: z.paraje_referencia || '',
      areaKm2: Number(z.area_impacto_km2) || 0,
      probMax: Number(z.prob_max) || 0,
      startUtc: z.hora_inicio ?? '',
      endUtc: z.hora_fin ?? '',
    }))
    .sort((a, b) => b.areaKm2 - a.areaKm2);
}
