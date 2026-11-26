import * as Location from 'expo-location';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import {
  alertsForPlace,
  buildRisk,
  type DccForecastDay,
  DEFAULT_LOCALITY,
  describePlace,
  EMPTY_RASTERS,
  fetchDccForecast,
  fetchHailZones,
  fetchPointForecast,
  forecastFor,
  forecastIsStale,
  type ForecastCache,
  fetchStations,
  fetchStrikes,
  type HailZone,
  type LatLng,
  loadRadarSnapshot,
  type Locality,
  markSeen,
  nearestStation,
  overallMotion,
  pointKey,
  type Place,
  type PointForecast,
  type RadarFrame,
  radarIsFresh,
  type Rasters,
  type Risk,
  type SmnAlert,
  type Station,
  type StormCell,
  storeForecast,
  type StormMotion,
  type Strike,
} from '@alerta/core';
import { savePlace } from '@/notify/notifier';
import { appSources } from '@/sources';
import { loadMemory, saveMemory } from '@/notify/store';

export type { Place };

export type SourceKey = 'radar' | 'lightning' | 'smn' | 'forecast' | 'dcc' | 'stations';
export type SourceStatus = { ok: boolean; at: number } | undefined;

type WeatherState = {
  place: Place;
  /** Hora de la última actualización de datos (para comparar vigencias sin leer el reloj al dibujar). */
  now: number;
  locating: boolean;
  /** El usuario no dio permiso de ubicación o el GPS falló. */
  locationUnavailable: boolean;
  locateMe: () => void;
  choosePlace: (locality: Locality) => void;

  frames: RadarFrame[];
  radarFresh: boolean;
  /** Celdas de tormenta de la última pasada, con su movimiento. */
  stormCells: StormCell[];
  /** Movimiento general de las tormentas, si se pudo estimar. */
  stormDrift: StormMotion | null;
  strikes: Strike[];
  /** Alertas del SMN que alcanzan a Mendoza. */
  alerts: SmnAlert[];
  /** Alertas del SMN que cubren la ubicación elegida. */
  myAlerts: SmnAlert[];
  alertsLoaded: boolean;
  /** Faltó descargar parte de las alertas: la lista puede estar incompleta. */
  alertsPartial: boolean;
  /** Pronóstico del lugar elegido (null mientras se carga o si falló). */
  forecast: PointForecast | null;
  forecastLoading: boolean;
  /**
   * Se está cambiando de lugar: buscando la ubicación pedida por el usuario o cargando
   * el pronóstico del nuevo punto. La pantalla muestra esqueletos de carga.
   */
  placeChanging: boolean;
  dccForecast: DccForecastDay[];
  station: { station: Station; km: number } | null;
  hailZones: HailZone[];
  risk: Risk;

  sources: Partial<Record<SourceKey, SourceStatus>>;
  /** Primera carga de radar y rayos todavía en curso. */
  loading: boolean;
  refreshing: boolean;
  updatedAt: number | null;
  refresh: () => Promise<void>;
};

const Ctx = createContext<WeatherState | null>(null);

export function useWeather(): WeatherState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useWeather debe usarse dentro de WeatherProvider');
  return value;
}

const AUTO_REFRESH_MS = 2 * 60_000;

type ForecastResult = { key: string; data: PointForecast | null };

/** Cada cuánto vuelve a consultarse cada fuente, como mínimo. */
const MIN_INTERVAL: Record<SourceKey, number> = {
  radar: 60_000,
  lightning: 30_000,
  smn: 5 * 60_000,
  forecast: 10 * 60_000,
  dcc: 30 * 60_000,
  stations: 10 * 60_000,
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** Pide permiso y devuelve la posición del teléfono, o null si no se pudo obtener. */
async function findPosition(): Promise<LatLng | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;
    const position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      15000,
    );
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}

export function WeatherProvider({ children }: { children: ReactNode }) {
  const [place, setPlace] = useState<Place>({
    ...DEFAULT_LOCALITY,
    label: DEFAULT_LOCALITY.name,
    source: 'default',
  });
  const [locating, setLocating] = useState(true);
  /** El usuario pidió usar su ubicación y se está buscando (no cuenta el intento al abrir). */
  const [relocating, setRelocating] = useState(false);
  const [locationUnavailable, setLocationUnavailable] = useState(false);

  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [rasters, setRasters] = useState<Rasters>(EMPTY_RASTERS);
  const [strikes, setStrikes] = useState<Strike[] | null>(null);
  const [alerts, setAlerts] = useState<SmnAlert[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsPartial, setAlertsPartial] = useState(false);
  /** Pronósticos por lugar: nunca se muestra el de otro punto. */
  const [forecasts, setForecasts] = useState<ForecastCache<PointForecast>>({});
  /** Lugares cuyo último pedido de pronóstico falló. */
  const [forecastFailed, setForecastFailed] = useState<Record<string, boolean>>({});
  const [dccForecast, setDccForecast] = useState<DccForecastDay[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [hailZones, setHailZones] = useState<HailZone[]>([]);
  const [sources, setSources] = useState<Partial<Record<SourceKey, SourceStatus>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  }, [place]);
  const lastRun = useRef<Partial<Record<SourceKey, number>>>({});
  const busy = useRef(false);
  const forecastsRef = useRef(forecasts);
  useEffect(() => {
    forecastsRef.current = forecasts;
  }, [forecasts]);
  const forecastInFlight = useRef(new Set<string>());

  // ---------- Ubicación ----------
  const applyPosition = useCallback((point: LatLng | null) => {
    if (point) setPlace({ ...point, label: describePlace(point), source: 'gps' });
    setLocationUnavailable(!point);
    setLocating(false);
    setRelocating(false);
  }, []);

  const choosePlace = useCallback((locality: Locality) => {
    setPlace({ lat: locality.lat, lng: locality.lng, label: locality.name, source: 'manual' });
  }, []);

  const locateMe = useCallback(() => {
    setLocating(true);
    setRelocating(true);
    findPosition().then(applyPosition);
  }, [applyPosition]);

  useEffect(() => {
    let cancelled = false;
    findPosition().then((point) => {
      if (!cancelled) applyPosition(point);
    });
    return () => {
      cancelled = true;
    };
  }, [applyPosition]);

  // ---------- Carga de datos ----------
  const run = useCallback(
    async (key: SourceKey, force: boolean, task: () => Promise<void>) => {
      const last = lastRun.current[key] ?? 0;
      if (!force && Date.now() - last < MIN_INTERVAL[key]) return;
      lastRun.current[key] = Date.now();
      let ok = true;
      try {
        await task();
      } catch {
        ok = false;
      }
      setSources((prev) => ({ ...prev, [key]: { ok, at: Date.now() } }));
    },
    [],
  );

  /**
   * Pide el pronóstico de un punto si falta o tiene más de 10 minutos (o siempre, con
   * `force`). Devuelve el resultado sin tocar el estado; `applyForecast` lo guarda.
   */
  const requestForecast = useCallback(async (point: LatLng, force: boolean): Promise<ForecastResult | null> => {
    const key = pointKey(point);
    if (forecastInFlight.current.has(key)) return null;
    if (!force && !forecastIsStale(forecastsRef.current, point, Date.now(), MIN_INTERVAL.forecast)) return null;
    forecastInFlight.current.add(key);
    try {
      return { key, data: await fetchPointForecast(point) };
    } catch {
      return { key, data: null };
    } finally {
      forecastInFlight.current.delete(key);
    }
  }, []);

  /**
   * Guarda el resultado asociado a su punto: una consulta vieja que termina tarde no
   * pisa el pronóstico del lugar actual.
   */
  const applyForecast = useCallback((result: ForecastResult | null) => {
    if (!result) return;
    const { key, data } = result;
    if (data) setForecasts((prev) => storeForecast(prev, key, data, Date.now()));
    setForecastFailed((prev) => ({ ...prev, [key]: !data }));
    setSources((prev) => ({ ...prev, forecast: { ok: !!data, at: Date.now() } }));
  }, []);

  const loadRadar = useCallback(async () => {
    const snapshot = await loadRadarSnapshot();
    setFrames(snapshot.frames);
    setRasters(snapshot.rasters);
    const latest = snapshot.frames[snapshot.frames.length - 1];
    if (latest) fetchHailZones(latest.folder).then(setHailZones, () => setHailZones([]));
  }, []);

  const refresh = useCallback(
    async (force = true) => {
      if (busy.current) return;
      busy.current = true;
      try {
        await Promise.all([
          run('radar', force, loadRadar),
          run('lightning', force, async () => setStrikes(await fetchStrikes())),
          requestForecast(placeRef.current, force).then(applyForecast),
          run('stations', force, async () => setStations(await fetchStations())),
          run('dcc', force, async () => setDccForecast(await fetchDccForecast())),
        ]);
        setUpdatedAt(Date.now());
        setNow(Date.now());
      } finally {
        busy.current = false;
        setLoading(false);
        setRefreshing(false);
      }
      // Las alertas del SMN son muchos archivos: se cargan sin bloquear el resto.
      run('smn', force, async () => {
        try {
          const result = await appSources.alerts();
          setAlerts(result.alerts);
          setAlertsPartial(!result.complete);
          // Si quedó incompleta se reintenta en el próximo ciclo, sin esperar los 5 minutos.
          if (!result.complete) lastRun.current.smn = 0;
        } finally {
          setAlertsLoaded(true);
        }
      });
    },
    [applyForecast, loadRadar, requestForecast, run],
  );

  useEffect(() => {
    refresh(false);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh(false);
    }, AUTO_REFRESH_MS / 2);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh(false);
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    await refresh(true);
  }, [refresh]);

  // Al cambiar de lugar, el pronóstico del nuevo punto se pide en el momento
  // (o se usa el guardado si tiene menos de 10 minutos).
  useEffect(() => {
    requestForecast({ lat: place.lat, lng: place.lng }, false).then(applyForecast);
  }, [applyForecast, requestForecast, place.lat, place.lng]);

  // ---------- Derivados ----------
  const forecast = forecastFor(forecasts, place);
  const forecastLoading = forecast === null && !forecastFailed[pointKey(place)];
  const placeChanging = relocating || forecastLoading;

  const radarFresh = radarIsFresh(frames, now);

  const myAlerts = useMemo(() => alertsForPlace(alerts, place, now), [alerts, place, now]);

  const risk = useMemo(
    () => buildRisk({ place, now, rasters, radarFresh, strikes, myAlerts, forecast }),
    [place, rasters, radarFresh, strikes, myAlerts, forecast, now],
  );

  // ---------- Avisos ----------
  // El lugar se guarda para que la revisión en segundo plano sepa dónde mirar.
  useEffect(() => {
    savePlace(place);
  }, [place]);

  // Lo que se ve con la app abierta no se vuelve a avisar en segundo plano.
  useEffect(() => {
    if (loading || !alertsLoaded) return;
    loadMemory().then((previous) => saveMemory(markSeen({ previous, risk, myAlerts, now })));
  }, [loading, alertsLoaded, risk, myAlerts, now]);

  const station = useMemo(() => nearestStation(stations, place), [stations, place]);
  const stormDrift = useMemo(() => overallMotion(rasters.cells), [rasters.cells]);

  const value = useMemo<WeatherState>(
    () => ({
      place,
      now,
      locating,
      locationUnavailable,
      locateMe,
      choosePlace,
      frames,
      radarFresh,
      stormCells: rasters.cells,
      stormDrift,
      strikes: strikes ?? [],
      alerts,
      myAlerts,
      alertsLoaded,
      alertsPartial,
      forecast,
      forecastLoading,
      placeChanging,
      dccForecast,
      station,
      hailZones,
      risk,
      sources,
      loading,
      refreshing,
      updatedAt,
      refresh: refreshNow,
    }),
    [
      place, now, locating, locationUnavailable, locateMe, choosePlace, frames, radarFresh, rasters.cells,
      stormDrift, strikes,
      alerts, myAlerts, alertsLoaded, alertsPartial, forecast, forecastLoading, placeChanging, dccForecast, station, hailZones, risk, sources,
      loading, refreshing, updatedAt, refreshNow,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
