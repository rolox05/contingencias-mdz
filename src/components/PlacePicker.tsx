import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LOCALITIES } from '@/data/localities';
import { useWeather } from '@/state/WeatherProvider';
import { radius, space, useTheme } from '@/theme';

/** Botón con la ubicación actual; al tocarlo permite elegir otra. */
export function PlaceButton() {
  const t = useTheme();
  const { place, locating } = useWeather();
  const [open, setOpen] = useState(false);

  const icon = place.source === 'gps' ? 'crosshairs-gps' : 'map-marker';
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Ubicación: ${place.label}. Tocar para cambiar`}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        {locating ? (
          <ActivityIndicator size="small" color={t.accent} />
        ) : (
          <MaterialCommunityIcons name={icon} size={18} color={t.accent} />
        )}
        <Text style={[styles.buttonText, { color: t.text }]} numberOfLines={1}>
          {locating ? 'Buscando tu ubicación…' : place.label}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color={t.muted} />
      </Pressable>
      <PlacePicker visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function PlacePicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { place, locateMe, choosePlace, locationUnavailable } = useWeather();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />
      <View
        style={[
          styles.sheet,
          { backgroundColor: t.bg, borderColor: t.border, paddingBottom: insets.bottom + space.md },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: t.border }]} />
        <Text style={[styles.title, { color: t.text }]}>¿Dónde querés ver el riesgo?</Text>

        <Pressable
          onPress={() => {
            locateMe();
            onClose();
          }}
          style={({ pressed }) => [
            styles.gps,
            { backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 },
          ]}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="crosshairs-gps" size={20} color={t.onAccent} />
          <Text style={[styles.gpsText, { color: t.onAccent }]}>Usar mi ubicación</Text>
        </Pressable>
        {locationUnavailable ? (
          <Text style={[styles.hint, { color: t.muted }]}>
            No pudimos obtener tu ubicación. Revisá el permiso de ubicación del teléfono o elegí una
            localidad.
          </Text>
        ) : null}

        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: space.lg }}>
          {LOCALITIES.map((l) => {
            const selected = place.source !== 'gps' && place.label === l.name;
            return (
              <Pressable
                key={l.name}
                onPress={() => {
                  choosePlace(l);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.row,
                  { borderColor: t.border, backgroundColor: pressed ? t.surfaceAlt : 'transparent' },
                ]}
                accessibilityRole="button"
              >
                <Text style={[styles.rowText, { color: t.text }]}>{l.name}</Text>
                {selected ? <MaterialCommunityIcons name="check" size={20} color={t.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    minHeight: 44,
    flexShrink: 1,
  },
  buttonText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: space.md },
  title: { fontSize: 18, fontWeight: '700', marginBottom: space.md },
  gps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    minHeight: 48,
  },
  gpsText: { fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 13, marginTop: space.sm, lineHeight: 18 },
  list: { marginTop: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { fontSize: 16 },
});
