import { bearingDeg, distanceKm, type LatLng } from './geo';
import { classifyRaster, DBZ_PALETTE, pixelLat, pixelLng, RADAR_BOUNDS, type Raster } from './radarMath';

/**
 * Seguimiento de tormentas entre dos pasadas del radar.
 *
 * 1. Se separan las celdas: zonas contiguas con 35 dBZ o más, descartando píxeles
 *    sueltos (ruido y ecos de terreno).
 * 2. Para cada celda se busca en la pasada anterior el desplazamiento que mejor
 *    calza su forma e intensidad (correlación por bloques). Ese desplazamiento,
 *    dividido por el tiempo entre pasadas, da la velocidad y el rumbo.
 *
 * Cada píxel del mosaico mide ~1 km, así que con 10 minutos entre pasadas la
 * velocidad tiene una resolución de ~6 km/h.
 */

export type StormMotion = {
  speedKmh: number;
  /** Rumbo hacia donde va, en grados (0 = norte, 90 = este). */
  towards: number;
};

export type StormCell = LatLng & {
  id: string;
  maxDbz: number;
  areaKm2: number;
  /** Radio equivalente de la celda, en km. */
  radiusKm: number;
  /** null si no se pudo estimar con confianza. */
  motion: StormMotion | null;
};

const CELL_DBZ = 35;
const NEIGHBOR_DBZ = 30;
const MIN_AREA = 8;
/** Celdas más chicas que esto no tienen forma suficiente para seguirlas. */
const MIN_TRACK_AREA = 15;
const MAX_SPEED_KMH = 95;
/** Por debajo de esta velocidad se considera que la celda está quieta. */
export const MOVING_KMH = 8;

type Cell = {
  pixels: Int32Array;
  maxDbz: number;
  cx: number;
  cy: number;
};

function findCells(grid: Int8Array, w: number, h: number): Cell[] {
  // Máscara: píxeles intensos con al menos 3 vecinos con eco.
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (grid[i] < CELL_DBZ) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && grid[i + dy * w + dx] >= NEIGHBOR_DBZ) n++;
        }
      }
      if (n >= 3) mask[i] = 1;
    }
  }

  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const cells: Cell[] = [];
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    const id = next++;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    const members: number[] = [];
    let maxDbz = 0;
    let sw = 0;
    let sx = 0;
    let sy = 0;
    while (top > 0) {
      const i = stack[--top];
      members.push(i);
      const v = grid[i];
      const x = i % w;
      const y = (i - x) / w;
      const weight = v - NEIGHBOR_DBZ + 1;
      sw += weight;
      sx += x * weight;
      sy += y * weight;
      if (v > maxDbz) maxDbz = v;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (mask[j] && !label[j]) {
            label[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
    if (members.length >= MIN_AREA) {
      cells.push({ pixels: Int32Array.from(members), maxDbz, cx: sx / sw, cy: sy / sw });
    }
  }
  return cells;
}

/** Desplazamientos posibles, ordenados de menor a mayor (ante empate gana el más corto). */
function shiftsWithin(radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) out.push([dx, dy]);
    }
  }
  return out.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
}

/**
 * Campo suavizado (promedio 5 x 5 de la intensidad por encima de 15 dBZ). Comparar
 * campos suavizados evita que el moteado del mosaico produzca calces casuales.
 */
function smooth(grid: Int8Array, w: number, h: number): Float32Array {
  const base = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) base[i] = grid[i] > 15 ? grid[i] - 15 : 0;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const R = 2;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -R; x <= R; x++) if (x >= 0 && x < w) acc += base[y * w + x];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc;
      const add = x + R + 1;
      const sub = x - R;
      if (add < w) acc += base[y * w + add];
      if (sub >= 0) acc -= base[y * w + sub];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -R; y <= R; y++) if (y >= 0 && y < h) acc += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / 25;
      const add = y + R + 1;
      const sub = y - R;
      if (add < h) acc += tmp[add * w + x];
      if (sub >= 0) acc -= tmp[sub * w + x];
    }
  }
  return out;
}

type Match = { dx: number; dy: number; quality: number };

/**
 * Desplazamiento (en píxeles) que lleva la celda desde una pasada anterior a la
 * actual: el que minimiza la diferencia entre los campos suavizados.
 */
function matchShift(
  sample: number[],
  current: Float32Array,
  previous: Float32Array,
  w: number,
  h: number,
  shifts: [number, number][],
): Match | null {
  let total = 0;
  for (const i of sample) total += current[i];
  if (total <= 0) return null;

  let bestError = Infinity;
  let bestDx = 0;
  let bestDy = 0;
  for (const [dx, dy] of shifts) {
    let error = 0;
    for (const i of sample) {
      const x = (i % w) - dx;
      const y = ((i - (i % w)) / w) - dy;
      const before = x < 0 || y < 0 || x >= w || y >= h ? 0 : previous[y * w + x];
      error += Math.abs(current[i] - before);
      if (error >= bestError) break;
    }
    if (error < bestError - 1e-6) {
      bestError = error;
      bestDx = dx;
      bestDy = dy;
    }
  }
  return { dx: bestDx, dy: bestDy, quality: 1 - bestError / total };
}

function cellId(lat: number, lng: number, maxDbz: number) {
  return `${lat.toFixed(2)},${lng.toFixed(2)},${maxDbz}`;
}

export type RadarHistory = { raster: Raster; minutesAgo: number };

/**
 * Celdas de la pasada actual con su movimiento. Se usan dos pasadas anteriores
 * (~10 y ~20 minutos antes): el movimiento solo se informa si ambas coinciden,
 * y se toma el de la más vieja, que tiene mejor resolución.
 */
function trackRaw(current: Raster, history: RadarHistory[]): StormCell[] {
  const w = current.width;
  const h = current.height;
  const grid = classifyRaster(current, DBZ_PALETTE);
  const cells = findCells(grid, w, h);

  const usable = history
    .filter((p) => p.raster.width === w && p.raster.height === h && p.minutesAgo >= 4 && p.minutesAgo <= 40)
    .sort((a, b) => a.minutesAgo - b.minutesAgo);
  const near = usable[0];
  const far = usable.find((p) => p.minutesAgo >= (near?.minutesAgo ?? 0) * 1.6);

  const cur = near ? smooth(grid, w, h) : null;
  const nearField = near ? smooth(classifyRaster(near.raster, DBZ_PALETTE), w, h) : null;
  const farField = far ? smooth(classifyRaster(far.raster, DBZ_PALETTE), w, h) : null;
  const radius = near ? Math.min(25, Math.ceil((MAX_SPEED_KMH * near.minutesAgo) / 60)) : 0;
  const nearShifts = near ? shiftsWithin(radius) : [];
  const kmPerPxX = ((RADAR_BOUNDS.east - RADAR_BOUNDS.west) / w) * 111.32;

  return cells.map((cell) => {
    const lat = pixelLat(cell.cy, h);
    const lng = pixelLng(cell.cx, w);
    const areaKm2 = cell.pixels.length; // ~1 km² por píxel
    const base = {
      id: cellId(lat, lng, cell.maxDbz),
      lat,
      lng,
      maxDbz: cell.maxDbz,
      areaKm2,
      radiusKm: Math.sqrt(areaKm2 / Math.PI),
    };
    if (!near || !cur || !nearField || areaKm2 < MIN_TRACK_AREA) return { ...base, motion: null };

    const stride = Math.max(1, Math.floor(cell.pixels.length / 400));
    const sample: number[] = [];
    for (let k = 0; k < cell.pixels.length; k += stride) sample.push(cell.pixels[k]);

    const first = matchShift(sample, cur, nearField, w, h, nearShifts);
    if (!first || first.quality < 0.5 || Math.hypot(first.dx, first.dy) >= radius - 0.5) {
      return { ...base, motion: null };
    }

    // Confirmación con la pasada más vieja, buscando cerca de donde debería estar.
    let dx = first.dx;
    let dy = first.dy;
    let minutes = near.minutesAgo;
    if (far && farField) {
      const ratio = far.minutesAgo / near.minutesAgo;
      const ex = Math.round(first.dx * ratio);
      const ey = Math.round(first.dy * ratio);
      const window = Math.max(3, Math.ceil(ratio * 1.5));
      const around = shiftsWithin(window).map(([sx, sy]) => [ex + sx, ey + sy] as [number, number]);
      const second = matchShift(sample, cur, farField, w, h, around);
      if (!second || second.quality < 0.4) return { ...base, motion: null };
      // Velocidades (px/min) de ambas comparaciones: deben parecerse.
      const v1x = first.dx / near.minutesAgo;
      const v1y = first.dy / near.minutesAgo;
      const v2x = second.dx / far.minutesAgo;
      const v2y = second.dy / far.minutesAgo;
      const diff = Math.hypot(v1x - v2x, v1y - v2y) * 60; // ~km/h
      const speed = Math.hypot(v2x, v2y) * 60;
      if (diff > Math.max(15, speed * 0.4)) return { ...base, motion: null };
      dx = second.dx;
      dy = second.dy;
      minutes = far.minutesAgo;
    }

    const kmX = dx * kmPerPxX * Math.cos((lat * Math.PI) / 180);
    const kmPerPxY = (pixelLat(cell.cy - 0.5, h) - pixelLat(cell.cy + 0.5, h)) * 110.9;
    const kmNorth = -dy * kmPerPxY;
    const speedKmh = (Math.hypot(kmX, kmNorth) / minutes) * 60;
    if (speedKmh > MAX_SPEED_KMH) return { ...base, motion: null };
    const towards = ((Math.atan2(kmX, kmNorth) * 180) / Math.PI + 360) % 360;
    return { ...base, motion: { speedKmh, towards } };
  });
}

const toVector = (m: StormMotion) => {
  const r = (m.towards * Math.PI) / 180;
  return [m.speedKmh * Math.sin(r), m.speedKmh * Math.cos(r)] as const;
};

/**
 * Celdas de la pasada actual con su movimiento. Las tormentas de una zona se
 * mueven con el flujo general: si una celda contradice mucho ese movimiento
 * (típico de ecos de terreno en la cordillera), se descarta su flecha.
 */
export function trackStorms(current: Raster, history: RadarHistory[]): StormCell[] {
  const cells = trackRaw(current, history);
  const general = overallMotion(cells);
  return cells.map((cell) => {
    if (!cell.motion) return cell;
    if (!general) {
      // Sin referencia general solo se confía en celdas grandes.
      return cell.areaKm2 >= 40 ? cell : { ...cell, motion: null };
    }
    const [gx, gy] = toVector(general);
    const [cx, cy] = toVector(cell.motion);
    const diff = Math.hypot(cx - gx, cy - gy);
    return diff > Math.max(25, general.speedKmh * 0.6) ? { ...cell, motion: null } : cell;
  });
}

/** Movimiento general de las tormentas (mediana ponderada por tamaño), si hay suficientes. */
export function overallMotion(cells: StormCell[]): StormMotion | null {
  const moving = cells.filter(
    (c) => c.motion && c.motion.speedKmh >= MOVING_KMH && c.maxDbz >= 40 && c.areaKm2 >= 30,
  );
  if (moving.length === 0 || moving.reduce((sum, c) => sum + c.areaKm2, 0) < 80) return null;
  const median = (values: [number, number][]) => {
    const sorted = [...values].sort((a, b) => a[0] - b[0]);
    const total = sorted.reduce((s, v) => s + v[1], 0);
    let acc = 0;
    for (const [value, weight] of sorted) {
      acc += weight;
      if (acc >= total / 2) return value;
    }
    return sorted[sorted.length - 1][0];
  };
  const east = median(moving.map((c) => [c.motion!.speedKmh * Math.sin((c.motion!.towards * Math.PI) / 180), c.areaKm2]));
  const north = median(moving.map((c) => [c.motion!.speedKmh * Math.cos((c.motion!.towards * Math.PI) / 180), c.areaKm2]));
  const speedKmh = Math.hypot(east, north);
  if (speedKmh < MOVING_KMH) return null;
  return { speedKmh, towards: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360 };
}

export type StormThreat = {
  /** Distancia hasta el borde de la celda, en km. */
  km: number;
  /** Rumbo desde el usuario hacia la celda. */
  bearing: number;
  value: number;
  motion: StormMotion | null;
  /**
   * approaching: su trayectoria pasa por tu ubicación.
   * passing: se acerca pero pasaría al costado.
   * receding: se aleja. steady: casi no se mueve o no se pudo estimar.
   */
  trend: 'approaching' | 'passing' | 'receding' | 'steady';
  /** Minutos estimados hasta que llegue (solo si viene hacia vos, hasta 90 min). */
  etaMin: number | null;
};

const KM_PER_DEG_LAT = 110.9;

/**
 * La celda intensa (45 dBZ o más) más relevante para un punto: primero la que
 * venga hacia él y llegue antes; si ninguna viene, la más cercana.
 */
export function threatFor(cells: StormCell[], p: LatLng, maxKm = 60): StormThreat | null {
  let best: StormThreat | null = null;
  const rank = (t: StormThreat) => (t.trend === 'approaching' ? (t.etaMin ?? 90) : 1000 + t.km);

  for (const cell of cells) {
    if (cell.maxDbz < 45) continue;
    const center = distanceKm(p, cell);
    const km = Math.max(0, center - cell.radiusKm);
    if (km > maxKm) continue;

    const threat: StormThreat = {
      km,
      bearing: bearingDeg(p, cell),
      value: cell.maxDbz,
      motion: cell.motion,
      trend: 'steady',
      etaMin: null,
    };

    if (cell.motion && cell.motion.speedKmh >= MOVING_KMH && km > 0) {
      // Posición de la celda relativa al punto (km) y velocidad (km/h).
      const rx = (cell.lng - p.lng) * 111.32 * Math.cos((p.lat * Math.PI) / 180);
      const ry = (cell.lat - p.lat) * KM_PER_DEG_LAT;
      const rad = (cell.motion.towards * Math.PI) / 180;
      const vx = cell.motion.speedKmh * Math.sin(rad);
      const vy = cell.motion.speedKmh * Math.cos(rad);
      const v2 = vx * vx + vy * vy;
      const tClosest = -(rx * vx + ry * vy) / v2; // horas
      if (tClosest <= 0) {
        threat.trend = 'receding';
      } else {
        const closest = Math.hypot(rx + vx * tClosest, ry + vy * tClosest);
        const reach = cell.radiusKm + 3;
        if (closest <= reach) {
          threat.trend = 'approaching';
          const tReach = tClosest - Math.sqrt(reach * reach - closest * closest) / Math.sqrt(v2);
          const minutes = Math.max(0, tReach) * 60;
          threat.etaMin = minutes <= 90 ? Math.max(5, Math.round(minutes / 5) * 5) : null;
        } else {
          threat.trend = 'passing';
        }
      }
    }

    if (!best || rank(threat) < rank(best)) best = threat;
  }
  return best;
}
