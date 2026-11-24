// ===== 印章：走到了就自動蓋一個，不用接任務 =====
// 資料 ext('stamps', {印章代號: 毫秒})、ext('stampsAt', {印章代號: [lat, lng]})

/*STAMPS_LOGIC_START*/
// 純邏輯，不碰畫面與地圖（tests/stamps.test.mjs 直接讀這一段）。點的格式 [秒, lat, lng, 精度, 'w'|'v'|'f']
const STAMPS_LOGIC = (() => {
  const C = {
    near: 40, stationNear: 70,        // 走到多近算到了（車站的點畫在站體中間，放寬一點）
    bridgeNear: 20, bridgeWater: 60,  // 站在橋上：離橋這麼近，而且橋下（這麼近）有水，從高架橋下走過不算
    peakNear: 60, acc: 40,            // 山頂放寬；定位精度比這差的點不看
    hsrKmh: 200, hsrKm: 5,            // 連續這麼快、這麼遠算搭高鐵
    nightM: 500, dawnM: 500,          // 夜裡、清晨要走這麼遠
    loopM: 1500, loopBack: 60, loopFar: 250, loopRound: 0.12, // 一圈：走這麼長、回到起點這麼近、最遠離開這麼遠、繞得夠圓（原路折返不算）
    dayKm: 0.05                       // 一天走這麼遠才算走過
  };
  // kind: geo＝走到某種地方；sum＝累積（val 拿目前的量）；shape＝走的樣子；big／small＝章面的字
  const LIST = [
    { id: 'river', kind: 'geo', name: '第一次走到河邊', icon: 'river', small: '河邊' },
    { id: 'sea', kind: 'geo', name: '第一次走到海邊', icon: 'sea', small: '海邊' },
    { id: 'park', kind: 'geo', name: '第一次走到公園', icon: 'park', small: '公園' },
    { id: 'peak', kind: 'geo', name: '第一次走到山頂', icon: 'peak', small: '山頂' },
    { id: 'temple', kind: 'geo', name: '第一次走到廟', icon: 'temple', small: '廟' },
    { id: 'station', kind: 'geo', name: '第一次走到車站', icon: 'station', small: '車站' },
    { id: 'bridge', kind: 'geo', name: '第一次走過橋', icon: 'bridge', small: '過橋' },
    { id: 'plane', kind: 'ride', name: '第一次搭飛機', icon: 'plane', small: '飛機' },
    { id: 'hsr', kind: 'ride', name: '第一次搭高鐵', icon: 'hsr', small: '高鐵' },
    { id: 'night', kind: 'shape', name: '晚上十點後還在走', icon: 'night', small: '夜裡' },
    { id: 'dawn', kind: 'shape', name: '清晨就出門走', icon: 'dawn', small: '清晨' },
    { id: 'loop', kind: 'shape', name: '繞一圈走回原點', icon: 'loop', small: '一圈' },
    ...[3, 10, 30].map(n => ({ id: 'day' + n, kind: 'sum', of: 'days', goal: n, name: '走過 ' + n + ' 天', big: String(n), small: '天' })),
    ...[10, 50, 100].map(n => ({ id: 'km' + n, kind: 'sum', of: 'km', goal: n, name: '走滿 ' + n + ' 公里', big: String(n), small: '公里' })),
    ...[1, 5, 20].map(n => ({ id: 'area' + n, kind: 'sum', of: 'area', goal: n, name: '探索 ' + n + ' 平方公里', big: String(n), small: '平方公里' })),
    ...[3, 10].map(n => ({ id: 'town' + n, kind: 'sum', of: 'towns', goal: n, name: '走過 ' + n + ' 個區', big: String(n), small: '區' }))
  ];
  const BY = Object.fromEntries(LIST.map(s => [s.id, s]));
  const RAD = Math.PI / 180, KX = lat => 111320 * Math.cos(lat * RAD), KY = 110540;
  const dist = (a, b) => Math.hypot((b[2] - a[2]) * KX((a[1] + b[1]) / 2), (b[1] - a[1]) * KY); // 兩個軌跡點，公尺（幾十公里內夠準）

  // --- 地物 ---
  function segD(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
  function lineD(c, lng, lat, kx) { let m = Infinity; if (c.length === 1) return Math.hypot((c[0][0] - lng) * kx, (c[0][1] - lat) * KY); for (let i = 1; i < c.length; i++) m = Math.min(m, segD(0, 0, (c[i - 1][0] - lng) * kx, (c[i - 1][1] - lat) * KY, (c[i][0] - lng) * kx, (c[i][1] - lat) * KY)); return m; }
  function inside(r, x, y) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; }
  function polyD(poly, lng, lat, kx) { return inside(poly[0], lng, lat) && !poly.slice(1).some(h => inside(h, lng, lat)) ? 0 : Math.min(...poly.map(r => lineD(r, lng, lat, kx))); }
  function bbox(f) { // 每個地物算一次，記在物件上
    if (f._b) return f._b; const b = [180, 90, -180, -90];
    (function walk(c) { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); })(f.geometry.coordinates);
    return f._b = b;
  }
  function featD(f, lng, lat, within) { // 點到地物的公尺數，太遠直接回 Infinity
    const b = bbox(f), kx = KX(lat), px = within / kx, py = within / KY;
    if (lng < b[0] - px || lng > b[2] + px || lat < b[1] - py || lat > b[3] + py) return Infinity;
    const g = f.geometry, c = g.coordinates;
    if (g.type === 'Point') return Math.hypot((c[0] - lng) * kx, (c[1] - lat) * KY);
    if (g.type === 'MultiPoint') return lineD(c.slice(0, 1), lng, lat, kx);
    if (g.type === 'LineString') return lineD(c, lng, lat, kx);
    if (g.type === 'MultiLineString') return Math.min(...c.map(l => lineD(l, lng, lat, kx)));
    if (g.type === 'Polygon') return polyD(c, lng, lat, kx);
    if (g.type === 'MultiPolygon') return Math.min(...c.map(p => polyD(p, lng, lat, kx)));
    return Infinity;
  }
  const dry = p => p.brunnel === 'tunnel';
  const NOT_TEMPLE = /^(christian|muslim|jewish|catholic|protestant)$/;
  const RULES = { // 圖磚的哪一層、哪些算
    river: f => ({ water: f.class === 'river' && !dry(f), waterway: f.class === 'river' && !dry(f) }),
    sea: f => ({ water: f.class === 'ocean' }),
    park: f => ({ landcover: f.subclass === 'park', park: f.class === 'national_park', poi: f.class === 'park' && f.subclass === 'park' }),
    peak: f => ({ mountain_peak: !f.class || f.class === 'peak' || f.class === 'volcano' }),
    temple: f => ({ poi: f.class === 'place_of_worship' && !NOT_TEMPLE.test(f.subclass || '') && !/教會|教堂|禮拜堂|清真寺|聖殿/.test(f.name || '') }),
    station: f => ({ poi: f.class === 'railway' && /^(station|halt|subway|light_rail|tram_stop)$/.test(f.subclass || '') }),
    bridge: f => ({ transportation: f.brunnel === 'bridge' && !/^(motorway|trunk|rail|transit|ferry|bridge)$/.test(f.class || '') && f.ramp !== 1 }),
    wet: f => ({ water: f.class !== 'swimming_pool' && !dry(f), waterway: !dry(f) })
  };
  const NEAR = { station: C.stationNear, bridge: C.bridgeNear, peak: C.peakNear, wet: C.bridgeWater };
  // 圖磚的地物照規則分好。layers：{圖層名: [{geometry, properties}]}
  function sortFeatures(layers) {
    const out = {}; for (const id in RULES) out[id] = [];
    for (const layer in layers) for (const f of layers[layer]) for (const id in RULES) if (RULES[id](f.properties || {})[layer]) out[id].push({ geometry: f.geometry });
    return out;
  }
  function along(f, lng, lat, kx, dir) { // 走的方向跟這座橋同方向嗎（從橋下的河濱步道穿過去是垂直的，不算）
    const ls = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    let m = C.bridgeNear, ok = false;
    for (const l of ls) for (let i = 1; i < l.length; i++) {
      const ax = (l[i - 1][0] - lng) * kx, ay = (l[i - 1][1] - lat) * KY, bx = (l[i][0] - lng) * kx, by = (l[i][1] - lat) * KY, d = segD(0, 0, ax, ay, bx, by);
      if (d <= m) { m = d; const n = Math.hypot(bx - ax, by - ay) * Math.hypot(dir[0], dir[1]); ok = n > 0 && Math.abs((bx - ax) * dir[0] + (by - ay) * dir[1]) / n >= 0.75; }
    }
    return ok;
  }
  function heading(pts, i) { // 第 i 點附近往哪走 [東, 北]，公尺；不知道回 null
    const a = pts[i - 1] || pts[i], b = pts[i + 1] || pts[i];
    if (b[0] - a[0] > 240 || a[4] === 'f' || b[4] === 'f') return null;
    const v = [(b[2] - a[2]) * KX(pts[i][1]), (b[1] - a[1]) * KY]; return Math.hypot(v[0], v[1]) >= 8 ? v : null;
  }
  function hitsAt(sorted, lat, lng, want, dir) { // 站在這裡會拿到哪些。dir：走的方向 [東, 北]，沒有就不判斷過橋
    const near = id => (sorted[id] || []).some(f => featD(f, lng, lat, NEAR[id] || C.near) <= (NEAR[id] || C.near));
    return want.filter(id => RULES[id] && id !== 'wet' && near(id) && (id !== 'bridge' || (dir && near('wet') && sorted.bridge.some(f => along(f, lng, lat, KX(lat), dir)))));
  }

  // --- 累積 ---
  const walked = d => d.walk >= C.dayKm;
  function totals(st, towns) { return { days: Object.values(st.days).filter(walked).length, km: st.km.walk, area: st.area, towns: towns || 0 }; }
  function sums(st, towns, have) { // 這次該拿的累積類：[{id, t}]。天數、公里數從每天的摘要找出是哪天到的
    const v = totals(st, towns), out = [], keys = Object.keys(st.days).sort();
    for (const s of LIST) {
      if (s.kind !== 'sum' || have[s.id] || !(v[s.of] >= s.goal)) continue;
      let t = 0, n = 0;
      if (s.of === 'days' || s.of === 'km') for (const k of keys) { const d = st.days[k]; n += s.of === 'days' ? +walked(d) : d.walk; if (n >= s.goal) { t = d.t1; break; } }
      out.push({ id: s.id, t });
    }
    return out;
  }
  function next(st, towns, have) { // 最接近的一個：{id, name, left}，全部拿完回 null
    const v = totals(st, towns); let best = null, r = -1;
    for (const s of LIST) {
      if (s.kind !== 'sum' || have[s.id] || (s.of === 'towns' && towns == null)) continue;
      const q = Math.min(0.999, v[s.of] / s.goal); if (q > r) { r = q; best = s; }
    }
    if (!best) { const g = LIST.find(s => !have[s.id] && s.kind !== 'sum'); return g ? { id: g.id, name: g.name, left: '' } : null; }
    const left = best.goal - v[best.of], num = x => (x >= 10 ? Math.ceil(x) : Math.max(0.1, Math.ceil(x * 10 - 1e-6) / 10));
    return { id: best.id, name: best.name, left: best.of === 'days' ? '再走 ' + Math.ceil(left) + ' 天' : best.of === 'towns' ? '再去 ' + Math.ceil(left) + ' 個區' : best.of === 'km' ? '再走 ' + num(left) + ' 公里' : '再探索 ' + num(left) + ' 平方公里' };
  }

  // --- 走的樣子。都回 {t:毫秒, lat, lng} 或 null，取最早的一次 ---
  function walkIn(pts, hourOk, need) { // 在某段時間裡真的走了 need 公尺（待在屋裡的定位飄移不算：要離開出發處一半以上）
    let a = null, prev = null, m = 0, far = 0;
    for (const p of pts) {
      const ok = p[4] === 'w' && p[3] <= C.acc && hourOk(new Date(p[0] * 1000).getHours());
      if (!ok || (prev && p[0] - prev[0] > 900)) { a = prev = null; m = far = 0; if (!ok) continue; }
      if (!a) { a = prev = p; continue; }
      const d = dist(prev, p); if (d < 30) continue; // 太近的先不算，等走遠一點
      if (p[0] - prev[0] > 0 && d / (p[0] - prev[0]) > 7) { a = prev = p; m = far = 0; continue; }
      m += d; far = Math.max(far, dist(a, p)); prev = p;
      if (m >= need && far >= need / 2) return { t: p[0] * 1000, lat: p[1], lng: p[2] };
    }
    return null;
  }
  const night = pts => walkIn(pts, h => h >= 22 || h < 4, C.nightM);
  const dawn = pts => walkIn(pts, h => h >= 4 && h < 7, C.dawnM);
  function loop(pts) {
    let seg = [], cum = [0];
    for (const p of pts) {
      if (p[4] !== 'w' || p[3] > C.acc) { if (p[4] !== 'w') { seg = []; cum = [0]; } continue; }
      const last = seg[seg.length - 1];
      if (last && p[0] - last[0] > 1200) { seg = []; cum = [0]; }
      if (seg.length && dist(seg[seg.length - 1], p) < 35) continue;
      if (seg.length) cum.push(cum[cum.length - 1] + dist(seg[seg.length - 1], p)); else cum = [0];
      seg.push(p); if (seg.length > 900) { seg.shift(); cum.shift(); }
      const n = seg.length - 1;
      for (let i = n - 20; i >= 0; i--) {
        const len = cum[n] - cum[i]; if (len < C.loopM) continue;
        if (dist(seg[i], p) > C.loopBack) continue;
        let far = 0, area = 0; const kx = KX(p[1]);
        for (let k = i; k <= n; k++) { far = Math.max(far, dist(p, seg[k])); const q = seg[k === n ? i : k + 1]; area += (seg[k][2] * q[1] - q[2] * seg[k][1]); }
        area = Math.abs(area) / 2 * kx * KY;
        if (far >= C.loopFar && 4 * Math.PI * area / (len * len) >= C.loopRound) return { t: p[0] * 1000, lat: p[1], lng: p[2] };
        break; // 只看最近的那次回到這裡
      }
    }
    return null;
  }
  function hsr(pts) {
    let km = 0, prev = null;
    for (const p of pts) {
      if (prev && p[4] === 'v') {
        const d = dist(prev, p) / 1000, dt = p[0] - prev[0], v = d / (dt / 3600);
        if (dt > 0 && dt <= 600 && v >= C.hsrKmh && v <= 340) { km += d; if (km >= C.hsrKm) return { t: p[0] * 1000, lat: p[1], lng: p[2] }; } else km = 0;
      } else km = 0;
      prev = p;
    }
    return null;
  }
  function plane(st) { const f = st.flights[0]; return f ? { t: f[5] || 0, lat: f[3], lng: f[2] } : null; }
  // 樣子與交通類一次看完。have：已經有的
  function shapes(st, pts, have) {
    const out = [], run = { night, dawn, loop, hsr, plane: () => plane(st) };
    for (const id in run) if (!have[id]) { const r = run[id](pts); if (r) out.push(Object.assign({ id }, r)); }
    return out;
  }
  // 蓋章：已經有的不重複。list：[{id, t, lat?, lng?}]，回傳真的新蓋的
  function award(have, at, list, now) {
    const got = [];
    for (const x of list) {
      if (!BY[x.id] || have[x.id]) continue;
      have[x.id] = x.t > 0 && x.t <= now ? Math.round(x.t) : now;
      if (x.lat != null) at[x.id] = [+x.lat.toFixed(6), +x.lng.toFixed(6)];
      got.push(x.id);
    }
    return got;
  }
  return { C, LIST, BY, dist, sortFeatures, hitsAt, heading, totals, sums, next, night, dawn, loop, hsr, plane, shapes, award, RULES };
})();
/*STAMPS_LOGIC_END*/

// --- 章面：朱紅圓章，印泥不均勻、邊緣有手感。全部程式畫，同一個章每次長一樣 ---
const STAMP_RED = '#A33028'; // domy-ignore: 印章算地圖畫風
const STAMP_ICONS = { // 24 格線條
  river: 'M2.5 15.5c2.4-3 4.8-3 6.3 0s4 3 6.4 0 4-3 6.3 0M2.5 20.5c2.4-3 4.8-3 6.3 0s4 3 6.4 0 4-3 6.3 0M15 11.5c0-4-1.5-6.5-4-8.5M15 11.5V2.5M15 11.5c0-4 1.5-6 4-7.5',
  sea: 'M2.5 10c2.4-3 4.8-3 6.3 0s4 3 6.4 0 4-3 6.3 0M2.5 15.5c2.4-3 4.8-3 6.3 0s4 3 6.4 0 4-3 6.3 0M16.5 3.5a2.2 2.2 0 1 0 .1 0',
  park: 'M12 21.5v-7M12 14.5c-4.3 0-7-2-7-5.2 0-2 1.2-3.3 2.6-3.7C8 3.5 9.8 2.3 12 2.3s4 1.2 4.4 3.3c1.4.4 2.6 1.7 2.6 3.7 0 3.2-2.7 5.2-7 5.2ZM7 21.5h10',
  peak: 'M2 20 9.5 6l4.5 8.5 2-3.5 6 9ZM9.5 6V2l3.5 1.2-3.5 1.2',
  temple: 'M2.5 9.5c4 0 7-2.3 9.5-5.5 2.5 3.2 5.5 5.5 9.5 5.5M5.5 9.5V20M18.5 9.5V20M3.5 20h17M10 20v-5.5h4V20M5.5 12.5h13M12 4V2',
  station: 'M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2ZM5 10.5h14M8.5 13.8h.01M15.5 13.8h.01M8 17l-2.5 4M16 17l2.5 4M6.5 19.3h11',
  bridge: 'M2 14h20M4 14c1-5.5 4-8.5 8-8.5s7 3 8 8.5M8 14V7.2M12 14V5.5M16 14V7.2M2.5 18.5c2-1.6 4-1.6 5.5 0s4.5 1.6 6.5 0 4.5-1.6 6.5 0',
  plane: 'M12 2c1.2 0 1.8 1.8 1.8 3.5V9l7.7 4.8v2l-7.7-2.4v4l2.7 2v1.7L12 20l-4.5 1.1v-1.7l2.7-2v-4l-7.7 2.4v-2L10.2 9V5.5C10.2 3.8 10.8 2 12 2Z',
  hsr: 'M2 8.5h9.5c5 0 9 3 10.5 6.5-.5 1.5-1.7 2-3 2H2M2 12.5h16.5M13 8.7v3.8M2 20.5h20M2 5h7',
  night: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10ZM16.5 3.5v3.5M14.8 5.2h3.5M20.5 8.5v2M19.5 9.5h2',
  dawn: 'M3 17.5h18M6.5 17.5a5.5 5.5 0 0 1 11 0M12 8.5V4.5M5.5 11 3.2 8.7M18.5 11l2.3-2.3M7 21h10',
  loop: 'M19.5 8.5A8.3 8.3 0 1 0 20.5 13M20.5 3.5v5h-5M12 10.8a1.2 1.2 0 1 0 .1 0'
};
const stampCache = new Map();
function stampImage(id, size) { // 回傳 canvas（size×size 像素，底是透明的）
  const def = STAMPS_LOGIC.BY[id]; if (!def) return null;
  const key = id + '@' + size; if (stampCache.has(key)) return stampCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), S = size / 100; // 以 100 為一格來畫
  let seed = 7; for (const ch of id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  g.scale(S, S); g.translate(50, 50); g.rotate((rnd() - 0.5) * 0.2);
  g.strokeStyle = g.fillStyle = STAMP_RED; g.lineCap = g.lineJoin = 'round';
  const ring = (r, w, wob) => { // 手刻的圈：半徑與粗細都有一點抖
    const ph = [rnd() * 6.3, rnd() * 6.3, rnd() * 6.3], R = a => r + wob * (Math.sin(a * 3 + ph[0]) * 0.5 + Math.sin(a * 7 + ph[1]) * 0.3 + Math.sin(a * 17 + ph[2]) * 0.25);
    const W = a => w * (1 + 0.22 * Math.sin(a * 2 + ph[1]) + 0.12 * Math.sin(a * 11 + ph[2]));
    g.beginPath();
    for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 2, q = R(a) + W(a) / 2; g.lineTo(Math.cos(a) * q, Math.sin(a) * q); }
    for (let i = 120; i >= 0; i--) { const a = i / 120 * Math.PI * 2, q = R(a) - W(a) / 2; g.lineTo(Math.cos(a) * q, Math.sin(a) * q); }
    g.fill();
  };
  ring(45, 4.6, 0.9); ring(38.5, 1.3, 0.6);
  const font = "'Luoyan','PingFang TC','Noto Sans TC',sans-serif";
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const text = (s, y, px) => { g.font = px + 'px ' + font; g.lineWidth = px * 0.06; g.fillText(s, 0, y); g.strokeText(s, 0, y); };
  if (def.big) { text(def.big, -7, def.big.length > 2 ? 40 : 52); text(def.small, 21, def.small.length > 2 ? 15 : 20); }
  else {
    g.save(); g.translate(0, -9); g.scale(1.7, 1.7); g.translate(-12, -12); g.lineWidth = 1.9; g.stroke(new Path2D(STAMP_ICONS[def.icon])); g.restore();
    text(def.small, 23, 21);
  }
  // 印泥：一大塊一大塊的淡，加上沒沾到的小白點
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) {
    const a = rnd() * 6.3, d = rnd() * 44, x = Math.cos(a) * d, y = Math.sin(a) * d, r = 10 + rnd() * 18, q = g.createRadialGradient(x, y, 0, x, y, r);
    q.addColorStop(0, 'rgba(0,0,0,' + (0.12 + rnd() * 0.16).toFixed(2) + ')'); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(0,0,0,' + (0.25 + rnd() * 0.6).toFixed(2) + ')'; g.beginPath(); g.arc((rnd() - 0.5) * 100, (rnd() - 0.5) * 100, 0.2 + rnd() * rnd() * 0.9, 0, 6.3); g.fill(); }
  // 章面裡的字要等手寫字型載好才留著用
  if (!document.fonts || document.fonts.check("18px 'Luoyan'")) stampCache.set(key, c);
  return c;
}
function stampsOfDay(key) { // 那天拿到的，早的在前
  const s = ext('stamps', {}); return Object.keys(s).filter(id => STAMPS_LOGIC.BY[id] && dayKey(s[id]) === key).sort((a, b) => s[a] - s[b]);
}

(() => {
  const L = STAMPS_LOGIC;
  const have = () => ext('stamps', {}), at = () => ext('stampsAt', {});
  const st = () => engine.state();
  let towns = null; // 走過幾個區，算過才有數字

  // --- 蓋章 ---
  const queue = []; // 畫面看不到時先排著
  function give(list) {
    if (!list.length || store.locked) return;
    const got = L.award(have(), at(), list, Date.now()); if (!got.length) return;
    extSave(); fill(); queue.push(...got); showQueue();
    document.dispatchEvent(new Event('onion:stamps'));
  }
  let showTimer = null;
  function showQueue() { clearTimeout(showTimer); showTimer = setTimeout(() => { // 差不多同時拿到的併成一次
    if (document.hidden || !queue.length) return;
    const ids = queue.splice(0);
    if (ids.length > 2) { toast('蓋了 ' + ids.length + ' 個印章，在足跡頁', 3200); return; }
    toast('拿到印章：' + ids.map(i => L.BY[i].name).join('、'), 3200); stampFx(ids[ids.length - 1]);
  }, 700); }
  function stampFx(id) {
    const old = $('stFx'); if (old) old.remove();
    const d = document.createElement('div'); d.id = 'stFx'; d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<div class="stPaper"></div>'; d.firstChild.appendChild(sized(id, 150));
    document.body.appendChild(d); setTimeout(() => d.remove(), 2000);
  }
  function sized(id, px) { // 照螢幕密度畫；同一張 canvas 不能同時放兩個地方，所以複製一份
    const k = Math.min(3, window.devicePixelRatio || 1), src = stampImage(id, Math.round(px * k)), c = document.createElement('canvas');
    c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); c.style.width = c.style.height = px + 'px';
    c.setAttribute('role', 'img'); c.setAttribute('aria-label', L.BY[id].name); return c;
  }

  // --- 累積與樣子 ---
  function checkSums() { give(L.sums(st(), towns, have())); }
  function checkShapes(pts) { give(L.shapes(st(), pts, have())); }
  async function checkTowns(force) { // 區數要掃全部格子，格子多的時候只在打開 app 與足跡頁時算
    if (have().town10 && towns != null) return;
    const n = Object.keys(st().cells).length; if (!n) { towns = 0; return; }
    if (!force && n > 20000) return;
    try { const e = exploredByTown(await loadAdmin()); towns = [...e.town.values()].filter(a => a >= 0.01).length; } catch (x) { return; }
    checkSums(); fill();
  }

  // --- 走到的地方：看地圖上已經載好的圖磚。沒載到的點先放著，之後地圖移到那裡再補 ---
  const GEO = L.LIST.filter(s => s.kind === 'geo').map(s => s.id);
  const seenGeo = new Set(), seenPoi = new Set(); // 看過的小格子（h3 11 級）
  const FILTER = { poi: ['match', ['get', 'class'], ['place_of_worship', 'railway', 'park'], true, false], transportation: ['==', ['get', 'brunnel'], 'bridge'],
    landcover: ['==', ['get', 'subclass'], 'park'], waterway: ['!=', ['get', 'brunnel'], 'tunnel'] };
  function checkGeo() {
    const want = GEO.filter(id => !have()[id]); if (!want.length || document.hidden || !map.getSource('omt')) return;
    const z = map.getZoom(); if (z < 12) return;
    let ready = false; try { ready = map.isSourceLoaded('omt'); } catch (e) {} if (!ready) return;
    const b = map.getBounds(), poiOk = z >= 14, todo = [];
    const pts = st().points;
    for (let i = pts.length - 1; i >= 0 && todo.length < 400; i--) { // 新的先看
      const p = pts[i]; if (p[4] !== 'w' || p[3] > L.C.acc || !b.contains([p[2], p[1]])) continue;
      const c = h3.latLngToCell(p[1], p[2], 11); if (poiOk ? seenPoi.has(c) : seenGeo.has(c)) continue;
      seenGeo.add(c); if (poiOk) seenPoi.add(c); todo.push(i);
    }
    if (!todo.length) return;
    const layers = {};
    for (const l of ['water', 'waterway', 'park', 'landcover', 'mountain_peak', 'transportation', 'poi']) {
      if (l === 'poi' && !poiOk) continue;
      try { layers[l] = map.querySourceFeatures('omt', { sourceLayer: l, filter: FILTER[l] }).map(f => ({ geometry: f.geometry, properties: f.properties })); } catch (e) { layers[l] = []; }
    }
    const sorted = L.sortFeatures(layers), out = {};
    for (const i of todo) { // todo 由新到舊，後面的蓋前面的＝留最早的一次
      const p = pts[i];
      for (const id of L.hitsAt(sorted, p[1], p[2], want, L.heading(pts, i))) out[id] = { id, t: p[0] * 1000, lat: p[1], lng: p[2] };
    }
    give(Object.values(out));
  }
  let geoTimer = null;
  function geoSoon(ms) { if (!geoTimer) geoTimer = setTimeout(() => { geoTimer = null; checkGeo(); }, ms); }
  map.on('idle', () => geoSoon(300));

  // --- 每個定位點：20 秒或 60 公尺看一次 ---
  let lastFix = null, lastSlow = 0;
  hook.fix.push((f, r) => {
    const p = [f.t / 1000, f.lat, f.lng];
    if (lastFix && Math.abs(f.t - lastFix[0] * 1000) < 20000 && L.dist(lastFix, p) < 60 && r.mode !== 'flight') return;
    lastFix = p; geoSoon(800); checkSums();
    if (r.mode === 'flight' || performance.now() - lastSlow > 20000) {
      lastSlow = performance.now(); const pts = engine.dayPoints(dayKey(f.t)); // 跨過半夜的夜路，開 app 時整段再看一次
      checkShapes(pts); checkTowns(false);
    }
  });
  function checkAll(full) { // full：整段軌跡都看；回到前景只看最近兩天
    const pts = st().points, cut = Date.now() / 1000 - 2 * 86400; let i = 0; if (!full) { i = pts.length; while (i && pts[i - 1][0] > cut) i--; }
    checkSums(); checkShapes(i ? pts.slice(i) : pts); checkTowns(true); geoSoon(600);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => { checkAll(); showQueue(); }, 900); });

  // --- 足跡頁 ---
  function fill() {
    const el = $('mountStamps'); if (!el) return;
    const got = have(), ids = Object.keys(got).filter(id => L.BY[id]).sort((a, b) => got[b] - got[a]), nx = L.next(st(), towns, got);
    el.className = 'section';
    el.innerHTML = '<h2>印章</h2><div class="stStrip">' +
      ids.map(id => '<button class="stCell press" data-st="' + id + '"><span class="stPaper"></span><span>' + esc(label(id)) + '</span></button>').join('') +
      (nx ? '<div class="stNext"><span class="meta">下一個</span><b>' + esc(nx.name) + '</b>' + (nx.left ? '<span class="meta">' + esc(nx.left) + '</span>' : '') + '</div>' : '') + '</div>';
    el.querySelectorAll('[data-st]').forEach(x => { x.setAttribute('aria-label', '印章：' + L.BY[x.dataset.st].name); x.firstChild.appendChild(sized(x.dataset.st, 76)); });
    el.onclick = e => { const b = e.target.closest('[data-st]'); if (b) openStamp(b.dataset.st); };
  }
  function label(id) { const s = L.BY[id]; return s.big ? s.name.replace(/^(走過|走滿|探索) /, '') : s.small; }
  function where(id) { // 在哪裡：[lat, lng]；沒記到位置的就飛去那天走過的範圍
    const p = at()[id]; if (p) return { p };
    const d = st().days[dayKey(have()[id])]; return d ? { box: d.box } : null;
  }
  function openStamp(id) {
    const d = new Date(have()[id]), w = where(id);
    const b = openSheet('<div class="stPaper stBig"></div><div class="stHead"><h2>' + esc(L.BY[id].name) + '</h2><p class="stWhen">' +
      d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + hm(+d) + '</p></div>' +
      '<div class="actions">' + (w ? '<button class="btn primary full press" id="stGo">看在哪裡</button>' : '') + '<button class="btn plain full press" data-close>關閉</button></div>');
    b.querySelector('.stBig').appendChild(sized(id, 168));
    if (w) $('stGo').onclick = () => {
      if (w.p) placeFly(w.p[0], w.p[1], 16);
      else { follow = false; closeSheet(); go('map'); map.fitBounds([[w.box[0], w.box[1]], [w.box[2], w.box[3]]], { padding: { top: 90, bottom: 260, left: 40, right: 80 }, maxZoom: 16, duration: 900 }); }
    };
  }
  document.addEventListener('onion:steps', () => { fill(); checkSums(); checkTowns(true); });
  document.addEventListener('onion:wiped', () => { towns = null; queue.length = 0; seenGeo.clear(); seenPoi.clear(); fill(); });
  document.addEventListener('onion:restored', () => { towns = null; seenGeo.clear(); seenPoi.clear(); fill(); checkAll(true); });
  hook.ready.push(() => setTimeout(() => checkAll(true), 1200));
})();
