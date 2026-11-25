// --- 地圖樣式：色鉛筆手札（只有探索過的地方看得到）。畫好的圖幅與 AI 畫的底圖疊在它上面，見 45-sheets.js ---
const INK = '#2E2820', INK_SOFT = '#5C5244', PAPER = '#F3ECDB';
const FONT = ['OnionHand']; // 英數與標點從 fonts/glyphs/ 取；中文字由 MapLibre 用本機手寫字型畫（localIdeographFontFamily）
const NAME = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name']];
// 道路＝外層墨線＋內層紙色，看起來像鋼筆畫的雙線；縮小時內層歸零，變回單線。
// 寬度順序：[幹道, 主要, 次要／三級, 小巷, 服務道路]，寬度 0 就是不畫（小巷 z12 以下、服務道路 z13 以下不畫）
const RC = ['motorway', 'trunk'], RP = ['primary'], RS = ['secondary', 'tertiary'], RM = ['minor'];
const roadW = stops => {
  const e = ['interpolate', ['exponential', 1.4], ['zoom']];
  for (const [z, [a, b, c, d, s]] of stops) e.push(z, ['match', ['get', 'class'], RC, a, RP, b, RS, c, RM, d, s]);
  return e;
};
const ROAD_IN = roadW([[10, [0, 0, 0, 0, 0]], [11, [1.0, 0.7, 0, 0, 0]], [12, [1.4, 1.0, 0.5, 0, 0]], [13, [1.8, 1.4, 0.8, 0, 0]],
  [14, [2.6, 2.0, 1.1, 0, 0]], [16, [7, 5.5, 4, 1.8, 1]], [18, [16, 13, 10, 6, 4.5]]]);
const ROAD_OUT = roadW([[8, [1.4, 1, 0.6, 0, 0]], [10, [1.8, 1.3, 0.8, 0, 0]], [11, [2.4, 1.8, 1.0, 0, 0]], [12, [2.8, 2.2, 1.4, 0.35, 0]],
  [13, [3.2, 2.6, 1.8, 0.55, 0.3]], [14, [4.6, 4.0, 3.1, 0.9, 0.6]], [16, [9.4, 7.9, 6.4, 4.2, 3]], [18, [19.2, 16.2, 13.2, 9.2, 7]]]);
const ROADS = ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false];
const LABEL = { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 1.6, 'text-halo-blur': 0.4 };
const LABEL_LAYERS = ['water-name', 'road-name', 'road-shield', 'peak', 'place', 'fog-q']; // 先隱藏，等手寫字型載好再顯示，否則會用系統字型畫掉
// 聚落圖示：城市＝城堡、城鎮＝教堂、村＝三間房、里／鄰＝一間房
const PLACE_ICON = ['match', ['get', 'class'], 'city', 'castle', 'town', 'church', 'village', 'village', 'hamlet', 'house', 'none'];
const ICON_CLASSES = ['city', 'town', 'village', 'hamlet']; // 里、鄰、街區只寫名字不放圖示，市區才不會滿地小房子

const style = {
  version: 8,
  glyphs: 'fonts/glyphs/{fontstack}/{range}.pbf',
  sources: {
    omt: { type: 'vector', url: 'onion://planet',
      // OpenFreeMap 規定的寫法，跟 18-offline.js 的備用那段一樣。這裡寫了，MapLibre 就不用 TileJSON 那段，所以不會出現兩次
      attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' },
    dem: { type: 'raster-dem', tiles: ['onion://dem/{z}/{x}/{y}'],
      encoding: 'terrarium', tileSize: 256, maxzoom: 12,
      attribution: '地形 <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Terrain Tiles</a>' }
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': PAPER } },
    { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse',
      filter: ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], true, false],
      paint: { 'fill-color': '#EADFC6', 'fill-opacity': 0.55 } },
    // 植被：淡色打底，上面鋪色鉛筆的樹／草／田圖樣
    { id: 'landcover-base', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      paint: { 'fill-color': ['match', ['get', 'class'], 'wood', '#D3E2BC', 'grass', '#E0E8C8', 'farmland', '#ECE9C8', 'sand', '#EFE3C0', 'wetland', '#D9E4CF', '#E0E5C8'],
        'fill-opacity': 0.6 } },
    { id: 'landcover-pattern', type: 'fill', source: 'omt', 'source-layer': 'landcover', minzoom: 9,
      filter: ['match', ['get', 'class'], ['wood', 'grass', 'farmland', 'wetland'], true, false],
      paint: { 'fill-pattern': ['match', ['get', 'class'], 'wood', 'trees', 'farmland', 'farm', 'grass'],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 13, 0.85] } },
    { id: 'park-base', type: 'fill', source: 'omt', 'source-layer': 'park',
      paint: { 'fill-color': '#DCE6C4', 'fill-opacity': 0.55 } },
    { id: 'park-pattern', type: 'fill', source: 'omt', 'source-layer': 'park', minzoom: 11,
      paint: { 'fill-pattern': 'grass', 'fill-opacity': 0.7 } },
    // 山：高程陰影調成鉛筆灰褐，像手札裡的排線
    { id: 'hillshade', type: 'hillshade', source: 'dem',
      paint: { 'hillshade-shadow-color': '#5E5447', 'hillshade-highlight-color': '#FFFBF0', 'hillshade-accent-color': '#8A7C68',
        'hillshade-exaggeration': 0.38, 'hillshade-illumination-direction': 335 } },
    // 水：淡藍打底＋藍色鉛筆排線；河流用波浪筆觸
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
      paint: { 'fill-color': '#C6DDEC', 'fill-opacity': 0.9 } },
    { id: 'water-hatch', type: 'fill', source: 'omt', 'source-layer': 'water',
      paint: { 'fill-pattern': 'water-hatch', 'fill-opacity': 0.75 } },
    { id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water',
      paint: { 'line-color': '#3F7FB5', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 1.3], 'line-opacity': 0.8 } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
      paint: { 'line-pattern': 'river', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 13, 2.2, 18, 6] } },
    // 建築：鋼筆排線＋細墨框（排線要淡，不然整座城市黑成一片）
    { id: 'building-hatch', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 16,
      paint: { 'fill-pattern': 'hatch', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 16, 0.15, 17, 0.3, 18, 0.4] } },
    { id: 'building-line', type: 'line', source: 'omt', 'source-layer': 'building', minzoom: 16,
      paint: { 'line-color': INK_SOFT, 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.4, 18, 0.9], 'line-opacity': 0.7 } },
    { id: 'path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14,
      filter: ['match', ['get', 'class'], ['path', 'track'], true, false],
      paint: { 'line-color': INK_SOFT, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.9, 18, 1.8], 'line-dasharray': [2, 2], 'line-opacity': 0.85 } },
    { id: 'road-ink', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ROADS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': INK, 'line-width': ROAD_OUT, 'line-opacity': 0.92 } },
    // 道路內層：高速公路灰、主要道路黃、次要淡黃、小巷紙色（色鉛筆塗的感覺）
    { id: 'road-fill', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: ROADS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'class'], RC, '#CFC9BC', RP, '#F2CF5B', RS, '#F6E39A', PAPER], 'line-width': ROAD_IN } },
    // 鐵路：一條細墨線加枕木
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['==', ['get', 'class'], 'rail'],
      paint: { 'line-color': INK, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 1.4], 'line-opacity': 0.9 } },
    { id: 'rail-ties', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13,
      filter: ['==', ['get', 'class'], 'rail'],
      paint: { 'line-color': INK, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 4, 16, 7], 'line-dasharray': [0.2, 2.2], 'line-opacity': 0.9 } },
    { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 11,
      layout: { visibility: 'none', 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT, 'text-size': 14, 'text-letter-spacing': 0.15 },
      paint: Object.assign({}, LABEL, { 'text-color': '#3F6E8F' }) },
    { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15,
      layout: { visibility: 'none', 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT, 'text-size': 14 },
      paint: LABEL },
    // 路牌：高速公路綠牌、其他白底方框，字是道路編號（ref）
    { id: 'road-shield', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 10,
      filter: ['all', ['has', 'ref'], ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false]],
      layout: { visibility: 'none', 'symbol-placement': 'line', 'symbol-spacing': 420, 'text-field': ['get', 'ref'], 'text-font': FONT, 'text-size': 12,
        'icon-image': ['match', ['get', 'class'], ['motorway', 'trunk'], 'shield-green', 'shield-box'], 'icon-text-fit': 'both', 'icon-text-fit-padding': [2, 5, 1, 5],
        'text-rotation-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'text-pitch-alignment': 'viewport' },
      paint: { 'text-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#FFFFFF', INK] } },
    // 山頂：鉛筆山形加名字
    { id: 'peak', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak', minzoom: 11, filter: ['has', 'name'],
      layout: { visibility: 'none', 'icon-image': 'peak', 'icon-size': 0.9, 'text-field': NAME, 'text-font': FONT, 'text-size': 12,
        'text-anchor': 'top', 'text-offset': [0, 0.6], 'text-optional': true },
      paint: LABEL },
    // 地名：聚落圖示在上、名字在下；街區層級以上不放圖示
    { id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place',
      layout: { visibility: 'none', 'text-field': NAME, 'text-font': FONT, 'text-letter-spacing': 0.08,
        'text-size': ['match', ['get', 'class'], 'city', 20, 'town', 17, 15],
        'icon-image': PLACE_ICON, 'icon-optional': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 0.8, 14, 0.95, 15, 0.95, 15.6, 0],
        'text-anchor': ['match', ['get', 'class'], ICON_CLASSES, 'top', 'center'],
        'text-offset': ['match', ['get', 'class'], ['city'], ['literal', [0, 1.0]], ['town'], ['literal', [0, 1.1]], ['village'], ['literal', [0, 0.8]],
          ['hamlet'], ['literal', [0, 0.8]], ['literal', [0, 0]]] },
      paint: Object.assign({}, LABEL, { 'text-halo-width': 2 }) }
  ]
};

function lastPoint() { const p = engine.state().points; return p[p.length - 1] || null; }
const map = new maplibregl.Map({
  container: 'map', style, center: [121.0, 23.7], zoom: 6.5,
  attributionControl: { compact: true }, locale: { 'AttributionControl.ToggleAttribution': '地圖資料出處' }, pitchWithRotate: false, dragRotate: false,
  localIdeographFontFamily: "'OnionHand', 'PingFang TC', 'Noto Sans TC', sans-serif" // 中文字在本機用手寫字型畫，不必下載整套中文 glyph
});
map.touchZoomRotate.disableRotation();
const mapReady = new Promise(ok => map.once('load', ok));
window.map = map; // 方便在瀏覽器主控台調樣式
map.on('styleimagemissing', e => { const mk = IMAGES[e.id]; if (mk && !map.hasImage(e.id)) { const im = mk(); map.addImage(e.id, im.data, im.opts); } });
// 手寫字型載好（最多等 4 秒）再顯示地名，不然 MapLibre 會先用系統字型把字畫進快取
let labelsOn = false;
function showLabels() { labelsOn = true; LABEL_LAYERS.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'visible')); }
const fontReady = (document.fonts && document.fonts.load) ? document.fonts.load("24px 'OnionHand'").catch(() => {}) : Promise.resolve();
Promise.race([fontReady, new Promise(r => setTimeout(r, 4000))]).then(() => {
  if (map.isStyleLoaded()) showLabels(); else map.once('load', showLabels);
});
// --- 地圖出處：先展開給人看，滑動／縮放／點地圖之後或看滿 5 秒就收起來，之後點 ⓘ 隨時能再展開（OSM 出處規定，互動地圖那段）---
(() => {
  const at = map.getContainer().querySelector('.maplibregl-ctrl-attrib'); if (!at) return;
  const SHOW = 'maplibregl-compact-show';
  let left = 5000, last = 0, ready = false, done = false;
  mapReady.then(() => { ready = true; });
  // 真的看得到：在地圖頁、畫面亮著、OSM 那段已經出現，而且沒有被別的東西蓋住
  const seen = () => {
    if (document.hidden || document.body.dataset.tab !== 'map' || !at.classList.contains(SHOW) || $('toast').classList.contains('show')) return false;
    const a = at.querySelector('a[href*="openstreetmap.org"]'); if (!a) return false;
    const r = a.getClientRects()[0], el = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && at.contains(el);
  };
  // MapLibre 一拖地圖就會自己收。還沒讓人看到之前收掉的，畫面更新前就打開回來
  const keep = new MutationObserver(() => { if (!at.classList.contains(SHOW) && at.classList.contains('maplibregl-compact')) at.classList.add(SHOW); });
  keep.observe(at, { attributes: true, attributeFilter: ['class'] });
  const stop = () => { done = true; clearInterval(timer); keep.disconnect(); };
  const fold = () => { stop(); at.classList.remove(SHOW); at.removeAttribute('open'); };
  const timer = setInterval(() => {
    const t = performance.now();
    if (!ready || !seen()) { last = 0; return; }
    if (last) left -= Math.min(t - last, 500);
    last = t;
    if (left <= 0) fold();
  }, 250);
  const touched = e => { if (e.originalEvent && (done || seen())) fold(); }; // 程式自己移動地圖沒有 originalEvent
  map.on('movestart', touched); map.on('click', touched);
  at.addEventListener('click', e => { if (e.target.closest('summary')) stop(); }, true); // 自己按 ⓘ 收的，別再打開
})();
// 讀回上次的紀錄（iOS 是讀檔，所以是非同步的），讀到就把地圖移到最後一個點
const restored = loadSaved().then(ok => {
  if (!ok) return;
  render(true);
  const l = lastPoint(); if (l) map.jumpTo({ center: [l[2], l[1]], zoom: 15 });
});

const meEl = document.createElement('div'); meEl.className = 'me';
const me = new maplibregl.Marker({ element: meEl });
let meShown = false;
function showMe(lng, lat) { me.setLngLat([lng, lat]); if (!meShown) { me.addTo(map); meShown = true; } }

function mistImage() { // 黑濛濛的霧：幾個整數頻率的波疊起來，四邊自然接得上，鋪成 pattern 不會有縫
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), id = g.createImageData(n, n), d = id.data, waves = [];
  for (let k = 0; k < 9; k++) waves.push({ fx: 1 + (k * 7) % 5, fy: 1 + (k * 3) % 5, ph: k * 1.7, amp: 1 / (1 + k * 0.6) });
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0;
    for (const w of waves) v += w.amp * Math.sin(2 * Math.PI * (w.fx * x / n + w.fy * y / n) + w.ph + 1.6 * Math.sin(2 * Math.PI * (w.fy * x / n - w.fx * y / n)));
    const t = 0.5 + 0.5 * Math.tanh(v * 0.5), r = (Math.random() - 0.5) * 9, i = (y * n + x) * 4;
    d[i] = 26 + t * 34 + r; d[i + 1] = 30 + t * 36 + r; d[i + 2] = 40 + t * 44 + r; d[i + 3] = 255;
  }
  return { width: n, height: n, data: new Uint8Array(d.buffer) };
}
// ===== 色鉛筆風的圖樣與圖示：全部用 canvas 畫，地圖的 pattern／icon 與圖例共用 =====
const TILES = {}; // id -> canvas（圖例拿來當底圖）
function tile(id, w, h, draw, opts) {
  const pr = 2, c = document.createElement('canvas'); c.width = w * pr; c.height = h * pr;
  const g = c.getContext('2d'); g.scale(pr, pr); draw(g, w, h);
  TILES[id] = c;
  const d = g.getImageData(0, 0, c.width, c.height);
  return { data: { width: c.width, height: c.height, data: new Uint8Array(d.data.buffer) }, opts: Object.assign({ pixelRatio: pr }, opts || {}) };
}
function pencil(g, x1, y1, x2, y2, color, w, a) { // 鉛筆線：疊三道微抖、深淺不一的線
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = color; g.globalAlpha = a * (0.45 + Math.random() * 0.55); g.lineWidth = w * (0.6 + Math.random() * 0.7); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x1 + (Math.random() - 0.5) * 0.9, y1 + (Math.random() - 0.5) * 0.9); g.lineTo(x2 + (Math.random() - 0.5) * 0.9, y2 + (Math.random() - 0.5) * 0.9); g.stroke();
  }
  g.globalAlpha = 1;
}
function hatchTile(id, n, gap, color, w, a) { // 斜排線，可無縫平鋪
  return tile(id, n, n, g => { for (let x = -n; x <= 2 * n; x += gap) pencil(g, x, n, x + n, 0, color, w, a); });
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function houseAt(g, cx, cy, s) { // 小房子：方塊牆＋三角屋頂＋門
  g.fillStyle = '#F3E6CC'; g.fillRect(cx - s / 2, cy - s * 0.1, s, s * 0.9);
  g.fillStyle = '#C97A4E'; g.beginPath(); g.moveTo(cx - s * 0.65, cy - s * 0.1); g.lineTo(cx, cy - s * 0.85); g.lineTo(cx + s * 0.65, cy - s * 0.1); g.closePath(); g.fill();
  g.strokeStyle = '#2E2820'; g.lineWidth = 1; g.strokeRect(cx - s / 2, cy - s * 0.1, s, s * 0.9);
  g.beginPath(); g.moveTo(cx - s * 0.65, cy - s * 0.1); g.lineTo(cx, cy - s * 0.85); g.lineTo(cx + s * 0.65, cy - s * 0.1); g.stroke();
  g.fillStyle = '#6B4A2B'; g.fillRect(cx - s * 0.12, cy + s * 0.35, s * 0.24, s * 0.45);
}
function treeAt(g, x, y, r, kind) {
  if (kind === 'pine') { // 針葉：三角
    g.fillStyle = '#7FAE57'; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(x, y - r * 1.6); g.lineTo(x + r, y + r * 0.5); g.lineTo(x - r, y + r * 0.5); g.closePath(); g.fill(); g.globalAlpha = 1;
    pencil(g, x, y - r * 1.6, x + r, y + r * 0.5, '#3F6B2E', 0.9, 0.9); pencil(g, x + r, y + r * 0.5, x - r, y + r * 0.5, '#3F6B2E', 0.9, 0.9); pencil(g, x - r, y + r * 0.5, x, y - r * 1.6, '#3F6B2E', 0.9, 0.9);
  } else { // 闊葉：圓
    g.fillStyle = '#8DBB5E'; g.globalAlpha = 0.85; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    g.strokeStyle = '#3F6B2E'; g.globalAlpha = 0.8; g.lineWidth = 0.9; g.beginPath(); g.arc(x + 0.3, y + 0.3, r, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  }
  pencil(g, x, y + r * 0.6, x, y + r * 1.5, '#6B4A2B', 1.2, 0.9);
}
const IMAGES = {
  'hatch': () => hatchTile('hatch', 16, 8, '#2E2820', 0.8, 0.7),            // 建築
  'water-hatch': () => hatchTile('water-hatch', 20, 6, '#5B93C4', 1.1, 0.45),
  'farm': () => hatchTile('farm', 28, 9, '#B9B868', 1, 0.35),
  'grass': () => tile('grass', 32, 32, g => { for (let i = 0; i < 14; i++) { const x = Math.random() * 32, y = Math.random() * 32; pencil(g, x, y, x + 3, y - 4, '#8FB862', 1, 0.6); } }),
  'trees': () => tile('trees', 64, 64, g => {
    for (let i = 0; i < 10; i++) { const x = Math.random() * 64, y = Math.random() * 64; pencil(g, x, y, x + 4, y - 3, '#A9C98A', 1, 0.35); }
    treeAt(g, 14, 16, 6, 'round'); treeAt(g, 44, 12, 5, 'pine'); treeAt(g, 30, 40, 6.5, 'round'); treeAt(g, 54, 46, 5, 'pine'); treeAt(g, 8, 50, 4.5, 'pine');
  }),
  'river': () => tile('river', 32, 6, g => { g.strokeStyle = '#4F8DC2'; g.lineWidth = 1.6; g.globalAlpha = 0.9; g.beginPath(); g.moveTo(0, 3); g.bezierCurveTo(8, -1, 8, 7, 16, 3); g.bezierCurveTo(24, -1, 24, 7, 32, 3); g.stroke(); g.globalAlpha = 1; }),
  'shield-box': () => tile('shield-box', 28, 22, g => { g.fillStyle = '#FAF5E8'; roundRect(g, 1.5, 1.5, 25, 19, 4); g.fill(); g.strokeStyle = '#2E2820'; g.lineWidth = 1.4; roundRect(g, 1.5, 1.5, 25, 19, 4); g.stroke(); },
    { stretchX: [[12, 44]], stretchY: [[12, 32]], content: [10, 6, 46, 38] }),
  'shield-green': () => tile('shield-green', 28, 22, g => { g.fillStyle = '#4F8A3C'; roundRect(g, 1.5, 1.5, 25, 19, 9); g.fill(); g.strokeStyle = '#2E5A22'; g.lineWidth = 1.4; roundRect(g, 1.5, 1.5, 25, 19, 9); g.stroke(); },
    { stretchX: [[14, 42]], stretchY: [[14, 30]], content: [12, 6, 44, 38] }),
  'peak': () => tile('peak', 24, 16, g => { pencil(g, 2, 14, 10, 3, '#4A443B', 1.3, 0.95); pencil(g, 10, 3, 18, 14, '#4A443B', 1.3, 0.95); pencil(g, 10, 3, 13, 8, '#9A948A', 1, 0.6); pencil(g, 14, 10, 22, 14, '#6E6860', 1.1, 0.8); }),
  'house': () => tile('house', 20, 18, g => houseAt(g, 10, 10, 7)),
  'village': () => tile('village', 40, 18, g => { houseAt(g, 7, 10, 6); houseAt(g, 20, 10, 6); houseAt(g, 33, 10, 6); }),
  'church': () => tile('church', 24, 26, g => { houseAt(g, 12, 17, 8); pencil(g, 12, 9, 12, 2, '#2E2820', 1.3, 0.95); pencil(g, 9.5, 4.5, 14.5, 4.5, '#2E2820', 1.3, 0.95); }),
  'castle': () => tile('castle', 28, 24, g => {
    g.fillStyle = '#E9DFC8'; g.fillRect(4, 9, 20, 13); g.strokeStyle = '#2E2820'; g.lineWidth = 1.2; g.strokeRect(4, 9, 20, 13);
    for (let i = 0; i < 4; i++) { g.fillRect(4 + i * 5.5, 5, 3.5, 4); g.strokeRect(4 + i * 5.5, 5, 3.5, 4); }
    g.fillStyle = '#6B4A2B'; g.fillRect(12, 15, 4, 7);
  }),
  'none': () => tile('none', 2, 2, () => {})
};
function tileCanvas(id) { if (!TILES[id]) IMAGES[id](); return TILES[id]; }

const EMPTY = { type: 'FeatureCollection', features: [] };
map.on('load', () => {
  map.addImage('mist', mistImage());
  ['freq', 'fog', 'flights', 'gaps', 'track', 'fogq'].forEach(id => map.addSource(id, { type: 'geojson', data: EMPTY }));
  // 走過越多次綠色越深（踏實的路）
  map.addLayer({ id: 'freq', type: 'fill', source: 'freq',
    paint: { 'fill-color': '#5E8C3F', 'fill-opacity': 0.12 } });
  // 迷霧：黑濛濛的霧把沒去過的地方蓋掉，邊緣暈開
  map.addLayer({ id: 'fog', type: 'fill', source: 'fog', paint: { 'fill-pattern': 'mist', 'fill-opacity': 0.97 } });
  map.addLayer({ id: 'fog-edge', type: 'line', source: 'fog', layout: { 'line-join': 'round', 'line-cap': 'round' }, // 尖角接頭加模糊會長刺，圓的才像霧散開
    paint: { 'line-color': '#12151C', 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 12, 18, 30], 'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 7, 18, 18] } });
  // 迷霧上只留極淡的海岸線與國界，讓你知道自己在哪
  map.addLayer({ id: 'hint-water', type: 'fill', source: 'omt', 'source-layer': 'water',
    paint: { 'fill-color': '#8FB0C6', 'fill-opacity': 0.16 } });
  map.addLayer({ id: 'hint-border', type: 'line', source: 'omt', 'source-layer': 'boundary',
    filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
    paint: { 'line-color': '#8E95A5', 'line-opacity': 0.5, 'line-width': 0.8, 'line-dasharray': [3, 2] } });
  // 走過的路：尋寶圖的紅色虛線，所有縮放都看得到
  map.addLayer({ id: 'track', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#A33B2E', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 8, 1.6, 13, 2.6, 17, 4], 'line-dasharray': [2.5, 1.6] } });
  map.addLayer({ id: 'gaps', type: 'line', source: 'gaps',
    paint: { 'line-color': INK_SOFT, 'line-opacity': 0.45, 'line-width': 1.2, 'line-dasharray': [1, 2] } });
  map.addLayer({ id: 'flights', type: 'line', source: 'flights', layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#9A3B2A', 'line-width': 1.8, 'line-opacity': 0.8, 'line-dasharray': [4, 3] } });
  // 迷霧上散落的「?」：手寫字型，大小角度各自不同
  map.addLayer({ id: 'fog-q', type: 'symbol', source: 'fogq',
    layout: { visibility: 'none', 'text-field': '?', 'text-font': FONT, 'text-size': ['*', 38, ['get', 's']], 'text-rotate': ['get', 'r'],
      'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': '#B7BDC8', 'text-opacity': 0.5 } });
  map.on('move', viewMoving);
  map.on('moveend', () => { drawView(); updateQ(); });
  addSheets();
  if (labelsOn) showLabels(); // 字型比地圖先好的話，剛加的「?」圖層也要打開
  render(true);
});

// --- 把探索格子畫成「迷霧上的洞」 ---
function ringArea(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a; }
function orient(r, positive) { return (ringArea(r) > 0) === positive ? r : r.slice().reverse(); }
function arc(a, b, n = 64) {
  const D = Math.PI / 180, V = (lng, lat) => [Math.cos(lat * D) * Math.cos(lng * D), Math.cos(lat * D) * Math.sin(lng * D), Math.sin(lat * D)];
  const v1 = V(a[0], a[1]), v2 = V(b[0], b[1]);
  const w = Math.acos(Math.min(1, Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2])));
  if (w < 1e-6) return [a, b];
  const out = []; let prev = null;
  for (let i = 0; i <= n; i++) {
    const f = i / n, s1 = Math.sin((1 - f) * w) / Math.sin(w), s2 = Math.sin(f * w) / Math.sin(w);
    const v = [s1 * v1[0] + s2 * v2[0], s1 * v1[1] + s2 * v2[1], s1 * v1[2] + s2 * v2[2]];
    let lng = Math.atan2(v[1], v[0]) / D; const lat = Math.asin(v[2]) / D;
    if (prev !== null) { while (lng - prev > 180) lng -= 360; while (lng - prev < -180) lng += 360; }
    prev = lng; out.push([lng, lat]);
  }
  return out;
}
// 把軌跡點切成一段段線：遇到飛行、斷訊超過 10 分鐘或跳太遠就斷開
function trackLines(pts) {
  const lines = []; let cur = [], prev = null;
  for (const p of pts) {
    const brk = !prev || p[4] === 'f' || p[0] - prev[0] > 600 ||
      Math.abs(p[1] - prev[1]) + Math.abs(p[2] - prev[2]) > 0.4;
    if (brk) { if (cur.length > 1) lines.push(cur); cur = []; }
    cur.push([p[2], p[1]]); prev = p;
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}
// 迷霧上的「?」：以整數 zoom 的螢幕格子為單位放點，位置用 hash 決定（平移不會跳），落在已探索格子上的不放
function qhash(a, b, c) {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245); return (h ^ (h >>> 16)) >>> 0;
}
function updateQ() {
  if (!map.getSource('fogq')) return;
  const z = Math.max(0, Math.floor(map.getZoom())), size = 512 * Math.pow(2, z), step = 150, b = map.getBounds(), cells = engine.state().cells;
  const proj = (lng, lat) => { const s = Math.sin(lat * Math.PI / 180); return [(lng + 180) / 360 * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size]; };
  const unproj = (x, y) => { const m = 0.5 - y / size; return [x / size * 360 - 180, 90 - 360 * Math.atan(Math.exp(-m * 2 * Math.PI)) / Math.PI]; };
  const [x0, y0] = proj(b.getWest(), b.getNorth()), [x1, y1] = proj(b.getEast(), b.getSouth());
  const feats = [];
  for (let gx = Math.floor(x0 / step); gx <= Math.floor(x1 / step) && feats.length < 120; gx++) {
    for (let gy = Math.floor(y0 / step); gy <= Math.floor(y1 / step); gy++) {
      const h = qhash(gx, gy, z);
      const [lng, lat] = unproj((gx + 0.15 + 0.7 * ((h & 255) / 255)) * step, (gy + 0.15 + 0.7 * (((h >> 8) & 255) / 255)) * step);
      if (Math.abs(lat) > 84) continue;
      if (revealSet ? revealSet.has(h3.latLngToCell(lat, lng, revealRes)) : cells[h3.latLngToCell(lat, lng, CFG.res)]) continue;
      feats.push({ type: 'Feature', properties: { r: ((h >> 16) & 63) - 32, s: 0.8 + ((h >> 22) & 15) / 40 }, geometry: { type: 'Point', coordinates: [lng, lat] } });
    }
  }
  map.getSource('fogq').setData({ type: 'FeatureCollection', features: feats });
}
const WORLD = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
// 揭開範圍：紀錄還是 res 12 的細格子，但霧散開的範圍放大。
// 拉近看：換算成 res 11 再往外擴兩圈（走過的路左右約 100 公尺）；縮小看：res 8 的格子（約 1 公里）走進去整格散開
// 只算視野附近的格子（往外多半個畫面），拖出去才補；格子有好幾萬個時整張一起算要好幾秒。
/*VIEW_START*/
const VIEW = { spare: 0.5, lead: 0.2, pad: { fine: 0.4, coarse: 2 } }; // spare：四邊多算幾個畫面；lead：離算好的邊界剩多少畫面就補；pad：格子往外揭開的距離（公里，寬鬆抓）
const revealTierAt = z => z < 11 ? 'coarse' : 'fine';
// 走過越多次越綠的那一層用多細的格子：縮小看時一格不到一個像素，合併了也看不出來
const freqResAt = z => z >= 11 ? 12 : z >= 9 ? 11 : z >= 7 ? 10 : z >= 5.5 ? 9 : 8;
// 跟 h3.cellToParent 同一個答案，只動字串：把解析度換掉、後面的位數全填 1
function parentOf(c, r) {
  const b = 45 - 3 * r, i = Math.floor((59 - b) / 4);
  return c[0] + r.toString(16) + c.slice(2, i) + (parseInt(c[i], 16) | (1 << (b - 56 + 4 * i)) - 1).toString(16) + 'f'.repeat(14 - i);
}
function growBox(b, k) { const w = (b[2] - b[0]) * k, h = (b[3] - b[1]) * k; return [b[0] - w, b[1] - h, b[2] + w, b[3] + h]; } // b＝西南東北
const boxInside = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const bucketBoxes = new Map(); // 第 7 層那一塊的外框；裡面的細格子會稍微超出上層的邊，所以放大四分之一
function bucketBox(k) {
  let b = bucketBoxes.get(k); if (b) return b;
  const p = '87' + k.slice(2) + 'ffffff', [lat, lng] = h3.cellToLatLng(p);
  let r = 0; for (const v of h3.cellToBoundary(p)) r = Math.max(r, h3.greatCircleDistance([lat, lng], v, 'km'));
  const dy = r * 1.25 / 111, dx = dy / Math.max(0.01, Math.cos(lat * Math.PI / 180));
  bucketBoxes.set(k, b = [lng - dx, lat - dy, lng + dx, lat + dy]); return b;
}
function cellsNear(buckets, box, padKm) { // 範圍附近的格子（整塊整塊拿，只會多不會少）
  const dy = padKm / 111, dx = dy / Math.max(0.01, Math.cos(Math.min(89, Math.max(Math.abs(box[1]), Math.abs(box[3]))) * Math.PI / 180));
  const w = box[0] - dx, s = box[1] - dy, e = box[2] + dx, n = box[3] + dy, out = [];
  for (const [k, list] of buckets) {
    const b = bucketBox(k); if (b[3] < s || b[1] > n) continue;
    const turn = Math.ceil((w - b[2]) / 360) * 360; // 轉幾圈才第一次不在範圍的西邊（跨換日線、地圖捲了好幾圈都算）
    if (b[0] + turn <= e) for (const c of list) out.push(c);
  }
  return out;
}
function revealOf(ids, tier) { // 這些格子揭開的範圍（粗或細的格子集合）
  const set = new Set(), up = new Set();
  if (tier === 'coarse') { for (const c of ids) up.add(parentOf(c, 8)); return up; }
  for (const c of ids) up.add(c.slice(0, 12)); // 前 12 碼＝第 11 層，先去重再往外擴
  for (const k of up) for (const d of h3.gridDisk(k[0] + 'b' + k.slice(2) + 'fff', 2)) set.add(d);
  return set;
}
// 把格子合併成多邊形，每個門檻一組，結果跟 h3.cellsToMultiPolygon 一樣。它遇到一大堆破洞會慢到好幾秒（每個洞跟每個外框比），
// 這裡改成：相鄰兩格共用的邊互相抵銷，剩下的邊接成圈；同一片相連的格子只有一個外圈，洞跟著自己那一片走，不必比
function mergeTiers(ids, vals, ths) {
  const V = new Map(), xy = [], S = 4e5, M = 73e6; // 頂點用座標對號（約 0.25 公尺一格）；落在兩格交界時兩邊都找
  const vid = p => {
    const x = p[0] * S, y = p[1] * S, i = Math.round(x), j = Math.round(y), k = i * M + j; let v = V.get(k); if (v !== undefined) return v;
    const a = x - i, b = y - j, i2 = Math.abs(a) > 0.4999 ? i + Math.sign(a) : i, j2 = Math.abs(b) > 0.4999 ? j + Math.sign(b) : j;
    if (i2 !== i || j2 !== j) for (const q of [i2 * M + j, i * M + j2, i2 * M + j2]) if ((v = V.get(q)) !== undefined) return v;
    V.set(k, v = xy.length); xy.push(p); return v;
  };
  const rings = ids.map(c => { const r = h3.cellToBoundary(c, true); r.pop(); return r.map(vid); }), N = xy.length;
  return ths.map(th => {
    const open = new Map(), up = new Int32Array(ids.length).map((_, i) => i);
    const root = i => { while (up[i] !== i) i = up[i] = up[up[i]]; return i; };
    for (let i = 0; i < ids.length; i++) {
      if (vals[i] < th) continue;
      const r = rings[i];
      for (let j = 0, a = r[r.length - 1]; j < r.length; a = r[j++]) {
        const b = r[j], o = open.get(b * N + a);
        if (o === undefined) open.set(a * N + b, i); else { open.delete(b * N + a); up[root(o)] = root(i); }
      }
    }
    const next = new Map(); for (const [k, i] of open) { const a = Math.floor(k / N); if (next.has(a)) return null; next.set(a, [k - a * N, i]); }
    const outer = new Map(), holes = [];
    while (next.size) {
      const a0 = next.keys().next().value, ring = [xy[a0]], y0 = 2 * xy[a0][1]; let a = a0, i = -1, area = 0;
      do { const e = next.get(a); if (!e) return null; next.delete(a); i = e[1]; const p = xy[a], q = xy[e[0]]; area += (q[0] - p[0]) * (q[1] + p[1] - y0); ring.push(q); a = e[0]; } while (a !== a0);
      const id = root(i); if (area < 0 && !outer.has(id)) outer.set(id, [ring]); else holes.push([id, ring]);
    }
    for (const [id, ring] of holes) { const p = outer.get(id); if (!p) return null; p.push(ring); }
    return [...outer.values()];
  });
}
const mergeCells = list => mergeTiers(list, new Uint8Array(list.length), [0])[0] || h3.cellsToMultiPolygon(list, true); // 接不起來就退回 h3 自己算
const FREQ = [2, 5, 10]; // 去過幾次以上各疊一層綠
function freqOf(ids, cells, res) { // 每個門檻一組多邊形；縮小看時上層格裡只要有一格夠就算
  let list = [], vals = [];
  if (res === CFG.res) { for (const c of ids) { const v = cells[c][0]; if (v >= FREQ[0]) { list.push(c); vals.push(v); } } }
  else {
    const m = new Map();
    for (const c of ids) { const v = cells[c][0]; if (v < FREQ[0]) continue; const p = parentOf(c, res); if (!(m.get(p) >= v)) m.set(p, v); }
    list = [...m.keys()]; vals = [...m.values()];
  }
  return mergeTiers(list, vals, FREQ).map((g, i) => g || h3.cellsToMultiPolygon(list.filter((c, j) => vals[j] >= FREQ[i]), true)).filter(g => g.length);
}
/*VIEW_END*/
let revealSet = null, revealRes = CFG.res, drawnView = null; // drawnView：霧與綠色那層現在算到哪裡
let viewTimer = null, viewCost = 0;
function mapBox() { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
function viewStale() {
  const d = drawnView, z = map.getZoom();
  return !d || d.tier !== revealTierAt(z) || d.res !== freqResAt(z) || !boxInside(growBox(mapBox(), VIEW.lead), d.box);
}
function viewMoving() { // 還在拖、還在飛：快到邊邊了就先補，但不要每一格動畫都算
  if (viewTimer || !viewStale()) return;
  viewTimer = setTimeout(() => { viewTimer = null; drawView(); }, Math.max(60, viewCost * 2));
}
function drawView(force) { // 霧的洞與走過次數。資料沒變、還在算過的範圍裡就不重算
  if (!map.getSource('fog') || (!force && !viewStale())) return;
  const t0 = performance.now(), z = map.getZoom(), tier = revealTierAt(z), res = freqResAt(z), box = growBox(mapBox(), VIEW.spare);
  const s = engine.state(), ids = cellsNear(engine.buckets(), box, VIEW.pad[tier]);
  revealSet = revealOf(ids, tier); revealRes = tier === 'fine' ? 11 : 8; drawnView = { box, tier, res };
  const polys = mergeCells([...revealSet]);
  const fog = [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon',
    coordinates: [orient(WORLD, true), ...polys.map(p => orient(p[0], false))] } }];
  polys.forEach(p => { for (let i = 1; i < p.length; i++) fog.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [p[i]] } }); });
  map.getSource('fog').setData({ type: 'FeatureCollection', features: fog });
  map.getSource('freq').setData({ type: 'FeatureCollection', features: freqOf(ids, s.cells, res).map(g => ({ type: 'Feature', properties: {},
    geometry: { type: 'MultiPolygon', coordinates: g } })) });
  viewCost = performance.now() - t0;
}
let renderTimer = null;
function renderSoon() { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 350); }
function render(force) {
  updateStats();
  if (!map.getSource('fog')) return;
  const dirty = engine.takeDirty(); if (!dirty && !force) return;
  drawView(dirty);
  updateQ();
  const s = engine.state();
  map.getSource('flights').setData({ type: 'FeatureCollection', features: s.flights.map(f => ({ type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: arc([f[0], f[1]], [f[2], f[3]]) } })) });
  map.getSource('track').setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: trackLines(s.points) } });
  map.getSource('gaps').setData({ type: 'FeatureCollection', features: s.gaps.map(g => ({ type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[g[0], g[1]], [g[2], g[3]]] } })) });
}
document.addEventListener('onion:restored', () => { const l = lastPoint(); if (l && map) map.jumpTo({ center: [l[2], l[1]], zoom: 15 }); }); // 換成別份紀錄，帶到那份最後走到的地方
function updateStats() {
  const s = engine.state();
  const a = s.area < 10 ? s.area.toFixed(3) : s.area.toFixed(1);
  $('stats').innerHTML = '<span><b>' + a + '</b> km²</span><span>· 地面 ' + kmText(s.km.walk + s.km.vehicle) + '</span>'; // 航線幾段在足跡頁，這裡放不下
}
