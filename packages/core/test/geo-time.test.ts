import { describe, expect, it } from 'vitest';

import {
  bearingDeg,
  compass,
  describePlace,
  distanceKm,
  formatKm,
  formatTime,
  pointInPolygon,
  utcClockToLocal,
} from '../src';

const MENDOZA = { lat: -32.8895, lng: -68.8458 };
const SAN_RAFAEL = { lat: -34.6177, lng: -68.3301 };

describe('geo', () => {
  it('measures distances on the sphere', () => {
    expect(distanceKm(MENDOZA, SAN_RAFAEL)).toBeGreaterThan(190);
    expect(distanceKm(MENDOZA, SAN_RAFAEL)).toBeLessThan(205);
    expect(distanceKm(MENDOZA, MENDOZA)).toBe(0);
  });

  it('computes bearings and compass names', () => {
    expect(compass(bearingDeg(MENDOZA, SAN_RAFAEL))).toBe('sur');
    expect(compass(bearingDeg(MENDOZA, { lat: -32.88, lng: -67.8 }))).toBe('este');
    expect(compass(359)).toBe('norte');
  });

  it('tests points against polygons given as [lat, lng]', () => {
    const square: [number, number][] = [
      [-32.7, -69.2],
      [-32.7, -68.6],
      [-33.1, -68.6],
      [-33.1, -69.2],
    ];
    expect(pointInPolygon(MENDOZA, square)).toBe(true);
    expect(pointInPolygon(SAN_RAFAEL, square)).toBe(false);
  });

  it('formats distances for people', () => {
    expect(formatKm(0.4)).toBe('menos de 1 km');
    expect(formatKm(8)).toBe('8 km');
    expect(formatKm(8.46)).toBe('8,5 km');
    expect(formatKm(36.7)).toBe('37 km');
  });

  it('describes a point by its nearest locality', () => {
    expect(describePlace(MENDOZA)).toBe('Ciudad de Mendoza');
    expect(describePlace({ lat: -33.7, lng: -69.0 })).toMatch(/^a [\d,]+ km de San Carlos$/);
    expect(describePlace({ lat: -20, lng: -60 })).toBe('fuera de Mendoza');
  });
});

describe('time (Mendoza is UTC-3 all year)', () => {
  it('formats epoch times in Mendoza local time', () => {
    expect(formatTime(Date.UTC(2026, 10, 25, 15, 4))).toBe('12:04');
    expect(formatTime(Date.UTC(2026, 10, 25, 1, 30))).toBe('22:30');
  });

  it('converts UTC clock strings to local clock strings', () => {
    expect(utcClockToLocal('16:30')).toBe('13:30');
    expect(utcClockToLocal('01:15')).toBe('22:15');
  });
});
