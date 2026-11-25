import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';

import {
  DeliveryResult,
  ErrorSchema,
  SubscriptionCreate,
  SubscriptionCreated,
  SubscriptionIdParam,
  SubscriptionUpdate,
  SubscriptionView,
} from '../schemas';
import { iso } from '../serialize';
import { assertSafeWebhookUrl, UnsafeUrlError, type UrlPolicy } from './safety';
import type { Subscription, SubscriptionStore } from './store';
import { deliver, recordDelivery, testPayload, type DeliveryOptions } from './webhooks';

export type SubscriptionOptions = {
  store: SubscriptionStore;
  policy: UrlPolicy;
  delivery: DeliveryOptions;
  /** Máximo de suscripciones en total. */
  maxSubscriptions?: number;
  /** Máximo de suscripciones nuevas por IP y por hora. */
  maxCreatesPerHour?: number;
};

type ApiErrorCtor = new (status: 400 | 401 | 404 | 422 | 429 | 502, code: any, message: string) => Error;

const errors = {
  400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Datos inválidos o URL no permitida' },
  401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Falta el secreto o no coincide' },
  404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Suscripción inexistente' },
  429: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Límite alcanzado' },
};

export function publicView(sub: Subscription) {
  return {
    id: sub.id,
    createdAt: iso(sub.createdAt)!,
    location: sub.location,
    webhookUrl: sub.webhookUrl,
    minLevel: sub.minLevel,
    events: sub.events,
    label: sub.label,
    status: sub.status,
    disabledReason: sub.disabledReason,
    consecutiveFailures: sub.consecutiveFailures,
    lastDelivery: sub.lastDelivery
      ? { ...sub.lastDelivery, at: iso(sub.lastDelivery.at)! }
      : null,
  };
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function registerSubscriptionRoutes(
  app: OpenAPIHono,
  opts: SubscriptionOptions,
  helpers: {
    ApiError: ApiErrorCtor;
    resolveLocation: (q: { lat?: number; lng?: number; place?: string }) => { lat: number; lng: number; label: string };
  },
) {
  const { ApiError, resolveLocation } = helpers;
  const creates = new Map<string, number[]>();

  async function safeUrl(raw: string) {
    try {
      return await assertSafeWebhookUrl(raw, opts.policy);
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw new ApiError(400, 'UNSAFE_WEBHOOK_URL', error.message);
      throw error;
    }
  }

  async function authorized(c: Context, id: string): Promise<Subscription> {
    const sub = await opts.store.get(id);
    if (!sub) throw new ApiError(404, 'NOT_FOUND', 'Suscripción inexistente.');
    const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token || !sameSecret(token, sub.secret)) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Enviá el secreto de la suscripción en Authorization: Bearer <secret>.');
    }
    return sub;
  }

  function checkRate(c: Context) {
    const limit = opts.maxCreatesPerHour ?? 20;
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local';
    const now = Date.now();
    const recent = (creates.get(ip) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= limit) throw new ApiError(429, 'RATE_LIMITED', 'Demasiadas suscripciones nuevas desde esta dirección. Probá en una hora.');
    recent.push(now);
    creates.set(ip, recent);
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/subscriptions',
      tags: ['Suscripciones'],
      summary: 'Crear una suscripción con webhook para un lugar',
      description:
        'El servidor evalúa el lugar cada ~2 minutos y envía un POST firmado al webhook cuando el riesgo sube al ' +
        'nivel elegido (risk.raised), cuando vuelve a bajar (risk.cleared) o cuando aparece una alerta del SMN que lo ' +
        'cubre (alert.new). Verificá X-Alerta-Signature: t=<unix>,v1=hex(HMAC-SHA256(secret, "<t>.<body>")).',
      request: { body: { content: { 'application/json': { schema: SubscriptionCreate } }, required: true } },
      responses: {
        201: { content: { 'application/json': { schema: SubscriptionCreated } }, description: 'Suscripción creada' },
        ...errors,
        422: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Fuera del área del servicio' },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const location = resolveLocation(body);
      const webhookUrl = await safeUrl(body.webhookUrl);
      if ((await opts.store.list()).length >= (opts.maxSubscriptions ?? 1000)) {
        throw new ApiError(429, 'LIMIT_REACHED', 'El servicio alcanzó el máximo de suscripciones.');
      }
      checkRate(c);
      const sub: Subscription = {
        id: randomUUID(),
        secret: randomBytes(24).toString('base64url'),
        createdAt: Date.now(),
        location,
        webhookUrl,
        minLevel: body.minLevel,
        events: [...new Set(body.events)],
        label: body.label ?? null,
        status: 'active',
        disabledReason: null,
        memory: { level: 0, levelAt: 0, alertIds: [] },
        consecutiveFailures: 0,
        lastDelivery: null,
      };
      await opts.store.put(sub);
      return c.json({ ...publicView(sub), secret: sub.secret }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/subscriptions/{id}',
      tags: ['Suscripciones'],
      summary: 'Ver una suscripción y su último envío',
      request: { params: SubscriptionIdParam },
      responses: { 200: { content: { 'application/json': { schema: SubscriptionView } }, description: 'Suscripción' }, ...errors },
    }),
    async (c) => c.json(publicView(await authorized(c, c.req.valid('param').id)), 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/subscriptions/{id}',
      tags: ['Suscripciones'],
      summary: 'Modificar o reactivar una suscripción',
      request: {
        params: SubscriptionIdParam,
        body: { content: { 'application/json': { schema: SubscriptionUpdate } }, required: true },
      },
      responses: { 200: { content: { 'application/json': { schema: SubscriptionView } }, description: 'Suscripción actualizada' }, ...errors },
    }),
    async (c) => {
      const sub = await authorized(c, c.req.valid('param').id);
      const patch = c.req.valid('json');
      const updated: Subscription = {
        ...sub,
        webhookUrl: patch.webhookUrl ? await safeUrl(patch.webhookUrl) : sub.webhookUrl,
        minLevel: patch.minLevel ?? sub.minLevel,
        events: patch.events ? [...new Set(patch.events)] : sub.events,
        label: patch.label === undefined ? sub.label : patch.label,
        ...(patch.status === 'active' ? { status: 'active' as const, disabledReason: null, consecutiveFailures: 0 } : {}),
      };
      await opts.store.put(updated);
      return c.json(publicView(updated), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/subscriptions/{id}',
      tags: ['Suscripciones'],
      summary: 'Borrar una suscripción',
      request: { params: SubscriptionIdParam },
      responses: { 204: { description: 'Borrada' }, ...errors },
    }),
    async (c) => {
      const sub = await authorized(c, c.req.valid('param').id);
      await opts.store.delete(sub.id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/subscriptions/{id}/test',
      tags: ['Suscripciones'],
      summary: 'Enviar un evento de prueba (subscription.test) al webhook',
      description: 'Un solo intento, sin reintentos. Devuelve el código HTTP que respondió el webhook.',
      request: { params: SubscriptionIdParam },
      responses: { 200: { content: { 'application/json': { schema: DeliveryResult } }, description: 'Resultado del envío' }, ...errors },
    }),
    async (c) => {
      const sub = await authorized(c, c.req.valid('param').id);
      const record = await deliver(sub, testPayload(sub), { ...opts.delivery, retryDelaysMs: [] });
      await opts.store.put(recordDelivery(sub, record));
      return c.json({ ok: record.ok, status: record.status, ...(record.error ? { error: record.error } : {}) }, 200);
    },
  );
}
