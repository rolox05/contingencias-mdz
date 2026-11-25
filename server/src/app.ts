import {
  bearingDeg,
  DBZ_PALETTE,
  describePlace,
  distanceKm,
  HAIL_PALETTE,
  LOCALITIES,
  overallMotion,
  RADAR_BOUNDS,
  alertsForPlace,
  assessPlace,
} from '@alerta/core';
import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, type z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';

import type { TtlCache } from './cache';
import {
  AlertsQuery,
  AlertsResponse,
  ErrorSchema,
  ForecastResponse,
  HailZonesResponse,
  LightningQuery,
  LightningResponse,
  LocationQuery,
  LocationResponse,
  PlacesResponse,
  RadarFramesResponse,
  RiskSchema,
  StormsResponse,
} from './schemas';
import {
  alertOut,
  ATTRIBUTION,
  hailZoneOut,
  hourOut,
  iso,
  locationOut,
  riskOut,
  stormFeature,
  type ResolvedLocation,
} from './serialize';
import type { ServerSources } from './sources';
import { registerSubscriptionRoutes, type SubscriptionOptions } from './subscriptions/routes';

/** Zona donde los datos tienen sentido: Mendoza y alrededores. */
const SERVICE_AREA = { south: -39, north: -30, west: -72, east: -64.5 };

type ErrorCode = z.infer<typeof ErrorSchema>['error']['code'];

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 404 | 422 | 429 | 502,
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Ubicación a partir de lat/lng o del nombre de una localidad. */
export function resolveLocation(q: { lat?: number; lng?: number; place?: string }): ResolvedLocation {
  if (q.place) {
    const locality = LOCALITIES.find((l) => normalize(l.name) === normalize(q.place!));
    if (!locality) throw new ApiError(404, 'UNKNOWN_PLACE', `Localidad desconocida: ${q.place}. Ver /v1/places.`);
    return { lat: locality.lat, lng: locality.lng, label: locality.name };
  }
  if (q.lat === undefined || q.lng === undefined) {
    throw new ApiError(400, 'INVALID_PARAMS', 'Indicá lat y lng, o place.');
  }
  const p = { lat: q.lat, lng: q.lng };
  if (p.lat < SERVICE_AREA.south || p.lat > SERVICE_AREA.north || p.lng < SERVICE_AREA.west || p.lng > SERVICE_AREA.east) {
    throw new ApiError(422, 'OUT_OF_AREA', 'El servicio cubre Mendoza y alrededores.');
  }
  return { ...p, label: describePlace(p) };
}

const errorResponses = {
  400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Parámetros inválidos' },
  404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Localidad desconocida' },
  422: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Fuera del área del servicio' },
  502: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Fuente oficial no disponible' },
};

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});

export type AppOptions = {
  sources: ServerSources;
  cache?: TtlCache;
  /** Para informar en /health cuánto se usó del tope de Open-Meteo. */
  forecastBudget?: { used(): Record<string, number> };
  version?: string;
  /** Si se indica, se habilitan las suscripciones con webhooks. */
  subscriptions?: SubscriptionOptions;
};

export function createApp({ sources, cache, forecastBudget, version = '1.0.0', subscriptions }: AppOptions) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        const message = result.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; ');
        return c.json({ error: { code: 'INVALID_PARAMS' as const, message } }, 400);
      }
    },
  });

  app.use('*', cors());
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    console.error(err);
    return c.json({ error: { code: 'INTERNAL' as const, message: 'Error interno' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND' as const, message: 'Ruta inexistente. Ver /docs.' } }, 404));

  // ---------- Riesgo ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/risk',
      tags: ['Riesgo'],
      summary: 'Riesgo de granizo, tormenta, rayos y viento en un punto',
      description:
        'Combina radar, rayos, alertas del SMN y pronóstico. Revisá `dataQuality`: si el radar no está fresco ' +
        'o las alertas están incompletas, el nivel puede subestimar el riesgo.',
      request: { query: LocationQuery },
      responses: { ...json(RiskSchema, 'Evaluación de riesgo'), ...errorResponses },
    }),
    async (c) => {
      const place = resolveLocation(c.req.valid('query'));
      const assessment = await assessPlace(place, sources);
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(riskOut(place, assessment), 200);
    },
  );

  // ---------- Alertas ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/alerts',
      tags: ['Alertas'],
      summary: 'Alertas y avisos vigentes del SMN que alcanzan a Mendoza',
      description: 'Con lat/lng (o place) cada alerta indica si cubre la ubicación y a qué distancia está.',
      request: { query: AlertsQuery },
      responses: { ...json(AlertsResponse, 'Alertas vigentes'), ...errorResponses },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const place = q.lat !== undefined || q.lng !== undefined || q.place ? resolveLocation(q) : undefined;
      let result;
      try {
        result = await sources.alerts();
      } catch {
        throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'No se pudieron consultar las alertas del SMN.');
      }
      const now = Date.now();
      let alerts = result.alerts.filter((a) => a.expires > now);
      if (place && q.coveringOnly === 'true') alerts = alertsForPlace(alerts, place, now);
      c.header('Cache-Control', 'public, max-age=120');
      return c.json(
        {
          generatedAt: iso(now)!,
          complete: result.complete,
          alerts: alerts.map((a) => alertOut(a, now, place)),
          attribution: ATTRIBUTION,
        },
        200,
      );
    },
  );

  // ---------- Tormentas ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/storms',
      tags: ['Radar'],
      summary: 'Celdas de tormenta de la última pasada del radar, con su movimiento',
      description:
        'GeoJSON. El movimiento se mide comparando con las pasadas de ~10 y ~20 minutos antes; ' +
        '`motion` es null si no se pudo estimar con confianza. Es una extrapolación.',
      responses: { ...json(StormsResponse, 'Celdas de tormenta'), ...errorResponses },
    }),
    async (c) => {
      let snapshot;
      try {
        snapshot = await sources.radar();
      } catch {
        throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'No se pudo consultar el radar.');
      }
      const latest = snapshot.frames[snapshot.frames.length - 1];
      const general = overallMotion(snapshot.rasters.cells);
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(
        {
          type: 'FeatureCollection' as const,
          observedAt: iso(latest?.time),
          overallMotion: general ? { speedKmh: Math.round(general.speedKmh), towardsDeg: Math.round(general.towards) } : null,
          features: snapshot.rasters.cells.filter((cell) => cell.maxDbz >= 40).map(stormFeature),
          attribution: ATTRIBUTION,
        },
        200,
      );
    },
  );

  // ---------- Rayos ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/lightning',
      tags: ['Radar'],
      summary: 'Rayos de los últimos minutos alrededor de un punto',
      request: { query: LightningQuery },
      responses: { ...json(LightningResponse, 'Rayos cercanos'), ...errorResponses },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const place = resolveLocation(q);
      let strikes;
      try {
        strikes = await sources.strikes();
      } catch {
        throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'No se pudieron consultar los rayos.');
      }
      const near = strikes
        .map((s) => ({ s, km: distanceKm(place, s) }))
        .filter((x) => x.km <= q.radiusKm)
        .sort((a, b) => a.km - b.km);
      c.header('Cache-Control', 'public, max-age=30');
      return c.json(
        {
          location: locationOut(place),
          radiusKm: q.radiusKm,
          observedAt: iso(strikes.length ? Math.max(...strikes.map((s) => s.time)) : null),
          count: near.length,
          strikes: near.slice(0, 500).map(({ s, km }) => ({
            lat: s.lat,
            lng: s.lng,
            time: iso(s.time)!,
            energy: s.energy,
            distanceKm: Math.round(km * 10) / 10,
            bearingDeg: Math.round(bearingDeg(place, s)),
          })),
          attribution: ATTRIBUTION,
        },
        200,
      );
    },
  );

  // ---------- Pronóstico ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/forecast',
      tags: ['Pronóstico'],
      summary: 'Pronóstico provincial de la DCC (5 días) y por hora para el punto (24 h)',
      request: { query: LocationQuery },
      responses: { ...json(ForecastResponse, 'Pronóstico'), ...errorResponses },
    }),
    async (c) => {
      const place = resolveLocation(c.req.valid('query'));
      const [daily, point] = await Promise.all([
        sources.dccForecast().catch(() => []),
        sources.forecast(place).catch(() => null),
      ]);
      if (!point && daily.length === 0) {
        throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'No se pudo consultar el pronóstico.');
      }
      c.header('Cache-Control', 'public, max-age=600');
      return c.json(
        {
          location: locationOut(place),
          daily: daily.map((d) => ({
            date: d.date,
            text: d.text,
            maxC: d.max,
            minC: d.min,
            alert: d.alert === 2 ? ('red' as const) : d.alert === 1 ? ('yellow' as const) : ('none' as const),
          })),
          hourly: point ? point.hours.map(hourOut) : [],
          attribution: ATTRIBUTION,
        },
        200,
      );
    },
  );

  // ---------- Pasadas del radar ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/radar/frames',
      tags: ['Radar'],
      summary: 'Imágenes del radar de los últimos ~45 minutos, con su ubicación y paletas',
      description: 'PNG de 500 x 700 px en proyección Web Mercator dentro de `bounds`.',
      responses: { ...json(RadarFramesResponse, 'Pasadas del radar'), ...errorResponses },
    }),
    async (c) => {
      let snapshot;
      try {
        snapshot = await sources.radar();
      } catch {
        throw new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'No se pudo consultar el radar.');
      }
      const palette = (p: typeof DBZ_PALETTE) =>
        [...p].reverse().map((e) => ({ rgb: [e.r, e.g, e.b] as [number, number, number], fromValue: e.value }));
      c.header('Cache-Control', 'public, max-age=60');
      return c.json(
        {
          frames: snapshot.frames.map((f) => ({
            time: iso(f.time)!,
            reflectivityUrl: f.dbz,
            hailProbabilityUrl: f.hail,
            hailSwathUrl: f.hailSwath,
          })),
          bounds: RADAR_BOUNDS,
          projection: 'EPSG:3857',
          palettes: { reflectivityDbz: palette(DBZ_PALETTE), hailProbabilityPct: palette(HAIL_PALETTE) },
          attribution: ATTRIBUTION,
        },
        200,
      );
    },
  );

  // ---------- Granizo del día ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/hail/today',
      tags: ['Radar'],
      summary: 'Zonas donde el radar detectó granizo hoy (reporte experimental de la DCC)',
      responses: { ...json(HailZonesResponse, 'Zonas con granizo'), ...errorResponses },
    }),
    async (c) => {
      const folder = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const zones = await sources.hailZones(folder).catch(() => []);
      c.header('Cache-Control', 'public, max-age=120');
      return c.json(
        {
          date: `${folder.slice(0, 4)}-${folder.slice(4, 6)}-${folder.slice(6, 8)}`,
          zones: zones.map((z) => hailZoneOut(folder, z)),
          attribution: ATTRIBUTION,
        },
        200,
      );
    },
  );

  // ---------- Ubicación ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/location',
      tags: ['Referencia'],
      summary: 'Valida una ubicación (lat/lng o place) y devuelve su nombre y si está en la cobertura del radar',
      request: { query: LocationQuery },
      responses: { ...json(LocationResponse, 'Ubicación resuelta'), ...errorResponses },
    }),
    (c) => c.json({ location: locationOut(resolveLocation(c.req.valid('query'))) }, 200),
  );

  // ---------- Localidades ----------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/places',
      tags: ['Referencia'],
      summary: 'Localidades que se pueden usar en el parámetro `place`',
      responses: json(PlacesResponse, 'Localidades'),
    }),
    (c) => c.json({ places: LOCALITIES.map((l) => ({ name: l.name, lat: l.lat, lng: l.lng })) }, 200),
  );

  // ---------- Suscripciones y webhooks ----------
  if (subscriptions) registerSubscriptionRoutes(app, subscriptions, { ApiError, resolveLocation });

  // ---------- Documentación y estado ----------
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Alerta Mendoza API',
      version,
      description:
        'Riesgo climático en Mendoza (granizo, tormentas, rayos, viento y Zonda) a partir de datos públicos ' +
        'de Contingencias Climáticas y el SMN, con caché propia para no sobrecargar las fuentes oficiales. ' +
        'Servicio no oficial.',
    },
  });
  app.get('/docs', swaggerUI({ url: '/openapi.json' }));
  app.get('/', (c) => c.redirect('/docs'));
  app.get('/health', (c) =>
    c.json({ ok: true, version, cache: cache?.stats() ?? {}, openMeteoCalls: forecastBudget?.used() ?? null }),
  );

  return app;
}
