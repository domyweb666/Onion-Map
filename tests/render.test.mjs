// node --test tests/render.test.mjs　地圖的霧與走過次數：只算視野附近，結果要跟整張一起算一樣、6 萬格要夠快
// 足跡全是假的（固定亂數產生），不是任何人走過的路
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), h3 = require('h3-js');
const src = n => fs.readFileSync(new URL('../src/js/' + n, import.meta.url), 'utf8');
const cut = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b));
const { CFG, dayKey, createEngine, VIEW, revealTierAt, freqResAt, parentOf, growBox, bucketBox, cellsNear, revealOf, mergeTiers, mergeCells, FREQ, freqOf } = new Function('h3',
  cut(src('00-engine.js'), '/*ENGINE_START*/', '/*ENGINE_END*/') + cut(src('20-map.js'), '/*VIEW_START*/', '/*VIEW_END*/') +
  ';return {CFG,dayKey,createEngine,VIEW,revealTierAt,freqResAt,parentOf,growBox,bucketBox,cellsNear,revealOf,mergeTiers,mergeCells,FREQ,freqOf}')(h3);

const rng = k => () => (k = (k * 16807) % 2147483647) / 2147483647;
// 台北每天走、通勤同一條路走十幾趟（每趟 GPS 偏幾公尺）、各縣市走走、全台鐵公路一條窄帶
function fakeCells(N, seed = 7) {
  const rnd = rng(seed), g = () => (rnd() + rnd() + rnd() - 1.5) * 2, cells = {}, seen = {}, EDGE = h3.getHexagonEdgeLengthAvg(12, 'm'); let n = 0, visit = 0;
  const put = (lat, lng, r) => {
    for (const c of h3.gridDisk(h3.latLngToCell(lat, lng, 12), Math.ceil(r / (EDGE * 1.5)) + 1)) {
      if (seen[c] === visit || h3.greatCircleDistance([lat, lng], h3.cellToLatLng(c), 'm') > r + EDGE * 0.5) continue;
      seen[c] = visit; if (cells[c]) cells[c][0]++; else { cells[c] = [1, 1.7e12 + visit * 864e5]; n++; }
    }
  };
  const walk = (pts, r) => {
    visit++; const a = g() * 8 / 111000, b = g() * 8 / 101000;
    for (let i = 1; i < pts.length && n < N; i++) {
      const p = pts[i - 1], q = pts[i], m = Math.max(1, Math.ceil(h3.greatCircleDistance(p, q, 'm') / (r * 0.8)));
      for (let j = 1; j <= m && n < N; j++) put(p[0] + (q[0] - p[0]) * j / m + a + g() * 2e-5, p[1] + (q[1] - p[1]) * j / m + b + g() * 2e-5, r);
    }
  };
  const stroll = (lat, lng, km) => {
    const pts = [[lat, lng]]; let left = km * 1000, d = Math.floor(rnd() * 4);
    while (left > 0) { const l = 80 + rnd() * 260, u = rnd(); left -= l; d = (d + (u < .3 ? 1 : u < .6 ? 3 : 0)) % 4; lat += [1, 0, -1, 0][d] * l / 111000; lng += [0, 1, 0, -1][d] * l / 101000; pts.push([lat, lng]); }
    return pts;
  };
  const A = [25.0330, 121.5436], B = [25.0478, 121.5170];
  const TRUNK = [[25.13, 121.74], [25.05, 121.52], [25.01, 121.21], [24.80, 120.97], [24.15, 120.68], [23.85, 120.53], [23.48, 120.44], [23.0, 120.2], [22.63, 120.30], [22.37, 120.6], [22.75, 121.15], [23.98, 121.6], [24.75, 121.75], [25.05, 121.6]];
  const TOWNS = [[24.80, 120.97], [24.15, 120.68], [23.48, 120.44], [23.0, 120.2], [22.63, 120.3], [22.75, 121.15], [23.98, 121.6], [24.75, 121.75], [23.86, 120.92], [22.0, 120.75], [25.11, 121.84], [24.67, 121.77]];
  for (let i = 0; i < 12; i++) walk([A, [25.0415, 121.5436], [25.0440, 121.5300], B], 30);
  for (let i = 0; i < 3; i++) walk([[25.05, 121.52], [25.01, 121.46], [25.01, 121.30]], 14);
  walk(TRUNK.slice(0, 4), 14);
  for (const [y, x] of TOWNS) { walk(stroll(y, x, 2), 30); walk([[y, x], [y + 0.04, x + g() * 0.03]], 14); }
  while (n < N * 0.9) {
    if (rnd() < .25) { const t = TOWNS[Math.floor(rnd() * TOWNS.length)]; walk(stroll(t[0] + g() * .01, t[1] + g() * .01, 3 + rnd() * 4), 30); }
    else { const c = rnd() < .5 ? A : B, p = stroll(c[0] + g() * .02, c[1] + g() * .02, 2 + rnd() * 4), m = rnd() < .5 ? 2 : 1; for (let i = 0; i < m; i++) walk(p, 30); }
  }
  walk(TRUNK.slice(4), 14); while (n < N) walk(stroll(A[0] + g() * .03, A[1] + g() * .03, 3), 30);
  return cells;
}
const REAL = fakeCells(60000), rnd = rng(99);
const FRAG = Object.fromEntries(Object.entries(REAL).map(([c, v]) => [c, [v[0] + (rnd() < .45 ? 1 + Math.floor(rnd() * 10) : 0), v[1]]])); // 次數碎成滿天星，破洞最多的情況
const eng = cells => { const e = createEngine(h3); e.loadCells(structuredClone(cells)); return e; };
const E = eng(REAL);
const view = (lng, lat, z, w = 375, h = 812) => { const d = 360 / (512 * 2 ** z), k = Math.cos(lat * Math.PI / 180); return [lng - d * w / 2, lat - d * h / 2 * k, lng + d * w / 2, lat + d * h / 2 * k]; };
const hits = (box, ring) => { let w = 999, s = 999, e = -999, n = -999; for (const [lat, lng] of ring) { w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat); } return w <= box[2] && e >= box[0] && s <= box[3] && n >= box[1]; };
const touching = (box, set) => new Set([...set].filter(c => hits(box, h3.cellToBoundary(c))));
// 改之前的算法（整張一起算）
const oldReveal = (ids, tier) => { const set = new Set(); for (const c of ids) { const p = h3.cellToParent(c, tier === 'fine' ? 11 : 8); if (tier === 'fine') for (const d of h3.gridDisk(p, 2)) set.add(d); else set.add(p); } return set; };
const oldFreq = (ids, cells) => FREQ.map(th => ids.filter(c => cells[c][0] >= th)).filter(a => a.length).map(a => h3.cellsToMultiPolygon(a, true));
const nowAt = (e, z, v) => { const tier = revealTierAt(z), ids = cellsNear(e.buckets(), growBox(v, VIEW.spare), VIEW.pad[tier]), set = revealOf(ids, tier); mergeCells([...set]); return { ids, set, tier, freq: freqOf(ids, e.state().cells, freqResAt(z)) }; };

// 全世界亂撒、五邊形與它附近、每個第 0 層格子裡的點
const world = (() => {
  const out = [], r = rng(3);
  for (const b of h3.getRes0Cells()) for (let i = 0; i < 12; i++) { let c = b; for (let z = 1; z <= 12; z++) { const k = h3.cellToChildren(c, z); c = k[Math.floor(r() * k.length)]; } out.push(c); }
  for (let z = 0; z <= 12; z += 3) for (const p of h3.getPentagons(z)) { const [lat, lng] = h3.cellToLatLng(p); out.push(...h3.gridDisk(h3.latLngToCell(lat, lng, 12), 3)); for (const n of h3.gridDisk(p, 1)) out.push(h3.latLngToCell(...h3.cellToLatLng(n), 12)); }
  for (let i = 0; i < 20000; i++) out.push(h3.latLngToCell(Math.asin(2 * r() - 1) * 57.29577951, r() * 360 - 180, 12));
  return [...new Set(out)];
})();

test('字串前綴與上層對得上：全部 122 個第 0 層格子、五邊形附近、全球亂撒', () => {
  const shard = new Map();
  for (const c of world) {
    for (const r of [4, 7, 8, 9, 10, 11]) assert.equal(parentOf(c, r), h3.cellToParent(c, r));
    const p4 = h3.cellToParent(c, CFG.shardRes), k = c.slice(0, 7); if (!shard.has(k)) shard.set(k, p4); assert.equal(shard.get(k), p4);
    assert.equal('87' + c.slice(2, 9) + 'ffffff', h3.cellToParent(c, 7));
    assert.equal('8b' + c.slice(2, 12) + 'fff', h3.cellToParent(c, 11));
  }
  assert.equal(new Set(world.map(c => h3.getBaseCellNumber(c))).size, 122);
});
test('分片跟直接問 h3 一樣；每格剛好在一塊裡', () => {
  const e = createEngine(h3), want = {}; e.loadCells(Object.fromEntries(world.map(c => [c, [1, 1]])));
  for (const c of world) (want[h3.cellToParent(c, CFG.shardRes)] ||= []).push(c);
  assert.deepEqual(e.takeSaves().shards.sort(), Object.keys(want).sort());
  for (const k in want) assert.deepEqual(Object.keys(e.shardData(k)).sort(), want[k].sort());
  const all = [...e.buckets().values()].flat(); assert.equal(all.length, world.length); assert.equal(new Set(all).size, world.length);
  e.loadCells({ [world[0]]: [5, 5] }); assert.equal([...e.buckets().values()].flat().length, world.length); // 重複加不會多一份
  e.clear(); assert.equal(e.buckets().size, 0);
});
test('一塊的外框包得住裡面每一格', () => {
  const r = rng(11);
  for (const [k, list] of eng(Object.fromEntries(world.map(c => [c, [1, 1]]))).buckets()) {
    const b = bucketBox(k), far = [list[0]];
    for (let i = 0; i < 6; i++) { let c = '87' + k.slice(2) + 'ffffff'; for (let z = 8; z <= 12; z++) { const q = h3.cellToChildren(c, z); c = q[Math.floor(r() * q.length)]; } far.push(c); }
    for (const c of far) for (const [lat, lng] of h3.cellToBoundary(c)) {
      const x = [lng - 360, lng, lng + 360].some(v => v >= b[0] && v <= b[2]);
      assert.ok(lat >= b[1] && lat <= b[3] && (x || Math.abs(lat) > 89), c + ' 超出 ' + k);
    }
  }
});

const VIEWS = [['台北', 121.53, 25.04], ['台中', 120.68, 24.15], ['通勤路中間', 121.5436, 25.0385], ['高鐵線上', 120.6, 24.0], ['太平洋', 123, 23], ['換到東邊', 121.61, 23.97]]
  .flatMap(([n, x, y]) => [8, 9.5, 10.9, 11, 12.5, 14, 15.5, 17, 19].map(z => [n + ' z' + z, x, y, z]));
test('視野裡霧散開的格子跟整張一起算完全一樣', () => {
  const ids = Object.keys(REAL), all = { fine: oldReveal(ids, 'fine'), coarse: oldReveal(ids, 'coarse') }; let seen = 0;
  for (const [name, x, y, z] of VIEWS) {
    const v = view(x, y, z), now = nowAt(E, z, v), big = growBox(v, VIEW.spare);
    const a = touching(big, all[now.tier]), b = touching(big, now.set); seen += a.size; // 外擴的半個畫面也要一樣，拖到那裡才不會是假的霧
    assert.deepEqual([...b].sort(), [...a].sort(), name);
    for (const c of now.set) assert.ok(all[now.tier].has(c), name + ' 多揭開了');
  }
  assert.ok(seen > 20000);
});
test('視野裡走過次數的格子跟整張一起算完全一樣（縮小看是合併過的上層格）', () => {
  const ids = Object.keys(REAL);
  for (const [name, x, y, z] of VIEWS) {
    const v = growBox(view(x, y, z), VIEW.spare), res = freqResAt(z), near = cellsNear(E.buckets(), v, VIEW.pad[revealTierAt(z)]);
    for (const th of FREQ) {
      const pick = list => touching(v, new Set(list.filter(c => REAL[c][0] >= th).map(c => h3.cellToParent(c, res))));
      assert.deepEqual([...pick(near)].sort(), [...pick(ids)].sort(), name);
    }
  }
});
test('縮小看時合併的格子不到一個像素半', () => {
  for (let z = 4; z < 11; z += 0.1) { const px = h3.getHexagonEdgeLengthAvg(freqResAt(z), 'm') * 1.732 / (40075016.686 * Math.cos(23.7 * Math.PI / 180) / (512 * 2 ** z)); assert.ok(z < 5.5 || px < 1.5, z + ' ' + px); }
});

const areaOf = ring => { let a = 0, [x0, y0] = ring[0]; for (let i = 1; i < ring.length; i++) a += (ring[i - 1][0] - x0) * (ring[i][1] - y0) - (ring[i][0] - x0) * (ring[i - 1][1] - y0); return a / 2; };
const shape = polys => polys.map(p => [p.length, p.reduce((n, r) => n + r.length, 0), areaOf(p[0]) * 1e8, p.slice(1).reduce((n, r) => n + areaOf(r), 0) * 1e8]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
function sameShape(a, b) { // 圈數、點數完全一樣，面積差不到萬分之一
  a = shape(a); b = shape(b); assert.deepEqual(a.map(x => x.slice(0, 2)), b.map(x => x.slice(0, 2)));
  a.forEach((x, i) => [2, 3].forEach(j => assert.ok(Math.abs(x[j] - b[i][j]) <= 1e-4 * Math.abs(b[i][2]), x + ' / ' + b[i])));
}
test('合併成多邊形的結果跟 h3 一樣：圈數、點數、外框與洞的面積', () => {
  const r = rng(5), disk = (lat, lng, res, k) => h3.gridDisk(h3.latLngToCell(lat, lng, res), k);
  const sets = [disk(25, 121.5, 12, 0), disk(25, 121.5, 12, 4), disk(25, 121.5, 12, 20).filter(() => r() < .7), disk(24, 121, 11, 20).filter(() => r() < .5), disk(23, 120, 10, 15).filter(() => r() < .6), disk(60, 10, 12, 10), disk(-33, 151, 11, 9).filter(() => r() < .8)];
  for (const res of [10, 11, 12]) for (const p of h3.getPentagons(res).slice(0, 5)) sets.push(h3.gridDisk(p, 6).filter(c => r() < .8 || c === p)); // 五邊形
  for (const res of [8, 9, 11]) for (const b of h3.getRes0Cells().slice(10, 14)) sets.push(h3.gridDisk(h3.latLngToCell(...h3.cellToBoundary(b)[0], res), 8).filter(() => r() < .75)); // 第 0 層格子的交界、二十面體的邊
  sets.push(h3.gridDisk(h3.latLngToCell(25, 121.5, 12), 12).filter(c => { const d = h3.gridDistance(c, h3.latLngToCell(25, 121.5, 12)); return d < 3 || (d > 5 && d < 8) || d > 10; })); // 島中有洞、洞中有島
  for (const s of sets) {
    const [g] = mergeTiers(s, s.map(() => 2), [2]); assert.ok(g);
    sameShape(g, h3.cellsToMultiPolygon(s, true));
    for (const p of g) for (const ring of p) assert.deepEqual(ring[0], ring[ring.length - 1]);
  }
  for (const z of [8, 12, 14]) { const set = [...nowAt(E, z, view(121.53, 25.04, z)).set]; sameShape(mergeCells(set), h3.cellsToMultiPolygon(set, true)); } // 霧的洞
  const s = disk(25, 121.5, 12, 20), vals = s.map(() => Math.floor(r() * 14));
  mergeTiers(s, vals, FREQ).forEach((g, i) => sameShape(g, h3.cellsToMultiPolygon(s.filter((c, j) => vals[j] >= FREQ[i]), true)));
  assert.deepEqual(mergeTiers([], [], FREQ), [[], [], []]);
});
test('城市級的走過次數，合併完跟舊做法一樣', () => {
  const ids = cellsNear(E.buckets(), view(121.53, 25.04, 14), 0.4), a = freqOf(ids, REAL, 12), b = oldFreq(ids, REAL);
  assert.equal(a.length, b.length); a.forEach((g, i) => sameShape(g, b[i]));
});
test('轉過換日線、地圖捲了好幾圈都找得到格子', () => {
  const e = createEngine(h3), mk = (lat, lng) => h3.latLngToCell(lat, lng, 12); e.loadCells({ [mk(-17, 179.999)]: [1, 1], [mk(-17, -179.99)]: [1, 1], [mk(25, 121.5)]: [1, 1] });
  assert.equal(cellsNear(e.buckets(), [179.9, -17.1, 180.1, -16.9], 0.4).length, 2);
  assert.equal(cellsNear(e.buckets(), [-180.1, -17.1, -179.9, -16.9], 0.4).length, 2);
  assert.equal(cellsNear(e.buckets(), [121.4 + 720, 24.9, 121.6 + 720, 25.1], 0.4).length, 1);
  assert.equal(cellsNear(e.buckets(), [121.4 - 360, 24.9, 121.6 - 360, 25.1], 0.4).length, 1);
  assert.equal(cellsNear(e.buckets(), [-200, -80, 200, 80], 2).length, 3);
  assert.equal(cellsNear(e.buckets(), [0, 0, 1, 1], 2).length, 0);
});

test('6 萬格的計算時間（新舊對照）', t => {
  const med = f => { const a = []; for (let i = 0; i < 3; i++) { const s = performance.now(); f(); a.push(performance.now() - s); } return a.sort((x, y) => x - y)[1]; };
  for (const [name, cells] of [['像真的', REAL], ['次數全碎', FRAG]]) {
    const e = eng(cells), ids = Object.keys(cells);
    const s = performance.now(); oldFreq(ids, cells); const f = performance.now() - s;
    for (const tier of ['fine', 'coarse']) { const s = performance.now(); h3.cellsToMultiPolygon([...oldReveal(ids, tier)], true); t.diagnostic(name + ' 舊 ' + tier + '：' + Math.round(f + performance.now() - s) + ' ms（走過次數 ' + Math.round(f) + '）'); }
    for (const [label, x, y, z] of [['全台 z6.5', 121, 23.7, 6.5], ['全台 z8', 121, 23.7, 8], ['北部 z9', 121.4, 24.9, 9], ['大台北 z10.9', 121.53, 25.04, 10.9], ['大台北 z11', 121.53, 25.04, 11], ['大台北 z12', 121.53, 25.04, 12], ['台北 z13', 121.53, 25.04, 13], ['台北 z14', 121.53, 25.04, 14], ['台北 z15', 121.53, 25.04, 15]]) {
      const v = view(x, y, z); let r; const ms = med(() => { r = nowAt(e, z, v); });
      t.diagnostic(name + ' 新 ' + label + '：' + ms.toFixed(0) + ' ms，取 ' + r.ids.length + ' 格');
      if (z === 8 || z === 14) assert.ok(ms < (process.env.CI ? 3000 : 300), label + ' ' + ms);
    }
  }
});

test('某一天的點：二分搜尋跟整份挑一樣；五年份每天拿一次要夠快', t => {
  const e = createEngine(h3), pts = [], t0 = new Date(2021, 10, 25, 9).getTime() / 1000;
  for (let d = 0; d < 1800; d++) if (d % 4) for (let i = 0; i < 100; i++) pts.push([t0 + d * 86400 + i * 60, 25.03 + i * 1e-4, 121.5, 8, 'w']);
  pts.push([new Date(2026, 10, 1, 23, 59, 59).getTime() / 1000, 25, 121, 8, 'w'], [new Date(2026, 10, 2).getTime() / 1000, 25, 121, 8, 'w']);
  e.load({ v: 2, cells: {}, points: pts });
  const keys = Object.keys(e.state().days), by = {}; for (const p of e.state().points) (by[dayKey(p[0])] ||= []).push(p);
  const a = performance.now(), got = keys.map(k => e.dayPoints(k)), ms = performance.now() - a;
  keys.forEach((k, i) => assert.deepEqual(got[i], by[k], k));
  assert.deepEqual(e.dayPoints('2020-01-01'), []); assert.deepEqual(e.dayPoints('2030-01-01'), []);
  t.diagnostic(`${keys.length} 天、${pts.length} 點，每天拿一次 ${ms.toFixed(0)} ms`); assert.ok(ms < 1500, ms);
});
