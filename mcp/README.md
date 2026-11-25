# Alerta Mendoza MCP

Servidor [MCP](https://modelcontextprotocol.io) para que asistentes de IA consulten el riesgo
climático en Mendoza. Es un cliente liviano de la API (`server/`): no consulta las fuentes
oficiales por su cuenta, así que usa la caché de la API y no suma carga al SMN ni a Contingencias.

## Correr

Primero la API (puerto 8787), después el servidor MCP:

```bash
npm run dev -w @alerta/server
```

```bash
npm run dev -w @alerta/mcp          # Streamable HTTP en http://127.0.0.1:8788/mcp
```

Variables: `MCP_PORT` (8788), `MCP_HOST` (127.0.0.1; `0.0.0.0` detrás de un proxy),
`MCP_ALLOWED_HOSTS` (hosts aceptados, separados por comas: protección contra DNS rebinding),
`ALERTA_API_URL` (http://localhost:8787).

Build: `npm run build -w @alerta/mcp` genera `dist/http.js` y `dist/stdio.js` (Node 20+).

## Conectar un cliente

Claude Code, servidor remoto por HTTP:

```bash
claude mcp add --transport http alerta-mendoza http://127.0.0.1:8788/mcp
```

Clientes que lanzan el proceso (stdio), por ejemplo en la configuración de Claude Desktop:

```json
{
  "mcpServers": {
    "alerta-mendoza": {
      "command": "npx",
      "args": ["tsx", "/ruta/al/repo/mcp/src/stdio.ts"],
      "env": { "ALERTA_API_URL": "http://localhost:8787" }
    }
  }
}
```

## Herramientas

| Herramienta | Para qué |
|---|---|
| `get_risk` | Riesgo 0–3 en un punto (granizo, tormentas, rayos, viento/Zonda), tormenta más relevante con rumbo y llegada estimada, alertas que cubren el punto y calidad de los datos |
| `get_alerts` | Alertas y avisos vigentes del SMN para Mendoza; con ubicación, si la cubren y a qué distancia |
| `get_storms` | Celdas de tormenta con velocidad y rumbo; filtradas por distancia a un punto |
| `get_lightning` | Rayos recientes alrededor de un punto |
| `get_forecast` | Pronóstico provincial de la DCC y por hora para el punto |
| `get_hail_today` | Zonas con granizo detectado hoy |
| `list_places` | Localidades aceptadas por el argumento `place` |
| `create_alert_subscription` | Suscribe un webhook a un lugar (devuelve id y secreto) |
| `get_alert_subscription` | Estado y último envío de una suscripción |
| `test_alert_subscription` | Envía un evento de prueba al webhook |
| `delete_alert_subscription` | Borra una suscripción |

Recursos: `alerta://usage` (cómo leer los datos y condiciones de uso) y `alerta://alerts/active`.

Las herramientas de consulta son de solo lectura; las de suscripciones crean o borran datos y lo declaran en sus anotaciones. Los webhooks se describen en [server/README.md](../server/README.md#suscripciones-y-webhooks). Cada resultado trae un resumen en inglés, los datos
completos en `structuredContent` y las condiciones de uso de las fuentes.

## Condiciones de uso que el servidor transmite a los agentes

- Citar las fuentes con su enlace. La DCC exige la mención textual
  "Fuente: Dirección de Contingencias Climáticas - Gobierno de Mendoza".
- El SMN publica bajo CC BY 2.5 Argentina y declara en su robots.txt `ai-train=no` y
  `use=reference`: los datos no pueden usarse para entrenar modelos y cada alerta debe
  referenciar su fuente (campo `source`).
- Open-Meteo: CC BY 4.0, uso no comercial.
- Es un servicio no oficial: el nivel de riesgo es una estimación y no reemplaza los avisos oficiales.
