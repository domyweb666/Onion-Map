// ===== 一日地圖卡：製圖頁的「一天」。底稿離屏畫、AI 重畫、路線與字都在手機上畫（桌面版是 tools/daycard/daycard.py） =====
// 存 kv 'cards/<日期>.json'：{v, key, n, frame, facts, draft, img?, fit?, next?}。next 是送去畫、還沒回來的那一份（畫好才蓋過舊的）

/*DAYCORE_START*/
// 純邏輯，node 直接測（tests/daycard.test.mjs）。點的格式 [秒, lat, lng, 精度, 'w'|'v'|'f']
const DAYCORE = (() => {
  const C = {
    trim: 300,                       // 隱私：離當天起點、終點這麼多公尺內的點都不要（免得露出住家）。固定開，不給設定
    stopR: 60, stopMin: 12,          // 停留：這麼多公尺內待滿幾分鐘
    minPts: 10,                      // 少於這麼多點不做卡
    pad: 0.15, minM: 1500,           // 範圍：軌跡外框往外加，最小多少公尺
    grow: 1.3,                       // 為了讓路線避開板子，範圍最多再放大到這麼多倍
    bleed: 1024 / 896,               // 送去畫的比卡片大一圈：AI 的圖飄一點，邊也不會露出來
    maxStops: 6, marks: 5, placeNear: 80
  };
  const RAD = Math.PI / 180;
  function dist(a, b, c, d) { const s = Math.sin((c - a) * RAD / 2), t = Math.sin((d - b) * RAD / 2); return 12742000 * Math.asin(Math.min(1, Math.sqrt(s * s + Math.cos(a * RAD) * Math.cos(c * RAD) * t * t))); }
  const dp = (a, b) => dist(a[1], a[2], b[1], b[2]);
  // 去掉飛行、頭尾各剪 300 公尺。剪掉的地方要斷開，不然前後會連成一條假的路、中間還會變成假的停留
  function trim(pts, trimM) {
    const r = trimM == null ? C.trim : trimM, g = pts.filter(p => p[4] !== 'f');
    if (g.length < C.minPts) return { segs: [], n: g.length, few: true, close: false, cut: 0 };
    const a = g[0], b = g[g.length - 1], legs = [{ n: 0, segs: [] }]; let cur = null, cut = 0;
    for (const p of pts) {
      if (p[4] === 'f') { cur = null; legs.push({ n: 0, segs: [] }); continue; } // 搭飛機：落地算另一段旅程，卡片只畫點最多的那一段
      if (r > 0 && (dp(p, a) <= r || dp(p, b) <= r)) { cur = null; cut++; continue; }
      const l = legs[legs.length - 1]; if (!cur) l.segs.push(cur = []);
      cur.push(p); l.n++;
    }
    const best = legs.reduce((x, y) => y.n > x.n ? y : x);
    return { segs: best.segs, n: best.n, few: false, close: best.n < C.minPts, cut };
  }
  function stops(pts) {
    const out = [];
    for (let i = 0; i < pts.length;) {
      let j = i; while (j + 1 < pts.length && dp(pts[j + 1], pts[i]) <= C.stopR) j++;
      if (pts[j][0] - pts[i][0] >= C.stopMin * 60) {
        let la = 0, ln = 0; for (let k = i; k <= j; k++) { la += pts[k][1]; ln += pts[k][2]; }
        out.push({ lat: la / (j - i + 1), lng: ln / (j - i + 1), t0: pts[i][0], t1: pts[j][0], minutes: Math.round((pts[j][0] - pts[i][0]) / 60), i0: i, i1: j });
        i = j + 1;
      } else i++;
    }
    return out;
  }
  const hm = t => { const d = new Date(t * 1000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function stats(segs, byseg) { // 里程用五點移動平均後的座標算，GPS 抖動才不會灌水
    let m = 0, car = 0, move = 0, nst = 0;
    segs.forEach((pts, si) => {
      const inS = new Uint8Array(pts.length); for (const s of byseg[si]) { nst++; for (let i = s.i0; i <= s.i1; i++) inS[i] = 1; }
      const sm = pts.map((_, i) => { const q = pts.slice(Math.max(0, i - 2), i + 3); return [0, q.reduce((a, p) => a + p[1], 0) / q.length, q.reduce((a, p) => a + p[2], 0) / q.length]; });
      for (let i = 1; i < pts.length; i++) {
        if (inS[i] && inS[i - 1]) continue;
        const dt = pts[i][0] - pts[i - 1][0]; if (dt > 1800) continue; // 中間沒在記錄，不算走路
        move += dt;
        const v = pts[i][4] === 'v' || pts[i - 1][4] === 'v', d = dp(sm[i], sm[i - 1]);
        if (dt > 0 && dt <= 600 && d / dt < (v ? 92 : 8)) { m += d; if (v) car += d; }
      }
    });
    const all = segs.filter(s => s.length);
    return { km: Math.round(m / 100) / 10, car: Math.round(car / 100) / 10, moving_min: Math.round(move / 60), stops: nst, start: hm(all[0][0][0]), end: hm(all[all.length - 1][all[all.length - 1].length - 1][0]) };
  }
  // 一天的點 → {few|close} 或 {segs, stops, stats}
  function day(pts, trimM) {
    const t = trim(pts, trimM); if (t.few || t.close) return t;
    const by = t.segs.map(stops), st = stats(t.segs, by);
    return { segs: t.segs, n: t.n, cut: t.cut, stops: [].concat(...by), stats: st };
  }
  const K = 20037508.342789244 / 180, mx = lng => lng * K, my = lat => Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * K;
  // 版面：畫布大小、板子外框的位置、四款框的窗（1080×1620；4:5 從直邊抽掉 270）。框換了要跟著改
  const SIZES = { tall: { w: 1080, h: 1620, ui: { l: 110, t: 200, r: 970, b: 1420 }, name: '直式' }, ig: { w: 1080, h: 1350, ui: { l: 110, t: 200, r: 970, b: 1180 }, name: 'IG 4:5' } };
  const WINS = [[92, 186, 984, 1505], [69, 104, 1008, 1521], [22, 39, 1047, 1588], [51, 70, 1013, 1510]], TITLE_H = 146, STAT_H = 108;
  const rowsH = n => n ? 44 + 36 * n : 0;
  // 板子佔的框。w：標題、行程表、統計的寬（還沒量字就用一般寬度）。比例尺在統計上面
  function boards(size, rows, w) {
    const U = SIZES[size].ui, q = Object.assign({ title: 420, list: 490, stat: 345 }, w), o = [[U.l, U.t, U.l + q.title, U.t + TITLE_H], [U.r - q.stat, U.b - STAT_H, U.r, U.b], [U.r - 252, U.b - STAT_H - 66, U.r + 8, U.b - STAT_H]];
    if (rows) o.push([U.l, U.b - rowsH(rows), U.l + q.list, U.b]);
    return o;
  }
  // 底稿的哪一塊放進窗：讓路線、停留點避開板子，起點（旗子）終點（叉）一定要露出來。全部是底稿像素，C 是可以用的範圍
  function bestView(route, stopsPx, win, boxes, C, minW) {
    const [l, t, r, b] = win, a = (r - l) / (b - t), maxW = Math.min(C[2] - C[0], (C[3] - C[1]) * a), A = route[0], Z = route[route.length - 1];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of route) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const w0 = Math.min(maxW, Math.max(minW, (x1 - x0) * 1.15, (y1 - y0) * 1.15 * a)), step = Math.ceil(route.length / 110), pts = route.filter((_, i) => i % step === 0);
    const bad = (X0, Y0, X1, Y1, m) => X0 < l + m || X1 > r - m || Y0 < t + m || Y1 > b - m || boxes.some(q => X1 > q[0] && X0 < q[2] && Y1 > q[1] && Y0 < q[3]);
    const top = boxes[0][3], bot = Math.min(...boxes.slice(1).map(q => q[1])); let best = null; // 標題板下緣、行程表與比例尺上緣：路線盡量落在中間
    for (let n = 0; n <= 10; n++) {
      const w = w0 + (maxW - w0) * n / 10, h = w / a, k = (r - l) / w;
      for (let i = 0; i <= 12; i++) for (let j = 0; j <= 16; j++) {
        const vx = C[0] + (C[2] - C[0] - w) * i / 12, vy = C[1] + (C[3] - C[1] - h) * j / 16, X = x => (x - vx) * k + l, Y = y => (y - vy) * k + t;
        let hard = 0, soft = 0;
        if (bad(X(A[0]) - 16, Y(A[1]) - 42, X(A[0]) + 32, Y(A[1]) + 8, 26)) hard++;
        if (bad(X(Z[0]) - 22, Y(Z[1]) - 28, X(Z[0]) + 22, Y(Z[1]) + 16, 26)) hard++;
        for (const q of stopsPx) if (bad(X(q[0]) - 21, Y(q[1]) - 21, X(q[0]) + 21, Y(q[1]) + 21, 20)) soft += 0.15;
        let o = 0, out = 0; for (const p of pts) { const x = X(p[0]), y = Y(p[1]); if (bad(x - 8, y - 8, x + 8, y + 8, 18)) o++; if (y < top || y > bot) out++; }
        soft += o / pts.length;
        const dx = (X((x0 + x1) / 2) - (l + r) / 2) / (r - l), dy = (Y((y0 + y1) / 2) - (t + b) / 2) / (b - t), cost = hard * 1000 + soft * 100 + out / pts.length * 25 + (w / w0 - 1) * 6 + (dx * dx + dy * dy) * 10;
        if (!best || cost < best.cost) best = { cost, hard, soft, view: [vx, vy, w, h] };
      }
      if (best.cost < (w / w0 - 1) * 6) break;
    }
    return best;
  }
  // 範圍（送去畫的，含外圈，麥卡托公尺）。軌跡外框加 15%、最小 1.5 公里、2:3；路線會被板子蓋到就放大，最多 1.3 倍
  function extent(segs, stops) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, la = 0, n = 0;
    for (const s of segs) for (const p of s) { const x = mx(p[2]), y = my(p[1]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); la += p[1]; n++; }
    const min = C.minM / Math.cos(la / n * RAD); let w = Math.max((x1 - x0) * (1 + 2 * C.pad), min), h = Math.max((y1 - y0) * (1 + 2 * C.pad), min);
    if (w / h > 2 / 3) h = w * 1.5; else w = h / 1.5;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, st = (stops || []).slice().sort((a, b) => b.minutes - a.minutes).slice(0, C.maxStops);
    let pick = null;
    for (const g of [1, 1.1, 1.2, C.grow, 1.45, 1.6]) { // 超過 1.3 只有在起點終點還露不出來時才用
      if (g > C.grow && !pick.hard) break;
      const W = w * g * C.bleed / 2, H = h * g * C.bleed / 2, f = [cx - W, cy - H, cx + W, cy + H], route = [].concat(...lines(segs, f)); if (route.length < 2) return f;
      const sp = st.map(s => px(f, s.lng, s.lat)); let hard = 0, soft = 0;
      for (const size of ['tall', 'ig']) for (const q of WINS) {
        const win = size === 'ig' ? [q[0], q[1], q[2], q[3] - 270] : q, v = bestView(route, sp, win, boards(size, st.length), [24, 36, 1000, 1500], 896 / g);
        hard += v.hard; soft = Math.max(soft, v.soft);
      }
      if (!pick || hard < pick.hard || (hard === pick.hard && soft < pick.soft - 0.004)) pick = { f, hard, soft };
      if (!hard && soft < 0.01) break;
    }
    return pick.f;
  }
  function px(f, lng, lat) { return [(mx(lng) - f[0]) / (f[2] - f[0]) * 1024, (f[3] - my(lat)) / (f[3] - f[1]) * 1536]; }
  function lines(segs, f) { // 路線：抽稀、斷訊太久又跳遠就斷開
    const out = [];
    for (const s of segs) {
      let cur = null, prev = null;
      for (const p of s) {
        if (!prev || (p[0] - prev[0] > 600 && dp(p, prev) > 500)) { cur = []; out.push(cur); }
        const q = px(f, p[2], p[1]), l = cur[cur.length - 1];
        if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) >= 5) cur.push([Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]);
        prev = p;
      }
    }
    return out.filter(l => l.length > 1);
  }
  const inPoly = (g, lng, lat) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some(p => p.reduce((c, r) => { for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > lat) !== (r[j][1] > lat) && lng < (r[j][0] - r[i][0]) * (lat - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; }, false));
  const inAny = (list, lng, lat) => (list || []).some(g => inPoly(g, lng, lat));
  function areaM2(g, lat) { const k = 111320 * Math.cos(lat * RAD), one = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * k * (r[j][1] + r[i][1]) * 110574 / 2; return Math.abs(a); }; return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).reduce((s, p) => s + one(p[0]), 0); }

  // 停留點與地標的名字（pick_names）
  const PREF = ['railway', 'park', 'place_of_worship', 'hospital', 'college', 'university', 'museum', 'attraction', 'monument', 'memorial', 'library', 'theatre', 'stadium', 'townhall', 'school', 'cafe', 'restaurant', 'bar', 'fast_food', 'bakery', 'ice_cream', 'lodging', 'shop', 'garden'];
  const LANDMARK = ['railway', 'park', 'museum', 'attraction', 'monument', 'memorial', 'library', 'stadium'];
  const VENUE = ['cafe', 'restaurant', 'bar', 'fast_food', 'bakery', 'ice_cream', 'shop', 'library', 'museum'];
  const CAMPUS = { park: 600, college: 500, university: 500, school: 250, hospital: 300, stadium: 400 };
  const station = q => q.cls === 'railway' && !/站$/.test(q.name) ? q.name + '站' : q.name;
  const okPoi = q => !(q.cls === 'hospital' && q.sub === 'clinic') && !(q.cls === 'railway' && q.sub !== 'subway' && q.sub !== 'station');
  function nameStop(s, f) { // 找不到公共的地方、或看起來在住宅裡，就回 ''（卡上只寫停留幾分）
    let best = null, key = null; const home = inAny(f.home, s.lng, s.lat);
    for (const q of f.poi) {
      if (!okPoi(q) || !PREF.includes(q.cls)) continue;
      const d = dist(s.lat, s.lng, q.lat, q.lng), venue = VENUE.includes(q.cls);
      if (d > (home ? 45 : CAMPUS[q.cls] || 120)) continue;
      if (home && !venue && q.cls !== 'railway' && q.cls !== 'park') continue;
      if (q.cls === 'park' && !inAny(f.green, s.lng, s.lat)) continue;
      if ((q.cls === 'college' || q.cls === 'university') && !inAny(f.inst, s.lng, s.lat)) continue;
      const k = [venue && d <= 45 ? 0 : 1, PREF.indexOf(q.cls), d];
      if (!key || k[0] - key[0] || k[1] - key[1] || k[2] - key[2]) { const less = !key || (k[0] - key[0] || k[1] - key[1] || k[2] - key[2]) < 0; if (less) { key = k; best = q; } }
    }
    return best ? station(best) : '';
  }
  function pickMarks(f, segs, frame, used) { // 沿路地標：大家認得的、離路線 350 公尺內，彼此隔開
    const pts = [].concat(...segs).filter((_, i, a) => a.length < 800 || i % Math.ceil(a.length / 800) === 0), cands = [], out = [];
    for (const q of f.poi) {
      const rank = LANDMARK.indexOf(q.cls); if (rank < 0 || used.has(station(q)) || used.has(q.name) || !okPoi(q)) continue;
      if (q.name.length > 8 || /分部|本部|分校|推廣|辦公室|中心/.test(q.name)) continue;
      const [x, y] = px(frame, q.lng, q.lat); if (x < 80 || x > 944 || y < 120 || y > 1416) continue;
      if (inAny(f.inst, q.lng, q.lat)) continue;
      if (q.cls === 'park' && !f.green.some(g => inPoly(g, q.lng, q.lat) && areaM2(g, q.lat) >= 20000)) continue;
      let d = Infinity; for (const p of pts) d = Math.min(d, dist(p[1], p[2], q.lat, q.lng));
      if (d <= 350) cands.push({ rank, d, q, x, y });
    }
    cands.sort((a, b) => a.rank - b.rank || a.d - b.d);
    for (const c of cands) {
      if (out.length >= C.marks) break;
      const name = station(c.q);
      if (used.has(name) || out.some(o => Math.hypot(o.x - c.x, o.y - c.y) < 75)) continue;
      used.add(name); out.push({ name, lng: c.q.lng, lat: c.q.lat, x: c.x, y: c.y });
    }
    return out.map(({ name, lng, lat }) => ({ name, lng, lat }));
  }
  function pickPlaces(f, frame) { // 區名，最多三個，離得開
    const out = [], wide = frame[2] - frame[0] > 9000, list = f.place.filter(p => (wide ? ['suburb', 'town'] : ['suburb', 'quarter', 'neighbourhood', 'town', 'village']).includes(p.cls)) // 範圍大的只寫區與鎮，免得冒出一堆老地名
      .map(p => { const [x, y] = px(frame, p.lng, p.lat); return Object.assign({ x, y }, p); })
      .filter(p => p.x > 130 && p.x < 894 && p.y > 200 && p.y < 1330 && p.name.length <= 8);
    const rk = { town: 0, suburb: 0, quarter: 1, village: 1, neighbourhood: 2 };
    list.sort((a, b) => rk[a.cls] - rk[b.cls] || (a.name < b.name ? -1 : 1));
    const stem = x => x.replace(/[區鎮鄉市里]$/, ''); // 「大安」跟「大安區」只留一個
    for (const p of list) { if (out.length >= 3) break; if (out.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 250 || stem(o.name) === stem(p.name))) continue; out.push(p); }
    return out.map(({ name, lng, lat }) => ({ name, lng, lat }));
  }
  function center(d) { // 停留時間加權的中心；沒停留就用路線中心
    const w = d.stops.reduce((a, s) => a + s.minutes, 0);
    if (w) return { lat: d.stops.reduce((a, s) => a + s.lat * s.minutes, 0) / w, lng: d.stops.reduce((a, s) => a + s.lng * s.minutes, 0) / w };
    const p = [].concat(...d.segs); return { lat: p.reduce((a, q) => a + q[1], 0) / p.length, lng: p.reduce((a, q) => a + q[2], 0) / p.length };
  }
  function ownName(places, s) { // 自己命名過的地方優先；家不寫出來。回 undefined＝附近沒有命名過
    let best, bd = C.placeNear;
    for (const p of places || []) { const d = dist(s.lat, s.lng, p.lat, p.lng); if (d <= bd) { bd = d; best = p; } }
    if (!best) return undefined;
    return best.icon === 'home' || best.icon === 'house' || /^(我|老|爸媽|外婆|奶奶|阿嬤)?(的)?(家|住處|住家|宿舍)$/.test(best.name) ? '' : best.name;
  }
  return { C, SIZES, TITLE_H, STAT_H, rowsH, boards, bestView, dist, trim, stops, stats, day, extent, px, lines, nameStop, pickMarks, pickPlaces, center, ownName, inPoly };
})();
/*DAYCORE_END*/

const DC_SIZES = DAYCORE.SIZES;
const DC_SIZE_KEY = 'onion.daycard.size', DC_PICK_KEY = 'onion.card.pick';
const dc = { pick: 'day', key: null, rec: null, state: '', err: '', tok: 0, size: 'tall', base: null, busy: false, sending: false };
try { if (DC_SIZES[localStorage.getItem(DC_SIZE_KEY)]) dc.size = localStorage.getItem(DC_SIZE_KEY); } catch (e) {}

function dcDays() { const d = engine.state().days; return Object.keys(d).filter(k => d[k].n - d[k].fl >= DAYCORE.C.minPts).sort(); }
function dcDayText(key) { const [y, m, d] = key.split('-').map(Number), dt = new Date(y, m - 1, d); return (y !== new Date().getFullYear() ? y + ' 年 ' : '') + m + ' 月 ' + d + ' 日 週' + WEEKDAY[dt.getDay()]; }
const dcFile = key => 'cards/' + key + '.json';
async function dcSave(rec) { await kvSafeSet(dcFile(rec.key), JSON.stringify(rec)); }

// --- 準備：點 → 範圍、底稿、結構圖、名字 ---
async function dcPrepare(key, pts, D) {
  const frame = DAYCORE.extent(D.segs, D.stops), shown = D.stops.slice().sort((a, b) => b.minutes - a.minutes).slice(0, DAYCORE.C.maxStops).sort((a, b) => a.t0 - b.t0);
  const R = await draftRender(frame, { feats: true, probes: shown.map(s => [s.lng, s.lat]) });
  const used = new Set(), stops = shown.map((s, i) => { const name = DAYCORE.nameStop(s, R.probes[i] && R.probes[i].poi.length ? R.probes[i] : R.feats); if (name) used.add(name); return { lat: +s.lat.toFixed(6), lng: +s.lng.toFixed(6), t0: s.t0, minutes: s.minutes, name }; });
  if (typeof PLACES_LOGIC !== 'undefined' && PLACES_LOGIC.homes) { // 常待的家：就算旁邊有店也不寫名字
    try { const last = engine.state().points; if (last.length) for (const h of PLACES_LOGIC.homes(last, last[last.length - 1][0])) for (const s of stops) if (DAYCORE.dist(s.lat, s.lng, h.lat, h.lng) <= 120) s.name = ''; } catch (e) {}
  }
  const c = DAYCORE.center(D); let city = '', town = '';
  try { const a = await loadAdmin(), t = townAt(a, c.lng, c.lat); if (t) { city = a.counties[t.c].n; town = t.n; } } catch (e) {}
  if (!city) {
    const near = cls => { let b = null, bd = Infinity; for (const p of R.feats.place) if (cls.includes(p.cls)) { const d = DAYCORE.dist(c.lat, c.lng, p.lat, p.lng); if (d < bd) { bd = d; b = p.name; } } return b || ''; };
    city = near(['city', 'town']); town = near(['suburb', 'quarter']);
  }
  const facts = { city, town, layer: Object.keys(engine.state().days).sort().indexOf(key) + 1, stats: D.stats, stops, marks: DAYCORE.pickMarks(R.feats, D.segs, frame, used), places: DAYCORE.pickPlaces(R.feats, frame), lines: DAYCORE.lines(D.segs, frame) };
  return { n: engine.state().days[key].n, frame, facts, draft: R.draft.toDataURL('image/jpeg', 0.92), ref: R.ref.toDataURL('image/png') };
}

// --- 畫 ---
const dcTiles = {};
function dcPencil() { // 色鉛筆的筆觸：斜的細排線，疊在程式底稿上
  if (dcTiles.p) return dcTiles.p;
  const n = 220, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'); let k = 9; const r = () => (k = (k * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) { const x = r() * n, y = r() * n, l = 8 + r() * 22; g.strokeStyle = r() < 0.62 ? 'rgba(255,252,240,' + (0.1 + r() * 0.16) + ')' : 'rgba(96,70,40,' + (0.04 + r() * 0.09) + ')'; g.lineWidth = 0.6 + r() * 1.1; for (const dx of [0, -n, n]) for (const dy of [0, -n, n]) { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + l, y + dy - l * 0.8); g.stroke(); } }
  return dcTiles.p = c;
}
function dcGrain() { // 紙的顆粒，壓在最上面
  if (dcTiles.g) return dcTiles.g;
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'), d = g.createImageData(n, n); let k = 5;
  for (let i = 0; i < d.data.length; i += 4) { k = (k * 16807) % 2147483647; const v = 243 + k / 2147483647 * 12; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  g.putImageData(d, 0, 0); return dcTiles.g = c;
}
async function dcBase(rec) { // 底：程式底稿（加筆觸），上面貼對位好的 AI 圖
  if (dc.base && dc.base.rec === rec && dc.base.img === rec.img && dc.base.draft === rec.draft) return dc.base.c;
  const c = imgCanvas(await loadImg(rec.draft), DRAFT_W, DRAFT_H), g = c.getContext('2d');
  g.fillStyle = g.createPattern(dcPencil(), 'repeat'); g.fillRect(0, 0, DRAFT_W, DRAFT_H);
  if (rec.img) {
    const f = rec.fit, x = f.ox / 2, y = f.oy / 2, w = f.sx * DRAFT_W / 2, h = f.sy * DRAFT_H / 2, F = 16;
    const p = document.createElement('canvas'); p.width = DRAFT_W; p.height = DRAFT_H; const q = p.getContext('2d'); q.imageSmoothingQuality = 'high';
    q.drawImage(await loadImg(rec.img), x, y, w, h); q.globalCompositeOperation = 'destination-in';
    const edge = (x0, y0, x1, y1) => { const gr = q.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000'); q.fillStyle = gr; q.fillRect(0, 0, DRAFT_W, DRAFT_H); };
    if (x > 1) edge(x, 0, x + F, 0); if (y > 1) edge(0, y, 0, y + F); if (x + w < DRAFT_W - 1) edge(x + w, 0, x + w - F, 0); if (y + h < DRAFT_H - 1) edge(0, y + h, 0, y + h - F);
    g.drawImage(p, 0, 0);
  }
  dc.base = { rec, img: rec.img, draft: rec.draft, c };
  return c;
}
const dcFrames = {};
async function dcFrame(id, size) { // 4:5：把框的直邊中間抽掉一截（找上下最像的地方接），角花、羅盤、城牆都不會被壓扁或切掉
  const fr = await loadFrame(id); if (size === 'tall') return fr;
  if (dcFrames[id]) return dcFrames[id];
  const W = CARD_W, H = CARD_H, cut = H - DC_SIZES.ig.h, B = 44, src = fr.canvas.getContext('2d').getImageData(0, 0, W, H), s = src.data, [l, t, r, b] = fr.win;
  const xs = []; for (let x = 0; x < W; x += 3) if (x < l + 60 || x > r - 60) xs.push(x);
  let best = Infinity, at = 600;
  for (let y = t + 90; y + cut + B < b - 60; y += 2) {
    let d = 0;
    for (let k = 0; k < B; k += 4) for (const x of xs) { const p = ((y + k) * W + x) * 4, q = ((y + cut + k) * W + x) * 4; d += Math.abs(s[p + 3] - s[q + 3]) * 2 + Math.abs(s[p] - s[q]) + Math.abs(s[p + 1] - s[q + 1]); }
    if (d < best) { best = d; at = y; }
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H - cut; const g = c.getContext('2d'), out = g.createImageData(W, H - cut), o = out.data;
  o.set(s.subarray(0, at * W * 4)); o.set(s.subarray((at + cut + B) * W * 4), (at + B) * W * 4);
  for (let k = 0; k < B; k++) { // 接縫：上半與下半交疊淡入
    const u = (k + 0.5) / B, f = u * u * (3 - 2 * u);
    for (let x = 0; x < W; x++) { const p = ((at + k) * W + x) * 4, q = ((at + cut + k) * W + x) * 4, a0 = s[p + 3] * (1 - f), a1 = s[q + 3] * f, a = a0 + a1; for (let i = 0; i < 3; i++) o[p + i] = a ? (s[p + i] * a0 + s[q + i] * a1) / a : 0; o[p + 3] = a; }
  }
  g.putImageData(out, 0, 0);
  return dcFrames[id] = { canvas: c, win: [l, t, r, b - cut] };
}
function dcView(rec, win, boxes) { // 底稿的哪一塊放進框的窗（DAYCORE.bestView）。AI 的圖沒蓋滿時先只用有蓋到的；起點終點露不出來、路線被蓋太多再放寬（外圈露出程式底稿）
  const f = rec.fit, all = [0, 0, DRAFT_W, DRAFT_H], route = [].concat(...rec.facts.lines), sp = rec.facts.stops.map(s => DAYCORE.px(rec.frame, s.lng, s.lat));
  const C = rec.img ? [Math.max(0, f.ox / 2), Math.max(0, f.oy / 2), Math.min(DRAFT_W, (f.ox + f.sx * DRAFT_W) / 2), Math.min(DRAFT_H, (f.oy + f.sy * DRAFT_H) / 2)] : all;
  if (route.length < 2) return [64, 96, 896, 896 * (win[3] - win[1]) / (win[2] - win[0])];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of route) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const minW = Math.max((x1 - x0) * 1.3, (y1 - y0) * 1.3 / 1.5, DAYCORE.C.minM / frameMpp(rec.frame)), a = DAYCORE.bestView(route, sp, win, boxes, C, minW);
  if ((!a.hard && a.soft < 0.04) || C === all) return a.view;
  const b = DAYCORE.bestView(route, sp, win, boxes, all, minW); return b.hard < a.hard || (b.hard === a.hard && b.soft < a.soft - 0.04) ? b.view : a.view;
}
function dcSigAt(fr, boxes, w, h) { // 署名放窗內最下緣：框沒蓋住、不碰板子的地方，盡量靠下靠中間
  const W = CARD_W, [l, t, r, b] = fr.win, y0 = Math.max(t, b - 260), id = fr.sig || (fr.sig = fr.canvas.getContext('2d').getImageData(0, y0, W, b - y0).data); let best = null;
  for (let y = b - 8; y > b - 240; y -= 4) for (let x = l + 10; x + w < r - 10; x += 12) {
    const Y = y - h; if (boxes.some(q => x + w + 8 > q[0] && x - 8 < q[2] && y + 6 > q[1] && Y - 6 < q[3])) continue;
    let a = 0, n = 0; for (let yy = Y; yy <= y; yy += 4) for (let xx = x; xx <= x + w; xx += 6) { const i = ((yy - y0) * W + xx) * 4 + 3; if (i >= 0 && i < id.length) a += id[i] > 190 ? 1 : 0; n++; }
    const cost = a / n * 1500 + (b - y) + Math.abs(x + w / 2 - (l + r) / 2) * 0.12;
    if (!best || cost < best[0]) best = [cost, x, y];
  }
  return best ? [best[1], best[2]] : [(W - w) / 2, b - 14];
}
function dcDash(g, pts, on, off) { g.setLineDash([on, off]); dcPath(g, pts); g.setLineDash([]); }
function dcPath(g, pts) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
const dcSpr = {};
function dcSprite(name) { return dcSpr[name] || (dcSpr[name] = loadImg('assets/app/' + name + '.png').catch(() => null)); }
function dcBadge(g, x, y, r, text) { // 紅圈白數字
  g.fillStyle = '#FFFCF0'; g.beginPath(); g.arc(x, y, r + 2.4, 0, 7); g.fill();
  g.fillStyle = '#A83028'; g.strokeStyle = '#781410'; g.lineWidth = 1.4; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
  g.font = '700 ' + Math.round(r * 1.25) + 'px ' + CARD_KAI; g.fillStyle = '#FFFAF0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + r * 0.06); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}
function dcHalo(g, text, x, y, fill, w) { g.lineJoin = 'round'; g.lineWidth = w; g.strokeStyle = '#F8F1DF'; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y); }
function dcFit(g, text, max) { if (g.measureText(text).width <= max) return text; let t = text; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; }
function dcStops(facts) { // 停留點的字：自己命名過的地方優先（畫好之後才命名也會跟著變）
  const mine = engine.state().ext.places, list = Array.isArray(mine) ? mine : [];
  return facts.stops.map(s => { const own = DAYCORE.ownName(list, s), name = own !== undefined ? own : s.name; return Object.assign({}, s, { name, row: dcHm(s.t0) + '　' + (name ? name : '停留 ' + s.minutes + ' 分'), min: name ? s.minutes + ' 分' : '' }); });
}
const dcHm = t => { const d = new Date(t * 1000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

function dcMeasure(g, rec, size) { // 三塊板子的字與寬
  const F = rec.facts, pad = 32, fT = '900 48px ' + CARD_SERIF, fS = '400 22px ' + CARD_KAI, fR = '700 22px ' + CARD_KAI, U = DC_SIZES[size].ui, st = F.stats, hh = Math.floor(st.moving_min / 60), W = (f, x) => { g.font = f; return g.measureText(x).width; };
  const title = [F.city, F.town].filter(Boolean).join('・') || '洋蔥地圖', sub = rec.key.replace(/-/g, '.') + '　第 ' + F.layer + ' 天出門';
  const l1 = st.km + ' km　' + (st.car >= 0.5 ? '在路上 ' : '走了 ') + (hh ? hh + ' 小時 ' : '') + st.moving_min % 60 + ' 分', l2 = st.start + ' 到 ' + st.end + (st.stops ? '　停留 ' + st.stops + ' 處' : '');
  const tw = Math.ceil(Math.max(W(fT, title), W(fS, sub)) + pad * 2), sw = Math.ceil(Math.max(W(fR, l1), W(fS, l2)) + 56), stops = dcStops(F); let rows = [], lw = 0;
  if (stops.length) {
    g.font = fR; const maxW = U.r - sw - U.l - 24, mw = Math.max(...stops.map(s => s.min ? W(fR, '　' + s.min) : 0));
    rows = stops.map(s => dcFit(g, s.row, maxW - 100 - mw) + (s.min ? '　' + s.min : '')); lw = Math.ceil(Math.max(...rows.map(q => W(fR, q))) + 100);
  }
  return { title, sub, l1, l2, tw, sw, lw, rows, stops, pad, fT, fS, fR, boxes: DAYCORE.boards(size, rows.length, { title: tw, list: lw, stat: sw }) };
}
async function dcDraw(cv, rec, frameId, size) { // 一張成品，畫在 cv 上
  const S = DC_SIZES[size], U = S.ui, F = rec.facts, [base, fr, flag, cross] = await Promise.all([dcBase(rec), dcFrame(frameId, size), dcSprite('flag'), dcSprite('x-mark')]);
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  if (cv.width !== S.w || cv.height !== S.h) { cv.width = S.w; cv.height = S.h; }
  const g = cv.getContext('2d'), [l, t, r, b] = fr.win, M = dcMeasure(g, rec, size), V = dcView(rec, fr.win, M.boxes), k = (r - l) / V[2], T = p => [(p[0] - V[0]) * k + l, (p[1] - V[1]) * k + t], TL = q => T(DAYCORE.px(rec.frame, q.lng, q.lat));
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#F4EEE0'; g.fillRect(0, 0, S.w, S.h);
  g.imageSmoothingQuality = 'high'; g.drawImage(base, V[0], V[1], V[2], V[3], l, t, r - l, b - t);
  // 路線：白底、紅色虛線、每個點抖一點像手畫的
  g.save(); g.beginPath(); g.rect(l, t, r - l, b - t); g.clip(); g.lineCap = 'round'; g.lineJoin = 'round';
  let sd = 3; const jit = () => ((sd = (sd * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const lines = F.lines.map(q => q.map(p => { const [x, y] = T(p); return [x + jit(), y + jit()]; }));
  g.strokeStyle = 'rgba(255,252,240,.86)'; g.lineWidth = 13.5; lines.forEach(q => dcPath(g, q));
  g.strokeStyle = '#CC201C'; g.lineWidth = 6.8; lines.forEach(q => dcDash(g, q, 12, 15));
  g.restore();
  const spr = (im, x, y, w) => { if (im) g.drawImage(im, x - w / 2, y - w * im.height / im.width, w, w * im.height / im.width); };
  const A = lines[0] && lines[0][0], Z = lines.length && lines[lines.length - 1][lines[lines.length - 1].length - 1];
  if (A) for (let i = 0; i < 2; i++) spr(flag, A[0] + 8, A[1] + 3, 42); if (Z) for (let i = 0; i < 2; i++) spr(cross, Z[0], Z[1] + 14, 40); // 貼紙本身半透明，疊兩次才看得清楚
  g.drawImage(fr.canvas, 0, 0);
  // 板子：標題左上、行程表左下、統計右下，比例尺在統計上面
  const boxes = [], { title, sub, l1, l2, pad, fT, fS, fR, rows, stops } = M;
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  cartouche(g, U.l, U.t, M.tw, DAYCORE.TITLE_H, 11); boxes.push([U.l, U.t, U.l + M.tw, U.t + DAYCORE.TITLE_H]);
  g.font = fT; g.fillStyle = '#2B241C'; g.fillText(title, U.l + pad, U.t + 74); g.font = fS; g.fillStyle = '#5A4E3F'; g.fillText(sub, U.l + pad + 2, U.t + 114);
  const sx = U.r - M.sw, sy = U.b - DAYCORE.STAT_H;
  cartouche(g, sx, sy, M.sw, DAYCORE.STAT_H, 23); boxes.push([sx, sy, U.r, U.b]);
  g.font = fR; g.fillStyle = '#2B241C'; g.fillText(l1, sx + 28, sy + 47); g.font = fS; g.fillStyle = '#5A4E3F'; g.fillText(l2, sx + 28, sy + 82);
  if (rows.length) {
    const lh = 36, bh3 = DAYCORE.rowsH(rows.length), by = U.b - bh3;
    cartouche(g, U.l, by, M.lw, bh3, 37); boxes.push([U.l, by, U.l + M.lw, U.b]);
    rows.forEach((q, i) => { const cy = by + 23 + lh * i + lh / 2; dcBadge(g, U.l + 44, cy, 12.5, String(i + 1)); g.font = fR; g.fillStyle = '#2B241C'; g.textBaseline = 'middle'; g.fillText(q, U.l + 74, cy + 1); g.textBaseline = 'alphabetic'; });
  }
  const mpp = frameMpp(rec.frame) / k, L = [50000, 20000, 10000, 5000, 2000, 1000, 500, 250, 100, 50].find(v => v / mpp <= 240) || 50, bl = L / mpp, bx = U.r - bl, byy = sy - 30;
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#F6EEDB' : '#2B241C'; g.fillRect(bx + bl * i / 4, byy, bl / 4, 11); }
  g.lineWidth = 1.6; g.strokeStyle = '#2B241C'; g.strokeRect(bx, byy, bl, 11);
  g.font = '700 21px ' + CARD_KAI; const lab = L >= 1000 ? L / 1000 + ' km' : L + ' m'; dcHalo(g, '0', bx - 5, byy - 9, '#2B241C', 6); dcHalo(g, lab, U.r - g.measureText(lab).width, byy - 9, '#2B241C', 6);
  const boards = boxes.slice(), fG = '700 16px ' + CARD_SERIF; let sig = 'ONION MAP 洋蔥地圖　© OpenStreetMap'; boxes.push([bx - 12, byy - 34, U.r + 10, byy + 16]);
  if (A) boxes.push([A[0] - 14, A[1] - 38, A[0] + 30, A[1] + 4]); if (Z) boxes.push([Z[0] - 20, Z[1] - 26, Z[0] + 20, Z[1] + 14]);
  g.font = fG; let gw, gx, gy; // 下緣放不下整句（城堡的 4:5）就用短的
  for (const t of [sig, '洋蔥地圖 © OpenStreetMap']) { sig = t; gw = Math.ceil(g.measureText(t).width); [gx, gy] = dcSigAt(fr, boxes, gw, 18); if (gy > U.b) break; }
  dcHalo(g, sig, gx, gy - 3, '#4A3218', 5); boxes.push([gx - 6, gy - 20, gx + gw + 6, gy + 4]);
  // 停留點與地標。落在板子底下的就不點（行程表裡有）
  const hit = (q, m) => boxes.some(o => !(q[2] + m < o[0] || q[0] - m > o[2] || q[3] + m < o[1] || q[1] - m > o[3]));
  const inWin = (x, y, m) => x > l + m && x < r - m && y > t + m && y < b - m;
  const under = (x, y, m) => boards.some(o => x > o[0] - m && x < o[2] + m && y > o[1] - m && y < o[3] + m);
  const sp = stops.map(s => TL(s)), mk = F.marks.map(m => ({ name: m.name, p: TL(m) })).filter(m => inWin(m.p[0], m.p[1], 24) && !under(m.p[0], m.p[1], 10) && !sp.some(q => Math.hypot(q[0] - m.p[0], q[1] - m.p[1]) < 34));
  for (const m of mk) { g.fillStyle = '#FFFCF0'; g.beginPath(); g.arc(m.p[0], m.p[1], 7.6, 0, 7); g.fill(); g.fillStyle = '#5C5244'; g.beginPath(); g.arc(m.p[0], m.p[1], 5.8, 0, 7); g.fill(); boxes.push([m.p[0] - 9, m.p[1] - 9, m.p[0] + 9, m.p[1] + 9]); }
  sp.forEach((q, i) => { if (!inWin(q[0], q[1], 10) || under(q[0], q[1], -8)) return; dcBadge(g, q[0], q[1], 18, String(i + 1)); boxes.push([q[0] - 21, q[1] - 21, q[0] + 21, q[1] + 21]); });
  const put = (text, size, gap, cands, fill, halo) => { // 候選位置一個個試，放得下就寫
    const ws = [...text].map(ch => g.measureText(ch).width), tw = gap ? ws.reduce((a, v) => a + v, 0) + gap * (ws.length - 1) : g.measureText(text).width;
    for (const [cx, cy] of cands(tw)) { // cx、cy 是文字框的中心
      const q = [cx - tw / 2, cy - size / 2, cx + tw / 2, cy + size / 2];
      if (q[0] < l + 22 || q[2] > r - 22 || q[1] < t + 22 || q[3] > b - 22 || hit(q, 4)) continue;
      let x = q[0]; const y = cy + size * 0.36;
      if (gap) [...text].forEach((ch, i) => { dcHalo(g, ch, x, y, fill, halo); x += ws[i] + gap; }); else dcHalo(g, text, x, y, fill, halo);
      boxes.push(q); return;
    }
  };
  g.font = '900 37px ' + CARD_SERIF;
  for (const q of F.places) { const [x, y] = TL(q); put(q.name, 37, 20, () => [0, -74, 74, -148, 148].map(d => [x, y + d]), '#50463A', 8); }
  g.font = '700 22px ' + CARD_KAI;
  for (const m of mk) { const [x, y] = m.p; put(m.name, 22, 0, tw => [[x, y + 26], [x, y - 26], [x + 16 + tw / 2, y], [x - 16 - tw / 2, y], [x + tw / 2 - 8, y + 26], [x - tw / 2 + 8, y + 26]], '#463E34', 6); }
  // 紙的顆粒
  g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = g.createPattern(dcGrain(), 'repeat'); g.fillRect(0, 0, S.w, S.h); g.restore();
}

// --- 畫面 ---
function dcShell() { // 只建一次
  const el = $('mountDayCard'); if (el.childElementCount) return;
  el.innerHTML = '<div class="section"><div class="dcNav"><button class="ibtn press" id="dcPrev" aria-label="前一天"><svg class="chev flip"><use href="#i-chev"/></svg></button>' +
    '<button class="dcDay press" id="dcDay" aria-label="選一天"></button>' +
    '<button class="ibtn press" id="dcNext" aria-label="後一天"><svg class="chev"><use href="#i-chev"/></svg></button></div>' +
    '<div class="cardPrev" id="dcPrevBox"><canvas id="dcCanvas" width="1080" height="1620" role="img" aria-label="這一天的地圖卡"></canvas><div id="dcWait" class="dcWait" role="status"></div></div>' +
    '<div class="empty dcClose" id="dcClose" hidden><div class="badge"><svg class="ic"><use href="#i-route"/></svg></div><h3>這天走得太近</h3><p>畫出來會露出住家，所以這天不畫。</p></div></div>' +
    '<div class="actions" id="dcAct"></div>' +
    '<div class="section" id="dcFrameSec"><h2>邊框</h2><div class="dcStrip" id="dcStrip" role="group" aria-label="選框"></div></div>';
  $('dcPrev').onclick = () => dcStep(-1); $('dcNext').onclick = () => dcStep(1); $('dcDay').onclick = dcChoose;
  for (const f of FRAMES) {
    const b = document.createElement('button'); b.className = 'fr press'; b.dataset.id = f.id; b.setAttribute('aria-label', '換成' + f.name + '框');
    b.innerHTML = '<img src="assets/frames/' + f.id + '.png" alt=""><span>' + f.name + '</span>';
    b.onclick = () => { card.frame = f.id; try { localStorage.setItem(FRAME_KEY, f.id); } catch (e) {} dcMark(); markStrip(); dcPaintCanvas(); };
    $('dcStrip').appendChild(b);
  }
}
function dcMark() { for (const b of $('dcStrip').children) b.classList.toggle('on', b.dataset.id === card.frame); }
function dcStep(d) { const days = dcDays(), i = days.indexOf(dc.key) + d; if (i >= 0 && i < days.length) dcShow(days[i]); }
function dcChoose() {
  const el = openSheet('<h2>選一天</h2><div class="group">' + dcDays().reverse().map(k => { const d = engine.state().days[k]; return '<button class="row" data-k="' + k + '"><span class="lbl">' + dcDayText(k) + '</span><span class="val">' + (k === dc.key ? '現在這天' : kmText(d.walk + d.veh)) + '</span></button>'; }).join('') + '</div><button class="btn secondary full press" data-close>關閉</button>');
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { closeSheet(); dcShow(b.dataset.k); });
}
function dcPickUI() {
  const el = $('cardPick');
  if (!el.childElementCount) {
    el.innerHTML = '<div class="seg dcSeg" role="tablist" aria-label="要看哪一種卡"><button role="tab" data-p="day">一天</button><button role="tab" data-p="all">走過的地方</button></div>';
    el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { dc.pick = b.dataset.p; dcApply(); });
  }
  el.querySelectorAll('[data-p]').forEach(b => { b.classList.toggle('on', b.dataset.p === dc.pick); b.setAttribute('aria-selected', b.dataset.p === dc.pick); });
}
function dcApply() { // enterCard 先決定 cardMain／cardEmpty，這裡照現在選的那一邊再蓋一次
  dcPickUI();
  const none = !Object.keys(engine.state().cells).length, days = dcDays(), dayNone = dc.pick === 'day' && !days.length;
  $('cardPick').hidden = none && !days.length;
  $('cardEmpty').hidden = dc.pick === 'day' ? !dayNone : !none;
  $('cardMain').hidden = dc.pick === 'day' || none;
  $('mountDayCard').hidden = dc.pick !== 'day' || dayNone;
  if (dc.pick !== 'day' || dayNone) return;
  dcShell(); dcMark();
  FRAMES.forEach(f => loadFrame(f.id).catch(() => {}));
  dcShow(days.includes(dc.key) ? dc.key : days[days.length - 1]);
}
async function dcShow(key, fresh) {
  const my = ++dc.tok, same = dc.key === key && dc.rec; dc.key = key; dc.err = '';
  if (!same || fresh) { dc.rec = null; dc.state = 'loading'; }
  dcRender();
  try {
    const pts = await loadDay(key), D = DAYCORE.day(pts); if (my !== dc.tok) return;
    if (D.few || D.close) { dc.rec = null; dc.state = 'close'; dcRender(); return; }
    let rec = await kvJSON(dcFile(key)); if (my !== dc.tok) return;
    const n = engine.state().days[key].n;
    if (rec && rec.next && !painterJob('day', key)) { delete rec.next; await dcSave(rec); } // 送到一半就關掉的
    if (!rec || !rec.draft || (!rec.img && !rec.next && (rec.n !== n || rec.v !== 2))) { // 還沒準備過，或還沒畫、那天又多走了一段
      const p = await dcPrepare(key, pts, D); if (my !== dc.tok) return;
      rec = { v: 2, key, n: p.n, frame: p.frame, facts: p.facts, draft: p.draft, ref: p.ref };
      await dcSave(rec); if (my !== dc.tok) return;
    }
    dc.rec = rec; dc.state = 'ready';
  } catch (e) { if (my !== dc.tok) return; console.warn('[daycard]', e); dc.state = 'error'; dc.err = e.message || String(e); }
  dcRender();
}
let dcDrawTok = 0;
async function dcPaintCanvas() {
  const rec = dc.rec, my = ++dcDrawTok; if (!rec) return;
  const off = document.createElement('canvas');
  try { await dcDraw(off, rec, card.frame, dc.size); } catch (e) { console.warn('[daycard]', e); toast('卡片畫不出來：' + (e.message || e)); return; }
  if (my !== dcDrawTok || rec !== dc.rec) return;
  const cv = $('dcCanvas'); cv.width = off.width; cv.height = off.height; cv.getContext('2d').drawImage(off, 0, 0);
  $('dcPrevBox').classList.add('has'); dc.out = off;
}
function dcRender() {
  if (!$('dcDay')) return;
  const days = dcDays(), i = days.indexOf(dc.key), rec = dc.rec, job = painterJob('day', dc.key), act = $('dcAct');
  $('dcDay').textContent = dcDayText(dc.key); $('dcPrev').disabled = i <= 0; $('dcNext').disabled = i < 0 || i >= days.length - 1;
  const close = dc.state === 'close';
  $('dcClose').hidden = !close; $('dcPrevBox').hidden = close; $('dcFrameSec').hidden = close; act.hidden = close;
  $('dcWait').textContent = dc.state === 'loading' ? '正在準備地圖…' : dc.state === 'error' ? dc.err : '';
  if (dc.state !== 'ready') $('dcPrevBox').classList.remove('has');
  let h = '';
  if (dc.state === 'error') h = '<button class="btn secondary full press" data-a="retry">再試一次</button>';
  else if (dc.state === 'ready' && job) {
    const live = painterMem.live[job.id], wait = painterMem.reach === false ? '現在連不到' + (painterData().url ? '電腦' : '網路') + '，連上了會自己接著等' : live && live.status === 'queued' && live.ahead > 0 ? '前面還有 ' + live.ahead + ' 張，排到就畫，可以先離開' : 'ChatGPT 正在畫，大概要幾分鐘，可以先離開';
    h = '<p class="dcState" role="status"><i class="dcSpin" aria-hidden="true"></i><span>' + wait + '</span></p><button class="btn plain full press" data-a="cancel">不畫了</button>';
  } else if (dc.state === 'ready' && rec.img) {
    h = '<div class="dcShare"><div class="seg dcSeg" role="radiogroup" aria-label="圖的比例">' + Object.entries(DC_SIZES).map(([k, s]) => '<button role="radio" data-s="' + k + '" aria-checked="' + (k === dc.size) + '"' + (k === dc.size ? ' class="on"' : '') + '>' + s.name + '</button>').join('') + '</div>' +
      '<button class="btn primary press" data-a="share">分享</button></div><button class="btn secondary full press" data-a="paint"' + (dc.sending ? ' disabled' : '') + '>' + (dc.sending ? '正在送出…' : '再畫一次') + '</button>';
  } else if (dc.state === 'ready') h = '<button class="btn primary full press" data-a="paint"' + (dc.sending ? ' disabled' : '') + '>' + (dc.sending ? '正在送出…' : '請 ChatGPT 畫這一天') + '</button>';
  if (act.dataset.h !== h) { act.innerHTML = h; act.dataset.h = h; }
  act.hidden = close || !h;
  if (dc.state === 'ready') dcPaintCanvas();
}
$('mountDayCard').addEventListener('click', e => {
  const s = e.target.closest('[data-s]'), a = e.target.closest('[data-a]');
  if (s) { dc.size = s.dataset.s; try { localStorage.setItem(DC_SIZE_KEY, dc.size); } catch (x) {} dcRender(); }
  else if (a) ({ paint: dcAsk, retry: () => dcShow(dc.key, true), cancel: () => painterCancel('day', dc.key), share: dcShare })[a.dataset.a]();
});
function dcAsk() { // 畫一張會用掉 ChatGPT 的額度，按下去先問一句。還沒配對就先配對，配好接著問
  const key = dc.key, t = painterTarget(); if (dc.sending || !dc.rec) return;
  if (!t) { painterSetup(() => { if (dc.key === key) dcAsk(); }); return; }
  const again = !!dc.rec.img, el = openSheet('<h2>' + (again ? '再畫一張？' : '請 ChatGPT 畫這一天？') + '</h2><p>' + (t.kind === 'pc' ? '畫一張大概用掉 ChatGPT Go 每個月額度的 3%。' : '會用掉一次畫圖額度。') + (again ? '新的畫好之後，會換掉現在這張。' : '') + '</p>' +
    '<div class="actions"><button class="btn primary full press" id="dcAskGo">' + (again ? '再畫一張' : '開始畫') + '</button><button class="btn plain full press" data-close>先不要</button></div>');
  el.querySelector('#dcAskGo').onclick = () => { closeSheet(); dcSend(); };
}
async function dcSend() { // 送去畫。重畫的時候舊的那張留著，新的畫好才換
  const key = dc.key; if (dc.sending || !key || !dc.rec) return;
  if (!painterTarget()) return;
  dc.sending = true; dcRender();
  try {
    let rec = dc.rec, p = rec.ref && !rec.img && rec.n === engine.state().days[key].n ? rec : null;
    if (!p) { const pts = await loadDay(key), D = DAYCORE.day(pts); if (D.few || D.close) throw new Error('這天走得太近，畫出來會露出住家'); p = await dcPrepare(key, pts, D); }
    const next = { n: p.n, frame: p.frame, facts: p.facts, draft: p.draft, ref: p.ref };
    rec = Object.assign({}, rec, { next }); await dcSave(rec);
    await painterSubmit('day', next.draft, key);
    if (dc.key === key) dc.rec = rec;
  } catch (e) { toast(e.message || String(e), 5000); }
  dc.sending = false; dcRender();
}
painterOn.day = async (job, img) => {
  const rec = await kvJSON(dcFile(job.key)); if (!rec || !rec.next) return false;
  const r = await paintedIn(img, rec.next.ref), n = rec.next;
  await dcSave({ v: 2, key: job.key, n: n.n, frame: n.frame, facts: n.facts, draft: n.draft, img: r.img, fit: r.fit, at: Date.now() });
};
document.addEventListener('onion:painted', async e => {
  const d = e.detail; if (d.kind !== 'day') return;
  if (d.ok) toast(dcDayText(d.key) + '畫好了', 3600); else if (d.error) toast(d.error, 5000);
  if (!d.ok) { const rec = await kvJSON(dcFile(d.key)); if (rec && rec.next) { delete rec.next; await dcSave(rec); } }
  if (tab === 'card' && dc.pick === 'day' && dc.key === d.key) dcShow(d.key, true); else if (dc.key === d.key) dc.rec = null;
});
document.addEventListener('onion:painter', () => { if (tab === 'card' && dc.pick === 'day' && dc.state === 'ready' && !dc.sending) dcRender(); });
document.addEventListener('onion:places', () => { if (tab === 'card' && dc.pick === 'day' && dc.state === 'ready') dcPaintCanvas(); });
for (const ev of ['onion:wiped', 'onion:restored']) document.addEventListener(ev, () => { dc.tok++; dc.key = null; dc.rec = null; dc.base = null; dc.out = null; dc.state = ''; if (tab === 'card') dcApply(); });

async function dcShare() { // 跟「分享這張」同一招：iOS 先寫進暫存再開分享面板
  const out = document.createElement('canvas'), name = 'onion-' + dc.key + (dc.size === 'ig' ? '-4x5' : '') + '.png', title = '我的一日洋蔥地圖';
  try { await dcDraw(out, dc.rec, card.frame, dc.size); } catch (e) { toast('卡片畫不出來：' + (e.message || e)); return; }
  if (NATIVE) {
    try { await FS.writeFile({ path: name, data: out.toDataURL('image/png').split(',')[1], directory: 'CACHE' }); const { uri } = await FS.getUri({ path: name, directory: 'CACHE' }); await SHARE.share({ title, url: uri }); }
    catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('分享失敗：' + (e.message || e)); }
    return;
  }
  const blob = await new Promise(r => out.toBlob(r, 'image/png')), file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title }); } catch (e) {} return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
hook.tab.push(t => { if (t === 'card') dcApply(); else { dc.base = null; dc.out = null; } });
