export type RadarFrameRef = { url: string; time: number };

export type MotionArrow = {
  from: [number, number];
  /** Posición estimada dentro de 30 minutos. */
  to: [number, number];
  /** Rumbo hacia donde va, en grados. */
  towards: number;
  /** Texto de velocidad (solo en tormentas fuertes). */
  label: string | null;
  strong: boolean;
};

export type MapState = {
  radar: {
    frames: RadarFrameRef[];
    /** Animación en curso: el mapa recorre las pasadas solo. */
    playing: boolean;
    /** Pasada fija cuando está en pausa (null = la última). */
    index: number | null;
    opacity: number;
  };
  motion: MotionArrow[] | null;
  user: { lat: number; lng: number } | null;
  /** [lat, lng, minutos de antigüedad] o null para ocultar la capa. */
  strikes: [number, number, number][] | null;
  alerts: { color: string; polygons: [number, number][][] }[];
  satellite: boolean;
  tap: { lat: number; lng: number } | null;
  dark: boolean;
};

export type MapCommand =
  | { type: 'state'; state: MapState }
  | { type: 'center'; lat: number; lng: number; zoom?: number };

export type MapEvent =
  | { type: 'ready' }
  | { type: 'tap'; lat: number; lng: number }
  /** Pasada que se está mostrando (la animación corre dentro del mapa). */
  | { type: 'frame'; url: string };

export type LeafletMapHandle = {
  centerOn: (lat: number, lng: number, zoom?: number) => void;
};

export type LeafletMapProps = {
  state: MapState;
  onTap?: (lat: number, lng: number) => void;
  onFrame?: (url: string) => void;
  ref?: React.Ref<LeafletMapHandle>;
};
