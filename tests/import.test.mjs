// node --test tests/import.test.mjs
process.env.TZ = 'Asia/Taipei';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), h3 = require('h3-js');
const src = n => fs.readFileSync(new URL('../src/js/' + n, import.meta.url), 'utf8');
const cut = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b));
const { CFG, createEngine, ImportCore, IMP, dayKey } = new Function(
  cut(src('00-engine.js'), '/*ENGINE_START*/', '/*ENGINE_END*/') + cut(src('66-import.js'), '/*IMPORT_CORE_START*/', '/*IMPORT_CORE_END*/') +
  ';return {CFG,createEngine,ImportCore,IMP,dayKey}')();

const fx = n => new Blob([fs.readFileSync(new URL('./fixtures/' + n, import.meta.url))]);
const blob = s => new Blob([typeof s === 'string' ? s : JSON.stringify(s)]);
const env = { progress() {}, tick: async () => {} };
async function load(files, main = createEngine(h3), e = env) {
  const b = ImportCore.bag();
  for (const f of [].concat(files)) { const r = await ImportCore.readFile(f, b, e); if (r.kind === 'backup') return r; }
  const tmp = createEngine(ImportCore.fastH3(h3)), r = await ImportCore.run(b, tmp, k => !!main.state().days[k], e), t0 = Date.now();
  main.merge(tmp.state(), r.days); r.mergeMs = Date.now() - t0;
  return Object.assign(r, { main, tmp, b, n: Object.keys(r.days).length, text: ImportCore.summary(Object.keys(r.days).length, r.km, r.skipped) });
}
const code = c => e => e.imp === c;
const gaps = pts => pts.slice(1).map((p, i) => p[0] - pts[i][0]);

test('GPX：軌跡、註解不算、有路線就不看標記點、單引號屬性、+08:00', async () => {
  const r = await load(fx('import-track.gpx'));
  assert.deepEqual(Object.keys(r.days), ['2024-03-01']);
  const p = r.days['2024-03-01'];
  assert.ok(p.every(x => x[1] >= 23.5 && x[1] <= 23.6 && x[2] < 120.7));
  assert.equal(p[0][0], Date.UTC(2024, 2, 1, 1) / 1000);
  assert.ok(p.every(x => x[3] === 15 && x[4] === 'w'));
  assert.equal(r.main.state().gaps.length, 0, '兩個 trkseg 隔一小時，不連虛線');
  assert.ok(Math.abs(r.km - 0.162) < 0.02, String(r.km));
  assert.deepEqual(r.main.state().days['2024-03-01'].n, p.length);
});
test('GPX：rte、有命名空間前綴', async () => { const r = await load(fx('import-route.gpx')); assert.equal(r.n, 1); assert.ok(r.days['2024-03-02'].length >= 2); });
test('GPX：沒有時間', async () => { await assert.rejects(load(fx('import-notime.gpx')), code('notime')); });
test('GPX：只有標記點、標記點有時間，用標記點', async () => {
  const r = await load(blob('<gpx><wpt lat="23.5" lon="120.5"><time>2024-03-01T01:00:00Z</time></wpt></gpx>')); assert.equal(r.n, 1);
});
test('GPX：時間沒寫時區，照規定當世界標準時間', async () => {
  const r = await load(blob('<gpx><trk><trkseg><trkpt lat="23.5" lon="120.5"><time>2024-03-01T20:00:00</time></trkpt></trkseg></trk></gpx>'));
  assert.deepEqual(Object.keys(r.days), ['2024-03-02']);
});

test('Android 時間軸：timelinePath、visit、activity、rawSignals', async () => {
  const r = await load(fx('import-android-timeline.json'));
  assert.deepEqual(Object.keys(r.days), ['2024-06-01', '2024-06-02']);
  const p = r.days['2024-06-01'];
  assert.equal(p[0][0], Date.parse('2024-06-01T08:00:30+08:00') / 1000, '停留的進');
  const mv = p.filter(x => x[0] >= Date.parse('2024-06-01T09:04:00+08:00') / 1000);
  assert.ok(Math.max(...gaps(mv)) <= 30, '同一段移動內每 30 秒一點');
  assert.equal(mv.at(-1)[1], 23.53);
  assert.ok(Math.abs(r.km - 3.33) < 0.15, String(r.km));
  assert.equal(r.days['2024-06-02'].length, 1, '精度 900 公尺的不要');
  assert.equal(r.days['2024-06-02'][0][3], 12);
  assert.equal(r.main.state().gaps.length, 0, '隔一夜在 10 公里外開始，不連虛線');
});
test('iOS 時間軸：geo:、分鐘位移、同一分鐘兩點、小地點略過', async () => {
  const r = await load(fx('import-ios-timeline.json'));
  assert.deepEqual(Object.keys(r.days), ['2024-07-01']);
  const p = r.days['2024-07-01'], mv = p.filter(x => x[0] >= Date.parse('2024-07-01T10:00:00+08:00') / 1000);
  assert.ok(Math.max(...gaps(mv)) <= 30);
  assert.ok(gaps(p).every(d => d > 0));
  assert.ok(mv.some(x => x[1] === 23.51 && x[0] === Date.parse('2024-07-01T10:06:00+08:00') / 1000));
  assert.ok(!p.some(x => x[1] === 23.5001));
  assert.ok(Math.abs(r.km - 3.33) < 0.2, String(r.km));
});
test('舊 Takeout Records.json：timestamp 與 timestampMs、原地晃動不算路、精度太差不要', async () => {
  const r = await load(fx('import-records.json'));
  assert.deepEqual(Object.keys(r.days), ['2019-05-01']);
  const p = r.days['2019-05-01'];
  assert.ok(p.every(x => x[1] < 23.6));
  assert.deepEqual(p.map(x => x[1]), [23.5, 23.5, 23.501, 23.502]);
  assert.ok(r.km > 0.1 && r.km < 0.12, '原地晃動與隔 22 分鐘那段不算，只算最後一段：' + r.km);
});
test('舊 Semantic Location History：placeVisit、waypointPath、simplifiedRawPath、startTimestampMs', async () => {
  const r = await load(fx('import-semantic.json'));
  const p = r.days['2021-03-01']; assert.ok(p.length > 20);
  assert.ok(p.some(x => x[2] === 120.51), '走過 waypoint');
  assert.ok(p.some(x => x[1] === 23.535));
});
test('E7 溢位的舊值', () => { assert.ok(Math.abs(ImportCore.latLng({ latitudeE7: 4294967296 - 235000000, longitudeE7: 1205000000 })[0] + 23.5) < 1e-9); });

test('洋蔥備份：認 cells，不當足跡處理', async () => {
  const r = await load(blob({ v: 2, cells: { '8c4ba0a41c9a1ff': [1, 1] }, points: [] }));
  assert.equal(r.kind, 'backup'); assert.equal(r.data.v, 2);
});
test('壞檔、空檔、壓縮檔、別的格式', async () => {
  await assert.rejects(load(blob('')), code('empty'));
  await assert.rejects(load(blob('   \n ')), code('unknown'));
  await assert.rejects(load(blob('hello')), code('unknown'));
  await assert.rejects(load(blob('{"a":1}')), code('unknown'));
  await assert.rejects(load(blob('[]')), code('empty'));
  await assert.rejects(load(blob('{"locations":[]}')), code('empty'));
  await assert.rejects(load(blob('{"locations":[{"latitudeE7":235000000,')), code('bad'));
  await assert.rejects(load(blob('{"locations":[{"latitudeE7":oops}]}')), code('bad'));
  await assert.rejects(load(blob('{"locations":[]}}')), code('bad'));
  await assert.rejects(load(blob('{"cells":{"a":')), code('bad'));
  await assert.rejects(load(blob('<kml></kml>')), code('unknown'));
  await assert.rejects(load(blob('<gpx><trk><trkseg>')), code('bad'));
  await assert.rejects(load(new Blob([new Uint8Array([0x50, 0x4B, 3, 4])])), code('zip'));
});
test('欄位缺東缺西、型別亂寫也不會炸', async () => {
  const r = await load(blob({ semanticSegments: [null, 1, {}, { visit: {} }, { activity: { start: {}, end: null }, startTime: 'x' }, { timelinePath: [null, { point: '°,°' }, { point: 'geo:1' }, { point: '23.5°, 120.5°', time: 'bad' }] },
    { startTime: '2024-06-01T00:00:00Z', endTime: '2024-06-01T01:00:00Z', timelinePath: [{ point: '23.5°, 120.5°', time: '2024-06-01T00:10:00Z' }] }], rawSignals: [{}, { position: {} }, { position: { LatLng: '95°, 200°', timestamp: '2024-06-01T00:00:00Z' } }] }));
  assert.equal(r.n, 1); assert.equal(r.days['2024-06-01'].length, 1);
});
test('JSON 切成任意大小餵都一樣（字串裡有括號、跳脫、中文）', async () => {
  const text = JSON.stringify({ 'a"b{[': '\\"}]', locations: [{ n: '左{右]"\\', latitudeE7: 1 }, { x: [{ y: [] }] }], other: [[1, 2]], z: { locations: [{ no: 1 }] } });
  const go = step => { const out = []; const s = ImportCore.jsonStream((k, o) => out.push([k, o])); for (let i = 0; i < text.length; i += step) s.feed(text.slice(i, i + step)); s.end(); return out; };
  const want = go(1e9); assert.equal(want.length, 3);
  assert.deepEqual(want.map(x => x[0]), ['locations', 'locations', 'other']);
  for (const step of [1, 2, 3, 7, 20]) assert.deepEqual(go(step), want);
});
test('UTF-8 開頭記號與 UTF-16 都讀得到', async () => {
  const t = fs.readFileSync(new URL('./fixtures/import-records.json', import.meta.url), 'utf8');
  assert.equal((await load(blob('﻿' + t))).n, 1);
  const u = new Uint8Array(2 + t.length * 2); u[0] = 0xFF; u[1] = 0xFE; for (let i = 0; i < t.length; i++) { u[2 + i * 2] = t.charCodeAt(i) & 255; u[3 + i * 2] = t.charCodeAt(i) >> 8; }
  assert.equal((await load(new Blob([u]))).n, 1);
});

test('混時區：照手機所在時區分天', async () => {
  const r = await load(blob([
    { startTime: '2024-08-01T23:30:00.000-07:00', endTime: '2024-08-01T23:40:00.000-07:00', visit: { topCandidate: { placeLocation: 'geo:37.7,-122.4' } } },
    { startTime: '2024-08-01T15:30:00.000Z', endTime: '2024-08-01T15:50:00.000Z', visit: { topCandidate: { placeLocation: 'geo:23.5,120.5' } } },
    { startTime: '2024-08-02T00:30:00.000+08:00', endTime: '2024-08-02T00:40:00.000+08:00', visit: { topCandidate: { placeLocation: 'geo:23.6,120.5' } } }]));
  assert.deepEqual(Object.keys(r.days).sort(), ['2024-08-01', '2024-08-02']);
  assert.equal(r.days['2024-08-01'].every(p => p[1] === 23.5), true);
});
test('同一個檔匯兩次：第二次 0 天、什麼都不變', async () => {
  const main = createEngine(h3), a = await load([fx('import-android-timeline.json'), fx('import-records.json')], main);
  assert.equal(a.n, 3); assert.match(a.text, /^加進 3 天、[\d.]+ 公里。$/);
  const before = JSON.stringify([main.state().cells, main.state().km, main.state().days, main.state().area]);
  const b = await load([fx('import-android-timeline.json'), fx('import-records.json')], main);
  assert.equal(b.n, 0); assert.equal(b.skipped, 3); assert.match(b.text, /3 天洋蔥本來就有紀錄/);
  assert.equal(JSON.stringify([main.state().cells, main.state().km, main.state().days, main.state().area]), before);
});
test('有一天本來就有：只加別天，而且不畫線跨過那天', async () => {
  const main = createEngine(h3); main.process({ lat: 24, lng: 121, acc: 5, t: Date.parse('2024-09-02T10:00:00+08:00'), spd: null });
  const v = (d, lat) => ({ startTime: `2024-09-0${d}T09:00:00+08:00`, endTime: `2024-09-0${d}T23:59:00+08:00`, visit: { topCandidate: { placeLocation: `geo:${lat},120.5` } } });
  const r = await load(blob([v(1, 23.5), v(2, 23.6), v(3, 23.7)]), main);
  assert.equal(r.n, 2); assert.equal(r.skipped, 1); assert.match(r.text, /1 天本來就有紀錄所以略過。$/);
  assert.equal(main.state().gaps.length, 0);
  assert.equal(main.state().days['2024-09-02'].n, 1);
  const c = h3.latLngToCell(23.6, 120.5, CFG.res); assert.ok(!main.state().cells[c], '略過那天的格子不揭開');
});
test('飛行：頭尾在同一段移動裡，畫成航線', async () => {
  const r = await load(blob([{ startTime: '2024-10-01T08:00:00+08:00', endTime: '2024-10-01T11:00:00+08:00', activity: { start: 'geo:25.07,121.23', end: 'geo:35.55,139.78', topCandidate: { type: 'flying' } } }]));
  assert.equal(r.main.state().flights.length, 1); assert.equal(r.days['2024-10-01'].length, 2);
});
test('取消：丟 cancel，主引擎沒動', async () => {
  const main = createEngine(h3); let n = 0;
  await assert.rejects(load(fx('import-records.json'), main, { progress() {}, tick: async () => { if (++n > 0) throw ImportCore.fail('cancel', 'x'); } }), code('cancel'));
  assert.deepEqual(main.state().days, {}); assert.deepEqual(main.state().cells, {});
});
test('定位飄掉又回來：那一點不要', async () => {
  const L = (s, la, lo) => ({ latitudeE7: Math.round(la * 1e7), longitudeE7: Math.round(lo * 1e7), accuracy: 20, timestamp: new Date(Date.UTC(2020, 0, 1, 2) + s * 1000).toISOString() });
  const r = await load(blob({ locations: [L(0, 23.5, 120.5), L(60, 23.501, 120.5), L(120, 23.6, 120.5), L(180, 23.502, 120.5)] }));
  assert.ok(r.days['2020-01-01'].every(p => p[1] < 23.51));
});

test('匯入用的 h3 跟真的 h3 跑出一樣的格子', async () => {
  for (const f of ['import-android-timeline.json', 'import-semantic.json', 'import-track.gpx']) {
    const b = ImportCore.bag(); await ImportCore.readFile(fx(f), b, env); const a = createEngine(h3), z = createEngine(ImportCore.fastH3(h3));
    await ImportCore.run(b, a, () => false, env); await ImportCore.run(b, z, () => false, env);
    assert.deepEqual(z.state().cells, a.state().cells); assert.deepEqual(z.state().points, a.state().points);
    assert.deepEqual(z.takeSaves().shards.sort(), a.takeSaves().shards.sort());
  }
});
test('十萬點：60 天、引擎沒有掉舊點、時間合理', async () => {
  const locs = []; let t = Date.UTC(2015, 0, 1), la = 23.5, lo = 120.5;
  for (let i = 0; i < 100000; i++) {
    t += 50000; const move = i % 400 < 120, fast = i % 800 < 120;
    if (move) { la += (fast ? 0.004 : 0.0004) * Math.sin(i / 900); lo += (fast ? 0.004 : 0.0004) * Math.cos(i / 700); } else { la += (i % 2 ? 1 : -1) * 1e-4; }
    locs.push({ latitudeE7: Math.round(la * 1e7), longitudeE7: Math.round(lo * 1e7), accuracy: 10 + i % 30, timestamp: new Date(t).toISOString(), activity: [{ timestamp: 'x', activity: [{ type: 'STILL', confidence: 90 }] }] });
  }
  const f = blob({ locations: locs }), t0 = Date.now(), r = await load(f), sec = (Date.now() - t0) / 1000;
  const total = Object.values(r.days).reduce((a, d) => a + d.length, 0);
  console.log('十萬點：' + (f.size / 1048576).toFixed(1) + ' MB、' + sec.toFixed(1) + ' 秒、' + r.n + ' 天、留下 ' + total + ' 點、' + Object.keys(r.main.state().cells).length + ' 格、' + Math.round(r.km) + ' 公里、併入 ' + r.mergeMs + ' 毫秒');
  assert.equal(r.n, 58 + (r.n === 59 ? 1 : 0));
  assert.equal(total, r.tmp.state().points.length);
  assert.ok(total > 25000);
  assert.ok(sec < 60, sec + ' 秒');
});
test('十萬點的 GPX（一秒一點）', async () => {
  let s = '<gpx><trk><trkseg>'; for (let i = 0; i < 100000; i++) s += `<trkpt lat="${(23.5 + i * 1.2e-5).toFixed(6)}" lon="120.500000"><ele>1</ele><time>${new Date(Date.UTC(2022, 0, 1) + i * 1000).toISOString()}</time></trkpt>`;
  const t0 = Date.now(), r = await load(blob(s + '</trkseg></trk></gpx>')), sec = (Date.now() - t0) / 1000;
  console.log('十萬點 GPX：' + sec.toFixed(1) + ' 秒、' + Math.round(r.km) + ' 公里');
  assert.ok(Math.abs(r.km - 133.4) < 2, String(r.km)); assert.ok(sec < 60);
});

// ---------- 畫面那一段：還原備份（原本另有一個「匯入備份」，現在只剩這個入口） ----------
// 用最小的假 DOM 跑 66-import.js 的後半段；引擎與 importAll 都是真的
class Chan { port1 = {}; port2 = { postMessage: () => setImmediate(() => this.port1.onmessage()) }; } // 真的 MessageChannel 會讓 node 一直不結束
function ui({ locked = false, restored = Promise.resolve(true), days = {}, saved = true } = {}) {
  const els = {}, log = [], kvs = new Map(), events = [];
  const el = id => els[id] || (els[id] = { id, style: {}, dataset: {}, hidden: false, parentNode: { setAttribute() {} }, set innerHTML(h) { this.html = h; }, get innerHTML() { return this.html; } });
  let sheet = ''; const $ = id => id === 'sheetHost' ? { hidden: !sheet } : id === 'mountImport' || sheet.includes('id="' + id + '"') || id === 'impRow' || id === 'impVal' ? el(id) : null;
  const engine = createEngine(h3); Object.assign(engine.state().days, days);
  const store = { locked }, kv = { set: async (k, v) => { kvs.set(k, v); }, get: async k => kvs.get(k), del: async k => { kvs.delete(k); }, list: async p => [...kvs.keys()].filter(k => k.startsWith(p) && !k.slice(p.length).includes('/')) };
  const g = { $, engine, store, kv, restored, h3, createEngine, ImportCore, IMP, dayKey, CFG, esc: String, hook: { ready: [] }, recording: false, saving: null, saveTimer: null, NATIVE: false, STORE: 'x', console: { error() {} },
    openSheet: h => { sheet = h; for (const id of ['impFile', 'impStop', 'impAgain', 'impRestore']) delete els[id]; return { querySelector: q => el(q.slice(1)) }; }, closeSheet: () => { sheet = ''; },
    toast: t => log.push('toast ' + t), render: () => log.push('render'), refreshData: () => log.push('refresh'), flushSave: async () => { log.push('save'); return saved; }, saveSoon() {},
    kvTry: async k => kvs.get(k) ?? null, kvSafeSet: async (k, v) => { kvs.set(k, v); }, kvJSON: async k => kvs.has(k) ? JSON.parse(kvs.get(k)) : undefined,
    document: { dispatchEvent: e => { events.push(e.type); log.push(e.type); } }, Event, CustomEvent, MessageChannel: Chan, localStorage: { removeItem() {} } };
  const st = src('15-store.js'), all = cut(st, 'function checkBackup', 'async function wipeAll') + src('66-import.js').split('/*IMPORT_CORE_END*/')[1] + ';return importer;';
  const importer = new Function(...Object.keys(g), all)(...Object.values(g));
  return { importer, engine, store, kvs, log, events, els, text: () => sheet, row: () => els.mountImport.html };
}
const backup = () => blob({ v: 2, cells: { '8c4ba0a41c9a1ff': [1, 1700000000000] }, flights: [], gaps: [], points: [[1700000000, 23.5, 120.5, 8, 'w'], [1700000060, 23.501, 120.5, 8, 'w']], km: { walk: 0.1 }, ext: { places: [{ id: 'a', name: '測試', lat: 23.5, lng: 120.5 }] } });
const named = (b, name) => Object.assign(b, { name });

test('還原備份：先問一次，按了才整個換掉，發 onion:restored，配對密碼留著', async () => {
  const u = ui({ days: { '2026-11-20': { n: 1, t0: 0, t1: 0 } } }); u.engine.state().ext.painter = { token: '假的' }; u.kvs.set('days/2026-11-20.json', '[]');
  assert.match(u.row(), /匯入足跡或備份/);
  await u.importer.start([named(backup(), 'onion-backup-2026-11-20.json')]);
  assert.match(u.text(), /這是洋蔥的備份/); assert.match(u.text(), /現在的 1 天紀錄會整個換成/);
  assert.equal(Object.keys(u.engine.state().cells).length, 0, '還沒按之前不動'); assert.deepEqual(u.events, []);
  await u.els.impRestore.onclick({ target: {} });
  const s = u.engine.state();
  assert.equal(Object.keys(s.cells).length, 1); assert.equal(s.days['2026-11-20'], undefined, '舊的整個換掉'); assert.equal(s.days[dayKey(1700000000)].n, 2);
  assert.equal(s.ext.places[0].name, '測試'); assert.equal(s.ext.painter.token, '假的');
  assert.ok(!u.kvs.has('days/2026-11-20.json')); assert.deepEqual(u.events, ['onion:restored']);
  assert.deepEqual(u.log.filter(x => x !== 'onion:restored'), ['save', 'render', 'refresh']); assert.match(u.text(), /備份還原好了/);
});
test('紀錄讀不完整（鎖住）時，備份還是能還原，足跡不能匯', async () => {
  const bad = Promise.reject(new Error('讀檔壞了')); bad.catch(() => {});
  for (const o of [{ locked: true }, { restored: bad }]) {
    const u = ui(o); await u.importer.start([named(backup(), 'b.json')]);
    assert.match(u.text(), /手機裡現在的紀錄會整個換成備份裡的/);
    await u.els.impRestore.onclick({ target: {} });
    assert.equal(u.store.locked, false); assert.deepEqual(u.events, ['onion:restored']);
  }
  const u = ui({ locked: true }); await u.importer.start([named(fx('import-track.gpx'), 't.gpx')]);
  assert.match(u.text(), /沒有匯入/); assert.match(u.text(), /沒讀完整/); assert.deepEqual(u.events, []); assert.equal(Object.keys(u.engine.state().days).length, 0);
});
test('壞掉的備份：講讀不了，什麼都不動', async () => {
  const u = ui({ days: { '2026-11-20': { n: 1 } } }); await u.importer.start([named(blob('{"v":2,"cells":{"8c4ba0a'), 'b.json')]);
  assert.match(u.text(), /讀不了/); assert.ok(u.engine.state().days['2026-11-20']); assert.deepEqual(u.events, []);
  const z = ui({ days: { '2026-11-20': { n: 1 } } }); await z.importer.start([named(blob({ v: 2, cells: null }), 'b.json')]);
  await z.els.impRestore.onclick({ target: {} }); assert.match(z.text(), /這份備份讀不了/); assert.ok(z.engine.state().days['2026-11-20']); assert.deepEqual(z.events, []);
});
test('備份格式怪怪的：先看完格式才動手，紀錄和檔案都不動', async () => {
  for (const bad of [{ cells: [] }, { points: {} }, { points: [null] }, { points: [['x', 1, 2]] }, { flights: 3 }, { ext: [] }]) {
    const u = ui({ days: { '2026-11-20': { n: 1 } } }); u.kvs.set('days/2026-11-20.json', '[]');
    await u.importer.start([named(blob(Object.assign({ v: 2, cells: {}, points: [] }, bad)), 'b.json')]);
    if (u.els.impRestore) await u.els.impRestore.onclick({ target: {} });
    assert.match(u.text(), /讀不了|看不懂/, JSON.stringify(bad)); assert.ok(u.engine.state().days['2026-11-20']); assert.ok(u.kvs.has('days/2026-11-20.json')); assert.deepEqual(u.events, []);
  }
});
test('還原備份：手繪地圖留著，日卡只留備份裡有的那幾天，舊的片與天清掉', async () => {
  const u = ui(), day = dayKey(1700000000);
  for (const k of ['base/b1.json', 'cards/' + day + '.json', 'cards/2026-11-20.json', 'days/2026-11-20.json', 'cells/舊的片.json', 'import-pending.json']) u.kvs.set(k, '{}');
  await u.importer.start([named(backup(), 'b.json')]); await u.els.impRestore.onclick({ target: {} });
  assert.deepEqual([...u.kvs.keys()].sort(), ['base/b1.json', 'cards/' + day + '.json'].sort());
});
test('還原備份：存不進去就不刪舊檔，講得出原因', async () => {
  const u = ui({ saved: false }); u.kvs.set('days/2026-11-20.json', '[]'); u.kvs.set('cards/2026-11-20.json', '{}');
  await u.importer.start([named(backup(), 'b.json')]); await u.els.impRestore.onclick({ target: {} });
  assert.match(u.text(), /存不進去/); assert.ok(u.kvs.has('days/2026-11-20.json')); assert.ok(u.kvs.has('cards/2026-11-20.json'));
});
test('匯入足跡：發一次 onion:imported；匯入列只剩一個', async () => {
  const u = ui(); await u.importer.start([named(fx('import-track.gpx'), 't.gpx')]);
  assert.deepEqual(u.events, ['onion:imported']); assert.ok(u.engine.state().days['2024-03-01']); assert.ok(u.kvs.has('days/2024-03-01.json'));
  const html = fs.readFileSync(new URL('../src/index.src.html', import.meta.url), 'utf8') + src('35-data.js');
  assert.ok(!/fileImport|匯入備份/.test(html));
});
test('上次匯入到一半：等收完才算數，收完補發 onion:imported 帶 gone', async () => {
  const run = async (pending, { locked = false, after = {} } = {}) => {
    const got = []; let left = pending ? 2 : 0;
    const part = cut(src('35-data.js') + '/*END*/', 'const importSettled', '/*END*/');
    const body = part.slice(0, part.indexOf('})();') + 5) + ';return importSettled;';
    const p = new Function('restored', 'kvTry', 'store', 'engine', 'document', 'CustomEvent', 'setTimeout', body)(Promise.resolve(), async () => left-- > 0 ? pending : null, { locked }, { state: () => ({ days: after }) }, { dispatchEvent: e => got.push(e) }, CustomEvent, f => setTimeout(f, 0));
    await p; await new Promise(ok => setTimeout(ok, 20)); return got;
  };
  assert.deepEqual(await run(null), []);
  assert.deepEqual(await run('["2024-03-01"]', { locked: true }), []);
  assert.deepEqual(await run('["2024-03-01"]', { after: { '2024-03-01': {} } }), [], '其實都存好了，沒收掉東西');
  const e = await run('["2024-03-01","2024-03-02"]', { after: { '2024-03-02': {} } });
  assert.equal(e.length, 1); assert.deepEqual(e[0].detail, { days: [], gone: ['2024-03-01'] });
});
