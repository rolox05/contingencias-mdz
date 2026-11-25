import { RADAR_BOUNDS } from '@alerta/core';

/**
 * Página del mapa (Leaflet). En Android/iOS corre dentro de un WebView y en la
 * versión web dentro de un iframe. Recibe comandos por `window.__rx` y avisa
 * eventos con postMessage.
 */
export const MAP_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; }
  body { background: #0B1220; font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; }
  .radar-img { image-rendering: pixelated; image-rendering: crisp-edges; }
  .ring-label {
    font-size: 10px; font-weight: 700; color: #0A66C2; white-space: nowrap;
    text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff;
  }
  .leaflet-control-attribution { font-size: 9px; opacity: 0.75; }
  .radar-img { transition: opacity 0.18s linear; }
  .storm-head svg { display: block; }
  .storm-speed {
    font-size: 11px; font-weight: 800; color: #fff; white-space: nowrap;
    background: rgba(10, 16, 28, 0.85); border-radius: 8px; padding: 1px 6px;
    border: 1px solid rgba(255, 255, 255, 0.5);
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var BOUNDS = [[${RADAR_BOUNDS.south}, ${RADAR_BOUNDS.west}], [${RADAR_BOUNDS.north}, ${RADAR_BOUNDS.east}]];
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';

  function send(msg) {
    var text = JSON.stringify(msg);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
    else if (window.parent && window.parent !== window) window.parent.postMessage(text, '*');
  }

  if (!window.L) {
    document.body.innerHTML = '<p style="color:#9AA7BA;text-align:center;padding:40px 24px">No se pudo cargar el mapa. Revisá tu conexión a internet.</p>';
    return;
  }

  var map = L.map('map', {
    zoomControl: false, preferCanvas: true, minZoom: 5, maxZoom: 14
  }).setView([-33.6, -68.6], 7);
  map.attributionControl.setPrefix(false);

  [['sat', 250], ['radar', 350], ['labels', 380], ['motion', 420]].forEach(function (p) {
    map.createPane(p[0]);
    map.getPane(p[0]).style.zIndex = p[1];
    map.getPane(p[0]).style.pointerEvents = 'none';
  });

  var bases = {
    light: L.tileLayer(ESRI + 'World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri', maxNativeZoom: 17
    }),
    dark: L.layerGroup([
      L.tileLayer(ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri', maxNativeZoom: 16
      }),
      L.tileLayer(ESRI + 'Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        pane: 'labels', maxNativeZoom: 16
      })
    ])
  };
  var baseShown = null;

  var satellite = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
    layers: 'GOES-East_ABI_Band13_Clean_Infrared', format: 'image/png', transparent: true,
    opacity: 0.6, pane: 'sat', attribution: 'NASA GIBS / NOAA'
  });

  var alertLayer = L.layerGroup().addTo(map);
  var strikeLayer = L.layerGroup().addTo(map);
  var motionLayer = L.layerGroup().addTo(map);
  var userLayer = L.layerGroup().addTo(map);
  var tapLayer = L.layerGroup().addTo(map);
  var last = {};

  function changed(key, value) {
    var text = JSON.stringify(value);
    if (last[key] === text) return false;
    last[key] = text;
    return true;
  }

  // ---------- Animación del radar ----------
  // Todas las pasadas se cargan como imágenes transparentes y se va mostrando una
  // por vez, esperando a que cada imagen esté descargada para no parpadear.
  var FRAME_MS = 420;
  var HOLD_LAST_MS = 1800;
  var overlays = {};
  var loaded = {};
  var anim = { frames: [], playing: false, index: null, opacity: 0.8, shown: null, timer: null };

  function frameUrl(i) { return anim.frames[i] && anim.frames[i].url; }

  function show(i) {
    var url = frameUrl(i);
    if (!url) return;
    if (anim.shown && anim.shown !== url && overlays[anim.shown]) overlays[anim.shown].setOpacity(0);
    overlays[url].setOpacity(anim.opacity);
    if (anim.shown !== url) {
      anim.shown = url;
      send({ type: 'frame', url: url });
    }
  }

  function shownIndex() {
    for (var i = 0; i < anim.frames.length; i++) if (anim.frames[i].url === anim.shown) return i;
    return -1;
  }

  function tick() {
    anim.timer = null;
    if (!anim.playing || anim.frames.length < 2) return;
    var n = anim.frames.length;
    var current = shownIndex();
    var next = current < 0 || current >= n - 1 ? 0 : current + 1;
    if (!loaded[frameUrl(next)]) { anim.timer = setTimeout(tick, 120); return; }
    show(next);
    anim.timer = setTimeout(tick, next === n - 1 ? HOLD_LAST_MS : FRAME_MS);
  }

  function setRadar(r) {
    var urls = {};
    r.frames.forEach(function (f) { urls[f.url] = true; });
    Object.keys(overlays).forEach(function (u) {
      if (!urls[u]) { map.removeLayer(overlays[u]); delete overlays[u]; delete loaded[u]; }
    });
    r.frames.forEach(function (f) {
      if (overlays[f.url]) return;
      var ov = L.imageOverlay(f.url, BOUNDS, {
        opacity: 0, pane: 'radar', interactive: false, className: 'radar-img'
      });
      ov.on('load', function () { loaded[f.url] = true; });
      ov.addTo(map);
      overlays[f.url] = ov;
    });
    if (anim.shown && !urls[anim.shown]) anim.shown = null;

    var wasPlaying = anim.playing;
    anim.frames = r.frames;
    anim.playing = r.playing;
    anim.index = r.index;
    if (anim.opacity !== r.opacity) {
      anim.opacity = r.opacity;
      if (anim.shown && overlays[anim.shown]) overlays[anim.shown].setOpacity(anim.opacity);
    }

    if (!anim.playing) {
      if (anim.timer) { clearTimeout(anim.timer); anim.timer = null; }
      show(anim.index === null ? anim.frames.length - 1 : Math.min(anim.index, anim.frames.length - 1));
    } else {
      // Al empezar se muestra primero la pasada más nueva.
      if (!anim.shown) show(anim.frames.length - 1);
      if (!wasPlaying || !anim.timer) {
        if (anim.timer) clearTimeout(anim.timer);
        anim.timer = setTimeout(tick, wasPlaying ? FRAME_MS : HOLD_LAST_MS);
      }
    }
  }

  // ---------- Movimiento de las tormentas ----------
  function arrowHead(towards, strong) {
    var size = strong ? 22 : 18;
    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 20 20" style="transform: rotate(' + towards + 'deg)">' +
      '<path d="M10 1 L18 18 L10 13.5 L2 18 Z" fill="#fff" stroke="#0B1220" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    return L.divIcon({ className: 'storm-head', html: svg, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }

  function setMotion(items) {
    motionLayer.clearLayers();
    (items || []).forEach(function (m) {
      var line = [m.from, m.to];
      L.polyline(line, { pane: 'motion', color: '#0B1220', weight: m.strong ? 7 : 5, opacity: 0.75, interactive: false }).addTo(motionLayer);
      L.polyline(line, { pane: 'motion', color: '#fff', weight: m.strong ? 3.5 : 2.5, dashArray: m.strong ? null : '6 5', interactive: false }).addTo(motionLayer);
      L.marker(m.to, { pane: 'motion', icon: arrowHead(m.towards, m.strong), interactive: false }).addTo(motionLayer);
      if (m.label) {
        L.marker(m.from, {
          pane: 'motion', interactive: false,
          icon: L.divIcon({ className: '', html: '<span class="storm-speed">' + m.label + '</span>', iconSize: [64, 18], iconAnchor: [32, -6] })
        }).addTo(motionLayer);
      }
    });
  }

  function ringLabel(lat, lng, km) {
    var north = lat + km / 110.9;
    return L.marker([north, lng], {
      interactive: false,
      icon: L.divIcon({ className: 'ring-label', html: km + ' km', iconSize: [40, 12], iconAnchor: [20, 14] })
    });
  }

  function setUser(user) {
    userLayer.clearLayers();
    if (!user) return;
    var at = [user.lat, user.lng];
    [10, 25].forEach(function (km) {
      L.circle(at, {
        radius: km * 1000, color: '#0A66C2', weight: 1.5, dashArray: '5 5',
        fill: false, interactive: false
      }).addTo(userLayer);
      ringLabel(user.lat, user.lng, km).addTo(userLayer);
    });
    L.circleMarker(at, {
      radius: 8, color: '#fff', weight: 3, fillColor: '#0A66C2', fillOpacity: 1, interactive: false
    }).addTo(userLayer);
  }

  function setStrikes(items) {
    strikeLayer.clearLayers();
    (items || []).forEach(function (s) {
      var recent = s[2] < 1.5;
      L.circleMarker([s[0], s[1]], {
        radius: recent ? 5 : 4, color: '#111', weight: 1,
        fillColor: recent ? '#FFF02A' : '#FF9F1A',
        fillOpacity: Math.max(0.45, 1 - s[2] / 8), interactive: false
      }).addTo(strikeLayer);
    });
  }

  function setAlerts(items) {
    alertLayer.clearLayers();
    (items || []).forEach(function (a) {
      a.polygons.forEach(function (poly) {
        L.polygon(poly, {
          color: a.color, weight: 2, fillColor: a.color, fillOpacity: 0.14, interactive: false
        }).addTo(alertLayer);
      });
    });
  }

  function apply(s) {
    if (changed('dark', s.dark)) {
      if (baseShown) map.removeLayer(baseShown);
      baseShown = s.dark ? bases.dark : bases.light;
      baseShown.addTo(map);
      document.body.style.background = s.dark ? '#0B1220' : '#DDE3EA';
    }
    if (changed('radar', s.radar)) setRadar(s.radar);
    if (changed('motion', s.motion)) setMotion(s.motion);
    if (changed('satellite', s.satellite)) {
      if (s.satellite) satellite.addTo(map); else map.removeLayer(satellite);
    }
    if (changed('user', s.user)) setUser(s.user);
    if (changed('strikes', s.strikes)) setStrikes(s.strikes);
    if (changed('alerts', s.alerts)) setAlerts(s.alerts);
    if (changed('tap', s.tap)) {
      tapLayer.clearLayers();
      if (s.tap) {
        L.circleMarker([s.tap.lat, s.tap.lng], {
          radius: 6, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 0.9, interactive: false
        }).addTo(tapLayer);
      }
    }
  }

  window.__rx = function (raw) {
    var cmd = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (cmd.type === 'state') apply(cmd.state);
    else if (cmd.type === 'center') map.setView([cmd.lat, cmd.lng], cmd.zoom || map.getZoom(), { animate: true });
  };

  // Versión web: los comandos llegan por postMessage desde la página que contiene el iframe.
  window.addEventListener('message', function (event) {
    if (window.ReactNativeWebView || event.source !== window.parent) return;
    try {
      var cmd = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (cmd && (cmd.type === 'state' || cmd.type === 'center')) window.__rx(cmd);
    } catch (e) {}
  });

  map.on('click', function (e) {
    send({ type: 'tap', lat: e.latlng.lat, lng: e.latlng.lng });
  });

  send({ type: 'ready' });
})();
</script>
</body>
</html>`;
