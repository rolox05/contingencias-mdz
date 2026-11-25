import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import UPNG from 'upng-js';

import { configureHttp, type Raster } from '../src';

export const FIXTURES = join(__dirname, 'fixtures');

export function fixturePath(...parts: string[]): string {
  return join(FIXTURES, ...parts);
}

export function loadFixtureRaster(name: string): Raster {
  const buffer = readFileSync(fixturePath('radar', name));
  const png = UPNG.decode(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return { width: png.width, height: png.height, data: new Uint8Array(UPNG.toRGBA8(png)[0]) };
}

export type FakeRoute = (url: string) => { status?: number; body: string | Uint8Array<ArrayBuffer> } | null;

/** Reemplaza el acceso a red del núcleo; devuelve la lista de URLs pedidas. */
export function fakeFetch(route: FakeRoute): string[] {
  const requested: string[] = [];
  configureHttp({
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      const hit = route(url);
      if (!hit) return new Response('not found', { status: 404 });
      return new Response(hit.body, { status: hit.status ?? 200 });
    }) as typeof fetch,
  });
  return requested;
}

/** Ráster vacío del tamaño del mosaico (500 x 700). */
export function emptyRaster(width = 500, height = 700): Raster {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Pinta un círculo de un color de la paleta (centro en píxeles). */
export function paintBlob(
  raster: Raster,
  cx: number,
  cy: number,
  radius: number,
  rgbByDistance: (d: number) => [number, number, number],
): void {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius || x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue;
      const i = (y * raster.width + x) * 4;
      const [r, g, b] = rgbByDistance(d / radius);
      raster.data[i] = r;
      raster.data[i + 1] = g;
      raster.data[i + 2] = b;
      raster.data[i + 3] = 255;
    }
  }
}
