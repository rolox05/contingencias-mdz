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
  fetchDccForecast,
  fetchHailZones,
  fetchStations,
  nearestStation,
  type DccForecastDay,
  type HailZone,
  type Station,
} from '@/data/dcc';
import type { LatLng } from '@/data/geo';
import { fetchStrikes, type Strike } from '@/data/lightning';
import { DEFAULT_LOCALITY, describePlace, type Locality } from '@/data/localities';
import { fetchPointForecast, type PointForecast } from '@/data/openmeteo';
import type { RadarFrame } from '@/data/radar';
import { fetchSmnAlerts, type SmnAlert } from '@/data/smn';
import { overallMotion, type StormCell, type StormMotion } from '@/data/stormMotion';
import { markSeen } from '@/notify/decide';
import { savePlace } from '@/notify/notifier';
import { loadMemory, saveMemory } from '@/notify/store';
import {
  alertsForPlace,
  buildRisk,
  EMPTY_RASTERS,
  loadRadarSnapshot,
  radarIsFresh,
  type Place,
  type Rasters,
} from '@/risk/assess';
import type { Risk } from '@/risk/engine';

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
  forecast: PointForecast | null;
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
  const [locationUnavailable, setLocationUnavailable] = useState(false);

  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [rasters, setRasters] = useState<Rasters>(EMPTY_RASTERS);
  const [strikes, setStrikes] = useState<Strike[] | null>(null);
  const [alerts, setAlerts] = useState<SmnAlert[]>([]);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsPartial, setAlertsPartial] = useState(false);
  const [forecast, setForecast] = useState<PointForecast | null>(null);
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

  // ---------- Ubicación ----------
  const applyPosition = useCallback((point: LatLng | null) => {
    if (point) setPlace({ ...point, label: describePlace(point), source: 'gps' });
    setLocationUnavailable(!point);
    setLocating(false);
  }, []);

  const choosePlace = useCallback((locality: Locality) => {
    setPlace({ lat: locality.lat, lng: locality.lng, label: locality.name, source: 'manual' });
  }, []);

  const locateMe = useCallback(() => {
    setLocating(true);
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
      const point = placeRef.current;
      try {
        await Promise.all([
          run('radar', force, loadRadar),
          run('lightning', force, async () => setStrikes(await fetchStrikes())),
          run('forecast', force, async () => setForecast(await fetchPointForecast(point))),
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
          const result = await fetchSmnAlerts();
          setAlerts(result.alerts);
          setAlertsPartial(!result.complete);
          // Si quedó incompleta se reintenta en el próximo ciclo, sin esperar los 5 minutos.
          if (!result.complete) lastRun.current.smn = 0;
        } finally {
          setAlertsLoaded(true);
        }
      });
    },
    [loadRadar, run],
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

  // El pronóstico depende del punto: se vuelve a pedir al cambiar de lugar.
  const firstPlace = useRef(true);
  useEffect(() => {
    if (firstPlace.current) {
      firstPlace.current = false; // la primera carga ya la hace refresh()
      return;
    }
    let cancelled = false;
    lastRun.current.forecast = Date.now();
    fetchPointForecast(place).then(
      (f) => {
        if (cancelled) return;
        setForecast(f);
        setSources((prev) => ({ ...prev, forecast: { ok: true, at: Date.now() } }));
      },
      () => {
        if (cancelled) return;
        setSources((prev) => ({ ...prev, forecast: { ok: false, at: Date.now() } }));
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.lat, place.lng]);

  // ---------- Derivados ----------
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
      alerts, myAlerts, alertsLoaded, alertsPartial, forecast, dccForecast, station, hailZones, risk, sources,
      loading, refreshing, updatedAt, refreshNow,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
