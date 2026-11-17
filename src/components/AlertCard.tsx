import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatKm } from '@/data/geo';
import { alertDistanceKm, alertLocalities, type AlertKind, type SmnAlert } from '@/data/smn';
import { formatDayTime } from '@/data/time';
import { ALERT_COLOR_NAME, LEVELS } from '@/risk/levels';
import { useWeather } from '@/state/WeatherProvider';
import { radius, space, useTheme } from '@/theme';

import { Tag } from './ui';

const ICONS: Record<AlertKind, keyof typeof MaterialCommunityIcons.glyphMap> = {
  tormenta: 'weather-lightning-rainy',
  lluvia: 'weather-pouring',
  viento: 'weather-windy',
  zonda: 'weather-windy-variant',
  nevada: 'weather-snowy-heavy',
  otro: 'alert-circle-outline',
};

const sentence = (text: string) => {
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

export function alertTitle(alert: SmnAlert): string {
  if (alert.immediate) return `Aviso a corto plazo: ${alert.event.toLowerCase()}`;
  return `Alerta ${ALERT_COLOR_NAME[alert.level]} por ${alert.event.toLowerCase()}`;
}

export function alertWhen(alert: SmnAlert, now: number): string {
  if (alert.onset <= now) return `Vigente hasta ${formatDayTime(alert.expires, now)}`;
  return `Desde ${formatDayTime(alert.onset, now)} hasta ${formatDayTime(alert.expires, now)}`;
}

export function AlertCard({
  alert,
  mine,
  compact,
}: {
  alert: SmnAlert;
  /** La alerta cubre la ubicación elegida. */
  mine: boolean;
  /** Versión corta, sin descripción ni recomendaciones. */
  compact?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const meta = LEVELS[alert.level];
  const { place, now } = useWeather();
  const active = alert.onset <= now;
  const places = mine ? [] : alertLocalities(alert);
  const km = mine ? 0 : alertDistanceKm(alert, place);

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={[styles.stripe, { backgroundColor: meta.color }]} />
      <View style={styles.body}>
        <View style={styles.head}>
          <MaterialCommunityIcons name={ICONS[alert.kind]} size={26} color={t.text} />
          <Text style={[styles.title, { color: t.text }]}>{alertTitle(alert)}</Text>
        </View>

        <View style={styles.tags}>
          <Tag color={meta.color} textColor={meta.onColor}>
            {active ? 'Vigente ahora' : 'Próxima'}
          </Tag>
          {mine ? (
            <Tag color={t.accent} textColor={t.onAccent}>
              En tu ubicación
            </Tag>
          ) : null}
        </View>

        <Text style={[styles.when, { color: t.muted }]}>{alertWhen(alert, now)}</Text>
        {!mine ? (
          <Text style={[styles.when, { color: t.muted }]}>
            {places.length > 0
              ? `Zona: ${places.slice(0, 5).join(', ')}${places.length > 5 ? ' y más' : ''}. `
              : alert.areaDesc
                ? `Zona: ${sentence(alert.areaDesc)} `
                : ''}
            La zona alertada empieza a unos {formatKm(km)} de tu ubicación.
          </Text>
        ) : null}

        {!compact && alert.description && !alert.immediate ? (
          <Text style={[styles.text, { color: t.text }]}>{alert.description}</Text>
        ) : null}

        {!compact && alert.instruction ? (
          <>
            <Pressable
              onPress={() => setOpen((v) => !v)}
              style={styles.toggle}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
            >
              <Text style={[styles.toggleText, { color: t.accent }]}>
                {open ? 'Ocultar recomendaciones' : 'Ver recomendaciones'}
              </Text>
              <MaterialCommunityIcons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={t.accent}
              />
            </Pressable>
            {open ? <Text style={[styles.text, { color: t.text }]}>{alert.instruction}</Text> : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: space.md,
  },
  stripe: { width: 6 },
  body: { flex: 1, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1, fontSize: 16, fontWeight: '700', lineHeight: 21 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  when: { fontSize: 13, lineHeight: 18 },
  text: { fontSize: 14, lineHeight: 20 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36 },
  toggleText: { fontSize: 14, fontWeight: '600' },
});
