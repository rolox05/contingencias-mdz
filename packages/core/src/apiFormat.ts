import type { SmnAlert } from './smn';

/**
 * Alerta tal como la publica la API de Alerta Mendoza (`GET /v1/alerts`).
 * Solo los campos que hacen falta para reconstruir la alerta del núcleo.
 */
export type ApiAlert = {
  id: string;
  kind: SmnAlert['kind'];
  event: string;
  level: 1 | 2 | 3;
  immediate: boolean;
  sent: string;
  onset: string;
  expires: string;
  description: string;
  instruction: string;
  areaDescription: string;
  geometry: { type: 'MultiPolygon'; coordinates: [number, number][][][] };
  source: string;
};

/** Alerta de la API (ISO, GeoJSON [lng, lat]) → alerta del núcleo (ms, polígonos [lat, lng]). */
export function alertFromApi(a: ApiAlert): SmnAlert {
  return {
    id: a.id,
    kind: a.kind,
    event: a.event,
    level: a.level,
    immediate: a.immediate,
    sent: Date.parse(a.sent),
    onset: Date.parse(a.onset),
    expires: Date.parse(a.expires),
    description: a.description,
    instruction: a.instruction,
    areaDesc: a.areaDescription,
    polygons: a.geometry.coordinates.map(([ring]) => {
      const points = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
      // GeoJSON cierra el anillo repitiendo el primer punto; el núcleo no lo necesita.
      const [first, last] = [points[0], points[points.length - 1]];
      return points.length > 3 && first[0] === last[0] && first[1] === last[1] ? points.slice(0, -1) : points;
    }),
    url: a.source,
  };
}
