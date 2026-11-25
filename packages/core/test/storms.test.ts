import { describe, expect, it } from 'vitest';

import { overallMotion, pixelLat, pixelLng, threatFor, trackStorms, type StormCell } from '../src';
import { emptyRaster, loadFixtureRaster, paintBlob } from './helpers';

/** Celda con núcleo intenso: 57 dBZ al centro, 51 alrededor y 35 en el borde. */
const stormColors = (d: number): [number, number, number] =>
  d < 0.35 ? [254, 95, 5] : d < 0.7 ? [254, 250, 3] : [28, 71, 232];

function syntheticStorm(x: number, y: number) {
  const raster = emptyRaster();
  paintBlob(raster, x, y, 9, stormColors);
  return raster;
}

describe('trackStorms (synthetic)', () => {
  it('recovers a known motion: 5 px east and 3 px north every 10 minutes', () => {
    const cells = trackStorms(syntheticStorm(260, 294), [
      { raster: syntheticStorm(255, 297), minutesAgo: 10 },
      { raster: syntheticStorm(250, 300), minutesAgo: 20 },
    ]);
    expect(cells).toHaveLength(1);
    const motion = cells[0].motion!;
    expect(motion).not.toBeNull();
    // ~11,7 km en 20 min ≈ 35 km/h hacia ~59° (noreste).
    expect(motion.speedKmh).toBeGreaterThan(30);
    expect(motion.speedKmh).toBeLessThan(40);
    expect(motion.towards).toBeGreaterThan(50);
    expect(motion.towards).toBeLessThan(68);
    expect(cells[0].maxDbz).toBe(57);
  });

  it('reports a stationary cell as not moving', () => {
    const cells = trackStorms(syntheticStorm(250, 300), [
      { raster: syntheticStorm(250, 300), minutesAgo: 10 },
      { raster: syntheticStorm(250, 300), minutesAgo: 20 },
    ]);
    expect(cells[0].motion?.speedKmh ?? 0).toBeLessThan(1);
  });

  it('gives no motion when the older pass contradicts the newer one', () => {
    const cells = trackStorms(syntheticStorm(260, 300), [
      { raster: syntheticStorm(255, 300), minutesAgo: 10 }, // va al este…
      { raster: syntheticStorm(270, 300), minutesAgo: 20 }, // …pero antes estaba más al este
    ]);
    expect(cells[0].motion).toBeNull();
  });

  it('places cells at the right coordinates', () => {
    const [cell] = trackStorms(syntheticStorm(250, 300), []);
    expect(cell.lat).toBeCloseTo(pixelLat(300, 700), 1);
    expect(cell.lng).toBeCloseTo(pixelLng(250, 500), 1);
    expect(cell.motion).toBeNull();
  });
});

describe('trackStorms (real frames, 25/11/2026 15:00 UTC)', () => {
  const current = loadFixtureRaster('20261125_150000_dbz.png');
  const history = [
    { raster: loadFixtureRaster('20261125_145000_dbz.png'), minutesAgo: 10 },
    { raster: loadFixtureRaster('20261125_144000_dbz.png'), minutesAgo: 20 },
  ];

  it('finds cells and keeps every estimated speed plausible', () => {
    const started = Date.now();
    const cells = trackStorms(current, history);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(cells.length).toBeGreaterThan(20);
    for (const c of cells) {
      if (c.motion) expect(c.motion.speedKmh).toBeLessThanOrEqual(95);
    }
  });

  it('matches the observed general drift (storms east of the city moving east)', () => {
    const general = overallMotion(trackStorms(current, history));
    expect(general).not.toBeNull();
    expect(general!.towards).toBeGreaterThan(45);
    expect(general!.towards).toBeLessThan(135);
  });
});

describe('threatFor', () => {
  const me = { lat: -32.89, lng: -68.84 };
  const at = (km: number, bearing: number) => ({
    lat: me.lat + (km * Math.cos((bearing * Math.PI) / 180)) / 110.9,
    lng: me.lng + (km * Math.sin((bearing * Math.PI) / 180)) / (111.32 * Math.cos((me.lat * Math.PI) / 180)),
  });
  const cell = (km: number, bearing: number, towards: number, speedKmh: number, maxDbz = 54): StormCell => ({
    id: 'c',
    ...at(km, bearing),
    maxDbz,
    areaKm2: 60,
    radiusKm: Math.sqrt(60 / Math.PI),
    motion: speedKmh ? { speedKmh, towards } : null,
  });

  it('detects a storm coming straight at the point and estimates arrival', () => {
    const t = threatFor([cell(20, 225, 45, 40)], me)!;
    expect(t.trend).toBe('approaching');
    expect(t.etaMin).toBeGreaterThanOrEqual(15);
    expect(t.etaMin).toBeLessThanOrEqual(30);
  });

  it('distinguishes passing, receding and steady storms', () => {
    expect(threatFor([cell(20, 225, 0, 40)], me)!.trend).toBe('passing');
    expect(threatFor([cell(20, 225, 225, 35)], me)!.trend).toBe('receding');
    expect(threatFor([cell(20, 225, 0, 0)], me)!.trend).toBe('steady');
  });

  it('ignores weak cells and prefers the one that arrives first', () => {
    expect(threatFor([cell(10, 0, 180, 30, 40)], me)).toBeNull();
    const t = threatFor([cell(8, 90, 90, 20), cell(30, 225, 45, 60)], me)!;
    expect(t.trend).toBe('approaching');
  });
});
