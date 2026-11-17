import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Place } from '@/risk/assess';
import type { Level } from '@/risk/levels';

/** Datos que comparten la app abierta y la revisión en segundo plano. */

export type NotifySettings = {
  enabled: boolean;
  /** Nivel de riesgo desde el que se avisa: 1 = amarillo, 2 = naranja. */
  minLevel: 1 | 2;
};

export type NotifyMemory = {
  /** Último nivel informado (o visto con la app abierta). */
  level: Level;
  levelAt: number;
  /** Alertas del SMN ya informadas, para no repetirlas. */
  alertIds: string[];
};

export const DEFAULT_SETTINGS: NotifySettings = { enabled: false, minLevel: 2 };
const EMPTY_MEMORY: NotifyMemory = { level: 0, levelAt: 0, alertIds: [] };

const KEYS = {
  settings: 'notify-settings-v1',
  memory: 'notify-memory-v1',
  place: 'last-place-v1',
  bannerDismissed: 'notify-banner-dismissed-v1',
};

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

async function write(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento no hay memoria entre revisiones; no es grave.
  }
}

export const loadSettings = () => read(KEYS.settings, DEFAULT_SETTINGS);
export const saveSettings = (s: NotifySettings) => write(KEYS.settings, s);

export const loadMemory = () => read(KEYS.memory, EMPTY_MEMORY);
export const saveMemory = (m: NotifyMemory) => write(KEYS.memory, m);

export async function loadPlace(): Promise<Place | null> {
  const place = await read<Place | null>(KEYS.place, null);
  return place && Number.isFinite(place.lat) && Number.isFinite(place.lng) ? place : null;
}
export const savePlace = (p: Place) => write(KEYS.place, p);

export const loadBannerDismissed = () => read(KEYS.bannerDismissed, false);
export const saveBannerDismissed = () => write(KEYS.bannerDismissed, true);
