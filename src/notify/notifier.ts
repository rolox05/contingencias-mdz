import * as BackgroundTask from 'expo-background-task';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import '@/setup';
import { assessPlace, decide, type NotificationContent } from '@alerta/core';

import { appSources } from '@/sources';

import { loadMemory, loadPlace, loadSettings, saveMemory, savePlace } from './store';

/**
 * Avisos con la app cerrada. El sistema despierta la app cada 15 minutos o más
 * (Android lo respeta bastante; iOS decide según batería y uso), se recalcula el
 * riesgo en el último lugar conocido y se avisa si empeoró o hay alertas nuevas.
 */

export const CHECK_TASK = 'alerta-mendoza-revision';
const CHANNEL_ID = 'riesgo';
const CHECK_EVERY_MIN = 15;

export const notificationsSupported = Platform.OS !== 'web';
/** Expo Go no ejecuta tareas en segundo plano (en Android ni siquiera las registra). */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

if (notificationsSupported) {
  // Con la app abierta igual se muestra el aviso (por ejemplo, el de prueba).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

let channelReady: Promise<void> | null = null;

/**
 * Crea el canal de Android una vez por sesión. En algunas versiones el módulo
 * nativo crea el canal pero falla al devolver su descripción a JavaScript
 * (NullPointerException por un campo vacío). Ese error no impide usar el canal,
 * así que no se deja que corte el aviso.
 */
function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Riesgo climático',
    description: 'Granizo, tormentas, rayos, viento y alertas del SMN en tu ubicación',
    importance: AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 200, 300],
    lightColor: '#D7372F',
  }).then(
    () => undefined,
    (error) => console.warn('No se pudo confirmar el canal de notificaciones:', error?.message ?? error),
  );
  return channelReady;
}

/** Pide permiso para mostrar notificaciones. Devuelve true si quedó concedido. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported) return false;
  // En Android 13+ el pedido de permiso no aparece hasta que existe un canal.
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return asked.granted;
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported) return false;
  return (await Notifications.getPermissionsAsync()).granted;
}

export async function showNotification(content: NotificationContent): Promise<void> {
  await ensureChannel();
  const request = { content: { title: content.title, body: content.body, sound: true } };
  try {
    await Notifications.scheduleNotificationAsync({
      ...request,
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    // Si el canal propio no está disponible, se usa el canal por defecto.
    await Notifications.scheduleNotificationAsync({ ...request, trigger: null });
  }
}

/** Una revisión completa: calcula el riesgo y avisa si corresponde. */
export async function runCheck(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) return;
  const place = await loadPlace();
  if (!place) return;

  const { risk, myAlerts, now } = await assessPlace(place, appSources);
  const memory = await loadMemory();
  const result = decide({ risk, myAlerts, placeLabel: place.label, settings, memory, now });
  for (const n of result.notifications) await showNotification(n);
  await saveMemory(result.memory);
}

// La tarea se define al cargar el módulo: cuando el sistema despierta la app en
// segundo plano no hay pantallas montadas. Este archivo se importa en el layout raíz.
if (notificationsSupported && !TaskManager.isTaskDefined(CHECK_TASK)) {
  TaskManager.defineTask(CHECK_TASK, async () => {
    try {
      await runCheck();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export type BackgroundState = 'active' | 'expo-go' | 'restricted' | 'unsupported';

/** Activa o desactiva la revisión periódica. */
export async function setBackgroundChecks(enabled: boolean): Promise<BackgroundState> {
  if (!notificationsSupported) return 'unsupported';
  if (isExpoGo || !(await TaskManager.isAvailableAsync())) return 'expo-go';
  const registered = await TaskManager.isTaskRegisteredAsync(CHECK_TASK);
  if (!enabled) {
    if (registered) await BackgroundTask.unregisterTaskAsync(CHECK_TASK);
    return 'active';
  }
  if ((await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Restricted) {
    return 'restricted';
  }
  if (!registered) {
    await BackgroundTask.registerTaskAsync(CHECK_TASK, { minimumInterval: CHECK_EVERY_MIN });
  }
  return 'active';
}

export { savePlace };
