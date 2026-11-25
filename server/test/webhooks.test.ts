import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { TtlCache } from '../src/cache';
import { CallBudget, createCachedSources, type ServerSources } from '../src/sources';
import { assertSafeWebhookUrl, isPrivateAddress, type UrlPolicy } from '../src/subscriptions/safety';
import { FileStore, MemoryStore, type Subscription } from '../src/subscriptions/store';
import { deliver, MAX_CONSECUTIVE_FAILURES, runCycle, signPayload, testPayload, type Sender } from '../src/subscriptions/webhooks';
import { fakeSources } from './fixtures';

const publicResolver: UrlPolicy['resolve'] = async (host) => (host.includes('internal') ? ['10.0.0.5'] : ['93.184.216.34']);
const policy: UrlPolicy = { allowPrivate: false, resolve: publicResolver };

type Captured = { url: string; headers: Record<string, string>; body: any };

function recordingSender(statuses: number[] = [200]) {
  const calls: Captured[] = [];
  let i = 0;
  const send: Sender = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { status: statuses[Math.min(i++, statuses.length - 1)] };
  };
  return { send, calls };
}

const noSleep = async () => {};

function setup(sources: ServerSources = fakeSources(), statuses?: number[]) {
  const store = new MemoryStore();
  const sender = recordingSender(statuses);
  const delivery = { send: sender.send, retryDelaysMs: [0, 0], sleep: noSleep };
  const app = createApp({ sources, subscriptions: { store, policy, delivery } });
  return { app, store, sender, delivery };
}

const json = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

describe('webhook URL safety', () => {
  it('recognises private and special addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('requires https and public addresses unless in development mode', async () => {
    await expect(assertSafeWebhookUrl('http://example.com/h', policy)).rejects.toThrow(/https/);
    await expect(assertSafeWebhookUrl('https://internal.example/h', policy)).rejects.toThrow(/pública/);
    await expect(assertSafeWebhookUrl('https://127.0.0.1/h', policy)).rejects.toThrow(/pública/);
    await expect(assertSafeWebhookUrl('https://user:pw@example.com/h', policy)).rejects.toThrow(/usuario/);
    await expect(assertSafeWebhookUrl('https://example.com/h', policy)).resolves.toBe('https://example.com/h');
    await expect(assertSafeWebhookUrl('http://localhost:9000/h', { ...policy, allowPrivate: true })).resolves.toBeTruthy();
  });
});

describe('subscription routes', () => {
  it('creates, reads, updates, tests and deletes a subscription with its secret', async () => {
    const { app, sender } = setup();
    const created = await app.request('/v1/subscriptions', json({ place: 'Godoy Cruz', webhookUrl: 'https://example.com/hook', label: 'Casa' }));
    expect(created.status).toBe(201);
    const sub = (await created.json()) as any;
    expect(sub.secret.length).toBeGreaterThan(20);
    expect(sub).toMatchObject({ location: { label: 'Godoy Cruz' }, minLevel: 2, events: ['risk', 'alerts'], status: 'active' });

    const path = `/v1/subscriptions/${sub.id}`;
    expect((await app.request(path)).status).toBe(401);
    expect((await app.request(path, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await app.request(path, { headers: { Authorization: `Bearer ${sub.secret}` } })).status).toBe(200);

    const patched = await app.request(path, { ...json({ minLevel: 3, events: ['alerts'] }, sub.secret), method: 'PATCH' });
    expect(await patched.json()).toMatchObject({ minLevel: 3, events: ['alerts'] });

    const test = await app.request(`${path}/test`, json({}, sub.secret));
    expect(await test.json()).toEqual({ ok: true, status: 200 });
    const hook = sender.calls[0];
    expect(hook.headers['X-Alerta-Event']).toBe('subscription.test');
    expect(hook.body.usageTerms).toMatch(/ai-train=no/);
    expect(hook.body.attribution[0].name).toMatch(/Contingencias/);

    expect((await app.request(path, { method: 'DELETE', headers: { Authorization: `Bearer ${sub.secret}` } })).status).toBe(204);
    expect((await app.request(path, { headers: { Authorization: `Bearer ${sub.secret}` } })).status).toBe(404);
  });

  it('rejects unsafe webhooks, bad input and places outside the area', async () => {
    const { app } = setup();
    const unsafe = await app.request('/v1/subscriptions', json({ place: 'Maipú', webhookUrl: 'https://internal.example/hook' }));
    expect(unsafe.status).toBe(400);
    expect(((await unsafe.json()) as any).error.code).toBe('UNSAFE_WEBHOOK_URL');
    expect((await app.request('/v1/subscriptions', json({ place: 'Maipú', webhookUrl: 'https://example.com', minLevel: 7 }))).status).toBe(400);
    const far = await app.request('/v1/subscriptions', json({ lat: -34.6, lng: -58.4, webhookUrl: 'https://example.com' }));
    expect(far.status).toBe(422);
  });

  it('rate-limits creation per address', async () => {
    const store = new MemoryStore();
    const app = createApp({ sources: fakeSources(), subscriptions: { store, policy, delivery: recordingSender(), maxCreatesPerHour: 2 } as any });
    const body = json({ place: 'Maipú', webhookUrl: 'https://example.com/h' });
    expect((await app.request('/v1/subscriptions', body)).status).toBe(201);
    expect((await app.request('/v1/subscriptions', body)).status).toBe(201);
    const third = await app.request('/v1/subscriptions', body);
    expect(third.status).toBe(429);
  });
});

describe('delivery', () => {
  const sub: Subscription = {
    id: 's1', secret: 'shh', createdAt: 0, location: { lat: -32.9, lng: -68.8, label: 'X' }, webhookUrl: 'https://example.com/h',
    minLevel: 2, events: ['risk', 'alerts'], label: null, status: 'active', disabledReason: null,
    memory: { level: 0, levelAt: 0, alertIds: [] }, consecutiveFailures: 0, lastDelivery: null,
  };

  it('signs the body so receivers can verify it', async () => {
    const { send, calls } = recordingSender();
    await deliver(sub, testPayload(sub), { send, retryDelaysMs: [] });
    const [t, v1] = calls[0].headers['X-Alerta-Signature'].split(',').map((p) => p.split('=')[1]);
    const expected = createHmac('sha256', 'shh').update(`${t}.${JSON.stringify(calls[0].body)}`).digest('hex');
    expect(v1).toBe(expected);
    expect(signPayload('k', 'body', 1)).toBe(`t=1,v1=${createHmac('sha256', 'k').update('1.body').digest('hex')}`);
  });

  it('retries server errors but not client errors', async () => {
    const retried = recordingSender([500, 503, 200]);
    expect((await deliver(sub, testPayload(sub), { send: retried.send, retryDelaysMs: [0, 0], sleep: noSleep })).ok).toBe(true);
    expect(retried.calls).toHaveLength(3);
    const rejected = recordingSender([404]);
    const r = await deliver(sub, testPayload(sub), { send: rejected.send, retryDelaysMs: [0, 0], sleep: noSleep });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(rejected.calls).toHaveLength(1);
  });
});

describe('evaluation cycle', () => {
  async function subscribe(app: ReturnType<typeof setup>['app'], body: object = {}) {
    const res = await app.request('/v1/subscriptions', json({ place: 'Godoy Cruz', webhookUrl: 'https://example.com/hook', ...body }));
    return (await res.json()) as any;
  }

  it('sends alert.new and risk.raised once, then risk.cleared when it calms down', async () => {
    let sources = fakeSources();
    const wrapper: ServerSources = new Proxy({} as ServerSources, { get: (_t, key) => (sources as any)[key] });
    const { app, store, sender, delivery } = setup(wrapper);
    await subscribe(app);

    await runCycle({ store, sources: wrapper, delivery });
    expect(sender.calls.map((c) => c.body.type)).toEqual(['alert.new', 'risk.raised']);
    const alertEvent = sender.calls[0].body;
    expect(alertEvent.alerts[0]).toMatchObject({ event: 'Viento Zonda', coversLocation: true });
    expect(alertEvent.alerts[0].source).toMatch(/^https:\/\/ssl\.smn\.gob\.ar/);
    expect(sender.calls[1].body.risk.level).toBe(2);

    await runCycle({ store, sources: wrapper, delivery });
    expect(sender.calls).toHaveLength(2); // sin repeticiones

    const calm = { time: '2026-11-25T12:00', temp: 20, rainMm: 0, rainProb: 5, code: 1, windKmh: 5, gustKmh: 10, windDir: 90, humidity: 50, cape: 0 };
    sources = fakeSources({
      alerts: async () => ({ alerts: [], complete: true }),
      strikes: async () => [],
      forecast: async () => ({ current: calm, hours: [calm] }),
    });
    await runCycle({ store, sources: wrapper, delivery });
    expect(sender.calls.map((c) => c.body.type)).toEqual(['alert.new', 'risk.raised', 'risk.cleared']);
  });

  it('respects the chosen events and level', async () => {
    const { app, store, sender, delivery } = setup();
    await subscribe(app, { events: ['alerts'], minLevel: 3 });
    await runCycle({ store, sources: fakeSources(), delivery });
    expect(sender.calls.map((c) => c.body.type)).toEqual(['alert.new']);
  });

  it('does not forget known alerts when the SMN is temporarily unavailable', async () => {
    const { app, store, sender, delivery } = setup();
    await subscribe(app, { events: ['alerts'] });
    await runCycle({ store, sources: fakeSources(), delivery });
    await runCycle({ store, sources: fakeSources({ alerts: () => Promise.reject(new Error('429')) }), delivery });
    await runCycle({ store, sources: fakeSources(), delivery });
    expect(sender.calls.map((c) => c.body.type)).toEqual(['alert.new']);
  });

  it('disables a subscription after repeated failed deliveries', async () => {
    const { app, store, delivery } = setup(fakeSources(), [500]);
    const sub = await subscribe(app);
    // Fuerza un evento nuevo en cada vuelta reiniciando la memoria.
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
      const current = (await store.get(sub.id))!;
      await store.put({ ...current, memory: { level: 0, levelAt: 0, alertIds: [] } });
      await runCycle({ store, sources: fakeSources(), delivery });
    }
    const final = (await store.get(sub.id))!;
    expect(final.status).toBe('disabled');
    expect(final.disabledReason).toMatch(/fallidos/);

    const reactivated = await app.request(`/v1/subscriptions/${sub.id}`, { ...json({ status: 'active' }, sub.secret), method: 'PATCH' });
    expect(await reactivated.json()).toMatchObject({ status: 'active', consecutiveFailures: 0 });
  });
});

describe('Open-Meteo budget and persistence', () => {
  it('stops calling Open-Meteo past the budget and keeps working without the forecast', async () => {
    let t = 0;
    const budget = new CallBudget({ perMinute: 2, perHour: 100, perDay: 100 }, () => t);
    let calls = 0;
    const base = fakeSources({ forecast: async () => { calls++; return fakeSources().forecast({ lat: 0, lng: 0 }); } });
    const sources = createCachedSources(new TtlCache(() => t), base, budget);
    await sources.forecast({ lat: -32.9, lng: -68.8 });
    await sources.forecast({ lat: -33.5, lng: -69.0 });
    await expect(sources.forecast({ lat: -34.6, lng: -68.3 })).rejects.toThrow(/Open-Meteo/);
    expect(calls).toBe(2);
    t += 61_000;
    await sources.forecast({ lat: -34.6, lng: -68.3 });
    expect(calls).toBe(3);
    expect(budget.used().lastDay).toBe(3);
  });

  it('persists subscriptions to disk and reloads them', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'alerta-')), 'subs.json');
    const a = new FileStore(path);
    const sub = { id: 'x', secret: 's' } as Subscription;
    await a.put(sub);
    const b = new FileStore(path);
    expect(await b.get('x')).toMatchObject({ id: 'x', secret: 's' });
    expect(await b.delete('x')).toBe(true);
    expect(await new FileStore(path).list()).toEqual([]);
  });
});
