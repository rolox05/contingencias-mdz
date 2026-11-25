import type { SmnAlert } from '@alerta/core';

import type { ServerSources } from '../src/sources';

/** Datos de prueba compartidos por los tests de la API y del servidor MCP. */
const NOW = Date.now();
const H = 3600_000;

export const zonda: SmnAlert = {
  id: 'zonda-1',
  kind: 'zonda',
  event: 'Viento Zonda',
  level: 2,
  immediate: false,
  sent: NOW - H,
  onset: NOW - H,
  expires: NOW + 4 * H,
  description: 'Ráfagas de 70 km/h.',
  instruction: 'No enciendas fuego.',
  areaDesc: '',
  polygons: [[[-32.7, -69.2], [-32.7, -68.6], [-33.1, -68.6], [-33.1, -69.2]]],
  url: 'https://ssl.smn.gob.ar/feeds/CAP/test.xml',
};

export function fakeSources(over: Partial<ServerSources> = {}): ServerSources {
  const hour = { time: '2026-11-25T12:00', temp: 24, rainMm: 0, rainProb: 20, code: 2, windKmh: 30, gustKmh: 75, windDir: 290, humidity: 12, cape: 0 };
  return {
    radar: async () => ({
      frames: [{ key: 'k', time: NOW - 2 * 60_000, folder: '20261125', dbz: 'https://r/dbz.png', hail: null, hailSwath: null }],
      rasters: {
        dbz: null,
        hail: null,
        cells: [
          { id: 'a', lat: -33.0, lng: -68.5, maxDbz: 54, areaKm2: 60, radiusKm: 4.4, motion: { speedKmh: 40, towards: 90 } },
          { id: 'b', lat: -33.5, lng: -68.0, maxDbz: 35, areaKm2: 20, radiusKm: 2.5, motion: null },
        ],
      },
    }),
    strikes: async () => [
      { id: 1, lat: -33.1, lng: -68.85, energy: 20, time: NOW - 60_000 }, // ~19 km de Godoy Cruz
      { id: 2, lat: -34.6, lng: -68.3, energy: 10, time: NOW - 30_000 },
    ],
    forecast: async () => ({ current: hour, hours: [hour, hour] }),
    alerts: async () => ({ alerts: [zonda], complete: true }),
    dccForecast: async () => [{ date: '2026-11-25', text: 'Zonda en cordillera.', max: 31, min: 17, alert: 1, icon: '' }],
    stations: async () => [],
    hailZones: async () => [{ department: 'La Paz', place: 'Pampita', areaKm2: 287, probMax: 95, startUtc: '19:30', endUtc: '20:00' }],
    ...over,
  };
}

