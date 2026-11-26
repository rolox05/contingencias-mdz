import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { radius, space, useTheme } from '@/theme';

/**
 * Esqueletos de carga: bloques grises con un pulso suave que ocupan el lugar del
 * contenido mientras llega. Todos los bloques de un grupo pulsan juntos. Si el
 * usuario activó "reducir movimiento" en el teléfono, se muestran fijos.
 */

const PulseContext = createContext<Animated.Value | null>(null);

/** Agrupa esqueletos para que pulsen sincronizados y anuncia la carga a lectores de pantalla. */
export function SkeletonGroup({
  children,
  label = 'Cargando',
  style,
}: {
  children: ReactNode;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [pulse] = useState(() => new Animated.Value(0.55));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduceMotion(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.75);
      return;
    }
    const useNativeDriver = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <PulseContext.Provider value={pulse}>
      <View
        style={style}
        accessible
        accessibilityLabel={label}
        accessibilityRole="progressbar"
        accessibilityState={{ busy: true }}
      >
        {children}
      </View>
    </PulseContext.Provider>
  );
}

/** Un bloque del esqueleto. Debe ir dentro de un SkeletonGroup. */
export function Bone({
  width = '100%',
  height = 14,
  round = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  round?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const pulse = useContext(PulseContext);
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: round, backgroundColor: t.dark ? '#2A3850' : '#D5DDE8', opacity: pulse ?? 0.75 },
        style,
      ]}
    />
  );
}

// ---------- Esqueletos de cada sección de la pantalla principal ----------

/** Tarjeta grande de riesgo. */
export function RiskHeroSkeleton({ label }: { label: string }) {
  const t = useTheme();
  return (
    <SkeletonGroup label={label} style={[styles.hero, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={styles.row}>
        <Bone width={40} height={40} round={20} />
        <View style={styles.grow}>
          <Bone width="45%" height={12} />
          <Bone width="85%" height={24} style={styles.gapTop} />
        </View>
      </View>
      <Bone width="92%" height={16} style={styles.gapTop} />
      <Bone width="70%" height={14} style={styles.gapTop} />
      <Bone width="60%" height={14} style={styles.gapTopSmall} />
    </SkeletonGroup>
  );
}

/** Filas de "Qué pasa cerca tuyo". */
export function HazardListSkeleton({ rows = 4 }: { rows?: number }) {
  const t = useTheme();
  return (
    <SkeletonGroup label="Cargando el detalle por fenómeno" style={{ gap: space.sm }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.card, styles.row, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Bone width={44} height={44} round={22} />
          <View style={styles.grow}>
            <View style={styles.between}>
              <Bone width="40%" height={14} />
              <Bone width="22%" height={12} />
            </View>
            <Bone width="90%" height={12} style={styles.gapTop} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** Tarjeta "Ahora". */
export function NowSkeleton() {
  const t = useTheme();
  return (
    <SkeletonGroup label="Cargando las condiciones actuales" style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={styles.row}>
        <Bone width={44} height={44} round={22} />
        <Bone width={56} height={38} />
        <View style={styles.grow}>
          <Bone width="50%" height={14} />
          <Bone width="85%" height={12} style={styles.gapTop} />
        </View>
      </View>
      <Bone width="75%" height={11} style={styles.gapTop} />
    </SkeletonGroup>
  );
}

/** Fila horizontal de "Próximas horas". */
export function HoursSkeleton({ count = 5 }: { count?: number }) {
  const t = useTheme();
  return (
    <SkeletonGroup label="Cargando el pronóstico por hora" style={styles.hours}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.hour, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Bone width={28} height={10} />
          <Bone width={26} height={26} round={13} />
          <Bone width={30} height={14} />
          <Bone width={34} height={10} />
          <Bone width={40} height={9} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    marginBottom: space.md,
  },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  grow: { flex: 1 },
  gapTop: { marginTop: space.sm },
  gapTopSmall: { marginTop: space.xs },
  hours: { flexDirection: 'row', gap: space.sm, overflow: 'hidden' },
  hour: {
    width: 68,
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.md,
  },
});
