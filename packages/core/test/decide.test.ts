import { describe, expect, it } from 'vitest';

import { decide, markSeen, type NotifyMemory, type Risk, type SmnAlert } from '../src';

const H = 3600_000;
const risk = (level: 0 | 1 | 2 | 3, headline = 'Granizo muy cerca', detail = 'detalle'): Risk => ({
  level, headline, detail, advice: level ? ['Guardá el auto bajo techo ahora.'] : [], hazards: [], notes: [],
});
const alert = (id: string, now: number, level: 1 | 2 | 3 = 1): SmnAlert => ({
  id, kind: 'zonda', event: 'Viento Zonda', level, immediate: false, sent: now, onset: now + 2 * H,
  expires: now + 8 * H, description: '', instruction: '', areaDesc: '', polygons: [], url: '',
});

describe('decide (notification rules)', () => {
  it('follows the escalation rules over a sequence of checks', () => {
    let now = Date.UTC(2026, 10, 25, 18, 0);
    let memory: NotifyMemory = { level: 0, levelAt: 0, alertIds: [] };
    const settings = { enabled: true, minLevel: 2 as const };
    const step = (r: Risk, alerts: SmnAlert[] = []) => {
      now += 15 * 60_000;
      const out = decide({ risk: r, myAlerts: alerts, placeLabel: 'Godoy Cruz', settings, memory, now });
      memory = out.memory;
      return out.notifications.map((n) => n.title);
    };

    expect(step(risk(0))).toEqual([]);
    expect(step(risk(1))).toEqual([]); // por debajo del umbral naranja
    expect(step(risk(2))).toEqual(['Precaución: Granizo muy cerca']);
    expect(step(risk(2))).toEqual([]); // no repite
    expect(step(risk(3, 'Granizo sobre tu zona'))).toEqual(['Peligro: Granizo sobre tu zona']);
    expect(step(risk(0))).toEqual([]);
    expect(step(risk(2, 'Rayos cerca'))).toEqual(['Precaución: Rayos cerca']); // bajó y volvió a subir
    const z = alert('z1', now);
    expect(step(risk(2), [z])).toEqual(['Alerta amarilla por viento zonda']);
    expect(step(risk(2), [z])).toEqual([]);
    expect(step(risk(0), [z, alert('t1', now, 2), alert('t2', now)])).toEqual(['2 alertas nuevas del SMN']);
  });

  it('does not repeat what the user already saw with the app open', () => {
    const now = Date.UTC(2026, 10, 25, 18, 0);
    const seen = markSeen({ previous: { level: 0, levelAt: 0, alertIds: [] }, risk: risk(3), myAlerts: [alert('a', now)], now });
    const out = decide({ risk: risk(3), myAlerts: [alert('a', now)], placeLabel: 'Maipú', settings: { enabled: true, minLevel: 2 }, memory: seen, now: now + 60_000 });
    expect(out.notifications).toEqual([]);
  });

  it('honours the yellow threshold and writes readable bodies', () => {
    const now = Date.UTC(2026, 10, 25, 18, 0);
    const out = decide({
      risk: risk(1, 'Lluvias o tormentas cerca', 'Celda a 20 km'),
      myAlerts: [],
      placeLabel: 'a 14 km de Tunuyán',
      settings: { enabled: true, minLevel: 1 },
      memory: { level: 0, levelAt: 0, alertIds: [] },
      now,
    });
    expect(out.notifications[0].body).toBe('A 14 km de Tunuyán: Celda a 20 km. Guardá el auto bajo techo ahora.');
  });
});

describe('escalate (shared by phone notifications and webhooks)', () => {
  it('reports raised, cleared and new alerts as structured flags', async () => {
    const { escalate } = await import('../src');
    const now = Date.UTC(2026, 10, 25, 18, 0);
    const empty = { level: 0 as const, levelAt: 0, alertIds: [] };

    const up = escalate({ risk: risk(2), myAlerts: [alert('a', now)], minLevel: 2, memory: empty, now });
    expect(up.raised).toBe(true);
    expect(up.cleared).toBe(false);
    expect(up.newAlerts.map((a) => a.id)).toEqual(['a']);

    const same = escalate({ risk: risk(2), myAlerts: [alert('a', now)], minLevel: 2, memory: up.memory, now: now + 60_000 });
    expect(same.raised || same.cleared || same.newAlerts.length > 0).toBe(false);

    const down = escalate({ risk: risk(0), myAlerts: [], minLevel: 2, memory: same.memory, now: now + 120_000 });
    expect(down.cleared).toBe(true);
    expect(down.memory.level).toBe(0);
    expect(down.memory.alertIds).toEqual([]); // la alerta venció y se olvida

    const stillLow = escalate({ risk: risk(1), myAlerts: [], minLevel: 2, memory: down.memory, now: now + 180_000 });
    expect(stillLow.cleared).toBe(false);
  });
});
