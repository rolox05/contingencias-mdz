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
