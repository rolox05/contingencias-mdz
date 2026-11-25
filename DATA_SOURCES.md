# Fuentes de datos y condiciones de uso

Qué usa Alerta Mendoza de cada fuente, qué permiten sus condiciones y cómo las cumplimos.
Revisado el 25/11/2026. Si se agrega una fuente o cambia el uso (por ejemplo, monetizar),
hay que revisar esta tabla antes.

Los textos de crédito están definidos una sola vez en
[`packages/core/src/attribution.ts`](packages/core/src/attribution.ts) y los usan la app, la API,
el servidor MCP y los webhooks.

## Resumen

| Fuente | Qué usamos | Condiciones | Cómo cumplimos |
|---|---|---|---|
| Dirección de Contingencias Climáticas (DCC), Gobierno de Mendoza | Radar (reflectividad, granizo, acumulado), rayos GOES-19/GLM, zonas con granizo, pronóstico provincial, estaciones | "Uso libre y gratuito condicionado a la mención obligatoria y visible de la fuente: «Fuente: Dirección de Contingencias Climáticas - Gobierno de Mendoza»" (agrometeo.mendoza.gov.ar/mapas). Términos del Portal: la información pública se puede reutilizar; no se pueden usar escudos ni logos de forma que sugiera vínculo oficial; no afectar la disponibilidad del sitio | Mención textual en la pantalla principal, en el panel del mapa, en la atribución del mapa, en la lista de fuentes, en cada respuesta de la API (`attribution[].credit`), en el MCP y en los webhooks. Sin logos ni escudos. Aviso de "servicio no oficial, sin vínculo con el Gobierno de Mendoza". Caché en la API para no multiplicar los pedidos |
| Servicio Meteorológico Nacional (SMN) | Alertas y avisos a muy corto plazo (feed CAP público) | Contenidos bajo Creative Commons Atribución 2.5 Argentina. robots.txt: `Content-Signal: search=yes, ai-train=no, use=reference`; `ai-input` sin declarar (ni se concede ni se restringe) | Crédito con la licencia en la app, la API, el MCP y los webhooks. Cada alerta incluye el enlace a su archivo CAP (`source`). Las condiciones que viajan a agentes y webhooks prohíben usar los datos para entrenar modelos y piden citar con enlace. Nuestra API y el MCP publican un robots.txt con las mismas señales. La API descarga cada archivo CAP una sola vez para todos los usuarios y respeta los límites (429) con espera |
| Open-Meteo | Pronóstico por hora para un punto (lluvia, ráfagas, humedad) | Plan gratuito solo para uso no comercial; menos de 10.000 llamadas por día, 5.000 por hora y 600 por minuto; datos CC BY 4.0 | Proyecto no comercial. Crédito junto al pronóstico por hora y en la lista de fuentes. La API agrupa los pedidos en celdas de ~2 km con caché de 10 min y tiene un tope propio (8.000/día, 4.000/hora, 500/min); al alcanzarlo sigue funcionando sin pronóstico |
| OpenFreeMap / OpenStreetMap | Mapa base de la app | OpenFreeMap: uso gratuito, sin clave ni límites, atribución obligatoria. Datos de OpenStreetMap (ODbL): "© colaboradores de OpenStreetMap" | Atribución en el mapa y en la lista de fuentes, con enlace a openstreetmap.org/copyright |
| NASA GIBS (GOES-East) | Capa satelital opcional del mapa | Uso abierto; se pide el reconocimiento "imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's ESDIS" | Atribución en el mapa cuando la capa está activa y en la lista de fuentes |

## Cambios hechos por esta revisión

- **Mapa base**: se usaban teselas de Esri (World Topo y Dark Gray). Están bajo el Esri Master
  License Agreement y requieren cuenta y clave de Esri, así que se reemplazaron por OpenFreeMap.
  (CARTO también pide clave desde 2026.)
- **Créditos**: se agregó la mención textual de la DCC en todos los lugares donde se muestran sus
  datos, la licencia del SMN y los créditos de Open-Meteo, OpenStreetMap y NASA GIBS.
- **IA**: el MCP y los webhooks transmiten las condiciones de uso en cada resultado
  (citar con enlace, no entrenar modelos). La API y el MCP sirven un `robots.txt` con
  `ai-train=no`.
- **Carga sobre las fuentes**: el tope de Open-Meteo protege el límite del plan gratuito cuando
  hay muchas suscripciones con webhooks.

## Qué revisar si cambia el proyecto

- **Uso comercial** (cobrar, publicidad, planes pagos): Open-Meteo exige un plan comercial. Las
  licencias de la DCC y del SMN (CC BY) permiten uso comercial con atribución.
- **Tráfico alto**: avisar a la DCC sería una buena práctica, y conviene que la app consuma la
  API propia en lugar de las fuentes directamente (hoy solo las alertas pasan por la API).
- **Entrenamiento de modelos** con estos datos: no está permitido para los datos del SMN.
- **Nombre, íconos y fichas de las tiendas**: no usar escudos ni identidad visual del gobierno
  ni presentarse como app oficial.
