import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertCard } from '@/components/AlertCard';
import { PlaceButton } from '@/components/PlacePicker';
import { Card, LevelPill, SectionTitle } from '@/components/ui';
import { compassShort, formatKm } from '@/data/geo';
import { describeCode } from '@/data/openmeteo';
import { groupAlerts } from '@/data/smn';
import { useNotify } from '@/notify/NotifyProvider';
import { loadBannerDismissed, saveBannerDismissed } from '@/notify/store';
import { formatAgo, formatTime } from '@/data/time';
import type { Hazard, HazardKey } from '@/risk/engine';
import { LEVELS, type Level } from '@/risk/levels';
import { useWeather } from '@/state/WeatherProvider';
import { radius, space, useTheme } from '@/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const HAZARD_ICONS: Record<HazardKey, IconName> = {
  hail: 'weather-hail',
  rain: 'weather-pouring',
  lightning: 'weather-lightning',
  wind: 'weather-windy',
};

const LEVEL_ICONS: Record<Level, IconName> = {
  0: 'shield-check',
  1: 'alert-circle',
  2: 'alert',
  3: 'alert-octagon',
};

export default function RiskScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const w = useWeather();
  const { risk, place } = w;
  const meta = LEVELS[risk.level];
  const mine = groupAlerts(w.myAlerts);
  const today = w.dccForecast[0];
  const notify = useNotify();
  const [bannerHidden, setBannerHidden] = useState(true);
  useEffect(() => {
    loadBannerDismissed().then(setBannerHidden);
  }, []);
  const showNotifyBanner =
    notify.supported && notify.loaded && !notify.settings.enabled && !bannerHidden && !w.loading;

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
      <View style={styles.header}>
        <PlaceButton />
        <Text style={[styles.updated, { color: t.muted }]}>
          {w.updatedAt ? `Actualizado ${formatTime(w.updatedAt)}` : 'Cargando…'}
        </Text>
      </View>

      {place.source === 'default' && !w.locating ? (
        <View style={[styles.banner, { backgroundColor: t.surfaceAlt }]}>
          <MaterialCommunityIcons name="map-marker-off-outline" size={18} color={t.muted} />
          <Text style={[styles.bannerText, { color: t.text }]}>
            Sin acceso a tu ubicación: mostramos Ciudad de Mendoza. Tocá el nombre para cambiarla.
          </Text>
        </View>
      ) : null}

      {/* Riesgo general */}
      {w.loading ? (
        <Card style={styles.loading}>
          <ActivityIndicator color={t.accent} />
          <Text style={{ color: t.muted, fontSize: 15 }}>Consultando radar, rayos y alertas…</Text>
        </Card>
      ) : (
        <View
          style={[styles.hero, { backgroundColor: meta.color }]}
          accessibilityRole="summary"
          accessibilityLabel={`Nivel de riesgo: ${meta.name}. ${risk.headline}. ${risk.detail}`}
        >
          <View style={styles.heroTop}>
            <MaterialCommunityIcons name={LEVEL_ICONS[risk.level]} size={40} color={meta.onColor} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.heroLevel, { color: meta.onColor }]}>
                {meta.name.toUpperCase()} · {meta.action}
              </Text>
              <Text style={[styles.heroHeadline, { color: meta.onColor }]}>{risk.headline}</Text>
            </View>
          </View>
          <Text style={[styles.heroDetail, { color: meta.onColor }]}>{risk.detail}</Text>
          {risk.advice.map((line) => (
            <View key={line} style={styles.adviceRow}>
              <MaterialCommunityIcons name="chevron-right" size={18} color={meta.onColor} />
              <Text style={[styles.advice, { color: meta.onColor }]}>{line}</Text>
            </View>
          ))}
        </View>
      )}

      {!w.loading
        ? risk.notes.map((note) => (
            <View key={note} style={[styles.banner, { backgroundColor: t.surfaceAlt }]}>
              <MaterialCommunityIcons name="information-outline" size={18} color={t.muted} />
              <Text style={[styles.bannerText, { color: t.text }]}>{note}</Text>
            </View>
          ))
        : null}

      {showNotifyBanner ? (
        <View style={[styles.notify, { backgroundColor: t.surface, borderColor: t.border }]}>
          <MaterialCommunityIcons name="bell-ring-outline" size={22} color={t.accent} />
          <Text style={[styles.notifyText, { color: t.text }]}>
            ¿Querés que te avise si se acerca granizo o tormenta, aunque la app esté cerrada?
          </Text>
          <View style={styles.notifyActions}>
            <Pressable
              onPress={() => notify.setEnabled(true)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.notifyButton,
                { backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={{ color: t.onAccent, fontWeight: '700', fontSize: 14 }}>Activar avisos</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setBannerHidden(true);
                saveBannerDismissed();
              }}
              accessibilityRole="button"
              style={styles.notifyButton}
            >
              <Text style={{ color: t.muted, fontWeight: '600', fontSize: 14 }}>Ahora no</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Detalle por fenómeno */}
      {!w.loading ? (
        <>
          <SectionTitle>Qué pasa cerca tuyo</SectionTitle>
          <View style={{ gap: space.sm }}>
            {risk.hazards.map((h) => (
              <HazardRow key={h.key} hazard={h} />
            ))}
          </View>
          <Pressable
            onPress={() => router.push('/mapa')}
            style={({ pressed }) => [
              styles.mapButton,
              { borderColor: t.accent, opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="radar" size={20} color={t.accent} />
            <Text style={[styles.mapButtonText, { color: t.accent }]}>Ver el radar en el mapa</Text>
          </Pressable>
        </>
      ) : null}

      {/* Alertas oficiales para el punto */}
      <SectionTitle hint="Servicio Meteorológico Nacional">Alertas en tu ubicación</SectionTitle>
      {!w.alertsLoaded ? (
        <Card style={styles.inline}>
          <ActivityIndicator color={t.accent} size="small" />
          <Text style={{ color: t.muted, fontSize: 14 }}>Buscando alertas vigentes…</Text>
        </Card>
      ) : mine.length === 0 ? (
        <Card style={styles.inline}>
          <MaterialCommunityIcons
            name={w.sources.smn?.ok === false || w.alertsPartial ? 'cloud-alert' : 'check-circle-outline'}
            size={22}
            color={w.sources.smn?.ok === false || w.alertsPartial ? t.muted : t.ok}
          />
          <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>
            {w.sources.smn?.ok === false
              ? 'No se pudieron consultar las alertas del SMN.'
              : w.alertsPartial
                ? 'Sin alertas por ahora. La consulta al SMN quedó incompleta y se reintenta sola.'
                : 'No hay alertas del SMN para este lugar.'}
          </Text>
        </Card>
      ) : (
        mine.map((a) => <AlertCard key={a.id} alert={a} mine compact />)
      )}

      {/* Condiciones actuales */}
      {w.forecast ? (
        <>
          <SectionTitle>Ahora</SectionTitle>
          <Card>
            <View style={styles.nowRow}>
              <MaterialCommunityIcons
                name={describeCode(w.forecast.current.code).icon}
                size={44}
                color={t.text}
              />
              <Text style={[styles.temp, { color: t.text }]}>
                {Math.round(w.station?.station.temp ?? w.forecast.current.temp)}°
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.nowText, { color: t.text }]}>
                  {describeCode(w.forecast.current.code).text}
                </Text>
                <Text style={[styles.nowSub, { color: t.muted }]}>
                  Humedad {Math.round(w.station?.station.humidity ?? w.forecast.current.humidity)} % ·
                  Viento {Math.round(w.forecast.current.windKmh)} km/h{' '}
                  {compassShort(w.forecast.current.windDir)}
                </Text>
              </View>
            </View>
            {w.station ? (
              <Text style={[styles.source, { color: t.muted }]}>
                Estación {w.station.station.name} (a {formatKm(w.station.km)}),{' '}
                {formatAgo(w.station.station.time)}
                {w.station.station.rainMm ? ` · lluvia ${w.station.station.rainMm} mm` : ''}
              </Text>
            ) : null}
          </Card>

          <SectionTitle hint="Pronóstico para tu punto">Próximas horas</SectionTitle>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm }}
          >
            {w.forecast.hours.slice(0, 12).map((h) => (
              <View
                key={h.time}
                style={[styles.hour, { backgroundColor: t.surface, borderColor: t.border }]}
              >
                <Text style={[styles.hourTime, { color: t.muted }]}>{h.time.slice(11, 13)} h</Text>
                <MaterialCommunityIcons name={describeCode(h.code).icon} size={26} color={t.text} />
                <Text style={[styles.hourTemp, { color: t.text }]}>{Math.round(h.temp)}°</Text>
                <Text style={[styles.hourRain, { color: h.rainProb >= 50 ? t.accent : t.muted }]}>
                  {Math.round(h.rainProb)} %
                </Text>
                <Text style={[styles.hourWind, { color: h.gustKmh >= 50 ? t.bad : t.muted }]}>
                  {Math.round(h.gustKmh)} km/h
                </Text>
              </View>
            ))}
          </ScrollView>
          <Text style={[styles.source, { color: t.muted }]}>
            Probabilidad de lluvia y ráfagas máximas por hora.
          </Text>
        </>
      ) : null}

      {today ? (
        <>
          <SectionTitle hint="Contingencias Climáticas">Pronóstico de hoy en Mendoza</SectionTitle>
          <Card style={{ gap: space.sm }}>
            {today.alert > 0 ? (
              <LevelPill
                level={today.alert === 2 ? 3 : 1}
                label={today.alert === 2 ? 'Alerta roja' : 'Alerta amarilla'}
              />
            ) : null}
            <Text style={{ color: t.text, fontSize: 15, lineHeight: 21 }}>{today.text}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              Máxima {Math.round(today.max)}° · Mínima {Math.round(today.min)}°
            </Text>
          </Card>
        </>
      ) : null}

      <Text style={[styles.footer, { color: t.muted }]}>
        App no oficial. El nivel de riesgo es una estimación automática a partir de datos públicos
        y no reemplaza los avisos de las autoridades. Emergencias: 911.
      </Text>
    </ScrollView>
  );
}

function HazardRow({ hazard }: { hazard: Hazard }) {
  const t = useTheme();
  const meta = LEVELS[hazard.level];
  return (
    <View
      style={[styles.hazard, { backgroundColor: t.surface, borderColor: t.border }]}
      accessibilityLabel={`${hazard.title}: ${meta.name}. ${hazard.summary}`}
    >
      <View style={[styles.hazardIcon, { backgroundColor: meta.color }]}>
        <MaterialCommunityIcons name={HAZARD_ICONS[hazard.key]} size={24} color={meta.onColor} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.hazardHead}>
          <Text style={[styles.hazardTitle, { color: t.text }]}>{hazard.title}</Text>
          <Text style={[styles.hazardLevel, { color: hazard.level === 0 ? t.ok : t.text }]}>
            {meta.name}
          </Text>
        </View>
        <Text style={[styles.hazardText, { color: t.muted }]}>{hazard.summary}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.md,
  },
  updated: { fontSize: 12 },
  banner: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.md,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  loading: { alignItems: 'center', gap: space.md, paddingVertical: space.xl * 1.5 },
  hero: { borderRadius: radius.lg, padding: space.lg, gap: space.sm, marginBottom: space.md },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  heroLevel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  heroHeadline: { fontSize: 24, fontWeight: '800', lineHeight: 29 },
  heroDetail: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  adviceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 2 },
  advice: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  hazard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
  hazardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hazardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  hazardTitle: { fontSize: 16, fontWeight: '700' },
  hazardLevel: { fontSize: 13, fontWeight: '700' },
  hazardText: { fontSize: 14, lineHeight: 19 },
  notify: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  notifyText: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  notifyActions: { flexDirection: 'row', gap: space.sm },
  notifyButton: {
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderRadius: radius.md,
    minHeight: 48,
    marginTop: space.md,
  },
  mapButtonText: { fontSize: 16, fontWeight: '700' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  temp: { fontSize: 40, fontWeight: '300' },
  nowText: { fontSize: 16, fontWeight: '600' },
  nowSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  source: { fontSize: 12, marginTop: space.sm, lineHeight: 17 },
  hour: {
    width: 68,
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.md,
  },
  hourTime: { fontSize: 12, fontWeight: '600' },
  hourTemp: { fontSize: 16, fontWeight: '700' },
  hourRain: { fontSize: 12, fontWeight: '600' },
  hourWind: { fontSize: 11 },
  footer: { fontSize: 12, lineHeight: 17, marginTop: space.xl, textAlign: 'center' },
});
