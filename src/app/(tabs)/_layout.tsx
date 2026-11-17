import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { LEVELS } from '@/risk/levels';
import { useWeather } from '@/state/WeatherProvider';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const t = useTheme();
  const { myAlerts, risk, now } = useWeather();
  const activeAlerts = myAlerts.filter((a) => a.onset <= now).length;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Mi riesgo',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="shield-alert-outline" color={color as string} size={size} />
          ),
          tabBarBadge: risk.level >= 2 ? '!' : undefined,
          tabBarBadgeStyle: { backgroundColor: LEVELS[risk.level].color, color: LEVELS[risk.level].onColor },
        }}
      />
      <Tabs.Screen
        name="mapa"
        options={{
          title: 'Mapa',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="radar" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="alertas"
        options={{
          title: 'Alertas',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="bell-alert-outline" color={color as string} size={size} />
          ),
          tabBarBadge: activeAlerts > 0 ? activeAlerts : undefined,
        }}
      />
    </Tabs>
  );
}
