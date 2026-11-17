/** Mendoza usa UTC-3 todo el año. Se formatea así sin depender del huso del teléfono. */
const OFFSET_MS = -3 * 3600_000;
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const local = (ms: number) => new Date(ms + OFFSET_MS);
const pad = (n: number) => String(n).padStart(2, '0');
const dayIndex = (ms: number) => Math.floor((ms + OFFSET_MS) / 86_400_000);

/** "18:05" */
export function formatTime(ms: number): string {
  const d = local(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "hoy 18:00", "mañana 09:00" o "jue 19 15:00" */
export function formatDayTime(ms: number, now = Date.now()): string {
  const diff = dayIndex(ms) - dayIndex(now);
  const d = local(ms);
  const day =
    diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : diff === -1 ? 'ayer' : `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
  return `${day} ${formatTime(ms)}`;
}

/** "hace 3 min" */
export function formatAgo(ms: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

/** Fecha "AAAA-MM-DD" → "hoy", "mañana" o "jueves 19". */
export function formatDateLabel(date: string, now = Date.now()): string {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d, 12) - OFFSET_MS;
  const diff = dayIndex(ms) - dayIndex(now);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  return `${DAYS_LONG[local(ms).getUTCDay()]} ${d}`.replace(/^./, (c) => c.toUpperCase());
}

/** Hora UTC "HH:MM" → hora de Mendoza "HH:MM". */
export function utcClockToLocal(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${pad((h + 21) % 24)}:${pad(m)}`;
}
