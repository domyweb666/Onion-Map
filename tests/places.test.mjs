import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../src/js/62-places.js', import.meta.url), 'utf8');
const L = new Function(src.slice(src.indexOf('/*PLACES_LOGIC_START*/'), src.indexOf('/*PLACES_LOGIC_END*/')) + ';return PLACES_LOGIC;')();

const NOW = Math.floor(new Date(2026, 10, 25, 21, 0).getTime() / 1000), DAY = 86400;
const at = (dayAgo, h, m = 0) => Math.floor(new Date(2026, 10, 25 - dayAgo, h, m).getTime() / 1000);
const stay = (lat, lng, t0, min, every = 60) => { const o = []; for (let t = 0; t <= min * 60; t += every) o.push([t0 + t, lat + 0.00005 * Math.sin(t), lng, 10, 'w']); return o; };
const walk = (a, b, t0, n) => Array.from({ length: n }, (_, i) => [t0 + i * 30, a[0] + (b[0] - a[0]) * i / (n - 1), a[1] + (b[1] - a[1]) * i / (n - 1), 10, 'w']);
const HOME = [25.0300, 121.5200], WORK = [25.0500, 121.5500], CAFE = [25.0400, 121.5300], PARK = [25.0450, 121.5400], BOOK = [25.0350, 121.5350], SHOP = [25.0380, 121.5450];
const base = { places: [], asked: { skip: [], day: '', seen: [] }, nowSec: NOW, today: '2026-11-25', recording: false };
const homeWork = () => [1, 2, 3, 4, 5].flatMap(d => [...stay(...HOME, at(d, 7), 60), ...stay(...WORK, at(d, 9), 480, 300), ...stay(...HOME, at(d, 20), 120)]).sort((a, b) => a[0] - b[0]);

test('待滿 12 分鐘算停留，11 分鐘不算', () => {
  assert.equal(L.findStops(stay(...CAFE, at(0, 14), 12)).length, 1);
  assert.equal(L.findStops(stay(...CAFE, at(0, 14), 11)).length, 0);
});
test('匯入的足跡不問，自己記錄的照問', () => {
  const pts = [...stay(...CAFE, at(2, 14), 40), ...walk(CAFE, BOOK, at(2, 15), 60), ...stay(...BOOK, at(1, 14), 40)], asked = { skip: [], day: '', seen: [] };
  assert.equal(L.markOld(asked, [], NOW), false); assert.equal(asked.old, undefined, '沒有新的就不存');
  assert.ok(L.markOld(asked, [[at(1, 0), at(1, 23)], [at(400, 0), at(400, 23)]], NOW));
  assert.deepEqual(asked.old, [[at(1, 0), at(1, 23)]], '只記最近幾天');
  const s = L.nextAsk({ ...base, pts, asked }); assert.ok(L.dist(s.lat, s.lng, ...CAFE) < 40, '跳過匯入的書店那天，問前一天的咖啡店');
  L.markOld(asked, [[at(2, 0), at(2, 23)]], NOW); assert.equal(L.nextAsk({ ...base, pts, asked }), null);
  assert.ok(L.nextAsk({ ...base, pts: [...pts, ...stay(...SHOP, at(0, 15), 30)], asked }), '之後自己走的還是會問');
  L.markOld(asked, [], NOW + 30 * DAY); assert.deepEqual(asked.old, [], '過期的清掉');
});
test('走路不算停留；停留的中心與時間對', () => {
  const pts = [...walk(HOME, CAFE, at(0, 13, 30), 60), ...stay(...CAFE, at(0, 14), 40), ...walk(CAFE, PARK, at(0, 14, 41), 60)];
  const s = L.findStops(pts); assert.equal(s.length, 1);
  assert.ok(L.dist(s[0].lat, s[0].lng, ...CAFE) < 30); assert.ok(Math.abs(s[0].minutes - 40) <= 4);
});
test('中間斷訊超過 3 小時（關掉記錄）不算同一次停留', () => {
  const pts = [[at(0, 10), ...CAFE, 10, 'w'], [at(0, 15), ...CAFE, 10, 'w']];
  assert.equal(L.findStops(pts).length, 0);
  assert.equal(L.findStops(pts, { gapHr: 16 }).length, 1);
});
test('家與公司（待最久的前兩個點）不問，咖啡店會問', () => {
  const hw = homeWork();
  assert.equal(L.homes(hw, NOW).length, 2);
  assert.equal(L.nextAsk({ ...base, pts: hw }), null);
  const s = L.nextAsk({ ...base, pts: [...hw, ...stay(...CAFE, at(0, 14), 40)] });
  assert.ok(s && L.dist(s.lat, s.lng, ...CAFE) < 30);
});
test('第三個常待的點會問（只排除前兩個）', () => {
  const pts = [...homeWork(), ...stay(...CAFE, at(0, 13), 200, 120)];
  assert.ok(L.nextAsk({ ...base, pts }));
});
test('只待過一下的新使用者，第一個停留也會問（不到 3 小時不當成家）', () => {
  assert.ok(L.nextAsk({ ...base, pts: stay(...CAFE, at(0, 14), 40) }));
});
test('80 公尺內已經取過名字的不問', () => {
  const pts = stay(...CAFE, at(0, 14), 40);
  assert.equal(L.nextAsk({ ...base, pts, places: [{ lat: CAFE[0] + 0.0005, lng: CAFE[1] }] }), null);
  assert.ok(L.nextAsk({ ...base, pts, places: [{ lat: CAFE[0] + 0.0012, lng: CAFE[1] }] }));
});
test('跳過的地方不再問，隔天再去也不問', () => {
  const pts = [...stay(...CAFE, at(1, 14), 40), ...stay(...CAFE, at(0, 14), 40)], asked = { skip: [], day: '', seen: [] };
  const s = L.nextAsk({ ...base, pts, asked }); L.markSkip(asked, s);
  assert.equal(L.nextAsk({ ...base, pts, asked }), null);
  L.markSkip(asked, s); assert.equal(asked.skip.length, 1);
});
test('一天最多問三個，隔天重新算；同一個點重開不重複算', () => {
  const pts = [...stay(...CAFE, at(0, 9), 30), ...stay(...PARK, at(0, 11), 30), ...stay(...BOOK, at(0, 13), 30), ...stay(...SHOP, at(0, 15), 30)];
  const asked = { skip: [], day: '', seen: [] }; let n = 0, s;
  while ((s = L.nextAsk({ ...base, pts, asked })) && n < 10) { L.markSeen(asked, s, '2026-11-25'); L.markSeen(asked, s, '2026-11-25'); L.markSkip(asked, s); n++; }
  assert.equal(n, 3); assert.equal(asked.seen.length, 3);
  assert.ok(L.nextAsk({ ...base, pts, asked, nowSec: NOW + DAY, today: '2026-11-26' }));
});
test('正在記錄而且還沒離開就不問，停了記錄才問', () => {
  const pts = stay(...CAFE, NOW - 2400, 40);
  assert.equal(L.nextAsk({ ...base, pts, recording: true }), null);
  assert.ok(L.nextAsk({ ...base, pts, recording: false }));
  assert.ok(L.nextAsk({ ...base, pts: [...stay(...CAFE, NOW - 6000, 40), ...walk(CAFE, PARK, NOW - 3000, 60)], recording: true }));
});
test('超過 7 天的不問', () => { assert.equal(L.nextAsk({ ...base, pts: stay(...CAFE, at(8, 14), 40) }), null); });
test('新的先問', () => {
  const s = L.nextAsk({ ...base, pts: [...stay(...CAFE, at(1, 14), 40), ...stay(...PARK, at(0, 14), 40)] });
  assert.ok(L.dist(s.lat, s.lng, ...PARK) < 30);
});
test('建議名字：近的在前、不重複、公車站牌與停車場不列、最多三個', () => {
  const p = (name, cls, d) => ({ name, cls, lat: CAFE[0] + d / 110540, lng: CAFE[1] });
  const r = L.suggest([p('遠的書店', 'shop', 70), p('某咖啡', 'cafe', 10), p('某咖啡', 'cafe', 12), p('站牌', 'bus', 2), p('停車場', 'parking', 3), p('麵店', 'restaurant', 30), p('公園', 'park', 50), p('太遠', 'cafe', 200)], ...CAFE, 80, 3);
  assert.deepEqual(r.map(x => x.name), ['某咖啡', '麵店', '公園']);
});
test('圖示照名字猜，猜不到看類別，都沒有就插旗', () => {
  const g = L.guessIcon;
  assert.equal(g('阿姨家'), 'home'); assert.equal(g('路易莎咖啡'), 'cafe'); assert.equal(g('龍山寺'), 'temple'); assert.equal(g('古亭站'), 'station');
  assert.equal(g('象山'), 'mountain'); assert.equal(g('大安森林公園'), 'tree'); assert.equal(g('', 'restaurant'), 'food'); assert.equal(g('秘密基地'), 'flag');
});
test('停留時間的說法', () => { assert.equal(L.stayText(40), '40 分鐘'); assert.equal(L.stayText(90), '1 小時 30 分鐘'); assert.equal(L.stayText(125), '2 小時'); assert.equal(L.stayText(400), '6 小時'); });
