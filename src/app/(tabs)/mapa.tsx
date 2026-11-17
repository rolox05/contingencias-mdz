import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LeafletMap } from '@/components/map/LeafletMap';
import type { LeafletMapHandle, MapState, MotionArrow } from '@/components/map/types';
import { compass, compassShort, distanceKm } from '@/data/geo';
import { loadRaster, type RadarFrame } from '@/data/radar';
import {
  DBZ_PALETTE,
  describeDbz,
  dbzRangeLabel,
  HAIL_PALETTE,
  hailRangeLabel,
  inRadarCoverage,
  sampleAt,
} from '@/data/radarMath';
import { MOVING_KMH, type StormCell } from '@/data/stormMotion';
import { formatTime } from '@/data/time';
import { LEVELS } from '@/risk/levels';
import { useWeather } from '@/state/WeatherProvider';
import { radius, space, useTheme } from '@/theme';

type Layer = 'dbz' | 'hail' | 'swath';
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const LAYERS: { key: Layer; label: string }[] = [
  { key: 'dbz', label: 'Lluvia' },
  { key: 'hail', label: 'Granizo' },
  { key: 'swath', label: 'Granizo hoy' },
];

const frameUrl = (frame: RadarFrame | undefined, layer: Layer): string | null =>
  !frame ? null : layer === 'dbz' ? frame.dbz : layer === 'hail' ? frame.hail : frame.hailSwath;

const KM_PER_DEG_LAT = 110.9;

/** Punto al que llega una tormenta en `minutes` minutos según su movimiento. */
function project(cell: StormCell, minutes: number): [number, number] {
  const motion = cell.motion!;
  const km = Math.min(45, Math.max(5, (motion.speedKmh * minutes) / 60));
  const rad = (motion.towards * Math.PI) / 180;
  const north = km * Math.cos(rad);
  const east = km * Math.sin(rad);
  return [
    cell.lat + north / KM_PER_DEG_LAT,
    cell.lng + east / (111.32 * Math.cos((cell.lat * Math.PI) / 180)),
  ];
}

export default function MapScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { frames, radarFresh, strikes, alerts, place, now, stormCells, stormDrift } = useWeather();
  const map = useRef<LeafletMapHandle>(null);

  const [layer, setLayer] = useState<Layer>('dbz');
  /** Pasada fija elegida en pausa (null = la última). */
  const [index, setIndex] = useState<number | null>(null);
  /** El radar arranca animado. */
  const [playing, setPlaying] = useState(true);
  const [showStrikes, setShowStrikes] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);
  const [showAlerts, setShowAlerts] = useState(true);
  const [showMotion, setShowMotion] = useState(true);
  const [tap, setTap] = useState<{ lat: number; lng: number; text: string } | null>(null);
  /** Pasada que el mapa está mostrando ahora (la animación corre dentro del mapa). */
  const [shownUrl, setShownUrl] = useState<string | null>(null);

  const animated = layer !== 'swath';
  // El acumulado del día siempre se toma de la última pasada.
  const layerFrames = useMemo(() => {
    const list = animated ? frames : frames.slice(-1);
    return list
      .map((f) => ({ url: frameUrl(f, layer), time: f.time }))
      .filter((f): f is { url: string; time: number } => !!f.url);
  }, [frames, layer, animated]);

  const last = layerFrames.length - 1;
  const shownIndex = layerFrames.findIndex((f) => f.url === shownUrl);
  const current = shownIndex >= 0 ? shownIndex : last;
  const frame = layerFrames[current];
  const live = current === last;
  const isPlaying = playing && animated && focused && layerFrames.length > 1;

  useEffect(() => {
    map.current?.centerOn(place.lat, place.lng, 9);
  }, [place.lat, place.lng]);

  useEffect(() => {
    if (!tap) return;
    const timer = setTimeout(() => setTap(null), 7000);
    return () => clearTimeout(timer);
  }, [tap]);

  const moving = useMemo(
    () => stormCells.filter((c) => c.motion && c.motion.speedKmh >= MOVING_KMH),
    [stormCells],
  );

  const onTap = useCallback(
    async (lat: number, lng: number) => {
      const point = { lat, lng };
      const url = frame?.url;
      if (!url || !inRadarCoverage(point)) {
        setTap({ ...point, text: 'Fuera de la cobertura del radar' });
        return;
      }
      // Si el punto cae en una tormenta que se mueve, se agrega hacia dónde va.
      const cell = moving.find((c) => distanceKm(point, c) <= c.radiusKm + 3);
      const going = cell?.motion
        ? ` · va hacia el ${compassShort(cell.motion.towards)} a ${Math.round(cell.motion.speedKmh)} km/h`
        : '';
      try {
        const raster = await loadRaster(url);
        if (layer === 'dbz') {
          const v = sampleAt(raster, point, DBZ_PALETTE);
          setTap({
            ...point,
            text: v === null ? 'Sin lluvia en ese punto' : `${dbzRangeLabel(v)} · ${describeDbz(v)}${going}`,
          });
        } else {
          const v = sampleAt(raster, point, HAIL_PALETTE);
          setTap({
            ...point,
            text: v === null ? 'Sin granizo en ese punto' : `Granizo ${hailRangeLabel(v)}${going}`,
          });
        }
      } catch {
        setTap({ ...point, text: 'No se pudo leer el radar' });
      }
    },
    [layer, frame?.url, moving],
  );

  const motion = useMemo<MotionArrow[] | null>(() => {
    if (!showMotion || !animated) return null;
    return moving.map((c) => {
      const strong = c.maxDbz >= 45;
      return {
        from: [c.lat, c.lng],
        to: project(c, 30),
        towards: c.motion!.towards,
        label: strong ? `${Math.round(c.motion!.speedKmh)} km/h` : null,
        strong,
      };
    });
  }, [showMotion, animated, moving]);

  const state = useMemo<MapState>(
    () => ({
      radar: { frames: layerFrames, playing: isPlaying, index, opacity: 0.8 },
      motion,
      user: { lat: place.lat, lng: place.lng },
      strikes: showStrikes
        ? strikes
            .slice(0, 900)
            .map((s) => [s.lat, s.lng, Math.round(((now - s.time) / 60_000) * 10) / 10])
        : null,
      alerts: showAlerts
        ? alerts
            .filter((a) => a.onset <= now && a.expires > now)
            .map((a) => ({ color: LEVELS[a.level].color, polygons: a.polygons }))
        : [],
      satellite: showSatellite,
      tap: tap ? { lat: tap.lat, lng: tap.lng } : null,
      dark: t.dark,
    }),
    [layerFrames, isPlaying, index, motion, place.lat, place.lng, showStrikes, strikes, showAlerts, alerts, showSatellite, tap, t.dark, now],
  );

  const step = (delta: number) => {
    setPlaying(false);
    const next = Math.max(0, Math.min(last, current + delta));
    setIndex(next === last ? null : next);
  };

  const togglePlay = () => {
    if (!playing) setIndex(null);
    setPlaying((v) => !v);
  };

  const minutesBehind = frame && layerFrames[last] ? Math.round((layerFrames[last].time - frame.time) / 60_000) : 0;
  const panel = { backgroundColor: t.dark ? 'rgba(15,22,36,0.94)' : 'rgba(255,255,255,0.96)', borderColor: t.border };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <LeafletMap ref={map} state={state} onTap={onTap} onFrame={setShownUrl} />

      {/* Selector de capa */}
      <View style={[styles.top, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <View style={[styles.segment, panel]}>
          {LAYERS.map((l) => {
            const selected = l.key === layer;
            return (
              <Pressable
                key={l.key}
                onPress={() => {
                  setLayer(l.key);
                  setTap(null);
                }}
                style={[styles.segmentItem, selected && { backgroundColor: t.accent }]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.segmentText, { color: selected ? t.onAccent : t.text }]}>
                  {l.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Capas extra y centrar */}
      <View style={[styles.side, { top: insets.top + 68 }]} pointerEvents="box-none">
        <RoundButton icon="arrow-top-right-thick" label="Rumbo" active={showMotion} onPress={() => setShowMotion((v) => !v)} />
        <RoundButton icon="lightning-bolt" label="Rayos" active={showStrikes} onPress={() => setShowStrikes((v) => !v)} />
        <RoundButton icon="satellite-variant" label="Satélite" active={showSatellite} onPress={() => setShowSatellite((v) => !v)} />
        <RoundButton icon="alert-outline" label="Alertas" active={showAlerts} onPress={() => setShowAlerts((v) => !v)} />
        <RoundButton icon="crosshairs-gps" label="Centrar" onPress={() => map.current?.centerOn(place.lat, place.lng, 10)} />
      </View>

      <View style={styles.bottom} pointerEvents="box-none">
        {tap ? (
          <View style={[styles.readout, panel]}>
            <Text style={[styles.readoutText, { color: t.text }]}>{tap.text}</Text>
          </View>
        ) : null}

        <View style={[styles.dock, panel]}>
          <View style={styles.dockRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.time, { color: t.text }]}>
                {frame ? formatTime(frame.time) : '--:--'}
                {layer === 'swath' ? ' · acumulado del día' : ''}
              </Text>
              <Text style={[styles.status, { color: !radarFresh ? t.bad : live ? t.ok : t.muted }]}>
                {frames.length === 0
                  ? 'Cargando radar…'
                  : !radarFresh
                    ? 'Radar sin datos recientes'
                    : live
                      ? 'Ahora'
                      : `Hace ${minutesBehind} min`}
              </Text>
            </View>
            {animated ? (
              <View style={styles.controls}>
                <DockButton icon="skip-previous" label="Anterior" onPress={() => step(-1)} disabled={current <= 0} />
                <DockButton
                  icon={isPlaying ? 'pause' : 'play'}
                  label={isPlaying ? 'Pausar' : 'Animar la última hora'}
                  onPress={togglePlay}
                  primary
                />
                <DockButton icon="skip-next" label="Siguiente" onPress={() => step(1)} disabled={live} />
              </View>
            ) : null}
          </View>

          {animated && layerFrames.length > 1 ? (
            <View style={[styles.progress, { backgroundColor: t.surfaceAlt }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: t.accent, width: `${((current + 1) / layerFrames.length) * 100}%` },
                ]}
              />
            </View>
          ) : null}

          {showMotion && animated && stormDrift ? (
            <View style={styles.drift}>
              <View style={{ transform: [{ rotate: `${stormDrift.towards}deg` }] }}>
                <MaterialCommunityIcons name="navigation" size={16} color={t.text} />
              </View>
              <Text style={[styles.driftText, { color: t.text }]}>
                Las tormentas van hacia el {compass(stormDrift.towards)} a ~{Math.round(stormDrift.speedKmh)} km/h
              </Text>
            </View>
          ) : null}

          <Legend layer={layer} showMotion={showMotion && animated && moving.length > 0} />
        </View>
      </View>
    </View>
  );
}

function RoundButton({ icon, label, active, onPress }: { icon: IconName; label: string; active?: boolean; onPress: () => void }) {
  const t = useTheme();
  const on = active === true;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: on }}
      style={({ pressed }) => [
        styles.round,
        {
          backgroundColor: on ? t.accent : t.dark ? 'rgba(15,22,36,0.94)' : 'rgba(255,255,255,0.96)',
          borderColor: t.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={on ? t.onAccent : t.text} />
      <Text style={[styles.roundLabel, { color: on ? t.onAccent : t.muted }]}>{label}</Text>
    </Pressable>
  );
}

function DockButton({ icon, label, onPress, disabled, primary }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.dockButton,
        { backgroundColor: primary ? t.accent : t.surfaceAlt, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={primary ? t.onAccent : t.text} />
    </Pressable>
  );
}

function Legend({ layer, showMotion }: { layer: Layer; showMotion: boolean }) {
  const t = useTheme();
  const palette = layer === 'dbz' ? [...DBZ_PALETTE].reverse() : [...HAIL_PALETTE].reverse();
  const labels = layer === 'dbz' ? ['Débil', 'Moderada', 'Fuerte', 'Granizo'] : ['50 %', '70 %', '100 %'];
  return (
    <View style={{ gap: 3 }}>
      <View style={styles.legendBar}>
        {palette.map((p) => (
          <View key={p.value} style={{ flex: 1, backgroundColor: `rgb(${p.r},${p.g},${p.b})` }} />
        ))}
      </View>
      <View style={styles.legendLabels}>
        {labels.map((l) => (
          <Text key={l} style={[styles.legendText, { color: t.muted }]}>
            {l}
          </Text>
        ))}
      </View>
      <Text style={[styles.legendText, { color: t.muted }]}>
        {layer === 'dbz'
          ? 'Intensidad de lluvia. Tocá el mapa para ver el valor en un punto.'
          : layer === 'hail'
            ? 'Probabilidad de granizo estimada por el radar.'
            : 'Zonas donde el radar marcó granizo durante el día.'}
        {showMotion ? ' Las flechas muestran hacia dónde se mueve cada tormenta en los próximos 30 min.' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: space.md, right: space.md, alignItems: 'center' },
  segment: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
    gap: 2,
  },
  segmentItem: {
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  segmentText: { fontSize: 14, fontWeight: '700' },
  side: { position: 'absolute', right: space.md, gap: 6 },
  round: {
    width: 56,
    height: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  roundLabel: { fontSize: 10, fontWeight: '600' },
  bottom: { position: 'absolute', left: space.md, right: space.md, bottom: space.md, gap: space.sm },
  readout: {
    alignSelf: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  readoutText: { fontSize: 14, fontWeight: '700' },
  dock: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  time: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  status: { fontSize: 12, fontWeight: '700' },
  controls: { flexDirection: 'row', gap: 6 },
  dockButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  drift: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  driftText: { fontSize: 13, fontWeight: '700', flex: 1 },
  legendBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  legendLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  legendText: { fontSize: 11, lineHeight: 15 },
});
