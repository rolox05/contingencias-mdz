import { describe, expect, it } from 'vitest';

import { forecastFor, forecastIsStale, pointKey, storeForecast, type ForecastCache } from '../src';

const MENDOZA = { lat: -32.8895, lng: -68.8458 };
const MALARGUE = { lat: -35.4756, lng: -69.5844 };

describe('forecast cache by place', () => {
  it('never returns another place\'s forecast', () => {
    let cache: ForecastCache<string> = {};
    cache = storeForecast(cache, pointKey(MENDOZA), 'mendoza', 1000);
    expect(forecastFor(cache, MENDOZA)).toBe('mendoza');
    expect(forecastFor(cache, MALARGUE)).toBeNull();
  });

  it('ignores the order responses arrive in: a late answer for the old place does not replace the new one', () => {
    let cache: ForecastCache<string> = {};
    // Se cambia a Malargüe; su pronóstico llega primero y el de Mendoza (pedido antes) llega después.
    cache = storeForecast(cache, pointKey(MALARGUE), 'malargue', 2000);
    cache = storeForecast(cache, pointKey(MENDOZA), 'mendoza (viejo)', 2100);
    expect(forecastFor(cache, MALARGUE)).toBe('malargue');
  });

  it('knows when a place needs a new forecast and keeps only recent places', () => {
    let cache: ForecastCache<number> = {};
    expect(forecastIsStale(cache, MENDOZA, 0, 600_000)).toBe(true);
    cache = storeForecast(cache, pointKey(MENDOZA), 1, 1000);
    expect(forecastIsStale(cache, MENDOZA, 1000 + 599_000, 600_000)).toBe(false);
    expect(forecastIsStale(cache, MENDOZA, 1000 + 600_000, 600_000)).toBe(true);

    for (let i = 0; i < 10; i++) cache = storeForecast(cache, `p${i}`, i, 2000 + i, 4);
    expect(Object.keys(cache).sort()).toEqual(['p6', 'p7', 'p8', 'p9']);
  });
});
