import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../src/js/64-stamps.js', import.meta.url), 'utf8');
const L = new Function(src.slice(src.indexOf('/*STAMPS_LOGIC_START*/'), src.indexOf('/*STAMPS_LOGIC_END*/')) + ';return STAMPS_LOGIC;')();

const LAT = 25.03, LNG = 121.52, dLat = m => m / 110540, dLng = m => m / (111320 * Math.cos(LAT * Math.PI / 180));
const at = (h, m = 0, d = 20) => Math.floor(new Date(2026, 10, d, h, m).getTime() / 1000);
const pt = (t, e, n, mode = 'w', acc = 10) => [t, LAT + dLat(n), LNG + dLng(e), acc, mode];
const pos = (e, n) => [LNG + dLng(e), LAT + dLat(n)];
const point = (e, n) => ({ type: 'Point', coordinates: pos(e, n) });
const box = (e0, n0, e1, n1) => ({ type: 'Polygon', coordinates: [[pos(e0, n0), pos(e1, n0), pos(e1, n1), pos(e0, n1), pos(e0, n0)]] });
const line = (...p) => ({ type: 'LineString', coordinates: p.map(q => pos(...q)) });
const f = (geometry, properties) => ({ geometry, properties });
const GEO = L.LIST.filter(s => s.kind === 'geo').map(s => s.id);
const hits = (layers, e = 0, n = 0, dir = [10, 0]) => L.hitsAt(L.sortFeatures(layers), LAT + dLat(n), LNG + dLng(e), GEO, dir);
const day = (walk, t1 = 1) => ({ t0: 0, t1, walk, veh: 0, fl: 0, n: 1, box: [0, 0, 1, 1] });
const state = o => ({ days: {}, km: { walk: 0, vehicle: 0, flight: 0 }, area: 0, flights: [], points: [], ...o });
// 照折線走，每 step 公尺一點
function path(t0, pts, step = 20, v = 1.3) {
  const o = []; let t = t0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(d / step));
    for (let k = 0; k < n; k++) { o.push(pt(Math.round(t), a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)); t += d / n / v; }
  }
  const e = pts[pts.length - 1]; o.push(pt(Math.round(t), e[0], e[1])); return o;
}

test('每個印章都有代號、名字、章面', () => {
  assert.equal(new Set(L.LIST.map(s => s.id)).size, L.LIST.length);
  for (const s of L.LIST) assert.ok(s.name && s.small && (s.icon || s.big), s.id);
});
test('河邊：河面 40 公尺內；排水溝與地下的不算', () => {
  assert.deepEqual(hits({ water: [f(box(30, -100, 200, 100), { class: 'river' })] }), ['river']);
  assert.deepEqual(hits({ water: [f(box(60, -100, 200, 100), { class: 'river' })] }), []);
  assert.deepEqual(hits({ waterway: [f(line([20, -100], [20, 100]), { class: 'river' })] }), ['river']);
  assert.deepEqual(hits({ waterway: [f(line([20, -100], [20, 100]), { class: 'river', brunnel: 'tunnel' })] }), []);
  assert.deepEqual(hits({ waterway: [f(line([20, -100], [20, 100]), { class: 'drain' })] }), []);
});
test('海邊：湖不算', () => {
  assert.deepEqual(hits({ water: [f(box(20, -500, 900, 500), { class: 'ocean' })] }), ['sea']);
  assert.deepEqual(hits({ water: [f(box(20, -500, 900, 500), { class: 'lake' })] }), []);
});
test('公園：站在裡面也算；一般草地不算', () => {
  assert.deepEqual(hits({ landcover: [f(box(-100, -100, 100, 100), { class: 'grass', subclass: 'park' })] }), ['park']);
  assert.deepEqual(hits({ landcover: [f(box(-100, -100, 100, 100), { class: 'grass', subclass: 'grass' })] }), []);
});
test('山頂', () => {
  assert.deepEqual(hits({ mountain_peak: [f(point(30, 30), { class: 'peak', name: '象山' })] }), ['peak']);
  assert.deepEqual(hits({ mountain_peak: [f(point(90, 0), { class: 'peak' })] }), []);
});
test('廟：教堂不算', () => {
  assert.deepEqual(hits({ poi: [f(point(20, 0), { class: 'place_of_worship', subclass: 'taoist', name: '土地公廟' })] }), ['temple']);
  assert.deepEqual(hits({ poi: [f(point(20, 0), { class: 'place_of_worship', subclass: 'christian' })] }), []);
});
test('車站：出入口不算', () => {
  assert.deepEqual(hits({ poi: [f(point(60, 0), { class: 'railway', subclass: 'station' })] }), ['station']);
  assert.deepEqual(hits({ poi: [f(point(10, 0), { class: 'railway', subclass: 'subway_entrance' })] }), []);
});
test('過橋：底下要有水、走的方向要跟橋一樣；高架道路與從橋下穿過不算', () => {
  const br = f(line([-100, 0], [100, 0]), { class: 'minor', brunnel: 'bridge' }), w = f(line([0, -100], [0, 100]), { class: 'stream' });
  assert.deepEqual(hits({ transportation: [br], waterway: [w] }), ['bridge']);
  assert.deepEqual(hits({ transportation: [br] }), []);
  assert.deepEqual(hits({ transportation: [br], waterway: [w] }, 0, 0, [0, 10]), []);
  assert.deepEqual(hits({ transportation: [br], waterway: [w] }, 0, 0, null), []);
  assert.deepEqual(hits({ transportation: [f(br.geometry, { class: 'motorway', brunnel: 'bridge' })], waterway: [w] }), []);
  assert.deepEqual(hits({ transportation: [f(br.geometry, { class: 'minor' })], waterway: [w] }), []);
});
test('走過 3／10／30 天：日期是到達的那一天，沒走路的天不算', () => {
  const days = {}; for (let i = 1; i <= 30; i++) days['2026-10-' + String(i).padStart(2, '0')] = day(1, i * 1000);
  days['2026-09-01'] = day(0, 5);
  const r = L.sums(state({ days }), 0, {});
  assert.deepEqual(r.filter(x => /^day/.test(x.id)), [{ id: 'day3', t: 3000 }, { id: 'day10', t: 10000 }, { id: 'day30', t: 30000 }]);
  assert.equal(L.sums(state({ days: { a: day(1), b: day(1), c: day(0.01) } }), 0, {}).length, 0);
});
test('走滿 10／50／100 公里', () => {
  const days = { '2026-10-01': day(6, 100), '2026-10-02': day(6, 200), '2026-10-03': day(90, 300) };
  const r = L.sums(state({ days, km: { walk: 102 } }), 0, {}).filter(x => /^km/.test(x.id));
  assert.deepEqual(r, [{ id: 'km10', t: 200 }, { id: 'km50', t: 300 }, { id: 'km100', t: 300 }]);
});
test('探索 1／5／20 平方公里、走過 3／10 個區', () => {
  assert.deepEqual(L.sums(state({ area: 5.2 }), 3, {}).map(x => x.id), ['area1', 'area5', 'town3']);
  assert.deepEqual(L.sums(state({ area: 20 }), 10, {}).map(x => x.id), ['area1', 'area5', 'area20', 'town3', 'town10']);
});
test('飛機', () => {
  assert.deepEqual(L.plane(state({ flights: [[121, 25, 139, 35, 1000, 2000]] })), { t: 2000, lat: 35, lng: 139 });
  assert.equal(L.plane(state({})), null);
});
test('高鐵速度要連續；開車與 GPS 跳一下不算', () => {
  const run = (kmh, n) => Array.from({ length: n }, (_, i) => pt(at(10) + i * 30, 0, kmh / 3.6 * 30 * i, 'v'));
  assert.ok(L.hsr(run(260, 10))); assert.equal(L.hsr(run(110, 60)), null);
  const j = run(60, 10); j[5] = pt(j[5][0], 0, 3500, 'v'); assert.equal(L.hsr(j), null);
});
test('晚上十點後走、清晨走；白天走、坐車、在家飄移不算', () => {
  const w = h => path(at(h, 5), [[0, 0], [900, 0]]);
  assert.ok(L.night(w(22))); assert.ok(L.night(w(1))); assert.equal(L.night(w(21)), null); assert.equal(L.night(w(15)), null);
  assert.ok(L.dawn(w(5))); assert.equal(L.dawn(w(9)), null);
  const jitter = Array.from({ length: 200 }, (_, i) => pt(at(23) + i * 20, 40 * Math.sin(i * 2.1), 40 * Math.cos(i * 1.7)));
  assert.equal(L.night(jitter), null);
  assert.equal(L.night(w(22).map(p => [p[0], p[1], p[2], p[3], 'v'])), null);
});
test('繞一圈走回原點；原路折返、在原地晃不算', () => {
  assert.ok(L.loop(path(at(8), [[0, 0], [500, 0], [500, 500], [0, 500], [0, 20]])));
  assert.equal(L.loop(path(at(8), [[0, 0], [1200, 0], [0, 10]])), null);
  assert.equal(L.loop(path(at(8), [[0, 0], [500, 0], [500, 500], [0, 500]])), null);
  const small = []; for (let i = 0; i < 8; i++) small.push([0, 0], [80, 0], [80, 80], [0, 80]);
  assert.equal(L.loop(path(at(8), small)), null);
  assert.ok(L.loop(path(at(8), [[-300, 0], [0, 0], [500, 0], [500, 500], [0, 500], [0, 0], [-300, 0]])), '走到路口繞一圈再原路回來也算');
});
test('同一個印章只發一次，時間不會是未來', () => {
  const have = {}, pl = {};
  assert.deepEqual(L.award(have, pl, [{ id: 'river', t: 500, lat: 25, lng: 121 }, { id: 'area1', t: 0 }, { id: 'nope', t: 1 }], 9000), ['river', 'area1']);
  assert.deepEqual(have, { river: 500, area1: 9000 }); assert.deepEqual(pl, { river: [25, 121] });
  assert.deepEqual(L.award(have, pl, [{ id: 'river', t: 800, lat: 1, lng: 1 }, { id: 'day3', t: 99999 }], 9100), ['day3']);
  assert.equal(have.river, 500); assert.equal(have.day3, 9100);
  assert.equal(L.sums(state({ area: 2 }), 0, have).length, 0);
  assert.equal(L.shapes(state({ flights: [[1, 1, 2, 2, 3, 4]] }), [], { plane: 1 }).length, 0);
});
test('下一個只提示一個最接近的', () => {
  assert.deepEqual(L.next(state({ days: { a: day(1), b: day(1) }, km: { walk: 9.2 }, area: 0.4 }), 1, {}), { id: 'km10', name: '走滿 10 公里', left: '再走 0.8 公里' });
  assert.equal(L.next(state({ days: { a: day(1), b: day(1) } }), null, {}).left, '再走 1 天');
  const all = Object.fromEntries(L.LIST.map(s => [s.id, 1])); assert.equal(L.next(state({}), 0, all), null);
  delete all.sea; assert.equal(L.next(state({}), 0, all).name, '第一次走到海邊');
});
test('資料量大也不會卡', () => {
  const t = performance.now(), big = path(at(6), Array.from({ length: 200 }, (_, i) => [i * 400 % 9000, (i % 2) * 300 + i * 40]));
  L.loop(big); L.night(big); L.hsr(big); assert.ok(performance.now() - t < 1500);
});
