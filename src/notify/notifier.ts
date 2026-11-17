import * as BackgroundTask from 'expo-background-task';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { assessPlace } from '@/risk/assess';

import { decide, type NotificationContent } from './decide';
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

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Riesgo climático',
    description: 'Granizo, tormentas, rayos, viento y alertas del SMN en tu ubicación',
    importance: AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 200, 300],
    lightColor: '#D7372F',
  });
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
  await Notifications.scheduleNotificationAsync({
    content: { title: content.title, body: content.body, sound: true },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
  });
}

/** Una revisión completa: calcula el riesgo y avisa si corresponde. */
export async function runCheck(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) return;
  const place = await loadPlace();
  if (!place) return;

  const { risk, myAlerts, now } = await assessPlace(place);
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
