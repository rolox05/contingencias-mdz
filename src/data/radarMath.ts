import { bearingDeg, distanceKm, type LatLng } from './geo';

/**
 * Geometría del mosaico de radares de la DCC Mendoza. Son los mismos valores que
 * usa el visor oficial (www2.contingencias.mendoza.gov.ar/radar/web) para ubicar
 * la imagen de 500 x 700 px sobre el mapa.
 */
const ORIGIN = { lat: -34.0, lng: -68.0 };
const KM = { north: 450, south: 250, east: 250, west: 250 };
const DEG_LAT_KM = 110.924;
const DEG_LNG_KM = 92.425;
const LAT_NUDGE = 0.046;

export const RADAR_BOUNDS = {
  south: ORIGIN.lat - KM.south / DEG_LAT_KM + LAT_NUDGE,
  north: ORIGIN.lat + KM.north / DEG_LAT_KM + LAT_NUDGE,
  west: ORIGIN.lng - KM.west / DEG_LNG_KM,
  east: ORIGIN.lng + KM.east / DEG_LNG_KM,
};

export type Raster = { width: number; height: number; data: Uint8Array };

type PaletteEntry = { r: number; g: number; b: number; value: number };

/** Reflectividad: `value` es el piso del rango en dBZ. */
export const DBZ_PALETTE: PaletteEntry[] = [
  { r: 211, g: 211, b: 211, value: 70 },
  { r: 128, g: 128, b: 128, value: 65 },
  { r: 253, g: 52, b: 28, value: 60 },
  { r: 254, g: 95, b: 5, value: 57 },
  { r: 254, g: 154, b: 88, value: 54 },
  { r: 254, g: 250, b: 3, value: 51 },
  { r: 250, g: 196, b: 49, value: 48 },
  { r: 210, g: 136, b: 59, value: 45 },
  { r: 192, g: 100, b: 135, value: 42 },
  { r: 200, g: 15, b: 134, value: 39 },
  { r: 110, g: 13, b: 198, value: 36 },
  { r: 28, g: 71, b: 232, value: 35 },
  { r: 8, g: 127, b: 219, value: 30 },
  { r: 0, g: 112, b: 0, value: 20 },
  { r: 0, g: 90, b: 0, value: 10 },
  { r: 72, g: 61, b: 139, value: 5 },
];

/** Probabilidad de granizo: `value` es el piso del rango en %. */
export const HAIL_PALETTE: PaletteEntry[] = [
  { r: 255, g: 0, b: 0, value: 90 },
  { r: 255, g: 69, b: 0, value: 80 },
  { r: 255, g: 127, b: 80, value: 70 },
  { r: 154, g: 205, b: 50, value: 60 },
  { r: 0, g: 100, b: 0, value: 50 },
];

const DBZ_RANGE_TOP: Record<number, number> = {
  70: 80, 65: 70, 60: 65, 57: 60, 54: 57, 51: 54, 48: 51, 45: 48,
  42: 45, 39: 42, 36: 39, 35: 36, 30: 35, 20: 30, 10: 20, 5: 10,
};

export function dbzRangeLabel(value: number): string {
  return `${value}–${DBZ_RANGE_TOP[value] ?? value + 5} dBZ`;
}

export function hailRangeLabel(value: number): string {
  return `${value}–${value + 10} %`;
}

/** Descripción en palabras de un valor de reflectividad. */
export function describeDbz(value: number): string {
  if (value >= 60) return 'tormenta severa';
  if (value >= 54) return 'lluvia muy intensa';
  if (value >= 45) return 'lluvia fuerte';
  if (value >= 35) return 'lluvia moderada';
  if (value >= 20) return 'lluvia débil';
  return 'llovizna';
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const MERC_N = mercY(RADAR_BOUNDS.north);
const MERC_S = mercY(RADAR_BOUNDS.south);

export function inRadarCoverage(p: LatLng): boolean {
  return (
    p.lat > RADAR_BOUNDS.south &&
    p.lat < RADAR_BOUNDS.north &&
    p.lng > RADAR_BOUNDS.west &&
    p.lng < RADAR_BOUNDS.east
  );
}

/** Posición (en píxeles, con decimales) de un punto dentro de la imagen. */
function toPixel(p: LatLng, w: number, h: number) {
  return {
    x: ((p.lng - RADAR_BOUNDS.west) / (RADAR_BOUNDS.east - RADAR_BOUNDS.west)) * w,
    y: ((MERC_N - mercY(p.lat)) / (MERC_N - MERC_S)) * h,
  };
}

export function pixelLat(y: number, h: number): number {
  const m = MERC_N - ((y + 0.5) / h) * (MERC_N - MERC_S);
  return ((2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180) / Math.PI;
}

export function pixelLng(x: number, w: number): number {
  return RADAR_BOUNDS.west + ((x + 0.5) / w) * (RADAR_BOUNDS.east - RADAR_BOUNDS.west);
}

function makeClassifier(palette: PaletteEntry[]) {
  const cache = new Map<number, number | null>();
  return (r: number, g: number, b: number): number | null => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best: number | null = null;
    let bestDist = 60 * 60; // colores muy lejanos a la paleta se ignoran
    for (const p of palette) {
      const d = (r - p.r) ** 2 + (g - p.g) ** 2 + (b - p.b) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = p.value;
      }
    }
    cache.set(key, best);
    return best;
  };
}

const classifiers = new Map<PaletteEntry[], ReturnType<typeof makeClassifier>>();
function classifierFor(palette: PaletteEntry[]) {
  let c = classifiers.get(palette);
  if (!c) {
    c = makeClassifier(palette);
    classifiers.set(palette, c);
  }
  return c;
}

const MIN_ALPHA = 180;

/** Convierte toda la imagen a una grilla de valores de la paleta (-1 = sin eco). */
export function classifyRaster(raster: Raster, palette: PaletteEntry[]): Int8Array {
  const { width, height, data } = raster;
  const classify = classifierFor(palette);
  const grid = new Int8Array(width * height).fill(-1);
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] < MIN_ALPHA) continue;
    const value = classify(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    if (value !== null) grid[i] = value;
  }
  return grid;
}

/** Valor de la capa en un punto exacto (como la lectura del visor oficial). */
export function sampleAt(raster: Raster, p: LatLng, palette: PaletteEntry[]): number | null {
  if (!inRadarCoverage(p)) return null;
  const { x, y } = toPixel(p, raster.width, raster.height);
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) return null;
  const i = (py * raster.width + px) * 4;
  if (raster.data[i + 3] < MIN_ALPHA) return null;
  return classifierFor(palette)(raster.data[i], raster.data[i + 1], raster.data[i + 2]);
}

export type NearestEcho = { km: number; bearing: number; value: number };

export type RasterScan = {
  /** Máximo en el punto y sus píxeles vecinos (~1,5 km). */
  here: number | null;
  /** Máximo dentro de cada radio pedido (km → valor). */
  within: Record<number, number | null>;
  /** Eco más cercano con valor >= `nearestMin`. */
  nearest: NearestEcho | null;
};

/**
 * Valor "sostenido" de un píxel: el mayor valor que alcanzan al menos `support`
 * de los 9 píxeles de su entorno de 3 x 3. Descarta los ecos sueltos (ruido y
 * ecos de terreno), que son frecuentes cerca de la precordillera.
 */
function supportedValue(grid: Int8Array, gw: number, x: number, y: number, support: number): number {
  const window: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) window.push(grid[(y + dy) * gw + x + dx]);
  }
  window.sort((a, b) => b - a);
  return Math.min(grid[y * gw + x], window[support - 1]);
}

/**
 * Recorre los píxeles alrededor de un punto y resume qué hay cerca.
 * Cada píxel del mosaico equivale a ~1 km.
 */
export function scanAround(
  raster: Raster,
  center: LatLng,
  palette: PaletteEntry[],
  opts: { rings: number[]; nearestMin: number; support: number },
): RasterScan {
  const within: Record<number, number | null> = {};
  for (const r of opts.rings) within[r] = null;
  const result: RasterScan = { here: null, within, nearest: null };
  if (!inRadarCoverage(center)) return result;

  const { width: w, height: h, data } = raster;
  const classify = classifierFor(palette);
  const maxKm = Math.max(...opts.rings);
  const dLat = maxKm / 110.9;
  const dLng = maxKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  const topLeft = toPixel({ lat: center.lat + dLat, lng: center.lng - dLng }, w, h);
  const bottomRight = toPixel({ lat: center.lat - dLat, lng: center.lng + dLng }, w, h);
  const x0 = Math.max(0, Math.floor(topLeft.x));
  const x1 = Math.min(w - 1, Math.ceil(bottomRight.x));
  const y0 = Math.max(0, Math.floor(topLeft.y));
  const y1 = Math.min(h - 1, Math.ceil(bottomRight.y));
  if (x1 < x0 || y1 < y0) return result;

  // Grilla de valores con un píxel de margen (-1 = sin eco).
  const gw = x1 - x0 + 3;
  const gh = y1 - y0 + 3;
  const grid = new Int8Array(gw * gh).fill(-1);
  for (let y = Math.max(0, y0 - 1); y <= Math.min(h - 1, y1 + 1); y++) {
    for (let x = Math.max(0, x0 - 1); x <= Math.min(w - 1, x1 + 1); x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < MIN_ALPHA) continue;
      const value = classify(data[i], data[i + 1], data[i + 2]);
      if (value !== null) grid[(y - y0 + 1) * gw + (x - x0 + 1)] = value;
    }
  }

  for (let y = y0; y <= y1; y++) {
    const lat = pixelLat(y, h);
    for (let x = x0; x <= x1; x++) {
      if (grid[(y - y0 + 1) * gw + (x - x0 + 1)] < 0) continue;
      const value = supportedValue(grid, gw, x - x0 + 1, y - y0 + 1, opts.support);
      if (value < 0) continue;
      const point = { lat, lng: pixelLng(x, w) };
      const km = distanceKm(center, point);
      if (km > maxKm) continue;
      if (km <= 1.5 && (result.here === null || value > result.here)) result.here = value;
      for (const r of opts.rings) {
        const current = within[r];
        if (km <= r && (current === null || value > current)) within[r] = value;
      }
      if (value >= opts.nearestMin && (!result.nearest || km < result.nearest.km)) {
        result.nearest = { km, bearing: bearingDeg(center, point), value };
      }
    }
  }
  return result;
}
