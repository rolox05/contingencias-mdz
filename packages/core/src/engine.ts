import { compass, formatKm } from './geo';
import type { LightningSummary } from './lightning';
import { isHailCode, isThunder, type PointForecast } from './openmeteo';
import { describeDbz, hailRangeLabel, type NearestEcho, type RasterScan } from './radarMath';
import type { SmnAlert } from './smn';
import type { StormThreat } from './stormMotion';
import { formatDayTime } from './time';
import { ALERT_COLOR_NAME, maxLevel, type Level } from './levels';

export type HazardKey = 'hail' | 'rain' | 'lightning' | 'wind';

export type Hazard = {
  key: HazardKey;
  title: string;
  level: Level;
  /** Una línea con lo que está pasando. */
  summary: string;
  /** Título propio para el resumen general, si el fenómeno lo amerita. */
  headline?: string;
};

export type RadarInput = {
  /** El punto está dentro del área que cubre el radar. */
  covered: boolean;
  /** La última pasada tiene menos de 20 minutos. */
  fresh: boolean;
  dbz: RasterScan | null;
  hail: RasterScan | null;
  /** Tormenta más relevante para el punto, con su movimiento. */
  threat: StormThreat | null;
};

export type RiskInput = {
  now: number;
  radar: RadarInput;
  lightning: LightningSummary | null;
  /** Alertas del SMN cuyo polígono contiene al punto. */
  alerts: SmnAlert[];
  forecast: PointForecast | null;
};

export type Risk = {
  level: Level;
  headline: string;
  detail: string;
  advice: string[];
  hazards: Hazard[];
  /** Avisos sobre la calidad de los datos (radar sin datos, fuera de cobertura). */
  notes: string[];
};

export const RADAR_RINGS = [3, 10, 25, 50];

const at = (scan: RasterScan | null, km: number) => scan?.within[km] ?? -1;

function where(echo: Pick<NearestEcho, 'km' | 'bearing'>): string {
  return echo.km < 2 ? 'sobre tu ubicación' : `a ${formatKm(echo.km)} al ${compass(echo.bearing)}`;
}

function stormName(value: number): string {
  if (value >= 60) return 'Tormenta severa';
  if (value >= 54) return 'Tormenta con lluvia muy intensa';
  if (value >= 45) return 'Tormenta con lluvia fuerte';
  return 'Celda de lluvia';
}

function activeAlertLevel(alerts: SmnAlert[], kinds: SmnAlert['kind'][], now: number) {
  let level: Level = 0;
  let top: SmnAlert | null = null;
  for (const a of alerts) {
    if (!kinds.includes(a.kind) || a.onset > now || a.expires <= now) continue;
    if (a.level > level) {
      level = a.level;
      top = a;
    }
  }
  return { level, alert: top };
}

function nextAlert(alerts: SmnAlert[], kinds: SmnAlert['kind'][], now: number): SmnAlert | null {
  return (
    alerts
      .filter((a) => kinds.includes(a.kind) && a.onset > now)
      .sort((a, b) => a.onset - b.onset)[0] ?? null
  );
}

function alertPhrase(alert: SmnAlert): string {
  const what = alert.immediate ? 'Aviso a corto plazo' : `Alerta ${ALERT_COLOR_NAME[alert.level]}`;
  return `${what} del SMN`;
}

function hailHazard(input: RiskInput, radarUsable: boolean): Hazard {
  const { radar, forecast, alerts, now } = input;
  let level: Level = 0;
  let summary = radarUsable ? 'Sin granizo detectado en 50 km' : 'Sin datos de radar';

  if (radarUsable) {
    const hail = radar.hail;
    const dbz = radar.dbz;
    if ((hail?.here ?? -1) >= 50 || at(hail, 3) >= 70 || at(dbz, 3) >= 60) level = 3;
    else if (at(hail, 10) >= 50 || at(dbz, 10) >= 57) level = 2;
    else if (at(hail, 25) >= 50 || at(dbz, 25) >= 54) level = 1;

    if (hail?.nearest) {
      summary = `Probabilidad ${hailRangeLabel(hail.nearest.value)} ${where(hail.nearest)}`;
      const threat = radar.threat;
      if (threat?.trend === 'approaching' && hail.nearest.km > 3) {
        summary += threat.etaMin !== null ? `, viene hacia vos (unos ${threat.etaMin} min)` : ', viene hacia vos';
        if ((threat.etaMin ?? 99) <= 45) level = maxLevel(level, 2);
      }
    } else if (level > 0 && dbz?.nearest) {
      summary = `Tormenta intensa ${where(dbz.nearest)}: puede traer granizo`;
    }
  }

  if (level === 0) {
    const soon = forecast?.hours.slice(0, 3).some((h) => isHailCode(h.code));
    const storm = activeAlertLevel(alerts, ['tormenta'], now);
    if (soon) {
      level = 1;
      summary = 'El pronóstico marca tormentas con granizo en las próximas horas';
    } else if (storm.alert && /granizo/i.test(storm.alert.description)) {
      level = 1;
      summary = `${alertPhrase(storm.alert)} por tormentas con posible granizo`;
    }
  }
  return { key: 'hail', title: 'Granizo', level, summary };
}

function rainHazard(input: RiskInput, radarUsable: boolean): Hazard {
  const { radar, forecast, alerts, now } = input;
  let level: Level = 0;
  let summary = radarUsable ? 'Sin lluvia en el radar' : 'Sin datos de radar';

  if (radarUsable && radar.dbz) {
    const dbz = radar.dbz;
    const here = dbz.here ?? -1;
    if (here >= 54) level = 3;
    else if (here >= 45 || at(dbz, 10) >= 54) level = 2;
    else if (here >= 30 || at(dbz, 25) >= 45) level = 1;

    const overhead = (value: number) =>
      `${describeDbz(value)[0].toUpperCase()}${describeDbz(value).slice(1)} sobre tu ubicación`;
    const threat = radar.threat;
    if (here >= 45) {
      summary = overhead(here);
      if (threat?.motion && threat.km < 2) summary += `, se mueve hacia el ${compass(threat.motion.towards)}`;
    } else if (threat && threat.km >= 2) {
      summary = `${stormName(threat.value)} ${where(threat)}`;
      const speed = threat.motion ? Math.round(threat.motion.speedKmh) : 0;
      if (threat.trend === 'approaching') {
        summary +=
          threat.etaMin !== null
            ? `, viene hacia vos a ${speed} km/h; podría llegar en unos ${threat.etaMin} min`
            : `, viene hacia vos a ${speed} km/h`;
        if ((threat.etaMin ?? 99) <= 30 && threat.value >= 51) level = maxLevel(level, 2);
        else if ((threat.etaMin ?? 99) <= 60) level = maxLevel(level, 1);
      } else if (threat.trend === 'passing') {
        summary += `, pasaría al costado (va hacia el ${compass(threat.motion!.towards)})`;
      } else if (threat.trend === 'receding') {
        summary += `, se aleja hacia el ${compass(threat.motion!.towards)}`;
      }
    } else if (dbz.nearest) {
      summary = `Celda de ${describeDbz(dbz.nearest.value)} ${where(dbz.nearest)}`;
    } else if (here >= 20) {
      summary = overhead(here);
    } else if (at(dbz, 50) >= 20) {
      summary = 'Lluvias débiles en la zona';
    }
  }

  const official = activeAlertLevel(alerts, ['tormenta', 'lluvia', 'nevada'], now);
  if (official.alert && official.level > level) {
    level = official.level;
    if (!radarUsable || !input.radar.dbz?.nearest) {
      summary = `${alertPhrase(official.alert)} por ${official.alert.event.toLowerCase()}`;
    }
  }

  if (level === 0 && forecast) {
    const next = forecast.hours.slice(0, 3);
    const mm = next.reduce((sum, h) => sum + h.rainMm, 0);
    if (next.some((h) => isThunder(h.code))) {
      level = 1;
      summary = 'El pronóstico marca tormentas en las próximas 3 horas';
    } else if (mm >= 5) {
      level = 1;
      summary = `Se esperan ~${Math.round(mm)} mm en las próximas 3 horas`;
    }
  }
  return { key: 'rain', title: 'Lluvia y tormentas', level, summary };
}

function lightningHazard(input: RiskInput): Hazard {
  const l = input.lightning;
  if (!l) return { key: 'lightning', title: 'Rayos', level: 0, summary: 'Sin datos de rayos' };
  if (l.within50 === 0 || l.nearestKm === null) {
    return { key: 'lightning', title: 'Rayos', level: 0, summary: 'Sin rayos en 50 km' };
  }
  const level: Level = l.nearestKm <= 5 ? 3 : l.nearestKm <= 15 ? 2 : l.nearestKm <= 40 ? 1 : 0;
  const count = l.within50 === 1 ? '1 rayo' : `${l.within50} rayos`;
  const summary = `${count} en 50 km; el más cercano a ${formatKm(l.nearestKm)} al ${compass(l.nearestBearing ?? 0)}`;
  return { key: 'lightning', title: 'Rayos', level, summary };
}

function windHazard(input: RiskInput): Hazard {
  const { forecast, alerts, now } = input;
  let level: Level = 0;
  let summary = 'Sin datos de viento';
  let headline: string | undefined;

  if (forecast) {
    const gust = Math.max(forecast.current.gustKmh, ...forecast.hours.slice(0, 2).map((h) => h.gustKmh));
    if (gust >= 90) level = 3;
    else if (gust >= 70) level = 2;
    else if (gust >= 50) level = 1;
    summary =
      gust < 20
        ? 'Viento calmo'
        : `Ráfagas de hasta ${Math.round(gust)} km/h del ${compass(forecast.current.windDir)}`;

    // Zonda: viento fuerte del oeste, con aire muy seco. Es una estimación.
    const c = forecast.current;
    const fromWest = c.windDir >= 225 && c.windDir <= 340;
    if (fromWest && c.gustKmh >= 40 && c.humidity <= 25) {
      level = maxLevel(level, 1);
      headline = 'Posible viento Zonda';
      summary = `Condiciones tipo Zonda: ráfagas de ${Math.round(c.gustKmh)} km/h y ${Math.round(c.humidity)} % de humedad`;
    }
  }

  const official = activeAlertLevel(alerts, ['zonda', 'viento'], now);
  if (official.alert) {
    level = maxLevel(level, official.level);
    if (official.alert.kind === 'zonda') headline = 'Alerta por viento Zonda';
    summary = `${alertPhrase(official.alert)} por ${official.alert.event.toLowerCase()} vigente`;
  } else {
    const upcoming = nextAlert(alerts, ['zonda', 'viento'], now);
    if (upcoming) {
      summary += `. ${alertPhrase(upcoming)} por ${upcoming.event.toLowerCase()} desde ${formatDayTime(upcoming.onset, now)}`;
    }
  }
  return { key: 'wind', title: 'Viento y Zonda', level, summary, headline };
}

const HEADLINES: Record<HazardKey, Record<1 | 2 | 3, string>> = {
  hail: { 1: 'Posible granizo en la zona', 2: 'Granizo muy cerca', 3: 'Granizo sobre tu zona' },
  rain: { 1: 'Lluvias o tormentas cerca', 2: 'Tormenta fuerte', 3: 'Lluvia torrencial sobre tu zona' },
  lightning: { 1: 'Actividad eléctrica en la zona', 2: 'Rayos cerca', 3: 'Rayos a menos de 5 km' },
  wind: { 1: 'Viento con ráfagas', 2: 'Viento fuerte', 3: 'Viento muy fuerte' },
};

const ADVICE: Record<HazardKey, Record<1 | 2 | 3, string[]>> = {
  hail: {
    1: ['Si podés, dejá el auto bajo techo.', 'Seguí la evolución en el mapa.'],
    2: ['Guardá el auto bajo techo ahora.', 'Evitá salir hasta que pase la celda.'],
    3: [
      'Quedate bajo techo, lejos de ventanas.',
      'Si vas manejando, frená en un lugar seguro y cubierto.',
    ],
  },
  rain: {
    1: ['Llevá abrigo de lluvia y manejá con precaución.'],
    2: ['Evitá cruzar calles o badenes con agua.', 'Postergá viajes si podés.'],
    3: [
      'No cruces calles, zanjones ni cauces con agua.',
      'Alejate de zonas bajas que se inundan.',
    ],
  },
  lightning: {
    1: ['Si escuchás truenos, buscá un lugar cerrado.'],
    2: ['Entrá a un edificio o a un auto cerrado.', 'Salí de piletas, ríos y espacios abiertos.'],
    3: [
      'Quedate en un lugar cerrado hasta 30 minutos después del último trueno.',
      'No te refugies bajo árboles ni postes.',
    ],
  },
  wind: {
    1: ['Asegurá objetos que el viento pueda arrastrar.'],
    2: ['No te pares bajo árboles, carteles ni marquesinas.', 'No enciendas fuego.'],
    3: [
      'Quedate adentro y lejos de ventanas.',
      'No enciendas fuego y evitá manejar.',
    ],
  },
};

/** Ante empate de nivel, se informa primero el fenómeno más dañino. */
const PRIORITY: HazardKey[] = ['hail', 'lightning', 'rain', 'wind'];

export function computeRisk(input: RiskInput): Risk {
  const notes: string[] = [];
  const radarUsable = input.radar.covered && input.radar.fresh && input.radar.dbz !== null;
  if (!input.radar.covered) {
    notes.push('Este punto está fuera de la cobertura del radar de Mendoza.');
  } else if (!input.radar.fresh || !input.radar.dbz) {
    notes.push('El radar no tiene datos recientes: el riesgo se estima con alertas y pronóstico.');
  }

  const hazards = [
    hailHazard(input, radarUsable),
    rainHazard(input, radarUsable),
    lightningHazard(input),
    windHazard(input),
  ];
  const level = maxLevel(...hazards.map((h) => h.level));

  if (level === 0) {
    return {
      level,
      headline: 'Sin riesgo cerca tuyo',
      detail: radarUsable
        ? 'No hay tormentas, granizo ni rayos en tu zona.'
        : 'No hay alertas ni pronóstico de tormentas para tu zona.',
      advice: [],
      hazards,
      notes,
    };
  }

  const ranked = hazards
    .filter((h) => h.level > 0)
    .sort((a, b) => b.level - a.level || PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key));
  const top = ranked[0];
  const lvl = top.level as 1 | 2 | 3;

  const advice = [...ADVICE[top.key][lvl]];
  for (const other of ranked.slice(1)) {
    if (other.level >= 2) advice.push(ADVICE[other.key][other.level as 1 | 2 | 3][0]);
  }

  return {
    level,
    headline: top.headline ?? HEADLINES[top.key][lvl],
    detail: top.summary,
    advice: [...new Set(advice)].slice(0, 3),
    hazards,
    notes,
  };
}
