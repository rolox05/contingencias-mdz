import { distanceKm, formatKm, type LatLng } from './geo';

export type Locality = LatLng & { name: string };

/** Cabeceras departamentales y localidades de referencia de Mendoza. */
export const LOCALITIES: Locality[] = [
  { name: 'Ciudad de Mendoza', lat: -32.8895, lng: -68.8458 },
  { name: 'Godoy Cruz', lat: -32.9253, lng: -68.8456 },
  { name: 'Guaymallén', lat: -32.8983, lng: -68.7873 },
  { name: 'Las Heras', lat: -32.8508, lng: -68.8417 },
  { name: 'Luján de Cuyo', lat: -33.0358, lng: -68.8778 },
  { name: 'Maipú', lat: -32.9839, lng: -68.7908 },
  { name: 'Lavalle', lat: -32.7228, lng: -68.5933 },
  { name: 'San Martín', lat: -33.0811, lng: -68.4708 },
  { name: 'Junín', lat: -33.1444, lng: -68.4928 },
  { name: 'Rivadavia', lat: -33.1908, lng: -68.4639 },
  { name: 'Santa Rosa', lat: -33.2536, lng: -68.1519 },
  { name: 'La Paz', lat: -33.4611, lng: -67.5503 },
  { name: 'Tupungato', lat: -33.3714, lng: -69.1483 },
  { name: 'Tunuyán', lat: -33.5786, lng: -69.0156 },
  { name: 'San Carlos', lat: -33.7731, lng: -69.0458 },
  { name: 'San Rafael', lat: -34.6177, lng: -68.3301 },
  { name: 'General Alvear', lat: -34.9767, lng: -67.6911 },
  { name: 'Malargüe', lat: -35.4756, lng: -69.5844 },
  { name: 'Uspallata', lat: -32.5931, lng: -69.3456 },
  { name: 'Potrerillos', lat: -32.9589, lng: -69.1989 },
  { name: 'Las Leñas', lat: -35.1497, lng: -70.0833 },
];

export const DEFAULT_LOCALITY = LOCALITIES[0];

/** Caja aproximada de la provincia de Mendoza. */
export const MENDOZA_BOX = { south: -37.6, north: -32.0, west: -70.65, east: -66.5 };

export function inMendozaBox(p: LatLng): boolean {
  return (
    p.lat >= MENDOZA_BOX.south &&
    p.lat <= MENDOZA_BOX.north &&
    p.lng >= MENDOZA_BOX.west &&
    p.lng <= MENDOZA_BOX.east
  );
}

export function nearestLocality(p: LatLng): { locality: Locality; km: number } {
  let best = LOCALITIES[0];
  let bestKm = Infinity;
  for (const l of LOCALITIES) {
    const km = distanceKm(p, l);
    if (km < bestKm) {
      bestKm = km;
      best = l;
    }
  }
  return { locality: best, km: bestKm };
}

/** Texto corto para describir un punto: "Godoy Cruz" o "a 14 km de Tunuyán". */
export function describePlace(p: LatLng): string {
  const { locality, km } = nearestLocality(p);
  if (km <= 6) return locality.name;
  if (km <= 150) return `a ${formatKm(km)} de ${locality.name}`;
  return 'fuera de Mendoza';
}
