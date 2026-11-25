import { createHmac, randomUUID } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

import { assessPlace, escalate, USAGE_TERMS, type Assessment, type SmnAlert } from '@alerta/core';
import { Agent, fetch as undiciFetch } from 'undici';

import { alertOut, ATTRIBUTION, DISCLAIMER, iso, riskOut } from '../serialize';
import type { ServerSources } from '../sources';
import { isPrivateAddress } from './safety';
import type { DeliveryRecord, Subscription, SubscriptionStore } from './store';

/** Condiciones de uso que viajan en cada webhook (mismas que en el servidor MCP). */
export const WEBHOOK_USAGE_TERMS = USAGE_TERMS;

export type WebhookEventType = 'risk.raised' | 'risk.cleared' | 'alert.new' | 'subscription.test';

export type WebhookPayload = {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  subscription: { id: string; label: string | null; minLevel: number };
  location: Subscription['location'];
  risk?: ReturnType<typeof riskOut>;
  alerts?: ReturnType<typeof alertOut>[];
  attribution: typeof ATTRIBUTION;
  usageTerms: string;
  disclaimer: string;
};

/** Firma estilo Stripe: `t=<unix>,v1=<hex(hmac_sha256(secret, "<t>.<body>"))>`. */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export type Sender = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number }>;

/** DNS que rechaza direcciones privadas en el momento de conectar (cierra el hueco de DNS rebinding). */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    const list = addresses as unknown as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      return callback(Object.assign(new Error(`Dirección no permitida para webhooks: ${bad?.address ?? hostname}`), { code: 'EACCES' }), '', 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

/** Envío real: undici con DNS de solo direcciones públicas (o sin restricción en desarrollo). */
export function createSender(allowPrivate: boolean): Sender {
  const dispatcher = new Agent(allowPrivate ? {} : { connect: { lookup: publicOnlyLookup } });
  return async (url, init) => {
    const res = await undiciFetch(url, { ...init, dispatcher, redirect: 'manual' });
    await res.body?.cancel().catch(() => {});
    return { status: res.status };
  };
}

export type DeliveryOptions = {
  send: Sender;
  /** Esperas entre reintentos (ms). */
  retryDelaysMs?: number[];
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Envía un evento con reintentos. Éxito = respuesta 2xx. */
export async function deliver(sub: Subscription, payload: WebhookPayload, opts: DeliveryOptions): Promise<DeliveryRecord> {
  const body = JSON.stringify(payload);
  const delays = opts.retryDelaysMs ?? [10_000, 60_000];
  const sleep = opts.sleep ?? defaultSleep;
  let last: DeliveryRecord = { at: Date.now(), type: payload.type, ok: false, status: null, error: 'sin intentos' };

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
    try {
      const { status } = await opts.send(sub.webhookUrl, {
        method: 'POST',
        signal: controller.signal,
        body,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AlertaMendozaWebhooks/1.0',
          'X-Alerta-Event': payload.type,
          'X-Alerta-Delivery': payload.id,
          'X-Alerta-Signature': signPayload(sub.secret, body),
        },
      });
      last = { at: Date.now(), type: payload.type, ok: status >= 200 && status < 300, status };
      if (last.ok) return last;
      // Errores del cliente (salvo 408/429) no mejoran con reintentos.
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) return last;
    } catch (error) {
      last = { at: Date.now(), type: payload.type, ok: false, status: null, error: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

function basePayload(sub: Subscription, type: WebhookEventType, now: number): WebhookPayload {
  return {
    id: randomUUID(),
    type,
    createdAt: iso(now)!,
    subscription: { id: sub.id, label: sub.label, minLevel: sub.minLevel },
    location: sub.location,
    attribution: ATTRIBUTION,
    usageTerms: WEBHOOK_USAGE_TERMS,
    disclaimer: DISCLAIMER,
  };
}

/** Eventos a enviar para una suscripción según el riesgo actual, y su nueva memoria. */
export function eventsFor(sub: Subscription, a: Assessment): { events: WebhookPayload[]; memory: Subscription['memory'] } {
  const wantsAlerts = sub.events.includes('alerts');
  const wantsRisk = sub.events.includes('risk');
  // Sin datos de alertas no se toca su memoria (no se "olvidan" alertas por un error de red).
  const alertsKnown = a.sources.alerts.ok;
  const result = escalate({
    risk: a.risk,
    myAlerts: wantsAlerts && alertsKnown ? a.myAlerts : [],
    minLevel: sub.minLevel,
    memory: sub.memory,
    now: a.now,
  });
  if (!wantsAlerts || !alertsKnown) result.memory.alertIds = sub.memory.alertIds;

  const risk = riskOut(sub.location, a);
  const events: WebhookPayload[] = [];
  if (result.newAlerts.length > 0) {
    events.push({ ...basePayload(sub, 'alert.new', a.now), alerts: result.newAlerts.map((al: SmnAlert) => alertOut(al, a.now, sub.location)), risk });
  }
  if (wantsRisk && result.raised) events.push({ ...basePayload(sub, 'risk.raised', a.now), risk });
  if (wantsRisk && result.cleared) events.push({ ...basePayload(sub, 'risk.cleared', a.now), risk });
  return { events, memory: result.memory };
}

export function testPayload(sub: Subscription, now = Date.now()): WebhookPayload {
  return basePayload(sub, 'subscription.test', now);
}

/** Tras tantos envíos fallidos seguidos, la suscripción se desactiva. */
export const MAX_CONSECUTIVE_FAILURES = 10;

export function recordDelivery(sub: Subscription, record: DeliveryRecord): Subscription {
  const failures = record.ok ? 0 : sub.consecutiveFailures + 1;
  const disable = failures >= MAX_CONSECUTIVE_FAILURES;
  return {
    ...sub,
    lastDelivery: record,
    consecutiveFailures: failures,
    status: disable ? 'disabled' : sub.status,
    disabledReason: disable ? `${failures} envíos fallidos seguidos` : sub.disabledReason,
  };
}

export type CycleContext = {
  store: SubscriptionStore;
  sources: ServerSources;
  delivery: DeliveryOptions;
  concurrency?: number;
};

/**
 * Una vuelta de evaluación: calcula el riesgo de cada suscripción activa con las
 * fuentes en caché y envía los eventos que correspondan. Devuelve cuántos se enviaron.
 */
export async function runCycle(ctx: CycleContext): Promise<{ evaluated: number; sent: number; failed: number }> {
  const subs = (await ctx.store.list()).filter((s) => s.status === 'active');
  let sent = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < subs.length) {
      const sub = subs[next++];
      let assessment: Assessment;
      try {
        assessment = await assessPlace(sub.location, ctx.sources);
      } catch {
        continue;
      }
      const { events, memory } = eventsFor(sub, assessment);
      // La memoria se guarda antes de enviar: si el envío falla no se repite el aviso en cada vuelta.
      let current: Subscription = { ...sub, memory };
      await ctx.store.put(current);
      for (const event of events) {
        const record = await deliver(current, event, ctx.delivery);
        if (record.ok) sent++;
        else failed++;
        // Puede haberse borrado mientras se enviaba.
        const fresh = await ctx.store.get(sub.id);
        if (!fresh) break;
        current = recordDelivery({ ...fresh, memory: current.memory }, record);
        await ctx.store.put(current);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(ctx.concurrency ?? 5, subs.length) }, worker));
  return { evaluated: subs.length, sent, failed };
}

/** Corre `runCycle` periódicamente, sin superponer vueltas. */
export function startScheduler(ctx: CycleContext, intervalMs = 120_000, firstDelayMs = 30_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runCycle(ctx);
      if (r.sent || r.failed) console.log(`Webhooks: ${r.evaluated} suscripciones, ${r.sent} enviados, ${r.failed} fallidos`);
    } catch (error) {
      console.error('Error en la vuelta de webhooks:', error);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, firstDelayMs);
  const timer = setInterval(tick, intervalMs);
  // No impedir que el proceso termine por estos timers (en Node; en otros entornos no existe).
  (first as { unref?: () => void }).unref?.();
  (timer as { unref?: () => void }).unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
