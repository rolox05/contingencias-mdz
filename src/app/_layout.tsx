// Define la revisión en segundo plano antes de montar cualquier pantalla.
import '@/notify/notifier';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NotifyProvider } from '@/notify/NotifyProvider';
import { WeatherProvider } from '@/state/WeatherProvider';
import { useTheme } from '@/theme';

export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <WeatherProvider>
        <NotifyProvider>
          <StatusBar style={t.dark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </NotifyProvider>
      </WeatherProvider>
    </SafeAreaProvider>
  );
}
