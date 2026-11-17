import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';

const dark = {
  dark: true,
  bg: '#0B1220',
  surface: '#141D2E',
  surfaceAlt: '#1D283B',
  text: '#F1F5F9',
  muted: '#9AA7BA',
  border: '#27344A',
  accent: '#4FC3F7',
  onAccent: '#04121C',
  ok: '#34C77B',
  bad: '#F2685F',
};

const light: typeof dark = {
  dark: false,
  bg: '#F1F4F8',
  surface: '#FFFFFF',
  surfaceAlt: '#E7ECF3',
  text: '#0F172A',
  muted: '#566275',
  border: '#D9E0E9',
  accent: '#0A66C2',
  onAccent: '#FFFFFF',
  ok: '#16794A',
  bad: '#C0352D',
};

export type Theme = typeof dark;

const noop = () => () => {};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  // En la versión web la página se pre-renderiza en el servidor con el tema claro:
  // el primer render debe coincidir y recién después se aplica el tema del dispositivo.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  return hydrated && scheme === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };
