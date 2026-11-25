import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  alertCovers,
  alertLocalities,
  configureHttp,
  configureSmnStore,
  fetchSmnAlerts,
  groupAlerts,
  type KeyValueStore,
} from '../src';
import { fakeFetch, fixturePath } from './helpers';

const MENDOZA = { lat: -32.8895, lng: -68.8458 };
const SAN_RAFAEL = { lat: -34.6177, lng: -68.3301 };
// Entre la emisión de los fixtures y su vencimiento.
const NOW = Date.UTC(2026, 10, 25, 23, 30);

function serveFixtures(overrides: Record<string, number> = {}) {
  return fakeFetch((url) => {
    if (url.includes('/CAP/AR.php')) return { body: readFileSync(fixturePath('smn', 'index.html'), 'utf8') };
    const name = basename(url.split('?')[0]);
    if (overrides[name]) return { status: overrides[name], body: '' };
    try {
      return { body: readFileSync(fixturePath('smn', name), 'utf8') };
    } catch {
      return null;
    }
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  configureSmnStore(null);
});

afterEach(() => {
  vi.useRealTimers();
  configureHttp({ fetch: undefined });
});

describe('fetchSmnAlerts', () => {
  it('keeps only alerts that reach Mendoza, deduplicating batches', async () => {
    const requested = serveFixtures();
    const { alerts, complete } = await fetchSmnAlerts();

    expect(complete).toBe(true);
    expect(alerts.map((a) => a.kind).sort()).toEqual(['tormenta', 'tormenta', 'zonda']);
    // Los lotes "Llanura" y "Patagonia" con el mismo número se piden una sola vez.
    expect(requested.filter((u) => u.includes('_alertas_64.xml'))).toHaveLength(1);
    // Los avisos a corto plazo que no nombran a Mendoza ni se descargan.
    expect(requested.some((u) => u.includes('2026_11_25_2300'))).toBe(false);
  });

  it('reads feed times as UTC even though they are labelled -03:00', async () => {
    serveFixtures();
    const { alerts } = await fetchSmnAlerts();
    const zonda = alerts.find((a) => a.kind === 'zonda')!;
    expect(zonda.onset).toBe(Date.UTC(2026, 10, 26, 15, 0, 0));
    expect(zonda.expires).toBe(Date.UTC(2026, 10, 26, 20, 59, 59));
    expect(zonda.level).toBe(1);
    expect(zonda.description).toContain('ráfagas');
  });

  it('parses short-term notices (cap: prefix) as immediate and severe', async () => {
    serveFixtures();
    const { alerts } = await fetchSmnAlerts();
    const notice = alerts.find((a) => a.immediate)!;
    expect(notice.level).toBe(2);
    expect(notice.event).toMatch(/granizo/i);
    expect(alertCovers(notice, MENDOZA)).toBe(true);
    expect(alertCovers(notice, SAN_RAFAEL)).toBe(false);
  });

  it('drops expired alerts', async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 27, 0, 0));
    serveFixtures();
    const { alerts } = await fetchSmnAlerts();
    expect(alerts).toHaveLength(0);
  });

  it('reports an incomplete list and backs off when the SMN rate-limits', async () => {
    const requested = serveFixtures({ 'CAP_20261125205447_Zonda_Cordillera_alertas_alertas_1.xml': 429 });
    const first = await fetchSmnAlerts();
    expect(first.complete).toBe(false);

    // Durante el enfriamiento no se vuelve a pedir ningún archivo CAP.
    const before = requested.length;
    await fetchSmnAlerts();
    const capRequests = requested.slice(before).filter((u) => u.endsWith('.xml'));
    expect(capRequests).toHaveLength(0);
  });

  it('never downloads the same CAP file twice, using the configured store', async () => {
    const memory = new Map<string, string>();
    const store: KeyValueStore = {
      getItem: async (k) => memory.get(k) ?? null,
      setItem: async (k, v) => void memory.set(k, v),
    };
    configureSmnStore(store);
    serveFixtures();
    await fetchSmnAlerts();

    configureSmnStore(store); // simula reabrir la app
    const requested = serveFixtures();
    const { alerts } = await fetchSmnAlerts();
    expect(alerts).toHaveLength(3);
    expect(requested.filter((u) => u.endsWith('.xml'))).toHaveLength(0);
  });
});

describe('alert helpers', () => {
  it('names the localities an alert covers and groups contiguous alerts', async () => {
    serveFixtures();
    const { alerts } = await fetchSmnAlerts();
    const storm = alerts.find((a) => a.kind === 'tormenta' && !a.immediate)!;
    expect(alertLocalities(storm)).toEqual(['San Rafael']);

    const later = { ...storm, id: 'later', onset: storm.expires, expires: storm.expires + 3600_000 };
    const grouped = groupAlerts([storm, later]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].expires).toBe(later.expires);
    expect(grouped[0].polygons).toHaveLength(2);
  });
});
