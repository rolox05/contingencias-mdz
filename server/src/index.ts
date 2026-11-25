import { configureHttp } from '@alerta/core';
import { serve } from '@hono/node-server';

import { createApp } from './app';
import { TtlCache } from './cache';
import { createCachedSources } from './sources';

// Identificarse ante las fuentes oficiales.
configureHttp({ headers: { 'User-Agent': 'AlertaMendozaAPI/1.0 (+https://github.com/rolox05/contingencias-mdz)' } });

const cache = new TtlCache();
const sources = createCachedSources(cache);
const app = createApp({ sources, cache });

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
