import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useNotify } from '@/notify/NotifyProvider';
import { LEVELS } from '@/risk/levels';
import { radius, space, useTheme } from '@/theme';

import { Card } from './ui';

const THRESHOLDS: { level: 1 | 2; label: string }[] = [
  { level: 2, label: 'Solo naranja y rojo' },
  { level: 1, label: 'Desde amarillo' },
];

/** Tarjeta para activar los avisos con la app cerrada. */
export function NotifyCard() {
  const t = useTheme();
  const notify = useNotify();
  const { settings, background } = notify;

  if (!notify.supported) {
    return (
      <Card>
        <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>
          Los avisos están disponibles en la app para Android e iOS.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="bell-ring-outline" size={24} color={t.text} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: t.text }]}>Avisarme con la app cerrada</Text>
          <Text style={[styles.sub, { color: t.muted }]}>
            Revisa tu zona cada 15 minutos o más y te avisa si aparece granizo, tormentas, rayos
            cerca o una alerta nueva del SMN.
          </Text>
        </View>
        {notify.busy || !notify.loaded ? (
          <ActivityIndicator color={t.accent} />
        ) : (
          <Switch
            value={settings.enabled}
            onValueChange={notify.setEnabled}
            trackColor={{ true: t.accent, false: t.border }}
            accessibilityLabel="Avisarme con la app cerrada"
          />
        )}
      </View>

      {notify.error ? (
        <View style={styles.notice}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={t.bad} />
          <Text style={[styles.noticeText, { color: t.text }]}>{notify.error}</Text>
        </View>
      ) : null}

      {notify.denied ? (
        <Pressable onPress={notify.openSettings} accessibilityRole="button" style={styles.notice}>
          <MaterialCommunityIcons name="bell-off-outline" size={18} color={t.bad} />
          <Text style={[styles.noticeText, { color: t.text }]}>
            Las notificaciones están bloqueadas para esta app.{' '}
            <Text style={{ color: t.accent, fontWeight: '700' }}>Abrir ajustes del teléfono</Text>
          </Text>
        </Pressable>
      ) : null}

      {settings.enabled && background === 'expo-go' ? (
        <View style={styles.notice}>
          <MaterialCommunityIcons name="information-outline" size={18} color={t.muted} />
          <Text style={[styles.noticeText, { color: t.text }]}>
            En Expo Go la revisión con la app cerrada no funciona. Andará cuando instales la app
            compilada. Mientras tanto podés probar cómo se ve un aviso.
          </Text>
        </View>
      ) : null}

      {settings.enabled && background === 'restricted' ? (
        <View style={styles.notice}>
          <MaterialCommunityIcons name="battery-alert-variant-outline" size={18} color={t.bad} />
          <Text style={[styles.noticeText, { color: t.text }]}>
            El teléfono no permite tareas en segundo plano (ahorro de batería o actualización en
            segundo plano desactivada). Habilitala en los ajustes para recibir avisos.
          </Text>
        </View>
      ) : null}

      {settings.enabled ? (
        <View style={{ gap: space.sm }}>
          <Text style={[styles.sub, { color: t.muted }]}>Avisarme por riesgo:</Text>
          <View style={styles.choices}>
            {THRESHOLDS.map((option) => {
              const selected = settings.minLevel === option.level;
              return (
                <Pressable
                  key={option.level}
                  onPress={() => notify.setMinLevel(option.level)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.choice,
                    {
                      borderColor: selected ? t.accent : t.border,
                      backgroundColor: selected ? t.surfaceAlt : 'transparent',
                    },
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: LEVELS[option.level].color }]} />
                  <Text style={{ color: t.text, fontSize: 14, fontWeight: selected ? '700' : '500' }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.sub, { color: t.muted }]}>
            Las alertas del SMN que cubren tu ubicación se avisan siempre.
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={notify.sendTest}
        accessibilityRole="button"
        style={({ pressed }) => [styles.test, { borderColor: t.accent, opacity: pressed ? 0.7 : 1 }]}
      >
        <MaterialCommunityIcons name="bell-outline" size={18} color={t.accent} />
        <Text style={{ color: t.accent, fontSize: 14, fontWeight: '700' }}>Probar un aviso</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  title: { fontSize: 16, fontWeight: '700' },
  sub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  choices: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: 40,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  test: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderRadius: radius.md,
    minHeight: 44,
  },
});
