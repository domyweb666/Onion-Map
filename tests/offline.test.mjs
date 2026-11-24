// node --test tests/offline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const s = fs.readFileSync(new URL('../src/js/18-offline.js', import.meta.url), 'utf8');
const { OFF, offXY, offNear, offCounty, offMake } = new Function(s.slice(s.indexOf('/*OFFLINE_CORE_START*/'), s.indexOf('/*OFFLINE_CORE_END*/')) + ';return {OFF,offXY,offNear,offCounty,offMake}')();

const memStore = (box = { tile: new Map(), idx: new Map(), conf: {} }) => ({
  box, fail: false,
  async open() { return { idx: [...box.idx].map(([k, m]) => [k, { ...m }]), planet: box.conf.planet, areas: box.conf.areas && JSON.parse(JSON.stringify(box.conf.areas)) }; },
  async get(k) { return box.tile.get(k); },
  async put(k, d, m) { if (this.fail) { this.fail = false; throw new Error('Quota'); } box.tile.set(k, d); box.idx.set(k, { ...m }); },
  async marks(l) { for (const [k, m] of l) box.idx.set(k, { ...m }); },
  async del(l) { for (const k of l) { box.tile.delete(k); box.idx.delete(k); } },
  async conf(k, v) { box.conf[k] = JSON.parse(JSON.stringify(v)); }
});
function world(store = memStore(), opt = {}) {
  const w = { now: 1e12, online: true, ver: 'A', hits: [], live: 0, peak: 0, size: opt.size || 100, status: 200, blanks: 0, backs: 0, delays: [], store };
  const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(body), arrayBuffer: async () => body });
  w.core = offMake({
    store, now: () => w.now, online: () => w.online, delay: async ms => { w.delays.push(ms); await new Promise(r => setImmediate(r)); }, onBlank: () => w.blanks++, onBack: () => w.backs++,
    fetch: async (u, o) => {
      w.hits.push(u); w.peak = Math.max(w.peak, ++w.live);
      try {
        await new Promise((ok, bad) => { const t = setTimeout(ok, opt.ms || 1); o.signal.addEventListener('abort', () => { clearTimeout(t); bad(Object.assign(new Error('x'), { name: 'AbortError' })); }); });
        if (u === OFF.planet) return res(200, JSON.stringify({ tilejson: '3.0.0', minzoom: 0, maxzoom: 14, tiles: ['https://t/planet/' + w.ver + '/{z}/{x}/{y}.pbf'] }));
        if (w.status !== 200) return res(w.status, '');
        if (u.includes('/planet/') && !u.includes('/' + w.ver + '/')) return res(404, '');
        const b = new Uint8Array(w.size); b[0] = u.charCodeAt(u.length - 5); b[1] = w.ver.charCodeAt(0); return res(200, b.buffer);
      } finally { w.live--; }
    }
  });
  w.get = (u, sig) => w.core.handle(u, sig);
  return w;
}
const tiles = w => w.hits.filter(u => u !== OFF.planet);
const settle = () => new Promise(r => setTimeout(r, 40));

test('TileJSON：tiles 換成不帶版本的自己網址，存起來；沒網路用存的', async () => {
  const w = world(), j = (await w.get('onion://planet')).data;
  assert.deepEqual(j.tiles, ['onion://v/{z}/{x}/{y}']); assert.equal(j.maxzoom, 14);
  await settle();
  const b = world(w.store); b.online = false;
  assert.equal((await b.get('onion://planet')).data.maxzoom, 14); assert.equal(b.hits.length, 0);
});
test('第一次就沒網路：TileJSON 給得出來、圖磚給空白', async () => {
  const w = world(); w.online = false;
  const j = (await w.get('onion://planet')).data; assert.deepEqual(j.tiles, ['onion://v/{z}/{x}/{y}']); assert.equal(j.maxzoom, 14);
  assert.equal((await w.get('onion://v/14/13700/7000')).data.byteLength, 0);
  const d = new Uint8Array((await w.get('onion://dem/12/3400/1750')).data); assert.deepEqual([...d.slice(1, 4)], [80, 78, 71]);
  assert.equal(w.hits.length, 0); assert.ok(w.blanks >= 1); assert.equal(w.core.bytes(), 0, '空白不存');
});
test('先查快取：第二次不上網；關網路重開還在；內容是自己的副本', async () => {
  const w = world(); const a = (await w.get('onion://v/10/5/6')).data; structuredClone(a, { transfer: [a] });
  assert.equal((await w.get('onion://v/10/5/6')).data.byteLength, 100);
  assert.equal(tiles(w).length, 1); await settle();
  const b = world(w.store); b.online = false; assert.equal((await b.get('onion://v/10/5/6')).data.byteLength, 100); assert.equal(b.hits.length, 0);
});
test('同一張同時要兩次只抓一次；都取消才取消', async () => {
  const w = world(undefined, { ms: 30 }); await w.get('onion://planet');
  const [a, b] = await Promise.all([w.get('onion://v/10/1/1'), w.get('onion://v/10/1/1')]);
  assert.notEqual(a.data, b.data); assert.equal(tiles(w).length, 1);
  const x = new AbortController(), y = new AbortController(), p = w.get('onion://v/10/2/2', x.signal), q = w.get('onion://v/10/2/2', y.signal);
  setTimeout(() => x.abort(), 2); await assert.rejects(p, { name: 'AbortError' }); assert.equal((await q).data.byteLength, 100);
  const z = new AbortController(), r = w.get('onion://v/10/3/3', z.signal); setTimeout(() => z.abort(), 2); await assert.rejects(r, { name: 'AbortError' });
  assert.ok(!w.core.has('v/10/3/3')); assert.equal((await w.get('onion://v/10/3/3')).data.byteLength, 100, '取消過的還能再要');
});
test('換版：舊圖磚照用、新的抓新版；舊網址 404 就重問一次', async () => {
  const w = world(); await w.get('onion://v/10/1/1'); w.ver = 'B'; w.now += 2 * 60000;
  assert.equal(new Uint8Array((await w.get('onion://v/10/1/1')).data)[1], 65, '存的舊版照用');
  assert.equal(new Uint8Array((await w.get('onion://v/10/2/1')).data)[1], 66, '新抓的是新版');
  assert.ok(w.hits.some(u => u.includes('/A/10/2/1'))); assert.ok(w.hits.some(u => u.includes('/B/10/2/1')));
  w.online = false; assert.equal(new Uint8Array((await w.get('onion://v/10/1/1')).data)[1], 65);
});
test('放太久又換版：先給舊的，背後換新', async () => {
  const w = world(); await w.get('onion://v/10/1/1'); w.ver = 'B'; w.now += OFF.staleMs + 1; await w.get('onion://planet'); await settle();
  assert.equal(new Uint8Array((await w.get('onion://v/10/1/1')).data)[1], 65); await settle();
  assert.equal(new Uint8Array((await w.get('onion://v/10/1/1')).data)[1], 66);
});
test('沒網路但有粗一級的圖磚：丟錯讓地圖拿粗的墊；高程用 404', async () => {
  const w = world(); await w.get('onion://v/10/855/439'); await w.get('onion://dem/10/855/439'); w.online = false;
  await assert.rejects(w.get('onion://v/12/3420/1757'), e => e.message === 'onion-offline' && !e.status);
  await assert.rejects(w.get('onion://dem/12/3420/1757'), e => e.status === 404);
  assert.equal((await w.get('onion://v/12/100/100')).data.byteLength, 0);
});
test('伺服器出錯不存、不炸；恢復後通知地圖重要一次', async () => {
  const w = world(); await w.get('onion://planet'); w.status = 503;
  assert.equal((await w.get('onion://v/9/1/1')).data.byteLength, 0); assert.ok(!w.core.has('v/9/1/1')); assert.equal(w.blanks, 1);
  w.status = 200; assert.equal((await w.get('onion://v/9/1/1')).data.byteLength, 100); assert.equal(w.backs, 1);
});
test('向量圖磚 404 當成空的存起來', async () => { const w = world(); await w.get('onion://planet'); w.status = 404; assert.equal((await w.get('onion://v/9/1/1')).data.byteLength, 0); assert.ok(w.core.has('v/9/1/1')); });

test('超過上限：最久沒用的先丟，下載的不丟', async () => {
  const cap = OFF.cap, mb = OFF.minBrowse; OFF.cap = 2000; OFF.minBrowse = 500;
  try {
    const w = world(); await w.core.ready;
    const keep = ['v/14/1/1', 'v/14/1/2', 'v/14/1/3']; assert.equal((await w.core.download('虛構縣', keep)).ok, true);
    for (let i = 0; i < 16; i++) { w.now += 1000; await w.get('onion://v/10/' + i + '/0'); }
    w.now += 1000; await w.get('onion://v/10/0/0'); // 最早的那張剛剛又用到
    for (let i = 16; i < 24; i++) { w.now += 1000; await w.get('onion://v/10/' + i + '/0'); }
    await settle();
    assert.ok(w.core.bytes() <= 2000, String(w.core.bytes()));
    keep.forEach(k => assert.ok(w.core.has(k))); assert.ok(w.core.has('v/10/0/0')); assert.ok(!w.core.has('v/10/1/0')); assert.ok(w.core.has('v/10/23/0'));
    assert.equal([...w.store.box.tile.keys()].length, [...w.store.box.idx.keys()].length);
    assert.equal(w.core.bytes(), w.store.box.tile.size * 100);
  } finally { OFF.cap = cap; OFF.minBrowse = mb; }
});
test('手機空間滿了：丟一些再存', async () => {
  const w = world(); for (let i = 0; i < 10; i++) { w.now++; await w.get('onion://v/9/' + i + '/0'); } await settle();
  w.store.fail = true; w.now++; await w.get('onion://v/9/99/0'); await settle();
  assert.ok(w.store.box.tile.has('v/9/99/0')); assert.ok(!w.store.box.tile.has('v/9/0/0'));
});
test('櫃子打不開：直接上網，不存也不炸', async () => {
  const st = memStore(); st.open = async () => { throw new Error('no idb'); }; const w = world(st);
  assert.equal((await w.get('onion://v/9/1/1')).data.byteLength, 100); assert.equal(st.box.tile.size, 0);
});

test('補齊：同時最多兩個、每張之間等 100 毫秒、抓過的不重抓', async () => {
  const w = world(); await w.get('onion://v/10/1/1'); w.hits.length = 0; w.peak = 0;
  const keys = Array.from({ length: 30 }, (_, i) => 'v/10/' + i + '/1'); let last = 0;
  const r = await w.core.ensure(keys, { onProgress: n => { last = n; } });
  assert.equal(r.ok, true); assert.equal(last, 30); assert.equal(tiles(w).length, 29); assert.ok(w.peak <= 2, String(w.peak)); assert.equal(w.delays.filter(d => d === 100).length, 29);
  w.hits.length = 0; await w.core.ensure(keys); assert.equal(w.hits.length, 0);
});
test('停下來：不算下載完成，抓到的留著當一般圖磚，再按接著抓', async () => {
  const w = world(), ac = new AbortController(), keys = Array.from({ length: 20 }, (_, i) => 'v/14/' + i + '/1');
  const r = await w.core.download('甲縣', keys, { signal: ac.signal, onProgress: n => { if (n === 5) ac.abort(); } });
  assert.equal(r.ok, false); assert.deepEqual(w.core.areas(), {}); assert.equal(w.core.pinned(), 0); assert.ok(w.core.has('v/14/0/1'));
  w.hits.length = 0; assert.equal((await w.core.download('甲縣', keys)).ok, true); assert.ok(tiles(w).length <= 15); assert.equal(w.core.pinned(), 2000); assert.equal(w.core.areas()['甲縣'].n, 2000);
});
test('下載到一半 app 被關掉：下次打開不會變成半套的「已下載」', async () => {
  const w = world(); await w.core.download('甲縣', ['v/14/1/1', 'v/14/2/1']); w.store.box.conf.areas['甲縣'].done = false;
  const b = world(w.store); await b.core.ready; assert.deepEqual(b.core.areas(), {}); assert.equal(b.core.pinned(), 0); assert.ok(b.core.has('v/14/1/1'));
});
test('網路斷：連續失敗就收手，不會一直打', async () => {
  const w = world(); await w.get('onion://planet'); w.status = 503; w.hits.length = 0;
  const r = await w.core.ensure(Array.from({ length: 200 }, (_, i) => 'v/14/' + i + '/1')); assert.equal(r.ok, false); assert.ok(w.hits.length <= 8, String(w.hits.length));
  w.status = 429; w.hits.length = 0; await w.core.ensure(Array.from({ length: 50 }, (_, i) => 'v/14/' + i + '/2')); assert.ok(w.hits.length <= 2);
});
test('刪除縣市：共用的圖磚留給另一個縣市', async () => {
  const w = world(); await w.core.download('甲縣', ['v/14/1/1', 'v/14/2/1']); await w.core.download('乙縣', ['v/14/2/1', 'v/14/3/1']);
  await w.core.remove('甲縣'); assert.ok(!w.core.has('v/14/1/1')); assert.ok(w.core.has('v/14/2/1')); assert.deepEqual(Object.keys(w.core.areas()), ['乙縣']);
  await settle(); const b = world(w.store); await b.core.ready; assert.equal(b.core.pinned(), 200);
  await w.get('onion://v/5/1/1'); await w.core.clearSeen(); assert.ok(!w.core.has('v/5/1/1')); assert.ok(w.core.has('v/14/3/1'));
});

test('附近 10 公里：z10 到 z14、高程只到 z12、數量小、近的先', () => {
  const k = offNear(121.5, 25.05), z14 = k.filter(x => x.startsWith('v/14')), [cx, cy] = offXY(121.5, 25.05, 14);
  assert.ok(z14.length >= 100 && z14.length <= 144, String(z14.length)); assert.equal(z14[0], `v/14/${cx}/${cy}`); assert.ok(k.length < 250, String(k.length));
  assert.ok(!k.some(x => /^d\/1[34]/.test(x))); assert.ok(!k.some(x => /^v\/[89]\//.test(x)));
});
function inRing(a, x, y) { let c = false; for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) { const yi = a[i + 1], yj = a[j + 1]; if ((yi > y) !== (yj > y) && x < (a[j] - a[i]) * (y - yi) / (yj - yi) + a[i]) c = !c; } return c; }
test('縣市的圖磚：蓋滿多邊形，外框的空角不抓；臺北市張數合理；每個縣市都有預估大小', () => {
  const d = JSON.parse(fs.readFileSync(new URL('../assets/admin/tw-admin.json', import.meta.url), 'utf8'));
  for (const t of d.towns) t.rings = t.p.map(poly => poly.map(r => { const a = new Float64Array(r.length); let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; a[i] = x / 1e4; a[i + 1] = y / 1e4; } return a; }));
  const c = d.counties.findIndex(x => x.n === '臺北市'), towns = d.towns.filter(t => t.c === c), keys = offCounty(towns, inRing), set = new Set(keys);
  assert.equal(set.size, keys.length); assert.ok(keys.length > 150 && keys.length < 260, String(keys.length));
  const [x, y] = offXY(121.5654, 25.033, 14); assert.ok(set.has(`v/14/${x}/${y}`)); assert.ok(set.has(`d/12/${x >> 2}/${y >> 2}`)); assert.ok(set.has(`v/8/${x >> 6}/${y >> 6}`)); assert.ok(!set.has(`d/13/${x >> 1}/${y >> 1}`));
  for (const t of towns) for (const p of t.rings) for (let i = 0; i < p[0].length; i += 2) { const [a, b] = offXY(p[0][i], p[0][i + 1], 14); assert.ok(set.has(`v/14/${a}/${b}`)); }
  for (const n of d.counties) assert.ok(OFF.mb[n.n] > 0, n.n + ' 要有預估大小');
});
