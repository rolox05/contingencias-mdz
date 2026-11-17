import type { LatLng } from './geo';
import { fetchJson } from './http';

/** Pronóstico numérico por coordenadas (open-meteo.com, sin clave). */
const BASE = 'https://api.open-meteo.com/v1/forecast';

export type HourForecast = {
  /** Hora local de Mendoza "AAAA-MM-DDTHH:MM". */
  time: string;
  temp: number;
  rainMm: number;
  rainProb: number;
  code: number;
  windKmh: number;
  gustKmh: number;
  windDir: number;
  humidity: number;
  cape: number;
};

export type PointForecast = {
  current: HourForecast;
  hours: HourForecast[];
};

type Raw = {
  current: Record<string, number | string>;
  hourly: Record<string, (number | string)[]>;
};

const HOURLY = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'relative_humidity_2m',
  'cape',
];

export async function fetchPointForecast(p: LatLng): Promise<PointForecast> {
  const params = [
    `latitude=${p.lat.toFixed(3)}`,
    `longitude=${p.lng.toFixed(3)}`,
    `current=${HOURLY.filter((v) => v !== 'precipitation_probability').join(',')}`,
    `hourly=${HOURLY.join(',')}`,
    'forecast_hours=24',
    'timezone=America%2FArgentina%2FMendoza',
  ].join('&');
  const raw = await fetchJson<Raw>(`${BASE}?${params}`);
  const n = (v: number | string | undefined) => (typeof v === 'number' ? v : 0);

  const hours: HourForecast[] = (raw.hourly.time as string[]).map((time, i) => ({
    time,
    temp: n(raw.hourly.temperature_2m[i]),
    rainMm: n(raw.hourly.precipitation[i]),
    rainProb: n(raw.hourly.precipitation_probability[i]),
    code: n(raw.hourly.weather_code[i]),
    windKmh: n(raw.hourly.wind_speed_10m[i]),
    gustKmh: n(raw.hourly.wind_gusts_10m[i]),
    windDir: n(raw.hourly.wind_direction_10m[i]),
    humidity: n(raw.hourly.relative_humidity_2m[i]),
    cape: n(raw.hourly.cape[i]),
  }));

  const c = raw.current;
  return {
    current: {
      time: String(c.time),
      temp: n(c.temperature_2m),
      rainMm: n(c.precipitation),
      rainProb: hours[0]?.rainProb ?? 0,
      code: n(c.weather_code),
      windKmh: n(c.wind_speed_10m),
      gustKmh: n(c.wind_gusts_10m),
      windDir: n(c.wind_direction_10m),
      humidity: n(c.relative_humidity_2m),
      cape: n(c.cape),
    },
    hours,
  };
}

/** Códigos WMO que indican tormenta eléctrica (95) o tormenta con granizo (96, 99). */
export const isThunder = (code: number) => code >= 95;
export const isHailCode = (code: number) => code === 96 || code === 99;

export type WeatherIcon =
  | 'weather-sunny'
  | 'weather-partly-cloudy'
  | 'weather-cloudy'
  | 'weather-fog'
  | 'weather-rainy'
  | 'weather-pouring'
  | 'weather-snowy'
  | 'weather-lightning-rainy'
  | 'weather-hail';

export function describeCode(code: number): { text: string; icon: WeatherIcon } {
  if (code === 0) return { text: 'Despejado', icon: 'weather-sunny' };
  if (code <= 2) return { text: 'Algo nublado', icon: 'weather-partly-cloudy' };
  if (code === 3) return { text: 'Nublado', icon: 'weather-cloudy' };
  if (code <= 48) return { text: 'Niebla', icon: 'weather-fog' };
  if (code <= 57) return { text: 'Llovizna', icon: 'weather-rainy' };
  if (code <= 63) return { text: 'Lluvia', icon: 'weather-rainy' };
  if (code <= 67) return { text: 'Lluvia fuerte', icon: 'weather-pouring' };
  if (code <= 77) return { text: 'Nieve', icon: 'weather-snowy' };
  if (code <= 81) return { text: 'Chaparrones', icon: 'weather-rainy' };
  if (code === 82) return { text: 'Chaparrones fuertes', icon: 'weather-pouring' };
  if (code <= 86) return { text: 'Nevadas', icon: 'weather-snowy' };
  if (code === 95) return { text: 'Tormenta', icon: 'weather-lightning-rainy' };
  return { text: 'Tormenta con granizo', icon: 'weather-hail' };
}
