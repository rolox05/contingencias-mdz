# Alerta Mendoza API

API HTTP sobre el núcleo compartido (`@alerta/core`). Consulta las fuentes oficiales con
caché, de modo que el SMN y Contingencias reciben un pedido por período sin importar cuántos
clientes haya, y responde en JSON estructurado pensado tanto para apps como para agentes.

## Correr

```bash
npm run dev -w @alerta/server          # desarrollo, recarga sola (puerto 8787 o $PORT)
npm run build -w @alerta/server        # genera dist/index.js (un solo archivo, Node 20+)
npm start -w @alerta/server            # corre el build
```

- Documentación interactiva: `/docs` · OpenAPI 3.1: `/openapi.json` · Estado y caché: `/health`

## Endpoints

| Método y ruta | Qué devuelve |
|---|---|
| `GET /v1/risk?lat=&lng=` o `?place=` | Nivel de riesgo (0–3), resumen por fenómeno, mediciones (radar, granizo, tormenta más relevante con rumbo y llegada estimada, rayos, condiciones actuales), alertas que cubren el punto y calidad de los datos |
| `GET /v1/alerts[?lat=&lng=&coveringOnly=true]` | Alertas y avisos vigentes del SMN para Mendoza, con polígonos GeoJSON; con ubicación, si la cubren y a qué distancia |
| `GET /v1/storms` | Celdas de tormenta de la última pasada (GeoJSON) con velocidad, rumbo y posición estimada en 30 min |
| `GET /v1/lightning?lat=&lng=&radiusKm=` | Rayos de los últimos minutos alrededor del punto |
| `GET /v1/forecast?lat=&lng=` | Pronóstico provincial de la DCC (5 días) y por hora para el punto (24 h) |
| `GET /v1/radar/frames` | Imágenes del radar de los últimos ~45 min, con límites, proyección y paletas |
| `GET /v1/hail/today` | Zonas con granizo detectado hoy (reporte experimental de la DCC) |
| `GET /v1/places` | Localidades válidas para `place` |
| `GET /v1/location?lat=&lng=` o `?place=` | Valida una ubicación y devuelve su nombre |
| `POST /v1/subscriptions` | Crea una suscripción con webhook (ver abajo) |
| `GET / PATCH / DELETE /v1/subscriptions/{id}` | Ver, modificar o reactivar, y borrar (con `Authorization: Bearer <secret>`) |
| `POST /v1/subscriptions/{id}/test` | Envía un evento de prueba al webhook |

## Convenciones

- Horas en ISO-8601 UTC. (El feed del SMN rotula sus horas como -03:00 pero están en UTC: se corrige al leerlo.)
- Distancias en km; rumbos en grados desde el norte (90 = este); GeoJSON en orden `[lng, lat]`.
- Niveles: `0 green`, `1 yellow`, `2 orange`, `3 red`. Los textos (`text`, `summary`) están en español.
- Cada respuesta incluye `attribution` (obligatoria para usar los datos de la DCC y el SMN) y,
  en `/v1/risk`, un `disclaimer`.
- **Revisar `dataQuality`**: si el radar no está fresco o las alertas están incompletas, el nivel
  puede subestimar el riesgo.
- Errores: `{ "error": { "code", "message" } }` con códigos `INVALID_PARAMS` (400),
  `UNKNOWN_PLACE` (404), `OUT_OF_AREA` (422), `UPSTREAM_UNAVAILABLE` (502).

## Caché

| Fuente | Se refresca cada |
|---|---|
| Radar y seguimiento de tormentas | 1 min |
| Rayos | 30 s |
| Alertas del SMN | 5 min |
| Pronóstico por punto (celdas de ~2 km) | 10 min |
| Pronóstico DCC | 30 min |

Si una fuente falla se sigue sirviendo el último dato bueno por un tiempo. Radar, rayos y
alertas se mantienen precargados (cada 60 s) para que las respuestas no esperen a las fuentes.
La caché es en memoria: con varias instancias, cada una tiene la suya.

## Suscripciones y webhooks

```bash
curl -X POST http://localhost:8787/v1/subscriptions -H 'Content-Type: application/json' \
  -d '{"place":"Godoy Cruz","webhookUrl":"https://example.com/hooks/alerta","minLevel":2,"events":["risk","alerts"]}'
```

La respuesta trae `id` y `secret` (se muestra **una sola vez**). Cada ~2 minutos el servidor
evalúa el lugar con las mismas reglas que los avisos del teléfono y envía un `POST` JSON cuando:

| Evento | Cuándo |
|---|---|
| `risk.raised` | El riesgo alcanza `minLevel` y es mayor que el último informado |
| `risk.cleared` | Vuelve a bajar por debajo de `minLevel` después de haberse informado |
| `alert.new` | Aparece una alerta del SMN que cubre el lugar (una sola vez por alerta) |
| `subscription.test` | Lo pediste con `/test` |

Cada envío incluye la evaluación completa (`risk`, mismo formato que `/v1/risk`), las alertas
nuevas, `attribution`, `usageTerms` y `disclaimer`. Cabeceras: `X-Alerta-Event`,
`X-Alerta-Delivery` (id único) y `X-Alerta-Signature: t=<unix>,v1=<hex>`, donde
`v1 = HMAC-SHA256(secret, "<t>.<cuerpo>")`. Verificá la firma y rechazá `t` viejos.

Para verificar en Node:

```js
const [t, v1] = req.headers['x-alerta-signature'].split(',').map((p) => p.split('=')[1]);
const ok = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex') === v1;
```

- Reintentos: 3 intentos (ahora, a los 10 s y al minuto) ante errores 5xx, 408, 429 o de red.
  Tras 10 envíos fallidos seguidos la suscripción se desactiva; se reactiva con
  `PATCH {"status":"active"}`.
- Seguridad: solo URLs `https` públicas. Se rechazan direcciones privadas, de loopback y de
  metadatos de la nube, tanto al crear como al conectar (protección contra SSRF y DNS
  rebinding). `WEBHOOKS_ALLOW_PRIVATE=true` lo desactiva: solo para desarrollo.
- Límites: `MAX_SUBSCRIPTIONS` (1000) en total y 20 altas por hora por dirección IP.
- Datos: se guardan en `DATA_DIR/subscriptions.json` (`DATA_DIR=data` por defecto, permisos 600).
  Con más de una instancia hace falta una base compartida.
- Open-Meteo: cada lugar distinto consulta el pronóstico. Hay un tope (8.000 por día,
  4.000 por hora, 500 por minuto) por debajo del límite del plan gratuito; si se alcanza, el
  riesgo se calcula sin el pronóstico. El uso actual se ve en `/health`.

Variables: `PORT` (8787), `DATA_DIR`, `MAX_SUBSCRIPTIONS`, `WEBHOOK_INTERVAL_MS` (120000),
`WEBHOOKS_ALLOW_PRIVATE`.
