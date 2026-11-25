import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertCard } from '@/components/AlertCard';
import { NotifyCard } from '@/components/NotifyCard';
import { Card, LevelPill, SectionTitle } from '@/components/ui';
import {
  alertCovers,
  DCC_CREDIT,
  DISCLAIMER,
  formatDateLabel,
  formatTime,
  GIBS_CREDIT,
  groupAlerts,
  type HailZone,
  OPEN_METEO_CREDIT,
  OSM_CREDIT,
  SMN_CREDIT,
  utcClockToLocal,
} from '@alerta/core';
import { useWeather, type SourceKey } from '@/state/WeatherProvider';
import { radius, space, useTheme } from '@/theme';

const SOURCES: { key: SourceKey; name: string; detail: string }[] = [
  { key: 'radar', name: 'Radar meteorológico', detail: DCC_CREDIT },
  { key: 'lightning', name: 'Rayos (satélite GOES-19)', detail: DCC_CREDIT },
  { key: 'smn', name: 'Alertas oficiales', detail: SMN_CREDIT },
  { key: 'dcc', name: 'Pronóstico provincial', detail: DCC_CREDIT },
  { key: 'stations', name: 'Estaciones meteorológicas', detail: DCC_CREDIT },
  { key: 'forecast', name: 'Pronóstico por hora', detail: OPEN_METEO_CREDIT },
];

/** Créditos de capas que no tienen estado propio. */
const OTHER_CREDITS = [OSM_CREDIT, GIBS_CREDIT];

const LINKS = [
  { label: 'Radar oficial de Contingencias Climáticas', url: 'https://www.mendoza.gov.ar/contingencias/radar/' },
  { label: 'Alertas del SMN', url: 'https://www.smn.gob.ar/alertas' },
  { label: 'Licencia de los datos del SMN (CC BY 2.5 AR)', url: 'https://creativecommons.org/licenses/by/2.5/ar/' },
  { label: 'Open-Meteo', url: 'https://open-meteo.com' },
  { label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright' },
];

export default function AlertsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const w = useWeather();

  const { mine, others } = useMemo(() => {
    const here = w.alerts.filter((a) => alertCovers(a, w.place));
    const rest = w.alerts.filter((a) => !alertCovers(a, w.place));
    return { mine: groupAlerts(here), others: groupAlerts(rest) };
  }, [w.alerts, w.place]);

  const zonesByDepartment = useMemo(() => {
    const map = new Map<string, HailZone[]>();
    for (const z of w.hailZones) map.set(z.department, [...(map.get(z.department) ?? []), z]);
    return [...map.entries()].sort(
      (a, b) => b[1].reduce((s, z) => s + z.areaKm2, 0) - a[1].reduce((s, z) => s + z.areaKm2, 0),
    );
  }, [w.hailZones]);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.xl * 2,
      }}
      refreshControl={
        <RefreshControl refreshing={w.refreshing} onRefresh={w.refresh} tintColor={t.accent} />
      }
    >
      <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
        Alertas en Mendoza
      </Text>
      <Text style={[styles.subtitle, { color: t.muted }]}>
        Tormentas, lluvias, viento y Zonda. Ubicación: {w.place.label}.
      </Text>

      <SectionTitle>Avisos en el teléfono</SectionTitle>
      <NotifyCard />

      <SectionTitle hint="Servicio Meteorológico Nacional">Alertas oficiales</SectionTitle>
      {w.alertsLoaded && w.alertsPartial ? (
        <View style={[styles.partial, { backgroundColor: t.surfaceAlt }]}>
          <MaterialCommunityIcons name="information-outline" size={18} color={t.muted} />
          <Text style={{ color: t.text, fontSize: 13, lineHeight: 18, flex: 1 }}>
            La lista puede estar incompleta: el SMN limitó las consultas. Se reintenta sola en unos
            minutos.
          </Text>
        </View>
      ) : null}
      {!w.alertsLoaded ? (
        <Card style={styles.inline}>
          <ActivityIndicator color={t.accent} size="small" />
          <Text style={{ color: t.muted, fontSize: 14 }}>Buscando alertas vigentes…</Text>
        </Card>
      ) : mine.length + others.length === 0 ? (
        <Card style={styles.inline}>
          <MaterialCommunityIcons
            name={
              w.sources.smn?.ok === false
                ? 'cloud-off-outline'
                : w.alertsPartial
                  ? 'cloud-alert'
                  : 'check-circle-outline'
            }
            size={22}
            color={w.sources.smn?.ok === false ? t.bad : w.alertsPartial ? t.muted : t.ok}
          />
          <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>
            {w.sources.smn?.ok === false
              ? 'No se pudieron consultar las alertas del SMN. Deslizá hacia abajo para reintentar.'
              : w.alertsPartial
                ? 'Todavía no se encontraron alertas para Mendoza.'
                : 'No hay alertas vigentes para Mendoza.'}
          </Text>
        </Card>
      ) : (
        <>
          {mine.map((a) => (
            <AlertCard key={a.id} alert={a} mine />
          ))}
          {others.length > 0 ? (
            <Text style={[styles.group, { color: t.muted }]}>
              {mine.length > 0 ? 'En otras zonas de Mendoza' : 'Ninguna alcanza tu ubicación. En otras zonas de Mendoza:'}
            </Text>
          ) : null}
          {others.map((a) => (
            <AlertCard key={a.id} alert={a} mine={false} />
          ))}
        </>
      )}

      <SectionTitle hint="Detectado por radar">Granizo de hoy</SectionTitle>
      {zonesByDepartment.length === 0 ? (
        <Card style={styles.inline}>
          <MaterialCommunityIcons name="check-circle-outline" size={22} color={t.ok} />
          <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>
            El radar no registró granizo hoy.
          </Text>
        </Card>
      ) : (
        <Card style={{ gap: space.md }}>
          {zonesByDepartment.map(([department, zones]) => (
            <View key={department} style={{ gap: 4 }}>
              <Text style={[styles.department, { color: t.text }]}>{department}</Text>
              {zones.slice(0, 6).map((z) => (
                <View key={`${z.place}${z.startUtc}`} style={styles.zone}>
                  <Text style={[styles.zoneName, { color: t.text }]} numberOfLines={1}>
                    {z.place || 'Zona rural'}
                  </Text>
                  <Text style={[styles.zoneInfo, { color: t.muted }]}>
                    {z.startUtc ? `${utcClockToLocal(z.startUtc)}–${utcClockToLocal(z.endUtc)} · ` : ''}
                    {z.areaKm2} km²
                  </Text>
                </View>
              ))}
              {zones.length > 6 ? (
                <Text style={[styles.zoneInfo, { color: t.muted }]}>
                  y {zones.length - 6} zonas más
                </Text>
              ) : null}
            </View>
          ))}
          <Text style={[styles.note, { color: t.muted }]}>
            Reporte experimental de Contingencias Climáticas: zonas donde el radar estimó caída de
            granizo y superficie afectada.
          </Text>
        </Card>
      )}

      <SectionTitle hint="Contingencias Climáticas">Pronóstico para Mendoza</SectionTitle>
      {w.dccForecast.length === 0 ? (
        <Card>
          <Text style={{ color: t.muted, fontSize: 14 }}>Pronóstico no disponible.</Text>
        </Card>
      ) : (
        <Card style={{ gap: space.md }}>
          {w.dccForecast.map((d, i) => (
            <View
              key={d.date}
              style={[
                styles.day,
                i > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderColor: t.border,
                  paddingTop: space.md,
                },
              ]}
            >
              <View style={styles.dayHead}>
                <Text style={[styles.dayName, { color: t.text }]}>{formatDateLabel(d.date)}</Text>
                <Text style={[styles.dayTemp, { color: t.muted }]}>
                  {Math.round(d.min)}° / {Math.round(d.max)}°
                </Text>
              </View>
              {d.alert > 0 ? (
                <LevelPill
                  level={d.alert === 2 ? 3 : 1}
                  label={d.alert === 2 ? 'Alerta roja' : 'Alerta amarilla'}
                />
              ) : null}
              <Text style={{ color: t.text, fontSize: 14, lineHeight: 20 }}>{d.text}</Text>
            </View>
          ))}
        </Card>
      )}

      <SectionTitle>Fuentes de datos</SectionTitle>
      <Card style={{ gap: space.md }}>
        {SOURCES.map((s) => {
          const status = w.sources[s.key];
          return (
            <View key={s.key} style={styles.source}>
              <MaterialCommunityIcons
                name={!status ? 'clock-outline' : status.ok ? 'check-circle' : 'alert-circle'}
                size={20}
                color={!status ? t.muted : status.ok ? t.ok : t.bad}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{s.name}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>{s.detail}</Text>
              </View>
              <Text style={{ color: t.muted, fontSize: 12 }}>
                {!status ? 'Cargando' : status.ok ? formatTime(status.at) : 'Sin conexión'}
              </Text>
            </View>
          );
        })}
        {OTHER_CREDITS.map((credit) => (
          <Text key={credit} style={{ color: t.muted, fontSize: 12, lineHeight: 17 }}>
            {credit}
          </Text>
        ))}
        {LINKS.map((l) => (
          <Pressable
            key={l.url}
            onPress={() => Linking.openURL(l.url)}
            accessibilityRole="link"
            style={({ pressed }) => [
              styles.link,
              { backgroundColor: t.surfaceAlt, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={{ color: t.accent, fontSize: 14, fontWeight: '600', flex: 1 }}>{l.label}</Text>
            <MaterialCommunityIcons name="open-in-new" size={18} color={t.accent} />
          </Pressable>
        ))}
      </Card>

      <Text style={[styles.footer, { color: t.muted }]}>
        {DISCLAIMER}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800' },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  partial: {
    flexDirection: 'row',
    gap: space.sm,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.md,
  },
  group: { fontSize: 13, fontWeight: '600', marginBottom: space.sm, marginTop: space.xs },
  department: { fontSize: 15, fontWeight: '700' },
  zone: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  zoneName: { fontSize: 14, flexShrink: 1 },
  zoneInfo: { fontSize: 13, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, lineHeight: 17 },
  day: { gap: space.sm },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  dayName: { fontSize: 16, fontWeight: '700' },
  dayTemp: { fontSize: 14, fontVariant: ['tabular-nums'] },
  source: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  footer: { fontSize: 12, lineHeight: 17, marginTop: space.xl, textAlign: 'center' },
});
