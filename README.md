# Alerta Mendoza

App móvil (Android e iOS) que te ubica en el mapa y te dice, en un vistazo, qué riesgo
climático tenés cerca: granizo, lluvias fuertes, rayos, viento y Zonda. Usa datos públicos
de la Dirección de Contingencias Climáticas de Mendoza, del Servicio Meteorológico Nacional
y otras fuentes abiertas.

> App no oficial. El nivel de riesgo es una estimación automática y no reemplaza los avisos
> de las autoridades. Emergencias: 911.

## Qué hace

- **Mi riesgo**: un semáforo (verde, amarillo, naranja, rojo) para tu ubicación, con el
  detalle por fenómeno, consejos, alertas oficiales que te alcanzan, condiciones actuales
  y pronóstico por hora.
- **Mapa**: radar animado (recorre los últimos ~45 minutos y se detiene en la pasada más
  nueva) sobre tu posición, con flechas que muestran hacia dónde va cada tormenta y dónde
  estaría en 30 minutos, más el rumbo general ("las tormentas van hacia el noreste a ~45
  km/h"). Capas de lluvia, probabilidad de granizo y granizo acumulado del día, rayos,
  satélite y zonas bajo alerta. Tocando un punto se lee el valor del radar y hacia dónde
  se mueve esa tormenta.
- **Alertas**: alertas del SMN para Mendoza (marcando las que cubren tu ubicación), zonas
  donde el radar detectó granizo hoy y pronóstico provincial a 5 días.

Si no das permiso de ubicación, podés elegir una localidad de la lista.

## Avisos con la app cerrada

Se activan desde **Alertas → Avisos en el teléfono** (o desde la invitación en Mi riesgo).
El sistema despierta la app cada 15 minutos o más, recalcula el riesgo en el último lugar
que viste y te avisa si:

- aparece una **alerta nueva del SMN** que cubre ese lugar (siempre), o
- el riesgo **sube** al nivel que elegiste: solo naranja y rojo (por defecto) o desde amarillo.

No repite el mismo nivel: avisa de nuevo si sube (naranja → rojo), si baja y vuelve a subir,
o si pasan más de 3 horas. Lo que ya viste con la app abierta no se vuelve a avisar.

Limitaciones:

- **No funciona en Expo Go**: hace falta la app instalada (build de desarrollo o final). En
  Expo Go sí funciona el botón *Probar un aviso*.
- **El horario lo decide el teléfono**: Android respeta bastante los 15 minutos (algunas
  marcas con ahorro de batería agresivo los demoran; ver dontkillmyapp.com). iOS decide según
  batería y uso, y puede tardar más. No sirve como alarma al minuto.
- **Usa el último lugar conocido** (no pide ubicación en segundo plano): si te movés lejos,
  abrí la app para actualizarlo.
- Si cerrás la app deslizándola en iOS, la revisión se detiene hasta que la vuelvas a abrir.

Avisos al instante y garantizados requieren un servidor que vigile los datos y mande
notificaciones push; la lógica de decisión (`src/notify/decide.ts`) se puede reutilizar ahí.

## Fuentes de datos

| Dato | Fuente |
| --- | --- |
| Radar (reflectividad, probabilidad de granizo, acumulado diario) y zonas afectadas | [DCC Mendoza](https://www.mendoza.gov.ar/contingencias/radar/), una pasada cada ~2 min |
| Rayos | Sensor GLM del satélite GOES-19, publicado por la DCC |
| Alertas y avisos a corto plazo (tormentas, lluvia, viento, Zonda, nevadas) | SMN, feed CAP público |
| Pronóstico provincial y estaciones meteorológicas | DCC Mendoza (agrometeo.mendoza.gov.ar) |
| Pronóstico por hora para tu punto (lluvia, ráfagas, humedad) | [Open-Meteo](https://open-meteo.com) |
| Imagen satelital infrarroja | NASA GIBS (GOES-East) |
| Mapa base | Esri |

## Cómo se calcula el riesgo

El cálculo está en `src/risk/engine.ts`. Para cada fenómeno se toma el peor indicio:

- **Granizo**: probabilidad de granizo del radar y núcleos muy intensos a 3, 10 y 25 km.
- **Lluvia y tormentas**: intensidad sobre tu punto y celdas cercanas. Con el movimiento de
  cada tormenta se calcula si viene hacia vos, si pasaría al costado o si se aleja, y en
  cuántos minutos llegaría.
- **Rayos**: distancia al rayo más cercano (rojo a menos de 5 km, naranja a menos de 15 km).
- **Viento y Zonda**: ráfagas previstas, alertas del SMN y una estimación de condiciones
  tipo Zonda (viento fuerte del oeste con aire muy seco).

**Movimiento de las tormentas** (`src/data/stormMotion.ts`): se separan las celdas de 35 dBZ
o más y se busca, en las pasadas de ~10 y ~20 minutos antes, el desplazamiento que mejor
calza cada una. Solo se informa el movimiento si ambas comparaciones coinciden y si no
contradice el flujo general de la zona; así se descartan los ecos de terreno de la
cordillera, que no se mueven pero cambian de forma. Es una extrapolación: las tormentas
pueden crecer, disiparse o cambiar de rumbo.

Una alerta oficial vigente sobre tu ubicación fija un piso para el fenómeno que corresponda.
Los ecos sueltos del radar (ruido, frecuente cerca de la precordillera) se descartan: un
valor solo cuenta si lo sostienen varios píxeles vecinos.

## Probarla en tu teléfono

Requiere Node 20 o superior.

```bash
npm install
```

```bash
npx expo start
```

Instalá **Expo Go** en el teléfono y escaneá el código QR que aparece en la terminal.
Todo funciona salvo los avisos con la app cerrada.

Para probar también los avisos, instalá un build de desarrollo (se compila en la nube):

```bash
npx eas-cli@latest build --profile development --platform android
```

Instalá el archivo que te da EAS en el teléfono y después corré `npx expo start` (la app se
conecta sola). En iOS hace falta una cuenta de Apple Developer y un iPhone real: las tareas en
segundo plano no corren en el simulador.

Para verla en el navegador (vista de desarrollo): `npx expo start --web`.

## Compilar para Android e iOS

No hace falta tener Xcode ni Android Studio: se compila en la nube con EAS.

```bash
npx eas-cli@latest build:configure
```

```bash
npx eas-cli@latest build --platform android
```

```bash
npx eas-cli@latest build --platform ios
```

Para compilar localmente: `npx expo run:android` (Android Studio) o `npx expo run:ios` (Xcode).

Antes de publicar en las tiendas, cambiá los identificadores `ios.bundleIdentifier` y
`android.package` de `app.json` por los tuyos.

## Comandos útiles

```bash
npm run check        # tipos (app, núcleo y servidor) + lint + tests: correrlo antes de cada cambio
npm test             # solo tests (Vitest)
npx expo-doctor      # diagnóstico del proyecto Expo
```

## Estructura

Es un monorepo con npm workspaces. La app Expo está en la raíz (así `npx expo start`
y EAS funcionan igual que siempre) y comparte la lógica con el servidor:

```
src/                  app (Expo Router)
  app/                pantallas: (tabs)/index, mapa, alertas; proxy+api.ts (solo versión web)
  components/         tarjetas, selector de ubicación y mapa (Leaflet en un WebView)
  notify/             avisos en el teléfono: revisión en segundo plano y ajustes
  state/              WeatherProvider: ubicación, actualización y datos compartidos
  setup.ts            configura el núcleo para la app (almacenamiento, proxy web)
  sources.ts          de dónde lee la app (API propia si EXPO_PUBLIC_API_URL está definida)
packages/core/        @alerta/core, sin React Native: lo usan la app y el servidor
  src/                fuentes (radar, rayos, smn, dcc, openmeteo), seguimiento de
                      tormentas, motor de riesgo, reglas de avisos
  test/               tests con imágenes de radar y archivos CAP reales como fixtures
server/               @alerta/server: API HTTP con caché (ver server/README.md)
mcp/                  @alerta/mcp: servidor MCP para agentes de IA (ver mcp/README.md)
```

## API propia

`server/` es una API (Hono + OpenAPI) que consulta las fuentes oficiales una vez por
período para todos los clientes y expone el riesgo, alertas, tormentas, rayos y
pronóstico en JSON estructurado. Detalles y endpoints en [server/README.md](server/README.md).

```bash
npm run dev -w @alerta/server     # http://localhost:8787 (documentación en /docs)
```

La API también ofrece **suscripciones con webhooks**: avisa por `POST` firmado cuando el riesgo
sube o baja en un lugar, o cuando aparece una alerta del SMN que lo cubre.

Sobre la API corre un **servidor MCP** (puerto 8788) para que asistentes de IA consulten
riesgo, alertas, tormentas y rayos: ver [mcp/README.md](mcp/README.md).

```bash
npm run dev -w @alerta/mcp        # http://127.0.0.1:8788/mcp (requiere la API corriendo)
```

Para que la app lea las alertas del SMN desde la API (y no desde cada teléfono),
copiá `.env.example` como `.env.local` y completá `EXPO_PUBLIC_API_URL`.

## Limitaciones conocidas

- **Avisos**: ver la sección *Avisos con la app cerrada*.
- **Límite de consultas del SMN**: el SMN publica cada alerta en un archivo aparte y
  bloquea por unos minutos si se piden muchos seguidos. La app guarda lo ya descargado y
  reintenta sola; mientras tanto avisa que la lista puede estar incompleta. Con muchos
  usuarios conviene un servidor intermedio que descargue las alertas una sola vez.
- **Horarios del SMN**: el feed rotula sus horas como hora argentina pero están en UTC; la
  app lo corrige (ver `src/data/smn.ts`).
- **Mapa base**: los mosaicos de Esri son aptos para pruebas; para publicar conviene
  registrar una clave propia de un proveedor de mapas.
- **Versión web**: necesita el proxy incluido porque los servidores oficiales no permiten
  consultas directas desde el navegador. Es para desarrollo, no un producto aparte.
