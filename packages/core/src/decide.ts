import type { SmnAlert } from './smn';
import { formatDayTime } from './time';
import type { Risk } from './engine';
import { ALERT_COLOR_NAME, LEVELS, type Level } from './levels';


export type NotificationContent = { title: string; body: string };

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

export type Escalation = {
  /** Alertas del SMN que cubren el lugar y todavía no se informaron. */
  newAlerts: SmnAlert[];
  /** El riesgo alcanzó el nivel elegido y es mayor que el último informado. */
  raised: boolean;
  /** El riesgo bajó por debajo del nivel elegido después de haberse informado. */
  cleared: boolean;
  memory: NotifyMemory;
};

/**
 * Reglas de escalamiento, compartidas por los avisos del teléfono y los webhooks:
 * - Alertas nuevas del SMN que cubren el lugar: se informan siempre, una sola vez.
 * - Riesgo calculado: se informa cuando alcanza el nivel elegido y es mayor que el
 *   último informado. Si baja, la memoria baja con él, así una nueva suba vuelve a
 *   informarse. Pasadas 3 horas, un nivel ya informado se puede volver a informar.
 */
export function escalate(input: {
  risk: Risk;
  myAlerts: SmnAlert[];
  minLevel: Level;
  memory: NotifyMemory;
  now: number;
}): Escalation {
  const { risk, myAlerts, minLevel, now } = input;

  // Las alertas que ya vencieron se olvidan para que la memoria no crezca.
  const liveIds = new Set(myAlerts.map((a) => a.id));
  const known = input.memory.alertIds.filter((id) => liveIds.has(id));
  const newAlerts = myAlerts.filter((a) => !known.includes(a.id));

  let { level: lastLevel, levelAt } = input.memory;
  if (now - levelAt > LEVEL_MEMORY_MS) lastLevel = 0;

  const level = risk.level;
  const raised = level >= minLevel && level > lastLevel;
  const cleared = lastLevel >= minLevel && level < minLevel;
  const changed = raised || level < lastLevel;

  return {
    newAlerts,
    raised,
    cleared,
    memory: {
      level: changed ? level : lastLevel,
      levelAt: changed ? now : levelAt,
      alertIds: [...known, ...newAlerts.map((a) => a.id)],
    },
  };
}

/** Avisos del teléfono: arma los textos a partir de las reglas de `escalate`. */
export function decide(input: {
  risk: Risk;
  myAlerts: SmnAlert[];
  placeLabel: string;
  settings: NotifySettings;
  memory: NotifyMemory;
  now: number;
}): { notifications: NotificationContent[]; memory: NotifyMemory } {
  const { risk, placeLabel, now } = input;
  const result = escalate({ ...input, minLevel: input.settings.minLevel });
  const notifications: NotificationContent[] = [];
  const fresh = result.newAlerts;

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

  if (result.raised) {
    notifications.push({
      title: `${LEVELS[risk.level].name}: ${risk.headline}`,
      body: `${cap(placeLabel)}: ${risk.detail}.${risk.advice[0] ? ` ${risk.advice[0]}` : ''}`,
    });
  }

  return { notifications, memory: result.memory };
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
