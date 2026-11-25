import {
  alertFromApi,
  directSources,
  fetchSmnAlerts,
  type ApiAlert,
  type DataSources,
  type SmnResult,
} from '@alerta/core';

/**
 * De dónde lee la app sus datos.
 *
 * Si `EXPO_PUBLIC_API_URL` apunta a la API de Alerta Mendoza (carpeta `server/`),
 * las alertas del SMN se leen de ahí: la API descarga cada archivo una sola vez
 * para todos los usuarios, en lugar de que cada teléfono consulte al SMN.
 * Si la API no responde, se vuelve a consultar al SMN directamente.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '') || null;

async function alertsFromApi(): Promise<SmnResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_URL}/v1/alerts`, { signal: controller.signal });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const body = (await res.json()) as { complete: boolean; alerts: ApiAlert[] };
    return { alerts: body.alerts.map(alertFromApi), complete: body.complete };
  } finally {
    clearTimeout(timer);
  }
}

async function alerts(): Promise<SmnResult> {
  if (!API_URL) return fetchSmnAlerts();
  try {
    return await alertsFromApi();
  } catch {
    return fetchSmnAlerts();
  }
}

export const appSources: DataSources = { ...directSources, alerts };
