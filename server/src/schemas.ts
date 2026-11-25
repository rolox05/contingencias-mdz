import { z } from '@hono/zod-openapi';

/**
 * Esquemas de la API. Se usan para validar los parámetros y para generar el
 * documento OpenAPI, así la documentación no puede desfasarse del código.
 * Convenciones: horas en ISO-8601 UTC, distancias en km, rumbos en grados
 * (0 = norte, 90 = este), coordenadas GeoJSON en orden [lng, lat].
 */

const isoTime = z.string().openapi({ format: 'date-time', example: '2026-11-25T15:00:00.000Z' });
const levelValue = z.number().int().min(0).max(3).openapi({ description: '0 verde, 1 amarillo, 2 naranja, 3 rojo' });
const levelName = z.enum(['green', 'yellow', 'orange', 'red']);
const bearing = z.number().min(0).max(360).openapi({ description: 'Grados desde el norte, en sentido horario' });

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.enum(['INVALID_PARAMS', 'UNKNOWN_PLACE', 'OUT_OF_AREA', 'UPSTREAM_UNAVAILABLE', 'NOT_FOUND', 'INTERNAL']),
      message: z.string(),
    }),
  })
  .openapi('Error');

// ---------- Parámetros ----------

export const LocationQuery = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional().openapi({ example: -32.8895 }),
    lng: z.coerce.number().min(-180).max(180).optional().openapi({ example: -68.8458 }),
    place: z.string().optional().openapi({
      description: 'Nombre de una localidad de /v1/places, en lugar de lat/lng',
      example: 'Godoy Cruz',
    }),
  })
  .openapi('LocationQuery');

export const AlertsQuery = LocationQuery.extend({
  coveringOnly: z
    .enum(['true', 'false'])
    .optional()
    .openapi({ description: 'Solo las alertas cuyo polígono contiene la ubicación' }),
});

export const LightningQuery = LocationQuery.extend({
  radiusKm: z.coerce.number().min(1).max(300).default(50).openapi({ example: 50 }),
});

// ---------- Piezas comunes ----------

const LocationSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
    label: z.string().openapi({ example: 'Godoy Cruz' }),
    inRadarCoverage: z.boolean(),
  })
  .openapi('Location');

const MultiPolygon = z
  .object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))),
  })
  .openapi('GeoJSONMultiPolygon');

export const AlertSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['tormenta', 'lluvia', 'viento', 'zonda', 'nevada', 'otro']),
    event: z.string().openapi({ example: 'Viento Zonda' }),
    level: levelValue,
    levelName,
    immediate: z.boolean().openapi({ description: 'Aviso a muy corto plazo: el fenómeno ya está ocurriendo' }),
    sent: isoTime,
    onset: isoTime,
    expires: isoTime,
    active: z.boolean(),
    description: z.string(),
    instruction: z.string(),
    areaDescription: z.string(),
    places: z.array(z.string()).openapi({ description: 'Localidades de referencia dentro de la zona' }),
    coversLocation: z.boolean().optional(),
    distanceKm: z.number().optional().openapi({ description: 'Distancia hasta la zona (0 si la ubicación está adentro)' }),
    geometry: MultiPolygon,
    source: z.string().openapi({ example: 'https://ssl.smn.gob.ar/feeds/CAP/...' }),
  })
  .openapi('Alert');

const Motion = z
  .object({ speedKmh: z.number(), towardsDeg: bearing })
  .openapi('Motion', { description: 'Velocidad y rumbo hacia donde se mueve' });

const SourceStatus = z.object({
  ok: z.boolean(),
  observedAt: isoTime.nullable(),
});

export const Attribution = z.array(z.object({ name: z.string(), url: z.string(), use: z.string() }));

// ---------- /v1/risk ----------

const ScanSchema = z.object({
  atPoint: z.number().nullable().openapi({ description: 'Valor sobre el punto (piso del rango de la paleta)' }),
  maxWithinKm: z.record(z.string(), z.number().nullable()).openapi({ example: { '3': null, '10': 45, '25': 54, '50': 57 } }),
  nearest: z
    .object({ distanceKm: z.number(), bearingDeg: bearing, value: z.number() })
    .nullable()
    .openapi({ description: 'Eco significativo más cercano' }),
});

export const RiskSchema = z
  .object({
    location: LocationSchema,
    generatedAt: isoTime,
    level: levelValue,
    levelName,
    text: z.object({
      lang: z.literal('es'),
      headline: z.string(),
      detail: z.string(),
      advice: z.array(z.string()),
    }),
    hazards: z.array(
      z.object({
        type: z.enum(['hail', 'rain', 'lightning', 'wind']),
        level: levelValue,
        levelName,
        summary: z.string().openapi({ description: 'Resumen en español' }),
      }),
    ),
    measurements: z.object({
      reflectivityDbz: ScanSchema.nullable(),
      hailProbabilityPct: ScanSchema.nullable(),
      storm: z
        .object({
          trend: z.enum(['approaching', 'passing', 'receding', 'steady']),
          distanceKm: z.number().openapi({ description: 'Hasta el borde de la celda' }),
          bearingDeg: bearing.openapi({ description: 'Desde la ubicación hacia la celda' }),
          maxDbz: z.number(),
          etaMinutes: z.number().nullable(),
          motion: Motion.nullable(),
        })
        .nullable()
        .openapi({ description: 'Tormenta intensa más relevante (45 dBZ o más, hasta 60 km)' }),
      lightning: z
        .object({
          nearestKm: z.number().nullable(),
          nearestBearingDeg: z.number().nullable(),
          within10Km: z.number(),
          within25Km: z.number(),
          within50Km: z.number(),
        })
        .nullable(),
      current: z
        .object({
          temperatureC: z.number(),
          humidityPct: z.number(),
          windKmh: z.number(),
          gustKmh: z.number(),
          windFromDeg: z.number(),
          weatherCode: z.number().openapi({ description: 'Código WMO' }),
          description: z.string(),
        })
        .nullable(),
    }),
    officialAlerts: z.array(AlertSchema),
    dataQuality: z.object({
      notes: z.array(z.string()),
      radar: SourceStatus.extend({ fresh: z.boolean() }),
      lightning: SourceStatus,
      alerts: SourceStatus.extend({ complete: z.boolean() }),
      forecast: SourceStatus,
    }),
    attribution: Attribution,
    disclaimer: z.string(),
  })
  .openapi('Risk');

// ---------- Otras respuestas ----------

export const AlertsResponse = z
  .object({ generatedAt: isoTime, complete: z.boolean(), alerts: z.array(AlertSchema), attribution: Attribution })
  .openapi('AlertList');

export const StormsResponse = z
  .object({
    type: z.literal('FeatureCollection'),
    observedAt: isoTime.nullable(),
    overallMotion: Motion.nullable(),
    features: z.array(
      z.object({
        type: z.literal('Feature'),
        geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
        properties: z.object({
          maxDbz: z.number(),
          areaKm2: z.number(),
          radiusKm: z.number(),
          motion: Motion.nullable(),
          positionIn30Min: z.tuple([z.number(), z.number()]).nullable().openapi({ description: '[lng, lat] estimado' }),
        }),
      }),
    ),
    attribution: Attribution,
  })
  .openapi('StormCells');

export const LightningResponse = z
  .object({
    location: LocationSchema,
    radiusKm: z.number(),
    observedAt: isoTime.nullable(),
    count: z.number(),
    strikes: z.array(
      z.object({ lat: z.number(), lng: z.number(), time: isoTime, energy: z.number(), distanceKm: z.number(), bearingDeg: bearing }),
    ),
    attribution: Attribution,
  })
  .openapi('Lightning');

export const ForecastResponse = z
  .object({
    location: LocationSchema,
    daily: z.array(
      z.object({
        date: z.string().openapi({ example: '2026-11-25' }),
        text: z.string(),
        maxC: z.number(),
        minC: z.number(),
        alert: z.enum(['none', 'yellow', 'red']).openapi({ description: 'Alerta según la DCC' }),
      }),
    ),
    hourly: z.array(
      z.object({
        time: isoTime,
        temperatureC: z.number(),
        precipitationMm: z.number(),
        precipitationProbabilityPct: z.number(),
        windKmh: z.number(),
        gustKmh: z.number(),
        windFromDeg: z.number(),
        humidityPct: z.number(),
        weatherCode: z.number(),
        description: z.string(),
      }),
    ),
    attribution: Attribution,
  })
  .openapi('Forecast');

export const RadarFramesResponse = z
  .object({
    frames: z.array(
      z.object({
        time: isoTime,
        reflectivityUrl: z.string(),
        hailProbabilityUrl: z.string().nullable(),
        hailSwathUrl: z.string().nullable(),
      }),
    ),
    bounds: z.object({ south: z.number(), north: z.number(), west: z.number(), east: z.number() }),
    projection: z.string(),
    palettes: z.object({
      reflectivityDbz: z.array(z.object({ rgb: z.tuple([z.number(), z.number(), z.number()]), fromValue: z.number() })),
      hailProbabilityPct: z.array(z.object({ rgb: z.tuple([z.number(), z.number(), z.number()]), fromValue: z.number() })),
    }),
    attribution: Attribution,
  })
  .openapi('RadarFrames');

export const HailZonesResponse = z
  .object({
    date: z.string(),
    zones: z.array(
      z.object({
        department: z.string(),
        place: z.string(),
        areaKm2: z.number(),
        maxProbabilityPct: z.number(),
        start: isoTime.nullable(),
        end: isoTime.nullable(),
      }),
    ),
    attribution: Attribution,
  })
  .openapi('HailZones');

export const PlacesResponse = z
  .object({ places: z.array(z.object({ name: z.string(), lat: z.number(), lng: z.number() })) })
  .openapi('Places');
