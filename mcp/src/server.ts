import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ApiCallError, type ApiClient } from './api';

export const VERSION = '1.0.0';

/**
 * Condiciones de uso de los datos. Cada resultado las repite porque los agentes
 * tienden a perder la atribución:
 * - DCC Mendoza: uso libre con mención visible y textual de la fuente.
 * - SMN: CC BY 2.5 AR; su robots.txt declara ai-train=no y use=reference
 *   (citar y enlazar la fuente; no usar para entrenar modelos).
 * - Open-Meteo: CC BY 4.0, uso no comercial.
 */
export const USAGE_TERMS = [
  'Data terms: cite the sources with their links in any answer that uses this data.',
  '"Fuente: Dirección de Contingencias Climáticas - Gobierno de Mendoza" (radar, lightning, hail, provincial forecast) — https://www.mendoza.gov.ar/contingencias/radar/ ;',
  'Servicio Meteorológico Nacional (official alerts, CC BY 2.5 AR) — link each alert via its `source` URL or https://www.smn.gob.ar/alertas ;',
  'Open-Meteo (hourly point forecast, CC BY 4.0, non-commercial) — https://open-meteo.com.',
  'Do not use this data to train or fine-tune AI models (SMN declares ai-train=no).',
  'Unofficial service: the risk level is an automatic estimate and does not replace official warnings. Emergencies in Argentina: 911.',
].join(' ');

export const INSTRUCTIONS = `
Alerta Mendoza: weather-risk data for the province of Mendoza, Argentina (hail, storms, lightning, wind and the Zonda wind).

How to use:
- Start with get_risk for "is it dangerous here / is hail coming" questions. Locations are lat/lng or a place name from list_places.
- Coverage: Mendoza and surroundings (lat -39..-30, lng -72..-64.5). The radar covers roughly -36.2..-29.9 lat, -70.7..-65.3 lng.
- Levels: 0 green (no risk), 1 yellow (be informed), 2 orange (get ready), 3 red (take shelter) — same scale as Argentina's SMN.
- Units: km, km/h, degrees clockwise from north (90 = east), times ISO-8601 UTC (Mendoza is UTC-3, no DST).
- Text fields (headline, summary, advice, alert descriptions) are in Spanish; translate when answering in another language.
- ALWAYS check dataQuality: if radar.fresh is false or alerts.complete is false, say the assessment may be incomplete instead of claiming there is no risk.
- Storm motion is an extrapolation from the last ~20 minutes of radar; storms can grow, decay or turn.

${USAGE_TERMS}
`.trim();

const locationInput = {
  lat: z.number().min(-90).max(90).optional().describe('Latitude (decimal degrees, negative south)'),
  lng: z.number().min(-180).max(180).optional().describe('Longitude (decimal degrees, negative west)'),
  place: z.string().optional().describe('Place name from list_places, e.g. "Godoy Cruz". Use instead of lat/lng.'),
};

type LocationArgs = { lat?: number; lng?: number; place?: string };

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: true } as const;

function located(args: LocationArgs) {
  return { lat: args.lat, lng: args.lng, place: args.place };
}

function result(summary: string, data: unknown): CallToolResult {
  const structured = (data && typeof data === 'object' ? data : { value: data }) as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: `${summary}\n\n${USAGE_TERMS}\n\n${JSON.stringify(data)}` }],
    structuredContent: { ...structured, usageTerms: USAGE_TERMS },
  };
}

function failure(error: unknown): CallToolResult {
  const message =
    error instanceof ApiCallError ? `${error.code}: ${error.message}` : `INTERNAL: ${(error as Error)?.message ?? error}`;
  return { content: [{ type: 'text', text: message }], isError: true };
}

const safe =
  <A>(fn: (args: A) => Promise<CallToolResult>) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (error) {
      return failure(error);
    }
  };

const LEVEL_NAMES = ['green', 'yellow', 'orange', 'red'];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const s =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

type Alert = {
  event: string;
  level: number;
  levelName: string;
  immediate: boolean;
  onset: string;
  expires: string;
  active: boolean;
  places: string[];
  coversLocation?: boolean;
  distanceKm?: number;
  geometry?: unknown;
  source: string;
};

function describeAlert(a: Alert) {
  const where = a.coversLocation ? 'covers the location' : a.distanceKm !== undefined ? `${a.distanceKm} km away` : a.places.join(', ');
  return `${a.immediate ? 'Short-term notice' : `${a.levelName} alert`}: ${a.event} (${a.active ? 'active' : `from ${a.onset}`} until ${a.expires}; ${where}) — ${a.source}`;
}

/** Crea el servidor MCP con sus herramientas y recursos. */
export function createMcpServer(api: ApiClient): McpServer {
  const server = new McpServer({ name: 'alerta-mendoza', title: 'Alerta Mendoza', version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'get_risk',
    {
      title: 'Weather risk at a location',
      description:
        'Current weather risk (0-3) at a location in Mendoza: hail, rain/storms, lightning and wind/Zonda, ' +
        'combining radar, lightning, SMN official alerts and forecast. Includes the most relevant nearby storm ' +
        'with its motion and estimated arrival, measurements, active official alerts covering the point, and dataQuality.',
      inputSchema: locationInput,
      annotations: READ_ONLY,
    },
    safe(async (args: LocationArgs) => {
      const r = await api.get<any>('/v1/risk', located(args));
      const storm = r.measurements.storm;
      const lines = [
        `${r.location.label}: level ${r.level} (${r.levelName}). ${r.text.headline} — ${r.text.detail.replace(/\.$/, '')}.`,
        storm
          ? `Nearest strong storm: ${storm.distanceKm} km to the ${compass(storm.bearingDeg)}, ${storm.trend}` +
            (storm.motion ? ` (moving ${compass(storm.motion.towardsDeg)} at ${storm.motion.speedKmh} km/h)` : '') +
            (storm.etaMinutes !== null ? `, could arrive in ~${storm.etaMinutes} min.` : '.')
          : 'No strong storm (45 dBZ+) within 60 km.',
        `Official alerts covering the point: ${r.officialAlerts.length}.`,
        `Data quality: radar ${r.dataQuality.radar.fresh ? 'fresh' : 'NOT fresh'}, alerts ${r.dataQuality.alerts.complete ? 'complete' : 'POSSIBLY INCOMPLETE'}.`,
      ];
      return result(lines.join('\n'), r);
    }),
  );

  server.registerTool(
    'get_alerts',
    {
      title: 'Official SMN alerts for Mendoza',
      description:
        'Active and upcoming official alerts and short-term notices from Argentina\'s SMN that reach Mendoza ' +
        '(storms, rain, wind, Zonda, snow). With a location, each alert says whether it covers it and how far it is. ' +
        'Geometry (GeoJSON) is omitted unless include_geometry is true.',
      inputSchema: {
        ...locationInput,
        covering_only: z.boolean().optional().describe('Only alerts whose area contains the location'),
        include_geometry: z.boolean().optional().describe('Include GeoJSON polygons (large)'),
      },
      annotations: READ_ONLY,
    },
    safe(async (args: LocationArgs & { covering_only?: boolean; include_geometry?: boolean }) => {
      const r = await api.get<{ complete: boolean; alerts: Alert[] }>('/v1/alerts', {
        ...located(args),
        coveringOnly: args.covering_only ? 'true' : undefined,
      });
      const alerts = args.include_geometry ? r.alerts : r.alerts.map(({ geometry: _g, ...rest }) => rest);
      const summary =
        (alerts.length === 0 ? 'No active or upcoming SMN alerts for Mendoza.' : alerts.map(describeAlert).join('\n')) +
        (r.complete ? '' : '\nWARNING: the SMN list may be incomplete (upstream rate limit).');
      return result(summary, { ...r, alerts });
    }),
  );

  server.registerTool(
    'get_storms',
    {
      title: 'Storm cells and their motion',
      description:
        'Storm cells (40 dBZ+) in the latest radar pass with speed, heading and position in 30 minutes. ' +
        'With a location, only cells within radius_km are returned, nearest first, with distance and bearing.',
      inputSchema: {
        ...locationInput,
        radius_km: z.number().min(1).max(500).optional().describe('Search radius around the location (default 100)'),
      },
      annotations: READ_ONLY,
    },
    safe(async (args: LocationArgs & { radius_km?: number }) => {
      const r = await api.get<any>('/v1/storms');
      let cells = r.features.map((f: any) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        ...f.properties,
      }));
      let origin: { lat: number; lng: number; label: string } | null = null;
      if (args.place || (args.lat !== undefined && args.lng !== undefined)) {
        // Se resuelve la ubicación con la API para validar el área y el nombre.
        const loc = (await api.get<any>('/v1/location', located(args))).location;
        origin = loc;
        const radius = args.radius_km ?? 100;
        cells = cells
          .map((c: any) => ({ ...c, distanceKm: Math.round(distanceKm(loc, c) * 10) / 10, bearingDeg: Math.round(bearingDeg(loc, c)) }))
          .filter((c: any) => c.distanceKm <= radius)
          .sort((a: any, b: any) => a.distanceKm - b.distanceKm);
      }
      const drift = r.overallMotion ? `Overall motion: towards ${compass(r.overallMotion.towardsDeg)} at ~${r.overallMotion.speedKmh} km/h.` : 'No overall motion estimate.';
      const summary = [
        `Radar pass ${r.observedAt}: ${cells.length} storm cells${origin ? ` within ${args.radius_km ?? 100} km of ${origin.label}` : ''}. ${drift}`,
        ...cells.slice(0, 5).map(
          (c: any) =>
            `- ${c.maxDbz} dBZ` +
            (c.distanceKm !== undefined ? `, ${c.distanceKm} km ${compass(c.bearingDeg)}` : ` at ${c.lat},${c.lng}`) +
            (c.motion ? `, moving ${compass(c.motion.towardsDeg)} at ${c.motion.speedKmh} km/h` : ', motion unknown'),
        ),
      ].join('\n');
      return result(summary, { observedAt: r.observedAt, overallMotion: r.overallMotion, origin, cells, attribution: r.attribution });
    }),
  );

  server.registerTool(
    'get_lightning',
    {
      title: 'Recent lightning near a location',
      description: 'Lightning strikes of the last few minutes (GOES-19 GLM, via DCC Mendoza) within radius_km of a location.',
      inputSchema: { ...locationInput, radius_km: z.number().min(1).max(300).optional().describe('Default 50') },
      annotations: READ_ONLY,
    },
    safe(async (args: LocationArgs & { radius_km?: number }) => {
      const r = await api.get<any>('/v1/lightning', { ...located(args), radiusKm: args.radius_km ?? 50 });
      const nearest = r.strikes[0];
      const summary =
        r.count === 0
          ? `No lightning within ${r.radiusKm} km of ${r.location.label}.`
          : `${r.count} strikes within ${r.radiusKm} km of ${r.location.label}; nearest ${nearest.distanceKm} km ${compass(nearest.bearingDeg)} at ${nearest.time}.`;
      return result(summary, { ...r, strikes: r.strikes.slice(0, 25) });
    }),
  );

  server.registerTool(
    'get_forecast',
    {
      title: 'Forecast for a location',
      description:
        'Provincial 5-day forecast written by DCC Mendoza meteorologists (Spanish text) plus a 24-hour hourly ' +
        'forecast for the point (temperature, precipitation probability, gusts).',
      inputSchema: locationInput,
      annotations: READ_ONLY,
    },
    safe(async (args: LocationArgs) => {
      const r = await api.get<any>('/v1/forecast', located(args));
      const today = r.daily[0];
      const maxGust = r.hourly.length ? Math.max(...r.hourly.slice(0, 12).map((h: any) => h.gustKmh)) : null;
      const maxRain = r.hourly.length ? Math.max(...r.hourly.slice(0, 12).map((h: any) => h.precipitationProbabilityPct)) : null;
      const summary = [
        today ? `Today (DCC): ${today.text} Max ${today.maxC}°C / min ${today.minC}°C${today.alert !== 'none' ? `, DCC ${today.alert} alert` : ''}.` : 'No provincial forecast available.',
        maxGust !== null ? `Next 12 h at ${r.location.label}: gusts up to ${Math.round(maxGust)} km/h, precipitation probability up to ${Math.round(maxRain!)}%.` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return result(summary, r);
    }),
  );

  server.registerTool(
    'get_hail_today',
    {
      title: 'Hail detected today',
      description: 'Zones where the radar detected hail today, by department, with affected area (experimental DCC report).',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const r = await api.get<any>('/v1/hail/today');
      const summary =
        r.zones.length === 0
          ? `No hail detected by radar on ${r.date}.`
          : `Hail detected on ${r.date} in ${r.zones.length} zones: ` +
            r.zones.slice(0, 8).map((z: any) => `${z.place || 'rural zone'} (${z.department}, ${z.areaKm2} km²)`).join('; ');
      return result(summary, r);
    }),
  );

  server.registerTool(
    'list_places',
    {
      title: 'Known places',
      description: 'Place names accepted by the `place` argument (department capitals and reference towns of Mendoza).',
      inputSchema: {},
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    safe(async () => {
      const r = await api.get<{ places: { name: string }[] }>('/v1/places');
      return result(r.places.map((p) => p.name).join(', '), r);
    }),
  );

  // ---------- Suscripciones con webhooks ----------
  const subscriptionPath = (id: string) => `/v1/subscriptions/${encodeURIComponent(id)}`;
  const authed = (secret: string) => ({ Authorization: `Bearer ${secret}` });

  server.registerTool(
    'create_alert_subscription',
    {
      title: 'Subscribe a webhook to weather risk at a location',
      description:
        'Creates a subscription: the service checks the location every ~2 minutes and POSTs a signed JSON event to ' +
        'webhook_url when the risk reaches min_level (risk.raised), when it drops back below it (risk.cleared), or ' +
        'when a new SMN alert covers the location (alert.new). The webhook must be a public https URL. ' +
        'Returns an id and a secret, shown only once: the secret verifies the X-Alerta-Signature header ' +
        '(t=<unix>,v1=hex(HMAC-SHA256(secret, "<t>.<body>"))) and is required to manage the subscription. ' +
        'Only create subscriptions the user asked for, and give them the secret.',
      inputSchema: {
        ...locationInput,
        webhook_url: z.string().describe('Public https URL that will receive the events'),
        min_level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('1 yellow, 2 orange (default), 3 red'),
        events: z.array(z.enum(['risk', 'alerts'])).min(1).optional().describe('Default both'),
        label: z.string().max(80).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    safe(async (args: LocationArgs & { webhook_url: string; min_level?: 1 | 2 | 3; events?: ('risk' | 'alerts')[]; label?: string }) => {
      const sub = await api.post<any>('/v1/subscriptions', {
        ...located(args),
        webhookUrl: args.webhook_url,
        minLevel: args.min_level,
        events: args.events,
        label: args.label,
      });
      return result(
        `Subscription ${sub.id} created for ${sub.location.label} (level ≥ ${sub.minLevel}, events: ${sub.events.join(', ')}). ` +
          `Secret (shown only once, give it to the user): ${sub.secret}`,
        sub,
      );
    }),
  );

  server.registerTool(
    'get_alert_subscription',
    {
      title: 'Check a webhook subscription',
      description: 'Status of a subscription and its last delivery. Requires the id and secret returned at creation.',
      inputSchema: { id: z.string(), secret: z.string() },
      annotations: READ_ONLY,
    },
    safe(async (args: { id: string; secret: string }) => {
      const sub = await api.request<any>('GET', subscriptionPath(args.id), { headers: authed(args.secret) });
      const last = sub.lastDelivery ? `last delivery ${sub.lastDelivery.type} at ${sub.lastDelivery.at}: ${sub.lastDelivery.ok ? 'ok' : `failed (${sub.lastDelivery.status ?? sub.lastDelivery.error})`}` : 'no deliveries yet';
      return result(`Subscription ${sub.id} for ${sub.location.label} is ${sub.status}${sub.disabledReason ? ` (${sub.disabledReason})` : ''}; ${last}.`, sub);
    }),
  );

  server.registerTool(
    'test_alert_subscription',
    {
      title: 'Send a test event to a webhook',
      description: 'Sends a subscription.test event to the webhook once and reports the HTTP status it answered.',
      inputSchema: { id: z.string(), secret: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    safe(async (args: { id: string; secret: string }) => {
      const r = await api.request<any>('POST', `${subscriptionPath(args.id)}/test`, { headers: authed(args.secret), body: {} });
      return result(r.ok ? `Test event delivered (HTTP ${r.status}).` : `Test event failed: ${r.status ?? r.error}.`, r);
    }),
  );

  server.registerTool(
    'delete_alert_subscription',
    {
      title: 'Delete a webhook subscription',
      description: 'Deletes a subscription. Requires the id and secret.',
      inputSchema: { id: z.string(), secret: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    safe(async (args: { id: string; secret: string }) => {
      await api.request('DELETE', subscriptionPath(args.id), { headers: authed(args.secret) });
      return { content: [{ type: 'text', text: `Subscription ${args.id} deleted.` }] };
    }),
  );

  server.registerResource(
    'usage',
    'alerta://usage',
    {
      title: 'How to use Alerta Mendoza data',
      description: 'Coverage, units, risk levels, data-quality caveats and the terms of use of each source.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: INSTRUCTIONS }] }),
  );

  server.registerResource(
    'active-alerts',
    'alerta://alerts/active',
    {
      title: 'Active SMN alerts for Mendoza',
      description: 'Current official alerts and short-term notices that reach Mendoza (without geometry).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const r = await api.get<{ complete: boolean; alerts: Alert[] }>('/v1/alerts');
      const alerts = r.alerts.map(({ geometry: _g, ...rest }) => rest);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ ...r, alerts, usageTerms: USAGE_TERMS }) },
        ],
      };
    },
  );

  return server;
}

export { LEVEL_NAMES };
