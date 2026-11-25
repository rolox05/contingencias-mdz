import { configureHttp } from '@alerta/core';
import { serve } from '@hono/node-server';

import { join } from 'node:path';

import { createApp } from './app';
import { TtlCache } from './cache';
import { CallBudget, createCachedSources } from './sources';
import { systemResolver } from './subscriptions/safety';
import { FileStore } from './subscriptions/store';
import { createSender, startScheduler } from './subscriptions/webhooks';

// Identificarse ante las fuentes oficiales.
configureHttp({ headers: { 'User-Agent': 'AlertaMendozaAPI/1.0 (+https://github.com/rolox05/contingencias-mdz)' } });

const cache = new TtlCache();
const forecastBudget = new CallBudget();
const sources = createCachedSources(cache, undefined, forecastBudget);

// Suscripciones con webhooks. WEBHOOKS_ALLOW_PRIVATE=true permite http:// y direcciones
// locales: solo para desarrollo.
const allowPrivate = process.env.WEBHOOKS_ALLOW_PRIVATE === 'true';
const store = new FileStore(join(process.env.DATA_DIR ?? 'data', 'subscriptions.json'));
const delivery = { send: createSender(allowPrivate) };
const app = createApp({
  sources,
  cache,
  forecastBudget,
  subscriptions: {
    store,
    delivery,
    policy: { allowPrivate, resolve: systemResolver },
    maxSubscriptions: Number(process.env.MAX_SUBSCRIPTIONS ?? 1000),
  },
});
startScheduler({ store, sources, delivery }, Number(process.env.WEBHOOK_INTERVAL_MS ?? 120_000));

// Mantiene caliente la caché de lo que cambia seguido, para que las respuestas
// no esperen a las fuentes. Los errores se ignoran: se reintenta en la próxima vuelta.
function warm() {
  sources.radar().catch(() => {});
  sources.strikes().catch(() => {});
  sources.alerts().catch(() => {});
}
warm();
setInterval(warm, 60_000).unref();

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Alerta Mendoza API en http://localhost:${info.port} (documentación en /docs)`);
});
