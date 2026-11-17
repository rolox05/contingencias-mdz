import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { LEVELS, type Level } from '@/risk/levels';
import { radius, space, useTheme } from '@/theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.text }]} accessibilityRole="header">
        {children}
      </Text>
      {hint ? <Text style={[styles.sectionHint, { color: t.muted }]}>{hint}</Text> : null}
    </View>
  );
}

export function LevelPill({ level, label }: { level: Level; label?: string }) {
  const meta = LEVELS[level];
  return (
    <View style={[styles.pill, { backgroundColor: meta.color }]}>
      <Text style={[styles.pillText, { color: meta.onColor }]}>{label ?? meta.name}</Text>
    </View>
  );
}

export function Tag({ children, color, textColor }: { children: string; color: string; textColor: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: color }]}>
      <Text style={[styles.pillText, { color: textColor }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
  },
  section: {
    marginTop: space.xl,
    marginBottom: space.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  sectionHint: { fontSize: 12, flexShrink: 1, textAlign: 'right' },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillText: { fontSize: 12, fontWeight: '700' },
});
