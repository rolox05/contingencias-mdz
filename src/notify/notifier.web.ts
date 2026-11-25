import type { NotificationContent } from '@alerta/core';
import { savePlace } from './store';

/** La versión web (solo para desarrollo) no tiene avisos del sistema. */

export type BackgroundState = 'active' | 'expo-go' | 'restricted' | 'unsupported';

export const notificationsSupported = false;
export const isExpoGo = false;

export const requestNotificationPermission = async (): Promise<boolean> => false;
export const hasNotificationPermission = async (): Promise<boolean> => false;
export const showNotification = async (_content: NotificationContent): Promise<void> => {};
export const runCheck = async (): Promise<void> => {};
export const setBackgroundChecks = async (_enabled: boolean): Promise<BackgroundState> =>
  'unsupported';

export { savePlace };
