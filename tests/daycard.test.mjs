// 一日卡純邏輯的測試：node --test tests/daycard.test.mjs（時間照台灣時區）
process.env.TZ = 'Asia/Taipei';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/js/52-daycard.js'), 'utf8').split('/*DAYCORE_START*/')[1].split('/*DAYCORE_END*/')[0];
const D = vm.runInNewContext(src + ';DAYCORE', { Date, Math, Object });
const M = 1 / 111195; // 一公尺約幾度緯度
const walk = (t0, lat0, meters, step = 10, dt = 8, lng = 121.5) => Array.from({ length: meters / step + 1 }, (_, i) => [t0 + i * dt, lat0 + i * step * M, lng, 8, 'w']);
const T0 = new Date('2026-11-07T09:00:00+08:00') / 1000;
const demo = path.join(ROOT, 'daycard/demo-track.json');

test('第幾天出門：匯入更早的足跡之後會往後排，收掉的天回 0 以外的順位', () => {
  const days = { '2026-11-07': {}, '2026-11-20': {} };
  assert.equal(D.nth(days, '2026-11-07'), 1); assert.equal(D.nth(days, '2026-11-20'), 2);
  days['2024-03-01'] = {}; assert.equal(D.nth(days, '2026-11-07'), 2); assert.equal(D.nth(days, '2024-03-01'), 1);
  assert.equal(D.nth({}, '2026-11-07'), 0);
});
test('示範軌跡：不剪的時候跟 Python 的數字一樣（6.9 km、98 分、4 處、09:30 到 13:35）', { skip: !fs.existsSync(demo) }, t => {
  const pts = JSON.parse(fs.readFileSync(demo, 'utf8')).points, d = D.day(pts, 0);
  t.diagnostic(JSON.stringify(d.stats)); assert.deepEqual({ ...d.stats }, { km: 6.9, car: 0, moving_min: 98, stops: 4, start: '09:30', end: '13:35' });
  assert.deepEqual([...d.stops].map(s => s.minutes), [28, 55, 43, 22]);
  const e = D.day(pts); t.diagnostic('剪頭尾 300 m：剪掉 ' + e.cut + ' 點 ' + JSON.stringify(e.stats)); assert.ok(e.cut > 0);
  const a = pts[0], z = pts[pts.length - 1]; for (const s of e.segs) for (const p of s) assert.ok(D.dist(p[1], p[2], a[1], a[2]) > 300 && D.dist(p[1], p[2], z[1], z[2]) > 300);
  for (const s of e.stops) assert.ok(D.dist(s.lat, s.lng, a[1], a[2]) > 300);
});
test('整天都在 300 公尺內：不畫', () => { const d = D.day(walk(T0, 25, 250)); assert.ok(d.close); });
test('點太少：不做卡', () => { assert.ok(D.day(walk(T0, 25, 50)).few); });
test('中途回家：剪掉的地方斷開，不會變成一個假的停留，也不算走路時間', () => {
  const out = walk(T0, 25, 1000), back = walk(T0 + 900, 25, 1000).map((p, i, a) => [p[0], a[a.length - 1 - i][1], p[2], 8, 'w']);
  const again = walk(T0 + 900 + 800 + 7200, 25, 1000); // 在家兩小時
  const d = D.day([...out, ...back, ...again, ...again.map((p, i, a) => [p[0] + 900, a[a.length - 1 - i][1], p[2], 8, 'w'])]);
  assert.equal(d.stops.length, 0); assert.ok(d.segs.length >= 2); assert.ok(d.stats.moving_min < 60, JSON.stringify(d.stats));
});
test('停留：60 公尺內待滿 12 分', () => {
  const p = walk(T0, 25, 600), l = p[p.length - 1], stay = Array.from({ length: 15 }, (_, i) => [l[0] + 60 * (i + 1), l[1] + (i % 3) * 5 * M, l[2], 8, 'w']), s = D.stops([...p, ...stay]);
  assert.equal(s.length, 1); assert.ok(s[0].minutes >= 15 && s[0].minutes <= 17);
});
test('坐車的那段算進里程；搭飛機的那天只畫點最多的那一段', () => {
  const v = Array.from({ length: 60 }, (_, i) => [T0 + i * 10, 25 + i * 150 * M, 121.5, 8, 'v']), s = D.day(v);
  assert.ok(s.stats.car > 7 && s.stats.km < 9, JSON.stringify(s.stats));
  const f = D.day([...v, [T0 + 4000, 35, 139, 8, 'f'], ...walk(T0 + 9000, 35, 1500, 10, 8, 139)]);
  assert.ok(f.segs.every(x => x.every(p => p[1] > 30))); assert.equal(D.lines(f.segs, D.extent(f.segs)).length, 1);
});
test('範圍：2:3、最小 1.5 公里、軌跡都在卡片裡', () => {
  for (const segs of [[walk(T0, 25, 400)], [walk(T0, 25, 9000)], [walk(T0, 25, 10).map((p, i) => [p[0], 25, 121.5 + i * 0.05, 8, 'w'])]]) {
    const f = D.extent(segs), w = f[2] - f[0], h = f[3] - f[1]; assert.ok(Math.abs(w / h - 2 / 3) < 1e-9);
    assert.ok(w / D.C.bleed * Math.cos(25 * Math.PI / 180) >= 1490);
    for (const p of segs[0]) { const [x, y] = D.px(f, p[2], p[1]); assert.ok(x >= 64 && x <= 960 && y >= 96 && y <= 1440, [x, y]); }
  }
});
test('路線避開板子：兩種比例四款框，起點終點都露得出來，放大不超過 1.3 倍（起終點露不出來才到 1.6）', t => {
  const line = fx => [Array.from({ length: 300 }, (_, i) => [T0 + i * 10, 25 + fx(i / 300)[0], 121.5 + fx(i / 300)[1], 8, 'w'])];
  const cases = { 直的: line(u => [-0.04 * u, 0.002 * Math.sin(u * 9)]), 橫的: line(u => [0.002 * Math.sin(u * 9), 0.05 * u]), 斜的: line(u => [0.04 * u, 0.026 * u]), 繞圈: line(u => [0.015 * Math.cos(u * 6.2), 0.01 * Math.sin(u * 6.2)]), 左上出發: line(u => [-0.03 * u, u < 0.5 ? 0 : 0.03 * (u - 0.5)]) };
  if (fs.existsSync(demo)) cases.示範 = D.day(JSON.parse(fs.readFileSync(demo, 'utf8')).points).segs;
  for (const [name, segs] of Object.entries(cases)) {
    const t0 = performance.now(), st = [60, 150, 240].map(i => { const a = [].concat(...segs), p = a[Math.floor(i / 300 * a.length)]; return { lat: p[1], lng: p[2], minutes: 20 }; }), f = D.extent(segs, st), ms = performance.now() - t0, route = [].concat(...D.lines(segs, f)); let hard = 0, soft = 0;
    const X = route.map(p => p[0]), Y = route.map(p => p[1]), base = Math.max((Math.max(...X) - Math.min(...X)) * 1.3, (Math.max(...Y) - Math.min(...Y)) * 1.3 / 1.5);
    for (const size of ['tall', 'ig']) for (const q of [[92, 186, 984, 1505], [69, 104, 1008, 1521], [22, 39, 1047, 1588], [51, 70, 1013, 1510]]) { const v = D.bestView(route, [], size === 'ig' ? [q[0], q[1], q[2], q[3] - 270] : q, D.boards(size, 3), [24, 36, 1000, 1500], base); hard += v.hard; soft = Math.max(soft, v.soft); }
    t.diagnostic(`${name}：放大 ${(896 / base).toFixed(2)} 倍，起終點被蓋 ${hard}，路線最多被蓋 ${(soft * 100).toFixed(1)}%，${Math.round(ms)} ms`);
    assert.equal(hard, 0, name); assert.ok(896 / base < 1.62);
  }
});
test('名字：住宅裡不寫、咖啡店很近才寫、捷運補站', () => {
  const poi = [{ cls: 'school', name: '某國小', lat: 25 + 60 * M, lng: 121.5 }, { cls: 'cafe', name: '咖啡', lat: 25 + 30 * M, lng: 121.6 }, { cls: 'railway', sub: 'subway', name: '公館', lat: 25.2, lng: 121.5 }, { cls: 'office', name: '某公司', lat: 25.3, lng: 121.5 }];
  const box = (la, ln) => ({ type: 'Polygon', coordinates: [[[ln - 0.01, la - 0.01], [ln + 0.01, la - 0.01], [ln + 0.01, la + 0.01], [ln - 0.01, la + 0.01], [ln - 0.01, la - 0.01]]] });
  const f = { poi, green: [], inst: [], home: [] };
  assert.equal(D.nameStop({ lat: 25, lng: 121.5 }, f), '某國小'); assert.equal(D.nameStop({ lat: 25, lng: 121.5 }, { ...f, home: [box(25, 121.5)] }), '');
  assert.equal(D.nameStop({ lat: 25, lng: 121.6 }, { ...f, home: [box(25, 121.6)] }), '咖啡'); assert.equal(D.nameStop({ lat: 25.2, lng: 121.5 }, f), '公館站'); assert.equal(D.nameStop({ lat: 25.3, lng: 121.5 }, f), '');
});
test('自己命名的地方：80 公尺內優先；家不寫出來', () => {
  const s = { lat: 25, lng: 121.5 };
  assert.equal(D.ownName([{ lat: 25 + 50 * M, lng: 121.5, name: '巷口那間' }], s), '巷口那間'); assert.equal(D.ownName([{ lat: 25 + 200 * M, lng: 121.5, name: '遠' }], s), undefined);
  assert.equal(D.ownName([{ lat: 25, lng: 121.5, name: '我家' }], s), ''); assert.equal(D.ownName([{ lat: 25, lng: 121.5, name: '巢', icon: 'home' }], s), ''); assert.equal(D.ownName([{ lat: 25, lng: 121.5, name: '家樂福' }], s), '家樂福');
});
