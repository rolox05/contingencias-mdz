/** 0 = verde, 1 = amarillo, 2 = naranja, 3 = rojo (misma escala que usa el SMN). */
export type Level = 0 | 1 | 2 | 3;

export const LEVELS: Record<Level, { name: string; action: string; color: string; onColor: string }> = {
  0: { name: 'Sin riesgo', action: 'Tranquilidad', color: '#1F9D5B', onColor: '#FFFFFF' },
  1: { name: 'Atención', action: 'Informate', color: '#F2C230', onColor: '#2A2100' },
  2: { name: 'Precaución', action: 'Preparate', color: '#EE7D21', onColor: '#2B1200' },
  3: { name: 'Peligro', action: 'Resguardate', color: '#D7372F', onColor: '#FFFFFF' },
};

export const ALERT_COLOR_NAME: Record<1 | 2 | 3, string> = {
  1: 'amarilla',
  2: 'naranja',
  3: 'roja',
};

export const maxLevel = (...levels: Level[]): Level => Math.max(0, ...levels) as Level;
