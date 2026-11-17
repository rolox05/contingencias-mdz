import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView as BaseWebView, type WebViewMessageEvent } from 'react-native-webview';

import { MAP_HTML } from './mapHtml';
import type { LeafletMapProps, MapCommand, MapEvent } from './types';

// El tipo por defecto del componente (`WebView<undefined>`) deja sus props en `never`.
const WebView = BaseWebView<object>;
type WebViewRef = BaseWebView<object>;

/** Mapa para Android e iOS: Leaflet dentro de un WebView. */
export function LeafletMap({ state, onTap, onFrame, ref }: LeafletMapProps) {
  const webview = useRef<WebViewRef>(null);
  const ready = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const post = useCallback((cmd: MapCommand) => {
    if (!ready.current) return;
    webview.current?.injectJavaScript(`window.__rx(${JSON.stringify(JSON.stringify(cmd))}); true;`);
  }, []);

  useEffect(() => {
    post({ type: 'state', state });
  }, [post, state]);

  useImperativeHandle(
    ref,
    () => ({ centerOn: (lat, lng, zoom) => post({ type: 'center', lat, lng, zoom }) }),
    [post],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: MapEvent;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        ready.current = true;
        post({ type: 'state', state: stateRef.current });
        const user = stateRef.current.user;
        if (user) post({ type: 'center', lat: user.lat, lng: user.lng, zoom: 9 });
      } else if (msg.type === 'tap') {
        onTap?.(msg.lat, msg.lng);
      } else if (msg.type === 'frame') {
        onFrame?.(msg.url);
      }
    },
    [onTap, onFrame, post],
  );

  return (
    <WebView
      ref={webview}
      style={styles.map}
      originWhitelist={['*']}
      source={{ html: MAP_HTML, baseUrl: 'https://localhost/' }}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      overScrollMode="never"
      setSupportMultipleWindows={false}
    />
  );
}

const styles = StyleSheet.create({
  map: { flex: 1, backgroundColor: '#0B1220' },
});
