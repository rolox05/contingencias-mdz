import { describe, expect, it } from 'vitest';

import { computeRisk, type PointForecast, type RasterScan, type RiskInput, type SmnAlert } from '../src';

const NOW = Date.UTC(2026, 10, 25, 18, 0);
const scan = (here: number | null, within: (number | null)[], nearest: RasterScan['nearest'] = null): RasterScan => ({
  here,
  within: { 3: within[0], 10: within[1], 25: within[2], 50: within[3] },
  nearest,
});
const empty = () => scan(null, [null, null, null, null]);
const forecast = (gust: number, dir: number, humidity: number, code = 1, mm = 0): PointForecast => {
  const h = { time: '', temp: 20, rainMm: mm, rainProb: 10, code, windKmh: gust / 2, gustKmh: gust, windDir: dir, humidity, cape: 0 };
  return { current: h, hours: [h, h, h, h] };
};
const noLightning = { nearestKm: null, nearestBearing: null, within10: 0, within25: 0, within50: 0 };
const base = (over: Partial<RiskInput>): RiskInput => ({
  now: NOW,
  radar: { covered: true, fresh: true, dbz: empty(), hail: empty(), threat: null },
  lightning: noLightning,
  alerts: [],
  forecast: forecast(15, 180, 50),
  ...over,
});

describe('computeRisk', () => {
  it('is green when nothing is around', () => {
    const r = computeRisk(base({}));
    expect(r.level).toBe(0);
    expect(r.hazards.every((h) => h.level === 0)).toBe(true);
  });

  it('is red with hail overhead', () => {
    const r = computeRisk(
      base({
        radar: {
          covered: true,
          fresh: true,
          dbz: scan(60, [60, 60, 60, 60], { km: 0.5, bearing: 0, value: 60 }),
          hail: scan(90, [90, 90, 90, 90], { km: 0.4, bearing: 0, value: 90 }),
          threat: null,
        },
      }),
    );
    expect(r.level).toBe(3);
    expect(r.headline).toBe('Granizo sobre tu zona');
    expect(r.advice.length).toBeGreaterThan(0);
  });

  it('raises the level for a strong storm arriving soon', () => {
    const r = computeRisk(
      base({
        radar: {
          covered: true,
          fresh: true,
          dbz: scan(null, [null, null, 54, 54], { km: 16, bearing: 225, value: 54 }),
          hail: empty(),
          threat: { km: 16, bearing: 225, value: 54, motion: { speedKmh: 40, towards: 45 }, trend: 'approaching', etaMin: 20 },
        },
      }),
    );
    const rain = r.hazards.find((h) => h.key === 'rain')!;
    expect(rain.level).toBe(2);
    expect(rain.summary).toMatch(/viene hacia vos a 40 km\/h; podría llegar en unos 20 min/);
  });

  it('uses an official Zonda alert as the headline', () => {
    const zonda: SmnAlert = {
      id: 'z', kind: 'zonda', event: 'Viento Zonda', level: 2, immediate: false, sent: NOW,
      onset: NOW - 3600_000, expires: NOW + 3600_000, description: '', instruction: '', areaDesc: '', polygons: [], url: '',
    };
    const r = computeRisk(base({ alerts: [zonda], forecast: forecast(75, 290, 12) }));
    expect(r.level).toBe(2);
    expect(r.headline).toBe('Alerta por viento Zonda');
  });

  it('flags Zonda-like conditions without an alert', () => {
    const r = computeRisk(base({ forecast: forecast(48, 280, 15) }));
    expect(r.level).toBe(1);
    expect(r.headline).toBe('Posible viento Zonda');
  });

  it('falls back to the forecast and says so when the radar is stale', () => {
    const r = computeRisk(
      base({ radar: { covered: true, fresh: false, dbz: null, hail: null, threat: null }, lightning: null, forecast: forecast(30, 90, 70, 95, 6) }),
    );
    expect(r.level).toBe(1);
    expect(r.notes[0]).toMatch(/radar no tiene datos recientes/);
  });

  it('notes when the point is outside radar coverage', () => {
    const r = computeRisk(base({ radar: { covered: false, fresh: true, dbz: null, hail: null, threat: null } }));
    expect(r.notes[0]).toMatch(/fuera de la cobertura/);
  });

  it('rates lightning by distance', () => {
    const at = (km: number) => computeRisk(base({ lightning: { ...noLightning, nearestKm: km, nearestBearing: 0, within50: 3 } }));
    expect(at(3).level).toBe(3);
    expect(at(10).level).toBe(2);
    expect(at(30).level).toBe(1);
  });
});
