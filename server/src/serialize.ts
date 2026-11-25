import {
  DISCLAIMER,
  SOURCE_CREDITS,
  alertCovers,
  alertDistanceKm,
  alertLocalities,
  describeCode,
  inRadarCoverage,
  type Assessment,
  type HailZone,
  type HourForecast,
  type LatLng,
  type Level,
  type RasterScan,
  type SmnAlert,
  type StormCell,
  type StormMotion,
} from '@alerta/core';

/** Conversión de los objetos del núcleo al formato público de la API. */

export const LEVEL_NAMES = ['green', 'yellow', 'orange', 'red'] as const;

/** Créditos de las fuentes (texto común en core/attribution.ts). */
export const ATTRIBUTION = SOURCE_CREDITS;

export { DISCLAIMER };

export const iso = (ms: number | null | undefined): string | null =>
  ms === null || ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString();

export type ResolvedLocation = LatLng & { label: string };

export function locationOut(p: ResolvedLocation) {
  return { lat: p.lat, lng: p.lng, label: p.label, inRadarCoverage: inRadarCoverage(p) };
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

function motionOut(m: StormMotion | null) {
  return m ? { speedKmh: round(m.speedKmh), towardsDeg: Math.round(m.towards) } : null;
}

/** Polígonos CAP ([lat, lng]) → GeoJSON MultiPolygon ([lng, lat], anillos cerrados). */
function multiPolygon(polygons: [number, number][][]) {
  return {
    type: 'MultiPolygon' as const,
    coordinates: polygons.map((poly) => {
      const ring = poly.map(([lat, lng]) => [lng, lat] as [number, number]);
      const [first, last] = [ring[0], ring[ring.length - 1]];
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first);
      return [ring];
    }),
  };
}

export function alertOut(a: SmnAlert, now: number, at?: LatLng) {
  return {
    id: a.id,
    kind: a.kind,
    event: a.event,
    level: a.level,
    levelName: LEVEL_NAMES[a.level],
    immediate: a.immediate,
    sent: iso(a.sent)!,
    onset: iso(a.onset)!,
    expires: iso(a.expires)!,
    active: a.onset <= now && a.expires > now,
    description: a.description,
    instruction: a.instruction,
    areaDescription: a.areaDesc,
    places: alertLocalities(a),
    ...(at ? { coversLocation: alertCovers(a, at), distanceKm: round(alertDistanceKm(a, at)) } : {}),
    geometry: multiPolygon(a.polygons),
    source: a.url,
  };
}

function scanOut(scan: RasterScan | null) {
  if (!scan) return null;
  const maxWithinKm: Record<string, number | null> = {};
  for (const [km, value] of Object.entries(scan.within)) maxWithinKm[km] = value;
  return {
    atPoint: scan.here,
    maxWithinKm,
    nearest: scan.nearest
      ? { distanceKm: round(scan.nearest.km), bearingDeg: Math.round(scan.nearest.bearing), value: scan.nearest.value }
      : null,
  };
}

/** Hora local de Open-Meteo ("AAAA-MM-DDTHH:MM", UTC-3) → ISO UTC. */
export function localToIso(local: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return local;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5])).toISOString();
}

export function hourOut(h: HourForecast) {
  return {
    time: localToIso(h.time),
    temperatureC: h.temp,
    precipitationMm: h.rainMm,
    precipitationProbabilityPct: h.rainProb,
    windKmh: h.windKmh,
    gustKmh: h.gustKmh,
    windFromDeg: h.windDir,
    humidityPct: h.humidity,
    weatherCode: h.code,
    description: describeCode(h.code).text,
  };
}

export function riskOut(place: ResolvedLocation, a: Assessment) {
  const level = a.risk.level as Level;
  const threat = a.radar.threat;
  const current = a.forecast?.current ?? null;
  return {
    location: locationOut(place),
    generatedAt: iso(a.now)!,
    level,
    levelName: LEVEL_NAMES[level],
    text: { lang: 'es' as const, headline: a.risk.headline, detail: a.risk.detail, advice: a.risk.advice },
    hazards: a.risk.hazards.map((h) => ({
      type: h.key,
      level: h.level,
      levelName: LEVEL_NAMES[h.level],
      summary: h.summary,
    })),
    measurements: {
      reflectivityDbz: scanOut(a.radar.dbz),
      hailProbabilityPct: scanOut(a.radar.hail),
      storm: threat
        ? {
            trend: threat.trend,
            distanceKm: round(threat.km),
            bearingDeg: Math.round(threat.bearing),
            maxDbz: threat.value,
            etaMinutes: threat.etaMin,
            motion: motionOut(threat.motion),
          }
        : null,
      lightning: a.lightning
        ? {
            nearestKm: a.lightning.nearestKm === null ? null : round(a.lightning.nearestKm),
            nearestBearingDeg: a.lightning.nearestBearing === null ? null : Math.round(a.lightning.nearestBearing),
            within10Km: a.lightning.within10,
            within25Km: a.lightning.within25,
            within50Km: a.lightning.within50,
          }
        : null,
      current: current
        ? {
            temperatureC: current.temp,
            humidityPct: current.humidity,
            windKmh: current.windKmh,
            gustKmh: current.gustKmh,
            windFromDeg: current.windDir,
            weatherCode: current.code,
            description: describeCode(current.code).text,
          }
        : null,
    },
    officialAlerts: a.myAlerts.map((al) => alertOut(al, a.now, place)),
    dataQuality: {
      notes: a.risk.notes,
      radar: { ok: a.sources.radar.ok, observedAt: iso(a.sources.radar.observedAt), fresh: a.radar.fresh },
      lightning: { ok: a.sources.lightning.ok, observedAt: iso(a.sources.lightning.observedAt) },
      alerts: { ok: a.sources.alerts.ok, observedAt: null, complete: a.sources.alerts.complete },
      forecast: { ok: a.sources.forecast.ok, observedAt: null },
    },
    attribution: ATTRIBUTION,
    disclaimer: DISCLAIMER,
  };
}

const KM_PER_DEG_LAT = 110.9;

export function stormFeature(cell: StormCell) {
  let positionIn30Min: [number, number] | null = null;
  if (cell.motion) {
    const km = (cell.motion.speedKmh * 30) / 60;
    const rad = (cell.motion.towards * Math.PI) / 180;
    positionIn30Min = [
      round(cell.lng + (km * Math.sin(rad)) / (111.32 * Math.cos((cell.lat * Math.PI) / 180)), 4),
      round(cell.lat + (km * Math.cos(rad)) / KM_PER_DEG_LAT, 4),
    ];
  }
  return {
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [round(cell.lng, 4), round(cell.lat, 4)] as [number, number] },
    properties: {
      maxDbz: cell.maxDbz,
      areaKm2: cell.areaKm2,
      radiusKm: round(cell.radiusKm),
      motion: motionOut(cell.motion),
      positionIn30Min,
    },
  };
}

/** Hora UTC "HH:MM" del día `folder` (AAAAMMDD) → ISO. */
function folderTime(folder: string, hhmm: string): string | null {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m || !/^\d{8}$/.test(folder)) return null;
  return new Date(Date.UTC(+folder.slice(0, 4), +folder.slice(4, 6) - 1, +folder.slice(6, 8), +m[1], +m[2])).toISOString();
}

export function hailZoneOut(folder: string, z: HailZone) {
  return {
    department: z.department,
    place: z.place,
    areaKm2: z.areaKm2,
    maxProbabilityPct: z.probMax,
    start: folderTime(folder, z.startUtc),
    end: folderTime(folder, z.endUtc),
  };
}
