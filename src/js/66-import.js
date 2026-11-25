// --- 匯入以前的足跡：GPX、Google 時間軸（手機匯出、舊 Takeout）、洋蔥自己的備份 ---
/*IMPORT_CORE_START*/
// 純邏輯：不碰畫面與存檔。tests/import.test.mjs 直接拿這一段來測。
const IMP = {
  acc: 15,             // 檔案沒寫精度就當這個數字（公尺）
  accDrop: 50,         // 檔案有寫精度、而且比這個差的點不要
  stay: 25,            // 移動不到這個距離就當停在原地（公尺）。時間軸與手機紀錄的點會在原地晃
  stayGpx: 4,          // GPX 的點比較準，只濾掉幾乎沒動的
  visitR: 100,         // 停留期間，離停留點這麼近的點不算移動
  stepSec: 30,         // 稀疏的點補成每幾秒一點
  linkSec: 1800,       // 同一段移動裡，隔超過這麼久就不補線（不知道中間走哪裡）
  breakSec: 6 * 3600,  // 隔這麼久就當成另一段，不畫虛線連過去
  bigBytes: 200 * 1048576,
  gpxBytes: 200 * 1048576
};

const ImportCore = (() => {
  const fail = (code, msg) => Object.assign(new Error(msg), { imp: code });
  const MSG = {
    bad: '這個檔案讀不了，可能沒下載完整，重新匯出一次再試。',
    unknown: '看不懂這個檔案。可以匯入的有 Google 時間軸（.json）、GPX 路線檔、洋蔥的備份。',
    empty: '這個檔案裡沒有任何位置紀錄。',
    notime: '這個檔案沒有寫時間，分不出是哪一天走的，匯不進來。',
    zip: '這是壓縮檔，先解壓縮，再選裡面的檔案。',
    cancel: '已取消'
  };
  const T_MIN = Date.UTC(1995, 0, 1);

  // 點的袋子：用數字陣列裝，幾百萬點也不會把記憶體撐爆
  function bag() {
    let cap = 4096, n = 0, t = new Float64Array(cap), la = new Float64Array(cap), lo = new Float64Array(cap), ac = new Float32Array(cap), seg = new Int32Array(cap);
    const grow = (A, a) => { const b = new A(cap); b.set(a); return b; };
    const b = {
      acts: [], visits: [], segs: 0, undated: 0,
      get n() { return n; },
      t: i => t[i], lat: i => la[i], lng: i => lo[i], acc: i => ac[i], seg: i => seg[i],
      // ms 毫秒；acc 0＝檔案沒寫；s 大於 0＝GPX 的哪一段，0＝時間軸
      add(ms, lat, lng, acc, s) {
        if (!(ms > T_MIN) || ms > Date.now() + 864e5 || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180) || (lat === 0 && lng === 0)) return;
        if (n === cap) { cap *= 2; t = grow(Float64Array, t); la = grow(Float64Array, la); lo = grow(Float64Array, lo); ac = grow(Float32Array, ac); seg = grow(Int32Array, seg); }
        t[n] = Math.round(ms / 1000); la[n] = lat; lo[n] = lng; ac[n] = acc || 0; seg[n] = s || 0; n++;
      },
      act(a, z) { if (z > a) b.acts.push([Math.round(a / 1000), Math.round(z / 1000)]); },
      visit(a, z, lat, lng) {
        if (!(z >= a)) return;
        const pad = z - a > 120000 ? 30000 : 0; // 進出各往內縮一點，才不會跟前後那段移動的頭尾擠在同一秒
        b.add(a + pad, lat, lng, 0, 0); b.add(z - pad, lat, lng, 0, 0);
        b.visits.push([Math.round(a / 1000), Math.round(z / 1000), lat, lng]);
      },
      order() { // 照時間排好的索引。秒數與索引併成一個數字排，比自訂比較函式快很多
        if (n >= 4194304) throw fail('huge', '這個檔案的點太多了，請分成幾個檔案匯入。');
        const k = new Float64Array(n); let sorted = true;
        for (let i = 0; i < n; i++) { k[i] = t[i] * 4194304 + i; if (i && t[i] < t[i - 1]) sorted = false; }
        if (!sorted) k.sort();
        const o = new Uint32Array(n); for (let i = 0; i < n; i++) o[i] = sorted ? i : k[i] % 4194304;
        return o;
      }
    };
    return b;
  }

  // ---------- 讀 JSON：一塊一塊餵，湊滿一筆就交出去，不用把整個檔案放進記憶體 ----------
  // onItem(所在的欄位名, 物件)；onKey(最外層的欄位名) 回 false＝不用再讀
  function jsonStream(onItem, onKey) {
    let depth = 0, inStr = false, escd = false, root = '', key = '', last = '', sStart = -1, sCarry = '', iStart = -1, iCarry = '', itemDepth = -1, stop = false, seen = false;
    return {
      get root() { return root; },
      get stopped() { return stop; },
      feed(x) {
        if (stop) return;
        if (!seen && x.charCodeAt(0) === 0xFEFF) x = x.slice(1);
        const n = x.length; if (n) seen = true;
        if (iStart >= 0) iStart = 0;
        if (sStart >= 0) sStart = 0;
        for (let i = 0; i < n; i++) {
          const c = x.charCodeAt(i);
          if (inStr) {
            if (escd) { escd = false; continue; }
            if (c === 92) { escd = true; continue; }
            if (c !== 34) continue;
            inStr = false;
            if (sStart >= 0) { last = sCarry + x.slice(sStart, i); sCarry = ''; sStart = -1; }
            continue;
          }
          if (c <= 32) continue;
          if (c === 34) { inStr = true; if (depth === 1 && root === '{') { sStart = i + 1; sCarry = ''; } continue; }
          if (c === 123 || c === 91) { // { [
            if (depth === 0) { if (root) throw fail('bad', MSG.bad); root = x[i]; depth = 1; if (c === 91) { itemDepth = 1; key = ''; } continue; }
            if (depth === 1 && root === '{') itemDepth = c === 91 ? 2 : -1; // 只有陣列要逐筆拆
            else if (depth === itemDepth && iStart < 0) { iStart = i; iCarry = ''; }
            depth++; continue;
          }
          if (c === 125 || c === 93) { // } ]
            depth--;
            if (depth < 0) throw fail('bad', MSG.bad);
            if (iStart >= 0 && depth === itemDepth) {
              let o; try { o = JSON.parse(iCarry + x.slice(iStart, i + 1)); } catch (e) { throw fail('bad', MSG.bad); }
              iStart = -1; iCarry = ''; onItem(key, o);
            } else if (depth < itemDepth) itemDepth = -1;
            continue;
          }
          if (c === 58 && depth === 1 && root === '{') { key = last; if (onKey && onKey(key) === false) { stop = true; return; } continue; }
          if (depth === 0) throw fail('bad', MSG.bad); // 括號外面還有東西
        }
        if (iStart >= 0) { iCarry += x.slice(iStart); iStart = 0; }
        if (sStart >= 0) { sCarry += x.slice(sStart); sStart = 0; }
      },
      end() { if (!stop && (depth !== 0 || inStr || !root)) throw fail('bad', MSG.bad); }
    };
  }

  // ---------- 各種 Google 格式 ----------
  // 經緯度的寫法：'25.0330°, 121.5654°'（Android）、'geo:25.03,121.56'（iOS）、{latLng:'…'}、{latitudeE7, longitudeE7}、{latE7, lngE7}
  function latLng(v) {
    if (!v) return null;
    if (typeof v === 'string') {
      const m = v.replace(/^geo:/i, '').replace(/[°\s]/g, '').split(',');
      if (m.length < 2) return null;
      const a = +m[0], b = +m[1]; return m[0] !== '' && m[1] !== '' && isFinite(a) && isFinite(b) ? [a, b] : null;
    }
    if (v.latLng || v.LatLng) return latLng(v.latLng || v.LatLng);
    const e7 = x => { x = +x; if (x > 1800000000) x -= 4294967296; return x / 1e7; }; // 很舊的檔有溢位的值
    const a = v.latitudeE7 != null ? v.latitudeE7 : v.latE7, b = v.longitudeE7 != null ? v.longitudeE7 : v.lngE7;
    if (a == null || b == null || !isFinite(+a) || !isFinite(+b)) return null;
    return [e7(a), e7(b)];
  }
  const ms = (iso, num) => iso != null && iso !== '' ? Date.parse(iso) : num != null ? +num : NaN;
  const KEYS = ['semanticSegments', 'rawSignals', 'locations', 'timelineObjects'];

  // iOS 的 timelinePath 只精確到分鐘，同一分鐘會有好幾點：平均攤開，不然會算出誇張的速度
  function addPath(b, pts) { // pts：[[毫秒, 緯, 經]…]
    pts.sort((x, y) => x[0] - y[0]);
    for (let i = 0; i < pts.length;) {
      let j = i; while (j < pts.length && pts[j][0] === pts[i][0]) j++;
      const room = Math.min(60000, j < pts.length ? pts[j][0] - pts[i][0] : 60000), k = j - i;
      for (let q = i; q < j; q++) b.add(pts[q][0] + room * (q - i) / k, pts[q][1], pts[q][2], 0, 0);
      i = j;
    }
  }
  // 手機匯出的一段：Android 的 semanticSegments[]、iOS 陣列裡的每一筆。欄位名一樣，經緯度與時間的寫法不同
  function segment(b, s) {
    if (!s || typeof s !== 'object') return;
    const t0 = ms(s.startTime), t1 = ms(s.endTime);
    if (Array.isArray(s.timelinePath)) {
      const pts = [];
      for (const p of s.timelinePath) {
        const g = latLng(p && p.point); if (!g) continue;
        const off = p.durationMinutesOffsetFromStartTime;
        const t = p.time ? ms(p.time) : off != null && off !== '' ? t0 + +off * 60000 : t0;
        if (isFinite(t)) pts.push([t, g[0], g[1]]);
      }
      addPath(b, pts);
    }
    if (s.visit) {
      if (+(s.visit.hierarchyLevel || 0) > 0) return; // 大地點裡面的小地點，位置幾乎一樣
      const c = s.visit.topCandidate, g = latLng(c && c.placeLocation); if (g) b.visit(t0, t1, g[0], g[1]);
    }
    if (s.activity) {
      const a = latLng(s.activity.start), z = latLng(s.activity.end);
      if (a) b.add(t0, a[0], a[1], 0, 0);
      if (z) b.add(t1, z[0], z[1], 0, 0);
      b.act(t0, t1);
    }
  }
  function rawSignal(b, r) { const p = r && r.position, g = latLng(p && (p.LatLng || p.latLng)); if (g) b.add(ms(p.timestamp), g[0], g[1], p.accuracyMeters || 0, 0); }
  function record(b, r) { const g = latLng(r); if (g) b.add(ms(r.timestamp, r.timestampMs), g[0], g[1], +r.accuracy || 0, 0); }
  function dur(d) { return d ? [ms(d.startTimestamp, d.startTimestampMs), ms(d.endTimestamp, d.endTimestampMs)] : [NaN, NaN]; }
  function rawPath(b, p) { for (const q of (p && p.points) || []) { const g = latLng(q); if (g) b.add(ms(q.timestamp, q.timestampMs), g[0], g[1], q.accuracyMeters || 0, 0); } }
  function kmOf(a, b) { const D = Math.PI / 180, x = (b[1] - a[1]) * Math.cos((a[0] + b[0]) / 2 * D), y = b[0] - a[0]; return Math.hypot(x, y) * 111.195; }
  function timelineObject(b, o) {
    const v = o && o.placeVisit, a = o && o.activitySegment;
    if (v) {
      const [t0, t1] = dur(v.duration), g = latLng(v.location) || latLng({ latE7: v.centerLatE7, lngE7: v.centerLngE7 });
      if (g) b.visit(t0, t1, g[0], g[1]);
    }
    if (a) {
      const [t0, t1] = dur(a.duration), s = latLng(a.startLocation), z = latLng(a.endLocation);
      const way = ((a.waypointPath && a.waypointPath.waypoints) || (a.transitPath && a.transitPath.transitStops) || []).map(latLng).filter(Boolean);
      const raw = (a.simplifiedRawPath && a.simplifiedRawPath.points) || [];
      if (s) b.add(t0, s[0], s[1], 0, 0);
      if (z) b.add(t1, z[0], z[1], 0, 0);
      if (raw.length >= way.length) rawPath(b, a.simplifiedRawPath);
      else if (t1 > t0) { // 路上的點沒寫時間，照距離比例分配
        const line = [s, ...way, z].filter(Boolean), d = [0]; for (let i = 1; i < line.length; i++) d.push(d[i - 1] + kmOf(line[i - 1], line[i]));
        const total = d[d.length - 1] || 1; for (let i = 1; i < line.length - 1; i++) b.add(t0 + (t1 - t0) * d[i] / total, line[i][0], line[i][1], 0, 0);
      }
      b.act(t0, t1);
    }
  }
  const HANDLE = { '': segment, semanticSegments: segment, rawSignals: rawSignal, locations: record, timelineObjects: timelineObject };

  // ---------- GPX ----------
  // 不用 DOMParser：node 測試沒有，而且大檔會卡。只認 trkpt／rtept／wpt 的 lat、lon 與 time
  function* gpx(b, text) {
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    if (!/<(?:[\w-]+:)?gpx[\s>]/i.test(text.slice(0, 4000))) throw fail('unknown', MSG.unknown);
    if (!/<\/(?:[\w-]+:)?gpx\s*>\s*$/i.test(text.slice(-400))) throw fail('bad', MSG.bad);
    const re = /<((?:[\w-]+:)?)(trkseg|rte|trkpt|rtept|wpt)\b([^>]*?)(\/?)>/g, attr = (s, k) => { const m = new RegExp('\\b' + k + '\\s*=\\s*["\']([^"\']+)["\']').exec(s); return m ? +m[1] : NaN; };
    const wpts = []; let m, seg = b.segs, n = 0, undated = 0, dated = 0;
    while ((m = re.exec(text))) {
      const tag = m[2];
      if (tag === 'trkseg' || tag === 'rte') { seg = ++b.segs; continue; }
      const lat = attr(m[3], 'lat'), lon = attr(m[3], 'lon'); let t = NaN;
      if (!m[4]) {
        const end = text.indexOf('</' + m[1] + tag, re.lastIndex), body = end < 0 ? '' : text.slice(re.lastIndex, end);
        const q = /<(?:[\w-]+:)?time>\s*([^<]+?)\s*</.exec(body);
        if (q) t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(q[1]) ? q[1] : q[1] + (q[1].includes('T') ? 'Z' : '')); // 沒寫時區，照 GPX 規定當成世界標準時間
        if (end > 0) re.lastIndex = end;
      }
      if (!isFinite(t)) undated++;
      else if (tag === 'wpt') wpts.push([t, lat, lon]);
      else { dated++; b.add(t, lat, lon, 0, seg || (seg = ++b.segs)); }
      if (++n % 5000 === 0) yield m.index / text.length;
    }
    if (!dated) for (const w of wpts) b.add(w[0], w[1], w[2], 0, ++b.segs); // 有路線就不看標記點，標記點的時間常常是事後標的
    b.undated += dated || wpts.length ? 0 : undated;
  }

  // ---------- 認格式、讀進袋子 ----------
  // file：{ name, size, slice(a,b).arrayBuffer() }。回傳 { kind:'points' } 或 { kind:'backup', data }
  async function readFile(file, b, env) {
    if (!file.size) throw fail('empty', MSG.empty);
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4B) throw fail('zip', MSG.zip);
    const utf16 = (head[0] === 0xFF && head[1] === 0xFE) ? 'utf-16le' : (head[0] === 0xFE && head[1] === 0xFF) ? 'utf-16be' : 'utf-8';
    const first = new TextDecoder(utf16).decode(head).replace(/^\uFEFF/, '').trimStart();
    if (first[0] === '<') {
      if (file.size > IMP.gpxBytes) throw fail('huge', '這個 GPX 太大了，請分成幾個檔案匯入。');
      const text = new TextDecoder(utf16).decode(await file.slice(0, file.size).arrayBuffer());
      if (!/<(?:[\w-]+:)?gpx[\s>]/i.test(text.slice(0, 4000))) throw fail('unknown', MSG.unknown);
      for (const p of gpx(b, text)) { env.progress(p); await env.tick(); }
      return { kind: 'points' };
    }
    if (first[0] !== '{' && first[0] !== '[') throw fail('unknown', MSG.unknown);
    let backup = false, known = false;
    const st = jsonStream((key, o) => { const fn = HANDLE[key]; if (fn) { if (key === '' && o && !o.timelinePath && !o.visit && !o.activity) return; known = true; fn(b, o); } },
      key => { if (key === 'cells') { backup = true; return false; } if (KEYS.includes(key)) known = true; });
    const dec = new TextDecoder(utf16), CH = 1048576; // 一次 1MB，中間讓畫面喘口氣
    for (let at = 0; at < file.size && !backup; at += CH) {
      const buf = await file.slice(at, Math.min(file.size, at + CH)).arrayBuffer();
      st.feed(dec.decode(buf, { stream: at + CH < file.size }));
      env.progress(Math.min(1, (at + CH) / file.size)); await env.tick();
    }
    if (backup) {
      try { return { kind: 'backup', data: JSON.parse(new TextDecoder(utf16).decode(await file.slice(0, file.size).arrayBuffer()).replace(/^\uFEFF/, '')) }; } catch (e) { throw fail('bad', MSG.bad); }
    }
    st.end();
    if (!known) throw fail(st.root === '[' ? 'empty' : 'unknown', st.root === '[' ? MSG.empty : MSG.unknown);
    return { kind: 'points' };
  }

  // ---------- 整理：照時間跑一遍引擎。engine 是全新的，結果之後才併進去 ----------
  async function run(b, engine, haveDay, env) {
    if (!b.n) throw b.undated ? fail('notime', MSG.notime) : fail('empty', MSG.empty);
    const ord = b.order(), N = ord.length, skipped = new Set();
    const acts = b.acts.sort((x, y) => x[0] - y[0]), vis = b.visits.sort((x, y) => x[0] - y[0]);
    let ai = 0, vi = 0, dEnd = -1, skip = false, last = null, lastT = -1, anchor = null, hold = null, clock = Date.now();
    // 停在原地時只留第一點（anchor）；要離開時，把最後一次還在原地的時間（hold）補上去
    const put = p => engine.process({ lat: p[1], lng: p[2], acc: p[3], t: p[0] * 1000, spd: null });
    const emit = p => { // p：[秒, 緯, 經, 精度, GPX 段, 移動段]
      if (last) {
        const dt = p[0] - last[0], linked = p[4] ? p[4] === last[4] : p[5] >= 0 && p[5] === last[5];
        if (linked) {
          const km = kmOf([last[1], last[2]], [p[1], p[2]]);
          if (dt > IMP.stepSec && dt <= IMP.linkSec && km <= CFG.interpMaxKm && km > 0.03 && km / (dt / 3600) <= CFG.groundMaxKmh) {
            const n = Math.ceil(dt / IMP.stepSec);
            for (let i = 1; i < n; i++) put([Math.round(last[0] + dt * i / n), last[1] + (p[1] - last[1]) * i / n, last[2] + (p[2] - last[2]) * i / n, p[3]]);
          }
        } else if (dt > IMP.breakSec || (p[4] && dt > 600)) engine.resetLast();
      }
      put(p); last = p;
    };
    const leave = () => { if (hold && anchor && hold[0] - anchor[0] > 60) emit([hold[0], anchor[1], anchor[2], anchor[3], hold[4], hold[5]]); hold = null; };
    for (let i = 0; i < N; i++) {
      if (i % 64 === 0 && Date.now() - clock > 24) { env.progress(i / N); await env.tick(); clock = Date.now(); }
      const q = ord[i], t = b.t(q); if (t === lastT) continue;
      if (t >= dEnd) {
        const d = new Date(t * 1000), k = dayKey(t); dEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() / 1000;
        skip = haveDay(k); if (skip) { leave(); skipped.add(k); anchor = last = null; engine.resetLast(); }
      }
      if (skip) continue;
      const lat = b.lat(q), lng = b.lng(q), raw = b.acc(q), seg = b.seg(q);
      if (raw > IMP.accDrop) continue;
      if (raw && last && i + 1 < N) { // 一瞬間跳很遠又跳回來：定位飄掉了
        const r = ord[i + 1], a = kmOf([last[1], last[2]], [lat, lng]), c = kmOf([lat, lng], [b.lat(r), b.lng(r)]);
        if (a > 1 && a / ((t - last[0]) / 3600) > 200 && c / (Math.max(1, b.t(r) - t) / 3600) > 200 && kmOf([last[1], last[2]], [b.lat(r), b.lng(r)]) < a / 3) continue;
      }
      while (ai < acts.length && acts[ai][1] < t) ai++;
      while (vi < vis.length && vis[vi][1] < t) vi++;
      const act = ai < acts.length && acts[ai][0] <= t ? ai : -1, v = vi < vis.length && vis[vi][0] <= t ? vis[vi] : null;
      if (!seg && v && !(lat === v[2] && lng === v[3]) && kmOf([lat, lng], [v[2], v[3]]) * 1000 < IMP.visitR) continue;
      lastT = t;
      const p = [t, lat, lng, raw ? Math.min(raw, CFG.walkAcc) : IMP.acc, seg, act];
      if (anchor && kmOf([anchor[1], anchor[2]], [lat, lng]) * 1000 < (seg ? IMP.stayGpx : Math.max(IMP.stay, raw)) && seg === anchor[4]) { hold = p; continue; }
      leave(); emit(p); anchor = p;
    }
    leave();
    const days = {}; for (const p of engine.state().points) { const k = dayKey(p[0]); (days[k] || (days[k] = [])).push(p); }
    const km = engine.state().km;
    return { days, skipped: skipped.size, km: km.walk + km.vehicle };
  }

  // 給匯入用的 h3：結果一樣，把引擎一直重複問的東西記起來、距離改用純 JS 算（快十幾倍）。這個引擎的面積不會用到，不算
  function fastH3(h3) {
    const R = 6371.007180918475, D = Math.PI / 180, LIM = 60000, ll = new Map(), par = new Map(); let dc = '', dk = -1, disk = null;
    return {
      getHexagonEdgeLengthAvg: (r, u) => h3.getHexagonEdgeLengthAvg(r, u),
      cellArea: () => 0,
      latLngToCell: (a, b, r) => h3.latLngToCell(a, b, r),
      cellToParent(c, r) { const k = c.slice(0, 7); let v = par.get(k); if (v === undefined) par.set(k, v = h3.cellToParent(c, r)); return v; }, // 前 7 碼就決定了 res 4 的上層
      cellToLatLng(c) { let v = ll.get(c); if (!v) { if (ll.size > LIM) ll.clear(); ll.set(c, v = h3.cellToLatLng(c)); } return v; },
      gridDisk(c, k) { if (c !== dc || k !== dk) { disk = h3.gridDisk(c, k); dc = c; dk = k; } return disk; },
      greatCircleDistance(a, b, u) {
        const s1 = Math.sin((b[0] - a[0]) * D / 2), s2 = Math.sin((b[1] - a[1]) * D / 2), x = s1 * s1 + s2 * s2 * Math.cos(a[0] * D) * Math.cos(b[0] * D);
        return 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * R * (u === 'm' ? 1000 : 1);
      }
    };
  }

  function summary(n, km, skipped) {
    const k = km >= 10 ? Math.round(km) : +km.toFixed(1);
    if (!n) return skipped ? '這 ' + skipped + ' 天洋蔥本來就有紀錄，沒有加東西。' : MSG.empty;
    return '加進 ' + n + ' 天、' + k + ' 公里' + (skipped ? '，' + skipped + ' 天本來就有紀錄所以略過。' : '。');
  }
  return { bag, jsonStream, latLng, readFile, run, fastH3, summary, fail, MSG };
})();
/*IMPORT_CORE_END*/

// --- 畫面：設定頁一列、一個抽屜。檔案自己認，使用者只要選 ---
const importer = (() => {
  const PENDING = 'import-pending.json'; // 存到一半被關掉時，下次打開用它把半套的天收掉
  let job = null; // { cancelled, pct, text }
  const tick = (() => { const ch = new MessageChannel(), q = []; ch.port1.onmessage = () => { const f = q.shift(); f && f(); }; return () => new Promise(ok => { q.push(ok); ch.port2.postMessage(0); }); })();

  function row() {
    const el = $('mountImport'); if (!el) return;
    el.innerHTML = '<button class="row" id="impRow"><span class="lbl">匯入足跡或備份</span><span class="val" id="impVal"></span><svg class="chev"><use href="#i-chev"/></svg></button>';
    $('impRow').onclick = open;
    paintRow();
  }
  function paintRow() { const v = $('impVal'); if (v) v.textContent = job ? Math.round(job.pct * 100) + '%' : ''; }
  const body = html => openSheet('<div id="impSheet">' + html + '</div>');
  const onSheet = () => !!$('impSheet') && !$('sheetHost').hidden;

  function open() {
    if (job) return busy();
    const b = body('<div class="impText"><h2>匯入足跡或備份</h2><p>選一個檔案，走過的路就會加進來。已經有紀錄的日子不會動。</p></div>' +
      '<div class="section"><div class="group">' +
      '<div class="row"><span class="lines"><span class="ttl">Google 時間軸（iPhone）</span><span class="meta">Google 地圖 › 你的頭像 › 設定 › 個人內容 › 匯出時間軸資料</span></span></div>' +
      '<div class="row"><span class="lines"><span class="ttl">Google 時間軸（其他手機）</span><span class="meta">手機設定 › 位置 › 定位服務 › 時間軸 › 匯出時間軸資料</span></span></div>' +
      '<div class="row"><span class="lines"><span class="ttl">跑步、登山、單車 app</span><span class="meta">在那個 app 裡匯出成 GPX 檔</span></span></div>' +
      '<div class="row"><span class="lines"><span class="ttl">洋蔥的備份</span><span class="meta">會換掉手機裡現在的紀錄，換之前會先問你</span></span></div>' +
      '</div></div>' +
      '<div class="actions"><label class="btn primary full press" role="button">選檔案<input id="impFile" type="file" multiple hidden></label>' +
      '<button class="btn plain full press" data-close>先不要</button></div>');
    b.querySelector('#impFile').onchange = e => { const f = [...e.target.files]; if (f.length) start(f); };
  }
  function busy() {
    const b = body('<div class="impText"><h2>匯入足跡或備份</h2><p id="impStep"></p></div>' +
      '<div class="impBar" role="progressbar" aria-label="匯入進度" aria-valuemin="0" aria-valuemax="100"><i id="impFill"></i></div>' +
      '<p class="impNote" id="impNote"></p>' +
      '<div class="actions"><button class="btn secondary full press" id="impStop">取消</button></div>');
    b.querySelector('#impStop').onclick = () => { if (job && !job.saving) { job.cancelled = true; } };
    paint();
  }
  function paint() {
    paintRow(); if (!job || !$('impStep')) return;
    $('impStep').textContent = job.text; $('impNote').textContent = job.note || ''; $('impNote').hidden = !job.note;
    $('impFill').style.width = (job.pct * 100).toFixed(1) + '%'; $('impFill').parentNode.setAttribute('aria-valuenow', Math.round(job.pct * 100));
    $('impStop').disabled = !!job.saving;
  }
  function done(text, again, title) {
    job = null; paintRow();
    if (!onSheet()) { toast(text, 5000); return; }
    const b = body('<div class="impText"><h2>' + (title || (again ? '沒有匯入' : '匯入好了')) + '</h2><p>' + esc(text) + '</p></div><div class="actions">' +
      (again ? '<button class="btn primary full press" id="impAgain">重選檔案</button><button class="btn plain full press" data-close>先不要</button>'
        : '<button class="btn primary full press" data-close>好</button>') + '</div>');
    if (again) b.querySelector('#impAgain').onclick = open;
  }
  function askBackup(data, unread) { // 還原備份會整個換掉，先問一次。unread：手機裡的紀錄這次沒讀完整，天數不準就不講
    job = null; paintRow();
    const s = engine.state(), n = Object.keys(s.days).length;
    const b = body('<div class="impText"><h2>這是洋蔥的備份</h2><p>' + (unread ? '還原之後，手機裡現在的紀錄會整個換成備份裡的。' : n ? '還原之後，手機裡現在的 ' + n + ' 天紀錄會整個換成備份裡的。' : '還原之後就接著備份裡的紀錄繼續。') + '</p></div>' +
      '<div class="actions"><button class="btn primary full press" id="impRestore">還原備份</button><button class="btn plain full press" data-close>先不要</button></div>');
    b.querySelector('#impRestore').onclick = async e => {
      e.target.disabled = true; e.target.textContent = '還原中…'; b.querySelector('.actions [data-close]').hidden = true;
      try { await importAll(data); render(true); refreshData(); document.dispatchEvent(new Event('onion:restored')); done('備份裡的紀錄都回來了。', false, '還原好了'); }
      catch (x) { done(x.save ? '存不進去。看看手機空間夠不夠，再還原一次。' : '這份備份讀不了。', true, '沒有還原'); }
    };
  }

  async function start(files) {
    if (job) return;
    const me = job = { pct: 0, text: '讀檔案', cancelled: false }, size = files.reduce((a, f) => a + f.size, 0);
    if (size > IMP.bigBytes) me.note = '檔案有 ' + Math.round(size / 1048576) + ' MB，要算好幾分鐘。先不要關掉洋蔥。';
    busy();
    const step = (text, from, to) => ({
      progress: p => { me.text = text; me.pct = from + (to - from) * Math.min(1, p); },
      tick: async () => { paint(); await tick(); if (me.cancelled) throw ImportCore.fail('cancel', ImportCore.MSG.cancel); }
    });
    try {
      let unread = false; await restored.catch(() => { unread = true; }); unread = unread || store.locked;
      const b = ImportCore.bag(); let at = 0;
      for (const f of files) {
        const r = await ImportCore.readFile(f, b, step('讀檔案', 0.4 * at / size, 0.4 * (at + f.size) / size)); at += f.size;
        if (r.kind === 'backup') {
          if (files.length > 1) throw ImportCore.fail('mix', '洋蔥的備份要單獨選，一次一個。');
          askBackup(r.data, unread); return;
        }
      }
      if (unread) throw ImportCore.fail('locked', '手機裡的紀錄這次沒讀完整，重開洋蔥再匯入，免得蓋到舊的。'); // 備份可以還原（整個換掉，等於救回來），足跡不行
      const days = engine.state().days, today = dayKey(Date.now()), tmp = createEngine(ImportCore.fastH3(h3));
      const r = await ImportCore.run(b, tmp, k => !!days[k] || (recording && k === today), step('整理走過的路', 0.4, 0.9));
      for (const k in r.days) if (days[k]) delete r.days[k]; // 算的時候剛好開始記錄今天
      const keys = Object.keys(r.days);
      if (keys.length) await commit(me, tmp, r.days, keys);
      done(ImportCore.summary(keys.length, r.km, r.skipped), !keys.length);
      if (keys.length) setTimeout(() => render(true), 50); // 讓結果先出來，再重算霧
    } catch (e) {
      if (e.imp === 'cancel') { job = null; paintRow(); if (onSheet()) closeSheet(); toast('已取消，什麼都沒加'); return; }
      if (!e.imp) console.error(e);
      done(e.imp ? e.message : '匯入沒有成功，什麼都沒加。' + (e.message ? '（' + e.message + '）' : ''), true);
    }
  }
  // 全部算完才動手：先寫每天的點，再併進引擎、存總表。中途失敗就把寫好的刪掉
  async function commit(me, tmp, dayPts, keys) {
    me.saving = true; me.text = '存進手機';
    const wrote = [];
    try {
      await kv.set(PENDING, JSON.stringify(keys));
      for (const k of keys) {
        wrote.push(k); await kvSafeSet('days/' + k + '.json', JSON.stringify(dayPts[k]));
        me.pct = 0.9 + 0.1 * wrote.length / keys.length; if (wrote.length % 10 === 0) { paint(); await tick(); }
      }
    } catch (e) {
      for (const k of wrote) { try { await kv.del('days/' + k + '.json'); await kv.del('days/' + k + '.json.tmp'); } catch (x) {} }
      await kv.del(PENDING); throw e;
    }
    const o = tmp.state(), none = { cells: {}, flights: [], gaps: [], km: {} }; // 格子分批併，幾十萬格一次併會卡住畫面好幾秒
    let part = {}, n = 0;
    for (const c in o.cells) { part[c] = o.cells[c]; if (++n % 10000 === 0) { engine.merge({ ...none, cells: part }, {}); part = {}; await tick(); } }
    engine.merge({ ...none, cells: part, flights: o.flights, gaps: o.gaps, km: o.km }, dayPts);
    if (saving) await saving; // 剛好有一次存檔在跑，等它完
    for (let i = 0; i < 3; i++) { await flushSave(); if (await inMeta(keys)) { await kv.del(PENDING); break; } } // 總表真的存進去了才拿掉記號
    refreshData();
    document.dispatchEvent(new CustomEvent('onion:imported', { detail: { days: keys } }));
  }
  async function inMeta(keys) { const m = await kvJSON('meta.json'); return !!(m && m.days && keys.every(k => m.days[k])); }
  // 上次存到一半就被關掉：那幾天的點在、霧與總表不在，收掉重來
  async function recover() {
    const raw = await kvTry(PENDING); if (!raw || store.locked) return;
    let keys = []; try { keys = JSON.parse(raw); } catch (e) {}
    if (await inMeta(keys)) return kv.del(PENDING); // 其實都存好了
    const s = engine.state(), today = dayKey(Date.now()); let n = 0;
    for (const k of keys) { if (k === today) continue; await kv.del('days/' + k + '.json'); await kv.del('days/' + k + '.json.tmp'); if (s.days[k]) { delete s.days[k]; n++; } }
    if (n) { const gone = new Set(keys); s.points = s.points.filter(p => !gone.has(dayKey(p[0])) || dayKey(p[0]) === today); engine.touchMeta(); saveSoon(); render(true); toast('上次匯入沒存完，已經收掉，再匯入一次就好', 5000); }
    await kv.del(PENDING);
  }
  row();
  hook.ready.push(() => { recover(); });
  return { open, start, get job() { return job; } };
})();
