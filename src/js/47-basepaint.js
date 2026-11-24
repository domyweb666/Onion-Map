// ===== 底稿與 AI 底圖 =====
// 前半：draftRender，開一張離屏的 MapLibre 把某個範圍畫成「沒有字、沒有路線」的乾淨底稿，另外出一張結構遮罩（幹道與水）給對位用。日卡也用它。
// 後半：把地圖中心這一帶（約 12×18 公里）請 ChatGPT 畫成手繪地圖，存 kv 'base/<id>.json'，疊在 SHEET_TOP 下面。
const DRAFT_W = 1024, DRAFT_H = 1536; // AI 的直式尺寸；底稿、成品、對位都用這個框
const MERC_K = 20037508.342789244 / 180;
const mercXY = (lng, lat) => [lng * MERC_K, Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * MERC_K];
const mercInv = (x, y) => [x / MERC_K, Math.atan(Math.exp(y / MERC_K * Math.PI / 180)) * 360 / Math.PI - 90];
// 範圍（麥卡托公尺 [x0,y0,x1,y1]，y 往北）↔ 底稿像素
const framePx = (f, lng, lat) => { const [x, y] = mercXY(lng, lat); return [(x - f[0]) / (f[2] - f[0]) * DRAFT_W, (f[3] - y) / (f[3] - f[1]) * DRAFT_H]; };
const frameLL = (f, px, py) => mercInv(f[0] + px / DRAFT_W * (f[2] - f[0]), f[3] - py / DRAFT_H * (f[3] - f[1]));
const frameMpp = f => { const lat = mercInv(0, (f[1] + f[3]) / 2)[1]; return (f[2] - f[0]) / DRAFT_W * Math.cos(lat * Math.PI / 180); }; // 一個底稿像素幾公尺
const frameZoom = f => Math.log2(40075016.686 / (f[2] - f[0]) * DRAFT_W / 512);

const DRAFT_COL = { paper: '#EEDFC6', block: '#E3CCAC', edge: '#B89E7C', green: '#CBDD9F', wood: '#AFCB85', inst: '#E6DCAE', farm: '#E6E3B4', sand: '#F3E6BE',
  water: '#9CC9E6', shore: '#4F8DBF', ink: '#8A7760', hwy: '#F0A066', main: '#F4BD68', mid: '#F8DE82', lane: '#FBF6E8', rail: '#97897A' };
function draftStyle(hill) { // 顏色就照彩鉛成品的調子，AI 比較不會改顏色，程式自己當底也好看
  const C = DRAFT_COL, g = x => ['get', x], cls = ['get', 'class'], src = { source: 'omt' };
  const W = (stops, add) => { const e = ['interpolate', ['exponential', 1.4], ['zoom']]; for (const [z, v] of stops) e.push(z, v + add); return e; };
  const ROADS4 = [ // [分類, 顏色, 各縮放的寬度]，由小到大畫
    ['lane', ['minor', 'service'], C.lane, 13, [[13, 0.7], [14, 2], [15, 4.2], [16, 7], [17, 12]]],
    ['mid', ['secondary', 'tertiary'], C.mid, 10.5, [[10, 0.8], [12, 2], [13, 3.4], [14, 6], [15, 9.5], [16, 13], [17, 20]]],
    ['main', ['primary'], C.main, 8, [[8, 1], [10, 2], [12, 3.6], [13, 5], [14, 7.5], [15, 11], [16, 15], [17, 24]]],
    ['hwy', ['motorway', 'trunk'], C.hwy, 5, [[5, 1], [8, 2], [10, 3], [12, 4.6], [13, 6], [14, 8.5], [15, 12], [16, 16], [17, 26]]]];
  const land = (id, sl, filter, color, extra) => Object.assign({ id, type: 'fill', ...src, 'source-layer': sl, paint: Object.assign({ 'fill-color': color }, extra) }, filter ? { filter } : {});
  const isIn = list => ['match', cls, list, true, false];
  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': C.paper } },
    land('lu-town', 'landuse', isIn(['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial']), C.block, { 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12.8, 0.8, 13.6, 0] }), // 縮得遠沒有房子，用一片底色告訴 AI 哪裡是市區
    land('lu-inst', 'landuse', isIn(['school', 'university', 'college', 'hospital', 'kindergarten', 'library']), C.inst),
    land('lc-farm', 'landcover', isIn(['farmland']), C.farm), land('lc-sand', 'landcover', isIn(['sand']), C.sand),
    land('lc-grass', 'landcover', isIn(['grass', 'wetland']), C.green), land('lc-wood', 'landcover', isIn(['wood']), C.wood),
    land('lu-green', 'landuse', isIn(['cemetery', 'pitch', 'playground', 'stadium', 'track']), C.green)];
  if (hill) layers.push({ id: 'hill', type: 'hillshade', source: 'dem', paint: { 'hillshade-shadow-color': '#6B7B4A', 'hillshade-highlight-color': '#FBF4DC', 'hillshade-accent-color': '#8A8A5E', 'hillshade-exaggeration': 0.45, 'hillshade-illumination-direction': 335 } });
  layers.push(
    { id: 'wway', type: 'line', ...src, 'source-layer': 'waterway', filter: ['!=', g('brunnel'), 'tunnel'], paint: { 'line-color': C.shore, 'line-width': ['match', cls, 'river', 3, 'canal', 2.4, 1.6] } },
    land('water', 'water', ['!=', g('brunnel'), 'tunnel'], C.water),
    { id: 'shore', type: 'line', ...src, 'source-layer': 'water', filter: ['!=', g('brunnel'), 'tunnel'], paint: { 'line-color': C.shore, 'line-width': 1.4 } },
    { id: 'bld', type: 'fill', ...src, 'source-layer': 'building', minzoom: 13.4, paint: { 'fill-color': C.block, 'fill-outline-color': C.edge } },
    { id: 'rail', type: 'line', ...src, 'source-layer': 'transportation', filter: ['all', ['==', cls, 'rail'], ['!=', g('brunnel'), 'tunnel']], paint: { 'line-color': C.rail, 'line-width': 1.6, 'line-dasharray': [4, 2] } });
  const cap = { 'line-cap': 'round', 'line-join': 'round' };
  const flt = list => ['all', isIn(list), ['!=', g('brunnel'), 'tunnel']];
  for (const [id, list, , mz, w] of ROADS4) layers.push({ id: 'rc-' + id, type: 'line', ...src, 'source-layer': 'transportation', minzoom: mz, filter: flt(list), layout: cap, paint: { 'line-color': C.ink, 'line-width': W(w, id === 'lane' ? 1.4 : 2.4) } });
  for (const [id, list, color, mz, w] of ROADS4) layers.push({ id: 'rf-' + id, type: 'line', ...src, 'source-layer': 'transportation', minzoom: mz, filter: flt(list), layout: cap, paint: { 'line-color': color, 'line-width': W(w, 0) } });
  // 結構圖：黑底白線，平常藏著，拍結構的時候才打開
  const hid = { visibility: 'none' };
  layers.push({ id: 's-bg', type: 'background', layout: hid, paint: { 'background-color': '#000' } },
    { id: 's-water', type: 'fill', ...src, 'source-layer': 'water', layout: hid, filter: ['!=', g('brunnel'), 'tunnel'], paint: { 'fill-color': '#fff', 'fill-antialias': false } },
    { id: 's-a', type: 'line', ...src, 'source-layer': 'transportation', layout: Object.assign({}, cap, hid), filter: flt(['motorway', 'trunk', 'primary']), paint: { 'line-color': '#fff', 'line-width': 7 } },
    { id: 's-b', type: 'line', ...src, 'source-layer': 'transportation', layout: Object.assign({}, cap, hid), minzoom: 12.8, filter: flt(['secondary']), paint: { 'line-color': '#fff', 'line-width': 7 } },
    { id: 's-c', type: 'line', ...src, 'source-layer': 'transportation', layout: Object.assign({}, cap, hid), minzoom: 13.8, filter: flt(['tertiary']), paint: { 'line-color': '#fff', 'line-width': 7 } });
  const sources = { omt: { type: 'vector', url: style.sources.omt.url } };
  if (hill) sources.dem = Object.assign({}, style.sources.dem);
  return { version: 8, sources, layers };
}

const mapIdle = (m, ms) => new Promise((ok, bad) => { // 等圖磚載完、畫完
  const t = setTimeout(() => { m.off('idle', fin); m.areTilesLoaded() ? ok() : bad(new Error('slow')); }, ms);
  const fin = () => { clearTimeout(t); ok(); };
  m.once('idle', fin);
});
function draftFeats(m) { // 地標、地名、綠地、校園、住宅區：算停留點名字用，用完就丟
  const name = p => p['name:zh-Hant'] || p['name:zh'] || p.name || '', seen = new Set();
  const q = (sl, filter) => { try { return m.querySourceFeatures('omt', { sourceLayer: sl, filter }); } catch (e) { return []; } };
  const pts = (sl, fn) => { const o = []; for (const f of q(sl)) {
    if (f.geometry.type !== 'Point' || !name(f.properties)) continue;
    const [lng, lat] = f.geometry.coordinates, k = sl + name(f.properties) + lng.toFixed(5) + lat.toFixed(5); if (seen.has(k)) continue; seen.add(k);
    o.push(fn(f.properties, lng, lat));
  } return o; };
  const isIn = list => ['match', ['get', 'class'], list, true, false], polys = list => list.map(f => f.geometry).filter(g => /Polygon/.test(g.type));
  return {
    poi: pts('poi', (p, lng, lat) => ({ cls: p.class, sub: p.subclass, name: name(p), lng, lat })),
    place: pts('place', (p, lng, lat) => ({ cls: p.class, name: name(p), lng, lat })),
    green: polys([...q('landcover', isIn(['grass', 'wood', 'wetland'])), ...q('park'), ...q('landuse', isIn(['cemetery', 'grass']))]),
    inst: polys(q('landuse', isIn(['university', 'college']))),
    home: polys(q('landuse', isIn(['residential', 'suburb', 'neighbourhood'])))
  };
}
// 畫一張。probes：要查地標的點 [[lng,lat]…]，範圍大的圖磚裡沒有地標，要另外拉近去查。回傳 {draft:canvas, ref:canvas, feats, probes:[feats…]}
async function draftRender(frame, opt) {
  const o = opt || {}, zoom = frameZoom(frame), hill = zoom < 13.2;
  const box = document.createElement('div'); box.className = 'draftBox'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box);
  const mid = mercInv((frame[0] + frame[2]) / 2, (frame[1] + frame[3]) / 2); let errs = 0, m = null;
  try {
    m = new maplibregl.Map({ container: box, style: draftStyle(hill), center: mid, zoom, interactive: false, attributionControl: false, fadeDuration: 0, pixelRatio: 1,
      preserveDrawingBuffer: true, trackResize: false, renderWorldCopies: false, maxPitch: 0 });
    m.on('error', e => { if (e.sourceId !== 'dem') errs++; });
    const ready = async ms => { try { await mapIdle(m, ms); } catch (e) { if (!m.isSourceLoaded || !m.getSource('omt') || !m.querySourceFeatures('omt', { sourceLayer: 'transportation' }).length) throw new Error('地圖資料載不下來'); } };
    await ready(o.timeout || 25000);
    if (errs && !m.querySourceFeatures('omt', { sourceLayer: 'transportation' }).length && !m.querySourceFeatures('omt', { sourceLayer: 'water' }).length) throw new Error('地圖資料載不下來');
    const snap = () => { const c = document.createElement('canvas'); c.width = DRAFT_W; c.height = DRAFT_H; c.getContext('2d').drawImage(m.getCanvas(), 0, 0, DRAFT_W, DRAFT_H); return c; };
    const draft = snap(), feats = o.feats ? draftFeats(m) : null;
    for (const l of m.getStyle().layers) m.setLayoutProperty(l.id, 'visibility', l.id.startsWith('s-') ? 'visible' : 'none');
    await mapIdle(m, 6000).catch(() => {});
    const ref = snap(), probes = [];
    if (o.probes && zoom < 14) {
      box.style.width = '360px'; box.style.height = '360px'; m.resize();
      for (const p of o.probes) { m.jumpTo({ center: p, zoom: 14.6 }); await mapIdle(m, 6000).catch(() => {}); probes.push(draftFeats(m)); }
    }
    return { draft, ref, feats, probes };
  } finally { if (m) m.remove(); box.remove(); }
}
function maskOf(canvas) { // 結構圖 → 0/1
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data, m = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
  return m;
}
function loadImg(src) { return new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('圖打不開')); im.src = src; }); }
function imgCanvas(im, w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, w, h); return c; }
// 畫好的圖收進來：縮成 1024×1536、抹紅線、對位。回傳 {img:'data:image/jpeg…', fit:{sx,sy,ox,oy,score,same}}，座標是 2048×3072
async function paintedIn(dataUrl, refUrl) {
  const c = imgCanvas(await loadImg(dataUrl), DRAFT_W, DRAFT_H), g = c.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, DRAFT_W, DRAFT_H);
  const ref = maskOf(imgCanvas(await loadImg(refUrl), DRAFT_W, DRAFT_H)), t0 = performance.now();
  const r = await alignPainted(id.data, DRAFT_W, DRAFT_H, ref, DRAFT_W, DRAFT_H);
  id.data.set(r.rgba); g.putImageData(id, 0, 0);
  const n = (x, k) => Math.round(x * k) / k, f = r.fit;
  console.info('[align] 縮放 ' + f.sx.toFixed(3) + ' x ' + f.sy.toFixed(3) + '，位移 ' + f.ox.toFixed(0) + ',' + f.oy.toFixed(0) + '，貼合度 ' + f.score.toFixed(2) + (f.same ? '（同框）' : '') + '，' + Math.round(performance.now() - t0) + ' ms');
  return { img: c.toDataURL('image/jpeg', 0.92), fit: { sx: n(f.sx, 1e4), sy: n(f.sy, 1e4), ox: n(f.ox, 10), oy: n(f.oy, 10), score: n(f.score, 1e3), same: f.same } };
}

// ===== AI 底圖 =====
const BASE_KM = 12, BASE_FADE_A = 14, BASE_FADE_B = 14.8; // 寬 12 公里、高 18 公里；比內建圖幅晚一點淡出
const BASE_FADE = ['interpolate', ['linear'], ['zoom'], BASE_FADE_A, 1, BASE_FADE_B, 0];
const baseMem = { list: [], urls: {}, busy: false };

function baseFrame(lng, lat) { const [x, y] = mercXY(lng, lat), w = BASE_KM * 1000 / Math.cos(lat * Math.PI / 180) / 2; return [x - w, y - w * 1.5, x + w, y + w * 1.5]; }
async function baseName(lng, lat) {
  try { const a = await loadAdmin(), t = townAt(a, lng, lat); if (t) return t.n; } catch (e) {}
  return placeTitle({ lng, lat }, 12).replace('洋蔥地圖', '這一帶');
}
async function baseLoadAll() {
  for (const k of await kv.list('base/')) if (k.endsWith('.json')) { const r = await kvJSON(k); if (r && r.id && !baseMem.list.some(b => b.id === r.id)) baseMem.list.push(r); }
  baseMem.list.sort((a, b) => a.at - b.at);
  for (const b of baseMem.list.slice()) {
    if (b.img) await baseShow(b);
    else if (!painterJob('base', b.id)) { baseMem.list.splice(baseMem.list.indexOf(b), 1); await kv.del('base/' + b.id + '.json'); } // 送出去之前就關掉的
  }
  baseLabels();
}
async function baseShow(b) { // 邊緣羽化，兩張相鄰的疊起來沒有硬邊
  if (!map.getSource('base-' + b.id)) {
    const im = await loadImg(b.img), c = imgCanvas(im, DRAFT_W, DRAFT_H), g = c.getContext('2d'), F = 72;
    g.globalCompositeOperation = 'destination-in';
    for (const [x0, y0, x1, y1] of [[0, 0, DRAFT_W, 0], [0, 0, 0, DRAFT_H]]) {
      const L = x1 || y1, gr = g.createLinearGradient(x0, y0, x1, y1), k = F / L;
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(k * 0.35, 'rgba(0,0,0,.2)'); gr.addColorStop(k, '#000'); gr.addColorStop(1 - k, '#000'); gr.addColorStop(1 - k * 0.35, 'rgba(0,0,0,.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, DRAFT_W, DRAFT_H);
    }
    const url = baseMem.urls[b.id] = URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/png')));
    map.addSource('base-' + b.id, { type: 'image', url, coordinates: b.quad });
  }
  if (!map.getLayer('base-' + b.id)) map.addLayer({ id: 'base-' + b.id, type: 'raster', source: 'base-' + b.id, maxzoom: BASE_FADE_B, paint: { 'raster-fade-duration': 0, 'raster-opacity': BASE_FADE } }, map.getLayer('base-names') ? 'base-names' : SHEET_TOP);
}
function baseLabels() { // AI 圖上沒有字：底圖範圍內補一層地名，跟底圖一起淡出
  const polys = baseMem.list.filter(b => b.img).map(b => { const q = b.quad; return [[...q, q[0]].slice().reverse()]; });
  if (map.getLayer('base-names')) map.removeLayer('base-names');
  if (!polys.length) return;
  if (!LABEL_LAYERS.includes('base-names')) LABEL_LAYERS.push('base-names');
  map.addLayer({ id: 'base-names', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 8, maxzoom: BASE_FADE_B,
    filter: ['all', ['match', ['get', 'class'], ['city', 'town', 'village', 'suburb', 'quarter'], true, false], ['within', { type: 'MultiPolygon', coordinates: polys }]],
    layout: { visibility: labelsOn ? 'visible' : 'none', 'text-field': NAME, 'text-font': FONT, 'text-letter-spacing': 0.08, 'text-padding': 12, 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      'text-size': ['match', ['get', 'class'], 'city', 21, 'town', 18, 'suburb', 17, 15] },
    paint: Object.assign({}, LABEL, { 'text-halo-width': 2.2, 'text-opacity': BASE_FADE }) }, SHEET_TOP);
}
async function baseDelete(id) {
  if (painterJob('base', id)) painterCancel('base', id);
  baseMem.list = baseMem.list.filter(b => b.id !== id);
  if (map.getLayer('base-' + id)) map.removeLayer('base-' + id);
  if (map.getSource('base-' + id)) map.removeSource('base-' + id);
  if (baseMem.urls[id]) { URL.revokeObjectURL(baseMem.urls[id]); delete baseMem.urls[id]; }
  baseLabels(); await kv.del('base/' + id + '.json');
}
async function baseStart() { // 以地圖中心這一帶送一張
  if (baseMem.busy) return;
  if (!painterTarget()) { painterSetup(baseStart); return; }
  const c = map.getCenter(); closeSheet();
  baseMem.busy = true; painterSettings(); toast('正在準備底稿…', 6000);
  try {
    const frame = baseFrame(c.lng, c.lat), r = await draftRender(frame), id = Date.now().toString(36);
    const b = { v: 1, id, at: Date.now(), name: await baseName(c.lng, c.lat), frame, ref: r.ref.toDataURL('image/png') };
    const draft = r.draft.toDataURL('image/jpeg', 0.92);
    await kvSafeSet('base/' + id + '.json', JSON.stringify(b)); baseMem.list.push(b);
    try { await painterSubmit('base', draft, id); } catch (e) { await baseDelete(id); throw e; }
    toast('送出去了，畫好會自己出現在地圖上', 4000);
  } catch (e) { toast(e.message || String(e), 5000); }
  baseMem.busy = false; painterSettings();
}
painterOn.base = async (job, img) => {
  const b = baseMem.list.find(x => x.id === job.key) || await kvJSON('base/' + job.key + '.json'); if (!b || !b.ref) return false;
  const r = await paintedIn(img, b.ref), f = r.fit;
  // AI 圖的四個角落在哪：對位後的框換回經緯度（左上、右上、右下、左下）
  const x0 = f.ox / 2, y0 = f.oy / 2, x1 = (f.ox + f.sx * DRAFT_W) / 2, y1 = (f.oy + f.sy * DRAFT_H) / 2;
  Object.assign(b, { img: r.img, fit: f, quad: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => frameLL(b.frame, x, y).map(v => +v.toFixed(6))) }); delete b.ref;
  await kvSafeSet('base/' + b.id + '.json', JSON.stringify(b));
  if (!baseMem.list.includes(b)) baseMem.list.push(b);
  await mapReady; await baseShow(b); baseLabels();
};
document.addEventListener('onion:painted', e => {
  const d = e.detail; if (d.kind !== 'base') return;
  const b = baseMem.list.find(x => x.id === d.key);
  if (d.ok) toast((b ? b.name + '一帶' : '手繪地圖') + '畫好了，回地圖看看', 4000);
  else { if (b && !b.img) baseDelete(b.id); if (d.error) toast('手繪地圖：' + d.error, 5000); }
  painterSettings();
});
// 設定頁的列與抽屜
function baseRow() {
  const busy = baseMem.busy || baseMem.list.some(b => !b.img), n = baseMem.list.filter(b => b.img).length;
  return '<button class="row" id="rowBase"><span class="lbl">把這一帶畫成手繪地圖</span><span class="val">' + (busy ? '正在畫' : n ? n + ' 張' : '') + '</span><svg class="chev"><use href="#i-chev"/></svg></button>';
}
function baseRowBind() { const b = $('rowBase'); if (b) b.onclick = baseSheet; }
async function baseSheet() {
  const c = map.getCenter(), far = map.getZoom() < 8, name = far ? '' : await baseName(c.lng, c.lat);
  const rows = baseMem.list.slice().reverse().map(b => { const d = new Date(b.at); return '<div class="row"><div class="lines"><span class="ttl">' + esc(b.name) + '一帶</span><span class="meta">' + (b.img ? (d.getMonth() + 1) + '/' + d.getDate() + ' 畫的' : '正在畫，大概要幾分鐘') + '</span></div><button class="btn plain compact press" data-del="' + esc(b.id) + '">' + (b.img ? '刪掉' : '取消') + '</button></div>'; }).join('');
  const el = openSheet('<h2>把這一帶畫成手繪地圖</h2><p>' + (far ? '先回地圖，拉近到想畫的地方，再來這裡。' : '現在地圖停在<b>' + esc(name) + '</b>。會把這附近約 12 公里寬、18 公里高，請 ChatGPT 畫成手繪地圖，畫好自動疊在你的地圖上。畫一張大概用掉 ChatGPT Go 每個月額度的 3%。') + '</p>' +
    (rows ? '<div class="section"><h2 class="pt-h3">畫過的</h2><div class="group">' + rows + '</div></div>' : '') +
    '<div class="actions">' + (far ? '<button class="btn primary full press" id="baseGo" data-far="1">回地圖</button>' : '<button class="btn primary full press" id="baseGo"' + (baseMem.busy ? ' disabled' : '') + '>畫這一帶</button>') + '<button class="btn plain full press" data-close>關閉</button></div>');
  el.querySelector('#baseGo').onclick = e => { if (e.currentTarget.dataset.far) { closeSheet(); go('map'); } else baseStart(); };
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = '確定' + b.textContent; return; }
    await baseDelete(b.dataset.del); painterSettings(); baseSheet();
  });
}
async function baseReset() { for (const b of baseMem.list.slice()) { if (map.getLayer('base-' + b.id)) map.removeLayer('base-' + b.id); if (map.getSource('base-' + b.id)) map.removeSource('base-' + b.id); if (baseMem.urls[b.id]) URL.revokeObjectURL(baseMem.urls[b.id]); } baseMem.list = []; baseMem.urls = {}; baseLabels(); painterSettings(); }
document.addEventListener('onion:wiped', baseReset);
document.addEventListener('onion:restored', async () => { await baseReset(); baseLoadAll(); });
hook.ready.push(() => { baseLoadAll().then(painterSettings).catch(e => console.warn('[base]', e)); });
