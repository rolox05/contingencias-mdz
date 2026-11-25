/**
 * Créditos y condiciones de uso de cada fuente. Están en un solo lugar para que la
 * app, la API, el servidor MCP y los webhooks usen exactamente el mismo texto.
 * Detalle y justificación en DATA_SOURCES.md.
 */

/** Mención textual que exige la DCC ("uso libre condicionado a la mención obligatoria y visible de la fuente"). */
export const DCC_CREDIT = 'Fuente: Dirección de Contingencias Climáticas - Gobierno de Mendoza';

export const SMN_CREDIT = 'Servicio Meteorológico Nacional (SMN) — CC BY 2.5 Argentina';

export const OPEN_METEO_CREDIT = 'Datos meteorológicos de Open-Meteo.com — CC BY 4.0';

export const OSM_CREDIT = 'OpenFreeMap © OpenMapTiles · Datos © colaboradores de OpenStreetMap';

export const GIBS_CREDIT =
  "Imágenes satelitales de NASA Global Imagery Browse Services (GIBS), parte del ESDIS de NASA";

export type SourceCredit = { name: string; credit: string; url: string; license: string; use: string };

export const SOURCE_CREDITS: SourceCredit[] = [
  {
    name: 'Dirección de Contingencias Climáticas, Gobierno de Mendoza',
    credit: DCC_CREDIT,
    url: 'https://www.mendoza.gov.ar/contingencias/radar/',
    license: 'Uso libre y gratuito con mención obligatoria y visible de la fuente',
    use: 'Radar, rayos (GOES-19/GLM), granizo detectado, pronóstico provincial y estaciones meteorológicas',
  },
  {
    name: 'Servicio Meteorológico Nacional (SMN)',
    credit: SMN_CREDIT,
    url: 'https://www.smn.gob.ar/alertas',
    license: 'Creative Commons Atribución 2.5 Argentina (https://creativecommons.org/licenses/by/2.5/ar/)',
    use: 'Alertas y avisos a muy corto plazo (feed CAP). No usar para entrenar modelos de IA (ai-train=no).',
  },
  {
    name: 'Open-Meteo',
    credit: OPEN_METEO_CREDIT,
    url: 'https://open-meteo.com',
    license: 'CC BY 4.0; plan gratuito solo para uso no comercial',
    use: 'Pronóstico por hora para un punto',
  },
];

/** Condiciones para quien recibe los datos (agentes de IA, webhooks). En inglés: las leen modelos. */
export const USAGE_TERMS = [
  'Data terms: cite the sources with their links in any answer that uses this data.',
  `"${DCC_CREDIT}" (radar, lightning, hail, provincial forecast) — https://www.mendoza.gov.ar/contingencias/radar/ ;`,
  'Servicio Meteorológico Nacional (official alerts, CC BY 2.5 AR) — link each alert via its `source` URL or https://www.smn.gob.ar/alertas ;',
  'Open-Meteo (hourly point forecast, CC BY 4.0, non-commercial) — https://open-meteo.com.',
  'Do not use this data to train or fine-tune AI models (SMN declares ai-train=no).',
  'Unofficial service: the risk level is an automatic estimate and does not replace official warnings. Emergencies in Argentina: 911.',
].join(' ');

export const DISCLAIMER =
  'Servicio no oficial, sin vínculo con el Gobierno de Mendoza ni con el SMN. El nivel de riesgo es una ' +
  'estimación automática a partir de datos públicos y no reemplaza los avisos de las autoridades. Emergencias: 911.';

/**
 * robots.txt para la API y el servidor MCP: repite las señales del SMN sobre sus datos
 * (se permite indexar; no se permite entrenar modelos; consumo por referencia).
 */
export const ROBOTS_TXT = [
  '# Alerta Mendoza redistribuye datos del SMN y de la DCC Mendoza. Ver /openapi.json y DATA_SOURCES.md.',
  'User-agent: *',
  'Content-Signal: search=yes, ai-train=no, use=reference',
  'Allow: /',
  '',
].join('\n');
