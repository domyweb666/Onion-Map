// --- 行政區探索度：內政部的鄉鎮市區界線（tools/admin/build_admin.py 轉的），製圖時才載 ---
let adminP = null;
function loadAdmin() {
  if (adminP) return adminP;
  return adminP = fetch('assets/admin/tw-admin.json').then(r => r.json()).then(d => {
    for (const t of d.towns) t.rings = t.p.map(poly => poly.map(r => { // 整數差分 → 經緯度陣列
      const a = new Float64Array(r.length); let x = 0, y = 0;
      for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; a[i] = x / 1e4; a[i + 1] = y / 1e4; }
      return a;
    }));
    return d;
  }).catch(e => { adminP = null; throw e; });
}
function inRing(a, x, y) { let c = false; for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) { const yi = a[i + 1], yj = a[j + 1]; if ((yi > y) !== (yj > y) && x < (a[j] - a[i]) * (y - yi) / (yj - yi) + a[i]) c = !c; } return c; }
function townAt(adm, lng, lat) {
  for (const t of adm.towns) {
    if (lng < t.b[0] || lng > t.b[2] || lat < t.b[1] || lat > t.b[3]) continue;
    for (const poly of t.rings) if (inRing(poly[0], lng, lat) && !poly.slice(1).some(h => inRing(h, lng, lat))) return t;
  }
  return null;
}
let exploredCache = null;
function exploredByTown(adm) { // 每個鄉鎮、縣市探索過多少 km²：格子中心落在哪區就算哪區。格子數沒變就用上次的
  const cells = engine.state().cells, ids = Object.keys(cells);
  if (exploredCache && exploredCache.n === ids.length) return exploredCache;
  const town = new Map(), county = new Map(); let last = null;
  for (const c of ids) {
    const [lat, lng] = h3.cellToLatLng(c), a = h3.cellArea(c, 'km2');
    const t = last && townAtOne(last, lng, lat) ? last : townAt(adm, lng, lat); // 相鄰的格子多半在同一區，先試上一個
    if (!t) continue; last = t;
    town.set(t, (town.get(t) || 0) + a); county.set(t.c, (county.get(t.c) || 0) + a);
  }
  return exploredCache = { n: ids.length, town, county };
}
function townAtOne(t, lng, lat) {
  if (lng < t.b[0] || lng > t.b[2] || lat < t.b[1] || lat > t.b[3]) return false;
  return t.rings.some(poly => inRing(poly[0], lng, lat) && !poly.slice(1).some(h => inRing(h, lng, lat)));
}
function fmtPct(p) { return p >= 10 ? p.toFixed(0) + '%' : p >= 1 ? p.toFixed(1) + '%' : p >= 0.01 ? p.toFixed(2) + '%' : p > 0 ? '不到 0.01%' : '0%'; }

