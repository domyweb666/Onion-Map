/*ENGINE_START*/
// ===== 探索引擎：純邏輯，不碰地圖與畫面，方便獨立測試 =====
const CFG = {
  res: 12,            // H3 解析度（每格邊長約 10 公尺）
  walkR: 30,          // 步行揭露半徑（公尺）
  vehR: 14,           // 車／火車揭露半徑（公尺，沿路一條窄帶）
  walkAcc: 25,        // 步行最差可接受精度（公尺）
  vehAcc: 60,         // 車速時最差可接受精度
  maxAcc: 200,        // 超過這個精度一律丟掉
  walkMaxKmh: 25,     // 低於此速度＝步行／騎車
  groundMaxKmh: 330,  // 地面交通上限（高鐵約 300）
  flightMinKm: 50,    // 飛行至少要跳這麼遠，避免 GPS 跳點被當成飛機
  interpWalkSec: 180, // 兩點間隔在此秒數內才補線（步行）
  interpVehSec: 600,  // 兩點間隔在此秒數內才補線（車）
  interpMaxKm: 40,    // 補線最長距離
  revisitMin: 30,     // 離開超過幾分鐘再回來，才算「又來一次」
  shardRes: 4,        // 格子存檔的分片（一片約 1770 平方公里），只重寫有變的那片
  keepDays: 60        // 記憶體裡留最近幾天的軌跡點；更早的在檔案裡，要用時 loadDay(key)
};
const dayKey = t => { const d = new Date(t < 1e12 ? t * 1000 : t), p = x => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

function createEngine(h3) {
  const EDGE = h3.getHexagonEdgeLengthAvg(CFG.res, 'm');
  let s, last, dirty, shards, buckets, dirtyShards, dirtyDays, dirtyMeta;
  // points：最近 keepDays 天的軌跡點（照時間排）；days：每一天的摘要，全部都在；ext：其他模組自己的資料（地點、印章、配對…）
  function blank() {
    s = { cells: {}, flights: [], gaps: [], points: [], days: {}, area: 0, km: { walk: 0, vehicle: 0, flight: 0 }, ext: {} };
    last = null; dirty = true; shards = new Map(); buckets = new Map(); dirtyShards = new Set(); dirtyDays = new Set(); dirtyMeta = true;
  }
  blank();
  // 索引字串就是它的階層：第 r 層的位數在第 47-3r～45-3r 個位元，前 7 碼蓋到第 32 個位元，所以同樣前 7 碼一定同一個第 4 層上層
  const parents = new Map();
  function shardOf(c) { const p = c.slice(0, 7); let k = parents.get(p); if (k === undefined) parents.set(p, k = h3.cellToParent(c, CFG.shardRes)); return k; }
  function addCell(c, v) {
    const fresh = !s.cells[c];
    if (fresh) s.area += h3.cellArea(c, 'km2');
    s.cells[c] = v;
    const k = shardOf(c); let set = shards.get(k); if (!set) shards.set(k, set = new Set());
    set.add(c); dirtyShards.add(k);
    if (fresh) { const b = c.slice(0, 9), list = buckets.get(b); if (list) list.push(c); else buckets.set(b, [c]); } // 前 9 碼＝第 7 層（寬約 2.4 公里），畫地圖時只拿視野附近的
  }
  // 一天的摘要：里程規則跟補線一樣（間隔太久、跳太遠的兩點不連線）
  function newDay(t) { return { t0: t, t1: t, walk: 0, veh: 0, fl: 0, n: 0, box: [180, 90, -180, -90] }; } // t 是毫秒；box＝西南東北
  function addToDay(e, p, prev) {
    const t = p[0] * 1000;
    if (p[4] === 'f') e.fl++;
    else if (prev) {
      const km = h3.greatCircleDistance([prev[1], prev[2]], [p[1], p[2]], 'km'), dt = p[0] - prev[0];
      if (dt <= (p[4] === 'v' ? CFG.interpVehSec : CFG.interpWalkSec) && km <= CFG.interpMaxKm) e[p[4] === 'v' ? 'veh' : 'walk'] += km;
    }
    e.t0 = Math.min(e.t0, t); e.t1 = Math.max(e.t1, t); e.n++;
    const b = e.box; b[0] = Math.min(b[0], p[2]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[2]); b[3] = Math.max(b[3], p[1]);
  }
  function summarize(pts) { let e = null, prev = null; for (const p of pts) { if (!e) e = newDay(p[0] * 1000); addToDay(e, p, prev); prev = p; } return e; }
  function trimOld() { // 太舊的點移出記憶體（已經在檔案裡）。還沒存的那天不動
    const cut = dayKey(Date.now() - CFG.keepDays * 864e5); let i = 0, k; // 整天整天移，不留半天
    while (i < s.points.length && (k = dayKey(s.points[i][0])) < cut && !dirtyDays.has(k)) i++;
    if (i > 500) s.points.splice(0, i);
  }

  function touch(c, t) {
    const e = s.cells[c];
    if (!e) { addCell(c, [1, t]); dirty = true; }
    else {
      if (t - e[1] > CFG.revisitMin * 60000) { e[0]++; dirty = true; }
      e[1] = t; dirtyShards.add(shardOf(c));
    }
  }
  function reveal(lat, lng, r, t) {
    const c0 = h3.latLngToCell(lat, lng, CFG.res);
    const k = Math.ceil(r / (EDGE * 1.5)) + 1;
    for (const c of h3.gridDisk(c0, k)) {
      if (h3.greatCircleDistance([lat, lng], h3.cellToLatLng(c), 'm') <= r + EDGE * 0.5) touch(c, t);
    }
  }
  function revealLine(a, b, r, t) {
    const d = h3.greatCircleDistance([a.lat, a.lng], [b.lat, b.lng], 'm');
    const n = Math.max(1, Math.ceil(d / Math.max(r * 0.6, 5)));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      reveal(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f, r, t);
    }
  }

  // f = {lat, lng, acc(公尺), t(毫秒), spd(公尺/秒 或 null)}
  function process(f) {
    if (!(f.acc <= CFG.maxAcc)) return { ok: false, why: '定位精度太差（' + Math.round(f.acc) + 'm）' };
    if (last && f.t <= last.t) last = null;
    let mode = 'walk', km = 0, dt = 0, kmh = 0, gk = 0;
    if (last) {
      km = h3.greatCircleDistance([last.lat, last.lng], [f.lat, f.lng], 'km');
      dt = (f.t - last.t) / 1000;
      kmh = km / (dt / 3600);
      gk = (f.spd != null && f.spd >= 0 && dt < 30) ? f.spd * 3.6 : kmh;
      if (km >= CFG.flightMinKm && kmh > CFG.groundMaxKmh) mode = 'flight';
      else if (kmh > CFG.groundMaxKmh) return { ok: false, why: 'GPS 跳點，已略過' };
      else if (gk > CFG.walkMaxKmh) mode = 'vehicle';
    }
    if (mode === 'flight') {
      s.flights.push([last.lng, last.lat, f.lng, f.lat, last.t, f.t]);
      s.km.flight += km; dirty = true;
      if (f.acc <= CFG.walkAcc) reveal(f.lat, f.lng, CFG.walkR, f.t);
    } else {
      const maxAcc = mode === 'walk' ? CFG.walkAcc : CFG.vehAcc;
      if (f.acc > maxAcc) return { ok: false, mode, kmh: gk, why: '精度 ' + Math.round(f.acc) + 'm，等更準的定位' };
      const r = mode === 'walk' ? CFG.walkR : CFG.vehR;
      const lim = mode === 'walk' ? CFG.interpWalkSec : CFG.interpVehSec;
      if (last && dt <= lim && km <= CFG.interpMaxKm) {
        revealLine(last, f, r, f.t);
        s.km[mode] += km;
      } else {
        reveal(f.lat, f.lng, r, f.t);
        if (last && km > 1) { s.gaps.push([last.lng, last.lat, f.lng, f.lat]); dirty = true; }
      }
    }
    last = f;
    const p = [Math.round(f.t / 1000), +f.lat.toFixed(6), +f.lng.toFixed(6), Math.round(f.acc), mode[0]], k = dayKey(p[0]);
    const prev = s.points[s.points.length - 1], same = prev && prev[0] <= p[0] && dayKey(prev[0]) === k;
    addToDay(s.days[k] || (s.days[k] = newDay(p[0] * 1000)), p, same ? prev : null);
    s.points.push(p); dirtyDays.add(k); dirtyMeta = true;
    if (s.points.length % 2000 === 0) trimOld();
    return { ok: true, mode, kmh: gk, km };
  }

  return {
    process,
    state: () => s,
    buckets: () => buckets, // Map：第 7 層的前 9 碼 → 那一塊裡的格子
    takeDirty() { const d = dirty; dirty = false; return d; },
    resetLast() { last = null; },
    clear: blank,
    summarize,
    touchMeta() { dirtyMeta = true; },
    // --- 存檔用：哪些片、哪些天、總表有變 ---
    takeSaves() { const r = { shards: [...dirtyShards], days: [...dirtyDays], meta: dirtyMeta }; dirtyShards = new Set(); dirtyDays = new Set(); dirtyMeta = false; return r; },
    putBackSaves(r) { r.shards.forEach(k => dirtyShards.add(k)); r.days.forEach(k => dirtyDays.add(k)); dirtyMeta = dirtyMeta || r.meta; },
    shardData(k) { const o = {}; for (const c of shards.get(k) || []) o[c] = s.cells[c]; return o; },
    dayPoints(k) { // 只認得記憶體裡的
      const [y, m, dd] = k.split('-').map(Number), end = new Date(y, m - 1, dd + 1).getTime() / 1000; // 從那天結束的地方往回走，不然還原好幾年的備份時每一天都要從頭掃一次
      let lo = 0, hi = s.points.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (s.points[mid][0] < end) lo = mid + 1; else hi = mid; }
      const out = []; for (let i = lo - 1; i >= 0; i--) { const d = dayKey(s.points[i][0]); if (d === k) out.push(s.points[i]); else if (d < k) break; }
      return out.reverse();
    },
    meta: () => ({ v: 2, flights: s.flights, gaps: s.gaps, km: s.km, days: s.days, ext: s.ext }),
    // --- 讀檔用 ---
    loadMeta(m) {
      s.flights = m.flights || []; s.gaps = m.gaps || []; s.days = m.days || {}; s.ext = m.ext || {};
      s.km = Object.assign({ walk: 0, vehicle: 0, flight: 0 }, m.km || {}); dirty = true;
    },
    loadCells(o) { for (const c in o) { try { addCell(c, o[c]); } catch (e) {} } dirty = true; },
    loadPoints(list) { s.points = list.slice().sort((a, b) => a[0] - b[0]); last = null; dirty = true; },
    clean() { dirtyShards = new Set(); dirtyDays = new Set(); dirtyMeta = false; },
    // 併入另一個引擎的紀錄（匯入 GPX、時間軸）。dayPts：{ 'YYYY-MM-DD': [點…] }。已經有紀錄的那天整天略過，回傳真的加進來的天
    // 呼叫端要先用略過後的天去跑那個引擎，這裡不再檢查格子從哪天來
    merge(o, dayPts) {
      for (const c in o.cells) { const e = s.cells[c], v = o.cells[c]; addCell(c, e ? [e[0] + v[0], Math.max(e[1], v[1])] : v.slice()); }
      s.flights.push(...o.flights); s.gaps.push(...o.gaps);
      for (const k in o.km) s.km[k] = (s.km[k] || 0) + o.km[k];
      const cut = dayKey(Date.now() - CFG.keepDays * 864e5), recent = [];
      for (const k in dayPts) { s.days[k] = summarize(dayPts[k]); if (k >= cut) recent.push(...dayPts[k]); }
      if (recent.length) s.points = s.points.concat(recent).sort((a, b) => a[0] - b[0]);
      last = null; dirty = true; dirtyMeta = true;
    },
    // 舊格式（v1：整包一個檔）讀進來；點全留在記憶體，由存檔層拆成逐日檔
    load(d) {
      blank();
      if (!d || typeof d !== 'object') return;
      s.flights = d.flights || []; s.gaps = d.gaps || []; s.ext = d.ext || {};
      s.km = Object.assign({ walk: 0, vehicle: 0, flight: 0 }, d.km || {});
      for (const c in d.cells || {}) { try { addCell(c, d.cells[c]); } catch (e) {} }
      const all = (d.points || []).map(p => p[0] < 1e12 ? p : [Math.round(p[0] / 1000), ...p.slice(1)]).sort((a, b) => a[0] - b[0]), by = {};
      for (const p of all) { const k = dayKey(p[0]); (by[k] || (by[k] = [])).push(p); }
      for (const k in by) { s.days[k] = summarize(by[k]); dirtyDays.add(k); }
      s.points = all; dirty = true; dirtyMeta = true;
    }
  };
}
/*ENGINE_END*/
