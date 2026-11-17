import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';

import { MAP_HTML } from './mapHtml';
import type { LeafletMapProps, MapCommand, MapEvent } from './types';

/** Mapa para la versión web: la misma página de Leaflet dentro de un iframe. */
export function LeafletMap({ state, onTap, onFrame, ref }: LeafletMapProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const ready = useRef(false);
  const stateRef = useRef(state);
  const onTapRef = useRef(onTap);
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    stateRef.current = state;
    onTapRef.current = onTap;
    onFrameRef.current = onFrame;
  }, [state, onTap, onFrame]);

  const post = useCallback((cmd: MapCommand) => {
    if (!ready.current) return;
    frame.current?.contentWindow?.postMessage(JSON.stringify(cmd), '*');
  }, []);

  useEffect(() => {
    post({ type: 'state', state });
  }, [post, state]);

  useImperativeHandle(
    ref,
    () => ({ centerOn: (lat, lng, zoom) => post({ type: 'center', lat, lng, zoom }) }),
    [post],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      let msg: MapEvent;
      try {
        msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        ready.current = true;
        post({ type: 'state', state: stateRef.current });
        const user = stateRef.current.user;
        if (user) post({ type: 'center', lat: user.lat, lng: user.lng, zoom: 9 });
      } else if (msg.type === 'tap') {
        onTapRef.current?.(msg.lat, msg.lng);
      } else if (msg.type === 'frame') {
        onFrameRef.current?.(msg.url);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);

  return (
    <iframe
      ref={frame}
      srcDoc={MAP_HTML}
      title="Mapa del radar"
      style={{ border: 0, width: '100%', height: '100%', display: 'block', flex: 1 }}
    />
  );
}
