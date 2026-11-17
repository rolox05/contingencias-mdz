import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Linking } from 'react-native';

import {
  hasNotificationPermission,
  isExpoGo,
  notificationsSupported,
  requestNotificationPermission,
  setBackgroundChecks,
  showNotification,
  type BackgroundState,
} from './notifier';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type NotifySettings } from './store';

export type NotifyStatus = {
  supported: boolean;
  settings: NotifySettings;
  loaded: boolean;
  /** El usuario negó el permiso de notificaciones. */
  denied: boolean;
  /** Estado de la revisión en segundo plano. */
  background: BackgroundState | null;
  busy: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  setMinLevel: (level: 1 | 2) => Promise<void>;
  sendTest: () => Promise<void>;
  openSettings: () => void;
};

function useNotifySettings(): NotifyStatus {
  const [settings, setSettings] = useState<NotifySettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState(false);
  const [background, setBackground] = useState<BackgroundState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSettings();
      const granted = await hasNotificationPermission();
      // Si el permiso se revocó desde el sistema, los avisos quedan apagados.
      const effective = stored.enabled && !granted ? { ...stored, enabled: false } : stored;
      // Al abrir la app se vuelve a registrar la revisión (no hace nada si ya estaba).
      const state = effective.enabled ? await setBackgroundChecks(true) : null;
      if (cancelled) return;
      setSettings(effective);
      setBackground(state);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (next: NotifySettings) => {
    setSettings(next);
    await saveSettings(next);
  }, []);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      try {
        if (enabled) {
          const granted = await requestNotificationPermission();
          setDenied(!granted);
          if (!granted) return;
        }
        setBackground(await setBackgroundChecks(enabled));
        await update({ ...settings, enabled });
      } finally {
        setBusy(false);
      }
    },
    [settings, update],
  );

  const setMinLevel = useCallback(
    (minLevel: 1 | 2) => update({ ...settings, minLevel }),
    [settings, update],
  );

  const sendTest = useCallback(async () => {
    if (!(await requestNotificationPermission())) {
      setDenied(true);
      return;
    }
    await showNotification({
      title: 'Precaución: Granizo muy cerca (prueba)',
      body: 'Así se verá un aviso. Probabilidad 80–90 % a 8 km al sudoeste. Guardá el auto bajo techo.',
    });
  }, []);

  return {
    supported: notificationsSupported,
    settings,
    loaded,
    denied,
    background: isExpoGo && settings.enabled ? 'expo-go' : background,
    busy,
    setEnabled,
    setMinLevel,
    sendTest,
    openSettings: () => Linking.openSettings(),
  };
}

const Ctx = createContext<NotifyStatus | null>(null);

/** Estado de los avisos, compartido por todas las pantallas. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useNotifySettings()}>{children}</Ctx.Provider>;
}

export function useNotify(): NotifyStatus {
  const value = useContext(Ctx);
  if (!value) throw new Error('useNotify debe usarse dentro de NotifyProvider');
  return value;
}
