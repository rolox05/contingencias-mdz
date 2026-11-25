import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureHttp,
  DBZ_PALETTE,
  fetchRadarFrames,
  fetchStrikes,
  inRadarCoverage,
  loadRaster,
  pixelLat,
  pixelLng,
  RADAR_BASE,
  sampleAt,
  scanAround,
  summarizeLightning,
} from '../src';
import { emptyRaster, fakeFetch, fixturePath, paintBlob } from './helpers';

afterEach(() => {
  vi.useRealTimers();
  configureHttp({ fetch: undefined });
});

describe('radar frames', () => {
  it('lists the latest passes of the last two days in order', async () => {
    const list = {
      '20261123': ['000000_dbz.png'],
      '20261124': ['235800_dbz.png', '235800_granizo.png', '235800_granizo_manga.png'],
      '20261125': ['000000_dbz.png', '000200_dbz.png', '000200_granizo.png', 'manga_afectacion_diaria.json'],
    };
    fakeFetch((url) => (url.includes('file_list.json') ? { body: JSON.stringify(list) } : null));
    const frames = await fetchRadarFrames(10);

    expect(frames.map((f) => f.key)).toEqual(['20261124235800', '20261125000000', '20261125000200']);
    expect(frames[0].time).toBe(Date.UTC(2026, 10, 24, 23, 58));
    expect(frames[0].hailSwath).toBe(`${RADAR_BASE}/20261124/235800_granizo_manga.png`);
    expect(frames[1].hail).toBeNull();
    expect(frames[2].dbz).toBe(`${RADAR_BASE}/20261125/000200_dbz.png`);
  });

  it('decodes the official PNG into RGBA pixels', async () => {
    const png = readFileSync(fixturePath('radar', '20261125_150000_dbz.png'));
    fakeFetch(() => ({ body: new Uint8Array(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)) }));
    const raster = await loadRaster(`${RADAR_BASE}/test/decode.png`);
    expect(raster.width).toBe(500);
    expect(raster.height).toBe(700);
    expect(raster.data.length).toBe(500 * 700 * 4);
  });
});

describe('radar sampling', () => {
  it('knows the mosaic coverage', () => {
    expect(inRadarCoverage({ lat: -32.89, lng: -68.85 })).toBe(true);
    expect(inRadarCoverage({ lat: -38.9, lng: -68.0 })).toBe(false);
  });

  it('reads values and ignores isolated speckle pixels', () => {
    const raster = emptyRaster();
    // Celda real (11 px de radio, 51 dBZ) y un píxel suelto de 60 dBZ cerca del punto.
    paintBlob(raster, 250, 300, 11, () => [254, 250, 3]);
    paintBlob(raster, 270, 300, 0.5, () => [253, 52, 28]);

    const center = { lat: pixelLat(300, 700), lng: pixelLng(250, 500) };
    expect(sampleAt(raster, center, DBZ_PALETTE)).toBe(51);
    const scan = scanAround(raster, center, DBZ_PALETTE, { rings: [3, 10, 25], nearestMin: 45, support: 4 });
    expect(scan.here).toBe(51);
    expect(scan.within[25]).toBe(51); // el píxel de 60 dBZ suelto no cuenta
  });
});

describe('lightning', () => {
  it('keeps strikes around Mendoza and summarises distances', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 25, 0, 2));
    const strikes = [
      { id: 1, lat: -32.95, lng: -68.85, e: 20, fecha: '00:01:30' }, // ~7 km
      { id: 2, lat: -33.2, lng: -68.85, e: 90, fecha: '23:59:50' }, // ayer, ~34 km
      { id: 3, lat: -31.0, lng: -63.0, e: 10, fecha: '00:01:00' }, // Córdoba: fuera de región
    ];
    fakeFetch((url) => (url.includes('rayos.json') ? { body: JSON.stringify(strikes) } : null));
    const list = await fetchStrikes();

    expect(list.map((s) => s.id)).toEqual([1, 2]);
    expect(list[1].time).toBe(Date.UTC(2026, 10, 24, 23, 59, 50));
    const summary = summarizeLightning(list, { lat: -32.89, lng: -68.85 });
    expect(summary.within10).toBe(1);
    expect(summary.within50).toBe(2);
    expect(summary.nearestKm).toBeLessThan(8);
  });
});
