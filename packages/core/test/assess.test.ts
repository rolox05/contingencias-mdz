import { describe, expect, it } from 'vitest';

import { assessPlace, trackStorms, type DataSources, type PointForecast } from '../src';
import { loadFixtureRaster } from './helpers';

const LATEST = Date.UTC(2026, 10, 25, 15, 0);

function fixtureSources(overrides: Partial<DataSources> = {}): DataSources {
  const dbz = loadFixtureRaster('20261125_150000_dbz.png');
  const cells = trackStorms(dbz, [
    { raster: loadFixtureRaster('20261125_145000_dbz.png'), minutesAgo: 10 },
    { raster: loadFixtureRaster('20261125_144000_dbz.png'), minutesAgo: 20 },
  ]);
  const hour = { time: '2026-11-25T12:00', temp: 24, rainMm: 0, rainProb: 20, code: 2, windKmh: 10, gustKmh: 20, windDir: 45, humidity: 40, cape: 0 };
  const forecast: PointForecast = { current: hour, hours: [hour] };
  return {
    radar: async () => ({
      frames: [{ key: '20261125150000', time: LATEST, folder: '20261125', dbz: 'x', hail: 'y', hailSwath: null }],
      rasters: { dbz, hail: loadFixtureRaster('20261125_150000_granizo.png'), cells },
    }),
    strikes: async () => [{ id: 1, lat: -32.95, lng: -68.85, energy: 10, time: LATEST - 60_000 }],
    forecast: async () => forecast,
    alerts: async () => ({ alerts: [], complete: true }),
    ...overrides,
  };
}

describe('assessPlace', () => {
  it('combines injected sources into a risk with measurements and source status', async () => {
    const realNow = Date.now;
    Date.now = () => LATEST + 5 * 60_000;
    try {
      const a = await assessPlace({ lat: -32.89, lng: -68.84 }, fixtureSources());
      expect([0, 1, 2, 3]).toContain(a.risk.level);
      expect(a.risk.hazards.map((h) => h.key)).toEqual(['hail', 'rain', 'lightning', 'wind']);
      expect(a.radar.covered).toBe(true);
      expect(a.radar.fresh).toBe(true);
      expect(a.lightning?.within10).toBe(1);
      expect(a.sources.radar).toEqual({ ok: true, observedAt: LATEST });
      expect(a.sources.alerts.complete).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it('keeps going when a source fails, and reports it', async () => {
    const a = await assessPlace(
      { lat: -32.89, lng: -68.84 },
      fixtureSources({ alerts: async () => Promise.reject(new Error('down')), strikes: async () => Promise.reject(new Error('down')) }),
    );
    expect(a.sources.alerts.ok).toBe(false);
    expect(a.sources.lightning.ok).toBe(false);
    expect(a.lightning).toBeNull();
    expect(a.radar.dbz).not.toBeNull();
  });
});
