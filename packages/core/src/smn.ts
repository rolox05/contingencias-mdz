import { distanceKm, pointInPolygon, type LatLng, type Polygon } from './geo';
import { fetchText, fresh, HttpError, mapLimit } from './http';
import { LOCALITIES, MENDOZA_BOX } from './localities';

/** Listado público de alertas del Servicio Meteorológico Nacional en formato CAP. */
const INDEX_URL = 'https://ssl.smn.gob.ar/CAP/AR.php';

export type AlertKind = 'tormenta' | 'lluvia' | 'viento' | 'zonda' | 'nevada' | 'otro';

export type SmnAlert = {
  id: string;
  kind: AlertKind;
  event: string;
  /** 1 = amarillo, 2 = naranja, 3 = rojo. */
  level: 1 | 2 | 3;
  /** Aviso a muy corto plazo: el fenómeno ya está ocurriendo. */
  immediate: boolean;
  sent: number;
  onset: number;
  expires: number;
  description: string;
  instruction: string;
  areaDesc: string;
  polygons: Polygon[];
  url: string;
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<(?:cap:)?${name}>([\\s\\S]*?)</(?:cap:)?${name}>`));
  return m ? decodeEntities(m[1]) : '';
}

/**
 * El feed rotula sus horas con "-03:00" pero el valor está en UTC (se verificó
 * contra la hora de emisión publicada en smn.gob.ar/alertas y contra los
 * períodos del día de cada alerta). Por eso se ignora el desfasaje declarado.
 */
function capTime(value: string): number {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}

function kindFromText(text: string): AlertKind {
  const t = text.toLowerCase();
  if (t.includes('zonda')) return 'zonda';
  if (t.includes('tormenta')) return 'tormenta';
  if (/nev|nieve/.test(t)) return 'nevada';
  if (t.includes('lluvia')) return 'lluvia';
  if (t.includes('viento')) return 'viento';
  return 'otro';
}

function kindOf(event: string, description: string): AlertKind {
  const fromEvent = kindFromText(event);
  return fromEvent !== 'otro' ? fromEvent : kindFromText(description);
}

function levelOf(severity: string): 1 | 2 | 3 {
  if (severity === 'Extreme') return 3;
  if (severity === 'Severe') return 2;
  return 1;
}

function parsePolygon(text: string): Polygon {
  const points: Polygon = [];
  for (const pair of text.trim().split(/\s+/)) {
    const [lat, lng] = pair.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lat, lng]);
  }
  return points;
}

function touchesMendoza(polygons: Polygon[]): boolean {
  return polygons.some(
    (poly) =>
      poly.some(
        ([lat, lng]) =>
          lat >= MENDOZA_BOX.south &&
          lat <= MENDOZA_BOX.north &&
          lng >= MENDOZA_BOX.west &&
          lng <= MENDOZA_BOX.east,
      ) || LOCALITIES.some((l) => pointInPolygon(l, poly)),
  );
}

function parseCap(xml: string, url: string): SmnAlert | null {
  const polygons = [...xml.matchAll(/<(?:cap:)?polygon>([\s\S]*?)<\/(?:cap:)?polygon>/g)]
    .map((m) => parsePolygon(m[1]))
    .filter((p) => p.length >= 3);
  if (polygons.length === 0) return null;

  const sent = capTime(tag(xml, 'sent'));
  const expires = capTime(tag(xml, 'expires'));
  const onset = capTime(tag(xml, 'onset'));
  if (!Number.isFinite(expires)) return null;

  const event = tag(xml, 'event');
  const description = tag(xml, 'description');
  const immediate = url.includes('/avisocortoplazo/');
  const kind = kindOf(event, description);
  const safeOnset = Number.isFinite(onset) ? onset : Number.isFinite(sent) ? sent : expires;

  return {
    // Los mismos avisos se publican en más de un archivo: se deduplican por contenido.
    id: `${kind}|${safeOnset}|${expires}|${polygons[0].length}|${polygons[0][0].join(',')}`,
    kind,
    event: immediate ? description || event : event,
    level: levelOf(tag(xml, 'severity')),
    immediate,
    sent: Number.isFinite(sent) ? sent : safeOnset,
    onset: safeOnset,
    expires,
    description,
    instruction: tag(xml, 'instruction'),
    areaDesc: tag(xml, 'areaDesc'),
    polygons,
    url,
  };
}

// Cada archivo CAP es inmutable (su nombre incluye la fecha de emisión), así que
// se guarda y nunca se vuelve a pedir. El almacenamiento es configurable: la app
// usa el del teléfono; el servidor, memoria.
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const STORAGE_KEY = 'smn-cap-cache-v1';
let store: KeyValueStore | null = null;
let capCache: Map<string, SmnAlert | null> | null = null;

/** Cambia dónde se guardan los archivos ya descargados y reinicia el estado interno. */
export function configureSmnStore(next: KeyValueStore | null): void {
  store = next;
  capCache = null;
  blockedUntil = 0;
}

async function loadCache(): Promise<Map<string, SmnAlert | null>> {
  if (capCache) return capCache;
  capCache = new Map();
  try {
    const stored = store ? await store.getItem(STORAGE_KEY) : null;
    if (stored) capCache = new Map(JSON.parse(stored) as [string, SmnAlert | null][]);
  } catch {
    // Sin caché guardada: se descarga todo de nuevo.
  }
  return capCache;
}

function saveCache(cache: Map<string, SmnAlert | null>) {
  if (!store) return;
  // Solo interesan los avisos que tocan Mendoza; del resto alcanza con saber que ya se vieron.
  const entries = [...cache.entries()].map(
    ([url, alert]) => [url, alert && touchesMendoza(alert.polygons) ? alert : null] as const,
  );
  store.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
}

/**
 * Arma la lista de archivos a consultar a partir del índice, pidiendo lo mínimo:
 * - Avisos a corto plazo: solo los que nombran a Mendoza en su descripción.
 * - Alertas: el SMN publica cada una en dos lotes con el mismo contenido
 *   (p. ej. "Tormenta_Llanura_…_64" y "Tormenta_Patagonia_…_64"); alcanza con uno.
 */
function selectCapUrls(indexHtml: string): string[] {
  const picked = new Map<string, string>();
  for (const block of indexHtml.split('<div class="item">').slice(1)) {
    const url = block.match(/https:\/\/ssl\.smn\.gob\.ar\/feeds\/CAP\/[^"'\s<>]+\.xml/)?.[0];
    if (!url) continue;
    if (url.includes('/avisocortoplazo/')) {
      if (/mendoza/i.test(block)) picked.set(url, url);
      continue;
    }
    const m = url.match(/CAP_\d+_([A-Za-z]+)_.*_(\d+)\.xml$/);
    const key = m ? `${m[1]}_${m[2]}` : url;
    if (!picked.has(key)) picked.set(key, url);
  }
  return [...picked.values()];
}

/** Si el SMN limita las consultas (HTTP 429) se espera antes de volver a pedir archivos. */
const COOL_DOWN_MS = 10 * 60_000;
let blockedUntil = 0;

export type SmnResult = {
  alerts: SmnAlert[];
  /** false si faltó descargar algún archivo: la lista puede estar incompleta. */
  complete: boolean;
};

/** Alertas y avisos vigentes del SMN que alcanzan a la provincia de Mendoza. */
export async function fetchSmnAlerts(): Promise<SmnResult> {
  const index = await fetchText(fresh(INDEX_URL, 120), 30000);
  const urls = selectCapUrls(index);
  const cache = await loadCache();

  for (const key of [...cache.keys()]) {
    if (!urls.includes(key)) cache.delete(key);
  }

  const pending = urls.filter((u) => !cache.has(u));
  if (pending.length > 0 && Date.now() >= blockedUntil) {
    await mapLimit(pending, 3, async (url) => {
      if (Date.now() < blockedUntil) return;
      try {
        cache.set(url, parseCap(await fetchText(url, 15000), url));
      } catch (error) {
        if (error instanceof HttpError && error.status === 429) {
          blockedUntil = Date.now() + COOL_DOWN_MS;
        }
      }
    });
    saveCache(cache);
  }

  const now = Date.now();
  const unique = new Map<string, SmnAlert>();
  for (const url of urls) {
    const alert = cache.get(url);
    if (!alert || alert.expires <= now || !touchesMendoza(alert.polygons)) continue;
    if (!unique.has(alert.id)) unique.set(alert.id, alert);
  }
  return {
    alerts: [...unique.values()].sort((a, b) => a.onset - b.onset),
    complete: urls.every((u) => cache.has(u)),
  };
}

export function alertCovers(alert: SmnAlert, p: LatLng): boolean {
  return alert.polygons.some((poly) => pointInPolygon(p, poly));
}

export function alertIsActive(alert: SmnAlert, now = Date.now()): boolean {
  return alert.onset <= now && alert.expires > now;
}

/** Localidades de referencia alcanzadas por una alerta. */
export function alertLocalities(alert: SmnAlert): string[] {
  return LOCALITIES.filter((l) => alertCovers(alert, l)).map((l) => l.name);
}

/**
 * El SMN publica una alerta por zona y por tramo del día. Para mostrarlas se
 * unen las del mismo fenómeno y nivel cuyos horarios se tocan o superponen.
 */
export function groupAlerts(alerts: SmnAlert[]): SmnAlert[] {
  const buckets = new Map<string, SmnAlert[]>();
  for (const a of alerts) {
    const key = `${a.kind}|${a.level}|${a.immediate}`;
    buckets.set(key, [...(buckets.get(key) ?? []), a]);
  }
  const out: SmnAlert[] = [];
  for (const group of buckets.values()) {
    group.sort((a, b) => a.onset - b.onset);
    let open = -1; // índice en `out` del grupo que se está armando
    for (const a of group) {
      const current = open >= 0 ? out[open] : undefined;
      if (current && a.onset <= current.expires + 60_000) {
        out[open] = {
          ...current,
          expires: Math.max(current.expires, a.expires),
          polygons: [...current.polygons, ...a.polygons],
        };
      } else {
        open = out.push({ ...a, polygons: [...a.polygons] }) - 1;
      }
    }
  }
  return out.sort((a, b) => a.onset - b.onset || b.level - a.level);
}

/** Distancia aproximada (km) desde un punto hasta la zona alertada; 0 si está adentro. */
export function alertDistanceKm(alert: SmnAlert, p: LatLng): number {
  if (alertCovers(alert, p)) return 0;
  let best = Infinity;
  for (const poly of alert.polygons) {
    for (const [lat, lng] of poly) best = Math.min(best, distanceKm(p, { lat, lng }));
  }
  return best;
}
