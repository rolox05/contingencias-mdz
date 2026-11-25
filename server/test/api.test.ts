import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { TtlCache } from '../src/cache';
import { createCachedSources } from '../src/sources';
import { fakeSources, zonda } from './fixtures';

const NOW = Date.now();

const get = async (path: string, sources = fakeSources()) => {
  const res = await createApp({ sources }).request(path);
  return { status: res.status, body: (await res.json()) as any };
};

describe('GET /v1/risk', () => {
  it('returns level, structured measurements, alerts, data quality and attribution', async () => {
    const { status, body } = await get('/v1/risk?place=godoy%20cruz');
    expect(status).toBe(200);
    expect(body.location.label).toBe('Godoy Cruz');
    expect(body.level).toBe(2); // alerta naranja de Zonda vigente sobre el punto
    expect(body.levelName).toBe('orange');
    expect(body.text.headline).toBe('Alerta por viento Zonda');
    expect(body.hazards.map((h: any) => h.type)).toEqual(['hail', 'rain', 'lightning', 'wind']);
    expect(body.measurements.lightning.within25Km).toBe(1);
    expect(body.measurements.lightning.within10Km).toBe(0);
    expect(body.officialAlerts[0].coversLocation).toBe(true);
    expect(body.officialAlerts[0].geometry.coordinates[0][0][0]).toEqual([-69.2, -32.7]); // [lng, lat]
    expect(body.dataQuality.radar.fresh).toBe(true);
    expect(body.attribution.length).toBeGreaterThan(0);
    expect(body.disclaimer).toMatch(/no oficial/);
  });

  it('validates the location', async () => {
    expect((await get('/v1/risk')).body.error.code).toBe('INVALID_PARAMS');
    expect((await get('/v1/risk?lat=abc&lng=-68')).status).toBe(400);
    expect((await get('/v1/risk?place=Narnia')).body.error.code).toBe('UNKNOWN_PLACE');
    const far = await get('/v1/risk?lat=-34.6&lng=-58.4');
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe('OUT_OF_AREA');
  });

  it('still answers when a source is down, and says so', async () => {
    const { status, body } = await get('/v1/risk?place=Maipú', fakeSources({ alerts: () => Promise.reject(new Error('429')) }));
    expect(status).toBe(200);
    expect(body.dataQuality.alerts.ok).toBe(false);
    expect(body.officialAlerts).toEqual([]);
  });
});

describe('other endpoints', () => {
  it('lists alerts with coverage and distance', async () => {
    const { body } = await get('/v1/alerts?place=San%20Rafael');
    expect(body.complete).toBe(true);
    expect(body.alerts[0].coversLocation).toBe(false);
    expect(body.alerts[0].distanceKm).toBeGreaterThan(100);
    expect((await get('/v1/alerts?place=San%20Rafael&coveringOnly=true')).body.alerts).toEqual([]);
  });

  it('returns 502 when the SMN is unavailable for the alert list', async () => {
    const res = await get('/v1/alerts', fakeSources({ alerts: () => Promise.reject(new Error('down')) }));
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('serves storm cells as GeoJSON with a projected position', async () => {
    const { body } = await get('/v1/storms');
    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(1); // la celda de 35 dBZ se omite
    const f = body.features[0];
    expect(f.geometry.coordinates).toEqual([-68.5, -33]);
    expect(f.properties.motion).toEqual({ speedKmh: 40, towardsDeg: 90 });
    expect(f.properties.positionIn30Min[0]).toBeGreaterThan(-68.5); // hacia el este
  });

  it('filters lightning by radius and sorts by distance', async () => {
    const { body } = await get('/v1/lightning?place=Godoy%20Cruz&radiusKm=50');
    expect(body.count).toBe(1);
    expect(body.strikes[0].distanceKm).toBeGreaterThan(15);
    expect(body.strikes[0].distanceKm).toBeLessThan(25);
  });

  it('returns daily and hourly forecast with ISO UTC times', async () => {
    const { body } = await get('/v1/forecast?place=Las%20Heras');
    expect(body.daily[0].alert).toBe('yellow');
    expect(body.hourly[0].time).toBe('2026-11-25T15:00:00.000Z'); // 12:00 en Mendoza
  });

  it('describes radar frames and today hail zones', async () => {
    const frames = (await get('/v1/radar/frames')).body;
    expect(frames.projection).toBe('EPSG:3857');
    expect(frames.palettes.reflectivityDbz[0].fromValue).toBe(5);
    const hail = (await get('/v1/hail/today')).body;
    expect(hail.zones[0]).toMatchObject({ department: 'La Paz', maxProbabilityPct: 95 });
  });

  it('publishes an OpenAPI document covering every endpoint', async () => {
    const { body } = await get('/openapi.json');
    expect(body.openapi).toBe('3.1.0');
    expect(Object.keys(body.paths).sort()).toEqual([
      '/v1/alerts', '/v1/forecast', '/v1/hail/today', '/v1/lightning', '/v1/location', '/v1/places', '/v1/radar/frames', '/v1/risk', '/v1/storms',
    ]);
  });
});

describe('caching', () => {
  it('hits each upstream once per TTL no matter how many clients ask', async () => {
    const alerts = vi.fn(async () => ({ alerts: [zonda], complete: true }));
    const cached = createCachedSources(new TtlCache(), fakeSources({ alerts }));
    const app = createApp({ sources: cached });
    await Promise.all(Array.from({ length: 20 }, () => app.request('/v1/alerts')));
    expect(alerts).toHaveBeenCalledTimes(1);
  });

  it('serves the last good value when the upstream fails', async () => {
    let t = 0;
    const cache = new TtlCache(() => t);
    let fail = false;
    const load = async () => {
      if (fail) throw new Error('down');
      return 'fresh';
    };
    expect(await cache.get('k', 1000, load)).toBe('fresh');
    t = 5000;
    fail = true;
    expect(await cache.get('k', 1000, load)).toBe('fresh'); // vencido pero sirve el último bueno
    t = 50_000;
    await expect(cache.get('k', 1000, load)).rejects.toThrow('down'); // demasiado viejo
  });
});

describe('API ↔ app alert format', () => {
  it('round-trips an alert through the API and back into the core format', async () => {
    const { alertFromApi } = await import('@alerta/core');
    const { body } = await get('/v1/alerts');
    expect(alertFromApi(body.alerts[0])).toEqual(zonda);
  });
});

describe('source terms', () => {
  it('carries the exact DCC credit and source licenses in every data response', async () => {
    const { DCC_CREDIT } = await import('@alerta/core');
    for (const path of ['/v1/risk?place=Maipú', '/v1/alerts', '/v1/storms', '/v1/forecast?place=Maipú', '/v1/radar/frames']) {
      const { body } = await get(path);
      expect(body.attribution.map((a: any) => a.credit), path).toContain(DCC_CREDIT);
      expect(body.attribution.find((a: any) => /SMN/.test(a.name)).license).toMatch(/2\.5/);
    }
  });

  it('serves a robots.txt that forbids AI training, mirroring the SMN signals', async () => {
    const res = await createApp({ sources: fakeSources() }).request('/robots.txt');
    expect(await res.text()).toMatch(/Content-Signal: search=yes, ai-train=no, use=reference/);
  });
});
