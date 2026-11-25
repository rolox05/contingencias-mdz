/// <reference path="./types/upng-js.d.ts" />
import UPNG from 'upng-js';

import { fetchBuffer, fetchJson, fresh } from './http';
import type { Raster } from './radarMath';

export const RADAR_BASE = 'https://www2.contingencias.mendoza.gov.ar/radar/web';

/** Una pasada del radar (hay una cada ~2 minutos). */
export type RadarFrame = {
  key: string;
  /** Momento de la pasada (ms epoch). */
  time: number;
  folder: string;
  /** Reflectividad instantánea. */
  dbz: string;
  /** Probabilidad de granizo instantánea. */
  hail: string | null;
  /** Granizo acumulado del día ("manga"). */
  hailSwath: string | null;
};

type FileList = Record<string, string[]>;

function frameTime(folder: string, hhmmss: string): number {
  return Date.UTC(
    Number(folder.slice(0, 4)),
    Number(folder.slice(4, 6)) - 1,
    Number(folder.slice(6, 8)),
    Number(hhmmss.slice(0, 2)),
    Number(hhmmss.slice(2, 4)),
    Number(hhmmss.slice(4, 6)),
  );
}

/** Últimas pasadas del radar, de la más vieja a la más nueva. */
export async function fetchRadarFrames(max = 16): Promise<RadarFrame[]> {
  const list = await fetchJson<FileList>(fresh(`${RADAR_BASE}/file_list.json`, 30));
  const folders = Object.keys(list)
    .filter((f) => /^\d{8}$/.test(f))
    .sort()
    .slice(-2);

  const frames: RadarFrame[] = [];
  for (const folder of folders) {
    const files = new Set(list[folder]);
    const hours = new Set<string>();
    for (const f of files) {
      const h = f.slice(0, 6);
      if (/^\d{6}$/.test(h)) hours.add(h);
    }
    for (const h of hours) {
      const dbzFile = files.has(`${h}_dbz.png`) ? `${h}_dbz.png` : files.has(`${h}.png`) ? `${h}.png` : null;
      if (!dbzFile) continue;
      const url = (name: string) => `${RADAR_BASE}/${folder}/${name}`;
      frames.push({
        key: `${folder}${h}`,
        time: frameTime(folder, h),
        folder,
        dbz: url(dbzFile),
        hail: files.has(`${h}_granizo.png`) ? url(`${h}_granizo.png`) : null,
        hailSwath: files.has(`${h}_granizo_manga.png`) ? url(`${h}_granizo_manga.png`) : null,
      });
    }
  }
  frames.sort((a, b) => a.time - b.time);
  return frames.slice(-max);
}

const rasterCache = new Map<string, Promise<Raster>>();
const CACHE_SIZE = 8;

/** Descarga y decodifica una imagen del radar a píxeles RGBA. */
export function loadRaster(url: string): Promise<Raster> {
  const cached = rasterCache.get(url);
  if (cached) return cached;

  const promise = fetchBuffer(url).then((buffer) => {
    const png = UPNG.decode(buffer);
    return { width: png.width, height: png.height, data: new Uint8Array(UPNG.toRGBA8(png)[0]) };
  });
  rasterCache.set(url, promise);
  promise.catch(() => rasterCache.delete(url));
  while (rasterCache.size > CACHE_SIZE) {
    rasterCache.delete(rasterCache.keys().next().value as string);
  }
  return promise;
}
