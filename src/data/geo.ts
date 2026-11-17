export type LatLng = { lat: number; lng: number };

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rumbo desde `from` hacia `to`, en grados (0 = norte, 90 = este). */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['norte', 'noreste', 'este', 'sudeste', 'sur', 'sudoeste', 'oeste', 'noroeste'];
const COMPASS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function compassShort(deg: number): string {
  return COMPASS_SHORT[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Polígono como lista de [lat, lng]. */
export type Polygon = [number, number][];

export function pointInPolygon(p: LatLng, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [latI, lngI] = poly[i];
    const [latJ, lngJ] = poly[j];
    if (
      lngI > p.lng !== lngJ > p.lng &&
      p.lat < ((latJ - latI) * (p.lng - lngI)) / (lngJ - lngI) + latI
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function formatKm(km: number): string {
  if (km < 1) return 'menos de 1 km';
  if (km < 10) return `${km.toFixed(1).replace('.0', '').replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}
