import type { SmnAlert } from '@/data/smn';
import { formatDayTime } from '@/data/time';
import type { Risk } from '@/risk/engine';
import { ALERT_COLOR_NAME, LEVELS, type Level } from '@/risk/levels';

import type { NotifyMemory, NotifySettings } from './store';

export type NotificationContent = { title: string; body: string };

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Pasado este tiempo, un nivel ya informado se puede volver a avisar si sigue o vuelve. */
const LEVEL_MEMORY_MS = 3 * 3600_000;

function alertTitle(a: SmnAlert): string {
  if (a.immediate) return `Aviso a corto plazo: ${a.event.toLowerCase()}`;
  return `Alerta ${ALERT_COLOR_NAME[a.level]} por ${a.event.toLowerCase()}`;
}

function alertWhen(a: SmnAlert, now: number): string {
  return a.onset <= now
    ? `vigente hasta ${formatDayTime(a.expires, now)}`
    : `desde ${formatDayTime(a.onset, now)}`;
}

/**
 * Decide qué avisar a partir del riesgo actual y de lo ya informado.
 * - Alertas nuevas del SMN que cubren tu ubicación: se avisan siempre.
 * - Riesgo calculado: se avisa cuando alcanza el nivel elegido y es mayor que el
 *   último informado. Si baja, la memoria baja con él, así una nueva suba vuelve a avisar.
 */
export function decide(input: {
  risk: Risk;
  myAlerts: SmnAlert[];
  placeLabel: string;
  settings: NotifySettings;
  memory: NotifyMemory;
  now: number;
}): { notifications: NotificationContent[]; memory: NotifyMemory } {
  const { risk, myAlerts, placeLabel, settings, now } = input;
  const notifications: NotificationContent[] = [];

  // Las alertas que ya vencieron se olvidan para que la memoria no crezca.
  const liveIds = new Set(myAlerts.map((a) => a.id));
  const known = input.memory.alertIds.filter((id) => liveIds.has(id));
  const fresh = myAlerts.filter((a) => !known.includes(a.id));

  if (fresh.length === 1) {
    const a = fresh[0];
    notifications.push({
      title: alertTitle(a),
      body: `${cap(placeLabel)}: ${alertWhen(a, now)}. Fuente: SMN.`,
    });
  } else if (fresh.length > 1) {
    const top = [...fresh].sort((x, y) => y.level - x.level)[0];
    notifications.push({
      title: `${fresh.length} alertas nuevas del SMN`,
      body: `${cap(placeLabel)}: ${alertTitle(top).toLowerCase()} y otras. Abrí la app para ver el detalle.`,
    });
  }

  let { level: lastLevel, levelAt } = input.memory;
  if (now - levelAt > LEVEL_MEMORY_MS) lastLevel = 0;

  const level = risk.level;
  let memoryLevel: Level = lastLevel;
  let memoryAt = levelAt;
  if (level >= settings.minLevel && level > lastLevel) {
    notifications.push({
      title: `${LEVELS[level].name}: ${risk.headline}`,
      body: `${cap(placeLabel)}: ${risk.detail}.${risk.advice[0] ? ` ${risk.advice[0]}` : ''}`,
    });
    memoryLevel = level;
    memoryAt = now;
  } else if (level < lastLevel) {
    memoryLevel = level;
    memoryAt = now;
  }

  return {
    notifications,
    memory: { level: memoryLevel, levelAt: memoryAt, alertIds: [...known, ...fresh.map((a) => a.id)] },
  };
}

/**
 * Con la app abierta el usuario ya ve el riesgo: solo se actualiza la memoria para
 * que la revisión en segundo plano no avise de algo que ya se mostró.
 */
export function markSeen(input: {
  previous: NotifyMemory;
  risk: Risk;
  myAlerts: SmnAlert[];
  now: number;
}): NotifyMemory {
  return {
    level: input.risk.level,
    levelAt: input.now,
    alertIds: [...new Set([...input.previous.alertIds, ...input.myAlerts.map((a) => a.id)])].slice(-100),
  };
}
